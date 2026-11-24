// Move tool (objects + pixels) and Free Transform tool.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Editor } from '../editor/editor';
import { TransformBox, HandleId } from './transformBox';
import type { Mat, Rect, Vec } from '../core/geometry';
import { IDENTITY, mMul, mTranslate, mRotate, mScale, mApply, setCtxMat, transformRectBounds, rectUnion, rectIntersect, rectFromPoints, rectCenter, mInvert } from '../core/geometry';
import type { RasterLayer, VObject } from '../core/model';
import { findObject, walkLayers } from '../core/model';
import { createCanvas, ctx2d } from '../core/util';
import { hitTestObject, objectBounds, objectsBounds, transformObject, cloneObject } from '../core/vector';
import { replaceObjects, objectsInRect, duplicateObjects } from '../editor/objectOps';
import { snapRect } from '../editor/snap';

/** Pixels lifted from a raster layer for interactive moving / transforming. */
export class FloatingPixels {
  lifted: HTMLCanvasElement;
  base: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  rect: Rect;
  maskCanvas: HTMLCanvasElement | null = null;
  hadSelection: boolean;
  constructor(private ed: Editor, public layer: RasterLayer, copy = false) {
    const pg = ed.page, sel = ed.selection;
    const W = pg.width, H = pg.height;
    this.hadSelection = !sel.isEmpty;
    this.lifted = createCanvas(W, H); this.base = createCanvas(W, H); this.overlay = createCanvas(W, H);
    const src = layer.surface.peek();
    const lc = ctx2d(this.lifted), bc = ctx2d(this.base);
    if (src) lc.drawImage(src, 0, 0);
    if (this.hadSelection) {
      this.maskCanvas = sel.maskCanvas()!;
      this.rect = sel.bounds!;
      lc.globalCompositeOperation = 'destination-in'; lc.drawImage(this.maskCanvas, 0, 0);
      if (src) bc.drawImage(src, 0, 0);
      if (!copy) { bc.globalCompositeOperation = 'destination-out'; bc.drawImage(this.maskCanvas, 0, 0); }
    } else {
      this.rect = layer.surface.contentBounds() ?? { x: 0, y: 0, w: W, h: H };
      if (copy && src) bc.drawImage(src, 0, 0);
    }
    this.render(IDENTITY);
  }
  render(m: Mat) {
    const c = ctx2d(this.overlay);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    c.drawImage(this.base, 0, 0);
    c.save(); setCtxMat(c, m); c.imageSmoothingQuality = 'high'; c.drawImage(this.lifted, 0, 0); c.restore();
  }
  commit(label: string, m: Mat) {
    const ed = this.ed, pg = ed.page;
    const moved = transformRectBounds(m, this.rect);
    const R = rectIntersect({ x: Math.floor(Math.min(this.rect.x, moved.x)) - 2, y: Math.floor(Math.min(this.rect.y, moved.y)) - 2, w: Math.ceil(Math.max(this.rect.x + this.rect.w, moved.x + moved.w) - Math.min(this.rect.x, moved.x)) + 4, h: Math.ceil(Math.max(this.rect.y + this.rect.h, moved.y + moved.h) - Math.min(this.rect.y, moved.y)) + 4 }, { x: 0, y: 0, w: pg.width, h: pg.height });
    ed.overlays = [];
    if (!R) return;
    ed.history.beginGroup();
    ed.mutateRaster(label, this.layer.id, 'layer', R, (s) => {
      s.ctx.clearRect(R.x, R.y, R.w, R.h);
      s.ctx.drawImage(this.overlay, R.x, R.y, R.w, R.h, R.x, R.y, R.w, R.h);
    });
    if (this.hadSelection && this.maskCanvas) {
      const mc = this.maskCanvas;
      ed.editSelection(label, (sel) => {
        const c = createCanvas(pg.width, pg.height), x = ctx2d(c);
        setCtxMat(x, m); x.drawImage(mc, 0, 0);
        sel.fromCanvasAlpha(c, 'replace');
      });
    }
    ed.history.endGroup(label);
  }
  dispose() { this.ed.overlays = []; }
}

// ---------------------------------------------------------------
export function pickObjectAt(ed: Editor, p: Vec, tolPx = 6): VObject | null {
  const page = ed.page;
  const tol = tolPx / ed.view.zoom;
  const layers: { objs: VObject[] }[] = [];
  walkLayers(page.layers, (l) => { if (l.type === 'vector' && l.visible && !l.locked) layers.push({ objs: l.objects }); });
  for (let i = layers.length - 1; i >= 0; i--) {
    const objs = layers[i].objs;
    for (let j = objs.length - 1; j >= 0; j--) {
      const o = objs[j];
      if (o.locked || o.hidden) continue;
      if (hitTestObject(o, p, tol)) return o;
    }
  }
  return null;
}

export class MoveTool extends Tool {
  id = 'move'; name = 'Move';
  cursor = 'default';
  private box: TransformBox | null = null;
  private mode: 'none' | 'drag' | 'box' | 'marquee' | 'raster' = 'none';
  private origObjs = new Map<string, VObject>();
  private live: ReturnType<Editor['beginLive']> | null = null;
  private start: Vec = { x: 0, y: 0 };
  private marquee: Rect | null = null;
  private moved = false;
  private float: FloatingPixels | null = null;
  private guides: { axis: 'x' | 'y'; pos: number }[] = [];
  private hoverObj: string | null = null;
  private pageId = '';
  private shiftToggled = false;

  activate() { this.refreshBox(); }
  deactivate() { this.box = null; this.hoverObj = null; }

  /** box around the selected vector objects */
  refreshBox() {
    const objs = this.ed.selectedObjects();
    const b = objectsBounds(objs);
    this.box = b ? new TransformBox(b) : null;
  }

  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    if (e.page.id !== ed.page.id) { ed.setActivePage(e.page.id); }
    this.pageId = e.page.id;
    this.start = e.local; this.moved = false; this.shiftToggled = false;
    const layer = ed.layer;

    // ----- raster layers: move pixels (selection or whole layer) -----
    if (layer && layer.type === 'raster' && !ed.objSel.length) {
      if (layer.locked) { ed.setStatus('This layer is locked'); return; }
      this.float = new FloatingPixels(ed, layer, e.alt);
      ed.overlays = [{ layerId: layer.id, target: 'layer', canvas: this.float.overlay }];
      this.mode = 'raster';
      return;
    }

    // ----- vector objects -----
    this.refreshBox();
    let insideBox = false;
    if (this.box) {
      const h = this.box.hit(e.local, ed.view.zoom);
      if (h && h !== 'body') {
        this.box.begin(h, e.local);
        this.beginEdit();
        this.mode = 'box';
        return;
      }
      insideBox = h === 'body';
    }
    const hit = pickObjectAt(ed, e.local);
    // dragging empty space inside the selection box moves the whole selection (like lasso-select in note apps)
    if (!hit && insideBox && !e.shift && this.box && ed.objSel.length) {
      this.box.begin('body', e.local);
      this.beginEdit();
      this.mode = 'drag';
      return;
    }
    if (hit) {
      if (e.detail >= 2) {
        if (hit.type === 'text') { ed.objSel = [hit.id]; ed.changed('objsel'); ed.setTool('text'); (ed.getTool('text') as any).editObject?.(hit.id); return; }
        if (hit.type === 'path' || hit.type === 'rect' || hit.type === 'ellipse' || hit.type === 'polygon' || hit.type === 'line') { ed.objSel = [hit.id]; ed.changed('objsel'); ed.setTool('node'); return; }
      }
      const sel = new Set(ed.objSel);
      if (e.shift) { if (sel.has(hit.id)) { sel.delete(hit.id); this.shiftToggled = true; } else sel.add(hit.id); ed.objSel = [...sel]; ed.changed('objsel'); }
      else if (!sel.has(hit.id)) { ed.objSel = [hit.id]; ed.changed('objsel'); }
      this.refreshBox();
      if (!this.box || !ed.objSel.includes(hit.id)) return;
      // alt-drag duplicates
      if (e.alt) duplicateObjects(ed, ed.objSel, 0);
      this.refreshBox();
      this.box!.begin('body', e.local);
      this.beginEdit();
      this.mode = 'drag';
      return;
    }
    // empty space: marquee
    if (!e.shift && ed.objSel.length) { ed.objSel = []; ed.changed('objsel'); this.box = null; }
    this.marquee = { x: e.local.x, y: e.local.y, w: 0, h: 0 };
    this.mode = 'marquee';
  }

  private beginEdit() {
    const ed = this.ed;
    this.live = ed.beginLive();
    this.origObjs.clear();
    for (const id of ed.objSel) { const f = findObject(ed.page, id); if (f) this.origObjs.set(id, f.obj); }
  }

  pointerMove(e: ToolPointer) {
    const ed = this.ed;
    if (this.mode === 'raster' && this.float) {
      let dx = e.local.x - this.start.x, dy = e.local.y - this.start.y;
      if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      this.moved = true;
      this.float.render(mTranslate(Math.round(dx), Math.round(dy)));
      ed.requestRender();
      return;
    }
    if ((this.mode === 'drag' || this.mode === 'box') && this.box) {
      this.moved = true;
      const box = this.box;
      let local = e.local;
      if (this.mode === 'drag') {
        // snapping for body drags
        const raw = { x: local.x - this.start.x, y: local.y - this.start.y };
        const b0 = box.rect;
        const moved = { x: b0.x + raw.x, y: b0.y + raw.y, w: b0.w, h: b0.h };
        const snap = snapRect(ed, ed.page, moved, new Set(ed.objSel));
        local = { x: local.x + snap.dx, y: local.y + snap.dy };
        this.guides = snap.guides;
      }
      const D = box.drag(local, { shift: e.shift, alt: e.alt, ctrl: e.ctrl });
      const map = new Map<string, VObject>();
      for (const [id, o] of this.origObjs) map.set(id, transformObject(o, D));
      replaceObjects(ed.page, map);
      ed.changed('doc'); ed.requestOverlay();
      return;
    }
    if (this.mode === 'marquee' && this.marquee) {
      this.marquee = rectFromPoints(this.start, e.local);
      ed.requestOverlay();
    }
  }

  hover(e: ToolPointer) {
    const ed = this.ed;
    let cur = 'default';
    const layer = ed.layer;
    if (layer && layer.type === 'raster' && !ed.objSel.length) cur = 'move';
    else {
      if (this.box && e.page) { const h = this.box.hit(e.local, ed.view.zoom); if (h) cur = this.box.cursorFor(h); }
      const o = e.page ? pickObjectAt(ed, e.local) : null;
      const id = o?.id ?? null;
      if (id !== this.hoverObj) { this.hoverObj = id; ed.requestOverlay(); }
      if (o && cur === 'default') cur = 'move';
    }
    this.cursor = cur;
  }

  pointerUp(e: ToolPointer) {
    const ed = this.ed;
    if (this.mode === 'raster' && this.float) {
      const dx = Math.round(e.local.x - this.start.x), dy = Math.round(e.local.y - this.start.y);
      if (this.moved && (dx || dy)) {
        let ddx = dx, ddy = dy;
        if (e.shift) { if (Math.abs(dx) > Math.abs(dy)) ddy = 0; else ddx = 0; }
        this.float.commit('Move', mTranslate(ddx, ddy));
      } else this.float.dispose();
      this.float = null;
      ed.requestRender();
    } else if ((this.mode === 'drag' || this.mode === 'box') && this.live) {
      if (this.moved) ed.endLive(this.mode === 'box' ? 'Transform' : 'Move', this.live);
      this.live = null;
      this.box?.end();
      this.guides = [];
      this.refreshBox();
      ed.changed('objsel');
    } else if (this.mode === 'marquee' && this.marquee) {
      const r = this.marquee;
      if (r.w > 2 / ed.view.zoom || r.h > 2 / ed.view.zoom) {
        const hits = objectsInRect(ed.page, r).map((o) => o.id);
        const set = new Set(e.shift ? ed.objSel : []);
        hits.forEach((id) => set.add(id));
        ed.objSel = [...set]; ed.changed('objsel');
      }
      this.marquee = null;
      this.refreshBox();
    }
    void this.shiftToggled;
    this.mode = 'none';
    ed.requestOverlay();
  }

  keyDown(e: KeyboardEvent): boolean {
    const ed = this.ed;
    if (e.key.startsWith('Arrow') && ed.objSel.length) {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      import('../editor/objectOps').then(({ updateObjects }) => updateObjects(ed, ed.objSel, (o) => transformObject(o, mTranslate(dx, dy)), 'Nudge', 'nudge'));
      return true;
    }
    if (e.key === 'Escape' && ed.objSel.length) { ed.objSel = []; ed.changed('objsel'); this.box = null; return true; }
    return false;
  }
  cancel() {
    if (this.float) { this.float.dispose(); this.float = null; this.ed.requestRender(); }
    this.mode = 'none'; this.marquee = null;
  }

  drawOverlay(o: OverlayCtx) {
    const ed = this.ed;
    if (!o.page) return;
    const page = o.page;
    const ctx = o.ctx;
    const ts = (p: Vec) => o.localToScreen(page, p);
    // hover outline
    if (this.hoverObj && !ed.objSel.includes(this.hoverObj)) {
      const f = findObject(page, this.hoverObj);
      if (f) { const b = objectBounds(f.obj, false); const a = ts({ x: b.x, y: b.y }), c = ts({ x: b.x + b.w, y: b.y + b.h }); ctx.save(); ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 1.5; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); ctx.restore(); }
    }
    // per-object outlines for multi-selection
    if (ed.objSel.length > 1) {
      ctx.save(); ctx.strokeStyle = 'rgba(26,188,156,0.7)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      for (const ob of ed.selectedObjects()) { const b = objectBounds(ob, false); const a = ts({ x: b.x, y: b.y }), c = ts({ x: b.x + b.w, y: b.y + b.h }); ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y); }
      ctx.restore();
    }
    if (this.box && ed.objSel.length && (this.mode === 'none' || this.mode === 'drag' || this.mode === 'box')) {
      // refresh to live bounds when idle
      if (this.mode === 'none') this.refreshBox();
      this.box?.draw(ctx, ts, o.zoom, true);
    }
    for (const g of this.guides) {
      ctx.save(); ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (g.axis === 'x') { const a = ts({ x: g.pos, y: 0 }), b = ts({ x: g.pos, y: page.height }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      else { const a = ts({ x: 0, y: g.pos }), b = ts({ x: page.width, y: g.pos }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke(); ctx.restore();
    }
    if (this.marquee) {
      const a = ts({ x: this.marquee.x, y: this.marquee.y }), b = ts({ x: this.marquee.x + this.marquee.w, y: this.marquee.y + this.marquee.h });
      ctx.save(); ctx.fillStyle = 'rgba(26,188,156,0.12)'; ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 1; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y); ctx.restore();
    }
  }
}

// ---------------------------------------------------------------
/** Free transform for pixels (selection or whole layer). Enter = apply, Esc = cancel. */
export class TransformTool extends Tool {
  id = 'transform'; name = 'Free Transform';
  cursor = 'default';
  private float: FloatingPixels | null = null;
  private box: TransformBox | null = null;
  private dragging = false;

  activate() {
    const ed = this.ed;
    const l = ed.layer;
    if (!l || l.type !== 'raster' || ed.objSel.length) { if (ed.objSel.length || (l && l.type === 'vector')) { ed.setTool('move'); } else ed.setStatus('Free Transform needs a pixel layer or selected objects'); return; }
    this.begin(l);
  }
  private begin(l: RasterLayer) {
    if (l.locked) { this.ed.setStatus('This layer is locked'); return; }
    this.float = new FloatingPixels(this.ed, l);
    this.box = new TransformBox(this.float.rect);
    this.ed.overlays = [{ layerId: l.id, target: 'layer', canvas: this.float.overlay }];
    this.ed.requestRender(); this.ed.requestOverlay();
  }
  get hasFloat() { return !!this.float; }
  private applyBox() { if (this.float && this.box) { this.float.render(this.box.total); this.ed.requestRender(); this.ed.requestOverlay(); } }

  pointerDown(e: ToolPointer) {
    if (!this.float) { const l = this.ed.layer; if (l && l.type === 'raster') this.begin(l); return; }
    if (!this.box) return;
    const h = this.box.hit(e.local, this.ed.view.zoom);
    if (h) { this.box.begin(h, e.local); this.dragging = true; }
  }
  pointerMove(e: ToolPointer) {
    if (!this.box) return;
    if (this.dragging) { this.box.drag(e.local, { shift: e.shift, alt: e.alt, ctrl: e.ctrl }); this.applyBox(); }
  }
  hover(e: ToolPointer) { if (this.box) this.cursor = this.box.cursorFor(this.box.hit(e.local, this.ed.view.zoom)); }
  pointerUp() { this.dragging = false; this.box?.end(); }

  private about(m: Mat) { const c = this.box!.center(); return mMul(mTranslate(c.x, c.y), mMul(m, mTranslate(-c.x, -c.y))); }
  flip(h: boolean) { if (!this.box) return; this.box.m = mMul(this.about(h ? mScale(-1, 1) : mScale(1, -1)), this.box.m); this.applyBox(); }
  rotate90(cw = true) { if (!this.box) return; this.box.m = mMul(this.about(mRotate(cw ? Math.PI / 2 : -Math.PI / 2)), this.box.m); this.applyBox(); }
  setScale(sx: number, sy: number) { if (!this.box) return; this.box.m = mMul(this.about(mScale(sx, sy)), this.box.m); this.applyBox(); }

  keyDown(e: KeyboardEvent): boolean {
    if (!this.float) return false;
    if (e.key === 'Enter') { this.commit(); this.ed.setTool(this.ed.prevToolId === 'transform' ? 'move' : this.ed.prevToolId); return true; }
    if (e.key === 'Escape') { this.cancel(); this.ed.setTool(this.ed.prevToolId === 'transform' ? 'move' : this.ed.prevToolId); return true; }
    return false;
  }
  commit() {
    if (this.float && this.box) {
      const ident = Math.abs(this.box.m.a - 1) + Math.abs(this.box.m.b) + Math.abs(this.box.m.c) + Math.abs(this.box.m.d - 1) + Math.abs(this.box.m.e) + Math.abs(this.box.m.f) < 1e-6;
      if (ident) this.float.dispose(); else this.float.commit('Free transform', this.box.total);
    }
    this.float = null; this.box = null;
    this.ed.requestRender(); this.ed.requestOverlay();
  }
  cancel() {
    if (this.float) this.float.dispose();
    this.float = null; this.box = null;
    this.ed.requestRender(); this.ed.requestOverlay();
  }
  deactivate() { this.commit(); }
  drawOverlay(o: OverlayCtx) { if (this.box && o.page) this.box.draw(o.ctx, (p) => o.localToScreen(o.page!, p), o.zoom, true); }
}
void rectUnion; void rectCenter; void mInvert; void mApply; void cloneObject;
