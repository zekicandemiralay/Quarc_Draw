// Page renderer: background → layer stack (blend modes, masks, clipping groups, adjustment layers, effects).
// The same code path serves the interactive viewport and every exporter.

import type { Mat, Rect } from './geometry';
import { setCtxMat } from './geometry';
import type { Layer, Page, QDocument, RasterLayer, VectorLayer, AdjustmentLayer, GroupLayer } from './model';
import { blendToComposite } from './model';
import { drawObject } from './vector';
import { acquire, release } from './canvaspool';
import { composeWithEffects, hasActiveEffects } from './effects';
import { applyAdjustment } from '../filters/pixels';
import { getImageSync } from './assets';
import { cssColor } from './vector';

/** Live preview that replaces a layer's (or mask's) pixels while a stroke / filter / transform is in progress */
export interface LayerOverlay {
  layerId: string;
  target: 'layer' | 'mask';
  canvas: HTMLCanvasElement; // same size as the page; replaces the surface during render
}

export interface RenderOpts {
  /** page space → device space of the target context */
  matrix: Mat;
  width: number;
  height: number;
  /** device px per page unit */
  scale: number;
  skipBackground?: boolean;
  transparentBackground?: boolean;
  overlays?: LayerOverlay[];
  hiddenObjects?: Set<string>;
  hiddenLayers?: Set<string>;
  /** only draw this layer (solo / per-layer export) */
  onlyLayer?: string;
  /** draw only `page.layers.slice(from, to)` — lets the viewport render the layers under a brush stroke once and cache them */
  layerRange?: [number, number | undefined];
  /** extra drawing after a given layer (used by tools to preview floating content) */
  afterLayer?: { layerId: string; draw: (ctx: CanvasRenderingContext2D) => void };
}

let rendersInFlight = 0;

export function renderPage(ctx: CanvasRenderingContext2D, doc: QDocument, page: Page, o: RenderOpts) {
  rendersInFlight++;
  try {
    ctx.save();
    setCtxMat(ctx, o.matrix);
    ctx.beginPath(); ctx.rect(0, 0, page.width, page.height); ctx.clip();
    ctx.imageSmoothingEnabled = o.scale < 3;
    ctx.imageSmoothingQuality = 'high';
    if (!o.skipBackground) drawBackground(ctx, doc, page, o);
    // the page clip stays active for the layers (device-space clip survives setTransform)
    renderLayerList(ctx, doc, page, o.layerRange ? page.layers.slice(o.layerRange[0], o.layerRange[1]) : page.layers, o);
    ctx.restore();
  } finally { rendersInFlight--; }
}

function drawBackground(ctx: CanvasRenderingContext2D, doc: QDocument, page: Page, o: RenderOpts) {
  const bg = page.background;
  const w = page.width, h = page.height;
  const area = { x: 0, y: 0, w, h };
  if (bg.color && !o.transparentBackground) { ctx.fillStyle = cssColor(bg.color); ctx.fillRect(area.x, area.y, area.w, area.h); }
  if (bg.image) {
    const img = getImageSync(bg.image.assetId);
    if (img) {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const s = bg.image.fit === 'stretch' ? null : bg.image.fit === 'cover' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      if (s === null) ctx.drawImage(img, 0, 0, w, h); else ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    }
  }
}

function renderLayerList(ctx: CanvasRenderingContext2D, doc: QDocument, page: Page, layers: Layer[], o: RenderOpts) {
  for (let i = 0; i < layers.length; i++) {
    const base = layers[i];
    if (base.clip && i > 0) continue;
    const clipped: Layer[] = [];
    let j = i + 1;
    while (j < layers.length && layers[j].clip) { clipped.push(layers[j]); j++; }
    i = j - 1;
    if (o.hiddenLayers?.has(base.id)) continue;
    if (o.onlyLayer && !containsLayer(base, o.onlyLayer) && !clipped.some((c) => containsLayer(c, o.onlyLayer!))) continue;
    renderLayerWithClips(ctx, doc, page, base, clipped.filter((c) => c.visible && !o.hiddenLayers?.has(c.id)), o);
    if (o.afterLayer && o.afterLayer.layerId === base.id) {
      ctx.save(); setCtxMat(ctx, o.matrix); o.afterLayer.draw(ctx); ctx.restore();
    }
  }
}
function containsLayer(l: Layer, id: string): boolean {
  if (l.id === id) return true;
  return l.type === 'group' && l.children.some((c) => containsLayer(c, id));
}

function deviceBounds(o: RenderOpts): Rect { return { x: 0, y: 0, w: o.width, h: o.height }; }

function renderLayerWithClips(ctx: CanvasRenderingContext2D, doc: QDocument, page: Page, base: Layer, clipped: Layer[], o: RenderOpts) {
  if (!base.visible) return;
  const solo = !!o.onlyLayer;
  void solo;

  if (base.type === 'adjustment' && !clipped.length) { applyAdjustmentLayer(ctx, page, base, o); return; }

  const simple =
    !clipped.length && !hasActiveEffects(base.effects) && !(base.mask && base.maskEnabled) &&
    (base.type === 'raster' || base.type === 'vector' || (base.type === 'group' && base.passThrough && base.opacity >= 1 && base.blend === 'normal'));
  if (simple) {
    if (base.type === 'group') { renderLayerList(ctx, doc, page, base.children, o); return; }
    ctx.save();
    ctx.globalAlpha = base.opacity;
    ctx.globalCompositeOperation = blendToComposite(base.blend);
    drawLayerContent(ctx, doc, page, base, o);
    ctx.restore();
    return;
  }

  // ---- isolated path ----
  const T = acquire(o.width, o.height);
  const tctx = T.getContext('2d')!;
  tctx.imageSmoothingEnabled = o.scale < 3; tctx.imageSmoothingQuality = 'high';
  drawLayerContent(tctx, doc, page, base, o, true);
  applyLayerMask(tctx, page, base, o);

  if (clipped.length) {
    const baseCopy = acquire(o.width, o.height);
    baseCopy.getContext('2d')!.drawImage(T, 0, 0);
    for (const c of clipped) {
      if (c.type === 'adjustment') { applyAdjustmentToCanvas(tctx, c, o, null); continue; }
      const C = acquire(o.width, o.height);
      const cctx = C.getContext('2d')!;
      cctx.imageSmoothingEnabled = o.scale < 3;
      drawLayerContent(cctx, doc, page, c, o, true);
      applyLayerMask(cctx, page, c, o);
      cctx.globalCompositeOperation = 'destination-in';
      cctx.drawImage(baseCopy, 0, 0);
      tctx.save();
      tctx.globalAlpha = c.opacity;
      tctx.globalCompositeOperation = blendToComposite(c.blend);
      tctx.drawImage(C, 0, 0);
      tctx.restore();
      release(C);
    }
    release(baseCopy);
  }

  let out = T;
  let E: HTMLCanvasElement | null = null;
  if (hasActiveEffects(base.effects)) {
    E = acquire(o.width, o.height);
    composeWithEffects(E.getContext('2d')!, T, base.effects, o.scale);
    out = E;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = base.opacity;
  ctx.globalCompositeOperation = blendToComposite(base.blend);
  ctx.drawImage(out, 0, 0);
  ctx.restore();
  release(T);
  if (E) release(E);
}

/** draw raw content of a layer in page space onto ctx (ctx may be device-space isolated temp) */
function drawLayerContent(ctx: CanvasRenderingContext2D, doc: QDocument, page: Page, layer: Layer, o: RenderOpts, isolated = false) {
  switch (layer.type) {
    case 'raster': {
      const ov = o.overlays?.find((x) => x.layerId === layer.id && x.target === 'layer');
      const src = ov ? ov.canvas : layer.surface.peek();
      if (!src) return;
      ctx.save(); setCtxMat(ctx, o.matrix);
      ctx.imageSmoothingEnabled = o.scale < 3; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0);
      ctx.restore();
      break;
    }
    case 'vector': {
      ctx.save(); setCtxMat(ctx, o.matrix);
      for (const obj of layer.objects) {
        if (o.hiddenObjects?.has(obj.id)) continue;
        drawObject(ctx, obj, { scale: o.scale });
      }
      ctx.restore();
      break;
    }
    case 'group': {
      if (isolated) renderLayerList(ctx, doc, page, layer.children, o);
      else renderLayerList(ctx, doc, page, layer.children, o);
      break;
    }
    case 'adjustment': break;
  }
}

function applyLayerMask(ctx: CanvasRenderingContext2D, page: Page, layer: Layer, o: RenderOpts) {
  if (!layer.mask || !layer.maskEnabled) return;
  const ov = o.overlays?.find((x) => x.layerId === layer.id && x.target === 'mask');
  const m = ov ? ov.canvas : layer.mask.peek();
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  if (!m) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect(0, 0, o.width, o.height); ctx.restore(); return; } // empty mask = fully hidden
  setCtxMat(ctx, o.matrix);
  ctx.imageSmoothingEnabled = o.scale < 3;
  ctx.drawImage(m, 0, 0);
  ctx.restore();
}

// ---------------- adjustment layers ----------------
function applyAdjustmentLayer(ctx: CanvasRenderingContext2D, page: Page, layer: AdjustmentLayer, o: RenderOpts) {
  applyAdjustmentToCanvas(ctx, layer, o, page);
}

/** Adjusts the pixels of ctx's canvas in place, weighted by layer opacity and mask. */
function applyAdjustmentToCanvas(ctx: CanvasRenderingContext2D, layer: AdjustmentLayer, o: RenderOpts, page: Page | null) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  if (w === 0 || h === 0) return;
  const src = ctx.getImageData(0, 0, w, h);
  const adj = { data: new Uint8ClampedArray(src.data), width: w, height: h };
  applyAdjustment(adj, layer.adj);
  const weight = layer.opacity;
  let maskAlpha: Uint8ClampedArray | null = null;
  if (layer.mask && layer.maskEnabled && page) {
    const M = acquire(w, h);
    const mctx = M.getContext('2d')!;
    const ov = o.overlays?.find((x) => x.layerId === layer.id && x.target === 'mask');
    const mc = ov ? ov.canvas : layer.mask.peek();
    if (mc) { setCtxMat(mctx, o.matrix); mctx.drawImage(mc, 0, 0); }
    maskAlpha = mctx.getImageData(0, 0, w, h).data;
    release(M);
  }
  const s = src.data, a = adj.data;
  if (weight >= 1 && !maskAlpha) {
    for (let i = 0; i < s.length; i += 4) { s[i] = a[i]; s[i + 1] = a[i + 1]; s[i + 2] = a[i + 2]; }
  } else {
    for (let i = 0; i < s.length; i += 4) {
      const k = weight * (maskAlpha ? maskAlpha[i + 3] / 255 : 1);
      s[i] += (a[i] - s[i]) * k; s[i + 1] += (a[i + 1] - s[i + 1]) * k; s[i + 2] += (a[i + 2] - s[i + 2]) * k;
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  ctx.putImageData(src, 0, 0);
  ctx.restore();
}

// ---------------- convenience: render whole page to a new canvas ----------------
export function renderPageToCanvas(
  doc: QDocument, page: Page, scale = 1,
  opts: Partial<Pick<RenderOpts, 'skipBackground' | 'transparentBackground' | 'onlyLayer' | 'hiddenLayers'>> & { region?: Rect } = {},
): HTMLCanvasElement {
  const region = opts.region ?? { x: 0, y: 0, w: page.width, h: page.height };
  const W = Math.max(1, Math.round(region.w * scale)), H = Math.max(1, Math.round(region.h * scale));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  renderPage(ctx, doc, page, {
    matrix: { a: scale, b: 0, c: 0, d: scale, e: -region.x * scale, f: -region.y * scale },
    width: W, height: H, scale, skipBackground: opts.skipBackground, transparentBackground: opts.transparentBackground,
    onlyLayer: opts.onlyLayer, hiddenLayers: opts.hiddenLayers,
  });
  return c;
}

/** merge-visible composite of the page's layers only (no page background) at doc resolution */
export function renderLayersOnly(doc: QDocument, page: Page, layers?: Layer[]): HTMLCanvasElement {
  const tmp: Page = { ...page, layers: layers ?? page.layers };
  return renderPageToCanvas(doc, tmp, 1, { skipBackground: true });
}
export type { RasterLayer, VectorLayer, GroupLayer };
export const isRendering = () => rendersInFlight > 0;
