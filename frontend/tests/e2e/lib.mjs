// Shared helpers for the browser end-to-end tests (Playwright driving the installed Edge/Chrome).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'tests/e2e/out');
/** the sync test starts the backend here; the preview server forwards /api to it */
export const SYNC_PORT = 8791;
fs.mkdirSync(OUT, { recursive: true });

const waitPort = (port, ms = 20000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const tick = () => {
    const r = http.get({ host: '127.0.0.1', port, path: '/' }, () => { r.destroy(); res(); });
    r.on('error', () => (Date.now() - t0 > ms ? rej(new Error('server did not start')) : setTimeout(tick, 250)));
  };
  tick();
});

export async function startServer(port = 4173) {
  // The Quarc Draw backend (development login) runs for the whole suite; the preview server forwards /api to it.
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'quarc-draw-e2e-'));
  const backend = spawn(process.execPath, [path.join(ROOT, '../backend/src/index.mjs')], { env: { ...process.env, PORT: String(SYNC_PORT), QUARC_DATA: data, QUARC_DEV_AUTH: '1', JWT_SECRET: '' }, stdio: process.env.E2E_DEBUG ? ['ignore', 'inherit', 'inherit'] : 'ignore' });
  await waitPort(SYNC_PORT);
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, QUARC_API_PROXY: `http://localhost:${SYNC_PORT}` } });
  await waitPort(port);
  return { url: `http://localhost:${port}`, stop: () => { p.kill(); backend.kill(); setTimeout(() => fs.rmSync(data, { recursive: true, force: true }), 300); } };
}

export async function launch() {
  const candidates = [
    { channel: 'msedge' }, { channel: 'chrome' },
    { executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
    { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  ];
  let lastErr;
  for (const c of candidates) {
    try { return await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--disable-dev-shm-usage'], ...c }); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export class Reporter {
  constructor() { this.results = []; this.errors = []; }
  attach(page) {
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // a signed-out page asking "who am I?" gets a 401 — that is the normal answer, not an error
      if ((m.location()?.url || '').endsWith('/api/auth/me') && /status of 401/.test(m.text())) return;
      this.errors.push(`[console.error] ${m.text()}`);
    });
    page.on('pageerror', (e) => this.errors.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  }
  async step(name, fn) {
    const t = Date.now();
    try { await fn(); this.results.push({ name, ok: true, ms: Date.now() - t }); console.log(`  ✓ ${name} (${Date.now() - t}ms)`); }
    catch (e) { this.results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
  }
  summary() {
    const bad = this.results.filter((r) => !r.ok);
    console.log(`\n${this.results.length - bad.length}/${this.results.length} steps passed`);
    if (this.errors.length) { console.log(`\n${this.errors.length} browser error(s):`); [...new Set(this.errors)].slice(0, 15).forEach((e) => console.log('  ' + e)); }
    return bad.length === 0 && this.errors.length === 0;
  }
}
export const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });

/** new browser context with the first-run tour dismissed */
export async function newPage(browser, viewport = { width: 1480, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('quarcdraw.prefs.v1')) localStorage.setItem('quarcdraw.prefs.v1', JSON.stringify({ tutorialSeen: true })); } catch {} });
  return ctx.newPage();
}
