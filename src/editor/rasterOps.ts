// Raster operations: filters, adjustments, fills, strokes, clipboard, image placement.

import type { Editor } from './editor';
import type { RasterLayer, Adjustment, VObject, VImage } from '../core/model';
import { createRasterLayer, findLayer, baseObject, solid } from '../core/model';
import type { Rect } from '../core/geometry';
import { rectCenter } from '../core/geometry';
import { applyAdjustment, Pix, toImageData } from '../filters/pixels';
import { FilterDef, ParamValue, scaleParams } from '../filters/registry';
import { createCanvas, ctx2d, blobToCanvas, canvasToBlob, uid } from '../core/util';
import { registerAssetBlob } from '../core/assets';
import { addObject } from './objectOps';
import { parseColor, rgbaToCss } from '../core/color';
import { getPattern } from '../core/patterns';
import { createRasterLayer as mkRaster } from '../core/model';

export interface Region { rect: Rect }

function activeRaster(ed: Editor): RasterLayer | null {
  let l = ed.layer;
  // no pixel layer yet → create one so fills / pixel ops just work
  if (!l && !ed.activeLayerId) l = ed.ensureRasterTarget();
  if (!l || l.type !== 'raster') { ed.setStatus('Select a pixel layer first (vector layers: Layer ▸ Rasterize)'); return null; }
  if (l.locked) { ed.setStatus('Layer is locked'); return null; }
  return l;
}
function regionFor(ed: Editor, l: RasterLayer): Rect {
  const b = ed.selection.bounds;
  return b ?? { x: 0, y: 0, w: l.surface.width, h: l.surface.height };
}

/** run a pixel function on the active layer (respecting selection + alpha lock) with undo */
export function applyPixelOp(ed: Editor, label: string, fn: (p: Pix) => Pix): boolean {
  const l = activeRaster(ed);
  if (!l) return false;
  const r = regionFor(ed, l);
  const target = ed.editingMask ? 'mask' : 'layer';
  const surf = target === 'mask' ? l.mask! : l.surface;
  if (!surf) return false;
  const rr = { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), w: 0, h: 0 };
  rr.w = Math.min(surf.width, Math.ceil(r.x + r.w)) - rr.x; rr.h = Math.min(surf.height, Math.ceil(r.y + r.h)) - rr.y;
  if (rr.w <= 0 || rr.h <= 0) return false;
  ed.mutateRaster(label, l.id, target, rr, (s) => {
    const src = s.getPatch(rr);
    const orig = new Uint8ClampedArray(src.data);
    const out = fn({ data: src.data, width: rr.w, height: rr.h });
    const d = out.data;
    const sel = ed.selection;
    if (!sel.isEmpty && sel.mask) {
      for (let y = 0; y < rr.h; y++) for (let x = 0; x < rr.w; x++) {
        const m = sel.mask[(rr.y + y) * sel.w + rr.x + x] / 255, i = (y * rr.w + x) * 4;
        if (m < 1) for (let c = 0; c < 4; c++) d[i + c] = orig[i + c] + (d[i + c] - orig[i + c]) * m;
      }
    }
    if (l.alphaLock && target === 'layer') for (let i = 0; i < d.length; i += 4) d[i + 3] = orig[i + 3];
    s.ctx.putImageData(toImageData({ data: d, width: rr.w, height: rr.h }), rr.x, rr.y);
  });
  return true;
}
export const applyAdjustmentDestructive = (ed: Editor, adj: Adjustment, label: string) => applyPixelOp(ed, label, (p) => applyAdjustment(p, adj));
export const applyFilter = (ed: Editor, f: FilterDef, values: Record<string, ParamValue>) => applyPixelOp(ed, f.label.replace('…', ''), (p) => f.apply(p, values));

/** Live preview for filter / adjustment dialogs. Works on a downscaled copy of the affected region. */
export class PixelPreview {
  private canvas: HTMLCanvasElement | null = null;
  private layerId: string;
  private rect: Rect;
  private small: HTMLCanvasElement;
  private scale: number;
  constructor(private ed: Editor, private fn: (p: Pix, scale: number) => Pix) {
    const l = activeRaster(ed)!;
    this.layerId = l.id;
    this.rect = regionFor(ed, l);
    const max = 720;
    this.scale = Math.min(1, max / Math.max(this.rect.w, this.rect.h));
    this.small = createCanvas(Math.max(1, Math.round(this.rect.w * this.scale)), Math.max(1, Math.round(this.rect.h * this.scale)));
    if (l.surface.peek()) ctx2d(this.small).drawImage(l.surface.canvas, this.rect.x, this.rect.y, this.rect.w, this.rect.h, 0, 0, this.small.width, this.small.height);
  }
  update() {
    const l = findLayer(this.ed.page.layers, this.layerId)?.layer;
    if (!l || l.type !== 'raster') return;
    const sctx = ctx2d(this.small, true);
    const id = sctx.getImageData(0, 0, this.small.width, this.small.height);
    const out = this.fn({ data: new Uint8ClampedArray(id.data), width: id.width, height: id.height }, this.scale);
    const tmp = createCanvas(this.small.width, this.small.height);
    ctx2d(tmp).putImageData(toImageData(out), 0, 0);
    if (!this.canvas) this.canvas = createCanvas(l.surface.width, l.surface.height);
    const c = ctx2d(this.canvas);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (l.surface.peek()) c.drawImage(l.surface.canvas, 0, 0);
    c.clearRect(this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    c.imageSmoothingQuality = 'high';
    c.drawImage(tmp, 0, 0, tmp.width, tmp.height, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
    const target = this.ed.editingMask ? 'mask' : 'layer';
    this.ed.overlays = [{ layerId: this.layerId, target, canvas: this.canvas }];
    this.ed.requestRender();
  }
  close() { this.ed.overlays = []; this.ed.requestRender(); }
}
export function makeFilterPreview(ed: Editor, f: FilterDef, getValues: () => Record<string, ParamValue>) {
  return new PixelPreview(ed, (p, scale) => f.apply(p, scaleParams(f, getValues(), scale)));
}
export function makeAdjustmentPreview(ed: Editor, getAdj: () => Adjustment) {
  return new PixelPreview(ed, (p) => applyAdjustment(p, getAdj()));
}

// ---------- fill / stroke ----------
export function fillSelection(ed: Editor, color: string, mode: 'color' | 'pattern' = 'color', pattern = 'hatch') {
  const l = activeRaster(ed);
  if (!l) return;
  const r = regionFor(ed, l);
  ed.mutateRaster('Fill', l.id, ed.editingMask ? 'mask' : 'layer', r, (s) => {
    const tmp = createCanvas(s.width, s.height), t = ctx2d(tmp);
    if (mode === 'pattern') { const p = getPattern(pattern, color, t); t.fillStyle = p ?? color; } else t.fillStyle = color;
    t.fillRect(r.x, r.y, r.w, r.h);
    if (!ed.selection.isEmpty) { t.globalCompositeOperation = 'destination-in'; t.drawImage(ed.selection.maskCanvas()!, 0, 0); }
    if (l.alphaLock) { t.globalCompositeOperation = 'destination-in'; t.drawImage(s.canvas, 0, 0); }
    s.ctx.drawImage(tmp, 0, 0);
  });
}
export function strokeSelection(ed: Editor, color: string, width: number, position: 'inside' | 'center' | 'outside' = 'center') {
  const l = activeRaster(ed);
  const sel = ed.selection;
  if (!l || sel.isEmpty) { ed.setStatus('Make a selection first'); return; }
  const r = { x: sel.bounds!.x - width - 2, y: sel.bounds!.y - width - 2, w: sel.bounds!.w + width * 2 + 4, h: sel.bounds!.h + width * 2 + 4 };
  ed.mutateRaster('Stroke selection', l.id, 'layer', r, (s) => {
    const tmp = createCanvas(s.width, s.height), t = ctx2d(tmp);
    t.strokeStyle = color; t.lineJoin = 'round'; t.lineWidth = position === 'center' ? width : width * 2;
    for (const c of sel.contours()) { t.beginPath(); c.forEach((p, i) => (i ? t.lineTo(p.x, p.y) : t.moveTo(p.x, p.y))); t.closePath(); t.stroke(); }
    const mc = sel.maskCanvas()!;
    if (position === 'inside') { t.globalCompositeOperation = 'destination-in'; t.drawImage(mc, 0, 0); }
    else if (position === 'outside') { t.globalCompositeOperation = 'destination-out'; t.drawImage(mc, 0, 0); }
    s.ctx.drawImage(tmp, 0, 0);
  });
}
export function eraseSelection(ed: Editor) {
  const l = ed.layer;
  if (l && l.type === 'raster') {
    if (ed.selection.isEmpty) { ed.mutateRaster('Clear', l.id, 'layer', { x: 0, y: 0, w: l.surface.width, h: l.surface.height }, (s) => s.clear()); return; }
    const r = ed.selection.bounds!;
    ed.mutateRaster('Delete', l.id, 'layer', r, (s) => { s.ctx.save(); s.ctx.globalCompositeOperation = 'destination-out'; s.ctx.drawImage(ed.selection.maskCanvas()!, 0, 0); s.ctx.restore(); });
  }
}

// ---------- clipboard ----------
export interface ClipPixels { kind: 'pixels'; canvas: HTMLCanvasElement; x: number; y: number }
export interface ClipObjects { kind: 'objects'; objects: VObject[] }
export let clipboard: ClipPixels | ClipObjects | null = null;

export async function copyToClipboard(ed: Editor, cut = false) {
  const l = ed.layer;
  if (ed.objSel.length && l?.type === 'vector') {
    const objs = ed.selectedObjects();
    clipboard = { kind: 'objects', objects: objs };
    if (cut) { const { deleteObjects } = await import('./objectOps'); deleteObjects(ed); }
    ed.setStatus(`Copied ${objs.length} object${objs.length > 1 ? 's' : ''}`);
    return;
  }
  if (!l || l.type !== 'raster') return;
  const sel = ed.selection;
  const r = sel.bounds ?? { x: 0, y: 0, w: l.surface.width, h: l.surface.height };
  const c = createCanvas(r.w, r.h), ctx = ctx2d(c);
  if (l.surface.peek()) ctx.drawImage(l.surface.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  if (!sel.isEmpty) { ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(sel.maskCanvas()!, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); }
  clipboard = { kind: 'pixels', canvas: c, x: r.x, y: r.y };
  try { const blob = await canvasToBlob(c); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); } catch { /* clipboard may be unavailable */ }
  if (cut) eraseSelection(ed);
  ed.setStatus(cut ? 'Cut' : 'Copied');
}
export function pasteInternal(ed: Editor, inPlace = false): boolean {
  const c = clipboard;
  if (!c) return false;
  if (c.kind === 'objects') {
    import('./objectOps').then(({ addObjects }) => {
      import('../core/vector').then(({ cloneObject, translateObject }) => {
        const off = inPlace ? 0 : 24;
        addObjects(ed, c.objects.map((o) => translateObject(cloneObject(o), off, off)), 'Paste');
      });
    });
    return true;
  }
  placeCanvasAsLayer(ed, c.canvas, 'Pasted', inPlace ? { x: c.x, y: c.y } : undefined);
  return true;
}
export function placeCanvasAsLayer(ed: Editor, canvas: HTMLCanvasElement, name: string, at?: { x: number; y: number }) {
  const pg = ed.page;
  const layer = createRasterLayer(name, pg.width, pg.height);
  let x = at?.x, y = at?.y;
  if (x === undefined || y === undefined) {
    const vis = ed.view.visibleWorldRect();
    const wr = ed.worldRectOf(pg);
    const cx = Math.min(Math.max(vis.x + vis.w / 2, wr.x), wr.x + wr.w) - wr.x, cy = Math.min(Math.max(vis.y + vis.h / 2, wr.y), wr.y + wr.h) - wr.y;
    x = Math.round(cx - canvas.width / 2); y = Math.round(cy - canvas.height / 2);
  }
  layer.surface.ctx.drawImage(canvas, x, y);
  ed.transact('Paste', () => {
    const f = ed.layer ? findLayer(pg.layers, ed.layer.id) : null;
    if (f) f.siblings.splice(f.index + 1, 0, layer); else pg.layers.push(layer);
  }, { pages: [pg.id] });
  ed.setActiveLayer(layer.id);
  return layer;
}

/** Place a decoded image: as a vector image object (notes/reader) or a raster layer (studio). Scales down to fit page. */
export async function placeImageBlob(ed: Editor, blob: Blob, name = 'Image', opts: { asObject?: boolean; at?: { x: number; y: number } } = {}) {
  const c = await blobToCanvas(blob);
  const pg = ed.page;
  const fit = Math.min(1, (pg.width * 0.9) / c.width, (pg.height * 0.9) / c.height);
  const w = c.width * fit, h = c.height * fit;
  const vis = ed.view.visibleWorldRect(), wr = ed.worldRectOf(pg);
  const cx = opts.at?.x ?? Math.min(Math.max(vis.x + vis.w / 2, wr.x), wr.x + wr.w) - wr.x;
  const cy = opts.at?.y ?? Math.min(Math.max(vis.y + vis.h / 2, wr.y), wr.y + wr.h) - wr.y;
  if (opts.asObject) {
    const id = uid('as');
    registerAssetBlob(id, blob);
    ed.doc.assets.set(id, { id, name, mime: blob.type || 'image/png', kind: 'image', blob });
    const o: VImage = { ...baseObject(), id: uid('ob'), type: 'image', assetId: id, x: cx - w / 2, y: cy - h / 2, w, h, fill: null };
    addObject(ed, o, 'Place image');
    return;
  }
  const scaled = createCanvas(Math.round(w), Math.round(h));
  const sctx = ctx2d(scaled); sctx.imageSmoothingQuality = 'high'; sctx.drawImage(c, 0, 0, scaled.width, scaled.height);
  placeCanvasAsLayer(ed, scaled, name, { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2) });
  ed.setTool('transform');
}

export function colorAtPage(ed: Editor, x: number, y: number, merged = true): string | null {
  void merged; void rectCenter; void solid; void mkRaster; void parseColor; void rgbaToCss;
  void ed; void x; void y;
  return null;
}
