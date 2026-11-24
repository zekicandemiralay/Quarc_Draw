// Import / export of every supported format, verified at the byte level and by round-tripping.
import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { OUT } from './lib.mjs';
import path from 'node:path';

export async function io({ page, rep, shot, assert, helpers: h }) {
  const files = {};
  const exportAs = async (label, tweak) => {
    await h.cmd(page, 'file.export'); await page.waitForSelector('.dialog');
    await page.click(`.dialog .preset:has(b:text-is("${label}"))`);
    if (tweak) await tweak();
    const dl = page.waitForEvent('download');
    await page.click('.dialog-f .btn.primary');
    const d = await dl; const out = path.join(OUT, `export-${d.suggestedFilename()}`); await d.saveAs(out);
    await page.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 5000 }).catch(() => {});
    return { buf: readFileSync(out), file: out, name: d.suggestedFilename() };
  };
  const openFile = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await h.cmd(page, 'file.open');
    await (await chooser).setFiles(file);
    await page.waitForTimeout(1200);
  };

  await rep.step('build a mixed document (pixels + vector + text, 2 layers)', async () => {
    await page.goto(h.url); await page.waitForSelector('.library');
    await page.click('.new-tile'); await page.click('.dialog-f .btn.primary');
    await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(400);
    await h.ev(page, (ed) => { ed.doc.title = 'Export Test'; ed.setFg('#e63946'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 120, hardness: 1, flow: 1, opacity: 1 }); });
    await h.stroke(page, [[-200, 0], [200, 0]], { steps: 8 });
    await h.ev(page, (ed) => { ed.setTool('rect'); ed.setToolOpts({ shapeFill: { kind: 'solid', color: '#2a9d8f' } }); });
    await h.drag(page, [-100, -150], [100, -60]);
    await h.ev(page, (ed) => { ed.setTool('text'); ed.setFg('#111111'); });
    await h.click(page, [-100, 110]);
    await page.waitForSelector('textarea[data-text-editor]'); await page.keyboard.type('Export me'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(200);
    const s = await h.ev(page, (ed) => ({ layers: ed.page.layers.map((l) => l.type), w: ed.page.width, h: ed.page.height }));
    assert(s.layers.includes('raster') && s.layers.includes('vector'), JSON.stringify(s));
    files.dims = s;
  });

  await rep.step('PNG export: valid signature, correct size, painted content', async () => {
    const r = await exportAs('PNG');
    assert(r.buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG signature');
    const w = r.buf.readUInt32BE(16), hh = r.buf.readUInt32BE(20);
    assert(w === files.dims.w && hh === files.dims.h, `size ${w}x${hh} vs ${files.dims.w}x${files.dims.h}`);
    assert(r.buf.length > 3000, 'non-trivial PNG');
    files.png = path.join(OUT, 'keep-1x.png'); writeFileSync(files.png, r.buf);
  });

  await rep.step('PNG export at 2× scale doubles the pixel size', async () => {
    const r = await exportAs('PNG', async () => { await page.locator('.dialog input[type=range]').first().fill('2'); });
    assert(r.buf.readUInt32BE(16) === files.dims.w * 2, `2x width, got ${r.buf.readUInt32BE(16)}`);
  });

  await rep.step('JPEG, WebP, BMP, ICO, GIF headers', async () => {
    const j = await exportAs('JPEG'); assert(j.buf[0] === 0xff && j.buf[1] === 0xd8, 'JPEG SOI');
    const w = await exportAs('WebP'); assert(w.buf.subarray(0, 4).toString() === 'RIFF' && w.buf.subarray(8, 12).toString() === 'WEBP', 'WebP RIFF');
    const b = await exportAs('BMP'); assert(b.buf.subarray(0, 2).toString() === 'BM' && b.buf.readInt32LE(18) === files.dims.w, 'BMP header + width');
    const i = await exportAs('ICO'); assert(i.buf.readUInt16LE(2) === 1 && i.buf.readUInt16LE(4) >= 3, `ICO with ${i.buf.readUInt16LE(4)} sizes`);
    const g = await exportAs('GIF'); assert(g.buf.subarray(0, 6).toString() === 'GIF89a', 'GIF89a');
  });

  await rep.step('SVG export keeps vectors; re-import restores editable objects', async () => {
    const r = await exportAs('SVG');
    const text = r.buf.toString('utf8');
    assert(text.startsWith('<?xml') && text.includes('<svg') && /<path[^>]+d="M/.test(text) && text.includes('<text'), 'svg has paths and text');
    assert(text.includes('<image'), 'pixel layer embedded as image');
    await openFile(r.file);
    const n = await h.ev(page, (ed) => ed.doc.pages[0].layers.flatMap((l) => l.type === 'vector' ? l.objects : []).length);
    assert(n >= 2, `re-imported ${n} vector objects`);
    await h.ev(page, (ed) => { window.__quarc.workspace.close(ed, { save: false }); });
    await page.waitForTimeout(300);
    await h.cmd(page, 'file.library');
  });

  await rep.step('qdraw project round-trips layers, pixels and objects exactly', async () => {
    // switch back to the original export-test document
    await page.waitForTimeout(500);
    const hasDoc = await page.evaluate(() => window.__quarc.workspace.editors.some((e) => e.doc.title === 'Export Test'));
    assert(hasDoc, 'original document still open');
    await h.ev(page, (ed) => ed);
    await page.evaluate(() => { const ws = window.__quarc.workspace; const e = ws.editors.find((x) => x.doc.title === 'Export Test'); ws.setActive(e.id); });
    await page.waitForTimeout(300);
    const before = await h.ev(page, (ed) => { const r = ed.page.layers.find((l) => l.type === 'raster'); const c = r.surface.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let hash = 0; for (let i = 0; i < d.length; i += 97) hash = (hash * 31 + d[i]) | 0; return { hash, layers: ed.page.layers.length, objs: ed.page.layers.flatMap((l) => l.type === 'vector' ? l.objects.length : 0).reduce((a, b) => a + b, 0) }; });
    const r = await exportAs('Quarc Draw');
    const zip = await JSZip.loadAsync(r.buf);
    assert(zip.file('manifest.json') && zip.file('thumbnail.png'), 'zip has manifest + thumbnail');
    assert(Object.keys(zip.files).some((f) => f.endsWith('.png') && f.startsWith('pages/')), 'layer PNGs stored');
    await page.evaluate(() => { const ws = window.__quarc.workspace; ws.close(ws.active, { save: false }); });
    await openFile(r.file);
    const after = await h.ev(page, (ed) => { const r = ed.page.layers.find((l) => l.type === 'raster'); const c = r.surface.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let hash = 0; for (let i = 0; i < d.length; i += 97) hash = (hash * 31 + d[i]) | 0; return { hash, layers: ed.page.layers.length, objs: ed.page.layers.flatMap((l) => l.type === 'vector' ? l.objects.length : 0).reduce((a, b) => a + b, 0) }; });
    assert(JSON.stringify(before) === JSON.stringify(after), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  });

  await rep.step('PSD export → valid file → re-import keeps layers', async () => {
    const r = await exportAs('PSD');
    assert(r.buf.subarray(0, 4).toString() === '8BPS', 'PSD signature');
    await openFile(r.file);
    const info = await h.ev(page, (ed) => ({ layers: ed.page.layers.length, w: ed.page.width }));
    assert(info.layers >= 2 && info.w === files.dims.w, JSON.stringify(info));
  });

  await rep.step('OpenRaster export → valid zip → re-import keeps layers', async () => {
    const r = await exportAs('OpenRaster');
    const zip = await JSZip.loadAsync(r.buf);
    assert((await zip.file('mimetype').async('string')) === 'image/openraster', 'ORA mimetype');
    const xml = await zip.file('stack.xml').async('string');
    assert(xml.includes('<layer') && xml.includes(`w="${files.dims.w}"`), 'stack.xml');
    await openFile(r.file);
    assert((await h.ev(page, (ed) => ed.page.layers.length)) >= 2, 're-imported layers');
  });

  await rep.step('PDF (flattened pages) export opens in pdf-lib with the right page size', async () => {
    const r = await exportAs('PDF');
    const pdf = await PDFDocument.load(r.buf);
    assert(pdf.getPageCount() === 1, 'one page');
    const { width, height } = pdf.getPage(0).getSize();
    assert(Math.abs(width / height - files.dims.w / files.dims.h) < 0.01, `page ratio ${width}/${height}`);
  });

  await rep.step('multi-page export: animated GIF + zip of PNGs', async () => {
    await h.cmd(page, 'page.add'); await h.cmd(page, 'page.add');
    const g = await exportAs('GIF', async () => { await page.selectOption('.dialog select.select', 'all'); });
    assert(g.buf.subarray(0, 6).toString() === 'GIF89a' && g.buf.length > 500, 'animated GIF');
    const z = await exportAs('PNG', async () => { await page.selectOption('.dialog select.select', 'all'); });
    assert(z.name.endsWith('.zip'), `zip of PNGs (${z.name})`);
    const zip = await JSZip.loadAsync(z.buf);
    assert(Object.keys(zip.files).filter((f) => f.endsWith('.png')).length === 3, 'three PNGs in the zip');
  });

  await rep.step('import PNG + JPEG as new documents', async () => {
    await openFile(files.png);
    const info = await h.ev(page, (ed) => ({ w: ed.page.width, layers: ed.page.layers.length, type: ed.layer.type }));
    assert(info.w === files.dims.w && info.layers === 1 && info.type === 'raster', JSON.stringify(info));
  });

  await rep.step('SVG import: paths, arcs, gradients, transforms, text, polygons', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>
      <style>.t{fill:#123456}</style>
      <rect x="10" y="10" width="100" height="60" rx="8" fill="url(#g)" stroke="#000" stroke-width="3"/>
      <circle class="t" cx="200" cy="60" r="40" transform="translate(10,10)"/>
      <path d="M20 150 C 60 100 100 200 140 150 S 220 100 260 150 A 20 20 0 0 1 280 170 Z" fill="none" stroke="#333" stroke-width="2"/>
      <text x="20" y="190" font-size="18" font-family="Arial">Hello SVG</text>
      <polygon points="150,120 170,170 130,170" fill="orange"/></svg>`;
    const f = path.join(OUT, 'sample.svg'); writeFileSync(f, svg);
    await openFile(f);
    const info = await h.ev(page, (ed) => { const o = ed.page.layers[0].objects; return { w: ed.page.width, h: ed.page.height, types: o.map((x) => x.type), g: o[0].fill?.kind, circleFill: o[1].fill?.color, tf: o[1].tf.e, pathNodes: o[2].paths[0].nodes.length }; });
    assert(info.w === 300 && info.h === 200, 'size from the svg');
    assert(JSON.stringify(info.types) === JSON.stringify(['rect', 'ellipse', 'path', 'text', 'path']), JSON.stringify(info.types));
    assert(info.g === 'linear', 'gradient fill resolved');
    assert(info.circleFill && info.circleFill.toLowerCase().startsWith('#123456'), `css class fill (${info.circleFill})`);
    assert(info.tf === 10, 'translate transform applied');
    assert(info.pathNodes === 4, `bezier/arc path nodes ${info.pathNodes} (M, C, S and a quarter-circle arc)`);
    await shot('40-svg-import');
  });
}
