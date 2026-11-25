// Editor: the central controller for one open document.

import { useSyncExternalStore } from 'react';
import type { Rect, Vec } from '../core/geometry';
import { rectCenter } from '../core/geometry';
import type { Layer, Page, QDocument, RasterLayer, VObject, VectorLayer } from '../core/model';
import { createDocument, createPage, createRasterLayer, createVectorLayer, findLayer, findObject, walkLayers } from '../core/model';
import type { RasterSurface } from '../core/raster';
import { History } from '../core/history';
import { Selection, SelectMode } from '../core/selection';
import { DocSnapshot, restoreDoc, snapshotDoc } from '../core/snapshot';
import { Viewport, layoutPages } from '../core/viewport';
import type { LayerOverlay } from '../core/render';
import { Emitter, uid } from '../core/util';
import { BrushSettings, DEFAULT_BRUSH, releaseStrokeSpares } from '../brush/engine';
import { BRUSH_PRESETS, getBrush } from '../brush/presets';
import { Tool, ToolOptions, defaultToolOptions } from '../tools/tool';
import { createTool } from '../tools/registry';
import { prefs } from '../app/store';
import type { StrokePatch } from '../brush/engine';

export type Topic = 'doc' | 'layers' | 'selection' | 'objsel' | 'tool' | 'view' | 'history' | 'colors' | 'brush' | 'toolopts' | 'page' | 'status';

export class Editor {
  readonly id = uid('ed');
  doc: QDocument;
  view = new Viewport();
  history = new History();
  events = new Emitter<Record<Topic, void>>();
  versions: Record<Topic, number> = { doc: 0, layers: 0, selection: 0, objsel: 0, tool: 0, view: 0, history: 0, colors: 0, brush: 0, toolopts: 0, page: 0, status: 0 };

  activePageId = '';
  activeLayerId: string | null = null;
  editingMask = false;
  objSel: string[] = [];
  private sels = new Map<string, Selection>();

  fg = '#111111';
  bg = '#ffffff';
  toolId = 'brush';
  prevToolId = 'brush';
  opts: ToolOptions = defaultToolOptions();
  brush: BrushSettings = { ...DEFAULT_BRUSH };
  /** remember the last brush used for each tool so switching tools restores it */
  toolBrushes: Record<string, string> = { brush: 'pencil-hb', eraser: 'erase-hard', smudge: 'tool-smudge', blur: 'tool-blur', sharpen: 'tool-sharpen', dodge: 'tool-dodge', burn: 'tool-burn', clone: 'tool-clone' };
  /** the settings each brush-family tool had when it was left (size, opacity…), so switching to the eraser and back keeps them */
  private toolBrushLive: Record<string, BrushSettings> = {};
  private tools = new Map<string, Tool>();

  overlays: LayerOverlay[] = [];
  hiddenObjects = new Set<string>();
  hiddenLayers = new Set<string>();
  afterLayer: { layerId: string; draw: (ctx: CanvasRenderingContext2D) => void } | undefined;
  pointerLocal: Vec | null = null;
  /** DOM element (positioned over the canvas) that hosts in-place editors such as the text editor */
  overlayHost: HTMLElement | null = null;
  /** set by the canvas view so tools can request redraw */
  renderHook: (() => void) | null = null;
  /** repaint only `rect` (page-local coordinates) of the page — used while a brush stroke is in progress */
  renderRectHook: ((page: Page, rect: Rect) => void) | null = null;
  overlayHook: (() => void) | null = null;
  /** transient message shown in the status bar */
  statusMessage = '';
  /** guide being dragged out of a ruler (page-local coordinate) */
  tempGuide: { axis: 'h' | 'v'; pos: number } | null = null;
  /** held modifier state (maintained by the global key handler) */
  spaceDown = false;
  fileHandleName: string | null = null;
  syncId: string | null = null;
  lastSavedAt = 0;
  isNew = true;
  /** when the pointer last drew on the canvas (performance.now()) — autosave waits for a pause so it never lands mid-stroke */
  lastInputAt = -1e9;

  constructor(doc: QDocument) {
    this.doc = doc;
    if (!doc.pages.length) doc.pages.push(createPage(1920, 1080));
    this.activePageId = doc.pages[0].id;
    this.ensureActiveLayer();
    this.relayout();
    this.history.events.on('change', () => this.changed('history'));
    this.setBrushPreset(this.toolBrushes.brush);
  }

  // ---------- events ----------
  changed(...topics: Topic[]) {
    for (const t of topics) { this.versions[t]++; this.events.emit(t, undefined); }
    if (topics.some((t) => t === 'doc' || t === 'layers' || t === 'selection' || t === 'objsel' || t === 'view' || t === 'page')) this.requestRender();
  }
  requestRender() { this.renderHook?.(); }
  /** Cheap repaint of a small part of a page. Falls back to a full repaint when the view has no partial path. */
  requestRenderRect(page: Page, rect: Rect) { if (this.renderRectHook) this.renderRectHook(page, rect); else this.renderHook?.(); }
  requestOverlay() { this.overlayHook?.(); }
  setStatus(msg: string, ms = 2500) {
    this.statusMessage = msg; this.changed('status');
    if (ms) setTimeout(() => { if (this.statusMessage === msg) { this.statusMessage = ''; this.changed('status'); } }, ms);
  }

  // ---------- accessors ----------
  get page(): Page { return this.doc.pages.find((p) => p.id === this.activePageId) ?? this.doc.pages[0]; }
  get pageIndex(): number { return Math.max(0, this.doc.pages.findIndex((p) => p.id === this.page.id)); }
  get layer(): Layer | null {
    if (!this.activeLayerId) return null;
    return findLayer(this.page.layers, this.activeLayerId)?.layer ?? null;
  }
  get tool(): Tool { return this.getTool(this.toolId); }
  getTool(id: string): Tool {
    let t = this.tools.get(id);
    if (!t) { t = createTool(id, this); this.tools.set(id, t); }
    return t;
  }
  selectionFor(page: Page): Selection {
    let s = this.sels.get(page.id);
    if (!s || s.w !== page.width || s.h !== page.height) {
      const old = s;
      s = new Selection(page.width, page.height);
      if (old && old.mask) { /* size changed → selection dropped */ }
      this.sels.set(page.id, s);
    }
    return s;
  }
  get selection(): Selection { return this.selectionFor(this.page); }
  get hasSelection(): boolean { return !this.selection.isEmpty; }

  /** Surface that painting tools should target (layer pixels or the layer mask) */
  getSurface(pageId: string, layerId: string, target: 'layer' | 'mask'): RasterSurface | null {
    const pg = this.doc.pages.find((p) => p.id === pageId);
    if (!pg) return null;
    const l = findLayer(pg.layers, layerId)?.layer;
    if (!l) return null;
    if (target === 'mask') return l.mask;
    return l.type === 'raster' ? l.surface : null;
  }
  selectedObjects(): VObject[] {
    const out: VObject[] = [];
    for (const id of this.objSel) { const f = findObject(this.page, id); if (f) out.push(f.obj); }
    return out;
  }

  // ---------- active layer / page management ----------
  ensureActiveLayer() {
    const pg = this.page;
    if (this.activeLayerId && findLayer(pg.layers, this.activeLayerId)) return;
    let first: Layer | null = null;
    walkLayers(pg.layers, (l) => { first = l; });
    // prefer the top-most layer
    this.activeLayerId = pg.layers.length ? pg.layers[pg.layers.length - 1].id : (first as Layer | null)?.id ?? null;
    this.editingMask = false;
  }
  setActivePage(id: string, opts: { silent?: boolean } = {}) {
    if (this.activePageId === id || !this.doc.pages.some((p) => p.id === id)) return;
    this.tool.commit();
    this.activePageId = id;
    this.objSel = [];
    this.activeLayerId = null;
    this.ensureActiveLayer();
    if (!opts.silent) this.changed('page', 'layers', 'objsel', 'selection');
    else this.changed('page', 'layers', 'objsel');
  }
  setActiveLayer(id: string | null, mask = false) {
    this.activeLayerId = id; this.editingMask = mask && !!this.layer?.mask;
    this.changed('layers');
  }
  /** make sure there is a raster layer to draw on; creates one if the active layer can't take pixels */
  ensureRasterTarget(): RasterLayer | null {
    const l = this.layer;
    if (l && l.type === 'raster') return l;
    if (l && l.mask && this.editingMask) return null;
    // create a new raster layer above the active one
    return this.createRasterAbove(l);
  }
  private createRasterAbove(l: Layer | null): RasterLayer {
    const rl = createRasterLayer(`Layer ${this.countLayers() + 1}`, this.page.width, this.page.height);
    this.transact('New layer', () => {
      const f = l ? findLayer(this.page.layers, l.id) : null;
      if (f) f.siblings.splice(f.index + 1, 0, rl); else this.page.layers.push(rl);
    }, { pages: [this.page.id] });
    this.activeLayerId = rl.id; this.editingMask = false;
    this.changed('layers');
    return rl;
  }
  countLayers(): number { let n = 0; walkLayers(this.page.layers, () => { n++; }); return n; }

  // ---------- history helpers ----------
  /** Run a structural change with automatic before/after snapshots. */
  transact<T>(label: string, fn: () => T, o: { pages?: string[] | 'all'; coalesce?: string } = {}): T {
    const ids = o.pages === 'all' ? undefined : (o.pages ?? [this.page.id]);
    const before = snapshotDoc(this.doc, ids);
    const result = fn();
    const after = snapshotDoc(this.doc, ids);
    this.doc.modified = Date.now();
    const apply = (s: DocSnapshot) => () => { restoreDoc(this.doc, s); this.afterRestore(); };
    if (!(o.coalesce && this.history.coalesce(o.coalesce, apply(after)))) {
      this.history.push({ label, key: o.coalesce, bytes: before.cost + after.cost, undo: apply(before), redo: apply(after) });
    }
    this.changed('doc', 'layers');
    this.relayout();
    return result;
  }
  /** Live edits (drags): take a snapshot first, mutate freely, then `endLive` records ONE history entry. */
  beginLive(pages?: string[]): { snap: DocSnapshot; ids: string[] } {
    const ids = pages ?? [this.page.id];
    return { snap: snapshotDoc(this.doc, ids), ids };
  }
  endLive(label: string, live: { snap: DocSnapshot; ids: string[] }) {
    const after = snapshotDoc(this.doc, live.ids);
    this.doc.modified = Date.now();
    const apply = (s: DocSnapshot) => () => { restoreDoc(this.doc, s); this.afterRestore(); };
    this.history.push({ label, bytes: live.snap.cost + after.cost, undo: apply(live.snap), redo: apply(after) });
    this.changed('doc', 'layers');
  }
  private afterRestore() {
    if (!this.doc.pages.some((p) => p.id === this.activePageId)) this.activePageId = this.doc.pages[0]?.id ?? '';
    if (this.activeLayerId && !findLayer(this.page.layers, this.activeLayerId)) { this.activeLayerId = null; this.ensureActiveLayer(); }
    const ids = new Set<string>();
    walkLayers(this.page.layers, (l) => { if (l.type === 'vector') for (const o of l.objects) ids.add(o.id); });
    this.objSel = this.objSel.filter((id) => !!findObject(this.page, id));
    this.relayout();
    this.changed('doc', 'layers', 'objsel', 'page', 'selection');
  }
  commitRasterPatch(label: string, pageId: string, layerId: string, target: 'layer' | 'mask', patch: StrokePatch) {
    const tiles = patch.tiles;
    this.doc.modified = Date.now();
    // memory this step holds: ImageData counts its bytes, a canvas atlas counts once however many tiles share it
    const atlases = new Set<HTMLCanvasElement>();
    let bytes = 0;
    for (const t of tiles) { if (t.before instanceof ImageData) bytes += t.before.data.length * 2; else atlases.add(t.before.canvas); }
    for (const a of atlases) bytes += a.width * a.height * 8;
    this.history.push({
      label, bytes,
      undo: () => {
        const s = this.getSurface(pageId, layerId, target);
        if (s) {
          // the layer still holds the "after" pixels right now: keep them for redo (done lazily, so a stroke costs no readback)
          if (tiles.some((t) => !t.after)) { const snap = s.snapshotRects(tiles.map((t) => t.rect)); tiles.forEach((t, i) => { t.after ??= snap[i]; }); }
          for (const t of tiles) s.putPixels(t.rect, t.before);
        }
        this.changed('layers');
      },
      redo: () => {
        const s = this.getSurface(pageId, layerId, target);
        if (s) for (const t of tiles) if (t.after) s.putPixels(t.rect, t.after);
        this.changed('layers');
      },
    });
    this.changed('layers');
  }
  /** Convenience for pixel ops that mutate a surface: captures before/after of `rect` around `fn`. */
  mutateRaster(label: string, layerId: string, target: 'layer' | 'mask', rect: Rect, fn: (s: RasterSurface) => void) {
    const s = this.getSurface(this.page.id, layerId, target);
    if (!s) return;
    const r = { x: Math.max(0, Math.floor(rect.x)), y: Math.max(0, Math.floor(rect.y)), w: 0, h: 0 };
    r.w = Math.min(s.width, Math.ceil(rect.x + rect.w)) - r.x; r.h = Math.min(s.height, Math.ceil(rect.y + rect.h)) - r.y;
    if (r.w <= 0 || r.h <= 0) return;
    const before = s.getPatch(r);
    fn(s);
    s.touch();
    const after = s.getPatch(r);
    this.commitRasterPatch(label, this.page.id, layerId, target, { tiles: [{ rect: r, before, after }] });
  }

  undo() { this.tool.cancel(); if (this.history.undo()) this.changed('doc', 'layers'); }
  redo() { this.tool.cancel(); if (this.history.redo()) this.changed('doc', 'layers'); }

  // ---------- selection ----------
  /** Modify the selection of the active page with undo support. */
  editSelection(label: string, fn: (sel: Selection) => void) {
    const pageId = this.page.id;
    const sel = this.selection;
    const before = sel.getState();
    fn(sel);
    const after = sel.getState();
    if (before.mask === after.mask) { this.changed('selection'); return; }
    const apply = (st: typeof before) => () => { this.selectionFor(this.doc.pages.find((p) => p.id === pageId) ?? this.page).setState(st); this.changed('selection'); };
    this.history.push({ label, bytes: 64, undo: apply(before), redo: apply(after) });
    this.changed('selection');
  }
  /** For live selection edits (drags): mutate `selection` freely, then record one history entry. */
  commitSelectionHistory(label: string, before: { mask: Uint8Array | null; bounds: Rect | null }) {
    const pageId = this.page.id;
    const after = this.selection.getState();
    if (before.mask === after.mask) { this.changed('selection'); return; }
    const apply = (st: typeof before) => () => { this.selectionFor(this.doc.pages.find((p) => p.id === pageId) ?? this.page).setState(st); this.changed('selection'); };
    this.history.push({ label, bytes: 64, undo: apply(before), redo: apply(after) });
    this.changed('selection');
  }
  selectAll() { this.editSelection('Select all', (s) => s.selectAll()); }
  deselect() { if (this.hasSelection) this.editSelection('Deselect', (s) => s.clear()); }
  invertSelection() { this.editSelection('Invert selection', (s) => s.invert()); }
  get selectMode(): SelectMode { return this.opts.selectMode; }

  // ---------- colors ----------
  setFg(c: string) { if (c !== this.fg) { this.fg = c; this.changed('colors'); } }
  setBg(c: string) { if (c !== this.bg) { this.bg = c; this.changed('colors'); } }
  swapColors() { [this.fg, this.bg] = [this.bg, this.fg]; this.changed('colors'); }
  resetColors() { this.fg = '#111111'; this.bg = '#ffffff'; this.changed('colors'); }
  pushRecentColor(c: string) {
    const cur = prefs.get().recentColors.filter((x) => x.toLowerCase() !== c.toLowerCase());
    prefs.set({ recentColors: [c, ...cur].slice(0, 24) });
  }

  // ---------- tools ----------
  setTool(id: string) {
    if (id === this.toolId) return;
    this.tool.commit();
    this.tool.deactivate();
    const leftBid = this.toolBrushes[this.toolId];
    if (leftBid && this.brush.id === leftBid) this.toolBrushLive[this.toolId] = this.brush;
    this.prevToolId = this.toolId;
    this.toolId = id;
    // brush-family tools come back as they were left, or else with their remembered preset
    const bid = this.toolBrushes[id];
    if (bid) {
      const live = this.toolBrushLive[id];
      const b = live?.id === bid ? live : getBrush(bid) ?? prefs.get().userBrushes.find((x: BrushSettings) => x.id === bid);
      if (b) this.brush = { ...b };
      this.changed('brush');
    }
    this.tool.activate();
    this.changed('tool');
    this.requestOverlay();
  }
  setToolOpts(patch: Partial<ToolOptions>) { this.opts = { ...this.opts, ...patch }; this.changed('toolopts'); this.requestOverlay(); }
  setBrushPreset(id: string) {
    const b = getBrush(id) ?? prefs.get().userBrushes.find((x: BrushSettings) => x.id === id);
    if (!b) return;
    const toolFor: Record<string, string> = { paint: 'brush', erase: 'eraser', smudge: 'smudge', blur: 'blur', sharpen: 'sharpen', dodge: 'dodge', burn: 'burn', clone: 'clone' };
    const tid = toolFor[b.mode];
    this.toolBrushes[tid] = id;
    delete this.toolBrushLive[tid]; // a preset picked from the list starts fresh
    this.brush = { ...b };
    if (tid !== this.toolId && !['brush', 'eraser', 'smudge', 'blur', 'sharpen', 'dodge', 'burn', 'clone'].includes(this.toolId)) this.setTool(tid);
    else if (tid !== this.toolId) this.setTool(tid);
    this.changed('brush');
  }
  setBrush(patch: Partial<BrushSettings>) { this.brush = { ...this.brush, ...patch }; this.changed('brush'); }
  get presets() { return [...BRUSH_PRESETS, ...(prefs.get().userBrushes as BrushSettings[])]; }

  // ---------- view ----------
  relayout() {
    this.view.pageRects = layoutPages(this.doc);
    this.changed('view');
  }
  worldRectOf(page: Page): Rect { return this.view.pageRects.get(page.id) ?? { x: 0, y: 0, w: page.width, h: page.height }; }
  fitPage(page: Page = this.page, padding = 48) {
    this.relayout();
    this.view.fitRect(this.worldRectOf(page), padding);
    this.changed('view');
  }
  fitWidth(page: Page = this.page) {
    this.relayout();
    const r = this.worldRectOf(page);
    this.view.fitWidth(r);
    this.view.cy = r.y + this.view.height / 2 / this.view.zoom - 12 / this.view.zoom;
    this.changed('view');
  }
  fitAll() {
    this.relayout();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const rc of this.view.pageRects.values()) { x0 = Math.min(x0, rc.x); y0 = Math.min(y0, rc.y); x1 = Math.max(x1, rc.x + rc.w); y1 = Math.max(y1, rc.y + rc.h); }
    if (isFinite(x0)) this.view.fitRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    this.changed('view');
  }
  /** Turn the view back to upright (and un-flip it), animated so you see where it went. */
  resetViewRotation(animate = true) {
    const v = this.view, from = v.rotation, flip = v.flipX;
    if (flip) v.flipX = false;
    if (Math.abs(from) < 1e-6) { if (flip) this.changed('view'); return; }
    const c = { x: v.width / 2, y: v.height / 2 };
    if (!animate || typeof requestAnimationFrame !== 'function') { v.rotateAt(c, 0); this.changed('view'); return; }
    const t0 = performance.now(), ms = 220;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - (1 - t) ** 3;
      v.rotateAt(c, from * (1 - e));
      this.changed('view');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  zoomTo(z: number, anchor?: Vec) {
    this.view.zoomAt(anchor ?? { x: this.view.width / 2, y: this.view.height / 2 }, z);
    this.changed('view');
  }
  zoomBy(f: number, anchor?: Vec) { this.zoomTo(this.view.zoom * f, anchor); }
  goToPage(index: number, fit = true) {
    const p = this.doc.pages[Math.max(0, Math.min(this.doc.pages.length - 1, index))];
    if (!p) return;
    this.setActivePage(p.id);
    this.relayout();
    const r = this.worldRectOf(p);
    if (this.doc.layout === 'vertical' || this.doc.layout === 'horizontal' || this.doc.layout === 'grid') {
      if (this.doc.layout === 'vertical') { this.view.cx = r.x + r.w / 2; this.view.cy = r.y + this.view.height / 2 / this.view.zoom - 12 / this.view.zoom; }
      else { const c = rectCenter(r); this.view.cx = c.x; this.view.cy = c.y; }
    } else if (fit) this.view.fitRect(r, 48);
    this.changed('view');
  }
  /** In continuous layouts, the page under the screen centre becomes the active page while scrolling. */
  syncActivePageToView() {
    if (this.doc.layout === 'single' || this.doc.pages.length < 2) return;
    const c = { x: this.view.cx, y: this.view.cy };
    let best: Page | null = null, bd = Infinity;
    for (const p of this.doc.pages) {
      const r = this.view.pageRects.get(p.id); if (!r) continue;
      const inside = c.x >= r.x && c.x <= r.x + r.w && c.y >= r.y && c.y <= r.y + r.h;
      const d = inside ? 0 : Math.hypot(Math.max(r.x - c.x, 0, c.x - (r.x + r.w)), Math.max(r.y - c.y, 0, c.y - (r.y + r.h)));
      if (d < bd) { bd = d; best = p; }
    }
    if (best && best.id !== this.activePageId) this.setActivePage(best.id);
  }
  setLayoutMode(mode: QDocument['layout']) {
    this.doc.layout = mode;
    this.relayout();
    if (mode === 'single') this.fitPage(); else if (mode === 'vertical') this.fitWidth(); else this.fitAll();
    this.changed('doc');
  }

  // ---------- lifecycle ----------
  /** swap in a different document (e.g. after a sync update) keeping the same editor tab */
  replaceDocument(doc: QDocument) {
    this.tool.cancel();
    this.doc = doc;
    this.history.clear();
    this.sels.clear();
    this.objSel = []; this.overlays = [];
    this.activePageId = doc.pages.find((p) => p.id === this.activePageId)?.id ?? doc.pages[0]?.id ?? '';
    this.activeLayerId = null; this.ensureActiveLayer();
    this.relayout();
    this.history.markSaved();
    this.changed('doc', 'layers', 'page', 'selection', 'objsel', 'view', 'history');
  }
  markSaved() { this.history.markSaved(); this.lastSavedAt = Date.now(); this.isNew = false; this.changed('status'); }
  get dirty(): boolean { return this.history.isDirty; }
  dispose() { this.tool.cancel(); releaseStrokeSpares(); this.overlays = []; this.renderHook = null; this.renderRectHook = null; this.overlayHook = null; }
}

/** React hook: re-render when any of the given topics change on the editor. */
export function useEditor<T>(ed: Editor | null, topics: Topic[], select: () => T): T {
  const key = topics.join(',');
  void key;
  const subscribe = (fn: () => void) => {
    if (!ed) return () => {};
    const offs = topics.map((t) => ed.events.on(t, fn));
    return () => offs.forEach((o) => o());
  };
  // snapshot = combined version string so React detects changes; the selector result is read after.
  const snap = useSyncExternalStore(subscribe, () => (ed ? topics.reduce((s, t) => s + ed.versions[t] * 7 + 1, ed.id.length) : 0));
  void snap;
  return select();
}

export function newDocument(opts: {
  title?: string; width: number; height: number; dpi?: number; background?: string | null;
  pages?: number; withRasterLayer?: boolean; withVectorLayer?: boolean;
}): Editor {
  const doc = createDocument(opts.title ?? 'Untitled');
  doc.dpi = opts.dpi ?? 96;
  const n = opts.pages ?? 1;
  for (let i = 0; i < n; i++) {
    const p = createPage(opts.width, opts.height, `Page ${i + 1}`, { color: opts.background === undefined ? '#ffffff' : opts.background });
    if (opts.withRasterLayer !== false) p.layers.push(createRasterLayer('Layer 1', opts.width, opts.height));
    if (opts.withVectorLayer) p.layers.push(createVectorLayer('Vector'));
    doc.pages.push(p);
  }
  if (n > 1) doc.layout = 'vertical';
  return new Editor(doc);
}
export type { VectorLayer };
