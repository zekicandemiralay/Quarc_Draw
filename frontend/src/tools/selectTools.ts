// Selection tools: rectangular / elliptical marquee, lasso, polygonal lasso, magic wand, selection brush.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Editor } from '../editor/editor';
import type { Rect, Vec } from '../core/geometry';
import { rectFromPoints, rectContains } from '../core/geometry';
import type { SelectMode } from '../core/selection';
import { floodMask } from '../core/floodfill';
import { renderPageToCanvas } from '../core/render';
import { ctx2d } from '../core/util';

export function modeFor(ed: Editor, e: { shift: boolean; alt: boolean }): SelectMode {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return ed.opts.selectMode;
}

/** draws dashed outline for in-progress selection shapes */
function dashed(ctx: CanvasRenderingContext2D, draw: () => void) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#fff'; ctx.setLineDash([]); draw(); ctx.stroke();
  ctx.strokeStyle = '#000'; ctx.setLineDash([5, 5]); draw(); ctx.stroke();
  ctx.restore();
}

export class MarqueeTool extends Tool {
  cursor = 'crosshair';
  private start: Vec | null = null;
  private cur: Vec | null = null;
  private mode: SelectMode = 'replace';
  private moving: { before: ReturnType<Editor['selection']['getState']>; from: Vec } | null = null;
  private pageId = '';
  constructor(ed: Editor, public id: 'marquee-rect' | 'marquee-ellipse', public name: string) { super(ed); }

  private rect(e: ToolPointer): Rect {
    const o = this.ed.opts;
    if (o.marqueeStyle === 'fixed') return { x: this.start!.x, y: this.start!.y, w: o.marqueeW, h: o.marqueeH };
    let a = this.start!, b = this.cur ?? e.local;
    let dx = b.x - a.x, dy = b.y - a.y;
    if (e.shift && this.mode === 'replace' || o.marqueeStyle === 'square') { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
    if (e.alt && this.mode === 'replace') return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
    b = { x: a.x + dx, y: a.y + dy };
    return rectFromPoints(a, b);
  }

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    this.pageId = e.page.id;
    this.mode = modeFor(ed, e);
    // drag inside an existing selection (replace mode) moves the selection outline
    const sel = ed.selection;
    if (!sel.isEmpty && this.mode === 'replace' && !e.shift && !e.alt && sel.valueAt(e.local.x, e.local.y) > 127) {
      this.moving = { before: sel.getState(), from: e.local };
      return;
    }
    this.start = e.local; this.cur = e.local;
    if (ed.opts.marqueeStyle === 'fixed') this.pointerUp(e);
  }
  pointerMove(e: ToolPointer) {
    const ed = this.ed;
    if (this.moving) {
      const sel = ed.selection;
      sel.setState(this.moving.before);
      sel.translate(e.local.x - this.moving.from.x, e.local.y - this.moving.from.y);
      ed.changed('selection');
      return;
    }
    if (!this.start) return;
    this.cur = e.local;
    ed.requestOverlay();
  }
  pointerUp(e: ToolPointer) {
    const ed = this.ed;
    if (this.moving) { ed.commitSelectionHistory('Move selection', this.moving.before); this.moving = null; return; }
    if (!this.start) return;
    this.cur = e.local;
    const r = this.rect(e);
    this.start = null;
    if (r.w < 2 && r.h < 2 && ed.opts.marqueeStyle !== 'fixed') { ed.deselect(); ed.requestOverlay(); return; }
    ed.editSelection(this.id === 'marquee-rect' ? 'Rectangular marquee' : 'Elliptical marquee', (s) => {
      if (this.id === 'marquee-rect') s.combineRect(r, this.mode); else s.combineEllipse(r, this.mode);
      if (ed.opts.feather > 0) s.feather(ed.opts.feather);
    });
    ed.requestOverlay();
  }
  cancel() { this.start = null; this.moving = null; }
  drawOverlay(o: OverlayCtx) {
    if (!this.start || !o.page || o.page.id !== this.pageId) return;
    const r = this.rect({ ...({} as ToolPointer), shift: false, alt: false, local: this.cur ?? this.start } as ToolPointer);
    const a = o.localToScreen(o.page, { x: r.x, y: r.y }), b = o.localToScreen(o.page, { x: r.x + r.w, y: r.y + r.h });
    dashed(o.ctx, () => {
      o.ctx.beginPath();
      if (this.id === 'marquee-rect') o.ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else o.ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    });
    const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    o.ctx.save(); o.ctx.font = '11px system-ui'; o.ctx.fillStyle = 'rgba(0,0,0,0.7)'; const tw = o.ctx.measureText(label).width;
    o.ctx.fillRect(b.x + 6, b.y + 6, tw + 10, 18); o.ctx.fillStyle = '#fff'; o.ctx.fillText(label, b.x + 11, b.y + 19); o.ctx.restore();
  }
}

export class LassoTool extends Tool {
  cursor = 'crosshair';
  private pts: Vec[] = [];
  private active = false;
  private mode: SelectMode = 'replace';
  private pageId = '';
  private hover_: Vec | null = null;
  constructor(ed: Editor, public id: 'lasso' | 'lasso-poly', public name: string) { super(ed); }
  get poly() { return this.id === 'lasso-poly'; }

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    if (this.poly) {
      if (!this.active) { this.active = true; this.pts = [e.local]; this.mode = modeFor(ed, e); this.pageId = e.page.id; return; }
      const first = this.pts[0];
      if (e.detail >= 2 || (this.pts.length > 2 && Math.hypot(first.x - e.local.x, first.y - e.local.y) * ed.view.zoom < 8)) { this.finish(); return; }
      this.pts.push(e.local);
      ed.requestOverlay();
    } else {
      this.active = true; this.pts = [e.local]; this.mode = modeFor(ed, e); this.pageId = e.page.id;
    }
  }
  pointerMove(e: ToolPointer) {
    this.hover_ = e.local;
    if (!this.active) return;
    if (!this.poly) { const l = this.pts[this.pts.length - 1]; if (Math.hypot(l.x - e.local.x, l.y - e.local.y) > 1.5 / this.ed.view.zoom) this.pts.push(e.local); }
    this.ed.requestOverlay();
  }
  hover(e: ToolPointer) { this.pointerMove(e); }
  pointerUp(_e: ToolPointer) { if (!this.poly && this.active) this.finish(); }
  keyDown(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    if (e.key === 'Enter') { this.finish(); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace') { this.pts.pop(); if (!this.pts.length) this.cancel(); this.ed.requestOverlay(); return true; }
    return false;
  }
  commit() { if (this.active && this.pts.length > 2) this.finish(); else this.cancel(); }
  cancel() { this.active = false; this.pts = []; this.ed.requestOverlay(); }
  private finish() {
    const ed = this.ed, pts = this.pts;
    this.active = false; this.pts = [];
    if (pts.length < 3) { ed.deselect(); ed.requestOverlay(); return; }
    ed.editSelection(this.poly ? 'Polygonal lasso' : 'Lasso', (s) => { s.combinePolygon(pts, this.mode); if (ed.opts.feather > 0) s.feather(ed.opts.feather); });
    ed.requestOverlay();
  }
  drawOverlay(o: OverlayCtx) {
    if (!this.active || !o.page || o.page.id !== this.pageId) return;
    const pts = this.pts.map((p) => o.localToScreen(o.page!, p));
    if (this.poly && this.hover_) pts.push(o.localToScreen(o.page, this.hover_));
    dashed(o.ctx, () => { o.ctx.beginPath(); pts.forEach((p, i) => (i ? o.ctx.lineTo(p.x, p.y) : o.ctx.moveTo(p.x, p.y))); });
    if (this.poly) { o.ctx.save(); o.ctx.fillStyle = '#fff'; o.ctx.strokeStyle = '#000'; for (const p of pts.slice(0, -1)) { o.ctx.beginPath(); o.ctx.rect(p.x - 3, p.y - 3, 6, 6); o.ctx.fill(); o.ctx.stroke(); } o.ctx.restore(); }
  }
}

export class WandTool extends Tool {
  cursor = 'crosshair';
  id = 'wand'; name = 'Magic Wand';
  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const pg = e.page, o = ed.opts;
    let data: Uint8ClampedArray, w = pg.width, h = pg.height;
    const l = ed.layer;
    if (!o.sampleMerged && l && l.type === 'raster') {
      const c = l.surface.peek();
      data = c ? ctx2d(c, true).getImageData(0, 0, w, h).data : new Uint8ClampedArray(w * h * 4);
    } else {
      const c = renderPageToCanvas(ed.doc, pg, 1);
      data = ctx2d(c, true).getImageData(0, 0, w, h).data;
    }
    const mask = floodMask(data, w, h, e.local.x, e.local.y, { tolerance: o.tolerance, contiguous: o.contiguous });
    const mode = modeFor(ed, e);
    ed.editSelection('Magic wand', (s) => { s.combine(mask, mode); if (o.feather > 0) s.feather(o.feather); });
  }
}

export class SelectBrushTool extends Tool {
  cursor = 'none';
  id = 'select-brush'; name = 'Selection Brush';
  private before: ReturnType<Editor['selection']['getState']> | null = null;
  private last: Vec | null = null;
  private hoverPt: Vec | null = null;
  private subtract = false;
  private stamp(a: Vec, b: Vec) {
    const sel = this.ed.selection, r = this.ed.opts.selectBrushSize / 2;
    const mode: SelectMode = this.subtract ? 'subtract' : 'add';
    const x0 = Math.min(a.x, b.x) - r, y0 = Math.min(a.y, b.y) - r;
    sel.combineDraw((c) => { c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = r * 2; c.strokeStyle = '#000'; c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y + 0.001); c.stroke(); }, mode, { x: x0, y: y0, w: Math.abs(a.x - b.x) + r * 2, h: Math.abs(a.y - b.y) + r * 2 });
    this.ed.changed('selection');
  }
  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    if (e.page.id !== this.ed.page.id) this.ed.setActivePage(e.page.id);
    this.before = this.ed.selection.getState();
    this.subtract = e.alt;
    this.last = e.local;
    this.stamp(e.local, e.local);
  }
  pointerMove(e: ToolPointer) { this.hoverPt = e.local; if (this.before && this.last) { this.stamp(this.last, e.local); this.last = e.local; } this.ed.requestOverlay(); }
  hover(e: ToolPointer) { this.hoverPt = e.page ? e.local : null; this.ed.requestOverlay(); }
  pointerUp() { if (this.before) { this.ed.commitSelectionHistory('Selection brush', this.before); this.before = null; this.last = null; } }
  drawOverlay(o: OverlayCtx) {
    if (!this.hoverPt || !o.page) return;
    const c = o.localToScreen(o.page, this.hoverPt), r = (this.ed.opts.selectBrushSize / 2) * o.zoom;
    dashed(o.ctx, () => { o.ctx.beginPath(); o.ctx.arc(c.x, c.y, Math.max(2, r), 0, Math.PI * 2); });
  }
}
export { rectContains };
