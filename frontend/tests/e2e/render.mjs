// Rendering correctness (pixel sampling of the on-screen canvas) + misc UI features.
export async function render({ page, rep, shot, assert, helpers: h }) {
  // sample the composited canvas at a page coordinate → [r,g,b,a]
  const at = (x, y) => page.evaluate(([x, y]) => {
    const ed = window.__quarc.ed; const pm = ed.view.pageMatrix(ed.page);
    const sx = Math.round(pm.a * x + pm.c * y + pm.e), sy = Math.round(pm.b * x + pm.d * y + pm.f);
    const c = document.querySelector('.viewport canvas:not(.overlay)'); const r = c.getBoundingClientRect();
    return Array.from(c.getContext('2d').getImageData(Math.round(sx * c.width / r.width), Math.round(sy * c.height / r.height), 1, 1).data);
  }, [x, y]);
  const near = (c, r, g, b, tol = 14) => Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - b) <= tol;
  // quickly build a solid rectangle on a new raster layer through the model + render
  const fillRect = (name, color, x, y, w, hgt) => page.evaluate(([name, color, x, y, w, hgt]) => {
    const ed = window.__quarc.ed;
    ed.setActiveLayer(null); ed.tool.cancel();
    const l = ed.ensureRasterTarget(); l.name = name;
    // each call creates a fresh layer above
    const nl = ed.page.layers[ed.page.layers.length - 1]; nl.name = name;
    const c = nl.surface.canvas.getContext('2d'); c.fillStyle = color; c.fillRect(x, y, w, hgt); nl.surface.touch();
    ed.changed('layers', 'doc'); return nl.id;
  }, [name, color, x, y, w, hgt]);
  const layer = (id, patch) => page.evaluate(([id, patch]) => { const ed = window.__quarc.ed; const walk = (ls) => { for (const l of ls) { if (l.id === id) return l; if (l.children) { const r = walk(l.children); if (r) return r; } } }; Object.assign(walk(ed.page.layers), patch); ed.changed('layers', 'doc'); }, [id, patch]);

  await rep.step('setup: blank 1920×1080 canvas', async () => {
    await page.goto(h.url); await page.waitForSelector('.library');
    await page.click('.new-tile'); await page.click('.dialog-f .btn.primary'); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(500);
    await h.reset(page);
    assert(near(await at(500, 500), 255, 255, 255, 2), 'white paper');
  });

  await rep.step('layer opacity and blend modes composite correctly', async () => {
    const a = await fillRect('red', '#ff0000', 300, 300, 400, 400);
    assert(near(await at(500, 500), 255, 0, 0), 'solid red');
    await layer(a, { opacity: 0.5 }); await page.waitForTimeout(150);
    assert(near(await at(500, 500), 255, 128, 128, 8), `50% red over white is pink, got ${await at(500, 500)}`);
    await layer(a, { opacity: 1, blend: 'multiply' });
    const b = await fillRect('green', '#00ff00', 500, 300, 400, 400); await layer(b, { blend: 'multiply' }); await page.waitForTimeout(150);
    assert(near(await at(600, 500), 0, 0, 0, 6), `red × green multiply = black in the overlap, got ${await at(600, 500)}`);
    assert(near(await at(800, 500), 0, 255, 0, 6), 'green × white = green outside the overlap');
    await h.reset(page);
  });

  await rep.step('clipping mask confines a layer to the pixels beneath it', async () => {
    await fillRect('base', '#0000ff', 400, 300, 300, 300);
    const clip = await fillRect('clipped', '#ffff00', 300, 200, 800, 600); await layer(clip, { clip: true }); await page.waitForTimeout(150);
    assert(near(await at(500, 400), 255, 255, 0), `yellow inside the base shape (${await at(500, 400)})`);
    assert(near(await at(900, 400), 255, 255, 255, 3), `nothing outside the base shape (${await at(900, 400)})`);
    await h.reset(page);
  });

  await rep.step('adjustment layer (invert) affects everything beneath it, and can be toggled', async () => {
    await fillRect('red', '#ff0000', 300, 300, 300, 300);
    const id = await page.evaluate(async () => { const ed = window.__quarc.ed; ed.transact('adj', () => { ed.page.layers.push({ id: 'adj1', type: 'adjustment', name: 'Invert', visible: true, locked: false, opacity: 1, blend: 'normal', clip: false, alphaLock: false, effects: [], mask: null, maskEnabled: true, adj: { kind: 'invert' } }); }); return 'adj1'; });
    await page.waitForTimeout(200);
    assert(near(await at(400, 400), 0, 255, 255), `inverted red is cyan (${await at(400, 400)})`);
    assert(near(await at(1000, 800), 0, 0, 0, 3), `inverted white is black (${await at(1000, 800)})`);
    await layer(id, { visible: false }); await page.waitForTimeout(150);
    assert(near(await at(400, 400), 255, 0, 0), 'hiding the adjustment restores the image');
    await h.reset(page);
  });

  await rep.step('drop shadow effect paints outside the layer silhouette', async () => {
    const id = await fillRect('box', '#ff8800', 500, 400, 200, 200);
    assert(near(await at(740, 640), 255, 255, 255, 3), 'no shadow yet');
    await layer(id, { effects: [{ id: 'fx1', kind: 'drop-shadow', enabled: true, color: '#000000', opacity: 1, x: 30, y: 30, blur: 0, spread: 0 }] }); await page.waitForTimeout(200);
    const s = await at(720, 620);
    assert(s[0] < 60 && s[1] < 60, `shadow visible below-right of the shape (${s})`);
    assert(near(await at(600, 500), 255, 136, 0), 'the layer itself is untouched');
    await layer(id, { effects: [{ id: 'fx2', kind: 'stroke', enabled: true, color: '#0000ff', opacity: 1, width: 12, position: 'outside' }] }); await page.waitForTimeout(200);
    const e = await at(494, 500);
    assert(e[2] > 200 && e[0] < 60, `outside stroke is blue (${e})`);
    await shot('50-effects');
    await h.reset(page);
  });

  await rep.step('group opacity applies to the group as a whole', async () => {
    await page.evaluate(() => { const ed = window.__quarc.ed; const mk = (id, color, x) => { const l = { id, type: 'raster', name: id, visible: true, locked: false, opacity: 1, blend: 'normal', clip: false, alphaLock: false, effects: [], mask: null, maskEnabled: true, surface: null }; return l; }; void mk; });
    const a = await fillRect('a', '#000000', 400, 300, 300, 300);
    const b = await fillRect('b', '#000000', 550, 300, 300, 300);
    await page.evaluate(([a, b]) => { const ed = window.__quarc.ed; const la = ed.page.layers.find((l) => l.id === a), lb = ed.page.layers.find((l) => l.id === b); ed.page.layers = [{ id: 'grp', type: 'group', name: 'G', visible: true, locked: false, opacity: 0.5, blend: 'normal', clip: false, alphaLock: false, effects: [], mask: null, maskEnabled: true, expanded: true, passThrough: false, children: [la, lb] }]; ed.changed('layers', 'doc'); }, [a, b]);
    await page.waitForTimeout(200);
    const overlap = await at(600, 400), single = await at(450, 400);
    assert(near(overlap, 128, 128, 128, 6) && near(single, 128, 128, 128, 6), `isolated group: overlap equals single (${overlap} vs ${single})`);
    await h.reset(page);
  });

  await rep.step('symmetry drawing mirrors strokes across the axis', async () => {
    await h.reset(page);
    await h.cmd(page, 'view.symmetry');
    await h.ev(page, (ed) => { ed.setFg('#000000'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 40, hardness: 1, flow: 1, opacity: 1 }); ed.setTool('brush'); });
    await h.stroke(page, [[-300, -100], [-100, 80]], { steps: 10 });
    const sides = await h.ev(page, (ed) => { const c = ed.layer.surface.canvas; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let l = 0, r = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 128) (x < c.width / 2 ? l++ : r++); return { l, r }; });
    assert(sides.l > 1000 && Math.abs(sides.l - sides.r) / sides.l < 0.05, `left ${sides.l} ≈ right ${sides.r}`);
    await shot('51-symmetry');
    await h.cmd(page, 'view.symmetry');
  });

  await rep.step('radial symmetry creates N copies', async () => {
    await h.reset(page);
    await h.ev(page, (ed) => { ed.doc.symmetry = { enabled: true, mode: 'radial', axes: 6, cx: 0, cy: 0 }; ed.setBrush({ size: 30 }); });
    await h.stroke(page, [[40, -40], [140, -90]], { steps: 8 });
    const n = await h.pixels(page);
    await h.reset(page); await h.ev(page, (ed) => { ed.doc.symmetry.enabled = false; });
    await h.stroke(page, [[40, -40], [140, -90]], { steps: 8 });
    const one = await h.pixels(page);
    assert(n > one * 5.4 && n < one * 6.2, `6-fold symmetry paints ~6× the pixels (${n} vs ${one})`);
  });

  await rep.step('perspective guides: 2-point and 3-point layouts', async () => {
    await h.cmd(page, 'view.perspective');
    let p = await h.ev(page, (ed) => ed.doc.perspective);
    assert(p.enabled && p.points.length === 2, 'two vanishing points by default');
    await page.evaluate(() => window.__quarc.ed.doc.perspective.points.push({ x: 960, y: 2400 }));
    await h.ev(page, (ed) => ed.changed('doc', 'view')); await page.waitForTimeout(200);
    await shot('57-perspective');
    await h.cmd(page, 'view.perspective');
    assert(!(await h.ev(page, (ed) => ed.doc.perspective.enabled)), 'toggled off');
  });

  await rep.step('command palette finds and runs commands', async () => {
    await page.keyboard.press('Control+k'); await page.waitForSelector('.palette input');
    await page.keyboard.type('new pixel layer');
    await page.waitForTimeout(150);
    const before = await h.ev(page, (ed) => ed.page.layers.length);
    await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    assert((await h.ev(page, (ed) => ed.page.layers.length)) === before + 1, 'palette ran “New pixel layer”');
    await page.keyboard.press('Control+k'); await page.keyboard.type('gaussian'); await page.waitForTimeout(150);
    await shot('52-palette'); await page.keyboard.press('Escape');
  });

  await rep.step('keyboard shortcuts: tool keys, brush size, colour swap', async () => {
    await page.locator('canvas.overlay').click({ position: { x: 20, y: 20 } });
    await page.keyboard.press('e'); assert((await h.ev(page, (ed) => ed.toolId)) === 'eraser', 'E → eraser');
    await page.keyboard.press('b'); assert((await h.ev(page, (ed) => ed.toolId)) === 'brush', 'B → brush');
    const s0 = await h.ev(page, (ed) => ed.brush.size); await page.keyboard.press(']'); await page.keyboard.press(']');
    assert((await h.ev(page, (ed) => ed.brush.size)) > s0, ']] enlarges the brush');
    const fg = await h.ev(page, (ed) => ed.fg), bg = await h.ev(page, (ed) => ed.bg); await page.keyboard.press('x');
    assert((await h.ev(page, (ed) => ed.fg)) === bg && (await h.ev(page, (ed) => ed.bg)) === fg, 'X swaps colours');
    await page.keyboard.press('m'); assert((await h.ev(page, (ed) => ed.toolId)) === 'marquee-rect', 'M → marquee');
    await page.keyboard.press('m'); assert((await h.ev(page, (ed) => ed.toolId)) === 'marquee-ellipse', 'M again cycles to ellipse');
    await page.keyboard.press('Control+a'); assert(await h.ev(page, (ed) => ed.hasSelection), 'Ctrl+A selects all');
    await page.keyboard.press('Control+d'); assert(!(await h.ev(page, (ed) => ed.hasSelection)), 'Ctrl+D deselects');
  });

  await rep.step('guides can be dragged out of the ruler; space+drag pans; pixel grid at high zoom', async () => {
    const box = await page.locator('.ruler.h').boundingBox(); const vp = await page.locator('.viewport').boundingBox();
    await page.mouse.move(box.x + 300, box.y + 10); await page.mouse.down(); await page.mouse.move(vp.x + 400, vp.y + 300, { steps: 8 }); await page.mouse.up();
    assert((await h.ev(page, (ed) => ed.page.guides.length)) === 1, 'guide created');
    const c0 = await h.ev(page, (ed) => ed.view.cx);
    await page.keyboard.down('Space'); const c = await h.center(page);
    await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(c.x + 100, c.y, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Space');
    assert((await h.ev(page, (ed) => ed.view.cx)) < c0 - 100, 'space-drag panned the view');
    await h.ev(page, (ed) => { ed.zoomTo(12); }); await page.waitForTimeout(250); await shot('53-pixelgrid');
    await h.ev(page, (ed) => ed.fitPage());
  });

  await rep.step('themes: light and midnight render, preferences dialog opens', async () => {
    await h.cmd(page, 'theme.light'); await page.waitForTimeout(300); await shot('54-light');
    assert((await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'light', 'light theme applied');
    await h.cmd(page, 'theme.midnight'); await page.waitForTimeout(300); await shot('55-midnight');
    await h.cmd(page, 'theme.dark');
    await page.keyboard.press('F1'); await page.waitForSelector('.dialog'); await shot('56-shortcuts'); await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  });

  await rep.step('history panel jumps to any earlier state', async () => {
    await h.reset(page);
    await h.ev(page, (ed) => { ed.setFg('#cc0000'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 30, hardness: 1, flow: 1, opacity: 1 }); });
    for (let i = 0; i < 3; i++) await h.stroke(page, [[-100, -60 + i * 50], [100, -60 + i * 50]], { steps: 6 });
    const full = await h.pixels(page);
    await page.evaluate(() => window.__quarc.ed.setStatus(''));
    await h.ev(page, (ed) => { ed.history.jumpTo(ed.history.currentIndex - 2); ed.changed('doc', 'layers'); });
    const one = await h.pixels(page);
    assert(one < full * 0.6 && one > 0, `jumping back removed two strokes (${one} < ${full})`);
    await h.ev(page, (ed) => { ed.history.jumpTo(ed.history.items.length); ed.changed('doc', 'layers'); });
    assert((await h.pixels(page)) === full, 'jumping forward restores everything');
  });
}
