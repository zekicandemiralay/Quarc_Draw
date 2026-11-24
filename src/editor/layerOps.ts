// Layer operations (all undoable through Editor.transact).

import type { Editor } from './editor';
import type { Adjustment, Layer, GroupLayer, RasterLayer, VectorLayer, BlendMode, LayerEffect } from '../core/model';
import {
  createAdjustmentLayer, createGroupLayer, createRasterLayer, createVectorLayer, findLayer, walkLayers, allLayers,
} from '../core/model';
import { RasterSurface } from '../core/raster';
import { renderPageToCanvas } from '../core/render';
import { cloneObject } from '../core/vector';
import { uid, createCanvas, ctx2d } from '../core/util';
import type { Rect } from '../core/geometry';

type Patch = Partial<Pick<Layer, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'clip' | 'alphaLock' | 'effects' | 'maskEnabled' | 'tag' | 'reference'>>;

const insertAbove = (ed: Editor, layer: Layer, ref: Layer | null) => {
  const pg = ed.page;
  if (ref) {
    const f = findLayer(pg.layers, ref.id);
    if (f) {
      // if the reference is an open group, put the new layer inside at top
      f.siblings.splice(f.index + 1, 0, layer);
      return;
    }
  }
  pg.layers.push(layer);
};

export function addLayer(ed: Editor, kind: 'raster' | 'vector' | 'group', name?: string): Layer {
  const pg = ed.page;
  const n = ed.countLayers() + 1;
  let layer: Layer;
  if (kind === 'raster') layer = createRasterLayer(name ?? `Layer ${n}`, pg.width, pg.height);
  else if (kind === 'vector') layer = createVectorLayer(name ?? `Vector ${n}`);
  else layer = createGroupLayer(name ?? `Group ${n}`);
  ed.transact(`New ${kind} layer`, () => insertAbove(ed, layer, ed.layer), { pages: [pg.id] });
  ed.setActiveLayer(layer.id);
  return layer;
}

export function addAdjustmentLayer(ed: Editor, adj: Adjustment): Layer {
  const layer = createAdjustmentLayer(adj);
  ed.transact('New adjustment layer', () => insertAbove(ed, layer, ed.layer), { pages: [ed.page.id] });
  ed.setActiveLayer(layer.id);
  return layer;
}

export function updateLayer(ed: Editor, id: string, patch: Patch, coalesce?: string) {
  ed.transact('Layer properties', () => {
    const f = findLayer(ed.page.layers, id);
    if (f) Object.assign(f.layer, patch);
  }, { pages: [ed.page.id], coalesce: coalesce ?? `layer:${id}:${Object.keys(patch).join(',')}` });
}
export function setAdjustment(ed: Editor, id: string, adj: Adjustment) {
  ed.transact('Adjustment', () => {
    const f = findLayer(ed.page.layers, id);
    if (f && f.layer.type === 'adjustment') { f.layer.adj = adj; f.layer.name = f.layer.name; }
  }, { pages: [ed.page.id], coalesce: `adj:${id}` });
}
export function setEffects(ed: Editor, id: string, effects: LayerEffect[]) {
  updateLayer(ed, id, { effects }, `fx:${id}`);
}
export function renameLayer(ed: Editor, id: string, name: string) { updateLayer(ed, id, { name }, `rename:${id}`); }
export function toggleVisible(ed: Editor, id: string) {
  const f = findLayer(ed.page.layers, id);
  if (f) updateLayer(ed, id, { visible: !f.layer.visible }, `vis:${id}:${Date.now()}`);
}

export function deleteLayer(ed: Editor, id?: string) {
  const target = id ?? ed.activeLayerId;
  if (!target) return;
  ed.transact('Delete layer', () => {
    const f = findLayer(ed.page.layers, target);
    if (f) f.siblings.splice(f.index, 1);
  }, { pages: [ed.page.id] });
  if (ed.activeLayerId === target) { ed.activeLayerId = null; ed.ensureActiveLayer(); }
  ed.objSel = [];
  ed.changed('layers', 'objsel');
}

function cloneLayerDeep(l: Layer): Layer {
  const c: Layer = { ...l, id: uid('ly'), name: l.name + ' copy', effects: l.effects.map((e) => ({ ...e, id: uid('fx') })) } as Layer;
  c.mask = l.mask ? l.mask.clone() : null;
  if (c.type === 'raster' && l.type === 'raster') c.surface = l.surface.clone();
  if (c.type === 'vector' && l.type === 'vector') c.objects = l.objects.map((o) => cloneObject(o));
  if (c.type === 'group' && l.type === 'group') c.children = l.children.map(cloneLayerDeep);
  if (c.type === 'adjustment' && l.type === 'adjustment') c.adj = JSON.parse(JSON.stringify(l.adj));
  return c;
}
export function duplicateLayer(ed: Editor, id?: string): Layer | null {
  const src = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!src) return null;
  const c = cloneLayerDeep(src.layer);
  ed.transact('Duplicate layer', () => { src.siblings.splice(src.index + 1, 0, c); }, { pages: [ed.page.id] });
  ed.setActiveLayer(c.id);
  return c;
}

export type MoveDir = 'up' | 'down' | 'top' | 'bottom';
export function moveLayer(ed: Editor, id: string, dir: MoveDir) {
  ed.transact('Reorder layer', () => {
    const f = findLayer(ed.page.layers, id);
    if (!f) return;
    const { siblings, index } = f;
    let to = index;
    if (dir === 'up') to = Math.min(siblings.length - 1, index + 1);
    else if (dir === 'down') to = Math.max(0, index - 1);
    else if (dir === 'top') to = siblings.length - 1;
    else to = 0;
    if (to === index) return;
    const [l] = siblings.splice(index, 1);
    siblings.splice(to, 0, l);
  }, { pages: [ed.page.id] });
}
/** drag & drop reordering: place `id` above/below/inside `targetId` */
export function reorderLayer(ed: Editor, id: string, targetId: string, where: 'above' | 'below' | 'inside') {
  if (id === targetId) return;
  ed.transact('Reorder layer', () => {
    const src = findLayer(ed.page.layers, id);
    if (!src) return;
    // prevent dropping a group into its own descendant
    if (src.layer.type === 'group' && findLayer(src.layer.children, targetId)) return;
    const [l] = src.siblings.splice(src.index, 1);
    const tgt = findLayer(ed.page.layers, targetId);
    if (!tgt) { src.siblings.splice(src.index, 0, l); return; }
    if (where === 'inside' && tgt.layer.type === 'group') tgt.layer.children.push(l);
    else tgt.siblings.splice(where === 'above' ? tgt.index + 1 : tgt.index, 0, l);
  }, { pages: [ed.page.id] });
}

export function groupLayers(ed: Editor, ids: string[]) {
  if (!ids.length) return;
  const g = createGroupLayer('Group');
  ed.transact('Group layers', () => {
    const found = ids.map((i) => findLayer(ed.page.layers, i)).filter(Boolean) as NonNullable<ReturnType<typeof findLayer>>[];
    if (!found.length) return;
    const top = found.reduce((a, b) => (a.siblings === b.siblings && a.index > b.index ? a : b));
    const sibs = top.siblings;
    const members = found.filter((f) => f.siblings === sibs).sort((a, b) => a.index - b.index);
    const insertAt = members[members.length - 1].index - members.length + 1;
    for (const m of [...members].reverse()) sibs.splice(m.index, 1);
    g.children = members.map((m) => m.layer);
    sibs.splice(Math.max(0, insertAt), 0, g);
  }, { pages: [ed.page.id] });
  ed.setActiveLayer(g.id);
}
export function ungroupLayer(ed: Editor, id: string) {
  ed.transact('Ungroup', () => {
    const f = findLayer(ed.page.layers, id);
    if (!f || f.layer.type !== 'group') return;
    f.siblings.splice(f.index, 1, ...f.layer.children);
  }, { pages: [ed.page.id] });
}

// -------- merging / flattening --------
function renderLayerSet(ed: Editor, layers: Layer[], withBackground = false): HTMLCanvasElement {
  const pg = { ...ed.page, layers: layers.map((l) => ({ ...l, clip: false })) };
  return renderPageToCanvas(ed.doc, pg, 1, { skipBackground: !withBackground, transparentBackground: !withBackground });
}
export function mergeDown(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || f.index === 0) return;
  const lower = f.siblings[f.index - 1], upper = f.layer;
  const canvas = renderLayerSet(ed, [lower, upper]);
  const merged: RasterLayer = { ...createRasterLayer(lower.name, ed.page.width, ed.page.height), visible: true };
  merged.surface.setFromCanvas(canvas);
  ed.transact('Merge down', () => { f.siblings.splice(f.index - 1, 2, merged); }, { pages: [ed.page.id] });
  ed.setActiveLayer(merged.id);
}
export function mergeVisible(ed: Editor) {
  const vis = ed.page.layers.filter((l) => l.visible);
  if (!vis.length) return;
  const canvas = renderLayerSet(ed, vis);
  const merged = createRasterLayer('Merged', ed.page.width, ed.page.height);
  merged.surface.setFromCanvas(canvas);
  ed.transact('Merge visible', () => { ed.page.layers.push(merged); }, { pages: [ed.page.id] });
  ed.setActiveLayer(merged.id);
}
export function flattenPage(ed: Editor) {
  const canvas = renderLayerSet(ed, ed.page.layers.filter((l) => l.visible), true);
  const flat = createRasterLayer('Flattened', ed.page.width, ed.page.height);
  flat.surface.setFromCanvas(canvas);
  ed.transact('Flatten image', () => {
    ed.page.layers = [flat];
    ed.page.background = { ...ed.page.background, color: null, template: null, pdfPage: null, image: null };
  }, { pages: [ed.page.id] });
  ed.setActiveLayer(flat.id);
}
export function rasterizeLayer(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || f.layer.type === 'raster') return;
  const l = f.layer;
  const canvas = renderLayerSet(ed, [{ ...l, opacity: 1, blend: 'normal', effects: [], mask: null } as Layer]);
  const r: RasterLayer = {
    ...createRasterLayer(l.name, ed.page.width, ed.page.height),
    opacity: l.opacity, blend: l.blend, effects: l.effects, mask: l.mask, maskEnabled: l.maskEnabled, visible: l.visible,
  };
  r.id = l.id;
  r.surface.setFromCanvas(canvas);
  ed.transact('Rasterize layer', () => { f.siblings.splice(f.index, 1, r); }, { pages: [ed.page.id] });
}

// -------- masks --------
export function addMask(ed: Editor, id?: string, from: 'reveal' | 'hide' | 'selection' | 'hide-selection' = 'reveal') {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || f.layer.mask) return;
  const pg = ed.page;
  const m = new RasterSurface(pg.width, pg.height);
  const c = m.canvas, ctx = m.ctx;
  const sel = ed.selection;
  if (from === 'reveal') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, pg.width, pg.height); }
  else if (from === 'hide') { /* empty = hidden */ }
  else {
    const mc = sel.maskCanvas();
    if (from === 'selection') { if (mc) ctx.drawImage(mc, 0, 0); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, pg.width, pg.height); } }
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, pg.width, pg.height); if (mc) { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mc, 0, 0); } }
  }
  void c;
  ed.transact('Add layer mask', () => { f.layer.mask = m; f.layer.maskEnabled = true; }, { pages: [pg.id] });
  ed.setActiveLayer(f.layer.id, true);
}
export function deleteMask(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || !f.layer.mask) return;
  ed.transact('Delete layer mask', () => { f.layer.mask = null; }, { pages: [ed.page.id] });
  ed.editingMask = false; ed.changed('layers');
}
export function applyMask(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || !f.layer.mask || f.layer.type !== 'raster') return;
  const l = f.layer;
  ed.transact('Apply layer mask', () => {
    const ctx = l.surface.ctx;
    ctx.save(); ctx.globalCompositeOperation = 'destination-in';
    if (l.mask!.peek()) ctx.drawImage(l.mask!.canvas, 0, 0); else ctx.clearRect(0, 0, l.surface.width, l.surface.height);
    ctx.restore();
    l.surface.touch();
    l.mask = null;
  }, { pages: [ed.page.id] });
  ed.editingMask = false;
}
export function invertMask(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || !f.layer.mask) return;
  const old = f.layer.mask;
  const n = new RasterSurface(old.width, old.height);
  const ctx = n.ctx;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, old.width, old.height);
  if (old.peek()) { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(old.canvas, 0, 0); }
  ed.transact('Invert mask', () => { f.layer.mask = n; }, { pages: [ed.page.id] });
}
export function toggleMask(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (f?.layer.mask) updateLayer(ed, f.layer.id, { maskEnabled: !f.layer.maskEnabled }, `mask:${f.layer.id}:${Date.now()}`);
}

// -------- misc --------
export function clearLayerPixels(ed: Editor, layer: RasterLayer, rect?: Rect) {
  const r = rect ?? { x: 0, y: 0, w: layer.surface.width, h: layer.surface.height };
  ed.mutateRaster('Clear', layer.id, 'layer', r, (s) => {
    const sel = ed.selection;
    const c = s.ctx;
    if (sel.isEmpty) c.clearRect(r.x, r.y, r.w, r.h);
    else { c.save(); c.globalCompositeOperation = 'destination-out'; c.drawImage(sel.maskCanvas()!, 0, 0); c.restore(); }
  });
}
export function fillLayerWith(ed: Editor, layer: RasterLayer, color: string) {
  const sel = ed.selection;
  const r = sel.bounds ?? { x: 0, y: 0, w: layer.surface.width, h: layer.surface.height };
  ed.mutateRaster('Fill', layer.id, 'layer', r, (s) => {
    const tmp = createCanvas(s.width, s.height), t = ctx2d(tmp);
    t.fillStyle = color; t.fillRect(r.x, r.y, r.w, r.h);
    if (!sel.isEmpty) { t.globalCompositeOperation = 'destination-in'; t.drawImage(sel.maskCanvas()!, 0, 0); }
    if (layer.alphaLock) { t.globalCompositeOperation = 'destination-in'; t.drawImage(s.canvas, 0, 0); }
    s.ctx.drawImage(tmp, 0, 0);
  });
}
/** Copy/cut the selected pixels of the active raster layer into a new layer */
export function layerFromSelection(ed: Editor, cut: boolean) {
  const l = ed.layer;
  if (!l || l.type !== 'raster' || ed.selection.isEmpty) return;
  const sel = ed.selection, mc = sel.maskCanvas()!;
  const c = createCanvas(l.surface.width, l.surface.height), ctx = ctx2d(c);
  if (l.surface.peek()) ctx.drawImage(l.surface.canvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mc, 0, 0);
  const nl = createRasterLayer(cut ? 'Cut layer' : 'Copied layer', ed.page.width, ed.page.height);
  nl.surface.setFromCanvas(c);
  if (cut) {
    const r = sel.bounds!;
    ed.mutateRaster('Cut', l.id, 'layer', r, (s) => { s.ctx.save(); s.ctx.globalCompositeOperation = 'destination-out'; s.ctx.drawImage(mc, 0, 0); s.ctx.restore(); });
  }
  ed.transact(cut ? 'Layer via cut' : 'Layer via copy', () => insertAbove(ed, nl, l), { pages: [ed.page.id] });
  ed.setActiveLayer(nl.id);
}
export function selectLayerPixels(ed: Editor, id?: string) {
  const f = findLayer(ed.page.layers, id ?? ed.activeLayerId ?? '');
  if (!f || f.layer.type !== 'raster' || !f.layer.surface.peek()) return;
  ed.editSelection('Select layer pixels', (s) => s.fromCanvasAlpha(f.layer.type === 'raster' ? f.layer.surface.canvas : createCanvas(1, 1), 'replace'));
}
export function setBlend(ed: Editor, id: string, blend: BlendMode) { updateLayer(ed, id, { blend }); }
export function collectLayers(ed: Editor): Layer[] { return allLayers(ed.page.layers); }
export type { GroupLayer, VectorLayer };
export { walkLayers };
