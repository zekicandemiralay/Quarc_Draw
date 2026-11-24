// Paint bucket, gradient and eyedropper.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Editor } from '../editor/editor';
import type { Vec } from '../core/geometry';
import { floodMask } from '../core/floodfill';
import { morphMask } from '../filters/pixels';
import { renderPageToCanvas } from '../core/render';
import { createCanvas, ctx2d } from '../core/util';
import { getPattern } from '../core/patterns';
import { buildGradientLUT, rgbaToHex, parseColor, sampleGradient, rgbaToCss } from '../core/color';
import type { LayerOverlay } from '../core/render';
import type { RasterLayer } from '../core/model';

/** Average colour of a size×size box at (x,y) on the composite (or active layer). Returns null if fully transparent. */
export function sampleColor(ed: Editor, pageId: string, x: number, y: number, size = 1, layerOnly = false): string | null {
  const pg = ed.doc.pages.find((p) => p.id === pageId);
  if (!pg) return null;
  const half = Math.floor(size / 2);
  const rx = Math.round(x) - half, ry = Math.round(y) - half;
  let src: HTMLCanvasElement | null = null;
  let sx = 0, sy = 0;
  const l = ed.layer;
  if (layerOnly && l && l.type === 'raster') { src = l.surface.peek(); sx = rx; sy = ry; }
  else { src = renderPageToCanvas(ed.doc, pg, 1, { region: { x: rx, y: ry, w: size, h: size } }); sx = 0; sy = 0; }
  if (!src) return null;
  const d = ctx2d(src, true).getImageData(Math.max(0, sx), Math.max(0, sy), size, size).data;
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++; }
  if (a === 0) return null;
  return rgbaToHex({ r: r / a, g: g / a, b: b / a, a: 1 });
}

export class EyedropperTool extends Tool {
  id = 'eyedropper'; name = 'Eyedropper';
  cursor = 'crosshair';
  private down = false;
  private hoverPt: Vec | null = null;
  private color: string | null = null;
  private pageId = '';
  private pick(e: ToolPointer) {
    if (!e.page) return;
    this.pageId = e.page.id;
    const c = sampleColor(this.ed, e.page.id, e.local.x, e.local.y, this.ed.opts.sampleSize, this.ed.opts.sampleLayerOnly);
    this.color = c;
    if (c) { if (e.alt) this.ed.setBg(c); else this.ed.setFg(c); }
    this.hoverPt = e.local;
    this.ed.requestOverlay();
  }
  pointerDown(e: ToolPointer) { this.down = true; this.pick(e); }
  pointerMove(e: ToolPointer) { if (this.down) this.pick(e); }
  pointerUp() { this.down = false; if (this.color) this.ed.pushRecentColor(this.color); this.hoverPt = null; this.ed.requestOverlay(); }
  drawOverlay(o: OverlayCtx) {
    if (!this.down || !this.hoverPt || !o.page || !this.color) return;
    const c = o.localToScreen(o.page, this.hoverPt);
    const { ctx } = o;
    ctx.save();
    ctx.lineWidth = 14; ctx.strokeStyle = this.color; ctx.beginPath(); ctx.arc(c.x, c.y, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(c.x, c.y, 41, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(c.x, c.y, 27, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

export class BucketTool extends Tool {
  id = 'bucket'; name = 'Paint Bucket';
  cursor = 'crosshair';
  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const o = ed.opts;
    let layer = ed.layer;
    if (!layer || layer.type !== 'raster') { layer = ed.ensureRasterTarget(); }
    if (!layer || layer.type !== 'raster') return;
    if (layer.locked) { ed.setStatus('This layer is locked'); return; }
    const pg = ed.page, w = pg.width, h = pg.height;
    const merged = o.fillSampleMerged;
    const srcCanvas = merged ? renderPageToCanvas(ed.doc, pg, 1) : (layer as RasterLayer).surface.peek();
    const data = srcCanvas ? ctx2d(srcCanvas, true).getImageData(0, 0, w, h).data : new Uint8ClampedArray(w * h * 4);
    const sel = ed.selection;
    let mask = floodMask(data, w, h, e.local.x, e.local.y, { tolerance: o.fillTolerance, contiguous: o.fillContiguous, limit: sel.mask });
    if (o.fillExpand > 0) mask = morphMask(mask, w, h, o.fillExpand, true);
    // restrict to selection (soft)
    if (sel.mask) for (let i = 0; i < mask.length; i++) mask[i] = (mask[i] * sel.mask[i]) / 255;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return;
    const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const color = e.alt ? ed.bg : ed.fg;
    const lyr = layer as RasterLayer;
    ed.mutateRaster('Paint bucket', lyr.id, 'layer', rect, (s) => {
      const tmp = createCanvas(rect.w, rect.h), t = ctx2d(tmp);
      const id = t.createImageData(rect.w, rect.h);
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) id.data[(y * rect.w + x) * 4 + 3] = mask[(rect.y + y) * w + rect.x + x];
      t.putImageData(id, 0, 0);
      t.globalCompositeOperation = 'source-in';
      if (o.fillMode === 'pattern') { const p = getPattern(o.fillPattern, color, t); t.fillStyle = p ?? color; } else t.fillStyle = color;
      t.fillRect(0, 0, rect.w, rect.h);
      if (lyr.alphaLock) { t.globalCompositeOperation = 'destination-in'; t.drawImage(s.canvas, -rect.x, -rect.y); }
      s.ctx.drawImage(tmp, rect.x, rect.y);
    });
  }
}

export class GradientTool extends Tool {
  id = 'gradient'; name = 'Gradient';
  cursor = 'crosshair';
  private a: Vec | null = null;
  private b: Vec | null = null;
  private layer: RasterLayer | null = null;
  private preview: HTMLCanvasElement | null = null;
  private pageId = '';

  private stops() {
    const o = this.ed.opts;
    const s = o.gradientUseFgBg ? [{ pos: 0, color: this.ed.fg }, { pos: 1, color: this.ed.bg }] : o.gradientStops;
    return o.gradientReverse ? s.map((x) => ({ pos: 1 - x.pos, color: x.color })) : s;
  }

  /** renders the gradient into a page-sized canvas */
  renderGradient(w: number, h: number, a: Vec, b: Vec): HTMLCanvasElement {
    const kind = this.ed.opts.gradientKind;
    const c = createCanvas(w, h), ctx = ctx2d(c);
    const stops = this.stops();
    const len = Math.max(1e-3, Math.hypot(b.x - a.x, b.y - a.y));
    const addStops = (g: CanvasGradient, mirror = false) => {
      const sorted = [...stops].sort((p, q) => p.pos - q.pos);
      for (const s of sorted) g.addColorStop(Math.min(1, Math.max(0, mirror ? 0.5 + s.pos / 2 : s.pos)), rgbaToCss(parseColor(s.color)));
      if (mirror) for (const s of sorted) g.addColorStop(Math.min(1, Math.max(0, 0.5 - s.pos / 2)), rgbaToCss(parseColor(s.color)));
    };
    if (kind === 'linear') { const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y); addStops(g); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    else if (kind === 'radial') { const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, len); addStops(g); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    else if (kind === 'reflected') {
      const dx = (b.x - a.x), dy = (b.y - a.y);
      const g = ctx.createLinearGradient(a.x - dx, a.y - dy, a.x + dx, a.y + dy);
      const sorted = [...stops].sort((p, q) => p.pos - q.pos);
      for (const s of sorted) { g.addColorStop(0.5 + (1 - s.pos) / 2 * 1, rgbaToCss(parseColor(s.color))); g.addColorStop(0.5 - (1 - s.pos) / 2 * 1, rgbaToCss(parseColor(s.color))); }
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else if (kind === 'angle') {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (typeof (ctx as any).createConicGradient === 'function') {
        const g = (ctx as any).createConicGradient(ang, a.x, a.y) as CanvasGradient; addStops(g); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    } else if (kind === 'diamond') {
      const lut = buildGradientLUT(stops), id = ctx.createImageData(w, h), d = id.data;
      const ang = Math.atan2(b.y - a.y, b.x - a.x), ca = Math.cos(-ang), sa = Math.sin(-ang);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - a.x, dy = y - a.y, rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
        const t = Math.min(1, (Math.abs(rx) + Math.abs(ry)) / len), k = Math.round(t * 255) * 4, i = (y * w + x) * 4;
        d[i] = lut[k]; d[i + 1] = lut[k + 1]; d[i + 2] = lut[k + 2]; d[i + 3] = lut[k + 3];
      }
      ctx.putImageData(id, 0, 0);
    }
    return c;
  }

  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    let l = ed.layer;
    if (!l || l.type !== 'raster') l = ed.ensureRasterTarget();
    if (!l || l.type !== 'raster' || l.locked) return;
    this.layer = l; this.a = e.local; this.b = e.local; this.pageId = ed.page.id;
    this.preview = createCanvas(ed.page.width, ed.page.height);
  }
  private updatePreview() {
    if (!this.layer || !this.a || !this.b || !this.preview) return;
    const ed = this.ed, pg = ed.page;
    const g = this.renderGradient(pg.width, pg.height, this.a, this.b);
    const gctx = ctx2d(g);
    const sel = ed.selection;
    if (!sel.isEmpty) { gctx.globalCompositeOperation = 'destination-in'; gctx.drawImage(sel.maskCanvas()!, 0, 0); }
    if (this.layer.alphaLock && this.layer.surface.peek()) { gctx.globalCompositeOperation = 'destination-in'; gctx.drawImage(this.layer.surface.canvas, 0, 0); }
    const pc = ctx2d(this.preview);
    pc.clearRect(0, 0, pg.width, pg.height);
    if (this.layer.surface.peek()) pc.drawImage(this.layer.surface.canvas, 0, 0);
    pc.drawImage(g, 0, 0);
    const ov: LayerOverlay = { layerId: this.layer.id, target: 'layer', canvas: this.preview };
    ed.overlays = [ov];
    ed.requestRender();
  }
  pointerMove(e: ToolPointer) {
    if (!this.a) return;
    let b = e.local;
    if (e.shift) { const dx = b.x - this.a.x, dy = b.y - this.a.y, ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(dx, dy); b = { x: this.a.x + Math.cos(ang) * d, y: this.a.y + Math.sin(ang) * d }; }
    this.b = b;
    this.updatePreview();
    this.ed.requestOverlay();
  }
  pointerUp() {
    const ed = this.ed;
    if (!this.a || !this.b || !this.layer) return;
    const moved = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y) > 2;
    if (moved && this.preview) {
      const pg = ed.page, l = this.layer, prev = this.preview;
      const rect = ed.selection.bounds ?? { x: 0, y: 0, w: pg.width, h: pg.height };
      ed.overlays = [];
      ed.mutateRaster('Gradient', l.id, 'layer', rect, (s) => { s.ctx.clearRect(rect.x, rect.y, rect.w, rect.h); s.ctx.drawImage(prev, rect.x, rect.y, rect.w, rect.h, rect.x, rect.y, rect.w, rect.h); });
    } else ed.overlays = [];
    this.a = this.b = null; this.preview = null; this.layer = null;
    ed.requestRender(); ed.requestOverlay();
  }
  cancel() { this.a = this.b = null; this.preview = null; this.ed.overlays = []; this.ed.requestRender(); }
  drawOverlay(o: OverlayCtx) {
    if (!this.a || !this.b || !o.page || o.page.id !== this.pageId) return;
    const a = o.localToScreen(o.page, this.a), b = o.localToScreen(o.page, this.b), { ctx } = o;
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#000'; ctx.stroke();
    for (const p of [a, b]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
}
void sampleGradient;
