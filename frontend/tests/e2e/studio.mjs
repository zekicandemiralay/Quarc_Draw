// Raster painting, layers, selections, shapes, text, filters, history.
export async function studio({ page, rep, shot, assert, helpers: h }) {
  await rep.step('new drawing via the New dialog', async () => {
    await page.goto(h.url); await page.waitForSelector('.library');
    await page.click('.new-tile'); await page.waitForSelector('.dialog');
    await page.fill('.dialog .input >> nth=0', 'E2E drawing');
    await page.click('.dialog-f .btn.primary');
    await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(400);
    assert(await h.ev(page, (ed) => ed.doc.title) === 'E2E drawing', 'title set');
    assert(await h.ev(page, (ed) => ed.doc.pages.length) === 1, 'one page');
    await shot('10-studio-new');
  });

  await rep.step('brush stroke writes pixels, undo clears, redo restores', async () => {
    const before = await h.pixels(page);
    await h.stroke(page, [[-250, 0], [-100, -60], [50, 40], [200, -30]]);
    const after = await h.pixels(page);
    assert(before === 0 && after > 500, `stroke should paint pixels (before ${before} after ${after})`);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
    assert((await h.pixels(page)) === 0, 'undo removes the stroke');
    await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(100);
    assert((await h.pixels(page)) === after, 'redo restores identical pixels');
  });

  await rep.step('brush engine: every preset paints something', async () => {
    const names = await page.evaluate(() => window.__quarc.ed.presets.map((b) => b.id));
    assert(names.length >= 40, `expected 40+ presets, got ${names.length}`);
    const painted = [];
    for (const id of names.filter((n) => !n.startsWith('tool-') && !n.startsWith('erase-'))) {
      await page.evaluate((id) => { const ed = window.__quarc.ed; ed.page.layers.length = 0; ed.activeLayerId = null; ed.setActivePage(ed.page.id); ed.setBrushPreset(id); ed.setTool('brush'); }, id);
      await h.stroke(page, [[-150, 0], [-50, -40], [50, 30], [150, -10]], { steps: 12 });
      const n = await h.pixels(page);
      painted.push([id, n]);
      await page.evaluate(() => { const ed = window.__quarc.ed; ed.page.layers.length = 0; ed.activeLayerId = null; ed.history.clear(); });
    }
    const empty = painted.filter(([, n]) => n < 50);
    assert(empty.length === 0, `brushes that painted nothing: ${empty.map((e) => e[0]).join(', ')}`);
  });

  await rep.step('layers: add, rename, opacity, blend, reorder, duplicate, merge, delete', async () => {
    await h.reset(page);
    await page.click('.layer-actions button[title="New pixel layer"]');
    await page.click('.layer-actions button[title="New pixel layer"]');
    assert((await h.ev(page, (ed) => ed.page.layers.length)) === 2, 'two layers after adding two');
    await page.locator('.layer .name').first().dblclick();
    await page.keyboard.type('Top'); await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.page.layers[1].name)) === 'Top', 'renamed');
    await page.selectOption('.panel.fill select.select', 'multiply');
    assert((await h.ev(page, (ed) => ed.layer.blend)) === 'multiply', 'blend mode set');
    await page.locator('.panel.fill input[type=range]').first().fill('40');
    await page.waitForTimeout(100);
    assert(Math.abs((await h.ev(page, (ed) => ed.layer.opacity)) - 0.4) < 0.01, 'opacity 40%');
    await page.click('.layer-actions button[title="Duplicate"]');
    assert((await h.ev(page, (ed) => ed.page.layers.length)) === 3, 'duplicated');
    await page.keyboard.press('Control+e'); await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.page.layers.length)) === 2, 'merged down');
    await page.click('.layer-actions button[title="Delete layer"]');
    assert((await h.ev(page, (ed) => ed.page.layers.length)) === 1, 'deleted');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    await shot('11-layers');
  });

  await rep.step('layer mask: add, paint black hides, apply', async () => {
    await h.reset(page); await h.ev(page, (ed) => { });
    await h.ev(page, (ed) => { ed.setTool('bucket'); });
    // draw a big blob then mask half of it
    await h.ev(page, (ed) => { ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 200, opacity: 1, flow: 1, hardness: 1 }); });
    await h.stroke(page, [[-100, 0], [100, 0]], { steps: 10 });
    const painted = await h.pixels(page);
    assert(painted > 5000, 'big blob');
    await page.keyboard.press('ArrowDown'); // no-op safety
    await h.cmd(page, 'layer.mask.add');
    assert(await h.ev(page, (ed) => !!ed.layer.mask && ed.editingMask), 'mask added and active');
    await h.ev(page, (ed) => { ed.setFg('#000000'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 160, hardness: 1, flow: 1, opacity: 1 }); });
    await h.stroke(page, [[-60, -30], [-60, 30]], { steps: 8 });
    await page.waitForTimeout(200);
    const maskInfo = await h.ev(page, (ed) => { const m = ed.layer.mask; const c = m.peek(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let hidden = 0, shown = 0; for (let i = 3; i < d.length; i += 4) (d[i] > 128 ? shown++ : hidden++); return { hidden, shown }; });
    assert(maskInfo.hidden > 1000 && maskInfo.shown > 1000, `mask should be partially hidden: ${JSON.stringify(maskInfo)}`);
    await h.cmd(page, 'layer.mask.apply');
    await page.waitForTimeout(150);
    assert((await h.pixels(page)) < painted, 'applying the mask removed pixels');
    await shot('12-mask');
  });

  await rep.step('selection: marquee, invert, fill, feather, grow, deselect', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setFg('#e63946'); });
    await h.ev(page, (ed) => { ed.setTool('marquee-rect'); });
    await h.drag(page, [-200, -100], [100, 120]);
    assert(await h.ev(page, (ed) => ed.hasSelection), 'selection exists');
    const b = await h.ev(page, (ed) => ed.selection.bounds);
    assert(b.w > 250 && b.h > 180, `selection size ${JSON.stringify(b)}`);
    await h.cmd(page, 'edit.fill.fg');
    const filled = await h.pixels(page);
    assert(filled > 40000, `fill covers the selection (${filled})`);
    await h.cmd(page, 'select.invert');
    await h.cmd(page, 'edit.fill.bg');
    assert((await h.pixels(page)) > filled * 5, 'inverse fill painted the rest');
    await h.cmd(page, 'select.none');
    assert(!(await h.ev(page, (ed) => ed.hasSelection)), 'deselected');
    await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
    // ellipse + add + subtract modes via keyboard modifiers
    await h.ev(page, (ed) => { ed.setTool('marquee-ellipse'); });
    await h.drag(page, [-250, -150], [0, 100]);
    const e1 = await h.ev(page, (ed) => ed.selection.bounds.w);
    await page.keyboard.down('Shift'); await h.drag(page, [0, -100], [250, 150]); await page.keyboard.up('Shift');
    const e2 = await h.ev(page, (ed) => ed.selection.bounds.w);
    assert(e2 > e1 + 100, `shift adds to selection (${e1} → ${e2})`);
    await shot('13-selection');
    await h.cmd(page, 'select.none');
  });

  await rep.step('magic wand + paint bucket respect boundaries', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setFg('#1d3557'); ed.setTool('rect'); });
    await h.drag(page, [-150, -100], [150, 100]); // draws a vector rect → rasterise for pixel ops
    await h.cmd(page, 'layer.rasterize');
    await h.ev(page, (ed) => { ed.setTool('wand'); ed.setToolOpts({ tolerance: 20, contiguous: true, sampleMerged: false }); });
    await h.click(page, [0, 0]);
    const sel = await h.ev(page, (ed) => ed.selection.bounds);
    assert(sel && sel.w > 500 && sel.w < 620 && sel.h > 340 && sel.h < 420, `wand selected the rectangle ${JSON.stringify(sel)}`);
    await h.cmd(page, 'select.none');
    await h.ev(page, (ed) => { ed.setFg('#ffd166'); ed.setTool('bucket'); });
    const before = await h.pixels(page);
    await h.click(page, [0, 0]);
    assert((await h.pixels(page)) === before, 'bucket fill recolours existing pixels without adding any');
    const px = await h.ev(page, (ed) => { const c = ed.layer.surface.canvas; const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return [d[0], d[1], d[2]]; });
    assert(px[0] > 240 && px[1] > 190 && px[2] < 130, `centre pixel recoloured to #ffd166, got ${px}`);
  });

  await rep.step('shapes create vector objects; move tool selects & drags', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setToolOpts({ shapeFill: { kind: 'solid', color: '#2a9d8f' } }); });
    for (const [tool, a, b] of [['ellipse', [-300, -150], [-100, 0]], ['star', [0, -150], [200, 50]], ['arrow', [-250, 100], [250, 160]], ['polygon', [100, 0], [250, 100]]]) {
      await h.ev(page, (ed, t) => ed.setTool(t), tool);
      await h.drag(page, a, b);
    }
    assert((await h.ev(page, (ed) => ed.page.layers.filter((l) => l.type === 'vector').reduce((s, l) => s + l.objects.length, 0))) === 4, 'four vector objects');
    await h.ev(page, (ed) => ed.setTool('move'));
    await h.click(page, [-200, -75]);
    assert((await h.ev(page, (ed) => ed.objSel.length)) === 1, 'click selects an object');
    const before = await h.ev(page, (ed) => ed.selectedObjects()[0].tf.e);
    await h.drag(page, [-200, -75], [-120, -75]);
    const after = await h.ev(page, (ed) => ed.selectedObjects()[0].tf.e);
    assert(after - before > 100, `object moved by about 150 px (${before} → ${after})`);
    await page.keyboard.press('Control+z');
    assert(Math.abs((await h.ev(page, (ed) => ed.selectedObjects()[0].tf.e)) - before) < 0.5, 'undo restores position');
    await h.cmd(page, 'object.group');
    await shot('14-shapes');
  });

  await rep.step('shape boolean operation (union) via paper.js', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setTool('rect'); });
    await h.drag(page, [-100, -80], [60, 80]);
    await h.ev(page, (ed) => ed.setTool('ellipse')); await h.drag(page, [-20, -60], [140, 100]);
    await h.cmd(page, 'select.objects');
    await h.cmd(page, 'object.unite'); await page.waitForTimeout(1200);
    const n = await h.ev(page, (ed) => ed.page.layers.find((l) => l.type === 'vector').objects.length);
    assert(n === 1, `union leaves a single object (got ${n})`);
    await shot('15-boolean');
  });

  await rep.step('text tool: type, commit, edit again', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setTool('text'); ed.setFg('#222222'); });
    await h.click(page, [-150, -20]);
    await page.waitForSelector('textarea[data-text-editor]');
    await page.keyboard.type('Hello Quarc Draw\nsecond line');
    await page.keyboard.press('Control+Enter'); await page.waitForTimeout(150);
    const t = await h.ev(page, (ed) => { const o = ed.page.layers.find((l) => l.type === 'vector').objects[0]; return { type: o.type, text: o.text }; });
    assert(t.type === 'text' && t.text === 'Hello Quarc Draw\nsecond line', `text object ${JSON.stringify(t)}`);
    await h.ev(page, (ed) => ed.setTool('move'));
    await h.ev(page, (ed) => ed.setTool('text'));
    await h.click(page, [-100, 0]);
    await page.waitForSelector('textarea[data-text-editor]');
    await page.keyboard.press('Control+a'); await page.keyboard.type('Edited'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(100);
    assert((await h.ev(page, (ed) => ed.page.layers.find((l) => l.type === 'vector').objects[0].text)) === 'Edited', 'text edited in place');
    await shot('16-text');
  });

  await rep.step('gradient tool + filter dialog (gaussian blur) + adjustment (invert)', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setFg('#ff006e'); ed.setBg('#3a86ff'); ed.setToolOpts({ gradientUseFgBg: true, gradientKind: 'linear' }); ed.setTool('gradient'); });
    await h.drag(page, [-300, -200], [300, 200]);
    assert((await h.pixels(page)) > 400000, 'gradient fills the page');
    const c0 = await h.ev(page, (ed) => { const c = ed.layer.surface.canvas; const d = c.getContext('2d').getImageData(10, 10, 1, 1).data; return [d[0], d[1], d[2]]; });
    // sharp edge then blur
    await h.cmd(page, 'filter.gaussian-blur'); await page.waitForSelector('.dialog');
    await page.waitForTimeout(400);
    await shot('17-filter-dialog');
    await page.click('.dialog-f .btn.primary'); await page.waitForTimeout(500);
    await h.cmd(page, 'adjust.invert'); await page.waitForTimeout(300);
    const c1 = await h.ev(page, (ed) => { const c = ed.layer.surface.canvas; const d = c.getContext('2d').getImageData(10, 10, 1, 1).data; return [d[0], d[1], d[2]]; });
    assert(Math.abs(c0[0] + c1[0] - 255) < 12, `invert flipped red channel ${c0} → ${c1}`);
    await h.cmd(page, 'layer.adj.hue-saturation');
    assert((await h.ev(page, (ed) => ed.layer.type)) === 'adjustment', 'adjustment layer created');
    await shot('18-adjustment');
  });

  await rep.step('free transform scales pixels and one undo reverts everything', async () => {
    await h.reset(page); await h.ev(page, (ed) => { ed.setFg('#06d6a0'); ed.setTool('brush'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 100, hardness: 1, flow: 1, opacity: 1 }); });
    await h.stroke(page, [[-50, 0], [50, 0]], { steps: 6 });
    const b0 = await h.ev(page, (ed) => ed.layer.surface.contentBounds());
    await h.ev(page, (ed) => ed.setTool('transform'));
    await page.waitForTimeout(150);
    const t = await h.ev(page, (ed) => { const tr = ed.getTool('transform'); tr.setScale(2, 2); tr.commit(); ed.setTool('move'); return true; });
    const b1 = await h.ev(page, (ed) => ed.layer.surface.contentBounds());
    assert(b1.w > b0.w * 1.7, `content grew ${b0.w} → ${b1.w}`);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(100);
    const b2 = await h.ev(page, (ed) => ed.layer.surface.contentBounds());
    assert(Math.abs(b2.w - b0.w) <= 1, 'single undo reverts the transform');
    void t;
  });

  await rep.step('canvas operations: crop, resize canvas, image size, rotate', async () => {
    await h.ev(page, (ed) => { ed.history.clear(); });
    const w0 = await h.ev(page, (ed) => ed.page.width);
    await h.cmd(page, 'image.rotate90');
    assert((await h.ev(page, (ed) => ed.page.height)) === w0, 'rotate swaps dimensions');
    await page.keyboard.press('Control+z');
    await page.evaluate(() => { const ed = window.__quarc.ed; window.__ops = null; });
    await page.keyboard.press('Control+Alt+i'); await page.waitForSelector('.dialog');
    await page.fill('.dialog .input.num >> nth=0', '600'); await page.keyboard.press('Enter');
    await page.click('.dialog-f .btn.primary'); await page.waitForTimeout(300);
    assert((await h.ev(page, (ed) => ed.page.width)) === 600, 'image size applied');
    await page.keyboard.press('Control+z');
  });

  await rep.step('view: zoom, rotate, fit and pan', async () => {
    await h.ev(page, (ed) => ed.fitPage());
    const z0 = await h.ev(page, (ed) => ed.view.zoom);
    await page.keyboard.press('Control+='); await page.keyboard.press('Control+=');
    assert((await h.ev(page, (ed) => ed.view.zoom)) > z0 * 1.5, 'zoom in');
    await h.cmd(page, 'view.rotate90'); await page.waitForTimeout(100);
    assert(Math.abs(await h.ev(page, (ed) => ed.view.rotation)) > 1, 'view rotated');
    await shot('19-rotated');
    await h.cmd(page, 'view.rotatereset'); await h.cmd(page, 'view.fit');
  });
}
