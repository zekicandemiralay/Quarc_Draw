// Vector object operations.

import type { Editor } from './editor';
import type { Layer, Page, VObject, VectorLayer, VGroup, VPath, SubPath, PathNode } from '../core/model';
import { createVectorLayer, findLayer, findObject, walkLayers, walkObjects } from '../core/model';
import { Mat, Rect, mMul, mTranslate, mScale, mApply, IDENTITY } from '../core/geometry';
import { cloneObject, objectBounds, objectsBounds, subpathsOf, toPathObject, transformObject, translateObject } from '../core/vector';
import { uid } from '../core/util';

/** Vector layer that new objects should be added to (creates one if necessary). */
export function targetVectorLayer(ed: Editor): VectorLayer {
  const l = ed.layer;
  if (l && l.type === 'vector' && !l.locked) return l;
  const pg = ed.page;
  // top-most unlocked vector layer
  let best: VectorLayer | null = null;
  walkLayers(pg.layers, (x) => { if (x.type === 'vector' && !x.locked && x.visible) best = x; });
  if (best) return best;
  const nl = createVectorLayer(`Vector ${ed.countLayers() + 1}`);
  ed.transact('New vector layer', () => {
    const f = l ? findLayer(pg.layers, l.id) : null;
    if (f) f.siblings.splice(f.index + 1, 0, nl); else pg.layers.push(nl);
  }, { pages: [pg.id] });
  return nl;
}

export function addObjects(ed: Editor, objs: VObject[], label = 'Add object', select = true): VObject[] {
  if (!objs.length) return [];
  const layer = targetVectorLayer(ed);
  ed.transact(label, () => {
    const f = findLayer(ed.page.layers, layer.id);
    if (f && f.layer.type === 'vector') f.layer.objects.push(...objs);
  }, { pages: [ed.page.id] });
  if (select) { ed.objSel = objs.map((o) => o.id); ed.setActiveLayer(layer.id); ed.changed('objsel'); }
  return objs;
}
export const addObject = (ed: Editor, o: VObject, label?: string) => addObjects(ed, [o], label ?? `Add ${o.type}`)[0];

/** Replace objects by id in the live document WITHOUT history (use inside transact / live edits). */
export function replaceObjects(page: Page, map: Map<string, VObject>) {
  walkLayers(page.layers, (l) => {
    if (l.type !== 'vector') return;
    const rec = (arr: VObject[]): VObject[] => arr.map((o) => {
      const r = map.get(o.id);
      if (r) return r;
      if (o.type === 'group') { const ch = rec(o.children); return ch.some((c, i) => c !== o.children[i]) ? { ...o, children: ch } : o; }
      return o;
    });
    l.objects = rec(l.objects);
  });
}

export function updateObjects(ed: Editor, ids: string[], fn: (o: VObject) => VObject, label = 'Edit objects', coalesce?: string) {
  ed.transact(label, () => {
    const map = new Map<string, VObject>();
    for (const id of ids) { const f = findObject(ed.page, id); if (f) map.set(id, fn(f.obj)); }
    replaceObjects(ed.page, map);
  }, { pages: [ed.page.id], coalesce });
}
export function updateSelected(ed: Editor, patch: Partial<VObject> | ((o: VObject) => VObject), label = 'Edit objects', coalesce?: string) {
  updateObjects(ed, ed.objSel, typeof patch === 'function' ? patch : (o) => ({ ...o, ...patch } as VObject), label, coalesce ?? `objprops:${Object.keys(typeof patch === 'function' ? {} : patch).join(',')}`);
}

export function deleteObjects(ed: Editor, ids: string[] = ed.objSel) {
  if (!ids.length) return;
  ed.transact('Delete', () => {
    const set = new Set(ids);
    walkLayers(ed.page.layers, (l) => {
      if (l.type !== 'vector') return;
      const rec = (arr: VObject[]): VObject[] => arr.filter((o) => !set.has(o.id)).map((o) => (o.type === 'group' ? { ...o, children: rec(o.children) } : o));
      l.objects = rec(l.objects);
    });
  }, { pages: [ed.page.id] });
  ed.objSel = ed.objSel.filter((i) => !ids.includes(i));
  ed.changed('objsel');
}

export function duplicateObjects(ed: Editor, ids: string[] = ed.objSel, offset = 24) {
  const out: VObject[] = [];
  ed.transact('Duplicate', () => {
    for (const id of ids) {
      const f = findObject(ed.page, id);
      if (!f) continue;
      const c = translateObject(cloneObject(f.obj), offset, offset);
      const layer = findLayer(ed.page.layers, f.layer.id)!.layer as VectorLayer;
      layer.objects.push(c);
      out.push(c);
    }
  }, { pages: [ed.page.id] });
  ed.objSel = out.map((o) => o.id); ed.changed('objsel');
  return out;
}

export function transformObjects(ed: Editor, ids: string[], m: Mat, label = 'Transform') {
  updateObjects(ed, ids, (o) => transformObject(o, m), label);
}

export type OrderOp = 'front' | 'back' | 'forward' | 'backward';
export function reorderObjects(ed: Editor, ids: string[], op: OrderOp) {
  ed.transact('Arrange', () => {
    walkLayers(ed.page.layers, (l) => {
      if (l.type !== 'vector') return;
      const set = new Set(ids);
      const arr = l.objects;
      if (!arr.some((o) => set.has(o.id))) return;
      if (op === 'front') l.objects = [...arr.filter((o) => !set.has(o.id)), ...arr.filter((o) => set.has(o.id))];
      else if (op === 'back') l.objects = [...arr.filter((o) => set.has(o.id)), ...arr.filter((o) => !set.has(o.id))];
      else {
        const a = arr.slice();
        if (op === 'forward') for (let i = a.length - 2; i >= 0; i--) { if (set.has(a[i].id) && !set.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]]; }
        else for (let i = 1; i < a.length; i++) { if (set.has(a[i].id) && !set.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]]; }
        l.objects = a;
      }
    });
  }, { pages: [ed.page.id] });
}

export function groupObjects(ed: Editor, ids: string[] = ed.objSel) {
  if (ids.length < 2) return;
  const g: VGroup = { id: uid('ob'), type: 'group', tf: IDENTITY, fill: null, stroke: null, opacity: 1, children: [] };
  ed.transact('Group', () => {
    const set = new Set(ids);
    const vlayers: VectorLayer[] = [];
    walkLayers(ed.page.layers, (l) => { if (l.type === 'vector') vlayers.push(l); });
    const host = vlayers.find((l) => l.objects.some((o) => set.has(o.id)));
    if (!host) return;
    const insertAt = host.objects.findIndex((o) => set.has(o.id));
    g.children = vlayers.flatMap((l) => l.objects.filter((o) => set.has(o.id)));
    for (const l of vlayers) l.objects = l.objects.filter((o) => !set.has(o.id));
    host.objects.splice(insertAt, 0, g);
  }, { pages: [ed.page.id] });
  ed.objSel = [g.id]; ed.changed('objsel');
}
export function ungroupObjects(ed: Editor, ids: string[] = ed.objSel) {
  const newSel: string[] = [];
  ed.transact('Ungroup', () => {
    walkLayers(ed.page.layers, (l) => {
      if (l.type !== 'vector') return;
      const out: VObject[] = [];
      for (const o of l.objects) {
        if (o.type === 'group' && ids.includes(o.id)) {
          for (const c of o.children) { const n = transformObject(c, o.tf); out.push(n); newSel.push(n.id); }
        } else out.push(o);
      }
      l.objects = out;
    });
  }, { pages: [ed.page.id] });
  ed.objSel = newSel; ed.changed('objsel');
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export function alignObjects(ed: Editor, mode: AlignMode, toPage = false, ids: string[] = ed.objSel) {
  const objs = ids.map((i) => findObject(ed.page, i)?.obj).filter(Boolean) as VObject[];
  if (!objs.length) return;
  const ref: Rect = toPage || objs.length === 1 ? { x: 0, y: 0, w: ed.page.width, h: ed.page.height } : objectsBounds(objs)!;
  updateObjects(ed, ids, (o) => {
    const b = objectBounds(o, false);
    let dx = 0, dy = 0;
    if (mode === 'left') dx = ref.x - b.x; else if (mode === 'right') dx = ref.x + ref.w - (b.x + b.w);
    else if (mode === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    else if (mode === 'top') dy = ref.y - b.y; else if (mode === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    else dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    return translateObject(o, dx, dy);
  }, 'Align');
}
export function distributeObjects(ed: Editor, axis: 'h' | 'v', ids: string[] = ed.objSel) {
  const objs = ids.map((i) => findObject(ed.page, i)?.obj).filter(Boolean) as VObject[];
  if (objs.length < 3) return;
  const sorted = [...objs].sort((a, b) => (axis === 'h' ? objectBounds(a, false).x - objectBounds(b, false).x : objectBounds(a, false).y - objectBounds(b, false).y));
  const first = objectBounds(sorted[0], false), last = objectBounds(sorted[sorted.length - 1], false);
  const total = sorted.reduce((s, o) => s + (axis === 'h' ? objectBounds(o, false).w : objectBounds(o, false).h), 0);
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const gap = (span - total) / (sorted.length - 1);
  let pos = axis === 'h' ? first.x : first.y;
  const targets = new Map<string, number>();
  for (const o of sorted) { targets.set(o.id, pos); const b = objectBounds(o, false); pos += (axis === 'h' ? b.w : b.h) + gap; }
  updateObjects(ed, ids, (o) => {
    const b = objectBounds(o, false);
    const t = targets.get(o.id)!;
    return axis === 'h' ? translateObject(o, t - b.x, 0) : translateObject(o, 0, t - b.y);
  }, 'Distribute');
}
export function flipObjects(ed: Editor, horizontal: boolean, ids: string[] = ed.objSel) {
  const objs = ids.map((i) => findObject(ed.page, i)?.obj).filter(Boolean) as VObject[];
  const b = objectsBounds(objs);
  if (!b) return;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const m = horizontal ? mMul(mTranslate(cx, 0), mMul(mScale(-1, 1), mTranslate(-cx, 0))) : mMul(mTranslate(0, cy), mMul(mScale(1, -1), mTranslate(0, -cy)));
  transformObjects(ed, ids, m, horizontal ? 'Flip horizontal' : 'Flip vertical');
}
export function convertToPath(ed: Editor, ids: string[] = ed.objSel) {
  updateObjects(ed, ids, (o) => toPathObject(o) ?? o, 'Convert to path');
}
export function moveObjectsToLayer(ed: Editor, ids: string[], layerId: string) {
  ed.transact('Move to layer', () => {
    const moved: VObject[] = [];
    walkLayers(ed.page.layers, (l) => { if (l.type === 'vector') { const keep = l.objects.filter((o) => { if (ids.includes(o.id)) { moved.push(o); return false; } return true; }); l.objects = keep; } });
    const t = findLayer(ed.page.layers, layerId);
    if (t && t.layer.type === 'vector') t.layer.objects.push(...moved);
  }, { pages: [ed.page.id] });
}

// -------- boolean path operations (paper.js, lazily loaded) --------
export type BoolOp = 'unite' | 'subtract' | 'intersect' | 'exclude';
export async function booleanOperation(ed: Editor, op: BoolOp, ids: string[] = ed.objSel) {
  const objs = ids.map((i) => findObject(ed.page, i)?.obj).filter(Boolean) as VObject[];
  if (objs.length < 2) { ed.setStatus('Select two or more shapes'); return; }
  const mod: any = await import('paper/dist/paper-core.js');
  const paper = mod.default ?? mod;
  paper.setup(document.createElement('canvas'));
  const toPaper = (o: VObject) => {
    const p = toPathObject(o)!;
    const items = p.paths.map((sp: SubPath) => new paper.Path({ segments: sp.nodes.map((n: PathNode) => new paper.Segment(new paper.Point(n.x, n.y), new paper.Point(n.ix, n.iy), new paper.Point(n.ox, n.oy))), closed: true }));
    return items.length === 1 ? items[0] : new paper.CompoundPath({ children: items });
  };
  const shapes = objs.map((o) => (toPathObject(o) ? toPaper(o) : null)).filter(Boolean);
  if (shapes.length < 2) return;
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) acc = acc[op](shapes[i], { insert: false });
  const kids: any[] = acc.children ? acc.children : [acc];
  const paths: SubPath[] = kids.map((k: any) => ({
    closed: true,
    nodes: k.segments.map((s: any) => ({ x: s.point.x, y: s.point.y, ix: s.handleIn.x, iy: s.handleIn.y, ox: s.handleOut.x, oy: s.handleOut.y })),
  }));
  const first = objs[0];
  const result: VPath = {
    id: uid('ob'), type: 'path', tf: IDENTITY, paths, fillRule: 'evenodd', fill: first.fill, stroke: first.stroke, opacity: first.opacity, blend: first.blend,
  };
  ed.transact(`Shape ${op}`, () => {
    const set = new Set(ids);
    let placed = false;
    walkLayers(ed.page.layers, (l) => {
      if (l.type !== 'vector') return;
      const had = l.objects.some((o) => set.has(o.id));
      if (!had) return;
      l.objects = l.objects.filter((o) => !set.has(o.id));
      if (!placed) { l.objects.push(result); placed = true; }
    });
  }, { pages: [ed.page.id] });
  ed.objSel = [result.id]; ed.changed('objsel');
}

export function objectsInRect(page: Page, r: Rect, mode: 'intersect' | 'contain' = 'intersect'): VObject[] {
  const out: VObject[] = [];
  walkLayers(page.layers, (l) => {
    if (l.type !== 'vector' || !l.visible || l.locked) return;
    for (const o of l.objects) {
      if (o.hidden || o.locked) continue;
      const b = objectBounds(o);
      const ok = mode === 'contain' ? b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h
        : !(b.x > r.x + r.w || b.x + b.w < r.x || b.y > r.y + r.h || b.y + b.h < r.y);
      if (ok) out.push(o);
    }
  });
  return out;
}
export function allObjects(page: Page): { obj: VObject; layer: VectorLayer }[] {
  const out: { obj: VObject; layer: VectorLayer }[] = [];
  walkObjects(page, (o, l) => { out.push({ obj: o, layer: l }); });
  return out;
}
export { subpathsOf, mApply };
export type { Layer };
