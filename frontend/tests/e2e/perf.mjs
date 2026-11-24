// Performance probe: large canvas + many layers while painting. Prints frame-time stats (not a pass/fail test).
import { startServer, launch, Reporter, newPage } from './lib.mjs';
const srv = await startServer(); const browser = await launch();
const page = await newPage(browser, { width: 1600, height: 900 });
const rep = new Reporter(); rep.attach(page);
await page.goto(srv.url); await page.waitForSelector('.library');
await page.click('.new-tile'); await page.waitForSelector('.dialog');
await page.click('.preset:has-text("4K UHD")'); await page.fill('.dialog .input.num >> nth=0', '4000'); await page.fill('.dialog .input.num >> nth=1', '3000');
await page.click('.dialog-f .btn.primary'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(800);
const size = await page.evaluate(() => { const ed = window.__quarc.ed; return [ed.page.width, ed.page.height]; });
console.log('canvas', size.join('×'));
// add 6 more raster layers
for (let i = 0; i < 6; i++) await page.evaluate(() => { const ed = window.__quarc.ed; ed.ensureRasterTarget(); ed.setActiveLayer(null); ed.ensureRasterTarget(); });
const layers = await page.evaluate(() => window.__quarc.ed.page.layers.length);
const box = await page.locator('.viewport').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.evaluate(() => { const ed = window.__quarc.ed; ed.setBrushPreset('paint-oil'); ed.setBrush({ size: 120 }); });
await page.evaluate(() => { window.__frames = []; let last = performance.now(); const tick = () => { const n = performance.now(); window.__frames.push(n - last); last = n; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const t0 = Date.now();
await page.mouse.move(cx - 300, cy); await page.mouse.down();
for (let i = 0; i < 160; i++) await page.mouse.move(cx - 300 + i * 4, cy + Math.sin(i / 8) * 120);
await page.mouse.up();
const dt = Date.now() - t0;
await page.waitForTimeout(300);
const stats = await page.evaluate(() => { const f = window.__frames.slice(5).sort((a, b) => a - b); const p = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))]; return { frames: f.length, median: p(0.5), p95: p(0.95), max: f[f.length - 1] }; });
const commit = await page.evaluate(() => { const ed = window.__quarc.ed; return ed.history.items.at(-1)?.label; });
console.log(`layers ${layers}, 160 pointer moves in ${dt}ms → ${(dt / 160).toFixed(1)}ms per event`);
console.log('frame ms', JSON.stringify(stats), 'last history:', commit);
// zoom/pan responsiveness
const z0 = Date.now();
for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -120); }
await page.waitForTimeout(200);
console.log(`30 wheel-zoom events in ${Date.now() - z0}ms`);
rep.summary(); await browser.close(); srv.stop();
