// Vector object geometry, painting, bounds and hit-testing.

import { getStroke } from 'perfect-freehand';
import {
  Bez, Mat, Rect, Vec, IDENTITY, bezFlatten, distToPolyline, mApply, mInvert, mMul, mScaleFactor, mTranslate,
  pointsBounds, rectUnion, rectInflate, transformRectBounds, rad, rectContains, pointInPolygon,
} from './geometry';
import type {
  PathNode, SubPath, VObject, VPath, VText, Paint, StrokeStyle, VInk, FontSpec,
} from './model';
import { blendToComposite } from './model';
import { getImageSync } from './assets';
import { parseColor, rgbaToCss, sampleGradient } from './color';
import { getPattern } from './patterns';
import { uid } from './util';

// ---------------- sub-path generation ----------------
const K = 0.5522847498;
export const node = (x: number, y: number, ix = 0, iy = 0, ox = 0, oy = 0): PathNode => ({ x, y, ix, iy, ox, oy });

function rectSub(x: number, y: number, w: number, h: number, r: number): SubPath {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r === 0) return { closed: true, nodes: [node(x, y), node(x + w, y), node(x + w, y + h), node(x, y + h)] };
  const k = r * (1 - K);
  const c = r * K - r; // handle length relative = r*K
  void k; void c;
  const h_ = r * K;
  return {
    closed: true,
    nodes: [
      node(x + r, y, -h_, 0, 0, 0), node(x + w - r, y, 0, 0, h_, 0),
      node(x + w, y + r, 0, -h_, 0, 0), node(x + w, y + h - r, 0, 0, 0, h_),
      node(x + w - r, y + h, h_, 0, 0, 0), node(x + r, y + h, 0, 0, -h_, 0),
      node(x, y + h - r, 0, h_, 0, 0), node(x, y + r, 0, 0, 0, -h_),
    ],
  };
}
function ellipseSub(cx: number, cy: number, rx: number, ry: number): SubPath {
  const hx = rx * K, hy = ry * K;
  return {
    closed: true,
    nodes: [
      node(cx, cy - ry, -hx, 0, hx, 0), node(cx + rx, cy, 0, -hy, 0, hy),
      node(cx, cy + ry, hx, 0, -hx, 0), node(cx - rx, cy, 0, hy, 0, -hy),
    ],
  };
}
function polygonSub(cx: number, cy: number, r: number, sides: number, rot: number, inner: number): SubPath {
  const pts: PathNode[] = [];
  const n = inner > 0 ? sides * 2 : sides;
  for (let i = 0; i < n; i++) {
    const a = rad(rot) - Math.PI / 2 + (i * 2 * Math.PI) / n;
    const rr = inner > 0 && i % 2 === 1 ? r * inner : r;
    pts.push(node(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr));
  }
  return { closed: true, nodes: pts };
}

const subCache = new WeakMap<object, SubPath[]>();
/** Geometry of an object as bezier sub-paths in its local (pre-transform) space. Empty for text/image/etc. */
export function subpathsOf(o: VObject): SubPath[] {
  const hit = subCache.get(o);
  if (hit) return hit;
  let res: SubPath[] = [];
  switch (o.type) {
    case 'path': res = o.paths; break;
    case 'rect': res = [rectSub(o.x, o.y, o.w, o.h, o.rx)]; break;
    case 'ellipse': res = [ellipseSub(o.cx, o.cy, o.rx, o.ry)]; break;
    case 'polygon': res = [polygonSub(o.cx, o.cy, o.r, o.sides, o.rot, o.inner)]; break;
    case 'line': res = [{ closed: false, nodes: [node(o.x1, o.y1), node(o.x2, o.y2)] }]; break;
    case 'note': res = [rectSub(o.x, o.y, o.w, o.h, 6)]; break;
    case 'image': res = [rectSub(o.x, o.y, o.w, o.h, 0)]; break;
    default: res = [];
  }
  subCache.set(o, res);
  return res;
}

export function subpathToPath2D(sp: SubPath, into: Path2D = new Path2D()): Path2D {
  const n = sp.nodes;
  if (!n.length) return into;
  into.moveTo(n[0].x, n[0].y);
  const seg = (a: PathNode, b: PathNode) => {
    if (a.ox === 0 && a.oy === 0 && b.ix === 0 && b.iy === 0) into.lineTo(b.x, b.y);
    else into.bezierCurveTo(a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y);
  };
  for (let i = 0; i < n.length - 1; i++) seg(n[i], n[i + 1]);
  if (sp.closed && n.length > 1) { seg(n[n.length - 1], n[0]); into.closePath(); }
  return into;
}
export function subpathSegments(sp: SubPath): Bez[] {
  const n = sp.nodes, out: Bez[] = [];
  const mk = (a: PathNode, b: PathNode): Bez => ({
    p0: { x: a.x, y: a.y }, c1: { x: a.x + a.ox, y: a.y + a.oy }, c2: { x: b.x + b.ix, y: b.y + b.iy }, p1: { x: b.x, y: b.y },
  });
  for (let i = 0; i < n.length - 1; i++) out.push(mk(n[i], n[i + 1]));
  if (sp.closed && n.length > 1) out.push(mk(n[n.length - 1], n[0]));
  return out;
}
export function flattenSubpath(sp: SubPath, tol = 0.25): Vec[] {
  const segs = subpathSegments(sp);
  if (!segs.length) return sp.nodes.map((n) => ({ x: n.x, y: n.y }));
  const out: Vec[] = [];
  segs.forEach((s, i) => bezFlatten(s, tol, out, i === 0));
  return out;
}

const localPathCache = new WeakMap<object, Path2D>();
export function localPath2D(o: VObject): Path2D {
  let p = localPathCache.get(o);
  if (!p) {
    p = new Path2D();
    for (const sp of subpathsOf(o)) subpathToPath2D(sp, p);
    localPathCache.set(o, p);
  }
  return p;
}
export function worldPath2D(o: VObject, tf: Mat = o.tf): Path2D {
  const p = new Path2D();
  p.addPath(localPath2D(o), new DOMMatrix([tf.a, tf.b, tf.c, tf.d, tf.e, tf.f]));
  return p;
}

// ---------------- text layout ----------------
export interface TextLine { text: string; x: number; y: number; w: number }
export interface TextLayout { lines: TextLine[]; bounds: Rect; lineH: number }
let measureCtx: CanvasRenderingContext2D | null = null;
const mctx = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);
export const fontString = (f: FontSpec) => {
  const fam = /[,"']/.test(f.family) ? f.family : /\s/.test(f.family) ? `"${f.family}"` : f.family;
  return `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${fam}`;
};
const textCache = new WeakMap<VText, TextLayout>();
export function layoutText(o: VText): TextLayout {
  const hit = textCache.get(o);
  if (hit) return hit;
  const c = mctx();
  c.font = fontString(o.font);
  if ('letterSpacing' in c) (c as any).letterSpacing = `${o.letterSpacing}px`;
  const lineH = o.font.size * o.lineHeight;
  const rawLines = o.text.split('\n');
  const lines: { text: string; w: number }[] = [];
  const maxW = o.boxW;
  for (const raw of rawLines) {
    if (!maxW) { lines.push({ text: raw, w: c.measureText(raw).width }); continue; }
    const words = raw.split(/(\s+)/);
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (c.measureText(test).width > maxW && cur.trim()) { lines.push({ text: cur.trimEnd(), w: c.measureText(cur.trimEnd()).width }); cur = w.trimStart(); }
      else cur = test;
    }
    lines.push({ text: cur, w: c.measureText(cur).width });
  }
  const width = maxW ?? Math.max(1, ...lines.map((l) => l.w));
  const out: TextLine[] = lines.map((l, i) => ({
    text: l.text, w: l.w, y: o.y + i * lineH,
    x: o.align === 'left' ? o.x : o.align === 'center' ? o.x + (width - l.w) / 2 : o.x + width - l.w,
  }));
  const res = { lines: out, lineH, bounds: { x: o.x, y: o.y, w: width, h: Math.max(lineH, lines.length * lineH) } };
  textCache.set(o, res);
  return res;
}

// ---------------- ink ----------------
export const INK_DEFAULTS: Record<VInk['ink'], Pick<VInk, 'size' | 'thinning' | 'smoothing' | 'streamline' | 'taperStart' | 'taperEnd' | 'cap' | 'simulatePressure'> & { opacity: number; blend: 'normal' | 'multiply' }> = {
  pen: { size: 4, thinning: 0.25, smoothing: 0.55, streamline: 0.5, taperStart: 0, taperEnd: 0, cap: true, simulatePressure: true, opacity: 1, blend: 'normal' },
  fountain: { size: 6, thinning: 0.75, smoothing: 0.6, streamline: 0.55, taperStart: 12, taperEnd: 24, cap: true, simulatePressure: true, opacity: 1, blend: 'normal' },
  pencil: { size: 3, thinning: 0.15, smoothing: 0.4, streamline: 0.35, taperStart: 4, taperEnd: 8, cap: true, simulatePressure: true, opacity: 0.8, blend: 'normal' },
  highlighter: { size: 28, thinning: 0, smoothing: 0.5, streamline: 0.6, taperStart: 0, taperEnd: 0, cap: false, simulatePressure: false, opacity: 0.45, blend: 'multiply' },
  marker: { size: 10, thinning: 0.05, smoothing: 0.55, streamline: 0.5, taperStart: 0, taperEnd: 0, cap: true, simulatePressure: false, opacity: 0.95, blend: 'normal' },
  brush: { size: 14, thinning: 0.9, smoothing: 0.6, streamline: 0.5, taperStart: 20, taperEnd: 40, cap: true, simulatePressure: true, opacity: 1, blend: 'normal' },
  calligraphy: { size: 12, thinning: 0.6, smoothing: 0.6, streamline: 0.5, taperStart: 8, taperEnd: 16, cap: false, simulatePressure: true, opacity: 1, blend: 'normal' },
};

const inkCache = new WeakMap<VInk, { k: number; poly: Vec[]; path: Path2D }>();
export function inkPolygon(o: VInk): { poly: Vec[]; path: Path2D } {
  const k = mScaleFactor(o.tf);
  const hit = inkCache.get(o);
  if (hit && hit.k === k) return hit;
  const pts: number[][] = [];
  for (let i = 0; i + 2 < o.pts.length + 0.5; i += 3) {
    const p = mApply(o.tf, { x: o.pts[i], y: o.pts[i + 1] });
    pts.push([p.x, p.y, o.pts[i + 2] ?? 0.5]);
  }
  const outline = getStroke(pts, {
    size: o.size * k, thinning: o.thinning, smoothing: o.smoothing, streamline: o.streamline,
    simulatePressure: o.simulatePressure, last: true,
    start: { taper: o.taperStart * k, cap: o.cap }, end: { taper: o.taperEnd * k, cap: o.cap },
  });
  const poly = outline.map(([x, y]) => ({ x, y }));
  const path = new Path2D();
  if (poly.length > 2) {
    path.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      path.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    path.closePath();
  } else if (poly.length) {
    // single dot
    path.arc(pts[0][0], pts[0][1], (o.size * k) / 2, 0, Math.PI * 2);
  }
  const res = { k, poly, path };
  inkCache.set(o, res);
  return res;
}

// ---------------- bounds ----------------
const boundsCache = new WeakMap<object, Rect>();
export function localGeometryBounds(o: VObject): Rect {
  switch (o.type) {
    case 'text': return layoutText(o).bounds;
    case 'image': case 'note': return { x: o.x, y: o.y, w: o.w, h: o.h };
    case 'ink': {
      const pts: Vec[] = [];
      for (let i = 0; i + 1 < o.pts.length; i += 3) pts.push({ x: o.pts[i], y: o.pts[i + 1] });
      return pointsBounds(pts) ?? { x: 0, y: 0, w: 0, h: 0 };
    }
    case 'markup': {
      let r: Rect | null = null;
      for (const q of o.quads) {
        const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
        const x = Math.min(...xs), y = Math.min(...ys);
        r = rectUnion(r, { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
      }
      return r ?? { x: 0, y: 0, w: 0, h: 0 };
    }
    case 'group': {
      let r: Rect | null = null;
      for (const c of o.children) r = rectUnion(r, objectBounds(c, false));
      return r ?? { x: 0, y: 0, w: 0, h: 0 };
    }
    default: {
      const pts: Vec[] = [];
      for (const sp of subpathsOf(o)) pts.push(...flattenSubpath(sp, 0.5));
      return pointsBounds(pts) ?? { x: 0, y: 0, w: 0, h: 0 };
    }
  }
}
/** Bounds in page space (including transform; optionally inflated by stroke). */
export function objectBounds(o: VObject, withStroke = true): Rect {
  if (o.type === 'ink') {
    const { poly } = inkPolygon(o);
    return pointsBounds(poly) ?? { x: 0, y: 0, w: 0, h: 0 };
  }
  const key = withStroke ? o : null;
  if (key) { const hit = boundsCache.get(key); if (hit) return hit; }
  const lb = o.type === 'group' ? localGeometryBounds(o) : localGeometryBounds(o);
  let r = o.type === 'group' ? lb : transformRectBounds(o.tf, lb);
  if (o.type === 'group') r = transformRectBounds(o.tf, lb);
  if (withStroke && o.stroke) r = rectInflate(r, o.stroke.width / 2 + (o.stroke.join === 'miter' ? o.stroke.width : 0));
  if (key) boundsCache.set(key, r);
  return r;
}
export function objectsBounds(objs: VObject[]): Rect | null {
  let r: Rect | null = null;
  for (const o of objs) r = rectUnion(r, objectBounds(o));
  return r;
}

// ---------------- painting ----------------
const colorCache = new Map<string, string>();
export function cssColor(c: string): string {
  let r = colorCache.get(c);
  if (!r) { r = rgbaToCss(parseColor(c)); if (colorCache.size > 2000) colorCache.clear(); colorCache.set(c, r); }
  return r;
}

function makePaint(ctx: CanvasRenderingContext2D, p: Paint, b: Rect): string | CanvasGradient | CanvasPattern {
  switch (p.kind) {
    case 'solid': return cssColor(p.color);
    case 'linear': {
      const g = ctx.createLinearGradient(b.x + p.x1 * b.w, b.y + p.y1 * b.h, b.x + p.x2 * b.w, b.y + p.y2 * b.h);
      for (const s of [...p.stops].sort((a, c) => a.pos - c.pos)) g.addColorStop(Math.min(1, Math.max(0, s.pos)), cssColor(s.color));
      return g;
    }
    case 'radial': {
      const g = ctx.createRadialGradient(b.x + p.cx * b.w, b.y + p.cy * b.h, 0, b.x + p.cx * b.w, b.y + p.cy * b.h, p.r * Math.max(b.w, b.h));
      for (const s of [...p.stops].sort((a, c) => a.pos - c.pos)) g.addColorStop(Math.min(1, Math.max(0, s.pos)), cssColor(s.color));
      return g;
    }
    case 'pattern': {
      const pat = getPattern(p.pattern, p.color ?? '#000000', ctx);
      if (pat) pat.setTransform(new DOMMatrix().scale(p.scale));
      return pat ?? '#00000000';
    }
  }
}

export function strokeSetup(ctx: CanvasRenderingContext2D, s: StrokeStyle) {
  ctx.strokeStyle = cssColor(s.color);
  ctx.lineWidth = s.width;
  ctx.lineCap = s.cap;
  ctx.lineJoin = s.join;
  ctx.setLineDash(s.dash);
  ctx.miterLimit = 10;
}

function arrowHead(from: Vec, to: Vec, size: number): Vec[] {
  const a = Math.atan2(to.y - from.y, to.x - from.x);
  const s = size;
  return [
    to,
    { x: to.x - s * Math.cos(a - 0.45), y: to.y - s * Math.sin(a - 0.45) },
    { x: to.x - s * Math.cos(a + 0.45), y: to.y - s * Math.sin(a + 0.45) },
  ];
}

export interface DrawOpts { scale: number; selectionOutline?: boolean }

/** Draw an object in page space. ctx must already carry the page→device transform. */
export function drawObject(ctx: CanvasRenderingContext2D, o: VObject, opts: DrawOpts = { scale: 1 }) {
  if (o.hidden) return;
  ctx.save();
  if (o.opacity < 1) ctx.globalAlpha *= o.opacity;
  if (o.blend && o.blend !== 'normal') ctx.globalCompositeOperation = blendToComposite(o.blend);
  if (o.shadow) {
    ctx.shadowColor = cssColor(o.shadow.color);
    ctx.shadowBlur = o.shadow.blur * opts.scale;
    ctx.shadowOffsetX = o.shadow.x * opts.scale;
    ctx.shadowOffsetY = o.shadow.y * opts.scale;
  }
  switch (o.type) {
    case 'ink': {
      const { path } = inkPolygon(o);
      ctx.fillStyle = o.fill?.kind === 'solid' ? cssColor(o.fill.color) : '#000';
      ctx.fill(path);
      break;
    }
    case 'text': drawText(ctx, o); break;
    case 'image': {
      const img = getImageSync(o.assetId);
      ctx.save();
      ctx.transform(o.tf.a, o.tf.b, o.tf.c, o.tf.d, o.tf.e, o.tf.f);
      if (img) { ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, o.x, o.y, o.w, o.h); }
      else { ctx.fillStyle = '#8884'; ctx.fillRect(o.x, o.y, o.w, o.h); }
      ctx.restore();
      if (o.stroke) { strokeSetup(ctx, o.stroke); ctx.stroke(worldPath2D(o)); }
      break;
    }
    case 'note': drawNote(ctx, o); break;
    case 'markup': drawMarkup(ctx, o); break;
    case 'group': {
      ctx.save();
      ctx.transform(o.tf.a, o.tf.b, o.tf.c, o.tf.d, o.tf.e, o.tf.f);
      for (const c of o.children) drawObject(ctx, c, opts);
      ctx.restore();
      break;
    }
    default: {
      const lp = localPath2D(o);
      if (o.fill && o.type !== 'line') {
        ctx.save();
        ctx.transform(o.tf.a, o.tf.b, o.tf.c, o.tf.d, o.tf.e, o.tf.f);
        const lb = localGeometryBounds(o);
        ctx.fillStyle = makePaint(ctx, o.fill, lb);
        ctx.fill(lp, o.type === 'path' ? o.fillRule : 'nonzero');
        ctx.restore();
      }
      if (o.stroke && o.stroke.width > 0) {
        strokeSetup(ctx, o.stroke);
        const wp = worldPath2D(o);
        if (o.stroke.align === 'inside' || o.stroke.align === 'outside') {
          ctx.save();
          ctx.lineWidth = o.stroke.width * 2;
          if (o.stroke.align === 'inside') { ctx.clip(wp, o.type === 'path' ? o.fillRule : 'nonzero'); ctx.stroke(wp); }
          else {
            // outside: clip to the inverse of the shape
            const outer = new Path2D(); outer.rect(-1e6, -1e6, 2e6, 2e6); outer.addPath(wp);
            ctx.clip(outer, 'evenodd'); ctx.stroke(wp);
          }
          ctx.restore();
        } else ctx.stroke(wp);
      }
      if (o.type === 'line') {
        const col = o.stroke ? cssColor(o.stroke.color) : '#000';
        const w = o.stroke?.width ?? 2;
        const a = mApply(o.tf, { x: o.x1, y: o.y1 }), b = mApply(o.tf, { x: o.x2, y: o.y2 });
        ctx.fillStyle = col;
        for (const [from, to, on] of [[a, b, o.arrowEnd], [b, a, o.arrowStart]] as [Vec, Vec, boolean][]) {
          if (!on) continue;
          const tri = arrowHead(from, to, Math.max(10, w * 4));
          ctx.beginPath(); ctx.moveTo(tri[0].x, tri[0].y); ctx.lineTo(tri[1].x, tri[1].y); ctx.lineTo(tri[2].x, tri[2].y); ctx.closePath(); ctx.fill();
        }
      }
    }
  }
  ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, o: VText) {
  const lay = layoutText(o);
  ctx.save();
  ctx.transform(o.tf.a, o.tf.b, o.tf.c, o.tf.d, o.tf.e, o.tf.f);
  ctx.font = fontString(o.font);
  ctx.textBaseline = 'top';
  if ('letterSpacing' in ctx) (ctx as any).letterSpacing = `${o.letterSpacing}px`;
  const lb = lay.bounds;
  const fill = o.fill ? makePaint(ctx, o.fill, lb) : null;
  const pad = (lay.lineH - o.font.size) / 2;
  for (const l of lay.lines) {
    if (o.stroke && o.stroke.width > 0) { strokeSetup(ctx, o.stroke); ctx.strokeText(l.text, l.x, l.y + pad); }
    if (fill) { ctx.fillStyle = fill; ctx.fillText(l.text, l.x, l.y + pad); }
    if ((o.underline || o.strike) && fill) {
      ctx.fillStyle = typeof fill === 'string' ? fill : '#000';
      const th = Math.max(1, o.font.size / 14);
      if (o.underline) ctx.fillRect(l.x, l.y + pad + o.font.size * 1.02, l.w, th);
      if (o.strike) ctx.fillRect(l.x, l.y + pad + o.font.size * 0.55, l.w, th);
    }
  }
  ctx.restore();
}

function drawNote(ctx: CanvasRenderingContext2D, o: Extract<VObject, { type: 'note' }>) {
  ctx.save();
  ctx.transform(o.tf.a, o.tf.b, o.tf.c, o.tf.d, o.tf.e, o.tf.f);
  if (o.collapsed) {
    ctx.fillStyle = cssColor(o.color);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    const kc = Math.max(0.5, o.w / 240);
    ctx.beginPath(); ctx.roundRect(o.x, o.y, 30 * kc, 30 * kc, 5 * kc); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 3; i++) ctx.fillRect(o.x + 6 * kc, o.y + (8 + i * 6) * kc, 18 * kc, 2 * kc);
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = cssColor(o.color);
    ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 6); ctx.fill();
    ctx.shadowColor = 'transparent';
    const k = Math.max(0.5, o.w / 240);
    ctx.fillStyle = '#222';
    ctx.font = `${16 * k}px Segoe UI, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    wrapText(ctx, o.text, o.x + 10 * k, o.y + 10 * k, o.w - 20 * k, 20 * k, o.h - 14 * k);
  }
  ctx.restore();
}
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxH: number) {
  let cy = y;
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, cy); cy += lh; line = word; } else line = t;
      if (cy > y + maxH) return;
    }
    ctx.fillText(line, x, cy); cy += lh;
  }
}

function drawMarkup(ctx: CanvasRenderingContext2D, o: Extract<VObject, { type: 'markup' }>) {
  ctx.save();
  ctx.transform(o.tf.a, o.tf.b, o.tf.c, o.tf.d, o.tf.e, o.tf.f);
  const col = cssColor(o.color);
  for (const q of o.quads) {
    const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if (o.kind === 'highlight') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = col; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    } else {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, (y1 - y0) / 14); ctx.lineCap = 'round';
      ctx.beginPath();
      if (o.kind === 'underline') { ctx.moveTo(x0, y1 - 1); ctx.lineTo(x1, y1 - 1); }
      else if (o.kind === 'strike') { const ym = (y0 + y1) / 2; ctx.moveTo(x0, ym); ctx.lineTo(x1, ym); }
      else {
        const amp = Math.max(1.2, (y1 - y0) / 12), step = amp * 2;
        ctx.moveTo(x0, y1 - 1);
        for (let x = x0, up = true; x < x1; x += step, up = !up) ctx.lineTo(Math.min(x + step, x1), y1 - 1 + (up ? -amp : amp));
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------- hit testing ----------------
let hitCtx: CanvasRenderingContext2D | null = null;
const hctx = () => (hitCtx ??= document.createElement('canvas').getContext('2d')!);

export function hitTestObject(o: VObject, p: Vec, tol: number): boolean {
  if (o.hidden) return false;
  const bounds = objectBounds(o);
  if (!rectContains(rectInflate(bounds, tol), p)) return false;
  switch (o.type) {
    case 'ink': {
      const { poly } = inkPolygon(o);
      if (poly.length > 2 && pointInPolygon(p, poly)) return true;
      const pts: Vec[] = [];
      const k = mScaleFactor(o.tf);
      for (let i = 0; i + 1 < o.pts.length; i += 3) pts.push(mApply(o.tf, { x: o.pts[i], y: o.pts[i + 1] }));
      return distToPolyline(p, pts) <= (o.size * k) / 2 + tol;
    }
    case 'text': case 'image': case 'note': case 'markup': {
      const inv = mInvert(o.tf);
      const lp = mApply(inv, p);
      const lb = localGeometryBounds(o);
      if (o.type === 'markup') {
        return o.quads.some((q) => {
          const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
          return rectContains({ x: Math.min(...xs) - tol, y: Math.min(...ys) - tol, w: Math.max(...xs) - Math.min(...xs) + 2 * tol, h: Math.max(...ys) - Math.min(...ys) + 2 * tol }, lp);
        });
      }
      return rectContains(rectInflate(lb, tol / Math.max(0.001, mScaleFactor(o.tf))), lp);
    }
    case 'group': {
      const lp = mApply(mInvert(o.tf), p);
      return o.children.some((c) => hitTestObject(c, lp, tol));
    }
    default: {
      const c = hctx();
      const wp = worldPath2D(o);
      const closedFill = !!o.fill && o.type !== 'line';
      if (closedFill && c.isPointInPath(wp, p.x, p.y, o.type === 'path' ? o.fillRule : 'nonzero')) return true;
      c.lineWidth = Math.max((o.stroke?.width ?? 1), 1) + tol * 2;
      return c.isPointInStroke(wp, p.x, p.y);
    }
  }
}

/** Does the object's bounding box intersect rect r (page space)? Used for marquee selection. */
export function objectIntersectsRect(o: VObject, r: Rect): boolean {
  const b = objectBounds(o);
  return !(b.x > r.x + r.w || b.x + b.w < r.x || b.y > r.y + r.h || b.y + b.h < r.y);
}

// ---------------- conversion / transforms ----------------
export function transformObject<T extends VObject>(o: T, m: Mat): T {
  return { ...o, tf: mMul(m, o.tf) };
}
export function translateObject<T extends VObject>(o: T, dx: number, dy: number): T {
  return transformObject(o, mTranslate(dx, dy));
}
/** Bake the transform into geometry so node edits operate in page space (paths only). */
export function toPathObject(o: VObject): VPath | null {
  if (o.type === 'ink' || o.type === 'text' || o.type === 'image' || o.type === 'group' || o.type === 'markup') return null;
  const paths: SubPath[] = subpathsOf(o).map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n) => {
      const p = mApply(o.tf, { x: n.x, y: n.y });
      const hi = { x: o.tf.a * n.ix + o.tf.c * n.iy, y: o.tf.b * n.ix + o.tf.d * n.iy };
      const ho = { x: o.tf.a * n.ox + o.tf.c * n.oy, y: o.tf.b * n.ox + o.tf.d * n.oy };
      return { x: p.x, y: p.y, ix: hi.x, iy: hi.y, ox: ho.x, oy: ho.y };
    }),
  }));
  return {
    id: o.id, type: 'path', name: o.name, tf: IDENTITY, fill: o.fill, stroke: o.stroke, opacity: o.opacity, blend: o.blend,
    hidden: o.hidden, locked: o.locked, link: o.link, shadow: o.shadow, paths, fillRule: o.type === 'path' ? o.fillRule : 'nonzero',
  };
}
export function cloneObject<T extends VObject>(o: T, deep = true): T {
  const c = { ...o, id: uid('ob') } as T;
  if (c.type === 'group' && deep) (c as any).children = (o as any).children.map((x: VObject) => cloneObject(x));
  return c;
}
export function objectLabel(o: VObject): string {
  if (o.name) return o.name;
  switch (o.type) {
    case 'text': return o.text.split('\n')[0].slice(0, 24) || 'Text';
    case 'ink': return 'Ink stroke';
    case 'markup': return o.quote ? `${o.kind}: ${o.quote.slice(0, 24)}` : o.kind;
    default: return o.type[0].toUpperCase() + o.type.slice(1);
  }
}

/** Resolve a solid paint's color or fallback. */
export const paintColor = (p: Paint | null | undefined, fallback = '#000000'): string => {
  if (!p) return fallback;
  if (p.kind === 'solid') return p.color;
  if (p.kind === 'pattern') return p.color ?? fallback;
  return rgbaToCss(sampleGradient(p.stops, 0.5));
};
