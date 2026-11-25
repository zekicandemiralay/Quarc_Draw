// Viewport: world ↔ screen transform (pan / zoom / rotate / flip) and multi-page layout.

import type { Mat, Rect, Vec } from './geometry';
import { clamp, mApply, mInvert, mMul, mRotate, mScale, mTranslate, rad, transformRectBounds, rectIntersects } from './geometry';
import type { Page, PageLayout, QDocument } from './model';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
const PAGE_GAP = 40;

export interface ViewState { cx: number; cy: number; zoom: number; rotation: number; flipX: boolean }

/** Positions pages in world space according to the layout mode. Returns world rect of every page. */
export function layoutPages(doc: QDocument, mode: PageLayout = doc.layout): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const pages = doc.pages;
  if (mode === 'free' || mode === 'single') {
    for (const p of pages) out.set(p.id, { x: mode === 'free' ? p.x : 0, y: mode === 'free' ? p.y : 0, w: p.width, h: p.height });
    return out;
  }
  if (mode === 'vertical') {
    let y = 0;
    const maxW = Math.max(...pages.map((p) => p.width), 1);
    for (const p of pages) { out.set(p.id, { x: (maxW - p.width) / 2, y, w: p.width, h: p.height }); y += p.height + PAGE_GAP; }
  } else if (mode === 'horizontal') {
    let x = 0;
    for (const p of pages) { out.set(p.id, { x, y: 0, w: p.width, h: p.height }); x += p.width + PAGE_GAP; }
  } else if (mode === 'spread') {
    // first page alone (cover), then pairs side-by-side
    let y = 0;
    for (let i = 0; i < pages.length;) {
      const left = pages[i];
      const pair = i === 0 ? [left] : pages.slice(i, i + 2);
      let x = 0, rowH = 0;
      if (pair.length === 1) x = left.width + PAGE_GAP / 2;
      for (const p of pair) { out.set(p.id, { x, y, w: p.width, h: p.height }); x += p.width + PAGE_GAP / 2; rowH = Math.max(rowH, p.height); }
      y += rowH + PAGE_GAP; i += pair.length;
    }
  } else if (mode === 'grid') {
    const cols = Math.max(1, Math.ceil(Math.sqrt(pages.length)));
    const cw = Math.max(...pages.map((p) => p.width), 1), ch = Math.max(...pages.map((p) => p.height), 1);
    pages.forEach((p, i) => out.set(p.id, { x: (i % cols) * (cw + PAGE_GAP) + (cw - p.width) / 2, y: Math.floor(i / cols) * (ch + PAGE_GAP), w: p.width, h: p.height }));
  }
  return out;
}

export class Viewport {
  cx = 0; cy = 0;           // world point at the center of the screen
  zoom = 1;
  rotation = 0;             // radians
  flipX = false;
  width = 800; height = 600; // CSS px
  dpr = 1;
  pageRects = new Map<string, Rect>();

  /** world → screen (CSS px) */
  matrix(): Mat {
    // screen = T(center) * R * S(flip) * Z * T(-c)
    let m = mTranslate(this.width / 2, this.height / 2);
    m = mMul(m, mRotate(this.rotation));
    m = mMul(m, mScale(this.flipX ? -this.zoom : this.zoom, this.zoom));
    m = mMul(m, mTranslate(-this.cx, -this.cy));
    return m;
  }
  inverse(): Mat { return mInvert(this.matrix()); }
  toScreen(p: Vec): Vec { return mApply(this.matrix(), p); }
  toWorld(p: Vec): Vec { return mApply(this.inverse(), p); }
  getState(): ViewState { return { cx: this.cx, cy: this.cy, zoom: this.zoom, rotation: this.rotation, flipX: this.flipX }; }
  setState(s: ViewState) { Object.assign(this, s); }

  resize(w: number, h: number, dpr: number) { this.width = w; this.height = h; this.dpr = dpr; }

  panBy(dxScreen: number, dyScreen: number) {
    const inv = mInvert(mMul(mRotate(this.rotation), mScale(this.flipX ? -this.zoom : this.zoom, this.zoom)));
    const d = { x: inv.a * dxScreen + inv.c * dyScreen, y: inv.b * dxScreen + inv.d * dyScreen };
    this.cx -= d.x; this.cy -= d.y;
  }
  /** zoom keeping the world point under `anchor` (screen coords) fixed */
  zoomAt(anchor: Vec, newZoom: number) {
    newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
    const before = this.toWorld(anchor);
    this.zoom = newZoom;
    const after = this.toWorld(anchor);
    this.cx += before.x - after.x; this.cy += before.y - after.y;
  }
  rotateAt(anchor: Vec, newRot: number) {
    const before = this.toWorld(anchor);
    this.rotation = newRot;
    const after = this.toWorld(anchor);
    this.cx += before.x - after.x; this.cy += before.y - after.y;
  }
  resetRotation() { this.rotateAt({ x: this.width / 2, y: this.height / 2 }, 0); }
  fitRect(r: Rect, padding = 40) {
    const aw = Math.max(50, this.width - padding * 2), ah = Math.max(50, this.height - padding * 2);
    const b = this.rotation ? transformRectBounds(mMul(mRotate(this.rotation), mScale(1, 1)), r) : r;
    this.zoom = clamp(Math.min(aw / b.w, ah / b.h), MIN_ZOOM, MAX_ZOOM);
    this.cx = r.x + r.w / 2; this.cy = r.y + r.h / 2;
  }
  fitWidth(r: Rect, padding = 24) {
    this.zoom = clamp((this.width - padding * 2) / r.w, MIN_ZOOM, MAX_ZOOM);
    this.cx = r.x + r.w / 2; this.cy = r.y + Math.min(r.h / 2, (this.height / 2) / this.zoom - padding / this.zoom);
  }
  /** world-space rectangle currently visible */
  visibleWorldRect(): Rect {
    const inv = this.inverse();
    const pts = [{ x: 0, y: 0 }, { x: this.width, y: 0 }, { x: this.width, y: this.height }, { x: 0, y: this.height }].map((p) => mApply(inv, p));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  /** pages (with rects) intersecting the visible area */
  visiblePages(doc: QDocument): { page: Page; rect: Rect }[] {
    const vis = this.visibleWorldRect();
    const res: { page: Page; rect: Rect }[] = [];
    for (const p of doc.pages) {
      const r = this.pageRects.get(p.id);
      if (!r) continue;
      if (rectIntersects(vis, r)) res.push({ page: p, rect: r });
    }
    return res;
  }
  /** page under a world point (preferring `prefer`) */
  pageAt(doc: QDocument, w: Vec, prefer?: Page | null): { page: Page; local: Vec } | null {
    const hit = (p: Page) => {
      const r = this.pageRects.get(p.id);
      if (!r) return null;
      const local = { x: w.x - r.x, y: w.y - r.y };
      if (local.x >= 0 && local.y >= 0 && local.x <= r.w && local.y <= r.h) return { page: p, local };
      return null;
    };
    if (prefer) { const h = hit(prefer); if (h) return h; }
    for (let i = doc.pages.length - 1; i >= 0; i--) { const h = hit(doc.pages[i]); if (h) return h; }
    return null;
  }
  /** matrix mapping page-local coordinates → screen CSS px */
  pageMatrix(page: Page): Mat {
    const r = this.pageRects.get(page.id) ?? { x: 0, y: 0, w: 0, h: 0 };
    return mMul(this.matrix(), mTranslate(r.x, r.y));
  }
  /** matrix page-local → device pixels (applies dpr) */
  pageDeviceMatrix(page: Page): Mat { return mMul(mScale(this.dpr), this.pageMatrix(page)); }
  worldToLocal(page: Page, w: Vec): Vec {
    const r = this.pageRects.get(page.id) ?? { x: 0, y: 0, w: 0, h: 0 };
    return { x: w.x - r.x, y: w.y - r.y };
  }
  localToWorld(page: Page, p: Vec): Vec {
    const r = this.pageRects.get(page.id) ?? { x: 0, y: 0, w: 0, h: 0 };
    return { x: p.x + r.x, y: p.y + r.y };
  }
  rotationDeg() { return (this.rotation * 180) / Math.PI; }
  setRotationDeg(d: number) { this.rotation = rad(d); }
}
