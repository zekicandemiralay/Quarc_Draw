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

  for (const view of ['plain view', 'rotated 28° and zoomed out']) await rep.step(`a stroke repaints only what it touches, and the screen matches a full repaint (${view})`, async () => {
    await h.reset(page);
    await h.ev(page, (ed, rotated) => { ed.view.resetRotation(); ed.fitPage(); if (rotated) { ed.view.rotateAt({ x: ed.view.width / 2, y: ed.view.height / 2 }, (28 * Math.PI) / 180); ed.view.zoomAt({ x: ed.view.width / 2, y: ed.view.height / 2 }, ed.view.zoom * 0.8); } ed.changed('view'); }, view !== 'plain view');
    await page.waitForTimeout(150);
    // layers: red, green (multiply) and four more below the empty layer we paint on, and a translucent blue overlay ABOVE it
    for (const [i, col] of ['#ffee00', '#00eeff', '#ee00ff', '#888888'].entries()) await fillRect('under' + i, col, 100 + i * 120, 100 + i * 60, 300, 300);
    await fillRect('red', '#ff0000', 300, 250, 500, 500);
    const g = await fillRect('green', '#00ff00', 500, 300, 500, 500); await layer(g, { blend: 'multiply' });
    const paint = await fillRect('paint', '#000000', 0, 0, 0, 0);
    const top = await fillRect('top', '#3366ff', 250, 200, 900, 600); await layer(top, { blend: 'overlay', opacity: 0.6 });
    await h.ev(page, (ed, id) => { ed.setActiveLayer(id); ed.setFg('#aa00ff'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 36, hardness: 1, flow: 1, opacity: 1 }); }, paint);
    const c = await h.center(page);
    const r = await page.evaluate(async ([cx, cy]) => {
      const el = document.querySelector('canvas.overlay'), main = document.querySelector('.viewport canvas:not(.overlay)'), rd = window.__quarc.renderer;
      const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 5, pointerType: 'pen', isPrimary: true, clientX: cx + x, clientY: cy + y, pressure: type === 'pointerup' ? 0 : 0.6, buttons: type === 'pointerup' ? 0 : 1, button: 0 });
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      let fullRenders = 0, rectRenders = 0;
      const rf = rd.render.bind(rd), rr = rd.renderRect.bind(rd);
      rd.render = () => { fullRenders++; return rf(); };
      rd.renderRect = (...a) => { const ok = rr(...a); if (ok) rectRenders++; return ok; };
      // Reading the canvas back can move it from GPU to CPU drawing, and the two blur the page's drop shadow a little differently
      // (a few levels along the page edge). Settle that first, so that only the incremental repainting is under test.
      main.getContext('2d').getImageData(0, 0, 1, 1); rd.render();
      el.dispatchEvent(mk('pointerdown', -150, -40)); await frame();
      for (let i = 1; i <= 40; i++) { el.dispatchEvent(mk('pointermove', -150 + i * 8, -40 + Math.sin(i / 5) * 60)); await frame(); }
      const during = { fullRenders, rectRenders, cached: !!rd.cache };
      const grab = () => main.getContext('2d').getImageData(0, 0, main.width, main.height).data;
      const partial = grab();            // what the incremental repaints produced
      rd.render = rf; rd.render();        // a full repaint of the very same state
      const full = grab();
      let maxDiff = 0, differing = 0, bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1, sample = null;
      for (let i = 0; i < full.length; i++) {
        const d = Math.abs(full[i] - partial[i]); if (d > maxDiff) maxDiff = d;
        if (d > 3) { differing++; const px = (i >> 2) % main.width, py = Math.floor((i >> 2) / main.width); bx0 = Math.min(bx0, px); by0 = Math.min(by0, py); bx1 = Math.max(bx1, px); by1 = Math.max(by1, py); if (!sample) sample = { at: [px, py], full: Array.from(full.slice(i & ~3, (i & ~3) + 4)), partial: Array.from(partial.slice(i & ~3, (i & ~3) + 4)) }; }
      }
      const where = differing ? { box: [bx0, by0, bx1, by1], canvas: [main.width, main.height], sample } : null;
      el.dispatchEvent(mk('pointerup', 120, -40)); await frame();
      rd.renderRect = rr;
      return { ...during, maxDiff, differing, where };
    }, [c.x, c.y]);
    assert(r.rectRenders >= 20, `the stroke used incremental repaints (${r.rectRenders}), not full ones (${r.fullRenders})`);
    assert(r.cached, 'the layers under the stroke were cached after a few frames');
    assert(r.differing === 0, `the screen after incremental repaints equals a full repaint to within 8-bit rounding (${r.differing} pixels differ by more than 3, max difference ${r.maxDiff}; ${JSON.stringify(r.where)})`);
    assert((await h.pixels(page)) > 500, 'the stroke was committed to the layer');
    await h.cmd(page, 'edit.undo'); assert((await h.pixels(page)) === 0, 'undo removes the stroke');
    await h.cmd(page, 'edit.redo'); assert((await h.pixels(page)) > 500, 'redo brings it back (the after-pixels were captured at undo time)');
    await h.ev(page, (ed) => { ed.view.resetRotation(); ed.fitPage(); });
    await h.reset(page);
  });

  await rep.step('the brush reuses its canvases between strokes without ever showing stale pixels', async () => {
    await h.reset(page);
    const c = await h.center(page);
    const drive = (kind, pts) => page.evaluate(async ([kind, pts, cx, cy]) => {
      const el = document.querySelector('canvas.overlay');
      const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 6, pointerType: 'pen', isPrimary: true, clientX: cx + x, clientY: cy + y, pressure: type === 'pointerup' ? 0 : 0.6, buttons: type === 'pointerup' ? 0 : 1, button: 0 });
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      if (kind === 'down') { el.dispatchEvent(mk('pointerdown', pts[0][0], pts[0][1])); await frame(); for (const p of pts.slice(1)) { el.dispatchEvent(mk('pointermove', p[0], p[1])); await frame(); } }
      else { const l = pts[pts.length - 1]; el.dispatchEvent(mk('pointerup', l[0], l[1])); await frame(); }
    }, [kind, pts, c.x, c.y]);
    const A = [[-200, -100], [-150, -90], [-100, -100], [-60, -95]], B = [[60, 90], [110, 100], [160, 90], [200, 95]];
    await h.ev(page, (ed) => { ed.setFg('#cc0000'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 30, hardness: 1, flow: 1, opacity: 1 }); });
    await drive('down', A); await drive('up', A);               // stroke A: the layer, its preview and the buffer get created and kept
    const a = await h.pixels(page); assert(a > 500, 'stroke A painted');
    await h.cmd(page, 'select.all'); await h.cmd(page, 'edit.delete'); await h.cmd(page, 'select.none');
    assert((await h.pixels(page)) === 0, 'the layer was cleared by another command in between');
    await drive('down', B);                                      // stroke B starts on the same layer: nothing from A may come back
    const screenAtA = await page.evaluate(([x, y]) => { const ed = window.__quarc.ed; const pm = ed.view.pageMatrix(ed.page), b = document.querySelector('.viewport').getBoundingClientRect(), cv = document.querySelector('.viewport canvas:not(.overlay)'); const wx = (b.width / 2 + x - pm.e) / pm.a, wy = (b.height / 2 + y - pm.f) / pm.d; const sx = Math.round(pm.a * wx + pm.e), sy = Math.round(pm.d * wy + pm.f); return Array.from(cv.getContext('2d').getImageData(Math.round(sx * cv.width / b.width), Math.round(sy * cv.height / b.height), 1, 1).data); }, [-150, -90]);
    assert(near(screenAtA, 255, 255, 255, 6), `stroke A did not reappear while painting B (screen shows ${screenAtA})`);
    await drive('up', B);
    const b = await h.pixels(page);
    assert(b > 500 && Math.abs(b - a) < a * 0.35, `only stroke B is in the layer afterwards (${b} px, A was ${a} px)`);
    await h.cmd(page, 'edit.undo'); assert((await h.pixels(page)) === 0, 'undo removes B and leaves the layer as cleared');
    for (let i = 0; i < 4 && (await h.pixels(page)) !== a; i++) await h.cmd(page, 'edit.undo'); // select / delete are steps of their own
    assert((await h.pixels(page)) === a, 'undoing further restores exactly stroke A');
    for (let i = 0; i < 6 && (await h.pixels(page)) !== b; i++) await h.cmd(page, 'edit.redo');
    assert((await h.pixels(page)) === b, 'redoing brings stroke B back exactly (its after-pixels were captured at undo time)');
    await h.reset(page);
  });
}
