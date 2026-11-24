// Reusable scratch canvases to avoid per-frame allocation during compositing.

import { createCanvas } from './util';

const pool: HTMLCanvasElement[] = [];
const MAX_POOL = 12;

export function acquire(w: number, h: number): HTMLCanvasElement {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  for (let i = 0; i < pool.length; i++) {
    const c = pool[i];
    if (c.width === w && c.height === h) {
      pool.splice(i, 1);
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
  if (pool.length >= MAX_POOL) pool.shift();
  pool.push(c);
}
export function clearPool() { pool.length = 0; }
