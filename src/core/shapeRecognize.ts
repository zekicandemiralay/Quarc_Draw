// Hold-to-snap shape recognition for freehand strokes (line, ellipse, rectangle, triangle/polygon).

import type { Vec } from './geometry';
import { dist, simplifyPolyline, pointsBounds, distToSegment } from './geometry';

export type Recognized =
  | { kind: 'line'; a: Vec; b: Vec }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'poly'; pts: Vec[] };

const pathLen = (pts: Vec[]) => { let l = 0; for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]); return l; };

export function recognizeShape(pts: Vec[]): Recognized | null {
  if (pts.length < 6) return null;
  const len = pathLen(pts);
  const b = pointsBounds(pts)!;
  const diag = Math.hypot(b.w, b.h);
  if (len < 24 || diag < 18) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const closed = dist(first, last) < Math.max(0.2 * len / 2, 14);

  if (!closed) {
    const chord = dist(first, last);
    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, distToSegment(p, first, last));
    if (maxDev <= Math.max(5, 0.055 * chord) && chord > 0.7 * len * 0.8) return { kind: 'line', a: first, b: last };
    return null;
  }

  const simp = simplifyPolyline(pts, Math.max(3, 0.05 * diag));
  // drop the closing duplicate
  const poly = simp.slice();
  if (poly.length > 2 && dist(poly[0], poly[poly.length - 1]) < 0.2 * diag) poly.pop();
  const n = poly.length;

  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2, ry = b.h / 2;
  const ellipseDev = (() => {
    let s = 0;
    for (const p of pts) s += Math.abs(Math.sqrt(((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2) - 1);
    return s / pts.length;
  })();

  if (n === 3) return { kind: 'poly', pts: poly };
  if (n === 4) {
    // rectangle if all angles ≈ 90°
    let ok = true;
    for (let i = 0; i < 4; i++) {
      const a = poly[i], m = poly[(i + 1) % 4], c = poly[(i + 2) % 4];
      const v1 = { x: a.x - m.x, y: a.y - m.y }, v2 = { x: c.x - m.x, y: c.y - m.y };
      const cos = (v1.x * v2.x + v1.y * v2.y) / ((Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y)) || 1);
      if (Math.abs(cos) > 0.34) ok = false;
    }
    if (ok) {
      // axis aligned → rect; else polygon of the 4 corners
      const aligned = poly.every((p, i) => { const q = poly[(i + 1) % 4]; return Math.abs(p.x - q.x) < 0.12 * diag || Math.abs(p.y - q.y) < 0.12 * diag; });
      if (aligned) return { kind: 'rect', x: b.x, y: b.y, w: b.w, h: b.h };
      return { kind: 'poly', pts: poly };
    }
    if (ellipseDev < 0.12) return { kind: 'ellipse', cx, cy, rx, ry };
    return { kind: 'poly', pts: poly };
  }
  if (ellipseDev < 0.16 && b.w > 8 && b.h > 8) return { kind: 'ellipse', cx, cy, rx, ry };
  if (n >= 5 && n <= 7 && ellipseDev >= 0.16) return { kind: 'poly', pts: poly };
  return null;
}
