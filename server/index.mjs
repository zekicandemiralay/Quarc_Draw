#!/usr/bin/env node
// Quarc Draw sync server — zero dependencies.
//
//   node server/index.mjs                      start on :8787 (creates a first access token on first run)
//   node server/index.mjs --new-token alice    add a user / print a new access token
//   node server/index.mjs --static dist        also serve the built web app from ./dist
//
// Environment: PORT, QUARC_DATA (data dir), QUARC_ORIGIN (CORS origin, default *), QUARC_MAX_MB (default 512)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? true : null; };

const PORT = Number(process.env.PORT || arg('--port') || 8787);
const DATA = path.resolve(process.env.QUARC_DATA || path.join(__dirname, 'data'));
const ORIGIN = process.env.QUARC_ORIGIN || '*';
const MAX_BYTES = Number(process.env.QUARC_MAX_MB || 512) * 1024 * 1024;
const STATIC = arg('--static') ? path.resolve(String(arg('--static'))) : process.env.QUARC_STATIC ? path.resolve(process.env.QUARC_STATIC) : null;

fs.mkdirSync(DATA, { recursive: true });
const TOKENS_FILE = path.join(DATA, 'tokens.json');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const loadTokens = () => { try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch { return {}; } };
const saveTokens = (t) => fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
function newToken(user) {
  const token = 'qd_' + crypto.randomBytes(24).toString('base64url');
  const t = loadTokens(); t[sha(token)] = { user, created: Date.now() }; saveTokens(t);
  return token;
}

if (arg('--new-token')) {
  const user = String(arg('--new-token'));
  console.log(`\nAccess token for “${user}” (shown once — store it safely):\n\n  ${newToken(user)}\n`);
  process.exit(0);
}
if (!Object.keys(loadTokens()).length) {
  const token = newToken('default');
  console.log(`\nFirst run — created an access token for user “default”:\n\n  ${token}\n\nPaste it into Quarc Draw ▸ File ▸ Sync settings ▸ Quarc server.\n`);
}

// ---------------------------------------------------------------- per-user storage
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
const listeners = new Map(); // user → Set<res>
function broadcast(user, origin) {
  for (const res of listeners.get(user) ?? []) res.write(`event: change\ndata: ${JSON.stringify({ origin, t: Date.now() })}\n\n`);
}

// ---------------------------------------------------------------- http helpers
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Title, X-Modified, X-Base-Rev');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'X-Rev, X-Modified');
  res.setHeader('Vary', 'Origin');
}
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
function authUser(req, url) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token') ?? '';
  if (!token) return null;
  const rec = loadTokens()[sha(token)];
  return rec ? rec.user : null;
}
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
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
  fs.createReadStream(file).pipe(res);
  return true;
}

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  cors(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (!url.pathname.startsWith('/api/')) { if (serveStatic(req, res, url)) return; res.writeHead(404); return res.end('Not found'); }

  const user = authUser(req, url);
  if (!user) return json(res, 401, { error: 'unauthorized' });
  const idx = loadIndex(user);

  if (url.pathname === '/api/ping') return json(res, 200, { ok: true, user, app: 'quarc-sync', version: 1 });

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
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
    req.on('data', (c) => { size += c.length; if (size > MAX_BYTES && !aborted) { aborted = true; out.destroy(); req.destroy(); fs.rm(tmp, () => {}); } });
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
  console.log(`Quarc sync server listening on http://localhost:${PORT}  (data: ${DATA})${STATIC ? `\nServing the app from ${STATIC}` : ''}`);
});
