// Pixel selection. The mask is a Uint8Array (w*h, 0..255). Mask arrays are immutable –
// every operation returns a new array, which makes history snapshots trivial (just keep the reference).

import type { Rect, Vec } from './geometry';
import { boxBlurMask, morphMask } from '../filters/pixels';
import { createCanvas, ctx2d } from './util';

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';

export class Selection {
  mask: Uint8Array | null = null;
  bounds: Rect | null = null;
  version = 0;
  private _canvas: HTMLCanvasElement | null = null;
  private _canvasVersion = -1;
  private _contours: Vec[][] | null = null;
  private _contoursVersion = -1;

  constructor(public w: number, public h: number) {}

  get isEmpty() { return !this.mask; }

  clone(): Selection {
    const s = new Selection(this.w, this.h);
    s.mask = this.mask; s.bounds = this.bounds; s.version = this.version + 1;
    return s;
  }
  /** raw state for history */
  getState() { return { mask: this.mask, bounds: this.bounds }; }
  setState(st: { mask: Uint8Array | null; bounds: Rect | null }) {
    this.mask = st.mask; this.bounds = st.bounds; this.version++;
  }

  clear() { this.mask = null; this.bounds = null; this.version++; }
  selectAll() {
    this.mask = new Uint8Array(this.w * this.h).fill(255);
    this.bounds = { x: 0, y: 0, w: this.w, h: this.h };
    this.version++;
  }
  valueAt(x: number, y: number): number {
    if (!this.mask) return 255;
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.mask[y * this.w + x];
  }

  private computeBounds(m: Uint8Array): Rect | null {
    const { w, h } = this;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) if (m[row + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Combine a new mask with the current selection using the given mode. */
  combine(next: Uint8Array | null, mode: SelectMode) {
    const n = this.w * this.h;
    const cur = this.mask;
    let out: Uint8Array | null;
    if (mode === 'replace') out = next;
    else if (!cur) out = mode === 'subtract' ? null : next; // nothing to subtract from / intersect with
    else if (!next) out = mode === 'add' ? cur : mode === 'subtract' ? cur : null;
    else {
      out = new Uint8Array(n);
      if (mode === 'add') for (let i = 0; i < n; i++) out[i] = Math.max(cur[i], next[i]);
      else if (mode === 'subtract') for (let i = 0; i < n; i++) out[i] = Math.max(0, cur[i] - next[i]);
      else for (let i = 0; i < n; i++) out[i] = Math.min(cur[i], next[i]);
    }
    if (out) { const b = this.computeBounds(out); if (!b) out = null; this.bounds = b; } else this.bounds = null;
    this.mask = out;
    this.version++;
  }

  /** Select from a drawing callback (antialiased). The callback draws opaque shapes on a page-sized canvas. */
  combineDraw(draw: (ctx: CanvasRenderingContext2D) => void, mode: SelectMode, region?: Rect) {
    const c = createCanvas(this.w, this.h);
    const ctx = ctx2d(c, true);
    ctx.fillStyle = '#000';
    draw(ctx);
    const r = region ?? { x: 0, y: 0, w: this.w, h: this.h };
    const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
    const ww = Math.min(this.w - x, Math.ceil(r.w) + 2), hh = Math.min(this.h - y, Math.ceil(r.h) + 2);
    const out = new Uint8Array(this.w * this.h);
    if (ww > 0 && hh > 0) {
      const id = ctx.getImageData(x, y, ww, hh).data;
      for (let j = 0; j < hh; j++) for (let i = 0; i < ww; i++) out[(y + j) * this.w + x + i] = id[(j * ww + i) * 4 + 3];
    }
    this.combine(out, mode);
  }
  combineRect(r: Rect, mode: SelectMode) { this.combineDraw((c) => c.fillRect(r.x, r.y, r.w, r.h), mode, r); }
  combineEllipse(r: Rect, mode: SelectMode) {
    this.combineDraw((c) => { c.beginPath(); c.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.01, r.w / 2), Math.max(0.01, r.h / 2), 0, 0, Math.PI * 2); c.fill(); }, mode, r);
  }
  combinePolygon(pts: Vec[], mode: SelectMode) {
    if (pts.length < 3) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    this.combineDraw((c) => { c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (const p of pts) c.lineTo(p.x, p.y); c.closePath(); c.fill(); }, mode, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  combinePath(path: Path2D, mode: SelectMode) { this.combineDraw((c) => c.fill(path, 'evenodd'), mode); }

  invert() {
    const n = this.w * this.h, out = new Uint8Array(n);
    if (!this.mask) out.fill(255); else for (let i = 0; i < n; i++) out[i] = 255 - this.mask[i];
    this.mask = out; this.bounds = this.computeBounds(out); if (!this.bounds) this.mask = null;
    this.version++;
  }
  feather(r: number) {
    if (!this.mask || r < 1) return;
    this.mask = boxBlurMask(this.mask, this.w, this.h, r);
    this.bounds = this.computeBounds(this.mask); if (!this.bounds) this.mask = null;
    this.version++;
  }
  grow(r: number) { this.morph(r, true); }
  shrink(r: number) { this.morph(r, false); }
  private morph(r: number, dilate: boolean) {
    if (!this.mask) return;
    this.mask = morphMask(this.mask, this.w, this.h, r, dilate);
    this.bounds = this.computeBounds(this.mask); if (!this.bounds) this.mask = null;
    this.version++;
  }
  /** smooth jagged edges: blur then re-threshold */
  smooth(r: number) {
    if (!this.mask) return;
    const b = boxBlurMask(this.mask, this.w, this.h, r);
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b[i] > 127 ? 255 : 0;
    this.mask = out; this.bounds = this.computeBounds(out); if (!this.bounds) this.mask = null;
    this.version++;
  }
  /** outline-only selection of width r */
  border(r: number) {
    if (!this.mask) return;
    const grown = morphMask(this.mask, this.w, this.h, r, true), shrunk = morphMask(this.mask, this.w, this.h, r, false);
    const out = new Uint8Array(this.mask.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, grown[i] - shrunk[i]);
    this.mask = out; this.bounds = this.computeBounds(out); if (!this.bounds) this.mask = null;
    this.version++;
  }
  translate(dx: number, dy: number) {
    if (!this.mask) return;
    const { w, h } = this, out = new Uint8Array(w * h);
    dx = Math.round(dx); dy = Math.round(dy);
    for (let y = 0; y < h; y++) {
      const sy = y - dy; if (sy < 0 || sy >= h) continue;
      for (let x = 0; x < w; x++) { const sx = x - dx; if (sx >= 0 && sx < w) out[y * w + x] = this.mask[sy * w + sx]; }
    }
    this.mask = out; this.bounds = this.computeBounds(out); if (!this.bounds) this.mask = null;
    this.version++;
  }
  /** build the selection from the alpha channel of a canvas */
  fromCanvasAlpha(c: HTMLCanvasElement, mode: SelectMode, threshold = 0) {
    const id = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array(this.w * this.h);
    const w = Math.min(c.width, this.w), h = Math.min(c.height, this.h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const a = id[(y * c.width + x) * 4 + 3]; out[y * this.w + x] = a > threshold ? a : 0; }
    this.combine(out, mode);
  }
  resize(nw: number, nh: number, ox = 0, oy = 0) {
    if (this.mask) {
      const out = new Uint8Array(nw * nh);
      for (let y = 0; y < this.h; y++) { const ny = y + oy; if (ny < 0 || ny >= nh) continue; for (let x = 0; x < this.w; x++) { const nx = x + ox; if (nx >= 0 && nx < nw) out[ny * nw + nx] = this.mask[y * this.w + x]; } }
      this.mask = out;
    }
    this.w = nw; this.h = nh;
    this.bounds = this.mask ? this.computeBounds(this.mask) : null; if (!this.bounds) this.mask = null;
    this.version++;
  }

  /** alpha-only canvas of the mask (cached) – used for clipping strokes/fills and for Selection→mask */
  maskCanvas(): HTMLCanvasElement | null {
    if (!this.mask) return null;
    if (this._canvas && this._canvasVersion === this.version) return this._canvas;
    const c = this._canvas && this._canvas.width === this.w && this._canvas.height === this.h ? this._canvas : createCanvas(this.w, this.h);
    const ctx = ctx2d(c);
    const id = ctx.createImageData(this.w, this.h), d = id.data, m = this.mask;
    for (let i = 0, j = 3; i < m.length; i++, j += 4) d[j] = m[i];
    ctx.putImageData(id, 0, 0);
    this._canvas = c; this._canvasVersion = this.version;
    return c;
  }

  /** marching-squares outline polylines (page coords) for drawing marching ants */
  contours(): Vec[][] {
    if (!this.mask) return [];
    if (this._contours && this._contoursVersion === this.version) return this._contours;
    const res = traceContours(this.mask, this.w, this.h, this.bounds!);
    this._contours = res; this._contoursVersion = this.version;
    return res;
  }
}

// Edge ids: 0=top 1=right 2=bottom 3=left
const SEG_TABLE: number[][][] = [
  [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 3], [2, 1]], [[0, 2]], [[0, 3]],
  [[0, 3]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], [],
];
function traceContours(mask: Uint8Array, w: number, h: number, b: Rect): Vec[][] {
  const f = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= 128 ? 1 : 0);
  const edgePt = (x: number, y: number, e: number): [number, number] =>
    e === 0 ? [2 * x + 2, 2 * y + 1] : e === 1 ? [2 * x + 3, 2 * y + 2] : e === 2 ? [2 * x + 2, 2 * y + 3] : [2 * x + 1, 2 * y + 2];
  const key = (p: [number, number]) => p[0] * 100003 + p[1];
  const segs = new Map<number, [number, number][]>(); // start key → [endpoint, ...]
  const adj = new Map<number, { p: [number, number]; n: [number, number][] }>();
  const link = (a: [number, number], c: [number, number]) => {
    for (const [p, q] of [[a, c], [c, a]] as [[number, number], [number, number]][]) {
      const k = key(p);
      let e = adj.get(k);
      if (!e) adj.set(k, (e = { p, n: [] }));
      e.n.push(q);
    }
  };
  void segs;
  const x0 = Math.max(-1, b.x - 1), y0 = Math.max(-1, b.y - 1), x1 = Math.min(w - 1, b.x + b.w), y1 = Math.min(h - 1, b.y + b.h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const idx = f(x, y) * 8 + f(x + 1, y) * 4 + f(x + 1, y + 1) * 2 + f(x, y + 1);
    for (const [ea, eb] of SEG_TABLE[idx]) link(edgePt(x, y, ea), edgePt(x, y, eb));
  }
  const used = new Set<string>();
  const ek = (a: [number, number], c: [number, number]) => { const ka = key(a), kc = key(c); return ka < kc ? `${ka}|${kc}` : `${kc}|${ka}`; };
  const out: Vec[][] = [];
  for (const [, start] of adj) {
    for (const first of start.n) {
      if (used.has(ek(start.p, first))) continue;
      const line: [number, number][] = [start.p];
      let prev = start.p, cur = first;
      used.add(ek(prev, cur));
      for (;;) {
        line.push(cur);
        const node = adj.get(key(cur));
        if (!node) break;
        const next = node.n.find((q) => !used.has(ek(cur, q)));
        if (!next) break;
        used.add(ek(cur, next));
        prev = cur; cur = next;
        if (key(cur) === key(start.p)) { line.push(cur); break; }
      }
      // simplify collinear points & convert to page coords (we used doubled coordinates)
      const pts: Vec[] = [];
      for (let i = 0; i < line.length; i++) {
        const p = { x: line[i][0] / 2, y: line[i][1] / 2 };
        if (pts.length >= 2) {
          const a = pts[pts.length - 2], c = pts[pts.length - 1];
          if ((c.x - a.x) * (p.y - c.y) - (c.y - a.y) * (p.x - c.x) === 0) { pts[pts.length - 1] = p; continue; }
        }
        pts.push(p);
      }
      if (pts.length > 1) out.push(pts);
    }
  }
  return out;
}
