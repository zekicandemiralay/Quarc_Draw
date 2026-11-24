// Vector ink tools for note-taking: pens, highlighter, stroke eraser, laser pointer, sticky notes, image & measure.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Editor } from '../editor/editor';
import type { Vec } from '../core/geometry';
import { mApply, mScaleFactor, setCtxMat, dist, distToSegment } from '../core/geometry';
import type { InkKind, VInk, VObject, VNote, VPath, VRect, VEllipse } from '../core/model';
import { baseObject, findObject, solid, walkLayers } from '../core/model';
import { INK_DEFAULTS, drawObject, hitTestObject, objectBounds } from '../core/vector';
import { addObject, replaceObjects } from '../editor/objectOps';
import { recognizeShape } from '../core/shapeRecognize';
import { uid } from '../core/util';
import { bus } from '../app/bus';
import { prefs } from '../app/store';

export class InkTool extends Tool {
  cursor = 'none';
  private pts: number[] = [];
  private pageId = '';
  private down = false;
  private lastMove = 0;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private snapped: VObject | null = null;
  private hoverPt: Vec | null = null;
  private pointerType = 'mouse';

  constructor(ed: Editor, public id: string, public name: string, public kind: InkKind) { super(ed); }

  activate() { this.ed.setToolOpts({ inkKind: this.kind }); }
  private prefsFor() { return this.ed.opts.inkPrefs[this.kind] ?? { size: INK_DEFAULTS[this.kind].size, opacity: INK_DEFAULTS[this.kind].opacity }; }

  private makeInk(pts: number[]): VInk {
    const d = INK_DEFAULTS[this.kind], pf = this.prefsFor(), o = this.ed.opts;
    const penInput = this.pointerType === 'pen';
    return {
      ...baseObject(), id: uid('ob'), type: 'ink', pts, ink: this.kind, fill: solid(this.ed.fg),
      size: pf.size, thinning: o.inkPressure ? d.thinning : 0, smoothing: Math.max(d.smoothing, o.inkSmoothing * 0.9), streamline: Math.max(d.streamline * 0.8, o.inkSmoothing * 0.7),
      taperStart: d.taperStart, taperEnd: d.taperEnd, cap: d.cap, simulatePressure: !penInput && d.simulatePressure && o.inkPressure,
      opacity: pf.opacity, blend: d.blend === 'multiply' ? 'multiply' : undefined,
    };
  }

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    this.pageId = e.page.id; this.down = true; this.snapped = null;
    this.pointerType = e.pointerType;
    const pr = e.pointerType === 'mouse' ? 0.5 : Math.pow(e.pressure || 0.5, prefs.get().pressureGamma);
    this.pts = [e.local.x, e.local.y, pr];
    this.lastMove = performance.now();
    this.armHold();
    ed.requestOverlay();
  }
  private armHold() {
    if (this.holdTimer) clearTimeout(this.holdTimer);
    if (!this.ed.opts.inkShapeSnap || this.kind === 'highlighter') return;
    this.holdTimer = setTimeout(() => this.trySnap(), 650);
  }
  private trySnap() {
    if (!this.down || this.pts.length < 18) return;
    const pts: Vec[] = [];
    for (let i = 0; i < this.pts.length; i += 3) pts.push({ x: this.pts[i], y: this.pts[i + 1] });
    const r = recognizeShape(pts);
    if (!r) return;
    const ed = this.ed, pf = this.prefsFor();
    const stroke = { color: ed.fg, width: pf.size, cap: 'round' as const, join: 'round' as const, dash: [] };
    const base = { ...baseObject(), id: uid('ob'), fill: null, stroke, opacity: pf.opacity };
    if (r.kind === 'line') this.snapped = { ...base, type: 'line', x1: r.a.x, y1: r.a.y, x2: r.b.x, y2: r.b.y, arrowStart: false, arrowEnd: false } as VObject;
    else if (r.kind === 'rect') this.snapped = { ...base, type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, rx: 0 } as VRect;
    else if (r.kind === 'ellipse') this.snapped = { ...base, type: 'ellipse', cx: r.cx, cy: r.cy, rx: r.rx, ry: r.ry } as VEllipse;
    else this.snapped = { ...base, type: 'path', paths: [{ closed: true, nodes: r.pts.map((p) => ({ x: p.x, y: p.y, ix: 0, iy: 0, ox: 0, oy: 0 })) }], fillRule: 'nonzero' } as VPath;
    ed.setStatus('Shape recognised — release to keep');
    ed.requestOverlay();
  }

  pointerMove(e: ToolPointer) {
    this.hoverPt = e.local;
    if (!this.down) return;
    const n = this.pts.length;
    const lx = this.pts[n - 3], ly = this.pts[n - 2];
    const d = Math.hypot(e.local.x - lx, e.local.y - ly);
    if (d < 0.4 / this.ed.view.zoom) return;
    const pr = e.pointerType === 'mouse' ? 0.5 : Math.pow(e.pressure || 0.5, prefs.get().pressureGamma);
    if (!this.snapped) this.pts.push(e.local.x, e.local.y, pr);
    if (d > 3 / this.ed.view.zoom) { this.lastMove = performance.now(); if (!this.snapped) this.armHold(); }
    this.ed.requestOverlay();
  }
  hover(e: ToolPointer) { this.hoverPt = e.page ? e.local : null; this.ed.requestOverlay(); }
  pointerUp(e: ToolPointer) {
    if (!this.down) return;
    this.down = false;
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = null; }
    const ed = this.ed;
    const wasSnapped = !!this.snapped;
    const obj = this.snapped ?? (this.pts.length >= 3 ? this.makeInk(this.finalPts(e)) : null);
    this.pts = []; this.snapped = null;
    if (obj) addObject(ed, obj, wasSnapped ? 'Shape' : `Ink (${this.kind})`);
    ed.objSel = [];
    ed.changed('objsel');
    ed.requestOverlay();
  }
  private finalPts(e: ToolPointer): number[] {
    const pts = this.pts.slice();
    if (pts.length === 3) pts.push(pts[0] + 0.01, pts[1] + 0.01, pts[2]); // single dot
    void e;
    return pts;
  }
  cancel() { this.down = false; this.pts = []; this.snapped = null; if (this.holdTimer) clearTimeout(this.holdTimer); this.ed.requestOverlay(); }

  drawOverlay(o: OverlayCtx) {
    const { ctx } = o;
    if (this.down && o.page && o.page.id === this.pageId) {
      const obj = this.snapped ?? (this.pts.length >= 3 ? this.makeInk(this.pts.length === 3 ? [...this.pts, this.pts[0] + 0.01, this.pts[1] + 0.01, this.pts[2]] : this.pts) : null);
      if (obj) { ctx.save(); setCtxMat(ctx, o.pageMatrix(o.page)); drawObject(ctx, obj, { scale: o.zoom }); ctx.restore(); }
    } else if (this.hoverPt && o.page) {
      const s = o.localToScreen(o.page, this.hoverPt), r = Math.max(2, (this.prefsFor().size / 2) * o.zoom);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }
  }
}

// ------------------------------------------------------------------
/** page-space copy of an ink stroke (transform baked) for hit-testing / splitting. `maxGap` resamples sparse strokes. */
function inkPageSpace(o: VInk, maxGap = 0): { pts: Vec[]; pr: number[]; k: number } {
  const pts: Vec[] = [], pr: number[] = [];
  for (let i = 0; i + 2 < o.pts.length + 0.5; i += 3) {
    const p = mApply(o.tf, { x: o.pts[i], y: o.pts[i + 1] }), q = o.pts[i + 2] ?? 0.5;
    if (maxGap > 0 && pts.length) {
      const a = pts[pts.length - 1], aq = pr[pr.length - 1], d = dist(a, p), n = Math.floor(d / maxGap);
      for (let j = 1; j <= n; j++) { const t = j / (n + 1); pts.push({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t }); pr.push(aq + (q - aq) * t); }
    }
    pts.push(p); pr.push(q);
  }
  return { pts, pr, k: mScaleFactor(o.tf) };
}
const nearPolyline = (pts: Vec[], p: Vec, rad: number) => {
  if (pts.length === 1) return dist(pts[0], p) <= rad;
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= rad) return true;
  return false;
};

export class StrokeEraserTool extends Tool {
  id = 'ink-eraser'; name = 'Eraser';
  cursor = 'none';
  private live: ReturnType<Editor['beginLive']> | null = null;
  private hoverPt: Vec | null = null;
  private pageId = '';
  private changedAny = false;

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    // on pixel layers the stroke eraser behaves as a normal eraser
    const l = ed.layer;
    if (l && l.type === 'raster' && !ed.page.layers.some((x) => x.type === 'vector')) { ed.setBrushPreset('erase-hard'); return; }
    this.pageId = e.page.id;
    this.live = ed.beginLive(); this.changedAny = false;
    this.erase(e.local);
  }
  pointerMove(e: ToolPointer) { this.hoverPt = e.local; if (this.live) this.erase(e.local); this.ed.requestOverlay(); }
  hover(e: ToolPointer) { this.hoverPt = e.page ? e.local : null; this.ed.requestOverlay(); }
  pointerUp() {
    if (this.live) { if (this.changedAny) this.ed.endLive(this.ed.opts.strokeEraserMode === 'stroke' ? 'Erase strokes' : 'Erase', this.live); this.live = null; }
  }
  private erase(p: Vec) {
    const ed = this.ed, page = ed.page, r = ed.opts.strokeEraserSize / 2;
    const partial = ed.opts.strokeEraserMode === 'pixel';
    const remove = new Set<string>();
    const replace = new Map<string, VObject>();
    const extra: { layerId: string; objs: VObject[] }[] = [];
    walkLayers(page.layers, (l) => {
      if (l.type !== 'vector' || !l.visible || l.locked) return;
      for (const o of l.objects) {
        if (o.locked || o.hidden) continue;
        const b = objectBounds(o);
        if (p.x < b.x - r || p.x > b.x + b.w + r || p.y < b.y - r || p.y > b.y + b.h + r) continue;
        if (o.type === 'ink') {
          const rad0 = r + (o.size * mScaleFactor(o.tf)) / 2 * 0.5;
          const { pts, pr, k } = inkPageSpace(o, partial ? Math.max(1.5, rad0 / 2) : 0);
          const rad = rad0;
          if (!nearPolyline(pts, p, rad)) continue;
          if (!partial) { remove.add(o.id); continue; }
          // split into surviving runs
          const runs: number[][] = []; let cur: number[] = [];
          pts.forEach((q, i) => { if (dist(q, p) <= rad) { if (cur.length >= 6) runs.push(cur); cur = []; } else cur.push(q.x, q.y, pr[i]); });
          if (cur.length >= 6) runs.push(cur);
          remove.add(o.id);
          extra.push({ layerId: l.id, objs: runs.map((pts2) => ({ ...o, id: uid('ob'), tf: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, pts: pts2, size: o.size * k, taperStart: o.taperStart * k, taperEnd: o.taperEnd * k } as VInk)) });
        } else if (hitTestObject(o, p, r)) remove.add(o.id);
      }
    });
    if (!remove.size && !replace.size) return;
    this.changedAny = true;
    walkLayers(page.layers, (l) => {
      if (l.type !== 'vector') return;
      l.objects = l.objects.filter((o) => !remove.has(o.id));
      for (const x of extra) if (x.layerId === l.id) l.objects.push(...x.objs);
    });
    replaceObjects(page, replace);
    ed.objSel = ed.objSel.filter((i) => !remove.has(i));
    ed.changed('doc', 'layers', 'objsel');
  }
  drawOverlay(o: OverlayCtx) {
    if (!this.hoverPt || !o.page) return;
    const s = o.localToScreen(o.page, this.hoverPt), r = (this.ed.opts.strokeEraserSize / 2) * o.zoom;
    o.ctx.save(); o.ctx.strokeStyle = '#fff'; o.ctx.lineWidth = 2.5; o.ctx.beginPath(); o.ctx.arc(s.x, s.y, r, 0, Math.PI * 2); o.ctx.stroke();
    o.ctx.strokeStyle = '#000'; o.ctx.lineWidth = 1; o.ctx.stroke(); o.ctx.restore();
  }
}

// ------------------------------------------------------------------
/** Freeform lasso that selects vector objects (ink strokes, shapes…) – the notes-app "Lasso". */
export class ObjectLassoTool extends Tool {
  id = 'object-lasso'; name = 'Lasso (objects)';
  cursor = 'crosshair';
  private pts: Vec[] = [];
  private pageId = '';
  private shift = false;
  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    if (e.page.id !== this.ed.page.id) this.ed.setActivePage(e.page.id);
    this.pts = [e.local]; this.pageId = e.page.id; this.shift = e.shift;
  }
  pointerMove(e: ToolPointer) {
    if (!this.pts.length) return;
    const l = this.pts[this.pts.length - 1];
    if (dist(l, e.local) > 2 / this.ed.view.zoom) { this.pts.push(e.local); this.ed.requestOverlay(); }
  }
  pointerUp() {
    const ed = this.ed, poly = this.pts; this.pts = [];
    if (poly.length < 3) { ed.requestOverlay(); return; }
    const inside = (p: Vec) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c; } return c; };
    const hits: string[] = [];
    walkLayers(ed.page.layers, (l) => {
      if (l.type !== 'vector' || !l.visible || l.locked) return;
      for (const o of l.objects) {
        if (o.locked || o.hidden) continue;
        let sel = false;
        if (o.type === 'ink') { for (let i = 0; i + 1 < o.pts.length; i += 3) if (inside(mApply(o.tf, { x: o.pts[i], y: o.pts[i + 1] }))) { sel = true; break; } }
        else { const b = objectBounds(o, false); sel = inside({ x: b.x + b.w / 2, y: b.y + b.h / 2 }); }
        if (sel) hits.push(o.id);
      }
    });
    ed.objSel = this.shift ? [...new Set([...ed.objSel, ...hits])] : hits;
    ed.changed('objsel');
    if (hits.length) ed.setTool('move');
    ed.requestOverlay();
  }
  cancel() { this.pts = []; this.ed.requestOverlay(); }
  drawOverlay(o: OverlayCtx) {
    if (this.pts.length < 2 || !o.page || o.page.id !== this.pageId) return;
    const { ctx } = o;
    const path = () => { ctx.beginPath(); this.pts.forEach((p, i) => { const s = o.localToScreen(o.page!, p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); };
    ctx.save(); path(); ctx.fillStyle = 'rgba(26,188,156,0.10)'; ctx.fill(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#1abc9c'; ctx.stroke(); ctx.restore();
  }
}

// ------------------------------------------------------------------
export class LaserTool extends Tool {
  id = 'laser'; name = 'Laser Pointer';
  cursor = 'none';
  private trail: { p: Vec; t: number }[] = [];
  private pageId = '';
  private hold = false;
  private pos: Vec | null = null;
  get animated() { return this.trail.length > 0 || this.hold; }
  pointerDown(e: ToolPointer) { if (e.page) { this.pageId = e.page.id; this.hold = true; this.add(e); } }
  pointerMove(e: ToolPointer) { if (e.page) { this.pageId = e.page.id; this.pos = e.local; if (this.hold) this.add(e); this.ed.requestOverlay(); } }
  hover(e: ToolPointer) { this.pointerMove(e); }
  pointerUp() { this.hold = false; }
  private add(e: ToolPointer) { this.trail.push({ p: e.local, t: performance.now() }); }
  drawOverlay(o: OverlayCtx) {
    if (!o.page || o.page.id !== this.pageId) return;
    const now = performance.now(), life = 900;
    this.trail = this.trail.filter((t) => now - t.t < life);
    const { ctx } = o;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1], b = this.trail[i], age = (now - b.t) / life, A = o.localToScreen(o.page, a.p), B = o.localToScreen(o.page, b.p);
      ctx.strokeStyle = this.ed.opts.laserColor; ctx.globalAlpha = Math.max(0, 1 - age); ctx.lineWidth = 6 * (1 - age * 0.7);
      ctx.shadowColor = this.ed.opts.laserColor; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    }
    if (this.pos) {
      const s = o.localToScreen(o.page, this.pos);
      ctx.globalAlpha = 1; ctx.shadowBlur = 16; ctx.shadowColor = this.ed.opts.laserColor; ctx.fillStyle = this.ed.opts.laserColor;
      ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (this.trail.length) this.ed.requestOverlay();
  }
  deactivate() { this.trail = []; this.pos = null; this.hold = false; }
}

// ------------------------------------------------------------------
export class NoteTool extends Tool {
  id = 'note'; name = 'Sticky Note';
  cursor = 'crosshair';
  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const k = Math.max(1, ed.doc.dpi / 96);
    const n: VNote = { ...baseObject(), id: uid('ob'), type: 'note', x: e.local.x, y: e.local.y, w: 240 * k, h: 170 * k, text: '', color: ed.opts.noteColor, collapsed: false, fill: null };
    addObject(ed, n, 'Add note');
    bus.emit('dialog', { name: 'note', payload: { objId: n.id, editorId: ed.id } });
    ed.setTool('move');
  }
}

export class ImageTool extends Tool {
  id = 'image'; name = 'Image';
  cursor = 'crosshair';
  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    if (e.page.id !== this.ed.page.id) this.ed.setActivePage(e.page.id);
    bus.emit('pick-image', { asObject: this.ed.doc.kind !== 'drawing' });
    this.ed.setTool('move');
  }
}

export class MeasureTool extends Tool {
  id = 'measure'; name = 'Measure';
  cursor = 'crosshair';
  private a: Vec | null = null; private b: Vec | null = null; private pageId = '';
  pointerDown(e: ToolPointer) { if (e.page) { this.a = e.local; this.b = e.local; this.pageId = e.page.id; } }
  pointerMove(e: ToolPointer) { if (this.a) { this.b = e.local; this.ed.requestOverlay(); const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y; this.ed.setStatus(`Distance ${Math.hypot(dx, dy).toFixed(1)} px · angle ${(Math.atan2(-dy, dx) * 180 / Math.PI).toFixed(1)}° · Δx ${dx.toFixed(1)} Δy ${dy.toFixed(1)}`, 0); } }
  pointerUp() { /* keep the line until next click */ }
  drawOverlay(o: OverlayCtx) {
    if (!this.a || !this.b || !o.page || o.page.id !== this.pageId) return;
    const A = o.localToScreen(o.page, this.a), B = o.localToScreen(o.page, this.b), { ctx } = o;
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.strokeStyle = '#ff9f0a'; ctx.lineWidth = 1.5; ctx.stroke();
    for (const p of [A, B]) { ctx.fillStyle = '#ff9f0a'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
    const d = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y).toFixed(1) + ' px';
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(0,0,0,0.75)'; const w = ctx.measureText(d).width; ctx.fillRect((A.x + B.x) / 2 + 8, (A.y + B.y) / 2 - 18, w + 10, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(d, (A.x + B.x) / 2 + 13, (A.y + B.y) / 2 - 4); ctx.restore();
  }
}
void findObject;
