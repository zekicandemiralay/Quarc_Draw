// Geometry primitives: vectors, rects, 2D affine matrices, bezier helpers.

export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export const v = (x = 0, y = 0): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const norm = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const angleOf = (a: Vec) => Math.atan2(a.y, a.x);
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const rectFromPoints = (a: Vec, b: Vec): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
});
export const rectUnion = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a) return b; if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
export const rectIntersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
};
export const rectContains = (r: Rect, p: Vec) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
export const rectInflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const rectCenter = (r: Rect): Vec => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const rectIntersects = (a: Rect, b: Rect) => !(b.x > a.x + a.w || b.x + b.w < a.x || b.y > a.y + a.h || b.y + b.h < a.y);
export const rectRound = (r: Rect): Rect => {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
};
export const rectClampTo = (r: Rect, bounds: Rect): Rect | null => rectIntersect(r, bounds);
export const pointsBounds = (pts: Vec[]): Rect | null => {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Affine matrix [a b c d e f] mapping (x,y) -> (a x + c y + e, b x + d y + f). */
export interface Mat { a: number; b: number; c: number; d: number; e: number; f: number }
export const IDENTITY: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export const mat = (a = 1, b = 0, c = 0, d = 1, e = 0, f = 0): Mat => ({ a, b, c, d, e, f });
export const mMul = (m: Mat, n: Mat): Mat => ({ // m * n  (apply n first, then m)
  a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f,
});
export const mTranslate = (x: number, y: number): Mat => ({ a: 1, b: 0, c: 0, d: 1, e: x, f: y });
export const mScale = (sx: number, sy = sx): Mat => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
export const mRotate = (r: number): Mat => { const c = Math.cos(r), s = Math.sin(r); return { a: c, b: s, c: -s, d: c, e: 0, f: 0 }; };
export const mSkew = (sx: number, sy: number): Mat => ({ a: 1, b: Math.tan(sy), c: Math.tan(sx), d: 1, e: 0, f: 0 });
export const mDet = (m: Mat) => m.a * m.d - m.b * m.c;
export const mInvert = (m: Mat): Mat => {
  const det = mDet(m) || 1e-12;
  return {
    a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det,
  };
};
export const mApply = (m: Mat, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
export const mApplyDir = (m: Mat, p: Vec): Vec => ({ x: m.a * p.x + m.c * p.y, y: m.b * p.x + m.d * p.y });
export const mIsIdentity = (m: Mat) => m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
export const mScaleFactor = (m: Mat) => Math.sqrt(Math.abs(mDet(m)));
export const mRotation = (m: Mat) => Math.atan2(m.b, m.a);
export const mAboutPoint = (m: Mat, p: Vec): Mat => mMul(mTranslate(p.x, p.y), mMul(m, mTranslate(-p.x, -p.y)));
export const setCtxMat = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: Mat) => ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
export const applyCtxMat = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: Mat) => ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
export const rectCorners = (r: Rect): Vec[] => [
  { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
];
export const transformRectBounds = (m: Mat, r: Rect): Rect => pointsBounds(rectCorners(r).map((p) => mApply(m, p)))!;

// ---------- Bezier helpers ----------
export interface Bez { p0: Vec; c1: Vec; c2: Vec; p1: Vec }
export const bezPoint = (b: Bez, t: number): Vec => {
  const u = 1 - t;
  const a = u * u * u, bb = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * b.p0.x + bb * b.c1.x + c * b.c2.x + d * b.p1.x, y: a * b.p0.y + bb * b.c1.y + c * b.c2.y + d * b.p1.y };
};
export const bezSplit = (b: Bez, t: number): [Bez, Bez] => {
  const p01 = lerpV(b.p0, b.c1, t), p12 = lerpV(b.c1, b.c2, t), p23 = lerpV(b.c2, b.p1, t);
  const p012 = lerpV(p01, p12, t), p123 = lerpV(p12, p23, t);
  const m = lerpV(p012, p123, t);
  return [{ p0: b.p0, c1: p01, c2: p012, p1: m }, { p0: m, c1: p123, c2: p23, p1: b.p1 }];
};
export const bezFlatten = (b: Bez, tol = 0.25, out: Vec[] = [], first = true): Vec[] => {
  if (first) out.push(b.p0);
  // flatness test
  const dx = b.p1.x - b.p0.x, dy = b.p1.y - b.p0.y;
  const l = Math.hypot(dx, dy);
  let flat: boolean;
  if (l < 1e-9) flat = dist(b.p0, b.c1) < tol && dist(b.p0, b.c2) < tol;
  else {
    const d1 = Math.abs((b.c1.x - b.p1.x) * dy - (b.c1.y - b.p1.y) * dx) / l;
    const d2 = Math.abs((b.c2.x - b.p1.x) * dy - (b.c2.y - b.p1.y) * dx) / l;
    flat = d1 + d2 < tol;
  }
  if (flat) { out.push(b.p1); return out; }
  const [l1, l2] = bezSplit(b, 0.5);
  bezFlatten(l1, tol, out, false);
  bezFlatten(l2, tol, out, false);
  return out;
};
export const bezBounds = (b: Bez): Rect => pointsBounds(bezFlatten(b, 0.5))!;

/** distance from point to segment */
export const distToSegment = (p: Vec, a: Vec, b: Vec): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
export const distToPolyline = (p: Vec, pts: Vec[], closed = false): number => {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  if (closed && pts.length > 2) best = Math.min(best, distToSegment(p, pts[pts.length - 1], pts[0]));
  return best;
};
export const pointInPolygon = (p: Vec, poly: Vec[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};
export const polygonArea = (poly: Vec[]) => {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return s / 2;
};

/** Ramer–Douglas–Peucker simplification */
export const simplifyPolyline = (pts: Vec[], tol: number): Vec[] => {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx >= 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
};

/** Catmull-Rom → cubic bezier conversion for smooth freehand curves. */
export const catmullToBezier = (pts: Vec[], closed = false, tension = 0.5): Bez[] => {
  const n = pts.length;
  const segs: Bez[] = [];
  if (n < 2) return segs;
  const get = (i: number) => (closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)]);
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const k = tension / 3 * 2;
    segs.push({
      p0: p1,
      c1: { x: p1.x + (p2.x - p0.x) * k / 2 * 1, y: p1.y + (p2.y - p0.y) * k / 2 * 1 },
      c2: { x: p2.x - (p3.x - p1.x) * k / 2 * 1, y: p2.y - (p3.y - p1.y) * k / 2 * 1 },
      p1: p2,
    });
  }
  return segs;
};

export const snap = (x: number, step: number) => Math.round(x / step) * step;
export const roundTo = (x: number, d = 2) => { const m = 10 ** d; return Math.round(x * m) / m; };
export const nearlyEqual = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
