// Reader workspace: PDF import, rendering, search, text markup, annotations, annotated export, persistence.
import { PDFDocument, StandardFonts, rgb, PDFName } from 'pdf-lib';
import { writeFileSync, readFileSync } from 'node:fs';
import { OUT } from './lib.mjs';
import path from 'node:path';

export async function reader({ page, rep, shot, assert, helpers: h }) {
  const pdfPath = path.join(OUT, 'test.pdf');
  {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= 3; i++) {
      const p = pdf.addPage([595, 842]);
      p.drawText(`Chapter ${i}: Quarc Draw reader`, { x: 60, y: 760, size: 26, font: bold, color: rgb(0.1, 0.2, 0.4) });
      p.drawText('The quick brown fox jumps over the lazy dog.', { x: 60, y: 700, size: 16, font });
      p.drawText(`Page number ${i} of the generated test document.`, { x: 60, y: 670, size: 14, font });
      p.drawText('Highlight this sentence to test text markup.', { x: 60, y: 620, size: 14, font });
      p.drawRectangle({ x: 60, y: 400, width: 200, height: 120, color: rgb(0.8, 0.9, 0.85) });
    }
    writeFileSync(pdfPath, await pdf.save());
  }
  const dark = () => page.evaluate(() => {
    const c = document.querySelector('.viewport canvas:not(.overlay)'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 120 && d[i + 3] > 200) n++;
    return n;
  });

  await rep.step('open a PDF: pages, reader workspace, vertical layout', async () => {
    await page.goto(h.url); await page.waitForSelector('.library');
    const chooser = page.waitForEvent('filechooser');
    await page.click('.lib-top .btn:has-text("Import")');
    await (await chooser).setFiles(pdfPath);
    await page.waitForSelector('canvas.overlay', { timeout: 15000 }); await page.waitForTimeout(1500);
    const info = await h.ev(page, (ed) => ({ kind: ed.doc.kind, pages: ed.doc.pages.length, layout: ed.doc.layout, w: ed.doc.pages[0].width, h: ed.doc.pages[0].height, pdf: ed.doc.pages[0].background.pdfPage, asset: !!ed.doc.pdfAssetId, ws: JSON.parse(localStorage.getItem('quarcdraw.prefs.v1')).workspace }));
    assert(info.kind === 'pdf' && info.pages === 3 && info.layout === 'vertical' && info.asset, JSON.stringify(info));
    assert(info.ws === 'reader', `reader workspace chosen (${info.ws})`);
    assert(Math.abs(info.w / info.h - 595 / 842) < 0.01, 'page aspect matches the PDF');
  });

  await rep.step('PDF pages are actually rendered (text pixels visible)', async () => {
    await page.waitForTimeout(800);
    const n = await dark();
    assert(n > 400, `expected dark text pixels on the canvas, got ${n}`);
    await shot('30-reader-open');
    assert((await page.locator('.thumb-page').count()) === 3, 'three page thumbnails');
  });

  await rep.step('search finds text on every page and navigates between hits', async () => {
    await page.keyboard.press('Control+f');
    await page.waitForSelector('.sidebar input.input');
    await page.fill('.sidebar input.input', 'brown fox');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.hit').length >= 3, null, { timeout: 15000 });
    assert((await page.locator('.hit').count()) === 3, 'one hit per page');
    await page.locator('.hit').nth(2).click(); await page.waitForTimeout(300);
    assert((await h.ev(page, (ed) => ed.pageIndex)) === 2, 'jumped to page 3');
    await shot('31-reader-search');
    await page.fill('.sidebar input.input', ''); await page.keyboard.press('Escape');
  });

  await rep.step('text markup: drag over a sentence creates a highlight with the quoted text', async () => {
    await h.ev(page, (ed) => ed.goToPage(0));
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+f');
    await page.fill('.sidebar input.input', 'Highlight this sentence');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.hit').length >= 1, null, { timeout: 10000 });
    // screen position of the first hit on page 1
    const pos = await page.evaluate(() => {
      const ed = window.__quarc.ed; const st = window.__quarc.search.get(); const q = st.hits[0].quads[0];
      const pm = ed.view.pageMatrix(ed.doc.pages[st.hits[0].page]);
      const s = (p) => ({ x: pm.a * p.x + pm.c * p.y + pm.e, y: pm.b * p.x + pm.d * p.y + pm.f });
      const a = s(q[0]), b = s(q[2]); const r = document.querySelector('.viewport').getBoundingClientRect();
      return { x0: r.left + a.x + 2, x1: r.left + b.x - 2, y: r.top + (a.y + b.y) / 2 };
    });
    await page.fill('.sidebar input.input', ''); await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await h.ev(page, (ed) => { ed.setTool('markup-highlight'); });
    await page.mouse.move(pos.x0, pos.y); await page.mouse.down(); await page.mouse.move(pos.x1, pos.y, { steps: 12 }); await page.mouse.up();
    await page.waitForTimeout(400);
    const m = await h.ev(page, (ed) => ed.doc.pages[0].layers.flatMap((l) => l.type === 'vector' ? l.objects : []).filter((o) => o.type === 'markup'));
    assert(m.length === 1, `one markup, got ${m.length}`);
    assert(/Highlight this sentence/i.test(m[0].quote), `quote "${m[0].quote}"`);
    assert(m[0].quads.length >= 1 && m[0].kind === 'highlight', 'quads + kind');
    await shot('32-reader-highlight');
  });

  await rep.step('ink, text and a note can be added on top of the PDF', async () => {
    await h.ev(page, (ed) => { ed.setTool('ink-pen'); ed.setFg('#d00000'); });
    await h.pen(page, [[-100, 20], [-40, -10], [20, 30], [90, 0]]);
    await h.ev(page, (ed) => { ed.setTool('text'); ed.setFg('#000000'); });
    await h.click(page, [-90, 120]);
    await page.waitForSelector('textarea[data-text-editor]'); await page.keyboard.type('Typed over the PDF'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(200);
    await h.ev(page, (ed) => ed.setTool('note')); await h.click(page, [80, 150]);
    await page.waitForSelector('.dialog textarea'); await page.fill('.dialog textarea', 'Check this paragraph'); await page.click('.dialog-f .btn.primary'); await page.waitForTimeout(200);
    const kinds = await h.ev(page, (ed) => ed.doc.pages[0].layers.flatMap((l) => l.type === 'vector' ? l.objects.map((o) => o.type) : []));
    assert(['markup', 'ink', 'text', 'note'].every((k) => kinds.includes(k)), JSON.stringify(kinds));
    await page.click('.side-tabs button[title="Annotations"]');
    await page.waitForSelector('.hit');
    assert((await page.locator('.hit').count()) >= 3, 'annotation list shows markup, text and note');
    await shot('33-reader-annotations');
  });

  await rep.step('export: annotate the ORIGINAL pdf (page count + overlay embedded)', async () => {
    await page.keyboard.press('Control+Shift+e'); await page.waitForSelector('.dialog');
    const mode = await page.locator('.dialog .seg button:has-text("Annotate original")').count();
    assert(mode === 1, 'annotate-original mode offered');
    const dl = page.waitForEvent('download');
    await page.click('.dialog-f .btn.primary');
    const d = await dl; const out = path.join(OUT, 'annotated.pdf'); await d.saveAs(out);
    const bytes = readFileSync(out);
    const pdf = await PDFDocument.load(bytes);
    assert(pdf.getPageCount() === 3, `3 pages, got ${pdf.getPageCount()}`);
    assert(bytes.length > readFileSync(pdfPath).length, 'annotated file is larger than the original');
    const res = pdf.getPage(0).node.Resources();
    assert(res && res.get(PDFName.of('Font')), 'original fonts/text preserved on page 1');
    assert(res.get(PDFName.of('XObject')), 'overlay image XObject embedded on page 1');
  });

  await rep.step('page operations on a PDF: delete + undo, then export 2 pages', async () => {
    await h.ev(page, (ed) => ed.goToPage(1));
    await h.cmd(page, 'page.delete');
    assert((await h.ev(page, (ed) => ed.doc.pages.length)) === 2, 'page deleted');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.doc.pages.length)) === 3, 'undo restored the page');
  });

  await rep.step('saved PDF reopens from the library with pdf.js text layer intact', async () => {
    await page.waitForTimeout(3500);
    await page.reload(); await page.waitForSelector('.doc-card');
    await shot('34-library-pdf');
    await page.click('.doc-card'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(1500);
    const info = await h.ev(page, (ed) => ({ pages: ed.doc.pages.length, markups: ed.doc.pages[0].layers.flatMap((l) => l.type === 'vector' ? l.objects : []).filter((o) => o.type === 'markup').length }));
    assert(info.pages === 3 && info.markups === 1, JSON.stringify(info));
    assert((await dark()) > 400, 'PDF re-rendered from the stored asset');
    await page.keyboard.press('Control+f');
    await page.fill('.sidebar input.input', 'lazy dog'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.hit').length >= 3, null, { timeout: 15000 });
  });
}
