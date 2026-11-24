// Direct-select / node editing tool for bezier paths.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Vec } from '../core/geometry';
import { bezSplit, bezFlatten, dist, distToSegment, norm } from '../core/geometry';
import type { VObject, VPath, SubPath, PathNode } from '../core/model';
import { findObject } from '../core/model';
import { subpathSegments, toPathObject } from '../core/vector';
import { replaceObjects } from '../editor/objectOps';
import { pickObjectAt } from './moveTools';

type Sel = Set<string>; // "sub:index"
type Drag =
  | { kind: 'node'; start: Vec; orig: SubPath[] }
  | { kind: 'in' | 'out'; sub: number; idx: number; orig: SubPath[] }
  | null;

const k = (s: number, i: number) => `${s}:${i}`;

export class NodeTool extends Tool {
  id = 'node'; name = 'Node Edit';
  cursor = 'default';
  private sel: Sel = new Set();
  private drag: Drag = null;
  private live: ReturnType<ToolPointerEditor['beginLive']> | null = null;
  private moved = false;
  private hoverPt: Vec | null = null;

  activate() { this.convert(); }
  deactivate() { this.sel.clear(); }

  private current(): VPath | null {
    const id = this.ed.objSel[0];
    if (!id) return null;
    const f = findObject(this.ed.page, id);
    return f && f.obj.type === 'path' ? f.obj : null;
  }
  private convert() {
    const ed = this.ed;
    const id = ed.objSel[0];
    if (!id) return;
    const f = findObject(ed.page, id);
    if (!f || f.obj.type === 'path') return;
    const p = toPathObject(f.obj);
    if (!p) return;
    ed.transact('Convert to path', () => replaceObjects(ed.page, new Map([[id, p]])));
  }
  private setPaths(paths: SubPath[]) {
    const obj = this.current();
    if (!obj) return;
    replaceObjects(this.ed.page, new Map<string, VObject>([[obj.id, { ...obj, paths }]]));
    this.ed.changed('doc');
  }
  private clonePaths(p: SubPath[]): SubPath[] { return p.map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ ...n })) })); }

  private hitNode(p: Vec, obj: VPath): { kind: 'node' | 'in' | 'out'; sub: number; idx: number } | null {
    const tol = 8 / this.ed.view.zoom;
    // handles of selected nodes first
    for (let s = 0; s < obj.paths.length; s++) obj.paths[s].nodes.forEach((n, i) => {
      void n; void i;
    });
    for (let s = 0; s < obj.paths.length; s++) {
      const nodes = obj.paths[s].nodes;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (this.sel.has(k(s, i))) {
          if ((n.ox || n.oy) && dist(p, { x: n.x + n.ox, y: n.y + n.oy }) < tol) return { kind: 'out', sub: s, idx: i };
          if ((n.ix || n.iy) && dist(p, { x: n.x + n.ix, y: n.y + n.iy }) < tol) return { kind: 'in', sub: s, idx: i };
        }
      }
    }
    for (let s = 0; s < obj.paths.length; s++) {
      const nodes = obj.paths[s].nodes;
      for (let i = nodes.length - 1; i >= 0; i--) if (dist(p, nodes[i]) < tol) return { kind: 'node', sub: s, idx: i };
    }
    return null;
  }

  private nearestSegment(p: Vec, obj: VPath): { sub: number; seg: number; t: number; d: number } | null {
    let best: { sub: number; seg: number; t: number; d: number } | null = null;
    obj.paths.forEach((sp, s) => {
      subpathSegments(sp).forEach((bz, si) => {
        const pts = bezFlatten(bz, 0.5);
        // approximate param by polyline fraction
        let total = 0; const lens: number[] = [0];
        for (let i = 1; i < pts.length; i++) { total += dist(pts[i - 1], pts[i]); lens.push(total); }
        for (let i = 0; i < pts.length - 1; i++) {
          const d = distToSegment(p, pts[i], pts[i + 1]);
          if (!best || d < best.d) {
            const segLen = lens[i + 1] - lens[i] || 1;
            const tt = (lens[i] + Math.min(segLen, Math.max(0, ((p.x - pts[i].x) * (pts[i + 1].x - pts[i].x) + (p.y - pts[i].y) * (pts[i + 1].y - pts[i].y)) / segLen)) ) / (total || 1);
            best = { sub: s, seg: si, t: Math.min(0.98, Math.max(0.02, tt)), d };
          }
        }
      });
    });
    return best;
  }

  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    let obj = this.current();
    if (obj) {
      const h = this.hitNode(e.local, obj);
      if (h) {
        if (h.kind === 'node') {
          const key = k(h.sub, h.idx);
          if (e.detail >= 2) { this.toggleSmooth(obj, h.sub, h.idx); return; }
          if (e.shift) { this.sel.has(key) ? this.sel.delete(key) : this.sel.add(key); }
          else if (!this.sel.has(key)) { this.sel.clear(); this.sel.add(key); }
          this.drag = { kind: 'node', start: e.local, orig: this.clonePaths(obj.paths) };
        } else this.drag = { kind: h.kind, sub: h.sub, idx: h.idx, orig: this.clonePaths(obj.paths) };
        this.live = ed.beginLive(); this.moved = false;
        ed.requestOverlay();
        return;
      }
      // double-click on a segment inserts a node
      const seg = this.nearestSegment(e.local, obj);
      if (seg && seg.d * ed.view.zoom < 7 && e.detail >= 2) { this.insertNode(obj, seg); return; }
    }
    // pick another object
    const hit = pickObjectAt(ed, e.local);
    if (hit) {
      ed.objSel = [hit.id]; ed.changed('objsel');
      this.sel.clear();
      this.convert();
    } else { ed.objSel = []; ed.changed('objsel'); this.sel.clear(); }
    ed.requestOverlay();
  }

  private toggleSmooth(obj: VPath, s: number, i: number) {
    const ed = this.ed;
    const paths = this.clonePaths(obj.paths);
    const nodes = paths[s].nodes, n = nodes[i];
    const prev = nodes[(i - 1 + nodes.length) % nodes.length], next = nodes[(i + 1) % nodes.length];
    if (n.ox || n.oy || n.ix || n.iy) { n.ox = n.oy = n.ix = n.iy = 0; }
    else {
      const dir = norm({ x: next.x - prev.x, y: next.y - prev.y });
      const l1 = dist(n, prev) / 3, l2 = dist(n, next) / 3;
      n.ix = -dir.x * l1; n.iy = -dir.y * l1; n.ox = dir.x * l2; n.oy = dir.y * l2;
    }
    ed.transact('Toggle node type', () => replaceObjects(ed.page, new Map([[obj.id, { ...obj, paths }]])));
  }
  private insertNode(obj: VPath, seg: { sub: number; seg: number; t: number }) {
    const ed = this.ed;
    const paths = this.clonePaths(obj.paths);
    const sp = paths[seg.sub], nodes = sp.nodes;
    const i0 = seg.seg, i1 = (i0 + 1) % nodes.length;
    const a = nodes[i0], b = nodes[i1];
    const bz = { p0: { x: a.x, y: a.y }, c1: { x: a.x + a.ox, y: a.y + a.oy }, c2: { x: b.x + b.ix, y: b.y + b.iy }, p1: { x: b.x, y: b.y } };
    const [L, R] = bezSplit(bz, seg.t);
    a.ox = L.c1.x - a.x; a.oy = L.c1.y - a.y;
    b.ix = R.c2.x - b.x; b.iy = R.c2.y - b.y;
    const nn: PathNode = { x: L.p1.x, y: L.p1.y, ix: L.c2.x - L.p1.x, iy: L.c2.y - L.p1.y, ox: R.c1.x - R.p0.x, oy: R.c1.y - R.p0.y };
    nodes.splice(i0 + 1, 0, nn);
    ed.transact('Add node', () => replaceObjects(ed.page, new Map([[obj.id, { ...obj, paths }]])));
    this.sel = new Set([k(seg.sub, i0 + 1)]);
  }

  pointerMove(e: ToolPointer) {
    this.hoverPt = e.local;
    const obj = this.current();
    if (!this.drag || !obj) { this.ed.requestOverlay(); return; }
    this.moved = true;
    const paths = this.clonePaths(this.drag.orig);
    if (this.drag.kind === 'node') {
      let dx = e.local.x - this.drag.start.x, dy = e.local.y - this.drag.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      for (const key of this.sel) { const [s, i] = key.split(':').map(Number); const n = paths[s]?.nodes[i]; if (n) { n.x += dx; n.y += dy; } }
    } else {
      const { sub, idx } = this.drag;
      const n = paths[sub].nodes[idx], o = this.drag.orig[sub].nodes[idx];
      const hx = e.local.x - n.x, hy = e.local.y - n.y;
      if (this.drag.kind === 'out') {
        n.ox = hx; n.oy = hy;
        const collinear = !e.alt && (o.ix || o.iy);
        if (collinear) { const l = Math.hypot(o.ix, o.iy), d = norm({ x: hx, y: hy }); n.ix = -d.x * l; n.iy = -d.y * l; }
      } else {
        n.ix = hx; n.iy = hy;
        const collinear = !e.alt && (o.ox || o.oy);
        if (collinear) { const l = Math.hypot(o.ox, o.oy), d = norm({ x: hx, y: hy }); n.ox = -d.x * l; n.oy = -d.y * l; }
      }
    }
    this.setPaths(paths);
    this.ed.requestOverlay();
  }
  hover(e: ToolPointer) {
    this.hoverPt = e.local;
    const obj = this.current();
    this.cursor = obj && this.hitNode(e.local, obj) ? 'pointer' : 'default';
    this.ed.requestOverlay();
  }
  pointerUp() {
    if (this.drag && this.live) { if (this.moved) this.ed.endLive('Edit path', this.live); }
    this.drag = null; this.live = null;
  }
  keyDown(e: KeyboardEvent): boolean {
    const obj = this.current();
    if (!obj) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) {
      const paths = this.clonePaths(obj.paths);
      const bySub = new Map<number, number[]>();
      for (const key of this.sel) { const [s, i] = key.split(':').map(Number); bySub.set(s, [...(bySub.get(s) ?? []), i]); }
      for (const [s, idxs] of bySub) paths[s].nodes = paths[s].nodes.filter((_, i) => !idxs.includes(i));
      const kept = paths.filter((p) => p.nodes.length >= 2);
      this.sel.clear();
      if (!kept.length) { import('../editor/objectOps').then(({ deleteObjects }) => deleteObjects(this.ed, [obj.id])); return true; }
      this.ed.transact('Delete node', () => replaceObjects(this.ed.page, new Map([[obj.id, { ...obj, paths: kept }]])));
      return true;
    }
    if (e.key === 'Escape') { this.sel.clear(); this.ed.requestOverlay(); return true; }
    return false;
  }

  drawOverlay(o: OverlayCtx) {
    const obj = this.current();
    if (!obj || !o.page) return;
    const { ctx } = o, ts = (p: Vec) => o.localToScreen(o.page!, p);
    ctx.save();
    obj.paths.forEach((sp, s) => {
      sp.nodes.forEach((n, i) => {
        const p = ts(n), selected = this.sel.has(k(s, i));
        if (selected) {
          for (const h of [{ x: n.x + n.ox, y: n.y + n.oy, on: n.ox || n.oy }, { x: n.x + n.ix, y: n.y + n.iy, on: n.ix || n.iy }]) {
            if (!h.on) continue;
            const hs = ts(h);
            ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hs.x, hs.y); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hs.x, hs.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          }
        }
        ctx.fillStyle = selected ? '#1abc9c' : '#fff'; ctx.strokeStyle = '#0d8f77'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (n.ox || n.oy || n.ix || n.iy) ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); else ctx.rect(p.x - 4, p.y - 4, 8, 8);
        ctx.fill(); ctx.stroke();
      });
    });
    ctx.restore();
  }
}
type ToolPointerEditor = import('../editor/editor').Editor;
