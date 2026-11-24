#!/usr/bin/env node
// Quarc Draw sync server — zero dependencies.
//
// Documents belong to a Quarc account. The login is the shared Quarc login (quarc-auth, Quarc_Store/auth): a signed
// "token" cookie that every Quarc app checks locally with the same JWT_SECRET, no network call per request.
//
//   JWT_SECRET=… node src/index.mjs                 start on :3009
//   JWT_SECRET=… node src/index.mjs --static dist   also serve the built web app from ./dist
//   node src/index.mjs --dev-auth                   local development only (or QUARC_DEV_AUTH=1): a fake login (password "dev"), no quarc-auth needed
//
// Environment:
//   JWT_SECRET       the same secret as quarc-auth and every other Quarc app (required, except with QUARC_DEV_AUTH)
//   SECURE_COOKIE    "true" when served over HTTPS (default false); must match quarc-auth, it decides the cookie flags of a renewal
//   PORT             default 3009
//   QUARC_DATA       data directory (default ./data)
//   QUARC_ORIGINS    extra browser origins allowed to call the API with the login cookie (comma separated).
//                    Always allowed: any port on this server's own host name, and the apps' own pages
//                    (https://localhost / capacitor://localhost = the Android app, http(s)://tauri.localhost = the Windows app).
//   QUARC_MAX_MB     largest document, default 512

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? true : null; };

const PORT = Number(process.env.PORT || arg('--port') || 3009);
const DATA = path.resolve(process.env.QUARC_DATA || path.join(__dirname, '..', 'data'));
const MAX_BYTES = Number(process.env.QUARC_MAX_MB || 512) * 1024 * 1024;
const STATIC = arg('--static') ? path.resolve(String(arg('--static'))) : process.env.QUARC_STATIC ? path.resolve(process.env.QUARC_STATIC) : null;
const DEV_AUTH = process.env.QUARC_DEV_AUTH === '1' || args.includes('--dev-auth');
const SECURE_COOKIE = process.env.SECURE_COOKIE === 'true';
const EXTRA_ORIGINS = (process.env.QUARC_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost', 'https://tauri.localhost', 'http://tauri.localhost', 'tauri://localhost'];

const SECRET = process.env.JWT_SECRET || (DEV_AUTH ? 'quarc-draw-dev-secret' : '');
if (!SECRET) {
  console.error('JWT_SECRET is not set. It must be the same secret quarc-auth and the other Quarc apps use (see .env.example).');
  process.exit(1);
}
if (DEV_AUTH) console.warn('QUARC_DEV_AUTH is on: anyone can sign in with password "dev". For local development only.');

fs.mkdirSync(DATA, { recursive: true });

// ---------------------------------------------------------------- the Quarc login (HS256 JWT)
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', SECRET).update(data).digest();

/** Verifies a login token; returns its claims or null. Only HS256 is accepted (never "none"). */
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    if (header.alg !== 'HS256') return null;
    const want = hmac(`${parts[0]}.${parts[1]}`);
    const got = Buffer.from(parts[2], 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (typeof claims.exp === 'number' && claims.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof claims.id !== 'string' || !claims.id) return null;
    return claims;
  } catch { return null; }
}
function signToken(claims, lifetimeSecs) {
  const iat = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...claims, iat, exp: iat + lifetimeSecs }));
  return `${head}.${body}.${b64u(hmac(`${head}.${body}`))}`;
}
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}
const cookieFlags = (maxAgeSecs) => `Path=/; HttpOnly; Max-Age=${maxAgeSecs}; ${SECURE_COOKIE ? 'SameSite=None; Secure' : 'SameSite=Lax'}`;

/** The signed-in account of a request (cookie, or "Authorization: Bearer <login>"), or null. */
function authUser(req) {
  const h = req.headers.authorization ?? '';
  return verifyToken(readCookie(req, 'token') || (h.startsWith('Bearer ') ? h.slice(7) : ''));
}

// Sliding session — the same rule as every Quarc backend's middleware/auth.js: a login past the halfway point of its
// life is re-issued with a full new window, so it effectively never runs out while the app is used. Clamped to
// 400 days (Chromium caps a cookie's Max-Age there).
const MAX_COOKIE_DAYS = 400;
function renewIfStale(res, claims) {
  if (!claims.iat || !claims.exp) return;
  const lifetime = claims.exp - claims.iat;
  const elapsed = Math.floor(Date.now() / 1000) - claims.iat;
  if (lifetime <= 0 || elapsed < lifetime / 2) return;
  const fresh = Math.min(lifetime, MAX_COOKIE_DAYS * 86400);
  const { iat, exp, ...rest } = claims;
  res.setHeader('Set-Cookie', `token=${signToken(rest, fresh)}; ${cookieFlags(fresh)}`);
}

// ---------------------------------------------------------------- per-account storage (keyed by the account id)
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const safeUserDir = (user) => path.join(DATA, 'users', sha(user).slice(0, 24));
const idOk = (id) => /^[A-Za-z0-9_-]{1,100}$/.test(id);
const indexes = new Map();
function loadIndex(user) {
  if (indexes.has(user)) return indexes.get(user);
  const dir = safeUserDir(user); fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  let idx = {};
  try { idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')); } catch { /* new user */ }
  indexes.set(user, idx);
  return idx;
}
function saveIndex(user) {
  const dir = safeUserDir(user);
  const tmp = path.join(dir, 'index.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(indexes.get(user)));
  fs.renameSync(tmp, path.join(dir, 'index.json'));
}
const docPath = (user, id) => path.join(safeUserDir(user), 'docs', id + '.qdraw');

// ---------------------------------------------------------------- SSE
const listeners = new Map(); // account id → Set<res>
function broadcast(user, origin) {
  for (const res of listeners.get(user) ?? []) res.write(`event: change\ndata: ${JSON.stringify({ origin, t: Date.now() })}\n\n`);
}

// ---------------------------------------------------------------- http helpers
/** Browsers may call this API with the login cookie from: this server's own host (any port), the apps' own pages, QUARC_ORIGINS. */
function originAllowed(origin, req) {
  if (!origin) return false;
  if (APP_ORIGINS.includes(origin) || EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const own = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return !!own && new URL(origin).hostname === own;
  } catch { return false; }
}
function cors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!originAllowed(origin, req)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Title, X-Modified, X-Base-Rev');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Rev, X-Modified');
}
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readJson = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => { s += c; if (s.length > 10_000) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch { resolve({}); } });
  req.on('error', () => resolve({}));
});
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json' };

function serveStatic(req, res, url) {
  if (!STATIC) return false;
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(STATIC, rel));
  if (!file.startsWith(STATIC)) { res.writeHead(403); res.end(); return true; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC, 'index.html'); // SPA fallback
  if (!fs.existsSync(file)) return false;
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' || path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------------------------------------------------------------- development-only login (QUARC_DEV_AUTH=1)
// Stands in for quarc-auth, which nginx serves at /api/auth/ in production. Never enabled there.
async function devAuth(req, res, url) {
  const me = authUser(req);
  if (url.pathname === '/api/auth/me' && req.method === 'GET') return me ? json(res, 200, { id: me.id, username: me.username, role: me.role }) : json(res, 401, { error: 'Not authenticated' });
  if (url.pathname === '/api/auth/logout' && req.method === 'POST') { res.setHeader('Set-Cookie', `token=; ${cookieFlags(0)}`); return json(res, 200, { ok: true }); }
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const { username, password } = await readJson(req);
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(String(username || '')) || password !== 'dev') return json(res, 401, { error: 'Invalid username or password (development login: password is "dev")' });
    const user = { id: `dev-${username}`, username, role: 'user' };
    res.setHeader('Set-Cookie', `token=${signToken(user, 86400)}; ${cookieFlags(86400)}`);
    return json(res, 200, user);
  }
  return json(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, app: 'quarc-draw' });
  if (DEV_AUTH && url.pathname.startsWith('/api/auth/')) return devAuth(req, res, url);
  if (!url.pathname.startsWith('/api/')) { if (serveStatic(req, res, url)) return; res.writeHead(404); return res.end('Not found'); }

  const claims = authUser(req);
  if (!claims) return json(res, 401, { error: 'Not authenticated' });
  renewIfStale(res, claims);
  const user = claims.id;
  const idx = loadIndex(user);

  if (url.pathname === '/api/ping') return json(res, 200, { ok: true, user: claims.username ?? user, app: 'quarc-draw', version: 2 });

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 4000\n\n');
    if (!listeners.has(user)) listeners.set(user, new Set());
    listeners.get(user).add(res);
    const hb = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(hb); listeners.get(user)?.delete(res); });
    return;
  }

  if (url.pathname === '/api/docs' && req.method === 'GET') {
    return json(res, 200, { docs: Object.entries(idx).map(([id, d]) => ({ id, title: d.title, modified: d.modified, rev: d.rev, size: d.size })) });
  }

  const m = url.pathname.match(/^\/api\/docs\/([^/]+)$/);
  if (!m) return json(res, 404, { error: 'not found' });
  const id = decodeURIComponent(m[1]);
  if (!idOk(id)) return json(res, 400, { error: 'bad id' });

  if (req.method === 'GET') {
    const d = idx[id];
    if (!d) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': d.size, 'X-Rev': d.rev, 'X-Modified': String(d.modified) });
    return fs.createReadStream(docPath(user, id)).pipe(res);
  }

  if (req.method === 'PUT') {
    const base = req.headers['x-base-rev'];
    const cur = idx[id];
    if (base && cur && base !== cur.rev) return json(res, 409, { error: 'conflict', rev: cur.rev });
    const tmp = docPath(user, id) + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    let size = 0, aborted = false;
    const out = fs.createWriteStream(tmp);
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BYTES && !aborted) {
        aborted = true; out.destroy(); fs.rm(tmp, () => {});
        res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end(JSON.stringify({ error: `Documents may be at most ${Math.round(MAX_BYTES / 1048576)} MB` }), () => req.destroy());
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      fs.renameSync(tmp, docPath(user, id));
      const n = cur ? parseInt(cur.rev, 10) + 1 : 1;
      const rev = `${n}.${crypto.randomBytes(3).toString('hex')}`;
      let title = id; try { title = decodeURIComponent(String(req.headers['x-title'] ?? id)); } catch { /* keep id */ }
      idx[id] = { title, modified: Number(req.headers['x-modified']) || Date.now(), rev, size };
      saveIndex(user);
      json(res, 200, { rev });
      broadcast(user, id);
    });
    out.on('error', () => { if (!res.headersSent) json(res, 500, { error: 'write failed' }); });
    return;
  }

  if (req.method === 'DELETE') {
    if (idx[id]) { delete idx[id]; saveIndex(user); fs.rm(docPath(user, id), () => {}); broadcast(user, id); }
    return json(res, 200, { ok: true });
  }
  json(res, 405, { error: 'method not allowed' });
});

server.listen(PORT, () => {
  console.log(`Quarc Draw server listening on http://localhost:${PORT}  (data: ${DATA})${STATIC ? `\nServing the app from ${STATIC}` : ''}`);
});
