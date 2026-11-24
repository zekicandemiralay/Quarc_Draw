// Shape tools (rect, ellipse, polygon, star, line, arrow), freeform path and the Bezier pen tool.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Editor } from '../editor/editor';
import type { Vec, Rect } from '../core/geometry';
import { IDENTITY, rectFromPoints, setCtxMat, simplifyPolyline, catmullToBezier, dist } from '../core/geometry';
import type { VObject, VPath, PathNode, SubPath } from '../core/model';
import { baseObject } from '../core/model';
import { drawObject, node as mkNode } from '../core/vector';
import { addObject } from '../editor/objectOps';
import { snapPoint } from '../editor/snap';
import { uid } from '../core/util';

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow';

export function makeShape(ed: Editor, kind: ShapeKind, a: Vec, b: Vec, mods: { shift: boolean; alt: boolean }): VObject | null {
  const o = ed.opts;
  const common = { ...baseObject(), id: uid('ob'), fill: o.shapeFill, stroke: o.shapeStroke };
  let r: Rect;
  let ax = a.x, ay = a.y, bx = b.x, by = b.y;
  if (kind === 'line' || kind === 'arrow') {
    if (mods.shift) { const ang = Math.round(Math.atan2(by - ay, bx - ax) / (Math.PI / 12)) * (Math.PI / 12), d = Math.hypot(bx - ax, by - ay); bx = ax + Math.cos(ang) * d; by = ay + Math.sin(ang) * d; }
    if (Math.hypot(bx - ax, by - ay) < 1) return null;
    return { ...common, type: 'line', fill: null, stroke: o.shapeStroke ?? { color: ed.fg, width: 3, cap: 'round', join: 'round', dash: [] }, x1: ax, y1: ay, x2: bx, y2: by, arrowStart: false, arrowEnd: kind === 'arrow' };
  }
  let dx = bx - ax, dy = by - ay;
  if (mods.shift) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  if (mods.alt || o.shapeFromCenter) r = { x: ax - Math.abs(dx), y: ay - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  else r = rectFromPoints({ x: ax, y: ay }, { x: ax + dx, y: ay + dy });
  if (r.w < 1 || r.h < 1) return null;
  if (kind === 'rect') return { ...common, type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, rx: Math.min(o.cornerRadius, r.w / 2, r.h / 2) };
  if (kind === 'ellipse') return { ...common, type: 'ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 };
  const rad = Math.min(r.w, r.h) / 2;
  return { ...common, type: 'polygon', cx: r.x + r.w / 2, cy: r.y + r.h / 2, r: rad, sides: o.polygonSides, rot: 0, inner: kind === 'star' ? o.starInner : 0 };
}

export class ShapeTool extends Tool {
  cursor = 'crosshair';
  private a: Vec | null = null;
  private b: Vec | null = null;
  private preview: VObject | null = null;
  private pageId = '';
  private guides: { axis: 'x' | 'y'; pos: number }[] = [];
  constructor(ed: Editor, public id: string, public name: string, private kind: ShapeKind) { super(ed); }

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const s = snapPoint(ed, e.page, e.local);
    this.a = s.p; this.b = s.p; this.pageId = e.page.id; this.guides = s.guides;
    this.preview = null;
  }
  pointerMove(e: ToolPointer) {
    if (!this.a || !e.page) return;
    const s = snapPoint(this.ed, e.page, e.local);
    this.b = s.p; this.guides = s.guides;
    this.preview = makeShape(this.ed, this.kind, this.a, this.b, e);
    this.ed.requestOverlay();
  }
  pointerUp(e: ToolPointer) {
    const ed = this.ed;
    if (!this.a) return;
    let obj = this.preview;
    if (!obj && Math.hypot((this.b?.x ?? 0) - this.a.x, (this.b?.y ?? 0) - this.a.y) < 3 && this.kind !== 'line' && this.kind !== 'arrow') {
      // click → default-size shape centred on the click
      const d = 60;
      obj = makeShape(ed, this.kind, { x: this.a.x - d, y: this.a.y - d }, { x: this.a.x + d, y: this.a.y + d }, { shift: false, alt: false });
    }
    this.a = this.b = null; this.preview = null; this.guides = [];
    if (obj) { addObject(ed, obj); ed.setTool('move'); }
    ed.requestOverlay();
    void e;
  }
  cancel() { this.a = this.b = null; this.preview = null; this.ed.requestOverlay(); }
  drawOverlay(o: OverlayCtx) {
    if (!o.page || o.page.id !== this.pageId) return;
    if (this.preview) {
      o.ctx.save(); setCtxMat(o.ctx, o.pageMatrix(o.page)); drawObject(o.ctx, this.preview, { scale: o.zoom }); o.ctx.restore();
    }
    for (const g of this.guides) {
      const ts = (p: Vec) => o.localToScreen(o.page!, p);
      const A = g.axis === 'x' ? ts({ x: g.pos, y: 0 }) : ts({ x: 0, y: g.pos }), B = g.axis === 'x' ? ts({ x: g.pos, y: o.page.height }) : ts({ x: o.page.width, y: g.pos });
      o.ctx.save(); o.ctx.strokeStyle = '#ff2d95'; o.ctx.lineWidth = 1; o.ctx.beginPath(); o.ctx.moveTo(A.x, A.y); o.ctx.lineTo(B.x, B.y); o.ctx.stroke(); o.ctx.restore();
    }
  }
}

/** freehand path → smoothed bezier path object */
export class FreeformTool extends Tool {
  id = 'freeform'; name = 'Freeform Path';
  cursor = 'crosshair';
  private pts: Vec[] = [];
  private pageId = '';
  pointerDown(e: ToolPointer) { if (!e.page) return; if (e.page.id !== this.ed.page.id) this.ed.setActivePage(e.page.id); this.pts = [e.local]; this.pageId = e.page.id; }
  pointerMove(e: ToolPointer) { if (!this.pts.length) return; const l = this.pts[this.pts.length - 1]; if (dist(l, e.local) > 1 / this.ed.view.zoom) { this.pts.push(e.local); this.ed.requestOverlay(); } }
  pointerUp() {
    const ed = this.ed, pts = this.pts; this.pts = [];
    if (pts.length < 2) return;
    const simp = simplifyPolyline(pts, 2.2 / ed.view.zoom);
    const bez = catmullToBezier(simp);
    const closed = dist(pts[0], pts[pts.length - 1]) < 10 / ed.view.zoom && simp.length > 3;
    const nodes: PathNode[] = simp.map((p, i) => {
      const prev = bez[i - 1], next = bez[i];
      return mkNode(p.x, p.y, prev ? prev.c2.x - p.x : 0, prev ? prev.c2.y - p.y : 0, next ? next.c1.x - p.x : 0, next ? next.c1.y - p.y : 0);
    });
    if (closed) nodes.pop();
    const sp: SubPath = { nodes, closed };
    const o = ed.opts;
    const obj: VPath = { ...baseObject(), id: uid('ob'), type: 'path', paths: [sp], fillRule: 'nonzero', fill: closed ? o.shapeFill : null, stroke: o.shapeStroke ?? { color: ed.fg, width: 3, cap: 'round', join: 'round', dash: [] } };
    addObject(ed, obj, 'Freeform path');
    ed.requestOverlay();
  }
  drawOverlay(o: OverlayCtx) {
    if (this.pts.length < 2 || !o.page || o.page.id !== this.pageId) return;
    const { ctx } = o;
    ctx.save(); ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    this.pts.forEach((p, i) => { const s = o.localToScreen(o.page!, p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
    ctx.stroke(); ctx.restore();
  }
}

/** Bezier pen: click = corner, click-drag = smooth point, click first point = close, Enter / double-click = finish */
export class PenTool extends Tool {
  id = 'pen'; name = 'Pen';
  cursor = 'crosshair';
  private nodes: PathNode[] = [];
  private dragging = false;
  private hover_: Vec | null = null;
  private pageId = '';
  private downPt: Vec | null = null;

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id && !this.nodes.length) ed.setActivePage(e.page.id);
    if (e.page.id !== this.pageId && this.nodes.length) return;
    this.pageId = e.page.id;
    const p = snapPoint(ed, e.page, e.local).p;
    // close path when clicking the first node
    if (this.nodes.length > 2 && dist(p, this.nodes[0]) * ed.view.zoom < 9) { this.finish(true); return; }
    if (e.detail >= 2 && this.nodes.length >= 2) { this.finish(false); return; }
    this.nodes.push(mkNode(p.x, p.y));
    this.dragging = true; this.downPt = p;
    ed.requestOverlay();
  }
  pointerMove(e: ToolPointer) {
    this.hover_ = e.page ? snapPoint(this.ed, e.page, e.local).p : e.local;
    if (this.dragging && this.nodes.length) {
      const n = this.nodes[this.nodes.length - 1];
      const d = { x: this.hover_.x - n.x, y: this.hover_.y - n.y };
      if (Math.hypot(d.x, d.y) * this.ed.view.zoom > 3) { n.ox = d.x; n.oy = d.y; n.ix = e.alt ? n.ix : -d.x; n.iy = e.alt ? n.iy : -d.y; }
    }
    this.ed.requestOverlay();
  }
  hover(e: ToolPointer) { this.pointerMove(e); }
  pointerUp() { this.dragging = false; }
  keyDown(e: KeyboardEvent): boolean {
    if (!this.nodes.length) return false;
    if (e.key === 'Enter') { this.finish(false); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace' || e.key === 'Delete') { this.nodes.pop(); this.ed.requestOverlay(); return true; }
    return false;
  }
  commit() { if (this.nodes.length >= 2) this.finish(false); else this.cancel(); }
  cancel() { this.nodes = []; this.dragging = false; this.ed.requestOverlay(); }
  private finish(closed: boolean) {
    const ed = this.ed;
    // remove a trailing duplicate node created by a double-click
    if (this.nodes.length > 1) { const a = this.nodes[this.nodes.length - 1], b = this.nodes[this.nodes.length - 2]; if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) this.nodes.pop(); }
    const nodes = this.nodes; this.nodes = [];
    if (nodes.length < 2) { ed.requestOverlay(); return; }
    const o = ed.opts;
    const obj: VPath = {
      ...baseObject(), id: uid('ob'), type: 'path', paths: [{ nodes, closed }], fillRule: 'nonzero',
      fill: closed ? o.shapeFill : null, stroke: o.shapeStroke ?? { color: ed.fg, width: 3, cap: 'round', join: 'round', dash: [] },
    };
    addObject(ed, obj, 'Pen path');
    ed.requestOverlay();
  }
  drawOverlay(o: OverlayCtx) {
    if (!o.page || o.page.id !== this.pageId || !this.nodes.length) return;
    const { ctx } = o;
    const preview: VObject = {
      ...baseObject(), id: 'preview', type: 'path', fill: null, fillRule: 'nonzero',
      stroke: { color: '#1abc9c', width: 2 / o.zoom, cap: 'round', join: 'round', dash: [] },
      paths: [{ closed: false, nodes: this.hover_ && !this.dragging ? [...this.nodes, mkNode(this.hover_.x, this.hover_.y)] : this.nodes }],
    };
    ctx.save(); setCtxMat(ctx, o.pageMatrix(o.page)); drawObject(ctx, preview, { scale: o.zoom }); ctx.restore();
    const ts = (p: Vec) => o.localToScreen(o.page!, p);
    ctx.save();
    for (const n of this.nodes) {
      const s = ts(n);
      if (n.ox || n.oy) {
        for (const h of [{ x: n.x + n.ox, y: n.y + n.oy }, { x: n.x + n.ix, y: n.y + n.iy }]) {
          const hs = ts(h); ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(hs.x, hs.y); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hs.x, hs.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.fillStyle = n === this.nodes[0] ? '#1abc9c' : '#fff'; ctx.strokeStyle = '#0d8f77'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(s.x - 4, s.y - 4, 8, 8); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}
void IDENTITY;
