import { startServer, launch, Reporter, shot } from './lib.mjs';

const srv = await startServer();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1480, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const rep = new Reporter(); rep.attach(page);

await rep.step('app loads and shows the library', async () => {
  await page.goto(srv.url);
  await page.waitForSelector('.library', { timeout: 10000 });
  await shot(page, '01-library');
});
await rep.step('create a new 1920x1080 drawing', async () => {
  await page.click('.new-tile');
  await page.waitForSelector('.dialog');
  await shot(page, '02-new-dialog');
  await page.click('.dialog-f .btn.primary');
  await page.waitForSelector('.viewport canvas.overlay', { timeout: 8000 });
  await page.waitForTimeout(600);
  await shot(page, '03-canvas');
});
await rep.step('paint a stroke with the brush', async () => {
  const box = await page.locator('.viewport').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 200, cy);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) await page.mouse.move(cx - 200 + i * 10, cy + Math.sin(i / 4) * 60, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await shot(page, '04-stroke');
});
const ok = rep.summary();
await browser.close(); srv.stop();
process.exit(ok ? 0 : 1);
