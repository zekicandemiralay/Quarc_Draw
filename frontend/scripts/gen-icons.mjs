// Generates the PWA / favicon sizes from ../logo.png using the browser canvas (no native image libraries needed).
//   node scripts/gen-icons.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let browser;
for (const opts of [{ channel: 'msedge' }, { channel: 'chrome' }]) { try { browser = await chromium.launch({ headless: true, ...opts }); break; } catch { /* try next */ } }
if (!browser) throw new Error('Install Microsoft Edge or Google Chrome to generate icons');
const page = await browser.newPage();
const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, '..', 'logo.png')).toString('base64');
const out = await page.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const mk = (s) => { const c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, s, s); return c.toDataURL('image/png').split(',')[1]; };
  return { 'icon-192.png': mk(192), 'apple-touch-icon.png': mk(180), 'favicon-32.png': mk(32) };
}, logo);
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
for (const [name, b64] of Object.entries(out)) fs.writeFileSync(path.join(root, 'public', name), Buffer.from(b64, 'base64'));
await browser.close();
console.log('wrote', Object.keys(out).join(', '));
