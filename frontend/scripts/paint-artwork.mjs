// Paints "Harbour at Dusk" inside the real app (see scripts/artwork/painter.js) and saves it.
//   npm run build && node scripts/paint-artwork.mjs [phase,phase,…] [--final] [--out <dir>]
// Phases: sky, clouds, sun, land, sea, boat, rocks, glaze (default: all). A downscaled preview of the canvas is written
// after every phase. With --final the finished picture is exported through the app's own Export dialog:
//   <out>/harbour-at-dusk.qdraw  the layered project      <out>/harbour-at-dusk.png  full size 2560 × 1440
//   <out>/hero.webp              1920 × 1080 for the app's home screen and About box
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launch, Reporter } from '../tests/e2e/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ALL = ['sky', 'clouds', 'sun', 'land', 'sea', 'boat', 'rocks', 'glaze'];
const phases = (args.find((a) => !a.startsWith('--') && ALL.includes(a.split(',')[0])) || ALL.join(',')).split(',');
const out = path.resolve(val('--out', path.join(here, '../../art')));
const previews = path.join(out, '.previews');
fs.mkdirSync(previews, { recursive: true });
const W = 2560, H = 1440;

const srv = await startServer();
process.on('uncaughtException', (e) => { console.error(e); srv.stop(); process.exit(1); });
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 3000, height: 1700 }, deviceScaleFactor: 1, acceptDownloads: true });
await ctx.addInitScript(() => { try { localStorage.setItem('quarcdraw.prefs.v1', JSON.stringify({ tutorialSeen: true, rightDock: false, leftSidebar: false, showRulers: false })); } catch {} });
const page = await ctx.newPage();
const rep = new Reporter(); rep.attach(page);

await page.goto(srv.url); await page.waitForSelector('.library');
await page.click('.new-tile'); await page.waitForSelector('.dialog');
await page.fill('.dialog .input >> nth=0', 'Harbour at Dusk');
await page.fill('.dialog .input.num >> nth=0', String(W)); await page.fill('.dialog .input.num >> nth=1', String(H));
await page.click('.dialog-f .btn.primary'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(800);
await page.evaluate(() => { window.__quarc.ed.fitPage(); });
await page.addScriptTag({ path: path.join(here, 'artwork/painter.js') });
const dims = await page.evaluate(() => ({ w: window.__quarc.ed.page.width, h: window.__quarc.ed.page.height, zoom: window.__quarc.ed.view.zoom }));
console.log('canvas', JSON.stringify(dims));

const preview = async (name) => {
  const b64 = await page.evaluate(() => {
    const ed = window.__quarc.ed, c = document.querySelector('.viewport canvas:not(.overlay)'), pm = ed.view.pageMatrix(ed.page);
    const o = document.createElement('canvas'); o.width = 1600; o.height = Math.round(1600 * ed.page.height / ed.page.width);
    o.getContext('2d').drawImage(c, pm.e, pm.f, ed.page.width * pm.a, ed.page.height * pm.d, 0, 0, o.width, o.height);
    return o.toDataURL('image/jpeg', 0.88).split(',')[1];
  });
  fs.writeFileSync(path.join(previews, `${name}.jpg`), Buffer.from(b64, 'base64'));
};

/** a 1:1 crop of the canvas (page coordinates), to judge the brushwork at full size */
const crop = async (name, x, y, w, h) => {
  const b64 = await page.evaluate(([x, y, w, h]) => {
    const ed = window.__quarc.ed, c = document.querySelector('.viewport canvas:not(.overlay)'), pm = ed.view.pageMatrix(ed.page);
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    o.getContext('2d').drawImage(c, pm.e + x * pm.a, pm.f + y * pm.d, w * pm.a, h * pm.d, 0, 0, w, h);
    return o.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, [x, y, w, h]);
  fs.writeFileSync(path.join(previews, `${name}.jpg`), Buffer.from(b64, 'base64'));
};

for (const ph of phases) {
  const t0 = Date.now();
  await page.evaluate((p) => window.Painter[p](), ph);
  await page.waitForTimeout(400);
  await preview(ph);
  console.log(`  ${ph.padEnd(7)} ${((Date.now() - t0) / 1000).toFixed(0)} s   strokes so far: ${await page.evaluate(() => window.__quarc.ed.history.items.length)}`);
}

await crop('crop-sun', 1250, 640, 1300, 760); await crop('crop-boat-rocks', 0, 640, 1300, 800);

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
  await exportAs('PNG', 'harbour-at-dusk.png');
  await exportAs('Quarc Draw', 'harbour-at-dusk.qdraw');
  await exportAs('WebP', 'hero.webp', async () => { await setSlider('Scale', 0.75); await setSlider('Quality', 0.8); });
}

rep.summary(); await browser.close(); srv.stop();
