// Quarc Draw sync server: the Quarc login, per-account storage, optimistic concurrency, CORS and live updates.
//   node --test test/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/index.mjs');
const SECRET = 'test-secret-shared-with-quarc-auth';

const b64u = (x) => Buffer.from(x).toString('base64url');
/** a login exactly like quarc-auth issues: HS256, claims id/username/role/sid */
function login(user, { secret = SECRET, alg = 'HS256', iat = Math.floor(Date.now() / 1000), life = 3600, noExp = false } = {}) {
  const head = b64u(JSON.stringify({ alg, typ: 'JWT' }));
  const claims = { id: user.id, username: user.username, role: 'user', sid: 's1', iat, ...(noExp ? {} : { exp: iat + life }) };
  const body = b64u(JSON.stringify(claims));
  const sig = alg === 'none' ? '' : crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const alice = { id: 'a11ce000-0000-4000-8000-000000000001', username: 'alice' };
const bob = { id: 'b0b00000-0000-4000-8000-000000000002', username: 'bob' };
const cookie = (t) => ({ Cookie: `token=${t}` });

function start(env = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-draw-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), QUARC_DATA: data, JWT_SECRET: SECRET, QUARC_MAX_MB: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let out = '';
    p.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve({ port, base: `http://localhost:${port}`, data, stop: () => { p.kill(); fs.rmSync(data, { recursive: true, force: true }); }, exited: new Promise((r) => p.on('exit', (code) => r({ code, out }))) }); });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', reject);
    p.on('exit', (code) => { if (!out.includes('listening')) reject(new Error(`server exited ${code}: ${out}`)); });
    setTimeout(() => reject(new Error('start timeout: ' + out)), 8000);
  });
}

let s;
before(async () => { s = await start(); });
after(() => s.stop());

const put = (t, id, body, headers = {}) => fetch(`${s.base}/api/docs/${id}`, { method: 'PUT', body, headers: { ...cookie(t), 'X-Title': encodeURIComponent('My drawing'), ...headers } });

test('refuses to start without JWT_SECRET', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-draw-nosecret-'));
  const env = { ...process.env, QUARC_DATA: data, PORT: '0' }; delete env.JWT_SECRET; delete env.QUARC_DEV_AUTH;
  const p = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = ''; p.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((r) => p.on('exit', r));
  fs.rmSync(data, { recursive: true, force: true });
  assert.notEqual(code, 0);
  assert.match(err, /JWT_SECRET/);
});

test('the Quarc login: cookie or bearer, signature and expiry are checked, "none" is refused', async () => {
  const ping = (headers) => fetch(`${s.base}/api/ping`, { headers });
  assert.equal((await ping({})).status, 401, 'no login');
  assert.equal((await ping(cookie('garbage'))).status, 401, 'not a token');
  assert.equal((await ping(cookie(login(alice, { secret: 'someone-elses-secret' })))).status, 401, 'wrong secret');
  assert.equal((await ping(cookie(login(alice, { alg: 'none' })))).status, 401, 'alg none');
  assert.equal((await ping(cookie(login(alice, { iat: 1000, life: 10 })))).status, 401, 'expired');
  const ok = await ping(cookie(login(alice)));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, user: 'alice', app: 'quarc-draw', version: 2 });
  assert.equal((await ping({ Authorization: `Bearer ${login(alice)}` })).status, 200, 'bearer works too');
  assert.equal((await fetch(`${s.base}/api/ping?token=${login(alice)}`)).status, 401, 'a token in the URL is not accepted any more');
});

test('health needs no login and the development login does not exist here', async () => {
  assert.equal((await fetch(`${s.base}/api/health`)).status, 200);
  const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 401, '/api/auth/* is quarc-auth\'s job (nginx); here it is just an API path that needs a login');
});

test('documents: upload, list, download, revision numbers, optimistic concurrency, delete', async () => {
  const t = login(alice);
  const r1 = await put(t, 'doc1', Buffer.from('first version'), { 'X-Modified': '1700000000000' });
  assert.equal(r1.status, 200);
  const { rev: rev1 } = await r1.json();
  assert.match(rev1, /^1\./);

  const list = await (await fetch(`${s.base}/api/docs`, { headers: cookie(t) })).json();
  assert.deepEqual(list.docs, [{ id: 'doc1', title: 'My drawing', modified: 1700000000000, rev: rev1, size: 13 }]);

  const got = await fetch(`${s.base}/api/docs/doc1`, { headers: cookie(t) });
  assert.equal(await got.text(), 'first version');
  assert.equal(got.headers.get('x-rev'), rev1);
  assert.equal(got.headers.get('x-modified'), '1700000000000');

  const r2 = await put(t, 'doc1', Buffer.from('second'), { 'X-Base-Rev': rev1 });
  const { rev: rev2 } = await r2.json();
  assert.match(rev2, /^2\./); assert.notEqual(rev2, rev1);

  const stale = await put(t, 'doc1', Buffer.from('from a device that missed the update'), { 'X-Base-Rev': rev1 });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), { error: 'conflict', rev: rev2 });
  assert.equal(await (await fetch(`${s.base}/api/docs/doc1`, { headers: cookie(t) })).text(), 'second', 'a refused upload changes nothing');

  assert.equal((await fetch(`${s.base}/api/docs/doc1`, { method: 'DELETE', headers: cookie(t) })).status, 200);
  assert.equal((await fetch(`${s.base}/api/docs/doc1`, { headers: cookie(t) })).status, 404);
  assert.deepEqual((await (await fetch(`${s.base}/api/docs`, { headers: cookie(t) })).json()).docs, []);
});

test('document ids are validated', async () => {
  const t = login(alice);
  for (const bad of ['..%2F..%2Fetc', 'a.b', 'x'.repeat(101), '%00']) {
    const r = await fetch(`${s.base}/api/docs/${bad}`, { headers: cookie(t) });
    assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
  }
});

test('every account has its own documents', async () => {
  await put(login(alice), 'private', Buffer.from('alice only'));
  assert.equal((await fetch(`${s.base}/api/docs/private`, { headers: cookie(login(bob)) })).status, 404);
  assert.deepEqual((await (await fetch(`${s.base}/api/docs`, { headers: cookie(login(bob)) })).json()).docs, []);
  assert.equal((await (await fetch(`${s.base}/api/docs/private`, { headers: cookie(login(alice)) })).text()), 'alice only');
  // the same account signed in elsewhere (another session/device, other username claim) sees the same documents: storage is keyed by the account id
  const again = login({ id: alice.id, username: 'alice-renamed' });
  assert.equal((await (await fetch(`${s.base}/api/docs/private`, { headers: cookie(again) })).text()), 'alice only');
});

test('documents above the size limit are refused with 413 and nothing is stored', async () => {
  const big = Buffer.alloc(1.5 * 1024 * 1024, 1); // limit is 1 MB in these tests
  let status = 0;
  try { status = (await put(login(bob), 'huge', big)).status; } catch { status = 413; /* connection closed by the server after answering */ }
  assert.equal(status, 413);
  assert.equal((await fetch(`${s.base}/api/docs/huge`, { headers: cookie(login(bob)) })).status, 404);
  const leftovers = fs.readdirSync(path.join(s.data, 'users')).flatMap((u) => fs.readdirSync(path.join(s.data, 'users', u, 'docs'))).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('CORS: the login cookie may be used from this host, the apps and listed origins; not from strangers', async () => {
  const ask = (origin, method = 'OPTIONS') => fetch(`${s.base}/api/docs`, { method, headers: { Origin: origin, ...(method === 'GET' ? cookie(login(alice)) : { 'Access-Control-Request-Method': 'PUT' }) } });
  for (const ok of [`http://localhost:4173`, 'https://localhost', 'capacitor://localhost', 'http://tauri.localhost', 'https://tauri.localhost']) {
    const r = await ask(ok);
    assert.equal(r.headers.get('access-control-allow-origin'), ok, ok);
    assert.equal(r.headers.get('access-control-allow-credentials'), 'true', ok);
  }
  for (const bad of ['https://evil.example', 'http://localhost.evil.example', 'null']) {
    assert.equal((await ask(bad)).headers.get('access-control-allow-origin'), null, bad);
  }
  const r = await ask('http://localhost:4173', 'GET');
  assert.match(r.headers.get('access-control-expose-headers'), /X-Rev/);
  assert.equal(r.headers.get('vary'), 'Origin');
  assert.equal((await ask('http://localhost:4173')).status, 204);
});

test('QUARC_ORIGINS adds an allowed origin', async () => {
  const s2 = await start({ QUARC_ORIGINS: 'https://quarcnet0.example:4009, https://other.example' });
  try {
    for (const o of ['https://quarcnet0.example:4009', 'https://other.example']) {
      const r = await fetch(`${s2.base}/api/docs`, { method: 'OPTIONS', headers: { Origin: o } });
      assert.equal(r.headers.get('access-control-allow-origin'), o);
    }
  } finally { s2.stop(); }
});

test('a login past the halfway point of its life is renewed (same rule as every Quarc backend); a fresh one is not', async () => {
  const now = Math.floor(Date.now() / 1000);
  const old = login(alice, { iat: now - 3000, life: 3600 }); // 3000 of 3600 s used
  const r = await fetch(`${s.base}/api/ping`, { headers: cookie(old) });
  const set = r.headers.get('set-cookie');
  assert.ok(set && set.startsWith('token='), 'renewed');
  assert.match(set, /HttpOnly/); assert.match(set, /Path=\//);
  assert.match(set, /SameSite=Lax/, 'SECURE_COOKIE is off in these tests');
  const fresh = set.split(';')[0].slice('token='.length);
  const claims = JSON.parse(Buffer.from(fresh.split('.')[1], 'base64url').toString());
  assert.equal(claims.id, alice.id); assert.equal(claims.username, 'alice'); assert.equal(claims.sid, 's1');
  assert.equal(claims.exp - claims.iat, 3600, 'same lifetime again');
  assert.equal((await fetch(`${s.base}/api/ping`, { headers: cookie(fresh) })).status, 200, 'the renewed login works');
  assert.equal((await fetch(`${s.base}/api/ping`, { headers: cookie(login(alice)) })).headers.get('set-cookie'), null, 'a fresh login is left alone');

  const s2 = await start({ SECURE_COOKIE: 'true' });
  try {
    const r2 = await fetch(`${s2.base}/api/ping`, { headers: cookie(old) });
    assert.match(r2.headers.get('set-cookie'), /SameSite=None; Secure/);
  } finally { s2.stop(); }
});

test('live updates: /api/events needs the login and announces changes of the same account only', async () => {
  assert.equal((await fetch(`${s.base}/api/events`)).status, 401);
  const open = async (user) => {
    const ctl = new AbortController();
    const res = await fetch(`${s.base}/api/events`, { headers: cookie(login(user)), signal: ctl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader(); const dec = new TextDecoder(); const box = { text: '' };
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; box.text += dec.decode(value); } } catch { /* aborted */ } })();
    return { box, close: () => ctl.abort() };
  };
  const a = await open(alice), b = await open(bob);
  await new Promise((r) => setTimeout(r, 150));
  await put(login(alice), 'live', Buffer.from('x'));
  for (let i = 0; i < 30 && !a.box.text.includes('event: change'); i++) await new Promise((r) => setTimeout(r, 50));
  assert.match(a.box.text, /event: change\ndata: \{"origin":"live"/);
  assert.doesNotMatch(b.box.text, /event: change/, 'bob is not told about alice\'s documents');
  a.close(); b.close();
});

test('development login (--dev-auth): sign in with password "dev", /me, sign out', async () => {
  const d = await start({ QUARC_DEV_AUTH: '1', JWT_SECRET: '' });
  try {
    assert.equal((await fetch(`${d.base}/api/auth/me`)).status, 401);
    const bad = await fetch(`${d.base}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'zed', password: 'nope' }) });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${d.base}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'zed', password: 'dev' }) });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { id: 'dev-zed', username: 'zed', role: 'user' });
    const token = ok.headers.get('set-cookie').split(';')[0].slice('token='.length);
    const me = await fetch(`${d.base}/api/auth/me`, { headers: cookie(token) });
    assert.equal((await me.json()).username, 'zed');
    assert.equal((await fetch(`${d.base}/api/ping`, { headers: cookie(token) })).status, 200, 'the dev login is accepted by the API');
    const out = await fetch(`${d.base}/api/auth/logout`, { method: 'POST', headers: cookie(token) });
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  } finally { d.stop(); }
});
