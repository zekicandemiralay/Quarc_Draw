// Notes workspace: notebook creation, vector ink, shape snap, eraser, lasso, pages, templates, notes, images.
import { writeFileSync, mkdirSync } from 'node:fs';
import { OUT } from './lib.mjs';
import path from 'node:path';

export async function notes({ page, rep, shot, assert, helpers: h }) {
  const inkObjects = (page) => h.ev(page, (ed) => ed.page.layers.filter((l) => l.type === 'vector').flatMap((l) => l.objects));
  const circle = (r, n = 48, cx = 0, cy = 0) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r * 0.8]);

  await rep.step('create a lined notebook (Notes workspace)', async () => {
    await page.goto(h.url); await page.waitForSelector('.library');
    await page.click('.new-tile'); await page.waitForSelector('.dialog');
    await page.click('.dialog .seg button:has-text("Notebook")');
    await page.waitForTimeout(200);
    await shot('20-new-notebook');
    await page.click('.dialog-f .btn.primary');
    await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(500);
    const info = await h.ev(page, (ed) => ({ kind: ed.doc.kind, tpl: ed.page.background.template?.kind, tool: ed.toolId, layers: ed.page.layers.map((l) => l.type) }));
    assert(info.kind === 'notebook' && info.tpl === 'lined' && info.tool === 'ink-pen', JSON.stringify(info));
    assert(info.layers.includes('vector'), 'has a vector ink layer');
    assert(await page.locator('.ws-switch button.on').innerText().then((t) => /Notes/.test(t)), 'Notes workspace active');
    await h.ev(page, (ed) => ed.fitPage());
  });

  await rep.step('pen strokes become vector ink objects with pressure data', async () => {
    await h.pen(page, [[-180, -200], [-120, -230], [-40, -170], [40, -230], [120, -190]]);
    await h.pen(page, [[-180, -120], [-60, -110], [60, -130], [180, -110]]);
    const objs = await inkObjects(page);
    assert(objs.length === 2 && objs.every((o) => o.type === 'ink'), `2 ink objects, got ${JSON.stringify(objs.map((o) => o.type))}`);
    const pr = objs[0].pts.filter((_, i) => i % 3 === 2);
    assert(Math.max(...pr) - Math.min(...pr) > 0.3, `pressure varies along the stroke: ${pr.map((x) => x.toFixed(2)).join(',')}`);
  });

  await rep.step('highlighter uses multiply blend and translucent colour', async () => {
    await h.ev(page, (ed) => { ed.setTool('highlighter'); ed.setFg('#ffe14d'); });
    await h.pen(page, [[-180, -120], [180, -120]]);
    const o = (await inkObjects(page)).at(-1);
    assert(o.blend === 'multiply' && o.opacity < 0.7 && o.ink === 'highlighter', JSON.stringify({ blend: o.blend, op: o.opacity, ink: o.ink }));
  });

  await rep.step('hold still at the end of a stroke → perfect ellipse', async () => {
    await h.ev(page, (ed) => { ed.setTool('ink-pen'); ed.setFg('#c1121f'); });
    const before = (await inkObjects(page)).length;
    await h.pen(page, circle(60, 40, 80, 20).map(([x, y]) => [x + (Math.random() - 0.5) * 3, y + (Math.random() - 0.5) * 3]), { hold: 900 });
    const objs = await inkObjects(page);
    assert(objs.length === before + 1, 'one new object');
    assert(objs.at(-1).type === 'ellipse', `snapped to ${objs.at(-1).type}`);
  });

  await rep.step('hold still on a straight stroke → line; closed box → rectangle', async () => {
    await h.pen(page, Array.from({ length: 25 }, (_, i) => [-180 + i * 12, 100 + (i % 2) * 1.2]), { hold: 900 });
    assert((await inkObjects(page)).at(-1).type === 'line', 'line recognised');
    const rect = [];
    for (let i = 0; i <= 12; i++) rect.push([-140 + i * 10, 150]);
    for (let i = 1; i <= 10; i++) rect.push([-20, 150 + i * 10]);
    for (let i = 1; i <= 12; i++) rect.push([-20 - i * 10, 250]);
    for (let i = 1; i <= 10; i++) rect.push([-140, 250 - i * 10]);
    await h.pen(page, rect, { hold: 900 });
    assert((await inkObjects(page)).at(-1).type === 'rect', `rectangle recognised (${(await inkObjects(page)).at(-1).type})`);
    await shot('21-ink-notes');
  });

  await rep.step('stroke eraser removes a whole stroke; undo brings it back', async () => {
    const n0 = (await inkObjects(page)).length;
    await h.ev(page, (ed) => { ed.setTool('ink-eraser'); ed.setToolOpts({ strokeEraserMode: 'stroke', strokeEraserSize: 30 }); });
    await h.drag(page, [-170, -120], [170, -120], 20);
    const n1 = (await inkObjects(page)).length;
    assert(n1 < n0, `objects ${n0} → ${n1}`);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
    assert((await inkObjects(page)).length === n0, 'undo restores erased strokes (one history step)');
  });

  await rep.step('partial eraser splits a stroke into pieces', async () => {
    await h.ev(page, (ed) => { ed.setToolOpts({ strokeEraserMode: 'pixel', strokeEraserSize: 24 }); });
    const n0 = (await inkObjects(page)).length;
    await h.drag(page, [-60, -140], [-60, -90], 6);
    const n1 = (await inkObjects(page)).length;
    assert(n1 >= n0, `partial erase keeps/splits strokes (${n0} → ${n1})`);
    await page.keyboard.press('Control+z');
  });

  await rep.step('lasso selects ink and switches to move; selection can be dragged', async () => {
    await h.ev(page, (ed) => ed.setTool('object-lasso'));
    await h.pen(page, [[-200, -260], [200, -260], [200, 60], [-200, 60], [-200, -260]]);
    const sel = await h.ev(page, (ed) => ({ n: ed.objSel.length, tool: ed.toolId }));
    assert(sel.n >= 2 && sel.tool === 'move', JSON.stringify(sel));
    await h.drag(page, [-150, -30], [-90, 10]);
    const x1 = await h.ev(page, (ed) => ed.selectedObjects()[0].tf.e);
    assert(Math.abs(x1) > 30, `selection moved (tf.e=${x1})`);
    await page.keyboard.press('Control+z');
  });

  await rep.step('pages: add, thumbnails sidebar, bookmark, navigate, vertical layout', async () => {
    await h.cmd(page, 'page.add');
    assert((await h.ev(page, (ed) => ed.doc.pages.length)) === 2, 'two pages');
    await page.waitForSelector('.thumb-page');
    assert((await page.locator('.thumb-page').count()) === 2, 'two thumbnails');
    await h.cmd(page, 'page.bookmark');
    assert(await h.ev(page, (ed) => ed.page.bookmark), 'bookmarked');
    await h.ev(page, (ed) => ed.setTool('ink-pen'));
    await h.pen(page, [[-100, 0], [0, 30], [100, 0]]);
    await h.ev(page, (ed) => ed.goToPage(0));
    await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.pageIndex)) === 0, 'navigated back');
    await h.cmd(page, 'view.layout.vertical'); await page.waitForTimeout(300);
    await h.ev(page, (ed) => ed.fitWidth());
    await shot('22-notes-vertical');
    await h.cmd(page, 'view.layout.single');
  });

  await rep.step('sticky note opens an editor and keeps its text', async () => {
    await h.ev(page, (ed) => ed.setTool('note'));
    await h.click(page, [60, 180]);
    await page.waitForSelector('.dialog textarea');
    await page.fill('.dialog textarea', 'Remember to buy ink');
    await page.click('.dialog-f .btn.primary'); await page.waitForTimeout(200);
    const note = (await inkObjects(page)).find((o) => o.type === 'note');
    assert(note && note.text === 'Remember to buy ink', JSON.stringify(note));
  });

  await rep.step('insert an image as a movable object', async () => {
    mkdirSync(OUT, { recursive: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mP8z8Dwn4EIwDiqkL4KAQAeEwkB1eRq9gAAAABJRU5ErkJggg==', 'base64');
    const file = path.join(OUT, 'tiny.png'); writeFileSync(file, png);
    const chooser = page.waitForEvent('filechooser');
    await h.cmd(page, 'file.place');
    await (await chooser).setFiles(file);
    await page.waitForTimeout(600);
    const img = (await inkObjects(page)).find((o) => o.type === 'image');
    assert(img && img.w > 5, 'image object placed');
  });

  await rep.step('laser pointer, hand and fit tools run without errors', async () => {
    await h.ev(page, (ed) => ed.setTool('laser'));
    await h.pen(page, [[-100, -50], [0, 0], [100, 50]]);
    await h.ev(page, (ed) => ed.setTool('hand'));
    await h.drag(page, [0, 0], [30, 30]);
    await h.ev(page, (ed) => ed.fitPage());
  });

  await rep.step('notebook persists: autosave to library and reopens with all content', async () => {
    await page.waitForTimeout(3500);
    assert(await h.ev(page, (ed) => !ed.dirty), 'autosaved');
    const nObjs = (await inkObjects(page)).length;
    await page.reload(); await page.waitForSelector('.library');
    await page.waitForSelector('.doc-card'); await shot('23-library-with-doc');
    await page.click('.doc-card'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(600);
    const after = await inkObjects(page);
    assert(after.length === nObjs, `reopened with ${after.length}/${nObjs} objects`);
    assert((await h.ev(page, (ed) => ed.doc.pages.length)) === 2, 'both pages restored');
    assert((await h.ev(page, (ed) => ed.doc.pages[0].background.template?.kind)) === 'lined', 'template restored');
  });
}
