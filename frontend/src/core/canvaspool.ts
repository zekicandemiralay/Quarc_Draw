// Reusable scratch canvases to avoid per-frame allocation during compositing.

import { createCanvas } from './util';

const pool: HTMLCanvasElement[] = [];
const MAX_POOL = 12;
/** the pool never holds more than this many pixels (each canvas is a GPU texture; tablets have little memory for them) */
const MAX_POOL_PIXELS = 40e6;
let poolPixels = 0;

export function acquire(w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    if (c.width === w && c.height === h) {
      pool.splice(i, 1); poolPixels -= c.width * c.height;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowColor = 'transparent'; ctx.filter = 'none';
      ctx.clearRect(0, 0, w, h);
      return c;
    }
  }
  return createCanvas(w, h);
}
export function release(c: HTMLCanvasElement) {
  const px = c.width * c.height;
  if (px > MAX_POOL_PIXELS) { c.width = c.height = 1; return; } // too big to keep — free its memory now
  pool.push(c); poolPixels += px;
  while (pool.length > MAX_POOL || poolPixels > MAX_POOL_PIXELS) { const o = pool.shift()!; poolPixels -= o.width * o.height; o.width = o.height = 1; }
}
export function clearPool() { pool.length = 0; poolPixels = 0; }
