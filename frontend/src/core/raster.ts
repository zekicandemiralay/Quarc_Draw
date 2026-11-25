// RasterSurface: a lazily-allocated pixel canvas used for raster layers and masks.

import type { Rect } from './geometry';
import { createCanvas, ctx2d } from './util';

/** Pixels saved for undo / redo: a rectangle of an atlas canvas that starts at (x, y). */
export interface PatchPixels { canvas: HTMLCanvasElement; x: number; y: number }

export class RasterSurface {
  width: number;
  height: number;
  /** bumped on every pixel change – used for render/serialisation caches */
  version = 0;
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;

  constructor(w: number, h: number, canvas?: HTMLCanvasElement) {
    this.width = Math.max(1, Math.round(w));
    this.height = Math.max(1, Math.round(h));
    if (canvas) { this._canvas = canvas; this.width = canvas.width; this.height = canvas.height; }
  }

  /** true when no pixels were ever allocated (blank layers cost nothing) */
  get isBlank() { return this._canvas === null; }
  /** the underlying canvas (allocates on first use) */
  get canvas(): HTMLCanvasElement {
    if (!this._canvas) this._canvas = createCanvas(this.width, this.height);
    return this._canvas;
  }
  /** canvas if allocated, else null (for read-only paths that can skip blank layers) */
  peek(): HTMLCanvasElement | null { return this._canvas; }
  /**
   * Drawing context. Everything that draws on a layer goes through here, so asking for it counts as a change: caches keyed
   * on `version` (saved PNGs, the brush's reusable stroke preview) can then never show stale pixels, even for code that
   * forgets to call `touch()`. The surface's own read-only helpers use `c2d`, which does not.
   */
  get ctx(): CanvasRenderingContext2D { this.version++; return this.c2d; }
  private get c2d(): CanvasRenderingContext2D {
    if (!this._ctx || this._ctx.canvas !== this._canvas) this._ctx = ctx2d(this.canvas);
    return this._ctx;
  }
  touch() { this.version++; }

  get bounds(): Rect { return { x: 0, y: 0, w: this.width, h: this.height }; }

  getPatch(r: Rect): ImageData {
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
    if (!this._canvas) return new ImageData(w, h);
    return this.c2d.getImageData(x, y, w, h);
  }
  /**
   * Copy rectangles of this surface into ONE new canvas (stacked on top of each other) and say where each went.
   * It stays on the graphics card: reading pixels back (`getImageData`) makes the browser move the whole layer out of GPU
   * memory — a stall of 100+ ms on a tablet, right when the pen lifts — and this does not.
   */
  snapshotRects(rects: Rect[]): PatchPixels[] {
    const atlas = createCanvas(Math.max(1, ...rects.map((r) => Math.round(r.w))), Math.max(1, rects.reduce((n, r) => n + Math.round(r.h), 0)));
    const a = ctx2d(atlas);
    let y = 0;
    return rects.map((r) => {
      const w = Math.round(r.w), h = Math.round(r.h);
      if (this._canvas) a.drawImage(this._canvas, Math.round(r.x), Math.round(r.y), w, h, 0, y, w, h);
      const p = { canvas: atlas, x: 0, y }; y += h; return p;
    });
  }
  /** put saved pixels back, replacing whatever is there (no blending) */
  putPixels(r: Rect, src: ImageData | PatchPixels) {
    if (src instanceof ImageData) { this.putPatch(r, src); return; }
    const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    this.ctx.clearRect(x, y, w, h);
    this.ctx.drawImage(src.canvas, src.x, src.y, w, h, x, y, w, h);
    this.version++;
  }
  putPatch(r: Rect, data: ImageData) {
    const x = Math.round(r.x), y = Math.round(r.y);
    // putImageData replaces pixels (no blending) which is exactly what undo needs.
    this.ctx.putImageData(data, x, y);
    this.version++;
  }
  clear(r?: Rect) {
    if (!this._canvas) return;
    if (r) this.ctx.clearRect(r.x, r.y, r.w, r.h); else this.ctx.clearRect(0, 0, this.width, this.height);
    this.version++;
  }
  clone(): RasterSurface {
    const s = new RasterSurface(this.width, this.height);
    if (this._canvas) { s.canvas; s.ctx.drawImage(this._canvas, 0, 0); }
    return s;
  }
  /** Replace contents with the given canvas (same or different size). */
  setFromCanvas(c: HTMLCanvasElement) {
    this._canvas = c; this._ctx = null; this.width = c.width; this.height = c.height; this.version++;
  }
  /** Resize to a new size, drawing old content using the provided transform (default: top-left anchored). */
  resized(newW: number, newH: number, draw?: (ctx: CanvasRenderingContext2D, old: HTMLCanvasElement) => void): RasterSurface {
    const s = new RasterSurface(newW, newH);
    if (this._canvas) {
      s.canvas;
      if (draw) draw(s.ctx, this._canvas); else s.ctx.drawImage(this._canvas, 0, 0);
    }
    return s;
  }
  /** Does any pixel have alpha > 0? Reads the layer in strips and stops at the first painted one, so a painted layer is quick to confirm. */
  hasContent(): boolean {
    if (!this._canvas) return false;
    const STRIP = 128;
    for (let y = 0; y < this.height; y += STRIP) {
      const h = Math.min(STRIP, this.height - y);
      const d = this.c2d.getImageData(0, y, this.width, h).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    }
    return false;
  }
  /** tight bounding rect of non-transparent pixels (or null if empty) */
  contentBounds(alphaThreshold = 0): Rect | null {
    if (!this._canvas) return null;
    const { data, width, height } = this.c2d.getImageData(0, 0, this.width, this.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > alphaThreshold) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  approxBytes() { return this._canvas ? this.width * this.height * 4 : 0; }
}
