// Page operations: add / duplicate / delete / reorder, canvas size, image size, crop, rotate, flip.

import type { Editor } from './editor';
import type { Layer, Page, PageBackground, VObject } from '../core/model';
import { createPage, createRasterLayer, createVectorLayer, walkLayers } from '../core/model';
import { RasterSurface } from '../core/raster';
import type { Mat, Rect } from '../core/geometry';
import { IDENTITY, mMul, mRotate, mScale, mTranslate } from '../core/geometry';
import { cloneObject, transformObject } from '../core/vector';
import { uid } from '../core/util';
import { clonePage } from '../core/snapshot';

export type Anchor = 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br';
export function anchorOffset(a: Anchor, dw: number, dh: number): { x: number; y: number } {
  const col = 'lcr'.indexOf(a[1]);
  const row = 'tmb'.indexOf(a[0]);
  return { x: (dw * col) / 2, y: (dh * row) / 2 };
}

/** Apply `fn` to every raster surface (layers + masks) and `tf` to every vector object in a layer tree. */
function mapContent(layers: Layer[], mapSurface: (s: RasterSurface) => RasterSurface, tf: Mat | null) {
  walkLayers(layers, (l) => {
    if (l.type === 'raster') l.surface = mapSurface(l.surface);
    if (l.mask) l.mask = mapSurface(l.mask);
    if (l.type === 'vector' && tf) l.objects = l.objects.map((o: VObject) => transformObject(o, tf));
  });
}

export function addPage(ed: Editor, o: { after?: number; width?: number; height?: number; template?: PageBackground['template']; color?: string | null; blank?: boolean } = {}): Page {
  const ref = ed.page;
  const w = o.width ?? ref.width, h = o.height ?? ref.height;
  const p = createPage(w, h, `Page ${ed.doc.pages.length + 1}`, {
    color: o.color === undefined ? ref.background.color : o.color,
    template: o.template === undefined ? (ref.background.template ? { ...ref.background.template } : null) : o.template,
  });
  p.layers.push(createRasterLayer('Layer 1', w, h));
  if (ed.doc.kind === 'notebook' || ed.doc.kind === 'pdf') p.layers.push(createVectorLayer('Ink'));
  const idx = (o.after ?? ed.pageIndex) + 1;
  ed.transact('Add page', () => { ed.doc.pages.splice(idx, 0, p); }, { pages: 'all' });
  ed.setActivePage(p.id);
  ed.goToPage(idx);
  return p;
}
export function duplicatePage(ed: Editor, index = ed.pageIndex): Page | null {
  const src = ed.doc.pages[index];
  if (!src) return null;
  const c = clonePage(src);
  c.id = uid('pg'); c.name = src.name + ' copy'; c.bookmark = false;
  const dupLayer = (l: Layer): Layer => {
    const n = { ...l, id: uid('ly') } as Layer;
    if (n.type === 'raster' && l.type === 'raster') n.surface = l.surface.clone();
    if (l.mask) n.mask = l.mask.clone();
    if (n.type === 'vector' && l.type === 'vector') n.objects = l.objects.map((o) => cloneObject(o));
    if (n.type === 'group' && l.type === 'group') n.children = l.children.map(dupLayer);
    return n;
  };
  c.layers = src.layers.map(dupLayer);
  ed.transact('Duplicate page', () => { ed.doc.pages.splice(index + 1, 0, c); }, { pages: 'all' });
  ed.setActivePage(c.id);
  ed.goToPage(index + 1);
  return c;
}
export function deletePage(ed: Editor, index = ed.pageIndex) {
  if (ed.doc.pages.length <= 1) { ed.setStatus('A document needs at least one page'); return; }
  ed.transact('Delete page', () => { ed.doc.pages.splice(index, 1); }, { pages: 'all' });
  const next = ed.doc.pages[Math.min(index, ed.doc.pages.length - 1)];
  ed.activePageId = next.id; ed.activeLayerId = null; ed.ensureActiveLayer();
  ed.changed('page', 'layers');
}
export function movePage(ed: Editor, from: number, to: number) {
  if (from === to || to < 0 || to >= ed.doc.pages.length) return;
  ed.transact('Move page', () => { const [p] = ed.doc.pages.splice(from, 1); ed.doc.pages.splice(to, 0, p); }, { pages: 'all' });
}
export function renamePage(ed: Editor, index: number, name: string) {
  ed.transact('Rename page', () => { ed.doc.pages[index].name = name; }, { pages: [ed.doc.pages[index].id], coalesce: `pname:${index}` });
}
export function toggleBookmark(ed: Editor, index = ed.pageIndex) {
  ed.transact('Bookmark', () => { const p = ed.doc.pages[index]; p.bookmark = !p.bookmark; }, { pages: [ed.doc.pages[index].id] });
}
export function setPageBackground(ed: Editor, patch: Partial<PageBackground>, all = false) {
  const ids = all ? ed.doc.pages.map((p) => p.id) : [ed.page.id];
  ed.transact('Page background', () => {
    for (const p of ed.doc.pages) if (ids.includes(p.id)) p.background = { ...p.background, ...patch };
  }, { pages: ids });
}

// ---------- canvas / image size ----------
export function resizeCanvas(ed: Editor, page: Page, nw: number, nh: number, anchor: Anchor = 'mc') {
  nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
  const off = anchorOffset(anchor, nw - page.width, nh - page.height);
  const ox = Math.round(off.x), oy = Math.round(off.y);
  ed.transact('Canvas size', () => {
    mapContent(page.layers, (s) => s.resized(nw, nh, (ctx, old) => ctx.drawImage(old, ox, oy)), mTranslate(ox, oy));
    page.width = nw; page.height = nh;
    page.guides = page.guides.map((g) => ({ ...g, pos: g.pos + (g.axis === 'v' ? ox : oy) }));
  }, { pages: [page.id] });
  ed.selectionFor(page).clear();
  ed.relayout(); ed.changed('selection');
}
export function resizeImage(ed: Editor, page: Page, nw: number, nh: number, smooth = true) {
  nw = Math.max(1, Math.round(nw)); nh = Math.max(1, Math.round(nh));
  const sx = nw / page.width, sy = nh / page.height;
  ed.transact('Image size', () => {
    mapContent(page.layers, (s) => s.resized(nw, nh, (ctx, old) => { ctx.imageSmoothingEnabled = smooth; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(old, 0, 0, nw, nh); }), mScale(sx, sy));
    page.width = nw; page.height = nh;
    page.guides = page.guides.map((g) => ({ ...g, pos: g.pos * (g.axis === 'v' ? sx : sy) }));
  }, { pages: [page.id] });
  ed.selectionFor(page).clear();
  ed.relayout(); ed.changed('selection');
}
export function cropPage(ed: Editor, page: Page, r: Rect) {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.max(1, Math.round(r.w)), h = Math.max(1, Math.round(r.h));
  ed.transact('Crop', () => {
    mapContent(page.layers, (s) => s.resized(w, h, (ctx, old) => ctx.drawImage(old, -x, -y)), mTranslate(-x, -y));
    page.width = w; page.height = h;
    page.guides = page.guides.map((g) => ({ ...g, pos: g.pos - (g.axis === 'v' ? x : y) }));
  }, { pages: [page.id] });
  ed.selectionFor(page).clear();
  ed.relayout(); ed.changed('selection');
}
export function rotatePage(ed: Editor, page: Page, deg: 90 | 180 | 270) {
  const w = page.width, h = page.height;
  const swap = deg !== 180;
  const nw = swap ? h : w, nh = swap ? w : h;
  const a = (deg * Math.PI) / 180;
  const tf = mMul(mTranslate(nw / 2, nh / 2), mMul(mRotate(a), mTranslate(-w / 2, -h / 2)));
  ed.transact(`Rotate ${deg}°`, () => {
    mapContent(page.layers, (s) => s.resized(nw, nh, (ctx, old) => { ctx.translate(nw / 2, nh / 2); ctx.rotate(a); ctx.translate(-w / 2, -h / 2); ctx.drawImage(old, 0, 0); }), tf);
    page.width = nw; page.height = nh; page.guides = [];
  }, { pages: [page.id] });
  ed.selectionFor(page).clear();
  ed.relayout(); ed.changed('selection');
}
export function flipPage(ed: Editor, page: Page, horizontal: boolean) {
  const w = page.width, h = page.height;
  const tf = horizontal ? { ...IDENTITY, a: -1, e: w } : { ...IDENTITY, d: -1, f: h };
  ed.transact(horizontal ? 'Flip horizontal' : 'Flip vertical', () => {
    mapContent(page.layers, (s) => s.resized(w, h, (ctx, old) => { if (horizontal) ctx.setTransform(-1, 0, 0, 1, w, 0); else ctx.setTransform(1, 0, 0, -1, 0, h); ctx.drawImage(old, 0, 0); }), tf);
  }, { pages: [page.id] });
  ed.selectionFor(page).clear();
  ed.changed('selection');
}
/** Trim transparent/identical border around all raster content */
export function trimToContent(ed: Editor, page: Page) {
  let r: Rect | null = null;
  walkLayers(page.layers, (l) => {
    if (l.type === 'raster') {
      const b = l.surface.contentBounds();
      if (b) r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b;
    }
  });
  if (r) cropPage(ed, page, r);
}
