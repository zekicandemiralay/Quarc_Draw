// Snapping to grid, guides, page edges and other objects.

import type { Editor } from './editor';
import type { Page } from '../core/model';
import { walkLayers } from '../core/model';
import type { Vec } from '../core/geometry';
import { objectBounds } from '../core/vector';

export interface SnapResult { p: Vec; guides: { axis: 'x' | 'y'; pos: number }[] }

/** Snap a moving rectangle (left/center/right × top/middle/bottom) – returns the delta to apply. */
export function snapRect(ed: Editor, page: Page, r: { x: number; y: number; w: number; h: number }, exclude: Set<string>): { dx: number; dy: number; guides: SnapResult['guides'] } {
  let bestDx = Infinity, bestDy = Infinity;
  const guides: SnapResult['guides'] = [];
  for (const fx of [0, 0.5, 1]) for (const fy of [0, 0.5, 1]) {
    const p = { x: r.x + r.w * fx, y: r.y + r.h * fy };
    const s = snapPoint(ed, page, p, exclude);
    const dx = s.p.x - p.x, dy = s.p.y - p.y;
    if (s.guides.some((g) => g.axis === 'x') && Math.abs(dx) < Math.abs(bestDx)) { bestDx = dx; }
    if (s.guides.some((g) => g.axis === 'y') && Math.abs(dy) < Math.abs(bestDy)) { bestDy = dy; }
  }
  const dx = isFinite(bestDx) ? bestDx : 0, dy = isFinite(bestDy) ? bestDy : 0;
  if (isFinite(bestDx)) for (const fx of [0, 0.5, 1]) { const x = r.x + r.w * fx + dx; if (snapPoint(ed, page, { x, y: r.y }, exclude).guides.some((g) => g.axis === 'x' && Math.abs(g.pos - x) < 0.01)) guides.push({ axis: 'x', pos: x }); }
  if (isFinite(bestDy)) for (const fy of [0, 0.5, 1]) { const y = r.y + r.h * fy + dy; if (snapPoint(ed, page, { x: r.x, y }, exclude).guides.some((g) => g.axis === 'y' && Math.abs(g.pos - y) < 0.01)) guides.push({ axis: 'y', pos: y }); }
  return { dx, dy, guides };
}

export function snapPoint(ed: Editor, page: Page, p: Vec, exclude: Set<string> = new Set(), force = false): SnapResult {
  const o = ed.opts, doc = ed.doc;
  const thr = 8 / ed.view.zoom;
  const res: SnapResult = { p: { ...p }, guides: [] };
  let bestX = thr, bestY = thr;
  const tryX = (x: number) => { const d = Math.abs(x - p.x); if (d < bestX) { bestX = d; res.p.x = x; res.guides = res.guides.filter((g) => g.axis !== 'x'); res.guides.push({ axis: 'x', pos: x }); } };
  const tryY = (y: number) => { const d = Math.abs(y - p.y); if (d < bestY) { bestY = d; res.p.y = y; res.guides = res.guides.filter((g) => g.axis !== 'y'); res.guides.push({ axis: 'y', pos: y }); } };
  if ((doc.grid.snap && o.snapGrid) || force) {
    const s = doc.grid.size / Math.max(1, doc.grid.subdivisions);
    tryX(Math.round(p.x / s) * s); tryY(Math.round(p.y / s) * s);
  }
  if (o.snapGuides) {
    for (const g of page.guides) (g.axis === 'v' ? tryX : tryY)(g.pos);
    tryX(0); tryX(page.width); tryX(page.width / 2); tryY(0); tryY(page.height); tryY(page.height / 2);
  }
  if (o.snapObjects) {
    walkLayers(page.layers, (l) => {
      if (l.type !== 'vector' || !l.visible) return;
      for (const ob of l.objects) {
        if (exclude.has(ob.id) || ob.hidden) continue;
        const b = objectBounds(ob, false);
        tryX(b.x); tryX(b.x + b.w); tryX(b.x + b.w / 2); tryY(b.y); tryY(b.y + b.h); tryY(b.y + b.h / 2);
      }
    });
  }
  return res;
}
