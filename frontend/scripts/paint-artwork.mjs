// Paints a picture inside the real app (scripts/artwork/kit.js + scripts/artwork/<piece>.js) and saves it.
//   npm run build && node scripts/paint-artwork.mjs [--piece harbour-at-dusk|sunflowers|campfire-by-the-lake] [phase,phase,…] [--final] [--web] [--out <dir>]
// To redo only the last phases of a finished picture (minutes instead of the full run): --open <file.qdraw> --drop "Layer A,Layer B" removes
// those layers from the saved picture and the phases listed then paint on top again (the random strokes differ from a full run).
// Every phase of the piece runs by default; a downscaled preview of the canvas is written after each one. With --final the
// finished picture is exported through the app's own Export dialog: <out>/<piece>.qdraw (the layered project) and
// <out>/<piece>.png (full size). --web also writes <out>/<piece>.webp (1920 px on the long side) — the copy the app shows on its
// home screen and in the About box (it goes to frontend/public/art/ and into src/ui/paintings.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launch, Reporter } from '../tests/e2e/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const piece = val('--piece', 'harbour-at-dusk');
const phaseArg = args.find((a, i) => !a.startsWith('--') && !['--piece', '--out', '--open', '--drop'].includes(args[i - 1]));
const out = path.resolve(val('--out', path.join(here, '../../art')));
const previews = path.join(out, '.previews');
fs.mkdirSync(previews, { recursive: true });

const srv = await startServer();
process.on('uncaughtException', (e) => { console.error(e); srv.stop(); process.exit(1); });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 3000, height: 1700 }, deviceScaleFactor: 1, acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem('quarcdraw.prefs.v1', JSON.stringify({ tutorialSeen: true, rightDock: false, leftSidebar: false, showRulers: false })); } catch {} });
const page = await ctx.newPage();
const rep = new Reporter(); rep.attach(page);

await page.goto(srv.url); await page.waitForSelector('.library');
// the painter and the piece are loaded into the app's page (no reload follows: the app is a single page)
await page.addScriptTag({ path: path.join(here, 'artwork/kit.js') });
await page.addScriptTag({ path: path.join(here, `artwork/${piece}.js`) });
const meta = await page.evaluate(() => { const p = window.Painter; return { title: p.title, file: p.file, width: p.width, height: p.height, phases: p.phases, crops: p.crops || [] }; });
const W = meta.width, H = meta.height;
// room for the whole canvas near 1:1, so the pen lands where it means to
await page.setViewportSize({ width: 3000, height: Math.max(1700, Math.round(H * 1.02) + 140) });
const phases = phaseArg ? phaseArg.split(',') : meta.phases;
if (val('--open', null)) {
  // continue a saved picture: open it through the app's own Open command, then take the layers that are to be repainted off the top
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => window.__quarc.run('file.open'));
  await (await chooser).setFiles(path.resolve(val('--open', null)));
  await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(2500);
  for (const name of val('--drop', '').split(',').map((n) => n.trim()).filter(Boolean)) {
    const found = await page.evaluate((n) => { const e = window.__quarc.ed, l = e.page.layers.find((x) => x.name === n); if (!l) return false; e.setActiveLayer(l.id); window.__quarc.run('layer.delete'); return true; }, name);
    console.log(found ? '  dropped layer' : '  NO SUCH LAYER', name);
  }
  console.log('layers now:', JSON.stringify(await page.evaluate(() => window.__quarc.ed.page.layers.map((l) => l.name))));
} else {
  await page.click('.new-tile'); await page.waitForSelector('.dialog');
  await page.fill('.dialog .input >> nth=0', meta.title);
  await page.fill('.dialog .input.num >> nth=0', String(W)); await page.fill('.dialog .input.num >> nth=1', String(H));
  await page.click('.dialog-f .btn.primary'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(800);
}
await page.evaluate(() => { window.__quarc.ed.fitPage(); });
const dims = await page.evaluate(() => ({ w: window.__quarc.ed.page.width, h: window.__quarc.ed.page.height, zoom: window.__quarc.ed.view.zoom }));
console.log('canvas', JSON.stringify(dims));

const preview = async (name) => {
  const b64 = await page.evaluate(() => {
    const ed = window.__quarc.ed, c = document.querySelector('.viewport canvas:not(.overlay)'), pm = ed.view.pageMatrix(ed.page);
    const o = document.createElement('canvas'); const k = 1400 / Math.max(ed.page.width, ed.page.height) * (ed.page.width >= ed.page.height ? 1600 / 1400 : 1); o.width = Math.round(ed.page.width * k); o.height = Math.round(ed.page.height * k);
    o.getContext('2d').drawImage(c, pm.e, pm.f, ed.page.width * pm.a, ed.page.height * pm.d, 0, 0, o.width, o.height);
    return o.toDataURL('image/jpeg', 0.88).split(',')[1];
  });
  fs.writeFileSync(path.join(previews, `${meta.file}-${name}.jpg`), Buffer.from(b64, 'base64'));
};

/** a 1:1 crop of the canvas (page coordinates), to judge the brushwork at full size */
const crop = async (name, x, y, w, h) => {
  const b64 = await page.evaluate(([x, y, w, h]) => {
    const ed = window.__quarc.ed, c = document.querySelector('.viewport canvas:not(.overlay)'), pm = ed.view.pageMatrix(ed.page);
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, pm.e + x * pm.a, pm.f + y * pm.d, w * pm.a, h * pm.d, 0, 0, w, h);
    return o.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, [x, y, w, h]);
  fs.writeFileSync(path.join(previews, `${meta.file}-${name}.jpg`), Buffer.from(b64, 'base64'));
};

for (const ph of phases) {
  const t0 = Date.now();
  await page.evaluate((p) => window.Painter.run[p](), ph);
  await page.waitForTimeout(400);
  await preview(ph);
  console.log(`  ${ph.padEnd(7)} ${((Date.now() - t0) / 1000).toFixed(0)} s   strokes so far: ${await page.evaluate(() => window.__quarc.ed.history.items.length)}`);
}

for (const c of meta.crops) await crop(...c);

if (flag('--final')) {
  const exportAs = async (label, file, tweak) => {
    await page.evaluate(() => window.__quarc.run('file.export')); await page.waitForSelector('.dialog');
    await page.click(`.dialog .preset:has(b:text-is("${label}"))`);
    if (tweak) await tweak();
    const dl = page.waitForEvent('download');
    await page.click('.dialog-f .btn.primary');
    const d = await dl; await d.saveAs(path.join(out, file));
    await page.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 10000 }).catch(() => {});
    console.log('  saved', file, (fs.statSync(path.join(out, file)).size / 1024).toFixed(0) + ' KB');
  };
  const setSlider = (label, v) => page.evaluate(([label, v]) => {
    const row = [...document.querySelectorAll('.dialog .slider-row')].find((r) => r.querySelector('label')?.textContent === label);
    const input = row.querySelector('input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, String(v)); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, [label, v]);
  await exportAs('PNG', `${meta.file}.png`);
  await exportAs('Quarc Draw', `${meta.file}.qdraw`);
  if (flag('--web')) await exportAs('WebP', `${meta.file}.webp`, async () => { await setSlider('Scale', 1920 / Math.max(W, H)); await setSlider('Quality', 0.8); });
}

rep.summary(); await browser.close(); srv.stop();
