// Brush, eraser, smudge, blur, sharpen, dodge, burn and clone stamp (all driven by BrushStroke).

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Editor } from '../editor/editor';
import { BrushStroke, InputPoint, symmetryMatrices } from '../brush/engine';
import type { LayerOverlay } from '../core/render';
import { parseColor, luminance } from '../core/color';
import { prefs } from '../app/store';
import type { RasterSurface } from '../core/raster';

export class BrushTool extends Tool {
  cursor = 'none';
  private stroke: BrushStroke | null = null;
  private ctx: { pageId: string; layerId: string; target: 'layer' | 'mask'; surface: RasterSurface } | null = null;
  private last: { x: number; y: number } | null = null;
  private lastEnd: { pageId: string; layerId: string; x: number; y: number } | null = null;
  private cloneSrc: { pageId: string; x: number; y: number } | null = null;
  private cloneOffset: { dx: number; dy: number } | null = null;
  private hoverPt: { x: number; y: number } | null = null;

  constructor(ed: Editor, public id: string, public name: string) { super(ed); }

  deactivate() { this.cancel(); this.hoverPt = null; }

  private pt(e: ToolPointer): InputPoint {
    let p = e.pressure;
    if (e.pointerType === 'mouse') p = 1;
    else p = Math.pow(Math.max(0.0001, p || 0.5), prefs.get().pressureGamma);
    return { x: e.local.x, y: e.local.y, pressure: p, tiltX: e.tiltX, tiltY: e.tiltY, time: e.time };
  }

  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const s = ed.brush;
    // Clone stamp: alt-click sets the source point
    if (s.mode === 'clone' && e.alt) {
      this.cloneSrc = { pageId: e.page.id, x: e.local.x, y: e.local.y };
      this.cloneOffset = null;
      ed.setStatus('Clone source set — paint to clone');
      return;
    }
    if (s.mode === 'clone' && !this.cloneSrc) { ed.setStatus('Alt-click to set the clone source first'); return; }

    // pick target surface
    let layer = ed.layer;
    let target: 'layer' | 'mask' = 'layer';
    let surface: RasterSurface | null = null;
    if (layer && ed.editingMask && layer.mask) { target = 'mask'; surface = layer.mask; }
    else {
      const r = ed.ensureRasterTarget();
      layer = r;
      surface = r?.surface ?? null;
    }
    if (!layer || !surface) return;
    if (layer.locked) { ed.setStatus('This layer is locked'); return; }
    if (!layer.visible) { ed.setStatus('This layer is hidden'); return; }
    surface.canvas; // allocate pixels

    let color = ed.fg;
    let erase = s.mode === 'erase';
    if (target === 'mask') {
      // masks: black hides (erases), white reveals (paints)
      const lum = luminance(parseColor(ed.fg));
      if (s.mode === 'paint') { if (lum < 0.5) erase = true; else color = '#ffffff'; }
    }
    if (s.mode === 'clone') {
      const src = this.cloneSrc!;
      if (!this.cloneOffset) this.cloneOffset = { dx: src.x - e.local.x, dy: src.y - e.local.y };
    }
    const sel = ed.selection;
    const settings = { ...s, size: s.size * ed.opts.brushSizeScale };
    this.stroke = new BrushStroke({
      settings, color, surface, selectionMask: sel.isEmpty ? null : sel.maskCanvas(),
      alphaLock: layer.alphaLock && target === 'layer',
      symmetry: symmetryMatrices(ed.doc.symmetry, ed.page.width, ed.page.height),
      eraseOverride: erase,
      cloneSource: s.mode === 'clone' && this.cloneOffset ? { canvas: surface.canvas, dx: this.cloneOffset.dx, dy: this.cloneOffset.dy } : null,
    });
    this.ctx = { pageId: ed.page.id, layerId: layer.id, target, surface };
    const ov: LayerOverlay = { layerId: layer.id, target, canvas: this.stroke.preview };
    ed.overlays = [ov];
    const p = this.pt(e);
    // Shift-click: straight line from the end of the previous stroke
    const le = this.lastEnd;
    if (e.shift && le && le.pageId === ed.page.id && le.layerId === layer.id) {
      this.stroke.begin({ ...p, x: le.x, y: le.y });
      this.stroke.move({ ...p, x: (le.x + p.x) / 2, y: (le.y + p.y) / 2 });
      this.stroke.move(p);
    } else this.stroke.begin(p);
    this.last = { x: p.x, y: p.y };
    this.stroke.flush();
    ed.requestRender();
  }

  pointerMove(e: ToolPointer) {
    this.hoverPt = { x: e.local.x, y: e.local.y };
    if (!this.stroke) return;
    const p = this.pt(e);
    this.stroke.move(p);
    this.last = { x: p.x, y: p.y };
    this.stroke.flush();
    this.ed.requestRender();
    this.ed.requestOverlay();
  }

  hover(e: ToolPointer) { this.hoverPt = e.page ? { x: e.local.x, y: e.local.y } : null; this.ed.requestOverlay(); }

  pointerUp(e: ToolPointer) {
    if (!this.stroke || !this.ctx) return;
    const ed = this.ed;
    const c = this.ctx;
    this.stroke.end(this.pt(e));
    const patch = this.stroke.commit();
    this.stroke = null; ed.overlays = [];
    if (patch) {
      ed.commitRasterPatch(ed.brush.mode === 'erase' ? 'Erase' : ed.brush.name, c.pageId, c.layerId, c.target, patch);
      if (this.last) this.lastEnd = { pageId: c.pageId, layerId: c.layerId, x: this.last.x, y: this.last.y };
    }
    this.ctx = null;
    ed.requestRender();
  }

  cancel() {
    if (this.stroke) { this.stroke.cancel(); this.stroke = null; this.ed.overlays = []; this.ctx = null; this.ed.requestRender(); }
  }

  drawOverlay(o: OverlayCtx) {
    const p = this.hoverPt;
    if (!p || !o.page) return;
    const { ctx } = o;
    const s = this.ed.brush;
    const size = s.size * this.ed.opts.brushSizeScale;
    const c = o.localToScreen(o.page, p);
    const r = Math.max(1.5, (size / 2) * o.zoom);
    ctx.save();
    ctx.lineWidth = 1;
    for (const [col, w] of [['rgba(255,255,255,0.9)', 3], ['rgba(0,0,0,0.85)', 1]] as [string, number][]) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath();
      if (s.roundness < 1 || s.angle) { ctx.ellipse(c.x, c.y, r, Math.max(1, r * s.roundness), (s.angle * Math.PI) / 180, 0, Math.PI * 2); }
      else ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (r < 4) { ctx.beginPath(); ctx.moveTo(c.x - 6, c.y); ctx.lineTo(c.x + 6, c.y); ctx.moveTo(c.x, c.y - 6); ctx.lineTo(c.x, c.y + 6); ctx.stroke(); }
    }
    // clone source crosshair
    if (s.mode === 'clone' && this.cloneSrc && o.page.id === this.cloneSrc.pageId) {
      const off = this.cloneOffset;
      const sp = off ? { x: p.x + off.dx, y: p.y + off.dy } : { x: this.cloneSrc.x, y: this.cloneSrc.y };
      const q = o.localToScreen(o.page, sp);
      ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.moveTo(q.x - 8, q.y); ctx.lineTo(q.x + 8, q.y); ctx.moveTo(q.x, q.y - 8); ctx.lineTo(q.x, q.y + 8); ctx.stroke();
    }
    ctx.restore();
  }
}
