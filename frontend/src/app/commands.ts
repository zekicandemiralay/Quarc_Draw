// Command registry: single source of truth for menus, command palette and keyboard shortcuts.

import type { Editor } from '../editor/editor';
import { workspace } from './workspace';
import { prefs } from './store';
import { bus, openDialog, toast } from './bus';
import * as A from './actions';
import * as L from '../editor/layerOps';
import * as P from '../editor/pageOps';
import * as O from '../editor/objectOps';
import * as R from '../editor/rasterOps';
import { FILTERS } from '../filters/registry';
import { ADJUSTMENT_LABELS, AdjustmentKind, defaultAdjustment, EFFECT_LABELS } from '../core/model';
import { TOOL_CATALOG } from '../tools/catalog';
import type { TransformTool } from '../tools/moveTools';
import { isMac } from '../core/util';

export interface CmdCtx { ed: Editor | null }
export interface Command {
  id: string;
  label: string;
  category: string;
  keys?: string;
  run: (c: CmdCtx) => unknown;
  enabled?: (c: CmdCtx) => boolean;
  checked?: (c: CmdCtx) => boolean;
  /** hide from command palette */
  hidden?: boolean;
}

const has = (c: CmdCtx) => !!c.ed;
const hasSel = (c: CmdCtx) => !!c.ed?.hasSelection;
const hasLayer = (c: CmdCtx) => !!c.ed?.layer;
const rasterLayer = (c: CmdCtx) => c.ed?.layer?.type === 'raster';
const objSel = (c: CmdCtx) => !!c.ed?.objSel.length;

const prompt = (title: string, fields: any[], ok: (v: Record<string, any>) => void, okLabel?: string) => openDialog('prompt', { title, fields, ok, okLabel });
const C = (id: string, label: string, category: string, run: Command['run'], extra: Partial<Command> = {}): Command => ({ id, label, category, run, enabled: extra.enabled ?? undefined, ...extra });

export const commands: Command[] = [];
const reg = (...cs: Command[]) => { commands.push(...cs); };

// ---------------------------------------------------------------- File
reg(
  C('file.new', 'New…', 'File', () => openDialog('new'), { keys: 'Ctrl+N' }),
  C('file.open', 'Open…', 'File', () => A.openFileDialog(), { keys: 'Ctrl+O' }),
  C('file.library', 'Documents Library', 'File', () => bus.emit('toggle-panel', { id: 'library' }), { keys: 'Ctrl+Shift+O' }),
  C('file.save', 'Save to library', 'File', ({ ed }) => ed && A.saveToLibrary(ed), { keys: 'Ctrl+S', enabled: has }),
  C('file.saveas', 'Save a copy as .qdraw…', 'File', ({ ed }) => ed && A.saveAsFile(ed), { keys: 'Ctrl+Shift+S', enabled: has }),
  C('file.export', 'Export…', 'File', () => openDialog('export'), { keys: 'Ctrl+Shift+E', enabled: has }),
  C('file.export.quick', 'Quick export PNG', 'File', async ({ ed }) => { if (!ed) return; const { exportDocument, defaultExportOptions } = await import('../io/exporters'); const { downloadBlob } = await import('../core/util'); const r = await exportDocument(ed, defaultExportOptions()); downloadBlob(r.blob, r.name); toast(`Exported ${r.name}`, 'success'); }, { keys: 'Ctrl+Alt+Shift+S', enabled: has, hidden: false }),
  C('file.place', 'Place image…', 'File', () => bus.emit('pick-image', {}), { enabled: has }),
  C('file.print', 'Print…', 'File', async ({ ed }) => { if (!ed) return; const { printDocument } = await import('../io/print'); await printDocument(ed); }, { keys: 'Ctrl+P', enabled: has }),
  C('file.info', 'Document properties…', 'File', () => openDialog('doc-info'), { enabled: has }),
  C('file.rename', 'Rename document…', 'File', () => openDialog('rename'), { enabled: has }),
  C('file.close', 'Close', 'File', async ({ ed }) => { if (ed) await workspace.close(ed); }, { keys: 'Ctrl+W', enabled: has }),
  C('file.sync', 'Sync now', 'File', async () => { const { syncEngine } = await import('../sync/engine'); await syncEngine.syncAll(true); }),
  C('file.sync.settings', 'Sync settings…', 'File', () => openDialog('sync')),
);

// ---------------------------------------------------------------- Edit
reg(
  C('edit.undo', 'Undo', 'Edit', ({ ed }) => ed?.undo(), { keys: 'Ctrl+Z', enabled: (c) => !!c.ed?.history.canUndo }),
  C('edit.redo', 'Redo', 'Edit', ({ ed }) => ed?.redo(), { keys: 'Ctrl+Shift+Z', enabled: (c) => !!c.ed?.history.canRedo }),
  C('edit.redo2', 'Redo (alt)', 'Edit', ({ ed }) => ed?.redo(), { keys: 'Ctrl+Y', hidden: true }),
  C('edit.cut', 'Cut', 'Edit', ({ ed }) => ed && R.copyToClipboard(ed, true), { keys: 'Ctrl+X', enabled: has }),
  C('edit.copy', 'Copy', 'Edit', ({ ed }) => ed && R.copyToClipboard(ed, false), { keys: 'Ctrl+C', enabled: has }),
  C('edit.paste', 'Paste', 'Edit', async ({ ed }) => { if (!ed) return; if (!R.pasteInternal(ed)) await pasteFromSystem(ed); }, { keys: 'Ctrl+V', enabled: has }),
  C('edit.pasteinplace', 'Paste in place', 'Edit', ({ ed }) => ed && R.pasteInternal(ed, true), { keys: 'Ctrl+Shift+V', enabled: has }),
  C('edit.delete', 'Delete / Clear', 'Edit', ({ ed }) => { if (!ed) return; if (ed.objSel.length && ed.layer?.type === 'vector') O.deleteObjects(ed); else R.eraseSelection(ed); }, { keys: 'Delete', enabled: has }),
  C('edit.delete2', 'Delete (Backspace)', 'Edit', ({ ed }) => { if (!ed) return; if (ed.objSel.length && ed.layer?.type === 'vector') O.deleteObjects(ed); else R.eraseSelection(ed); }, { keys: 'Backspace', hidden: true }),
  C('edit.fill.fg', 'Fill with foreground', 'Edit', ({ ed }) => ed && R.fillSelection(ed, ed.fg), { keys: 'Alt+Backspace', enabled: has }),
  C('edit.fill.bg', 'Fill with background', 'Edit', ({ ed }) => ed && R.fillSelection(ed, ed.bg), { keys: 'Ctrl+Backspace', enabled: has }),
  C('edit.fill.pattern', 'Fill with pattern', 'Edit', ({ ed }) => ed && R.fillSelection(ed, ed.fg, 'pattern', ed.opts.fillPattern), { enabled: has }),
  C('edit.stroke', 'Stroke selection…', 'Edit', ({ ed }) => ed && prompt('Stroke selection', [{ key: 'width', label: 'Width (px)', min: 1, max: 200, value: 3 }, { key: 'pos', label: 'Position', type: 'select', value: 'center', options: [{ value: 'inside', label: 'Inside' }, { value: 'center', label: 'Center' }, { value: 'outside', label: 'Outside' }] }], (v) => R.strokeSelection(ed, ed.fg, v.width, v.pos)), { enabled: hasSel }),
  C('edit.duplicate', 'Duplicate', 'Edit', ({ ed }) => { if (!ed) return; if (ed.objSel.length) O.duplicateObjects(ed); else L.duplicateLayer(ed); }, { keys: 'Ctrl+J', enabled: has }),
  C('edit.transform', 'Free transform', 'Edit', ({ ed }) => ed?.setTool('transform'), { keys: 'Ctrl+T', enabled: has }),
  C('edit.prefs', 'Preferences…', 'Edit', () => openDialog('prefs'), { keys: 'Ctrl+,' }),
  C('edit.palette', 'Command palette…', 'Edit', () => bus.emit('command-palette', undefined), { keys: 'Ctrl+K' }),
);

async function pasteFromSystem(ed: Editor) {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (type) { const blob = await it.getType(type); await R.placeImageBlob(ed, blob, 'Pasted image'); return; }
    }
    const text = await navigator.clipboard.readText();
    if (text.trim()) {
      const { createTextObject } = await import('../editor/textUtil');
      createTextObject(ed, text);
    }
  } catch { toast('Nothing to paste (or clipboard access was denied)', 'info'); }
}

// ---------------------------------------------------------------- Image
reg(
  C('image.size', 'Image size…', 'Image', () => openDialog('image-size'), { keys: 'Ctrl+Alt+I', enabled: has }),
  C('image.canvas', 'Canvas size…', 'Image', () => openDialog('canvas-size'), { keys: 'Ctrl+Alt+C', enabled: has }),
  C('image.rotate90', 'Rotate 90° clockwise', 'Image', ({ ed }) => ed && P.rotatePage(ed, ed.page, 90), { enabled: has }),
  C('image.rotate270', 'Rotate 90° counter-clockwise', 'Image', ({ ed }) => ed && P.rotatePage(ed, ed.page, 270), { enabled: has }),
  C('image.rotate180', 'Rotate 180°', 'Image', ({ ed }) => ed && P.rotatePage(ed, ed.page, 180), { enabled: has }),
  C('image.flipH', 'Flip canvas horizontal', 'Image', ({ ed }) => ed && P.flipPage(ed, ed.page, true), { enabled: has }),
  C('image.flipV', 'Flip canvas vertical', 'Image', ({ ed }) => ed && P.flipPage(ed, ed.page, false), { enabled: has }),
  C('image.crop', 'Crop to selection', 'Image', ({ ed }) => { if (ed && ed.selection.bounds) { P.cropPage(ed, ed.page, ed.selection.bounds); ed.deselect(); } }, { enabled: hasSel }),
  C('image.trim', 'Trim transparent edges', 'Image', ({ ed }) => ed && P.trimToContent(ed, ed.page), { enabled: has }),
  C('image.bg', 'Page background…', 'Image', () => openDialog('page-setup'), { enabled: has }),
);
const ADJ: AdjustmentKind[] = ['brightness-contrast', 'hue-saturation', 'levels', 'curves', 'exposure', 'vibrance', 'color-balance', 'photo-filter', 'gradient-map', 'threshold', 'posterize'];
for (const k of ADJ) reg(C(`adjust.${k}`, `${ADJUSTMENT_LABELS[k]}…`, 'Adjustments', () => openDialog('adjust', { kind: k }), { enabled: rasterLayer, keys: k === 'levels' ? 'Ctrl+L' : k === 'curves' ? 'Ctrl+M' : k === 'hue-saturation' ? 'Ctrl+U' : undefined }));
reg(
  C('adjust.invert', 'Invert', 'Adjustments', ({ ed }) => ed && R.applyAdjustmentDestructive(ed, { kind: 'invert' }, 'Invert'), { keys: 'Ctrl+I', enabled: rasterLayer }),
  C('adjust.grayscale', 'Desaturate (Black & White)', 'Adjustments', ({ ed }) => ed && R.applyAdjustmentDestructive(ed, { kind: 'grayscale' }, 'Black & white'), { keys: 'Ctrl+Shift+U', enabled: rasterLayer }),
  C('adjust.sepia', 'Sepia', 'Adjustments', ({ ed }) => ed && R.applyAdjustmentDestructive(ed, { kind: 'sepia' }, 'Sepia'), { enabled: rasterLayer }),
);

// ---------------------------------------------------------------- Layer
reg(
  C('layer.new', 'New pixel layer', 'Layer', ({ ed }) => ed && L.addLayer(ed, 'raster'), { keys: 'Ctrl+Shift+N', enabled: has }),
  C('layer.newvector', 'New vector layer', 'Layer', ({ ed }) => ed && L.addLayer(ed, 'vector'), { enabled: has }),
  C('layer.newgroup', 'New group', 'Layer', ({ ed }) => ed && L.addLayer(ed, 'group'), { enabled: has }),
  C('layer.group', 'Group layer', 'Layer', ({ ed }) => ed?.activeLayerId && L.groupLayers(ed, [ed.activeLayerId]), { enabled: hasLayer }),
  C('layer.ungroup', 'Ungroup layer', 'Layer', ({ ed }) => ed?.activeLayerId && L.ungroupLayer(ed, ed.activeLayerId), { enabled: (c) => c.ed?.layer?.type === 'group' }),
  C('layer.duplicate', 'Duplicate layer', 'Layer', ({ ed }) => ed && L.duplicateLayer(ed), { enabled: hasLayer }),
  C('layer.delete', 'Delete layer', 'Layer', ({ ed }) => ed && L.deleteLayer(ed), { enabled: hasLayer }),
  C('layer.mergedown', 'Merge down', 'Layer', ({ ed }) => ed && L.mergeDown(ed), { keys: 'Ctrl+E', enabled: hasLayer }),
  C('layer.mergevisible', 'Merge visible', 'Layer', ({ ed }) => ed && L.mergeVisible(ed), { keys: 'Ctrl+Shift+Alt+E', enabled: has }),
  C('layer.flatten', 'Flatten image', 'Layer', ({ ed }) => ed && L.flattenPage(ed), { enabled: has }),
  C('layer.rasterize', 'Rasterize layer', 'Layer', ({ ed }) => ed && L.rasterizeLayer(ed), { enabled: (c) => !!c.ed?.layer && c.ed.layer.type !== 'raster' }),
  C('layer.up', 'Bring forward', 'Layer', ({ ed }) => ed?.activeLayerId && L.moveLayer(ed, ed.activeLayerId, 'up'), { keys: 'Ctrl+]', enabled: hasLayer }),
  C('layer.down', 'Send backward', 'Layer', ({ ed }) => ed?.activeLayerId && L.moveLayer(ed, ed.activeLayerId, 'down'), { keys: 'Ctrl+[', enabled: hasLayer }),
  C('layer.top', 'Bring to front', 'Layer', ({ ed }) => ed?.activeLayerId && L.moveLayer(ed, ed.activeLayerId, 'top'), { keys: 'Ctrl+Shift+]', enabled: hasLayer }),
  C('layer.bottom', 'Send to back', 'Layer', ({ ed }) => ed?.activeLayerId && L.moveLayer(ed, ed.activeLayerId, 'bottom'), { keys: 'Ctrl+Shift+[', enabled: hasLayer }),
  C('layer.clip', 'Toggle clipping mask', 'Layer', ({ ed }) => { const l = ed?.layer; if (ed && l) L.updateLayer(ed, l.id, { clip: !l.clip }); }, { keys: 'Ctrl+Alt+G', enabled: hasLayer, checked: (c) => !!c.ed?.layer?.clip }),
  C('layer.lock', 'Lock layer', 'Layer', ({ ed }) => { const l = ed?.layer; if (ed && l) L.updateLayer(ed, l.id, { locked: !l.locked }); }, { enabled: hasLayer, checked: (c) => !!c.ed?.layer?.locked }),
  C('layer.alphalock', 'Lock transparent pixels', 'Layer', ({ ed }) => { const l = ed?.layer; if (ed && l) L.updateLayer(ed, l.id, { alphaLock: !l.alphaLock }); }, { enabled: rasterLayer, checked: (c) => !!c.ed?.layer?.alphaLock }),
  C('layer.hide', 'Toggle layer visibility', 'Layer', ({ ed }) => ed?.activeLayerId && L.toggleVisible(ed, ed.activeLayerId), { enabled: hasLayer, hidden: true }),
  C('layer.mask.add', 'Add layer mask (reveal all)', 'Layer', ({ ed }) => ed && L.addMask(ed, undefined, 'reveal'), { enabled: (c) => !!c.ed?.layer && !c.ed.layer.mask }),
  C('layer.mask.hide', 'Add layer mask (hide all)', 'Layer', ({ ed }) => ed && L.addMask(ed, undefined, 'hide'), { enabled: (c) => !!c.ed?.layer && !c.ed.layer.mask }),
  C('layer.mask.sel', 'Mask from selection', 'Layer', ({ ed }) => ed && L.addMask(ed, undefined, 'selection'), { enabled: (c) => !!c.ed?.layer && !c.ed.layer.mask && !!c.ed.hasSelection }),
  C('layer.mask.delete', 'Delete layer mask', 'Layer', ({ ed }) => ed && L.deleteMask(ed), { enabled: (c) => !!c.ed?.layer?.mask }),
  C('layer.mask.apply', 'Apply layer mask', 'Layer', ({ ed }) => ed && L.applyMask(ed), { enabled: (c) => !!c.ed?.layer?.mask && c.ed.layer.type === 'raster' }),
  C('layer.mask.invert', 'Invert layer mask', 'Layer', ({ ed }) => ed && L.invertMask(ed), { enabled: (c) => !!c.ed?.layer?.mask }),
  C('layer.mask.toggle', 'Enable / disable mask', 'Layer', ({ ed }) => ed && L.toggleMask(ed), { enabled: (c) => !!c.ed?.layer?.mask }),
  C('layer.effects', 'Layer effects…', 'Layer', () => openDialog('effects'), { enabled: hasLayer }),
  C('layer.viasel', 'Layer via copy', 'Layer', ({ ed }) => ed && L.layerFromSelection(ed, false), { keys: 'Ctrl+Alt+J', enabled: (c) => rasterLayer(c) && hasSel(c) }),
  C('layer.viacut', 'Layer via cut', 'Layer', ({ ed }) => ed && L.layerFromSelection(ed, true), { keys: 'Ctrl+Shift+J', enabled: (c) => rasterLayer(c) && hasSel(c) }),
  C('layer.selectpixels', 'Select layer pixels', 'Layer', ({ ed }) => ed && L.selectLayerPixels(ed), { enabled: rasterLayer }),
);
for (const k of ['brightness-contrast', 'hue-saturation', 'levels', 'curves', 'exposure', 'vibrance', 'color-balance', 'photo-filter', 'gradient-map', 'invert', 'grayscale', 'sepia', 'threshold', 'posterize'] as AdjustmentKind[])
  reg(C(`layer.adj.${k}`, `Adjustment layer: ${ADJUSTMENT_LABELS[k]}`, 'Layer', ({ ed }) => ed && L.addAdjustmentLayer(ed, defaultAdjustment(k)), { enabled: has }));
for (const k of Object.keys(EFFECT_LABELS)) void k;

// ---------------------------------------------------------------- Select
reg(
  C('select.all', 'Select all', 'Select', ({ ed }) => ed?.selectAll(), { keys: 'Ctrl+A', enabled: has }),
  C('select.none', 'Deselect', 'Select', ({ ed }) => { ed?.deselect(); if (ed) { ed.objSel = []; ed.changed('objsel'); } }, { keys: 'Ctrl+D', enabled: has }),
  C('select.invert', 'Invert selection', 'Select', ({ ed }) => ed?.invertSelection(), { keys: 'Ctrl+Shift+I', enabled: has }),
  C('select.feather', 'Feather…', 'Select', ({ ed }) => ed && prompt('Feather selection', [{ key: 'r', label: 'Radius (px)', min: 1, max: 250, value: 8 }], (v) => ed.editSelection('Feather', (s) => s.feather(v.r))), { keys: 'Shift+F6', enabled: hasSel }),
  C('select.grow', 'Grow…', 'Select', ({ ed }) => ed && prompt('Grow selection', [{ key: 'r', label: 'By (px)', min: 1, max: 100, value: 4 }], (v) => ed.editSelection('Grow', (s) => s.grow(v.r))), { enabled: hasSel }),
  C('select.shrink', 'Shrink…', 'Select', ({ ed }) => ed && prompt('Shrink selection', [{ key: 'r', label: 'By (px)', min: 1, max: 100, value: 4 }], (v) => ed.editSelection('Shrink', (s) => s.shrink(v.r))), { enabled: hasSel }),
  C('select.smooth', 'Smooth…', 'Select', ({ ed }) => ed && prompt('Smooth selection', [{ key: 'r', label: 'Radius (px)', min: 1, max: 50, value: 4 }], (v) => ed.editSelection('Smooth', (s) => s.smooth(v.r))), { enabled: hasSel }),
  C('select.border', 'Border…', 'Select', ({ ed }) => ed && prompt('Border selection', [{ key: 'r', label: 'Width (px)', min: 1, max: 100, value: 6 }], (v) => ed.editSelection('Border', (s) => s.border(v.r))), { enabled: hasSel }),
  C('select.fromlayer', 'Select layer pixels', 'Select', ({ ed }) => ed && L.selectLayerPixels(ed), { enabled: rasterLayer }),
  C('select.objects', 'Select all objects', 'Select', ({ ed }) => { if (!ed) return; ed.objSel = O.allObjects(ed.page).filter((x) => !x.obj.locked && !x.obj.hidden).map((x) => x.obj.id); ed.changed('objsel'); }, { enabled: has }),
);

// ---------------------------------------------------------------- Filter
for (const f of FILTERS) reg(C(`filter.${f.id}`, f.label, `Filter ▸ ${f.category}`, () => openDialog('filter', { id: f.id }), { enabled: rasterLayer }));

// ---------------------------------------------------------------- Object (vector)
reg(
  C('object.group', 'Group (objects or layers)', 'Object', ({ ed }) => { if (!ed) return; if (ed.objSel.length > 1) O.groupObjects(ed); else if (ed.activeLayerId) L.groupLayers(ed, [ed.activeLayerId]); }, { keys: 'Ctrl+G', enabled: has }),
  C('object.ungroup', 'Ungroup (objects or layers)', 'Object', ({ ed }) => { if (!ed) return; if (ed.objSel.length) O.ungroupObjects(ed); else if (ed.layer?.type === 'group') L.ungroupLayer(ed, ed.layer.id); }, { keys: 'Ctrl+Shift+G', enabled: has }),
  C('object.front', 'Bring to front', 'Object', ({ ed }) => ed && O.reorderObjects(ed, ed.objSel, 'front'), { enabled: objSel }),
  C('object.forward', 'Bring forward', 'Object', ({ ed }) => ed && O.reorderObjects(ed, ed.objSel, 'forward'), { enabled: objSel }),
  C('object.backward', 'Send backward', 'Object', ({ ed }) => ed && O.reorderObjects(ed, ed.objSel, 'backward'), { enabled: objSel }),
  C('object.back', 'Send to back', 'Object', ({ ed }) => ed && O.reorderObjects(ed, ed.objSel, 'back'), { enabled: objSel }),
  C('object.flipH', 'Flip horizontal', 'Object', ({ ed }) => ed && O.flipObjects(ed, true), { enabled: objSel }),
  C('object.flipV', 'Flip vertical', 'Object', ({ ed }) => ed && O.flipObjects(ed, false), { enabled: objSel }),
  C('object.topath', 'Convert to path', 'Object', ({ ed }) => ed && O.convertToPath(ed), { keys: 'Ctrl+Alt+O', enabled: objSel }),
  C('object.unite', 'Union', 'Object', ({ ed }) => ed && O.booleanOperation(ed, 'unite'), { enabled: (c) => (c.ed?.objSel.length ?? 0) > 1 }),
  C('object.subtract', 'Subtract', 'Object', ({ ed }) => ed && O.booleanOperation(ed, 'subtract'), { enabled: (c) => (c.ed?.objSel.length ?? 0) > 1 }),
  C('object.intersect', 'Intersect', 'Object', ({ ed }) => ed && O.booleanOperation(ed, 'intersect'), { enabled: (c) => (c.ed?.objSel.length ?? 0) > 1 }),
  C('object.exclude', 'Exclude overlap', 'Object', ({ ed }) => ed && O.booleanOperation(ed, 'exclude'), { enabled: (c) => (c.ed?.objSel.length ?? 0) > 1 }),
  C('object.lock', 'Lock / unlock object', 'Object', ({ ed }) => ed && O.updateSelected(ed, (o) => ({ ...o, locked: !o.locked }), 'Lock object'), { enabled: objSel }),
  C('object.hide', 'Hide object', 'Object', ({ ed }) => ed && O.updateSelected(ed, (o) => ({ ...o, hidden: !o.hidden }), 'Hide object'), { enabled: objSel }),
);
for (const [k, label] of [['left', 'Align left'], ['hcenter', 'Align horizontal centers'], ['right', 'Align right'], ['top', 'Align top'], ['vcenter', 'Align vertical centers'], ['bottom', 'Align bottom']] as const)
  reg(C(`object.align.${k}`, label, 'Object ▸ Align', ({ ed }) => ed && O.alignObjects(ed, k), { enabled: objSel }));
reg(
  C('object.dist.h', 'Distribute horizontally', 'Object ▸ Align', ({ ed }) => ed && O.distributeObjects(ed, 'h'), { enabled: (c) => (c.ed?.objSel.length ?? 0) > 2 }),
  C('object.dist.v', 'Distribute vertically', 'Object ▸ Align', ({ ed }) => ed && O.distributeObjects(ed, 'v'), { enabled: (c) => (c.ed?.objSel.length ?? 0) > 2 }),
);

// ---------------------------------------------------------------- Page
reg(
  C('page.add', 'Add page', 'Page', ({ ed }) => ed && P.addPage(ed), { keys: 'Ctrl+Alt+N', enabled: has }),
  C('page.duplicate', 'Duplicate page', 'Page', ({ ed }) => ed && P.duplicatePage(ed), { enabled: has }),
  C('page.delete', 'Delete page', 'Page', ({ ed }) => ed && P.deletePage(ed), { enabled: (c) => (c.ed?.doc.pages.length ?? 0) > 1 }),
  C('page.next', 'Next page', 'Page', ({ ed }) => ed?.goToPage(ed.pageIndex + 1), { keys: 'PageDown', enabled: has }),
  C('page.prev', 'Previous page', 'Page', ({ ed }) => ed?.goToPage(ed.pageIndex - 1), { keys: 'PageUp', enabled: has }),
  C('page.first', 'First page', 'Page', ({ ed }) => ed?.goToPage(0), { keys: 'Home', enabled: has, hidden: true }),
  C('page.last', 'Last page', 'Page', ({ ed }) => ed?.goToPage((ed?.doc.pages.length ?? 1) - 1), { keys: 'End', enabled: has, hidden: true }),
  C('page.setup', 'Page background…', 'Page', () => openDialog('page-setup'), { enabled: has }),
  C('page.goto', 'Go to page…', 'Page', ({ ed }) => ed && prompt('Go to page', [{ key: 'n', label: `Page (1–${ed.doc.pages.length})`, min: 1, max: ed.doc.pages.length, value: ed.pageIndex + 1 }], (v) => ed.goToPage(v.n - 1)), { keys: 'Ctrl+Shift+P', enabled: has }),
);
for (const [mode, label] of [['single', 'Single page'], ['vertical', 'Continuous (vertical)'], ['horizontal', 'Horizontal strip'], ['spread', 'Two-page spread'], ['grid', 'Grid overview'], ['free', 'Free canvas (artboards)']] as const)
  reg(C(`view.layout.${mode}`, label, 'View ▸ Layout', ({ ed }) => ed?.setLayoutMode(mode), { enabled: has, checked: (c) => c.ed?.doc.layout === mode }));

// ---------------------------------------------------------------- View
reg(
  C('view.zoomin', 'Zoom in', 'View', ({ ed }) => ed?.zoomBy(1.25), { keys: 'Ctrl+=', enabled: has }),
  C('view.zoomin2', 'Zoom in (+)', 'View', ({ ed }) => ed?.zoomBy(1.25), { keys: 'Ctrl++', hidden: true }),
  C('view.zoomout', 'Zoom out', 'View', ({ ed }) => ed?.zoomBy(1 / 1.25), { keys: 'Ctrl+-', enabled: has }),
  C('view.fit', 'Fit page on screen', 'View', ({ ed }) => ed?.fitPage(), { keys: 'Ctrl+0', enabled: has }),
  C('view.fitwidth', 'Fit width', 'View', ({ ed }) => ed?.fitWidth(), { keys: 'Ctrl+Alt+0', enabled: has }),
  C('view.fitall', 'Show all pages', 'View', ({ ed }) => ed?.fitAll(), { enabled: has }),
  C('view.100', 'Actual size (100%)', 'View', ({ ed }) => ed?.zoomTo(1), { keys: 'Ctrl+1', enabled: has }),
  C('view.200', 'Zoom 200%', 'View', ({ ed }) => ed?.zoomTo(2), { keys: 'Ctrl+2', enabled: has }),
  C('view.rotatereset', 'Reset view rotation', 'View', ({ ed }) => { ed?.view.resetRotation(); ed?.changed('view'); }, { enabled: has }),
  C('view.rotate90', 'Rotate view 90°', 'View', ({ ed }) => { if (ed) { ed.view.rotateAt({ x: ed.view.width / 2, y: ed.view.height / 2 }, ed.view.rotation + Math.PI / 2); ed.changed('view'); } }, { enabled: has }),
  C('view.flip', 'Flip view horizontally', 'View', ({ ed }) => { if (ed) { ed.view.flipX = !ed.view.flipX; ed.changed('view'); } }, { enabled: has, checked: (c) => !!c.ed?.view.flipX }),
  C('view.rulers', 'Rulers', 'View', () => prefs.set((p) => ({ showRulers: !p.showRulers })), { keys: 'Ctrl+R', checked: () => prefs.get().showRulers }),
  C('view.grid', 'Grid', 'View', ({ ed }) => { if (ed) { ed.doc.grid = { ...ed.doc.grid, show: !ed.doc.grid.show }; ed.changed('doc', 'view'); } }, { keys: "Ctrl+'", enabled: has, checked: (c) => !!c.ed?.doc.grid.show }),
  C('view.snapgrid', 'Snap to grid', 'View', ({ ed }) => { if (ed) { ed.doc.grid = { ...ed.doc.grid, snap: !ed.doc.grid.snap }; ed.changed('doc'); } }, { enabled: has, checked: (c) => !!c.ed?.doc.grid.snap }),
  C('view.gridsettings', 'Grid settings…', 'View', ({ ed }) => ed && prompt('Grid', [{ key: 'size', label: 'Grid size (px)', min: 2, max: 1000, value: ed.doc.grid.size }, { key: 'sub', label: 'Subdivisions', min: 1, max: 16, value: ed.doc.grid.subdivisions }, { key: 'kind', label: 'Type', type: 'select', value: ed.doc.grid.kind, options: [{ value: 'square', label: 'Square' }, { value: 'isometric', label: 'Isometric' }] }], (v) => { ed.doc.grid = { ...ed.doc.grid, size: v.size, subdivisions: v.sub, kind: v.kind, show: true }; ed.changed('doc', 'view'); }), { enabled: has }),
  C('view.snapguides', 'Snap to guides / objects', 'View', ({ ed }) => ed?.setToolOpts({ snapGuides: !ed.opts.snapGuides, snapObjects: !ed.opts.snapObjects }), { enabled: has, checked: (c) => !!c.ed?.opts.snapGuides }),
  C('view.clearguides', 'Clear guides', 'View', ({ ed }) => { if (ed) ed.transact('Clear guides', () => { ed.page.guides = []; }); }, { enabled: has }),
  C('view.symmetry', 'Symmetry drawing', 'View', ({ ed }) => { if (ed) { ed.doc.symmetry = { ...ed.doc.symmetry, enabled: !ed.doc.symmetry.enabled }; ed.changed('doc', 'view'); } }, { enabled: has, checked: (c) => !!c.ed?.doc.symmetry.enabled }),
  C('view.symmetry.settings', 'Symmetry settings…', 'View', ({ ed }) => ed && prompt('Symmetry', [{ key: 'mode', label: 'Mode', type: 'select', value: ed.doc.symmetry.mode, options: [{ value: 'vertical', label: 'Vertical axis' }, { value: 'horizontal', label: 'Horizontal axis' }, { value: 'both', label: 'Quadrant' }, { value: 'radial', label: 'Radial' }] }, { key: 'axes', label: 'Radial axes', min: 2, max: 24, value: ed.doc.symmetry.axes }], (v) => { ed.doc.symmetry = { ...ed.doc.symmetry, enabled: true, mode: v.mode, axes: v.axes }; ed.changed('doc', 'view'); }), { enabled: has }),
  C('view.perspective', 'Perspective guides', 'View', ({ ed }) => { if (!ed) return; const p = ed.doc.perspective; ed.doc.perspective = { ...p, enabled: !p.enabled, points: p.points.length ? p.points : perspectivePoints(ed, 2, 0.45) }; ed.changed('doc', 'view'); }, { enabled: has, checked: (c) => !!c.ed?.doc.perspective.enabled }),
  C('view.perspective.settings', 'Perspective settings…', 'View', ({ ed }) => ed && prompt('Perspective guides', [{ key: 'n', label: 'Vanishing points (1–3)', min: 1, max: 3, value: Math.max(1, ed.doc.perspective.points.length || 2) }, { key: 'h', label: 'Horizon height (%)', min: 0, max: 100, value: 45 }], (v) => { ed.doc.perspective = { ...ed.doc.perspective, enabled: true, points: perspectivePoints(ed, Math.round(v.n), v.h / 100) }; ed.changed('doc', 'view'); }), { enabled: has }),
  C('view.checker', 'Transparency checkerboard', 'View', () => prefs.set((p) => ({ checker: !p.checker })), { checked: () => prefs.get().checker }),
  C('view.fullscreen', 'Full screen', 'View', () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }, { keys: 'F11' }),
  C('view.focus', 'Focus mode (hide panels)', 'View', () => { const p = prefs.get(); const hide = p.rightDock || p.leftSidebar; prefs.set({ rightDock: !hide, leftSidebar: !hide }); }, { keys: 'Tab' }),
);

// ---------------------------------------------------------------- Window
reg(
  C('theme.dark', 'Theme: Dark', 'Window', () => prefs.set({ theme: 'dark' }), { checked: () => prefs.get().theme === 'dark' }),
  C('theme.light', 'Theme: Light', 'Window', () => prefs.set({ theme: 'light' }), { checked: () => prefs.get().theme === 'light' }),
  C('theme.midnight', 'Theme: Midnight', 'Window', () => prefs.set({ theme: 'midnight' }), { checked: () => prefs.get().theme === 'midnight' }),
  C('penonly', 'Pen-only drawing (touch pans)', 'Window', () => prefs.set((p) => ({ penOnly: !p.penOnly })), { checked: () => prefs.get().penOnly }),
  C('panel.layers', 'Panel: Layers', 'Window', () => bus.emit('toggle-panel', { id: 'layers' })),
  C('panel.color', 'Panel: Color', 'Window', () => bus.emit('toggle-panel', { id: 'color' })),
  C('panel.brushes', 'Panel: Brushes', 'Window', () => bus.emit('toggle-panel', { id: 'brushes' })),
  C('panel.history', 'Panel: History', 'Window', () => bus.emit('toggle-panel', { id: 'history' })),
  C('panel.navigator', 'Panel: Navigator', 'Window', () => bus.emit('toggle-panel', { id: 'navigator' })),
  C('panel.pages', 'Panel: Pages', 'Window', () => bus.emit('toggle-panel', { id: 'pages' })),
  C('panel.assets', 'Panel: Libraries & assets', 'Window', () => bus.emit('toggle-panel', { id: 'assets' })),
);

// ---------------------------------------------------------------- Help
reg(
  C('help.shortcuts', 'Keyboard shortcuts', 'Help', () => openDialog('shortcuts'), { keys: 'F1' }),
  C('help.tutorial', 'Welcome tour', 'Help', () => openDialog('tutorial')),
  C('help.about', 'About Quarc Draw', 'Help', () => openDialog('about')),
);

// ---------------------------------------------------------------- Tools (select by id)
for (const t of TOOL_CATALOG) reg(C(`tool.${t.id}`, `Tool: ${t.name}`, 'Tools', ({ ed }) => ed?.setTool(t.id), { checked: (c) => c.ed?.toolId === t.id, enabled: has }));
reg(
  C('tool.swap', 'Swap foreground / background', 'Color', ({ ed }) => ed?.swapColors(), { keys: 'X' }),
  C('tool.defaultcolors', 'Default colors', 'Color', ({ ed }) => ed?.resetColors(), { keys: 'D' }),
  C('brush.bigger', 'Brush size +', 'Brush', ({ ed }) => ed && bumpSize(ed, 1), { keys: ']' }),
  C('brush.smaller', 'Brush size −', 'Brush', ({ ed }) => ed && bumpSize(ed, -1), { keys: '[' }),
  C('brush.harder', 'Brush hardness +', 'Brush', ({ ed }) => ed?.setBrush({ hardness: Math.min(1, ed.brush.hardness + 0.1) }), { keys: 'Shift+]' }),
  C('brush.softer', 'Brush hardness −', 'Brush', ({ ed }) => ed?.setBrush({ hardness: Math.max(0, ed.brush.hardness - 0.1) }), { keys: 'Shift+[' }),
  C('transform.apply', 'Apply transform', 'Edit', ({ ed }) => { const t = ed?.getTool('transform') as TransformTool | undefined; t?.commit(); }, { hidden: true }),
);
/** vanishing points for 1-, 2- and 3-point perspective on the active page (page coordinates) */
function perspectivePoints(ed: Editor, n: number, horizon: number) {
  const w = ed.page.width, h = ed.page.height, y = h * horizon;
  if (n <= 1) return [{ x: w / 2, y }];
  const pts = [{ x: -w * 0.35, y }, { x: w * 1.35, y }];
  if (n >= 3) pts.push({ x: w / 2, y: h * 2.2 });
  return pts;
}
function bumpSize(ed: Editor, dir: number) {
  const s = ed.brush.size, n = Math.max(1, Math.round(s * (dir > 0 ? 1.12 : 1 / 1.12) + dir));
  ed.setBrush({ size: Math.min(1500, n) });
}

// ---------------------------------------------------------------- lookup + keys
export const getCommand = (id: string) => commands.find((c) => c.id === id);
export function runCommand(id: string, ed: Editor | null = workspace.active) {
  const c = getCommand(id);
  if (!c) return;
  if (c.enabled && !c.enabled({ ed })) return;
  try { const r = c.run({ ed }); if (r instanceof Promise) r.catch((e) => { console.error(e); toast(String(e?.message ?? e), 'error'); }); }
  catch (e: any) { console.error(e); toast(String(e?.message ?? e), 'error'); }
}

export function keysFor(id: string): string | undefined {
  return prefs.get().customShortcuts[id] ?? getCommand(id)?.keys;
}
export function formatKeys(k?: string): string {
  if (!k) return '';
  return k.split('+').map((p) => (isMac ? ({ Ctrl: '⌘', Alt: '⌥', Shift: '⇧' } as Record<string, string>)[p] ?? p : p)).join(isMac ? '' : '+');
}
export function eventToKeys(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let k = e.key;
  if (k === ' ') k = 'Space';
  if (k.length === 1) k = k.toUpperCase();
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
  // shifted symbols arrive as the symbol itself – drop the Shift flag for them
  if (e.shiftKey && k.length === 1 && !/[A-Z0-9]/.test(k)) parts.splice(parts.indexOf('Shift'), 1);
  parts.push(k);
  return parts.join('+');
}
let keyMap: Map<string, string> | null = null;
let keyMapVersion = '';
export function commandForKeys(spec: string): Command | undefined {
  const ver = JSON.stringify(prefs.get().customShortcuts);
  if (!keyMap || keyMapVersion !== ver) {
    keyMap = new Map(); keyMapVersion = ver;
    for (const c of commands) { const k = keysFor(c.id); if (k) keyMap.set(k.toLowerCase(), c.id); }
  }
  const id = keyMap.get(spec.toLowerCase());
  return id ? getCommand(id) : undefined;
}
