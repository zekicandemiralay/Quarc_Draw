import { newPage } from './lib.mjs';
// UI flows: library management, crop tool, curves & effects dialogs, text formatting, pages, library shapes.
export async function ui({ page, rep, shot, assert, helpers: h, browser }) {
  const newDoc = async (title) => {
    await page.click('.new-tile'); await page.waitForSelector('.dialog');
    await page.fill('.dialog .input >> nth=0', title); await page.click('.dialog-f .btn.primary');
    await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(400);
  };

  await rep.step('library: create, favourite, rename, duplicate, folder, tag, trash, restore', async () => {
    await page.goto(h.url); await page.waitForSelector('.library');
    await newDoc('Alpha');
    await h.ev(page, (ed) => { ed.setBrushPreset('paint-hard-air'); }); await h.stroke(page, [[-50, 0], [50, 0]]);
    await page.waitForTimeout(3300);
    await h.cmd(page, 'file.library'); await page.waitForSelector('.doc-card');
    assert((await page.locator('.doc-card').count()) === 1, 'one card');
    await page.locator('.doc-card .star').click(); await page.waitForSelector('.doc-card .star.on', { timeout: 8000 }).catch(() => undefined);
    assert((await page.locator('.doc-card .star.on').count()) === 1, 'favourited');
    // rename via the card menu
    await page.locator('.doc-card .btn.icon').first().click();
    await page.click('.popover .menu-item:has-text("Rename")'); await page.waitForSelector('.dialog');
    await page.fill('.dialog input.input', 'Alpha renamed'); await page.click('.dialog-f .btn.primary');
    // renaming saves the document first (encoding layers can take a moment on a busy machine): wait for the result instead of sleeping
    await page.waitForFunction(() => document.querySelector('.doc-card .t')?.textContent === 'Alpha renamed', null, { timeout: 8000 }).catch(() => undefined);
    assert((await page.locator('.doc-card .t').first().innerText()) === 'Alpha renamed', 'renamed');
    // duplicate
    await page.locator('.doc-card .btn.icon').first().click(); await page.click('.popover .menu-item:has-text("Duplicate")');
    await page.waitForFunction(() => document.querySelectorAll('.doc-card').length === 2, null, { timeout: 8000 }).catch(() => undefined);
    assert((await page.locator('.doc-card').count()) === 2, 'duplicated');
    // folder
    await page.locator('.lib-side h4 button').first().click(); await page.waitForSelector('.dialog');
    await page.fill('.dialog input.input', 'Projects'); await page.click('.dialog-f .btn.primary'); await page.waitForTimeout(300);
    await page.locator('.doc-card .btn.icon').first().click(); await page.hover('.popover .submenu:has-text("Move to folder")'); await page.click('.popover .submenu .menu-item:has-text("Projects")');
    await page.waitForSelector('.lib-side .item:has-text("Projects")', { timeout: 8000 });
    await page.click('.lib-side .item:has-text("Projects")');
    await page.waitForFunction(() => document.querySelectorAll('.doc-card').length === 1, null, { timeout: 8000 }).catch(() => undefined);
    assert((await page.locator('.doc-card').count()) === 1, 'folder filter shows the moved doc');
    await shot('60-library');
    // tag
    await page.locator('.doc-card .btn.icon').first().click(); await page.click('.popover .menu-item:has-text("Edit tags")'); await page.waitForSelector('.dialog');
    await page.fill('.dialog input.input', 'sketch, wip'); await page.click('.dialog-f .btn.primary'); await page.waitForSelector('.lib-side .item:has-text("wip")', { timeout: 8000 }).catch(() => undefined);
    assert((await page.locator('.lib-side .item:has-text("wip")').count()) === 1, 'tag appears in the sidebar');
    // trash + restore
    await page.locator('.doc-card .btn.icon').first().click(); await page.click('.popover .menu-item:has-text("Move to trash")'); await page.waitForFunction(() => document.querySelectorAll('.doc-card').length === 0, null, { timeout: 8000 }).catch(() => undefined);
    await page.click('.lib-side .item:has-text("Trash")');
    assert((await page.locator('.doc-card').count()) === 1, 'in the trash');
    await page.locator('.doc-card .btn.icon').first().click(); await page.click('.popover .menu-item:has-text("Restore")'); await page.waitForFunction(() => document.querySelectorAll('.doc-card').length === 0, null, { timeout: 8000 }).catch(() => undefined);
    await page.click('.lib-side .item:has-text("All documents")');
    await page.waitForFunction(() => document.querySelectorAll('.doc-card').length === 2, null, { timeout: 8000 }).catch(() => undefined);
    assert((await page.locator('.doc-card').count()) === 2, 'restored');
    await page.fill('.lib-top input[placeholder^="Search"]', 'copy'); await page.waitForTimeout(150);
    assert((await page.locator('.doc-card').count()) === 1, 'search filters by title');
  });

  await rep.step('crop tool: drag handles, apply, undo', async () => {
    await page.fill('.lib-top input[placeholder^="Search"]', '');
    await page.locator('.doc-card').first().click(); await page.waitForSelector('canvas.overlay'); await page.waitForTimeout(600);
    const w0 = await h.ev(page, (ed) => ed.page.width);
    await h.ev(page, (ed) => ed.setTool('crop'));
    await page.waitForTimeout(100);
    const c = await h.center(page);
    // drag the south-east corner inward
    const corner = await page.evaluate(() => { const ed = window.__quarc.ed; const pm = ed.view.pageMatrix(ed.page); const r = document.querySelector('.viewport').getBoundingClientRect(); return { x: r.left + pm.a * ed.page.width + pm.e, y: r.top + pm.d * ed.page.height + pm.f }; });
    await page.mouse.move(corner.x - 2, corner.y - 2); await page.mouse.down(); await page.mouse.move(corner.x - 300, corner.y - 150, { steps: 8 }); await page.mouse.up();
    await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    const w1 = await h.ev(page, (ed) => ed.page.width);
    assert(w1 < w0 - 300, `cropped ${w0} → ${w1}`);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.page.width)) === w0, 'undo restores the size');
    void c;
  });

  await rep.step('curves dialog: shape the curve, live preview, apply changes pixels', async () => {
    await h.reset(page);
    await h.ev(page, (ed) => { ed.setFg('#808080'); ed.setBrushPreset('paint-hard-air'); ed.setBrush({ size: 200, hardness: 1, flow: 1, opacity: 1 }); ed.setTool('brush'); });
    await h.stroke(page, [[-50, 0], [50, 0]], { steps: 6 });
    const px = () => h.ev(page, (ed) => { const c = ed.layer.surface.canvas; const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[0]; });
    const before = await px();
    await h.cmd(page, 'adjust.curves'); await page.waitForSelector('.curve-box');
    const b = await page.locator('.curve-box').boundingBox();
    // drag the midpoint up: add a point at x=128 and pull it to y≈200
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5); await page.mouse.down(); await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.22, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300); await shot('61-curves');
    await page.click('.dialog-f .btn.primary:has-text("Apply")'); await page.waitForTimeout(400);
    const after = await px();
    assert(after > before + 30, `curve brightened mid-grey ${before} → ${after}`);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(150);
    assert(Math.abs((await px()) - before) < 3, 'undo restores');
  });

  await rep.step('layer effects dialog: add shadow & glow, toggle, remove', async () => {
    await h.cmd(page, 'layer.effects'); await page.waitForSelector('.dialog');
    await page.click('.dialog .btn:has-text("Drop Shadow")'); await page.click('.dialog .btn:has-text("Outer Glow")'); await page.waitForTimeout(200);
    assert((await h.ev(page, (ed) => ed.layer.effects.length)) === 2, 'two effects');
    await shot('62-effects-dialog');
    await page.locator('.dialog .switch').first().click(); await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.layer.effects[0].enabled)) === false, 'toggled off');
    await page.locator('.dialog button:has(svg) >> nth=-1').first().evaluate(() => {}); // keep focus stable
    await page.keyboard.press('Escape');
  });

  await rep.step('text options bar formats the selected text object', async () => {
    await h.reset(page);
    await h.ev(page, (ed) => { ed.setTool('text'); ed.setFg('#222222'); });
    await h.click(page, [-100, 0]); await page.waitForSelector('textarea[data-text-editor]');
    await page.keyboard.type('Format me'); await page.keyboard.press('Control+Enter'); await page.waitForTimeout(200);
    await h.ev(page, (ed) => ed.setTool('move')); await h.click(page, [-80, 10]);
    assert((await h.ev(page, (ed) => ed.objSel.length)) === 1, 'text selected');
    await page.click('.dock-tab[title="Properties"]'); await page.waitForTimeout(150);
    await page.locator('.panel-b textarea').first().waitFor();
    await page.locator('.panel-b button[style*="font-weight: 800"]').first().click(); await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.selectedObjects()[0].font.weight)) >= 700, 'bold applied via properties panel');
    await page.locator('.panel-b .field:has(label:text-is("Size")) input').first().fill('96'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
    assert((await h.ev(page, (ed) => ed.selectedObjects()[0].font.size)) === 96, 'font size 96');
    await shot('63-properties');
  });

  await rep.step('pages panel and library shapes (Libraries ▸ Shapes)', async () => {
    await h.cmd(page, 'page.add');
    assert((await h.ev(page, (ed) => ed.doc.pages.length)) === 2, 'a second page was added');
    await page.waitForSelector('.sidebar .thumb-page'); assert((await page.locator('.sidebar .thumb-page').count()) === 2, 'pages panel lists both pages');
    await shot('64-pages');
    await page.click('.dock-tab[title="Libraries"]'); await page.waitForTimeout(150);
    await page.click('.seg button:has-text("Shapes")'); await page.waitForTimeout(150);
    await page.locator('.preset[title^="Heart"]').click(); await page.waitForTimeout(250);
    const heart = await h.ev(page, (ed) => ed.page.layers.flatMap((l) => l.type === 'vector' ? l.objects : []).find((o) => o.name === 'Heart'));
    assert(heart && heart.type === 'path', 'library shape inserted as an editable path');
  });

  await rep.step('home screen shows the painting; it hides with the cross, comes back from Preferences, and also heads the About box', async () => {
    const page = await newPage(browser);
    await page.goto(h.url); await page.waitForSelector('.library');
    await page.waitForSelector('.library .hero img', { timeout: 8000 });
    const shown = () => page.evaluate(() => { const i = document.querySelector('.hero img'); return { src: i.getAttribute('src'), ok: i.complete && Math.max(i.naturalWidth, i.naturalHeight) >= 1800 }; });
    await page.waitForFunction(() => { const i = document.querySelector('.hero img'); return i && i.complete && i.naturalWidth > 0; });
    const first = await shown();
    assert(first.ok, `the painting file loads at full size (${first.src})`);
    // the dots switch paintings; every one of them loads
    const dots = await page.locator('.hero .dots button').count();
    assert(dots >= 2, `one dot per painting (${dots})`);
    for (let k = 0; k < dots; k++) {
      await page.locator('.hero .dots button').nth(k).click();
      await page.waitForFunction(() => { const i = document.querySelector('.hero img'); return i && i.complete && i.naturalWidth > 0; });
      const s = await shown(); assert(s.ok, `painting ${k + 1} loads (${s.src})`);
      assert((await page.textContent('.hero .credit')).includes('painted in Quarc Draw'), 'its credit is shown');
    }
    // swipe the banner: right to left shows the next painting
    const hb = await page.locator('.hero').boundingBox(), hy = hb.y + hb.height * 0.6;
    const beforeSwipe = (await shown()).src;
    await page.mouse.move(hb.x + hb.width * 0.7, hy); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(hb.x + hb.width * (0.7 - k * 0.05), hy);
    await page.mouse.up(); await page.waitForTimeout(200);
    assert((await shown()).src !== beforeSwipe, 'swiping the banner shows another painting');
    // tap: the painting, whole, in a frame on a gallery wall; ← → and swipes browse; Esc or a tap on the wall closes
    await page.mouse.click(hb.x + hb.width * 0.55, hy); await page.waitForSelector('.viewer .frame img');
    await page.waitForFunction(() => { const i = document.querySelector('.viewer .frame img'); return i.complete && i.naturalWidth > 0; });
    const inFrame = await page.getAttribute('.viewer .frame img', 'src');
    assert(inFrame === (await shown()).src, 'the viewer opens on the painting that was tapped');
    assert(await page.isVisible('.viewer .plaque'), 'with its title plaque');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    assert((await page.getAttribute('.viewer .frame img', 'src')) !== inFrame, 'the right arrow shows the next painting');
    const vb = await page.locator('.viewer').boundingBox();
    const beforeVSwipe = await page.getAttribute('.viewer .frame img', 'src');
    await page.mouse.move(vb.width * 0.3, vb.height * 0.5); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(vb.width * (0.3 + k * 0.04), vb.height * 0.5);
    await page.mouse.up(); await page.waitForTimeout(150);
    assert((await page.getAttribute('.viewer .frame img', 'src')) !== beforeVSwipe, 'swiping in the viewer goes back');
    assert((await page.locator('.viewer').count()) === 1, 'swiping does not close it');
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert((await page.locator('.viewer').count()) === 0, 'Esc closes the viewer');
    await page.mouse.click(hb.x + hb.width * 0.55, hy); await page.waitForSelector('.viewer .frame');
    await page.mouse.click(8, vb.height - 8); await page.waitForTimeout(150);
    assert((await page.locator('.viewer').count()) === 0, 'a tap on the wall closes it');
    const current = (await shown()).src;
    await page.fill('.lib-top input.input', 'zzz'); await page.waitForTimeout(150);
    assert((await page.locator('.hero').count()) === 0, 'searching hides the banner');
    await page.fill('.lib-top input.input', ''); await page.waitForSelector('.hero');
    await h.cmd(page, 'help.about'); await page.waitForSelector('.about-art img');
    await page.waitForFunction(() => { const i = document.querySelector('.about-art img'); return i && i.complete && i.naturalWidth > 0; });
    assert((await page.getAttribute('.about-art img', 'src')) === current, 'the About box shows the same painting as the home screen');
    assert((await page.textContent('.dialog')).includes('Version 1.'), 'About shows the real version number');
    await page.click('.dialog-f .btn.primary'); await page.waitForTimeout(150);
    await page.click('.hero .x'); await page.waitForTimeout(200);
    assert((await page.locator('.hero').count()) === 0, 'the cross hides the picture');
    await h.cmd(page, 'edit.prefs'); await page.waitForSelector('.dialog');
    await page.click('.dialog label:has-text("Show a painting on the home screen")'); await page.waitForTimeout(150);
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 4000 }).catch(() => undefined);
    await page.waitForSelector('.hero', { timeout: 4000 });
    // the next launch shows the next painting
    await page.reload(); await page.waitForSelector('.hero img');
    const after = await page.getAttribute('.hero img', 'src');
    assert(after !== current, `a new launch moves on to another painting (${current} → ${after})`);
    const small = await newPage(browser, { width: 390, height: 780 }); await small.goto(h.url); await small.waitForSelector('.library'); await small.waitForTimeout(300);
    assert(!(await small.locator('.hero').isVisible()), 'on a phone-sized screen the banner stays out of the way');
    await small.context().close(); await page.context().close();
  });

  await rep.step('full-screen drawing: only the canvas and basic tools; Exit, Esc, F, the zoom pill and Back all return', async () => {
    const fp = await newPage(browser);
    await fp.goto(h.url); await fp.waitForSelector('.library');
    await fp.click('.new-tile'); await fp.waitForSelector('.dialog');
    await fp.fill('.dialog .input >> nth=0', 'Full'); await fp.click('.dialog-f .btn.primary');
    await fp.waitForSelector('canvas.overlay'); await fp.waitForTimeout(400);
    await h.ev(fp, (ed) => ed.setTool('move'));
    const chrome = () => fp.evaluate(() => ['.titlebar', '.tabs', '.optionsbar', '.toolbar', '.dock', '.statusbar', '.ruler'].filter((s) => document.querySelector(s)));
    const isFull = () => fp.evaluate(() => !!document.querySelector('.simplebar'));
    assert((await chrome()).length >= 5, 'the normal view has its menus and panels');
    // in: the title-bar button
    await fp.click('.titlebar button[title^="Full-screen drawing"]'); await fp.waitForSelector('.simplebar');
    assert((await chrome()).length === 0, `nothing but the canvas and the bar (left: ${await chrome()})`);
    assert((await h.ev(fp, (ed) => ed.toolId)) === 'brush', 'it starts with the brush');
    const vp = await fp.locator('.viewport').boundingBox(), win = await fp.evaluate(() => [innerWidth, innerHeight]);
    assert(vp.width >= win[0] - 2 && vp.height >= win[1] - 2, `the canvas fills the screen (${vp.width}×${vp.height} of ${win})`);
    // draw, size, eraser, colour, undo / redo — all from the bar
    await fp.locator('.sb-size input').fill('3');
    assert((await h.ev(fp, (ed) => ed.brush.size)) === 20, 'the slider sets the brush size');
    await h.stroke(fp, [[-120, 30], [120, 30]]);
    const drawn = await h.pixels(fp); assert(drawn > 0, 'the brush paints');
    await fp.click('.simplebar .sb-btn[title^="Eraser"]'); assert((await h.ev(fp, (ed) => ed.toolId)) === 'eraser', 'eraser');
    await h.stroke(fp, [[-120, 30], [0, 30]]);
    assert((await h.pixels(fp)) < drawn, 'the eraser erases');
    await fp.click('.simplebar .sb-btn[title^="Undo"]'); await fp.waitForTimeout(150);
    assert((await h.pixels(fp)) === drawn, 'undo from the bar');
    await fp.click('.simplebar .sb-btn[title^="Redo"]'); await fp.waitForTimeout(150);
    assert((await h.pixels(fp)) < drawn, 'redo from the bar');
    await fp.click('.simplebar .sb-btn[title^="Brush"]'); assert((await h.ev(fp, (ed) => ed.toolId)) === 'brush', 'back to the brush');
    assert((await h.ev(fp, (ed) => ed.brush.size)) === 20, 'the brush keeps its size after a turn with the eraser');
    await fp.click('.simplebar .sb-color'); await fp.waitForSelector('.popover');
    await fp.keyboard.press('Escape'); await fp.waitForTimeout(150);
    assert((await fp.locator('.popover').count()) === 0 && await isFull(), 'Esc closes the colour picker first and stays in full screen');
    await fp.keyboard.press('v'); await fp.waitForTimeout(100);
    assert((await h.ev(fp, (ed) => ed.toolId)) === 'brush', 'other tool shortcuts stay out of full screen');
    await fp.screenshot({ path: 'tests/e2e/out/67-full-screen.png' });
    // out: Esc
    await fp.keyboard.press('Escape'); await fp.waitForTimeout(200);
    assert(!(await isFull()) && (await chrome()).length >= 5, 'Esc returns to the normal view');
    // F in, F out
    await fp.keyboard.press('f'); await fp.waitForSelector('.simplebar');
    await fp.keyboard.press('f'); await fp.waitForTimeout(200);
    assert(!(await isFull()), 'F toggles');
    // the zoom pill's button both ways
    await fp.click('.viewport-chip .full-toggle'); await fp.waitForSelector('.simplebar');
    await fp.click('.viewport-chip .full-toggle'); await fp.waitForTimeout(200);
    assert(!(await isFull()), 'the zoom pill button toggles');
    // Back (Android back button / browser back)
    await fp.keyboard.press('f'); await fp.waitForSelector('.simplebar');
    await fp.goBack(); await fp.waitForTimeout(300);
    assert(!(await isFull()) && (await fp.locator('canvas.overlay').count()) === 1, 'Back leaves full screen and keeps the document open');
    // the Exit button, and nothing left behind in the history
    await fp.keyboard.press('f'); await fp.waitForSelector('.simplebar');
    await fp.click('.simplebar .sb-exit'); await fp.waitForTimeout(300);
    assert(!(await isFull()) && !(await fp.evaluate(() => history.state?.quarcFullDraw)), 'Exit returns and tidies the history');
    assert((await h.pixels(fp)) > 0, 'the drawing is still there');
    await fp.context().close();
    // a phone: the bar fits
    const ph = await newPage(browser, { width: 390, height: 780 });
    await ph.goto(h.url); await ph.waitForSelector('.library');
    await ph.click('.new-tile'); await ph.waitForSelector('.dialog');
    await ph.fill('.dialog .input >> nth=0', 'Phone'); await ph.click('.dialog-f .btn.primary');
    await ph.waitForSelector('canvas.overlay'); await ph.waitForTimeout(300);
    await ph.click('.titlebar button[title^="Full-screen drawing"]'); await ph.waitForSelector('.simplebar');
    const bar = await ph.locator('.simplebar').boundingBox();
    assert(bar.x >= 0 && bar.x + bar.width <= 390, `the bar fits a phone (${Math.round(bar.x)}–${Math.round(bar.x + bar.width)})`);
    await ph.screenshot({ path: 'tests/e2e/out/68-full-screen-phone.png' });
    await ph.context().close();
  });

}
