// Brush engine: dab-based raster painting.
//
// A stroke renders into a private buffer (paint/erase) or a working copy (smudge/blur/…) and produces a `preview`
// canvas that the renderer shows in place of the layer. On commit the dirty region is written to the layer surface
// and a before/after patch is returned for undo.

import type { Mat, Rect, Vec } from '../core/geometry';
import { mApply, mRotation, mDet, rectRound, rectUnion, rectIntersect, rad, clamp, lerp } from '../core/geometry';
import type { BlendMode } from '../core/model';
import { blendToComposite } from '../core/model';
import { acquire, release } from '../core/canvaspool';
import type { RasterSurface, PatchPixels } from '../core/raster';
import { createCanvas, ctx2d, rng } from '../core/util';
import { gaussianBlur, sharpen3 } from '../filters/pixels';
import { parseColor, rgbaToCss, mix, type RGBA } from '../core/color';

export type BrushMode = 'paint' | 'erase' | 'smudge' | 'blur' | 'sharpen' | 'dodge' | 'burn' | 'clone';
export type TipKind = 'round' | 'square' | 'bristle' | 'chalk' | 'spray' | 'star' | 'leaf' | 'image';
export type GrainKind = 'none' | 'paper' | 'canvas' | 'rough' | 'noise';

export interface BrushSettings {
  id: string; name: string; category: string;
  mode: BrushMode; tip: TipKind; tipImage?: string;
  size: number; opacity: number; flow: number; hardness: number; spacing: number;
  roundness: number; angle: number; followStroke: boolean;
  scatter: number; count: number; jitterSize: number; jitterOpacity: number; jitterAngle: number;
  pressureSize: number; pressureOpacity: number; minSize: number; velocitySize: number;
  smoothing: number;
  grain: GrainKind; grainDepth: number; grainScale: number;
  blend: BlendMode;
  strength: number; wet: number;
  range: 'shadows' | 'midtones' | 'highlights';
}

export interface InputPoint { x: number; y: number; pressure: number; tiltX: number; tiltY: number; time: number }

export interface StrokeOptions {
  settings: BrushSettings;
  color: string;
  surface: RasterSurface;
  selectionMask: HTMLCanvasElement | null;
  alphaLock: boolean;
  symmetry: Mat[];
  /** override applied size multiplier (UI zoom-independent) */
  sizeScale?: number;
  eraseOverride?: boolean;
  cloneSource?: { canvas: HTMLCanvasElement; dx: number; dy: number } | null;
  /** sampler for wet paint: returns canvas to read colors from (defaults to base) */
  seed?: number;
}

// ---------- tip & grain caches ----------
const tipCache = new Map<string, HTMLCanvasElement>();
const grainCache = new Map<string, HTMLCanvasElement>();
const imageTips = new Map<string, HTMLImageElement>();

export function registerImageTip(id: string, img: HTMLImageElement) { imageTips.set(id, img); }

function makeTip(kind: TipKind, hardness: number, color: string, res: number, imageId?: string): HTMLCanvasElement {
  const key = `${kind}|${hardness.toFixed(2)}|${color}|${res}|${imageId ?? ''}`;
  const hit = tipCache.get(key);
  if (hit) return hit;
  const c = createCanvas(res, res);
  const ctx = ctx2d(c);
  const r = res / 2;
  const rand = rng(1234);
  if (kind === 'round' || kind === 'chalk' || kind === 'spray') {
    if (hardness >= 0.98) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(r, r, r - 0.5, 0, Math.PI * 2); ctx.fill(); }
    else {
      const g = ctx.createRadialGradient(r, r, 0, r, r, r);
      const inner = clamp(hardness, 0, 0.97);
      const col = parseColor(color);
      const stop = (t: number, a: number) => g.addColorStop(clamp(t, 0, 1), rgbaToCss({ ...col, a: col.a * a }));
      stop(0, 1); stop(inner, 1);
      // smooth falloff (gaussian-ish) between inner radius and edge
      const n = 28; // fine steps: with few, overlapping soft dabs add up their kinks at the same radii and show as rings
      for (let i = 1; i <= n; i++) { const t = i / n; const a = (1 - t) ** 2 * (1 + 2 * t); stop(inner + (1 - inner) * t, a); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, res, res);
    }
    if (kind === 'chalk') {
      const id = ctx.getImageData(0, 0, res, res), d = id.data;
      for (let i = 0; i < d.length; i += 4) d[i + 3] *= rand() < 0.42 ? 0.15 + rand() * 0.45 : 0.75 + rand() * 0.25;
      ctx.putImageData(id, 0, 0);
    }
  } else if (kind === 'square') {
    ctx.fillStyle = color; ctx.fillRect(1, 1, res - 2, res - 2);
  } else if (kind === 'bristle') {
    // Each bristle is a short streak lying along the stroke direction (the tip is turned to follow the stroke), so the stamps
    // of a moving brush run together into hairline streaks like real bristles — round bristle marks showed as rows of beads.
    ctx.fillStyle = color;
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (r * 0.72), br = r * (0.035 + rand() * 0.06);
      ctx.globalAlpha = 0.4 + rand() * 0.6;
      ctx.beginPath(); ctx.ellipse(r + Math.cos(a) * d, r + Math.sin(a) * d, br * (3 + rand() * 2.5), br, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (kind === 'star') {
    ctx.fillStyle = color; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r * 0.95; ctx.lineTo(r + Math.cos(a) * rr, r + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  } else if (kind === 'leaf') {
    ctx.fillStyle = color; ctx.beginPath();
    ctx.moveTo(r, res * 0.04); ctx.bezierCurveTo(res * 0.98, res * 0.28, res * 0.9, res * 0.8, r, res * 0.96);
    ctx.bezierCurveTo(res * 0.1, res * 0.8, res * 0.02, res * 0.28, r, res * 0.04); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = res * 0.025; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.moveTo(r, res * 0.12); ctx.lineTo(r, res * 0.9); ctx.stroke();
  } else if (kind === 'image') {
    const img = imageId ? imageTips.get(imageId) : null;
    if (img) {
      // use image luminance*alpha as a stamp shape, tinted with the brush color
      ctx.drawImage(img, 0, 0, res, res);
      const id = ctx.getImageData(0, 0, res, res), d = id.data, col = parseColor(color);
      let opaque = true;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { opaque = false; break; }
      for (let i = 0; i < d.length; i += 4) {
        const lum = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        // images with transparency stamp their alpha; opaque images stamp their darkness
        const a = (d[i + 3] / 255) * (opaque ? 1 - lum : 1);
        d[i] = col.r; d[i + 1] = col.g; d[i + 2] = col.b; d[i + 3] = a * 255;
      }
      ctx.putImageData(id, 0, 0);
    } else { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(r, r, r - 0.5, 0, Math.PI * 2); ctx.fill(); }
  }
  if (tipCache.size > 120) tipCache.clear();
  tipCache.set(key, c);
  return c;
}

/** Alpha grain tile: alpha = (1 - depth) + depth * noise */
export function grainTile(kind: GrainKind, depth: number): HTMLCanvasElement | null {
  if (kind === 'none') return null;
  const key = `${kind}|${depth.toFixed(2)}`;
  const hit = grainCache.get(key);
  if (hit) return hit;
  const S = 256, c = createCanvas(S, S), ctx = ctx2d(c);
  const id = ctx.createImageData(S, S), d = id.data;
  const rand = rng(kind.length * 7919 + 17);
  const base = new Float32Array(S * S);
  const octave = (cell: number, amp: number) => {
    const n = Math.ceil(S / cell), g = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < g.length; i++) g[i] = rand();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const gx = x / cell, gy = y / cell, x0 = Math.floor(gx) % n, y0 = Math.floor(gy) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy), sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = g[y0 * (n + 1) + x0], b = g[y0 * (n + 1) + x1], cc = g[y1 * (n + 1) + x0], dd = g[y1 * (n + 1) + x1];
      base[y * S + x] += amp * (a + (b - a) * sx + (cc - a) * sy + (a - b - cc + dd) * sx * sy);
    }
  };
  if (kind === 'paper') { octave(2, 0.55); octave(4, 0.3); octave(8, 0.15); }
  else if (kind === 'rough') { octave(8, 0.4); octave(16, 0.35); octave(4, 0.25); }
  else if (kind === 'noise') { octave(1, 1); }
  else if (kind === 'canvas') {
    // A woven fabric, not a lattice of dots: warp and weft threads of 8 px that pass over and under each other, each thread a
    // little thicker / brighter than its neighbours, plus fibre noise and slow slubs. (Two sine waves made a perfectly even dot grid.)
    const P = 8, n = S / P;
    const warp = Array.from({ length: n }, () => 0.8 + 0.4 * rand()), weft = Array.from({ length: n }, () => 0.8 + 0.4 * rand());
    const warpShift = Array.from({ length: n }, () => (rand() - 0.5) * 0.18), weftShift = Array.from({ length: n }, () => (rand() - 0.5) * 0.18);
    const slubG = Array.from({ length: 17 * 17 }, () => rand());                  // low-frequency irregularity (16 cells across, wraps)
    const prof = (t: number) => Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.7);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = Math.floor(x / P), j = Math.floor(y / P);
      const fx = (x % P + 0.5) / P + warpShift[i], fy = (y % P + 0.5) / P + weftShift[j];
      const warpOver = ((i + j) & 1) === 0;
      let v = warpOver ? prof(fx) * (0.6 + 0.4 * prof(fy)) * warp[i] : prof(fy) * (0.6 + 0.4 * prof(fx)) * weft[j];
      const gx = x / 16, gy = y / 16, x0 = Math.floor(gx) % 16, y0 = Math.floor(gy) % 16, tx = gx - Math.floor(gx), ty = gy - Math.floor(gy);
      const slub = slubG[y0 * 17 + x0] * (1 - tx) * (1 - ty) + slubG[y0 * 17 + (x0 + 1) % 16] * tx * (1 - ty) + slubG[((y0 + 1) % 16) * 17 + x0] * (1 - tx) * ty + slubG[((y0 + 1) % 16) * 17 + (x0 + 1) % 16] * tx * ty;
      base[y * S + x] = v + (rand() - 0.5) * 0.22 + (slub - 0.5) * 0.3;
    }
  }
  // normalise to 0..1 contrast
  let mn = Infinity, mx = -Infinity;
  for (const v of base) { if (v < mn) mn = v; if (v > mx) mx = v; }
  for (let i = 0; i < S * S; i++) {
    const n = (base[i] - mn) / (mx - mn || 1);
    d[i * 4 + 3] = 255 * (1 - depth + depth * (kind === 'canvas' ? n : n * n * (3 - 2 * n)));
  }
  ctx.putImageData(id, 0, 0);
  grainCache.set(key, c);
  return c;
}

export const DEFAULT_BRUSH: BrushSettings = {
  id: 'pencil-hb', name: 'HB Pencil', category: 'Pencil', mode: 'paint', tip: 'round',
  size: 6, opacity: 1, flow: 0.8, hardness: 0.75, spacing: 0.08, roundness: 1, angle: 0, followStroke: false,
  scatter: 0, count: 1, jitterSize: 0, jitterOpacity: 0, jitterAngle: 0,
  pressureSize: 0.5, pressureOpacity: 0.5, minSize: 0.3, velocitySize: 0, smoothing: 0.2,
  grain: 'paper', grainDepth: 0.35, grainScale: 1, blend: 'normal', strength: 0.6, wet: 0, range: 'midtones',
};

/** One rectangle of an undo step. `after` may be missing: the editor captures it the first time the step is undone. */
export interface PatchTile { rect: Rect; before: ImageData | PatchPixels; after?: ImageData | PatchPixels }
export interface StrokePatch { tiles: PatchTile[] }

// ---------- the two page-sized canvases every stroke needs, kept for the next stroke ----------
// Starting a stroke used to mean: clear and fill two canvases the size of the page (tens of MB each). After a stroke is
// committed its preview is identical to the layer, and the stroke buffer is easy to wipe where it was used — so both are
// kept, and the next stroke on the same layer starts instantly (the preview is only trusted while the layer's version is unchanged).
let spare: { surface: RasterSurface; version: number; preview: HTMLCanvasElement } | null = null;
let spareBuf: HTMLCanvasElement | null = null;
/** let go of the kept canvases (memory pressure, document closed) */
export function releaseStrokeSpares() { if (spare) release(spare.preview); if (spareBuf) release(spareBuf); spare = null; spareBuf = null; }

/** side of the squares a stroke's undo patch is made of */
const PATCH_TILE = 64;

export class BrushStroke {
  readonly s: BrushSettings;
  private o: StrokeOptions;
  private w: number; private h: number;
  readonly preview: HTMLCanvasElement;
  private pctx: CanvasRenderingContext2D;
  private buf: HTMLCanvasElement | null = null;
  private bctx: CanvasRenderingContext2D | null = null;
  private base: HTMLCanvasElement;
  private rgba: RGBA;
  private color: string;
  private rand: () => number;
  private dirty: Rect | null = null;
  /** tiles (PATCH_TILE squares, row-major index) the stroke has changed — the undo patch covers only these, not the whole bounding box */
  private touched = new Set<number>();
  private pending: Rect | null = null;
  private lastPt: InputPoint | null = null;
  private smooth: InputPoint | null = null;
  private ctrl: InputPoint | null = null;
  private m0: InputPoint | null = null;
  private distToNext = 0;
  private lastDir = 0;
  private strokeLen = 0;
  private carry: HTMLCanvasElement | null = null;
  private carryReady = false;
  private direct: boolean;
  private erase: boolean;
  private wetColor: RGBA;
  private released = false;
  private keepPreview = false;
  private beforeCanvas: HTMLCanvasElement | null = null;
  /** scratch space for compositing one flushed region; grows when needed and lives as long as the stroke */
  private scratch: HTMLCanvasElement | null = null;

  constructor(o: StrokeOptions) {
    this.o = o; this.s = o.settings;
    this.w = o.surface.width; this.h = o.surface.height;
    this.base = o.surface.canvas;
    this.color = o.color;
    this.rgba = parseColor(o.color);
    this.wetColor = this.rgba;
    this.rand = rng(o.seed ?? (Math.random() * 1e9) | 0);
    this.erase = o.eraseOverride ?? this.s.mode === 'erase';
    this.direct = ['smudge', 'blur', 'sharpen', 'dodge', 'burn', 'clone'].includes(this.s.mode);
    const kept = spare;
    if (kept && !this.direct && kept.surface === o.surface && kept.version === o.surface.version && kept.preview.width === this.w && kept.preview.height === this.h) {
      this.preview = kept.preview; spare = null; // still the same pixels as the layer: nothing to copy
      this.pctx = this.preview.getContext('2d')!;
    } else {
      if (kept) { release(kept.preview); spare = null; }
      this.preview = acquire(this.w, this.h);
      this.pctx = this.preview.getContext('2d', { willReadFrequently: this.direct })!;
      this.pctx.drawImage(this.base, 0, 0);
    }
    if (!this.direct) {
      if (spareBuf && spareBuf.width === this.w && spareBuf.height === this.h) { this.buf = spareBuf; spareBuf = null; }
      else { if (spareBuf) release(spareBuf); spareBuf = null; this.buf = acquire(this.w, this.h); }
      this.bctx = this.buf.getContext('2d')!;
    } else {
      // keep an immutable copy of the original for selection restore
      this.beforeCanvas = acquire(this.w, this.h);
      this.beforeCanvas.getContext('2d')!.drawImage(this.base, 0, 0);
    }
  }

  // ---- input ----
  begin(p: InputPoint) {
    this.lastPt = p; this.smooth = p; this.ctrl = p; this.m0 = p;
    this.distToNext = 0;
    if (this.s.mode === 'smudge') this.initCarry(p);
    this.stampAt(p, this.s.followStroke ? 0 : 0);
    this.distToNext = this.spacingFor(p);
  }
  move(p: InputPoint) {
    if (!this.smooth) return this.begin(p);
    const k = 1 - Math.min(0.94, this.s.smoothing ** 0.7 * 0.96);
    const sp: InputPoint = {
      x: this.smooth.x + (p.x - this.smooth.x) * k, y: this.smooth.y + (p.y - this.smooth.y) * k,
      pressure: this.smooth.pressure + (p.pressure - this.smooth.pressure) * Math.max(k, 0.35),
      tiltX: p.tiltX, tiltY: p.tiltY, time: p.time,
    };
    this.smooth = sp;
    this.curveTo(sp);
    this.lastPt = p;
  }
  end(p?: InputPoint) {
    if (this.smooth && this.m0 && this.ctrl) {
      const tail = p ?? this.lastPt ?? this.smooth;
      // catch up to the true last point (stabiliser lag)
      const steps = this.s.smoothing > 0.05 ? 4 : 1;
      for (let i = 0; i < steps; i++) {
        const t = (i + 1) / steps;
        this.curveTo({ x: lerp(this.smooth.x, tail.x, t), y: lerp(this.smooth.y, tail.y, t), pressure: lerp(this.smooth.pressure, tail.pressure, t), tiltX: tail.tiltX, tiltY: tail.tiltY, time: tail.time });
      }
      this.lineStep(this.m0, this.ctrl);
    }
    this.flush();
  }

  private curveTo(p: InputPoint) {
    if (!this.ctrl || !this.m0) return;
    const m1: InputPoint = this.midpoint(this.ctrl, p);
    // flatten quadratic (m0, ctrl, m1)
    const len = Math.hypot(this.ctrl.x - this.m0.x, this.ctrl.y - this.m0.y) + Math.hypot(m1.x - this.ctrl.x, m1.y - this.ctrl.y);
    const n = Math.max(1, Math.min(60, Math.ceil(len / 3)));
    let prev = this.m0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      const q: InputPoint = {
        x: u * u * this.m0.x + 2 * u * t * this.ctrl.x + t * t * m1.x,
        y: u * u * this.m0.y + 2 * u * t * this.ctrl.y + t * t * m1.y,
        pressure: lerp(this.m0.pressure, m1.pressure, t), tiltX: m1.tiltX, tiltY: m1.tiltY, time: lerp(this.m0.time, m1.time, t),
      };
      this.lineStep(prev, q);
      prev = q;
    }
    this.m0 = m1; this.ctrl = p;
  }
  private midpoint(a: InputPoint, b: InputPoint): InputPoint {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, pressure: (a.pressure + b.pressure) / 2, tiltX: b.tiltX, tiltY: b.tiltY, time: (a.time + b.time) / 2 };
  }
  private spacingFor(p: InputPoint) {
    const size = this.sizeFor(p, false);
    return Math.max(0.6, this.s.spacing * size);
  }
  private lineStep(a: InputPoint, b: InputPoint) {
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-6) return;
    const dir = Math.atan2(b.y - a.y, b.x - a.x);
    this.lastDir = dir;
    let walked = 0;
    while (this.distToNext <= segLen - walked) {
      walked += this.distToNext;
      const t = walked / segLen;
      const p: InputPoint = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), pressure: lerp(a.pressure, b.pressure, t), tiltX: b.tiltX, tiltY: b.tiltY, time: lerp(a.time, b.time, t) };
      this.stampAt(p, dir);
      this.distToNext = this.spacingFor(p);
    }
    this.distToNext -= segLen - walked;
    this.strokeLen += segLen;
  }

  // ---- dab parameters ----
  private sizeFor(p: InputPoint, jitter = true) {
    const s = this.s;
    let size = s.size * (this.o.sizeScale ?? 1);
    if (s.pressureSize > 0) size *= lerp(1, lerp(s.minSize, 1, clamp(p.pressure, 0, 1)), s.pressureSize);
    if (jitter && s.jitterSize > 0) size *= 1 - this.rand() * s.jitterSize;
    return Math.max(0.5, size);
  }

  private stampAt(p: InputPoint, dir: number) {
    const s = this.s;
    const size = this.sizeFor(p);
    let alpha = s.flow;
    if (s.pressureOpacity > 0) alpha *= lerp(1, clamp(p.pressure, 0, 1) ** 1.2, s.pressureOpacity);
    if (s.jitterOpacity > 0) alpha *= 1 - this.rand() * s.jitterOpacity;
    const baseAngle = rad(s.angle) + (s.followStroke ? dir : 0) + (s.jitterAngle ? (this.rand() - 0.5) * rad(s.jitterAngle) * 2 : 0);
    const count = s.tip === 'spray' || s.count > 1 ? Math.max(1, s.count) : 1;
    for (let n = 0; n < count; n++) {
      let x = p.x, y = p.y;
      if (s.scatter > 0 || s.tip === 'spray') {
        const rr = (s.tip === 'spray' ? size / 2 : s.scatter * size) * Math.sqrt(this.rand());
        const a = this.rand() * Math.PI * 2;
        x += Math.cos(a) * rr; y += Math.sin(a) * rr;
      }
      const ds = s.tip === 'spray' ? Math.max(1, size * 0.045 * (0.6 + this.rand() * 0.9)) : size;
      const da = s.tip === 'spray' ? alpha * (0.4 + this.rand() * 0.6) : alpha;
      const ang = s.jitterAngle && count > 1 ? baseAngle + (this.rand() - 0.5) * rad(s.jitterAngle) : baseAngle;
      for (const M of [null, ...this.o.symmetry]) { // the original stroke plus every mirrored / rotated copy
        let px = x, py = y, pa = ang;
        if (M) {
          const q = mApply(M, { x, y }); px = q.x; py = q.y;
          pa = mDet(M) < 0 ? -ang + mRotation(M) : ang + mRotation(M);
        }
        this.dab(px, py, ds, pa, da);
      }
    }
  }

  private dab(x: number, y: number, size: number, angle: number, alpha: number) {
    const s = this.s;
    const half = size / 2 + 2;
    const r: Rect = { x: x - half, y: y - half, w: half * 2, h: half * 2 };
    this.addDirty(r);
    if (this.direct) return this.directDab(x, y, size, angle, alpha, r);
    const ctx = this.bctx!;
    const res = Math.min(512, Math.max(8, Math.ceil(s.size * (this.o.sizeScale ?? 1) * 1.3)));
    let colorStr = this.color;
    if (!this.erase && s.wet > 0) colorStr = this.pickWet(x, y, size);
    const tip = makeTip(s.tip === 'spray' ? 'round' : s.tip, s.tip === 'spray' ? 0.7 : s.hardness, this.erase ? '#000000' : colorStr, res, s.tipImage);
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    if (s.roundness !== 1) ctx.scale(1, s.roundness);
    ctx.drawImage(tip, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  /** wet paint: slowly blend brush colour with what is on the canvas under the dab */
  private pickWet(x: number, y: number, size: number): string {
    const px = clamp(Math.round(x), 0, this.w - 1), py = clamp(Math.round(y), 0, this.h - 1);
    const d = this.pctx.getImageData(px, py, 1, 1).data;
    if (d[3] > 8) {
      const under: RGBA = { r: d[0], g: d[1], b: d[2], a: 1 };
      this.wetColor = mix(this.wetColor, under, 0.1 * this.s.wet);
    }
    this.wetColor = mix(this.wetColor, this.rgba, 0.04 * (1 - this.s.wet * 0.5));
    void size;
    return rgbaToCss({ ...this.wetColor, a: this.rgba.a });
  }

  // ---- direct (pixel-source) tools ----
  private initCarry(p: InputPoint) {
    const d = Math.ceil(this.sizeFor(p, false)) + 2;
    this.carry = createCanvas(d, d);
    ctx2d(this.carry).drawImage(this.preview, Math.round(p.x - d / 2), Math.round(p.y - d / 2), d, d, 0, 0, d, d);
    this.carryReady = true;
  }
  private directDab(x: number, y: number, size: number, angle: number, alpha: number, r: Rect) {
    const s = this.s;
    const D = Math.max(2, Math.ceil(size));
    const rx = Math.round(x - D / 2), ry = Math.round(y - D / 2);
    const area = rectIntersect({ x: rx, y: ry, w: D, h: D }, { x: 0, y: 0, w: this.w, h: this.h });
    if (!area) return;
    const tip = makeTip('round', s.hardness, '#000', Math.max(8, Math.min(256, D)));
    const stamp = acquire(D, D);
    const sctx = stamp.getContext('2d')!;
    const strength = clamp(s.strength * (this.o.eraseOverride ? 1 : 1) * (0.35 + 0.65 * alpha), 0, 1);
    let modified: HTMLCanvasElement | null = null;

    if (s.mode === 'smudge') {
      if (!this.carry || !this.carryReady) this.initCarry({ x, y, pressure: 1, tiltX: 0, tiltY: 0, time: 0 });
      // lay down carried paint through the soft tip, then pick up what is here
      const carry = this.carry!;
      sctx.drawImage(carry, 0, 0, D, D);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(tip, 0, 0, D, D);
      modified = stamp;
      this.compositeDirect(rx, ry, D, modified, strength, 'source-over');
      // pick-up
      const cc = ctx2d(carry);
      cc.globalAlpha = 1 - clamp(strength, 0.05, 0.95) * 0.85;
      cc.drawImage(this.beforeCanvasOrPreview(), rx, ry, D, D, 0, 0, carry.width, carry.height);
      cc.globalAlpha = 1;
      release(stamp);
      return;
    }
    if (s.mode === 'clone') {
      const src = this.o.cloneSource;
      if (!src) { release(stamp); return; }
      sctx.drawImage(src.canvas, rx + src.dx, ry + src.dy, D, D, 0, 0, D, D);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(tip, 0, 0, D, D);
      this.compositeDirect(rx, ry, D, stamp, clamp(alpha * s.opacity + 0.0, 0, 1), 'source-over');
      release(stamp);
      return;
    }
    if (s.mode === 'blur' || s.mode === 'sharpen') {
      const src = this.pctx.getImageData(rx, ry, D, D);
      const pix = { data: src.data, width: D, height: D };
      if (s.mode === 'blur') gaussianBlur(pix, Math.max(1, D / 10)); else sharpen3(pix, 1.2);
      sctx.putImageData(new ImageData(pix.data, D, D), 0, 0);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(tip, 0, 0, D, D);
      this.compositeDirect(rx, ry, D, stamp, strength, 'source-over');
      release(stamp);
      return;
    }
    if (s.mode === 'dodge' || s.mode === 'burn') {
      const src = this.pctx.getImageData(rx, ry, D, D), d = src.data;
      const tcx = ctx2d(createCanvas(D, D), true);
      tcx.drawImage(tip, 0, 0, D, D);
      const ta = tcx.getImageData(0, 0, D, D).data;
      const k = strength * 0.18 * (s.mode === 'dodge' ? 1 : -1);
      for (let i = 0; i < d.length; i += 4) {
        const w = ta[i + 3] / 255; if (!w || !d[i + 3]) continue;
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        const range = s.range === 'shadows' ? 1 - l : s.range === 'highlights' ? l : 1 - Math.abs(l * 2 - 1);
        const f = 1 + k * w * (0.25 + range);
        d[i] = d[i] * f + (k > 0 ? 255 * (f - 1) * 0.25 : 0); d[i + 1] = d[i + 1] * f + (k > 0 ? 255 * (f - 1) * 0.25 : 0); d[i + 2] = d[i + 2] * f + (k > 0 ? 255 * (f - 1) * 0.25 : 0);
      }
      // write result via selection-aware path
      sctx.putImageData(src, 0, 0);
      this.compositeDirect(rx, ry, D, stamp, 1, 'copy-masked');
      release(stamp);
      return;
    }
    release(stamp);
    void r; void angle;
  }
  private beforeCanvasOrPreview() { return this.preview; }

  /** composite a stamp onto the preview honouring selection + alpha lock */
  private compositeDirect(rx: number, ry: number, D: number, stamp: HTMLCanvasElement, alpha: number, mode: 'source-over' | 'copy-masked') {
    const sctx = stamp.getContext('2d')!;
    if (this.o.selectionMask) {
      sctx.save(); sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(this.o.selectionMask, rx, ry, D, D, 0, 0, D, D);
      sctx.restore();
    }
    if (this.o.alphaLock) {
      sctx.save(); sctx.globalCompositeOperation = 'destination-in';
      sctx.drawImage(this.beforeCanvas ?? this.base, rx, ry, D, D, 0, 0, D, D);
      sctx.restore();
    }
    this.pctx.save();
    void mode; // 'copy-masked' stamps already contain the full modified footprint; draw them over the current pixels
    this.pctx.globalAlpha = alpha;
    this.pctx.drawImage(stamp, rx, ry);
    this.pctx.restore();
  }

  // ---- bookkeeping ----
  private addDirty(r: Rect) {
    this.dirty = rectUnion(this.dirty, r);
    this.pending = rectUnion(this.pending, r);
  }
  get dirtyRect(): Rect | null { return this.dirty; }

  /** Re-composite the pending region into `preview`. Returns the updated rect (page coords) or null. */
  flush(): Rect | null {
    if (!this.pending || this.direct) { const had = this.pending; this.pending = null; if (had) this.markTouched(had); return had; }
    const R0 = rectIntersect(rectRound(this.pending), { x: 0, y: 0, w: this.w, h: this.h });
    this.pending = null;
    if (!R0) return null;
    this.markTouched(R0);
    const R = R0, s = this.s;
    // restore base in region
    this.pctx.clearRect(R.x, R.y, R.w, R.h);
    this.pctx.drawImage(this.base, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    if (!this.scratch || this.scratch.width < R.w || this.scratch.height < R.h) {
      const w = Math.max(R.w, this.scratch?.width ?? 0), h = Math.max(R.h, this.scratch?.height ?? 0);
      if (this.scratch) this.scratch.width = this.scratch.height = 1; // free the old one at once
      this.scratch = createCanvas(Math.ceil(w / 128) * 128, Math.ceil(h / 128) * 128);
    }
    const tmp = this.scratch;
    const tctx = ctx2d(tmp);
    tctx.clearRect(0, 0, R.w, R.h);
    tctx.drawImage(this.buf!, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
    // grain
    const gt = s.grain !== 'none' ? grainTile(s.grain, s.grainDepth) : null;
    if (gt) {
      const pat = tctx.createPattern(gt, 'repeat')!;
      const sc = Math.max(0.25, s.grainScale);
      pat.setTransform(new DOMMatrix().translate(-R.x, -R.y).scale(sc));
      tctx.globalCompositeOperation = 'destination-in'; tctx.fillStyle = pat; tctx.fillRect(0, 0, R.w, R.h);
      tctx.globalCompositeOperation = 'source-over';
    }
    if (this.o.selectionMask) { tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(this.o.selectionMask, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h); tctx.globalCompositeOperation = 'source-over'; }
    if (this.o.alphaLock && !this.erase) { tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(this.base, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h); tctx.globalCompositeOperation = 'source-over'; }
    this.pctx.save();
    this.pctx.globalAlpha = s.opacity;
    this.pctx.globalCompositeOperation = this.erase ? 'destination-out' : blendToComposite(s.blend);
    this.pctx.drawImage(tmp, 0, 0, R.w, R.h, R.x, R.y, R.w, R.h);
    this.pctx.restore();
    return R;
  }

  private markTouched(r: Rect) {
    const cols = Math.ceil(this.w / PATCH_TILE), rows = Math.ceil(this.h / PATCH_TILE);
    const x0 = Math.max(0, Math.floor(r.x / PATCH_TILE)), x1 = Math.min(cols - 1, Math.floor((r.x + r.w - 1) / PATCH_TILE));
    const y0 = Math.max(0, Math.floor(r.y / PATCH_TILE)), y1 = Math.min(rows - 1, Math.floor((r.y + r.h - 1) / PATCH_TILE));
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.touched.add(ty * cols + tx);
  }
  /** the touched tiles as few rectangles: horizontal runs of neighbouring tiles (or one bounding box if there are very many) */
  private touchedRects(): Rect[] {
    if (!this.touched.size) return [];
    const cols = Math.ceil(this.w / PATCH_TILE);
    const rowsMap = new Map<number, number[]>();
    for (const idx of this.touched) { const ty = Math.floor(idx / cols); (rowsMap.get(ty) ?? rowsMap.set(ty, []).get(ty)!).push(idx % cols); }
    const out: Rect[] = [];
    for (const [ty, xs] of [...rowsMap].sort((a, b) => a[0] - b[0])) {
      xs.sort((a, b) => a - b);
      let start = xs[0], prev = xs[0];
      const push = (a: number, b: number) => {
        const x = a * PATCH_TILE, y = ty * PATCH_TILE;
        out.push({ x, y, w: Math.min(this.w, (b + 1) * PATCH_TILE) - x, h: Math.min(this.h, (ty + 1) * PATCH_TILE) - y });
      };
      for (let i = 1; i < xs.length; i++) { if (xs[i] !== prev + 1) { push(start, prev); start = xs[i]; } prev = xs[i]; }
      push(start, prev);
    }
    if (out.length > 48) { // a huge stroke: a few big reads are cheaper than hundreds of small ones
      const all = out.reduce<Rect | null>((u, r) => rectUnion(u, r), null)!;
      return [all];
    }
    return out;
  }

  /**
   * Write the stroke into the layer surface. Returns the undo patch (or null if nothing changed).
   * Only the tiles the stroke touched are read back from the layer — reading a long stroke's whole bounding box off the
   * GPU is what made every pen-up stall on a tablet — and the "after" pixels are captured later, if the step is ever undone.
   */
  commit(): StrokePatch | null {
    this.flush();
    const rects = this.touchedRects();
    if (!rects.length) { this.dispose(); return null; }
    const surf = this.o.surface;
    const saved = surf.snapshotRects(rects); // all copies first (GPU to GPU, no pixel readback), then the write
    const tiles: PatchTile[] = rects.map((rect, i) => ({ rect, before: saved[i] }));
    for (const d of rects) {
      surf.ctx.clearRect(d.x, d.y, d.w, d.h);
      surf.ctx.drawImage(this.preview, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
    }
    surf.touch();
    // the preview now equals the layer: keep it for the next stroke on this layer
    if (!this.direct && !this.released) { spare = { surface: surf, version: surf.version, preview: this.preview }; this.keepPreview = true; }
    this.dispose();
    return { tiles };
  }
  cancel() { this.dispose(); }
  dispose() {
    if (this.released) return;
    this.released = true;
    if (!this.keepPreview) release(this.preview);
    if (this.buf) {
      if (this.pending) this.markTouched(this.pending); // dabs drawn but never flushed (a cancelled stroke) must be wiped too
      // wipe just the tiles the stroke used and keep the buffer for the next stroke
      if (this.bctx && this.touched.size && this.touched.size < 4000) { for (const r of this.touchedRects()) this.bctx.clearRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); if (spareBuf) release(spareBuf); spareBuf = this.buf; }
      else release(this.buf);
    }
    if (this.beforeCanvas) release(this.beforeCanvas);
    if (this.scratch) { this.scratch.width = this.scratch.height = 1; this.scratch = null; }
  }
}

/** Build symmetry matrices (page coordinates) for the current symmetry settings. */
export function symmetryMatrices(sym: { enabled: boolean; mode: string; axes: number; cx: number; cy: number }, pageW: number, pageH: number): Mat[] {
  if (!sym.enabled) return [];
  const cx = pageW / 2 + sym.cx, cy = pageH / 2 + sym.cy;
  const T = (m: Mat): Mat => ({ ...m, e: m.e + cx - (m.a * cx + m.c * cy), f: m.f + cy - (m.b * cx + m.d * cy) });
  const mir = (sx: number, sy: number): Mat => T({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
  const rot = (a: number): Mat => T({ a: Math.cos(a), b: Math.sin(a), c: -Math.sin(a), d: Math.cos(a), e: 0, f: 0 });
  switch (sym.mode) {
    case 'vertical': return [mir(-1, 1)];
    case 'horizontal': return [mir(1, -1)];
    case 'both': return [mir(-1, 1), mir(1, -1), mir(-1, -1)];
    case 'radial': {
      const out: Mat[] = [];
      for (let i = 1; i < sym.axes; i++) out.push(rot((i * Math.PI * 2) / sym.axes));
      return out;
    }
  }
  return [];
}
