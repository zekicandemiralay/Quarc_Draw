// Frames per second while drawing. Layers are filled with real content, a pen stroke is driven from inside the page at a steady
// event rate, and the achieved frame cadence is measured (rAF intervals) — the number a person feels as "fluent" or "laggy".
//   node tests/e2e/perf-fps.mjs [cpuSlowdown=4]
// env: FIRST=1 (measure the very first stroke instead of one after a warm-up stroke), DOC (size preset text, default "2480 × 3508"), LAYERS (default 8), ZOOM (default 1), DPR (default 2), BRUSH, SECONDS (default 3), LEGACY=1 (repaint everything each frame)
import { startServer, launch, Reporter } from './lib.mjs';

const slowdown = Number(process.argv[2] || 4);
const env = { DOC: process.env.DOC || '2480 × 3508', LAYERS: Number(process.env.LAYERS ?? 8), ZOOM: Number(process.env.ZOOM ?? 1), DPR: Number(process.env.DPR ?? 2), BRUSH: process.env.BRUSH || 'pencil-hb', SECONDS: Number(process.env.SECONDS ?? 3) };
const srv = await startServer(); process.on('uncaughtException', (e) => { console.error(e.message); srv.stop(); process.exit(1); });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: env.DPR });
await ctx.addInitScript(() => { try { localStorage.setItem('quarcdraw.prefs.v1', JSON.stringify({ tutorialSeen: true })); } catch {} });
const page = await ctx.newPage();
const rep = new Reporter(); rep.attach(page);
const cdp = await ctx.newCDPSession(page);

await page.goto(srv.url); await page.waitForSelector('.library');
await page.click('.new-tile'); await page.waitForSelector('.dialog');
await page.click(`.preset:has-text("${env.DOC}")`);
await page.click('.dialog-f .btn.primary'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(800);
// layers with real pixels (random translucent shapes), the one we paint on is in the middle
const info = await page.evaluate(({ layers, zoom }) => {
  const ed = window.__quarc.ed;
  const W = ed.page.width, H = ed.page.height;
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ids = [];
  for (let i = 0; i < layers; i++) {
    ed.setActiveLayer(null); const l = ed.ensureRasterTarget(); const nl = ed.page.layers[ed.page.layers.length - 1]; ids.push(nl.id);
    const c = nl.surface.canvas.getContext('2d');
    for (let k = 0; k < 25; k++) { c.fillStyle = `hsla(${Math.round(rnd() * 360)},70%,55%,${0.25 + rnd() * 0.5})`; c.beginPath(); c.arc(rnd() * W, rnd() * H, 80 + rnd() * 500, 0, 7); c.fill(); }
    nl.surface.touch();
  }
  ed.changed('layers', 'doc');
  ed.setActiveLayer(ids[Math.floor(ids.length / 2)]);
  ed.zoomTo(zoom);
  return { page: [W, H], layers: ed.page.layers.length, dpr: devicePixelRatio, zoom: ed.view.zoom };
}, { layers: env.LAYERS, zoom: env.ZOOM });
console.log('doc', JSON.stringify(info), 'brush', env.BRUSH, 'cpu slowdown', slowdown, process.env.LEGACY ? '· LEGACY full repaint' : '');
await page.evaluate((id) => { const ed = window.__quarc.ed; ed.setBrushPreset(id); }, env.BRUSH);
if (process.env.LEGACY) await page.evaluate(() => { const r = window.__quarc.renderer; r.renderRect = () => false; });
// STUB=overlay,rect,status,brushmove: switch stages off to see what each one costs (diagnostics only)
for (const name of (process.env.STUB || '').split(',').filter(Boolean)) {
  await page.evaluate((name) => {
    const r = window.__quarc.renderer, ed = window.__quarc.ed;
    if (name === 'overlay') r.renderOverlay = () => {};
    if (name === 'trace') { window.__trace = []; for (const m of ['render', 'renderRect', 'renderOverlay']) { const f = r[m].bind(r); r[m] = (...a) => { const t = performance.now(); const x = f(...a); if (m !== 'renderOverlay') r.canvas.getContext('2d').getImageData(0, 0, 1, 1); if (window.__trace.length < 40) window.__trace.push(`${m}:${(performance.now() - t).toFixed(0)}`); return x; }; } }
    if (name === 'nocache') r.baseFor = () => null;
    if (name === 'rect') r.renderRect = () => true;
    if (name === 'status') { const c = ed.changed.bind(ed); ed.changed = (...t) => (t.length === 1 && t[0] === 'status' ? undefined : c(...t)); }
    if (name === 'brushmove') { const tool = ed.tool; tool.moveEnd = () => {}; }
  }, name);
}
await page.waitForTimeout(500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });

const strokeProbe = async ({ seconds }) => {
  // time the parts of a pen-up
  window.__pu = {};
  { const ed = window.__quarc.ed, t = ed.tool, w = (obj, name, key) => { const f = obj[name].bind(obj); obj[name] = (...a) => { const t0 = performance.now(); const r = f(...a); window.__pu[key] = (window.__pu[key] || 0) + performance.now() - t0; return r; }; };
    w(t, 'pointerUp', 'pointerUp (total)'); w(ed, 'commitRasterPatch', '  commitRasterPatch (history + events)'); w(ed.history, 'push', '    history.push'); w(ed, 'changed', '  changed() calls (sync listeners)'); }

  const el = document.querySelector('canvas.overlay'), box = document.querySelector('.viewport').getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  const mk = (type, x, y, p) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'pen', isPrimary: true, clientX: x, clientY: y, pressure: type === 'pointerup' ? 0 : p, buttons: type === 'pointerup' ? 0 : 1, button: 0 });
  const frames = []; let last = performance.now(), t0 = last, i = 0;
  const tDown0 = performance.now();
  el.dispatchEvent(mk('pointerdown', cx - 380, cy, 0.5));
  const downMs = performance.now() - tDown0;
  await new Promise((res) => {
    const tick = (now) => {
      frames.push(now - last); last = now;
      // two pen samples per frame (~120 Hz input on a 60 Hz screen), a wavy line sweeping left to right and back
      for (let k = 0; k < 2; k++) { const u = (i++ * 0.011); const x = cx + Math.sin(u) * 380, y = cy + Math.sin(u * 3.1) * 150; el.dispatchEvent(mk('pointermove', x, y, 0.3 + 0.5 * Math.abs(Math.sin(u * 2)))); }
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  { const st = window.__quarc.ed.tool.stroke; const w = (name, key) => { const f = st[name].bind(st); st[name] = (...a) => { const t0 = performance.now(); const r = f(...a); window.__pu[key] = (window.__pu[key] || 0) + performance.now() - t0; return r; }; };
    w('end', '    stroke.end'); w('commit', '    stroke.commit'); w('flush', '      (stroke.flush, inside the two above)'); const sf = st.o.surface; const gp = sf.snapshotRects.bind(sf); sf.snapshotRects = (r) => { const t0 = performance.now(); const x = gp(r); window.__pu['      snapshotRects (copy for undo)'] = (window.__pu['      snapshotRects (copy for undo)'] || 0) + performance.now() - t0; (window.__calls ||= []).push(`${(performance.now() - t0).toFixed(1)}ms for ${r.length} rects`); return x; }; }
  const tEnd = performance.now();
  el.dispatchEvent(mk('pointerup', cx, cy, 0));
  const commitMs = performance.now() - tEnd;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const settleMs = performance.now() - tEnd;
  const f = frames.slice(3).sort((a, b) => a - b), q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  const pu = Object.fromEntries(Object.entries(window.__pu).map(([k, v]) => [k, +v.toFixed(0)]));
  return { trace: window.__trace, downMs: +downMs.toFixed(0), firstFrames: frames.slice(0, 14).map((x) => Math.round(x)), calls: window.__calls, pu, fps: +(1000 / mean).toFixed(1), medianMs: +q(0.5).toFixed(1), p95Ms: +q(0.95).toFixed(1), worstMs: +f[f.length - 1].toFixed(0), frames: f.length, penUpMs: +commitMs.toFixed(0), settleMs: +settleMs.toFixed(0), dabsPixels: window.__quarc.ed.layer.surface.contentBounds()?.w };
};
// a short warm-up stroke first (the first stroke on a layer creates the big canvases; the ones after it reuse them), then the measured one
if (!process.env.FIRST) await page.evaluate(strokeProbe, { seconds: 0.8 });
const stats = await page.evaluate(strokeProbe, { seconds: env.SECONDS });
console.log(`  ${stats.fps} fps · frame median ${stats.medianMs} ms, p95 ${stats.p95Ms} ms, worst ${stats.worstMs} ms · pen-up: ${stats.penUpMs} ms in the handler, ${stats.settleMs} ms until the next frames are on screen`);
console.log('   getPatch calls:', (stats.calls || []).length, (stats.calls || []).slice(0, 14).join(' | '));
console.log(`   stroke start: ${stats.downMs} ms in the handler; first frames (ms): ${stats.firstFrames.join(' ')}`);
if (stats.trace) console.log('   first renders (ms, forced to finish):', stats.trace.join(' '));
for (const [k, v] of Object.entries(stats.pu)) console.log('   ' + String(v).padStart(5) + ' ms  ' + k);
rep.summary(); await browser.close(); srv.stop();
