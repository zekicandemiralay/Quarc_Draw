// Sync: self-hosted server + WebDAV provider, two devices, conflicts, deletions, auth failure.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { ROOT, SYNC_PORT, newPage } from './lib.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** tiny in-memory WebDAV server (PROPFIND/GET/PUT/DELETE/HEAD with ETags + CORS) */
function startWebDAV(port, user = 'u', pass = 'p') {
  const files = new Map(); let n = 1;
  const srv = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-Match', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, PROPFIND, HEAD, MKCOL, OPTIONS', 'Access-Control-Expose-Headers': 'ETag, Last-Modified' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.headers.authorization !== 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')) { res.writeHead(401, cors); return res.end(); }
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/dav\/?/, '');
    if (req.method === 'PROPFIND') {
      const items = [...files.entries()].map(([k, v]) => `<d:response><d:href>/dav/${encodeURIComponent(k)}</d:href><d:propstat><d:prop><d:getlastmodified>${new Date(v.t).toUTCString()}</d:getlastmodified><d:getcontentlength>${v.body.length}</d:getcontentlength><d:getetag>"${v.etag}"</d:getetag></d:prop></d:propstat></d:response>`).join('');
      res.writeHead(207, { ...cors, 'Content-Type': 'application/xml' }); return res.end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href></d:response>${req.headers.depth === '0' ? '' : items}</d:multistatus>`);
    }
    if (req.method === 'PUT') { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => { const cur = files.get(name); const im = req.headers['if-match']; if (im && cur && im !== `"${cur.etag}"`) { res.writeHead(412, { ...cors, ETag: `"${cur.etag}"` }); return res.end(); } const v = { body: Buffer.concat(chunks), etag: String(n++), t: Date.now() }; files.set(name, v); res.writeHead(201, { ...cors, ETag: `"${v.etag}"` }); res.end(); }); return; }
    if (req.method === 'GET' || req.method === 'HEAD') { const v = files.get(name); if (!v) { res.writeHead(404, cors); return res.end(); } res.writeHead(200, { ...cors, ETag: `"${v.etag}"`, 'Last-Modified': new Date(v.t).toUTCString(), 'Content-Length': v.body.length }); return res.end(req.method === 'GET' ? v.body : undefined); }
    if (req.method === 'DELETE') { files.delete(name); res.writeHead(204, cors); return res.end(); }
    res.writeHead(405, cors); res.end();
  });
  return new Promise((r) => srv.listen(port, () => r({ files, stop: () => srv.close() })));
}

export async function sync({ rep, assert, helpers: h, browser }) {
  const PORT = SYNC_PORT;
  const server = { stop() {} }; // the backend is started once for the whole suite (lib.mjs startServer)
  const signInCookie = async (password = 'dev') => { const r = await fetch(`http://localhost:${PORT}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'e2e', password }) }); return { status: r.status, cookie: (r.headers.getSetCookie?.()[0] || '').split(';')[0] }; };
  const session = await signInCookie();
  const api = async (p, init = {}) => fetch(`http://localhost:${PORT}${p}`, { ...init, headers: { Cookie: session.cookie, ...(init.headers || {}) } });
  const A = await newPage(browser), B = await newPage(browser);
  for (const p of [A, B]) p.on('pageerror', (e) => rep.errors.push('[sync pageerror] ' + e.message));
  const hook = (page, fn, arg) => page.evaluate(async ([f, a]) => { const x = (0, eval)('(' + f + ')'); return x(window.__quarc, a); }, [fn.toString(), arg]);
  const connect = async (page, password = 'dev') => {
    await page.goto(h.url); await page.waitForSelector('.library');
    await h.cmd(page, 'file.sync.settings'); await page.waitForSelector('.dialog');
    await page.click('.dialog .preset:has(b:text-is("Quarc account"))');
    await page.fill('.dialog .field:has(label:text-is("Username")) input', 'e2e');
    await page.fill('.dialog .field:has(label:text-is("Password")) input', password);
    await page.click('.dialog .btn.primary:has-text("Sign in")');
  };
  const pixelHash = (page) => page.evaluate(() => { const ed = window.__quarc.ed; const r = ed.page.layers.find((l) => l.type === 'raster'); const c = r.surface.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let hh = 0, n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) { n++; hh = (hh * 31 + d[i - 3] + d[i - 2] * 7) | 0; } return { hh, n }; });

  try {
    await rep.step('server needs the Quarc login: refused without it, answers ping with it', async () => {
      assert((await fetch(`http://localhost:${PORT}/api/ping`)).status === 401, '401 without a login');
      assert((await fetch(`http://localhost:${PORT}/api/ping`, { headers: { Cookie: 'token=nope' } })).status === 401, '401 for a bad login');
      assert(session.status === 200 && session.cookie.startsWith('token='), 'development login works');
      const r = await api('/api/ping'); assert(r.ok && (await r.json()).ok, 'ping ok');
    });

    await rep.step('device A: create a drawing and connect to the server', async () => {
      await connect(A);
      await A.waitForFunction(() => /Connected/.test(document.querySelector('.dialog-f')?.innerText || ''), null, { timeout: 8000 });
      await A.keyboard.press('Escape');
      await A.click('.new-tile'); await A.click('.dialog-f .btn.primary'); await A.waitForSelector('canvas.overlay'); await A.waitForTimeout(400);
      await hook(A, (q) => { const ed = q.ed; ed.doc.title = 'Shared sketch'; ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 80, hardness: 1, flow: 1, opacity: 1 }); ed.setFg('#7209b7'); });
      await h.stroke(A, [[-200, 0], [200, 30]], { steps: 8 });
    });

    await rep.step('autosave → background sync uploads the document to the server', async () => {
      for (let i = 0; i < 40; i++) { if (((await (await api('/api/docs')).json()).docs).length === 1) break; await sleep(500); }
      const docs = (await (await api('/api/docs')).json()).docs;
      assert(docs.length === 1 && docs[0].size > 1000, JSON.stringify(docs));
      const blob = await api(`/api/docs/${docs[0].id}`); const buf = Buffer.from(await blob.arrayBuffer());
      assert(buf[0] === 0x50 && buf[1] === 0x4b, 'server stores a zip (.qdraw)');
    });

    await rep.step('device B: connects and receives the document; content is identical', async () => {
      await connect(B);
      await B.waitForSelector('.doc-card', { timeout: 20000 });
      assert((await B.locator('.doc-card .t').first().innerText()) === 'Shared sketch', 'title synced');
      await B.keyboard.press('Escape'); await B.waitForTimeout(200);
      await B.locator('.doc-card').first().click(); await B.waitForSelector('canvas.overlay'); await B.waitForTimeout(800);
      const a = await pixelHash(A), b = await pixelHash(B);
      assert(a.n > 1000 && a.hh === b.hh && a.n === b.n, `pixels identical ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    });

    await rep.step('edits on B propagate back to A while A has the document open', async () => {
      await hook(B, (q) => { const ed = q.ed; ed.setFg('#06d6a0'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 60, hardness: 1, flow: 1, opacity: 1 }); });
      await h.stroke(B, [[-150, -100], [150, -90]], { steps: 8 });
      const bn = (await pixelHash(B)).n;
      await A.waitForFunction((n) => { const ed = window.__quarc.ed; const r = ed.page.layers.find((l) => l.type === 'raster'); const c = r.surface.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let k = 0; for (let i = 3; i < d.length; i += 4) if (d[i] === 255) k++; return k === n; }, bn, { timeout: 30000 });
      assert(true);
    });

    await rep.step('conflict: both sides edit offline → both versions are kept, nothing lost', async () => {
      await hook(A, (q) => { q.syncEngine.stop(); });
      await hook(B, (q) => { q.syncEngine.stop(); });
      await hook(A, (q) => { const ed = q.ed; ed.setFg('#ff006e'); ed.setBrush({ size: 40 }); });
      await h.stroke(A, [[-100, 120], [100, 130]]);
      await A.waitForTimeout(3500);
      await hook(B, (q) => { const ed = q.ed; ed.setFg('#3a86ff'); ed.setBrush({ size: 40 }); });
      await h.stroke(B, [[-100, -140], [100, -150]]);
      await B.waitForTimeout(3500);
      // B reconnects first and pushes; then A reconnects and must resolve the conflict
      await hook(B, (q) => q.syncEngine.start()); await B.waitForTimeout(3000);
      await hook(A, (q) => q.syncEngine.start()); await A.waitForTimeout(6000);
      const lib = await hook(A, async (q) => { const m = await import('/assets/' + 'x').catch(() => null); return null; });
      void lib;
      const titles = await A.evaluate(() => new Promise((res) => { const r = indexedDB.open('quarcdraw'); r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => res(q.result.map((m) => m.title)); }; }));
      assert(titles.length >= 2, `conflict copy exists: ${JSON.stringify(titles)}`);
      assert(titles.some((t) => /conflict/i.test(t)), `a conflict copy is named: ${JSON.stringify(titles)}`);
    });

    await rep.step('deleting on one device removes it from the server and trashes it on the other', async () => {
      const target = await hook(A, (q) => q.ed.doc.id);
      assert(((await (await api('/api/docs')).json()).docs).some((d) => d.id === target), 'target is on the server');
      await hook(B, async (q, id) => { await q.syncEngine.deleteEverywhere(id); }, target);
      await sleep(800);
      assert(!((await (await api('/api/docs')).json()).docs).some((d) => d.id === target), 'target removed from the server');
      await hook(A, (q) => q.syncEngine.syncAll(true)); await A.waitForTimeout(1500);
      const trashed = await A.evaluate(() => new Promise((res) => { const r = indexedDB.open('quarcdraw'); r.onsuccess = () => { const q = r.result.transaction('meta').objectStore('meta').getAll(); q.onsuccess = () => res(q.result.filter((m) => m.trashed).length); }; }));
      assert(trashed >= 1, `remote deletion moved the local copy to trash (${trashed})`);
    });

    await rep.step('a damaged document on the server is skipped and everything else still syncs', async () => {
      assert((await api('/api/docs/damaged_doc', { method: 'PUT', body: Buffer.from('this is not a zip'), headers: { 'X-Title': 'Damaged' } })).ok, 'planted a damaged document');
      await hook(A, (q) => q.syncEngine.syncAll(true)); await A.waitForTimeout(2500);
      const st = await hook(A, (q) => { const s = q.syncEngine.status.get(); return { state: s.state, message: s.message, log: s.log.map((l) => l.msg) }; });
      assert(st.state === 'idle', `the round still finished: ${JSON.stringify(st)}`);
      assert(/could not be synced/.test(st.message) && st.log.some((m) => /Skipped one document/.test(m)), `the skipped document is reported: ${JSON.stringify(st)}`);
      await api('/api/docs/damaged_doc', { method: 'DELETE' });
      await hook(A, (q) => q.syncEngine.syncAll(true)); await A.waitForTimeout(1500);
      assert((await hook(A, (q) => q.syncEngine.status.get().state)) === 'idle', 'back to normal once it is gone');
    });

    await rep.step('optimistic concurrency: stale base revision is rejected with 409', async () => {
      const put = (rev) => api('/api/docs/probe_doc', { method: 'PUT', body: Buffer.from('x'), headers: { 'X-Title': 'probe', ...(rev ? { 'X-Base-Rev': rev } : {}) } });
      const r1 = await put(); const { rev } = await r1.json();
      const r2 = await put(rev); assert(r2.status === 200, 'matching base rev accepted');
      const r3 = await put(rev); assert(r3.status === 409, `stale base rev rejected (${r3.status})`);
    });

    await rep.step('a wrong password shows a sign-in problem in the app and nothing syncs', async () => {
      const C = await newPage(browser);
      await connect(C, 'not-the-password');
      await C.waitForFunction(() => /Invalid username or password/i.test(document.querySelector('.dialog')?.innerText || ''), null, { timeout: 8000 });
      assert(!(await hook(C, (q) => q.syncEngine.connected)), 'not connected');
      await C.context().close();
    });

    await rep.step('signing out in the app stops syncing and asks to sign in again', async () => {
      const C = await newPage(browser);
      await connect(C);
      await C.waitForSelector('.dialog [data-testid="account-in"]', { timeout: 15000 }); // signed in; the first sync may still be running — sign out right away
      await C.click('.dialog [data-testid="account-in"] .btn:has-text("Sign out")');
      await C.waitForFunction(() => /Sign in with your Quarc account/.test(document.querySelector('.dialog-f')?.innerText || ''), null, { timeout: 8000 });
      assert(!(await hook(C, (q) => q.syncEngine.connected)), 'sync stopped');
      assert((await C.locator('.dialog [data-testid="account-out"]').count()) === 1, 'the sign-in form is back');
      await C.context().close();
    });

    await rep.step('WebDAV provider: connect, upload, download to a second device', async () => {
      const dav = await startWebDAV(8793);
      const davSetup = async (page) => {
        await page.goto(h.url); await page.waitForSelector('.library');
        await h.cmd(page, 'file.sync.settings'); await page.waitForSelector('.dialog');
        await page.click('.dialog .preset:has(b:text-is("WebDAV"))');
        await page.fill('.dialog input[placeholder^="https://cloud"]', 'http://localhost:8793/dav/');
        const inputs = page.locator('.dialog input.input'); // url, user, pass …
        await page.locator('.dialog .field:has(label:text-is("Username")) input').fill('u');
        await page.locator('.dialog .field:has(label:text-is("Password")) input').fill('p');
        await page.click('.dialog .btn.primary:has-text("Connect")');
        void inputs;
      };
      const D1 = await newPage(browser); await davSetup(D1);
      await D1.waitForFunction(() => /Connected/.test(document.querySelector('.dialog-f')?.innerText || ''), null, { timeout: 8000 });
      await D1.keyboard.press('Escape');
      await D1.click('.new-tile'); await D1.click('.dialog-f .btn.primary'); await D1.waitForSelector('canvas.overlay'); await D1.waitForTimeout(300);
      await hook(D1, (q) => { q.ed.doc.title = 'DAV doc'; q.ed.setFg('#f77f00'); });
      await h.stroke(D1, [[-100, 0], [100, 20]]);
      await D1.waitForFunction(() => true); await sleep(9000);
      assert(dav.files.size === 1, `WebDAV holds ${dav.files.size} file(s)`);
      const D2 = await newPage(browser); await davSetup(D2);
      await D2.waitForSelector('.doc-card', { timeout: 20000 });
      assert((await D2.locator('.doc-card .t').first().innerText()) === 'DAV doc', 'document arrived through WebDAV');
      await D1.context().close(); await D2.context().close(); dav.stop();
    });
  } finally {
    await A.context().close(); await B.context().close(); server.stop();
  }
}
