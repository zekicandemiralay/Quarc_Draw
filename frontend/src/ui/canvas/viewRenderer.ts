// Draws the document into the on-screen canvases: pages (via the shared renderer) + interactive overlay.

import type { Editor } from '../../editor/editor';
import type { Page } from '../../core/model';
import { renderPage } from '../../core/render';
import { acquire, release } from '../../core/canvaspool';
import { mMul, mTranslate, transformRectBounds, rectIntersect, Mat, Vec } from '../../core/geometry';
import { createCanvas, ctx2d } from '../../core/util';
import { prefs } from '../../app/store';
import type { OverlayCtx } from '../../tools/tool';
import { searchState } from '../../pdf/search';

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

export class ViewRenderer {
  bgColor = '#2b2e33';
  private raf = 0;
  private overlayRaf = 0;
  constructor(public ed: Editor, public canvas: HTMLCanvasElement, public overlay: HTMLCanvasElement) {}

  readTheme() {
    const v = getComputedStyle(this.canvas).getPropertyValue('--canvas-bg').trim();
    if (v) this.bgColor = v;
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); this.renderOverlay(); });
  }
  scheduleOverlay() {
    if (this.overlayRaf || this.raf) return;
    this.overlayRaf = requestAnimationFrame(() => { this.overlayRaf = 0; this.renderOverlay(); });
  }

  resize(w: number, h: number, dpr: number) {
    for (const c of [this.canvas, this.overlay]) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); }
    this.ed.view.resize(w, h, dpr);
    this.readTheme();
    this.schedule();
  }

  // ------------------------------------------------------------ pages
  render() {
    const ed = this.ed, view = ed.view, doc = ed.doc;
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.bgColor; ctx.fillRect(0, 0, W, H);
    const showChecker = prefs.get().checker;
    for (const { page } of view.visiblePages(doc)) {
      const M = view.pageDeviceMatrix(page);
      const bounds = page.infinite ? { x: 0, y: 0, w: W, h: H } : transformRectBounds(M, { x: 0, y: 0, w: page.width, h: page.height });
      const vis = rectIntersect({ x: Math.floor(bounds.x), y: Math.floor(bounds.y), w: Math.ceil(bounds.w) + 1, h: Math.ceil(bounds.h) + 1 }, { x: 0, y: 0, w: W, h: H });
      if (!vis) continue;
      // drop shadow + transparency checkerboard
      if (!page.infinite) {
        ctx.save();
        ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f);
        ctx.shadowColor = 'rgba(0,0,0,0.38)'; ctx.shadowBlur = 22 * view.dpr; ctx.shadowOffsetY = 5 * view.dpr;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, page.width, page.height);
        ctx.shadowColor = 'transparent';
        if (!page.background.color && showChecker) {
          const pat = checkerPattern(ctx, false);
          // keep the checker squares a constant ~8 CSS px regardless of zoom (the CTM already scales by zoom·dpr)
          pat.setTransform(new DOMMatrix().scale(0.5 / view.zoom));
          ctx.fillStyle = pat; ctx.fillRect(0, 0, page.width, page.height);
        }
        ctx.restore();
      }
      const PB = acquire(vis.w, vis.h);
      const pctx = PB.getContext('2d')!;
      const local: Mat = mMul(mTranslate(-vis.x, -vis.y), M);
      renderPage(pctx, doc, page, {
        matrix: local, width: vis.w, height: vis.h, scale: view.zoom * view.dpr,
        overlays: page.id === ed.activePageId ? ed.overlays : undefined,
        hiddenObjects: ed.hiddenObjects, hiddenLayers: ed.hiddenLayers,
        afterLayer: page.id === ed.activePageId ? ed.afterLayer : undefined,
        transparentBackground: false,
      });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(PB, vis.x, vis.y);
      ctx.restore();
      release(PB);
    }
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
        if (doc.pages.length > 1 && !page.infinite) {
          const c = [{ x: 0, y: 0 }, { x: page.width, y: 0 }, { x: page.width, y: page.height }, { x: 0, y: page.height }].map(ls);
          ctx.save(); ctx.strokeStyle = 'rgba(26,188,156,0.85)'; ctx.lineWidth = 2; ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.restore();
        }
      }
      this.drawSearchHits(ctx, page, ls);
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
  private drawSearchHits(ctx: CanvasRenderingContext2D, page: Page, ls: (p: Vec) => Vec) {
    const st = searchState.get();
    if (!st.hits.length) return;
    const idx = this.ed.doc.pages.indexOf(page);
    ctx.save();
    st.hits.forEach((h, hi) => {
      if (h.page !== idx) return;
      ctx.fillStyle = hi === st.current ? 'rgba(255,140,0,0.55)' : 'rgba(255,230,0,0.4)';
      for (const q of h.quads) { ctx.beginPath(); q.forEach((p, i) => { const s = ls(p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); }); ctx.closePath(); ctx.fill(); }
    });
    ctx.restore();
  }
}
