// Draws the document into the on-screen canvases: pages (via the shared renderer) + interactive overlay.

import type { Editor } from '../../editor/editor';
import type { Layer, Page } from '../../core/model';
import { renderPage } from '../../core/render';
import { hasActiveEffects } from '../../core/effects';
import { acquire, release } from '../../core/canvaspool';
import { mMul, mTranslate, mInvert, mApply, transformRectBounds, rectIntersect, rectUnion, Mat, Rect, Vec } from '../../core/geometry';
import { createCanvas, ctx2d } from '../../core/util';
import { prefs } from '../../app/store';
import type { OverlayCtx } from '../../tools/tool';

let checker: HTMLCanvasElement | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D, dark: boolean): CanvasPattern {
  if (!checker) {
    checker = createCanvas(32, 32);
    const c = ctx2d(checker);
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 32, 32);
    c.fillStyle = '#cfd3d8'; c.fillRect(0, 0, 16, 16); c.fillRect(16, 16, 16, 16);
  }
  void dark;
  return ctx.createPattern(checker, 'repeat')!;
}

/** layer effects (shadows, glows…) reach beyond the pixels that changed, so a partial repaint cannot be trusted with them */
function hasEffects(layers: Layer[]): boolean {
  for (const l of layers) {
    if (!l.visible) continue;
    if (hasActiveEffects(l.effects)) return true;
    if (l.type === 'group' && hasEffects(l.children)) return true;
  }
  return false;
}
const TILE = 64;

export class ViewRenderer {
  bgColor = '#2b2e33';
  private raf = 0;
  private overlayRaf = 0;
  /** the whole view must be repainted next frame (otherwise only `dirty`) */
  private full = true;
  private dirty: { page: Page; rect: Rect } | null = null;
  private ctx: CanvasRenderingContext2D;
  /**
   * While a stroke is painted onto one layer the layers below it do not change, so after a few frames their composite is
   * rendered once into this canvas (device pixels, covering the visible part of the page) and each frame only draws it,
   * the stroke and the layers above — instead of every layer again.
   */
  private cache: { key: string; canvas: HTMLCanvasElement; vis: Rect; count: number } | null = null;
  private partialFrames = 0;
  constructor(public ed: Editor, public canvas: HTMLCanvasElement, public overlay: HTMLCanvasElement) {
    // the board is always painted opaque: without an alpha channel the browser can skip blending it with the page behind
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  readTheme() {
    const v = getComputedStyle(this.canvas).getPropertyValue('--canvas-bg').trim();
    if (v) this.bgColor = v;
  }

  /** repaint everything on the next frame */
  schedule() { this.full = true; this.queue(); }
  /** repaint only `rect` (page-local coordinates) of `page` on the next frame — what a brush stroke needs */
  scheduleRect(page: Page, rect: Rect) {
    if (!this.full) {
      if (this.dirty && this.dirty.page !== page) this.full = true;
      else this.dirty = { page, rect: this.dirty ? rectUnion(this.dirty.rect, rect)! : rect };
    }
    this.queue();
  }
  private queue() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const d = this.dirty, full = this.full || !d;
      this.dirty = null; this.full = false;
      if (full || !this.renderRect(d!.page, d!.rect)) this.render();
      this.renderOverlay();
    });
  }
  scheduleOverlay() {
    if (this.overlayRaf || this.raf) return;
    this.overlayRaf = requestAnimationFrame(() => { this.overlayRaf = 0; this.renderOverlay(); });
  }

  private dropCache() {
    if (this.cache) { this.cache.canvas.width = this.cache.canvas.height = 1; this.cache = null; }
    this.partialFrames = 0;
  }

  resize(w: number, h: number, dpr: number) {
    this.dropCache();
    for (const c of [this.canvas, this.overlay]) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); }
    this.ed.view.resize(w, h, dpr);
    this.readTheme();
    this.schedule();
  }

  // ------------------------------------------------------------ pages
  render() {
    this.dropCache();
    const ed = this.ed, view = ed.view, doc = ed.doc;
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, W, H);
    for (const { page } of view.visiblePages(doc)) {
      const M = view.pageDeviceMatrix(page);
      const bounds = transformRectBounds(M, { x: 0, y: 0, w: page.width, h: page.height });
      const vis = rectIntersect({ x: Math.floor(bounds.x), y: Math.floor(bounds.y), w: Math.ceil(bounds.w) + 1, h: Math.ceil(bounds.h) + 1 }, { x: 0, y: 0, w: W, h: H });
      if (!vis) continue;
      this.paintPage(page, M, vis, false);
    }
  }

  /**
   * Repaint just `rect` (page-local) of `page`. Returns false when that is not safe and the caller must repaint everything:
   * layer effects reach beyond the changed pixels, and another page lying over the region would have to be redrawn too.
   */
  private renderRect(page: Page, rect: Rect): boolean {
    const ed = this.ed, view = ed.view, doc = ed.doc;
    const visible = view.visiblePages(doc);
    if (!visible.some((v) => v.page === page)) return true; // scrolled out of view: nothing to paint
    if (hasEffects(page.layers)) return false;
    const W = this.canvas.width, H = this.canvas.height;
    const M = view.pageDeviceMatrix(page);
    const b = transformRectBounds(M, rect);
    // snap to a coarse grid: the scratch canvases come in a handful of sizes and get reused instead of re-allocated every frame
    const x0 = Math.max(0, Math.floor((b.x - 2) / TILE) * TILE), y0 = Math.max(0, Math.floor((b.y - 2) / TILE) * TILE);
    const x1 = Math.min(W, Math.ceil((b.x + b.w + 2) / TILE) * TILE), y1 = Math.min(H, Math.ceil((b.y + b.h + 2) / TILE) * TILE);
    if (x1 <= x0 || y1 <= y0) return true;
    const vis: Rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    for (const v of visible) {
      if (v.page === page) continue;
      if (rectIntersect(vis, transformRectBounds(view.pageDeviceMatrix(v.page), { x: 0, y: 0, w: v.page.width, h: v.page.height }))) return false;
    }
    this.partialFrames++;
    this.paintPage(page, M, vis, true);
    return true;
  }

  /** the cached composite of the layers under the layer being painted, if there is one worth having (built after a few frames) */
  private baseFor(page: Page, M: Mat): { key: string; canvas: HTMLCanvasElement; vis: Rect; count: number } | null {
    const ed = this.ed, view = ed.view;
    const idx = page.layers.findIndex((l) => l.id === ed.activeLayerId);
    const l = page.layers[idx];
    // eligible: a top-level pixel layer with a good number of layers below it, painted by a stroke (its live preview is the only overlay)
    if (!l || idx < 5 || l.type !== 'raster' || l.clip || ed.afterLayer || ed.overlays.length !== 1 || ed.overlays[0].layerId !== l.id) return null;
    const W = this.canvas.width, H = this.canvas.height;
    const key = [page.id, idx, M.a, M.b, M.c, M.d, M.e, M.f, ed.versions.doc, ed.versions.layers, ed.versions.view, ed.versions.page, W, H].join('|');
    if (this.cache && this.cache.key === key) return this.cache;
    if (this.partialFrames < 6) return null; // a tap or a short flick is not worth a cache
    if (this.cache) { this.cache.canvas.width = this.cache.canvas.height = 1; this.cache = null; }
    const b = transformRectBounds(M, { x: 0, y: 0, w: page.width, h: page.height });
    const vis = rectIntersect({ x: Math.floor(b.x), y: Math.floor(b.y), w: Math.ceil(b.w) + 1, h: Math.ceil(b.h) + 1 }, { x: 0, y: 0, w: W, h: H });
    if (!vis) return null;
    const canvas = createCanvas(vis.w, vis.h);
    renderPage(ctx2d(canvas), ed.doc, page, {
      matrix: mMul(mTranslate(-vis.x, -vis.y), M), width: vis.w, height: vis.h, scale: view.zoom * view.dpr,
      hiddenObjects: ed.hiddenObjects, hiddenLayers: ed.hiddenLayers, transparentBackground: false, layerRange: [0, idx],
    });
    return (this.cache = { key, canvas, vis, count: idx });
  }

  /** Paint one page into the device rectangle `vis` of the board (everything is clipped to it when `partial`). */
  private paintPage(page: Page, M: Mat, vis: Rect, partial: boolean) {
    const ed = this.ed, view = ed.view, doc = ed.doc;
    const ctx = this.ctx;
    const showChecker = prefs.get().checker;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (partial) {
      ctx.beginPath(); ctx.rect(vis.x, vis.y, vis.w, vis.h); ctx.clip();
      ctx.fillStyle = this.bgColor; ctx.fillRect(vis.x, vis.y, vis.w, vis.h);
    }
    // drop shadow + white paper + transparency checkerboard. The shadow lies outside the page, so a region
    // that is entirely on the paper does not need the (expensive) blurred shadow.
    ctx.save();
    ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
    if (!partial || !this.insidePage(page, M, vis)) {
      ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = 22 * view.dpr; ctx.shadowOffsetY = 5 * view.dpr;
    }
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, page.width, page.height);
    ctx.shadowColor = 'transparent';
    if (!page.background.color && showChecker) {
      const pat = checkerPattern(ctx, false);
      // keep the checker squares a constant ~8 CSS px regardless of zoom (the CTM already scales by zoom·dpr)
      pat.setTransform(new DOMMatrix().scale(0.5 / view.zoom));
      ctx.fillStyle = pat; ctx.fillRect(0, 0, page.width, page.height);
    }
    ctx.restore();
    const PB = acquire(vis.w, vis.h);
    const pctx = PB.getContext('2d')!;
    const local: Mat = mMul(mTranslate(-vis.x, -vis.y), M);
    const base = partial && page.id === ed.activePageId ? this.baseFor(page, M) : null;
    if (base) pctx.drawImage(base.canvas, vis.x - base.vis.x, vis.y - base.vis.y, vis.w, vis.h, 0, 0, vis.w, vis.h);
    renderPage(pctx, doc, page, {
      matrix: local, width: vis.w, height: vis.h, scale: view.zoom * view.dpr,
      skipBackground: !!base, layerRange: base ? [base.count, undefined] : undefined,
      overlays: page.id === ed.activePageId ? ed.overlays : undefined,
      hiddenObjects: ed.hiddenObjects, hiddenLayers: ed.hiddenLayers,
      afterLayer: page.id === ed.activePageId ? ed.afterLayer : undefined,
      transparentBackground: false,
    });
    ctx.drawImage(PB, vis.x, vis.y);
    release(PB);
    ctx.restore();
  }

  /** is the whole device rectangle on the paper (with a margin)? */
  private insidePage(page: Page, M: Mat, r: Rect): boolean {
    const inv = mInvert(M), m = 4;
    for (const c of [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]) {
      const p = mApply(inv, c);
      if (p.x < m || p.y < m || p.x > page.width - m || p.y > page.height - m) return false;
    }
    return true;
  }

  // ------------------------------------------------------------ overlay
  renderOverlay(time = performance.now()) {
    const ed = this.ed, view = ed.view, doc = ed.doc;
    const ctx = this.overlay.getContext('2d')!;
    const dpr = view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px
    const vm = view.matrix();
    const toScreen = (p: Vec): Vec => ({ x: vm.a * p.x + vm.c * p.y + vm.e, y: vm.b * p.x + vm.d * p.y + vm.f });
    const visible = view.visiblePages(doc);

    for (const { page } of visible) {
      const pm = view.pageMatrix(page);
      const ls = (p: Vec): Vec => ({ x: pm.a * p.x + pm.c * p.y + pm.e, y: pm.b * p.x + pm.d * p.y + pm.f });
      if (doc.grid.show && page.id === ed.activePageId) this.drawGrid(ctx, page, ls);
      if (view.zoom >= 8 && page.id === ed.activePageId) this.drawPixelGrid(ctx, page, ls);
      this.drawGuides(ctx, page, ls);
      this.drawSelection(ctx, page, ls, time);
      if (page.id === ed.activePageId) {
        this.drawSymmetry(ctx, page, ls);
        this.drawPerspective(ctx, page, ls);
        // active page outline in multi-page layouts
        if (doc.pages.length > 1) {
          const c = [{ x: 0, y: 0 }, { x: page.width, y: 0 }, { x: page.width, y: page.height }, { x: 0, y: page.height }].map(ls);
          ctx.save(); ctx.strokeStyle = 'rgba(26,188,156,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.restore();
        }
      }
    }
    // tool overlay on the active page (or the page the tool captured)
    const page = ed.page;
    const o: OverlayCtx = {
      ctx, toScreen, zoom: view.zoom, page, time,
      localToScreen: (pg, p) => { const m = view.pageMatrix(pg); return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }; },
      pageMatrix: (pg) => view.pageMatrix(pg),
    };
    ed.tool.drawOverlay(o);
  }

  private drawGrid(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec) {
    const { grid } = this.ed.doc, z = this.ed.view.zoom;
    const step = grid.size, sub = Math.max(1, grid.subdivisions);
    const vis = this.ed.view.visibleWorldRect();
    const r = this.ed.worldRectOf(page);
    const x0 = Math.max(0, Math.floor((vis.x - r.x) / step) * step), x1 = Math.min(page.width, vis.x + vis.w - r.x);
    const y0 = Math.max(0, Math.floor((vis.y - r.y) / step) * step), y1 = Math.min(page.height, vis.y + vis.h - r.y);
    ctx.save();
    const line = (a: Vec, b: Vec) => { const p = ls(a), q = ls(b); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); };
    if (grid.kind === 'isometric') {
      ctx.strokeStyle = 'rgba(120,150,200,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
      const t = Math.tan(Math.PI / 6);
      for (let x = -page.height / t; x < page.width + page.height / t; x += step) { line({ x, y: 0 }, { x: x + page.height / t, y: page.height }); line({ x, y: page.height }, { x: x + page.height / t, y: 0 }); }
      ctx.stroke(); ctx.restore(); return;
    }
    if (sub > 1 && step * z / sub > 6) {
      ctx.strokeStyle = 'rgba(120,150,200,0.18)'; ctx.lineWidth = 1; ctx.beginPath();
      const s = step / sub;
      for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) line({ x, y: Math.max(0, y0) }, { x, y: y1 });
      for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) line({ x: Math.max(0, x0), y }, { x: x1, y });
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(120,150,200,0.42)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = x0; x <= x1; x += step) line({ x, y: Math.max(0, y0) }, { x, y: y1 });
    for (let y = y0; y <= y1; y += step) line({ x: Math.max(0, x0), y }, { x: x1, y });
    ctx.stroke(); ctx.restore();
  }
  private drawPixelGrid(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec) {
    const vis = this.ed.view.visibleWorldRect(), r = this.ed.worldRectOf(page);
    const x0 = Math.max(0, Math.floor(vis.x - r.x)), x1 = Math.min(page.width, Math.ceil(vis.x + vis.w - r.x));
    const y0 = Math.max(0, Math.floor(vis.y - r.y)), y1 = Math.min(page.height, Math.ceil(vis.y + vis.h - r.y));
    if ((x1 - x0) * (y1 - y0) > 400000) return;
    ctx.save(); ctx.strokeStyle = 'rgba(128,128,128,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = x0; x <= x1; x++) { const a = ls({ x, y: y0 }), b = ls({ x, y: y1 }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    for (let y = y0; y <= y1; y++) { const a = ls({ x: x0, y }), b = ls({ x: x1, y }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
    ctx.stroke(); ctx.restore();
  }
  private drawGuides(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec) {
    const temp = page.id === this.ed.activePageId ? this.ed.tempGuide : null;
    if (!page.guides.length && !temp) return;
    ctx.save(); ctx.strokeStyle = '#19b5fe'; ctx.lineWidth = 1; ctx.beginPath();
    const big = 100000;
    const list = temp ? [...page.guides, { id: 'tmp', axis: temp.axis, pos: temp.pos }] : page.guides;
    for (const g of list) {
      const a = g.axis === 'v' ? ls({ x: g.pos, y: -big }) : ls({ x: -big, y: g.pos }), b = g.axis === 'v' ? ls({ x: g.pos, y: big }) : ls({ x: big, y: g.pos });
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke(); ctx.restore();
  }
  private drawSelection(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec, time: number) {
    const sel = this.ed.selectionFor(page);
    if (sel.isEmpty) return;
    const contours = sel.contours();
    ctx.save();
    ctx.lineWidth = 1;
    const path = () => { ctx.beginPath(); for (const c of contours) c.forEach((p, i) => { const s = ls(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); };
    path(); ctx.strokeStyle = '#fff'; ctx.setLineDash([]); ctx.stroke();
    ctx.strokeStyle = '#000'; ctx.setLineDash([5, 5]); ctx.lineDashOffset = -(time / 80) % 10; ctx.stroke();
    ctx.restore();
  }
  private drawSymmetry(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec) {
    const s = this.ed.doc.symmetry;
    if (!s.enabled) return;
    const cx = page.width / 2 + s.cx, cy = page.height / 2 + s.cy;
    ctx.save(); ctx.strokeStyle = 'rgba(255,120,60,0.85)'; ctx.lineWidth = 1.2; ctx.setLineDash([8, 6]);
    const line = (a: Vec, b: Vec) => { const p = ls(a), q = ls(b); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); };
    const big = Math.max(page.width, page.height);
    if (s.mode === 'vertical' || s.mode === 'both') line({ x: cx, y: -big }, { x: cx, y: big * 2 });
    if (s.mode === 'horizontal' || s.mode === 'both') line({ x: -big, y: cy }, { x: big * 2, y: cy });
    if (s.mode === 'radial') for (let i = 0; i < s.axes; i++) { const a = (i * Math.PI) / s.axes; line({ x: cx - Math.cos(a) * big, y: cy - Math.sin(a) * big }, { x: cx + Math.cos(a) * big, y: cy + Math.sin(a) * big }); }
    ctx.restore();
  }
  private drawPerspective(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec) {
    const p = this.ed.doc.perspective;
    if (!p.enabled || !p.points.length) return;
    ctx.save(); ctx.strokeStyle = 'rgba(90,170,255,0.45)'; ctx.lineWidth = 1;
    const big = Math.max(page.width, page.height) * 2;
    for (const vp of p.points) {
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const A = ls(vp), B = ls({ x: vp.x + Math.cos(a) * big, y: vp.y + Math.sin(a) * big });
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      }
      const c = ls(vp); ctx.fillStyle = '#5aaaff'; ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
