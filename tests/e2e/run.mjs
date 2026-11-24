// End-to-end suite: drives the production build in a real browser (Edge/Chrome).
//   node tests/e2e/run.mjs [studio|notes|reader|io|sync ...]
import { startServer, launch, Reporter, shot as shotRaw, newPage } from './lib.mjs';

const only = process.argv.slice(2);
const want = (n) => !only.length || only.includes(n);
const srv = await startServer();
const browser = await launch();
const rep = new Reporter();

const helpers = {
  url: srv.url,
  ev: (page, fn, arg) => page.evaluate(([f, a]) => { const fn = (0, eval)('(' + f + ')'); return fn(window.__quarc.ed, a); }, [fn.toString(), arg]),
  cmd: async (page, id) => { await page.evaluate((i) => window.__quarc.run(i), id); await page.waitForTimeout(120); },
  pixels: (page) => page.evaluate(() => { const ed = window.__quarc.ed; const l = ed.layer; const c = l && l.type === 'raster' ? l.surface.peek() : null; if (!c) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; }),
  center: async (page) => { const b = await page.locator('.viewport').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; },
  async stroke(page, pts, o = {}) {
    const c = await this.center(page);
    await page.mouse.move(c.x + pts[0][0], c.y + pts[0][1]); await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(c.x + p[0], c.y + p[1], { steps: o.steps ?? 8 });
    await page.mouse.up(); await page.waitForTimeout(150);
  },
  async drag(page, a, b, steps = 8) {
    const c = await this.center(page);
    await page.mouse.move(c.x + a[0], c.y + a[1]); await page.mouse.down();
    await page.mouse.move(c.x + b[0], c.y + b[1], { steps }); await page.mouse.up(); await page.waitForTimeout(150);
  },
  async click(page, p) { const c = await this.center(page); await page.mouse.click(c.x + p[0], c.y + p[1]); await page.waitForTimeout(450); },
  /** pen-style stroke with pressure, dispatched as real PointerEvents on the overlay canvas */
  async pen(page, pts, o = {}) {
    const c = await this.center(page);
    await page.evaluate(async ([cx, cy, pts, o]) => {
      const el = document.querySelector('canvas.overlay');
      const mk = (type, x, y, p) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 77, pointerType: 'pen', isPrimary: true, clientX: cx + x, clientY: cy + y, pressure: type === 'pointerup' ? 0 : p, buttons: type === 'pointerup' ? 0 : 1, button: 0 });
      el.dispatchEvent(mk('pointerdown', pts[0][0], pts[0][1], 0.3));
      for (let i = 1; i < pts.length; i++) { el.dispatchEvent(mk('pointermove', pts[i][0], pts[i][1], 0.2 + 0.8 * Math.sin((i / pts.length) * Math.PI))); await new Promise((r) => setTimeout(r, 4)); }
      if (o.hold) await new Promise((r) => setTimeout(r, o.hold));
      const l = pts[pts.length - 1]; el.dispatchEvent(mk('pointerup', l[0], l[1], 0));
    }, [c.x, c.y, pts, o]);
    await page.waitForTimeout(200);
  },
  reset: (page) => page.evaluate(() => { const ed = window.__quarc.ed; ed.tool.cancel(); ed.page.layers.length = 0; ed.activeLayerId = null; ed.objSel = []; ed.selection.clear(); ed.overlays = []; ed.history.clear(); ed.setStatus(''); ed.changed('doc','layers','objsel','selection'); }),
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

async function group(name, mod) {
  if (!want(name)) return;
  console.log(`\n▶ ${name}`);
  const page = await newPage(browser);
  rep.attach(page);
  const ctx = { page, rep, assert, helpers, srv, browser, shot: (n) => shotRaw(page, n) };
  try { const m = await import(`./${mod}.mjs`); await m[name](ctx); } catch (e) { rep.results.push({ name: `${name} (setup)`, ok: false, err: e.message }); console.log('  ✗ group failed:', e.message); }
  await page.context().close();
}

await group('studio', 'studio');
await group('notes', 'notes');
await group('reader', 'reader');
await group('io', 'io');
await group('sync', 'sync');
await group('render', 'render');
await group('ui', 'ui');

const ok = rep.summary();
await browser.close(); srv.stop();
process.exit(ok ? 0 : 1);
