// Document model: Document → Pages → Layers → (pixels | vector objects).
// Everything except RasterSurface / Blob assets is plain JSON-serialisable data.
// Vector objects are treated as immutable: modify by replacing the object (cheap history snapshots).

import type { Mat, Rect } from './geometry';
import { IDENTITY } from './geometry';
import type { GradientStop } from './color';
import { RasterSurface } from './raster';
import { uid } from './util';

// ---------------- Blend modes ----------------
export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity' | 'add';

export const BLEND_MODES: { id: BlendMode; label: string; group: string }[] = [
  { id: 'normal', label: 'Normal', group: 'Basic' },
  { id: 'darken', label: 'Darken', group: 'Darken' },
  { id: 'multiply', label: 'Multiply', group: 'Darken' },
  { id: 'color-burn', label: 'Color Burn', group: 'Darken' },
  { id: 'lighten', label: 'Lighten', group: 'Lighten' },
  { id: 'screen', label: 'Screen', group: 'Lighten' },
  { id: 'color-dodge', label: 'Color Dodge', group: 'Lighten' },
  { id: 'add', label: 'Add (Linear Dodge)', group: 'Lighten' },
  { id: 'overlay', label: 'Overlay', group: 'Contrast' },
  { id: 'soft-light', label: 'Soft Light', group: 'Contrast' },
  { id: 'hard-light', label: 'Hard Light', group: 'Contrast' },
  { id: 'difference', label: 'Difference', group: 'Inversion' },
  { id: 'exclusion', label: 'Exclusion', group: 'Inversion' },
  { id: 'hue', label: 'Hue', group: 'Component' },
  { id: 'saturation', label: 'Saturation', group: 'Component' },
  { id: 'color', label: 'Color', group: 'Component' },
  { id: 'luminosity', label: 'Luminosity', group: 'Component' },
];
export const blendToComposite = (b: BlendMode | undefined): GlobalCompositeOperation =>
  !b || b === 'normal' ? 'source-over' : b === 'add' ? 'lighter' : (b as GlobalCompositeOperation);

// ---------------- Paint / stroke ----------------
export type Paint =
  | { kind: 'solid'; color: string }
  | { kind: 'linear'; stops: GradientStop[]; x1: number; y1: number; x2: number; y2: number } // bbox-relative 0..1
  | { kind: 'radial'; stops: GradientStop[]; cx: number; cy: number; r: number }
  | { kind: 'pattern'; pattern: string; scale: number; color?: string };

export interface StrokeStyle {
  color: string;
  width: number;
  cap: 'butt' | 'round' | 'square';
  join: 'miter' | 'round' | 'bevel';
  dash: number[];
  align?: 'center' | 'inside' | 'outside';
}
export const solid = (color: string): Paint => ({ kind: 'solid', color });
export const defaultStroke = (color = '#000000', width = 2): StrokeStyle => ({ color, width, cap: 'round', join: 'round', dash: [] });

// ---------------- Vector objects ----------------
export interface PathNode { x: number; y: number; ix: number; iy: number; ox: number; oy: number }
export interface SubPath { nodes: PathNode[]; closed: boolean }
export interface ShadowInfo { color: string; blur: number; x: number; y: number }

interface VBase {
  id: string;
  name?: string;
  tf: Mat;
  fill: Paint | null;
  stroke: StrokeStyle | null;
  opacity: number;
  blend?: BlendMode;
  hidden?: boolean;
  locked?: boolean;
  shadow?: ShadowInfo;
}
export interface VPath extends VBase { type: 'path'; paths: SubPath[]; fillRule: 'nonzero' | 'evenodd' }
export interface VRect extends VBase { type: 'rect'; x: number; y: number; w: number; h: number; rx: number }
export interface VEllipse extends VBase { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
export interface VPolygon extends VBase { type: 'polygon'; cx: number; cy: number; r: number; sides: number; rot: number; inner: number }
export interface VLine extends VBase { type: 'line'; x1: number; y1: number; x2: number; y2: number; arrowStart: boolean; arrowEnd: boolean }
export interface FontSpec { family: string; size: number; weight: number; italic: boolean }
export interface VText extends VBase {
  type: 'text'; x: number; y: number; text: string; font: FontSpec; align: 'left' | 'center' | 'right';
  lineHeight: number; letterSpacing: number; boxW: number | null; underline: boolean; strike: boolean;
}
export interface VImage extends VBase { type: 'image'; assetId: string; x: number; y: number; w: number; h: number }
export interface VGroup extends VBase { type: 'group'; children: VObject[] }

export type VObject = VPath | VRect | VEllipse | VPolygon | VLine | VText | VImage | VGroup;
export type VObjectType = VObject['type'];

export const baseObject = (): Omit<VBase, 'id'> => ({ tf: IDENTITY, fill: solid('#000000'), stroke: null, opacity: 1 });

// ---------------- Adjustments (non-destructive) ----------------
export type Adjustment =
  | { kind: 'brightness-contrast'; brightness: number; contrast: number }
  | { kind: 'hue-saturation'; hue: number; saturation: number; lightness: number }
  | { kind: 'levels'; inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }
  | { kind: 'curves'; points: [number, number][] }
  | { kind: 'exposure'; exposure: number; offset: number; gamma: number }
  | { kind: 'vibrance'; vibrance: number; saturation: number }
  | { kind: 'color-balance'; shadows: [number, number, number]; midtones: [number, number, number]; highlights: [number, number, number] }
  | { kind: 'photo-filter'; color: string; density: number }
  | { kind: 'gradient-map'; stops: GradientStop[] }
  | { kind: 'invert' } | { kind: 'grayscale' } | { kind: 'sepia' }
  | { kind: 'threshold'; level: number }
  | { kind: 'posterize'; levels: number };
export type AdjustmentKind = Adjustment['kind'];

export const defaultAdjustment = (kind: AdjustmentKind): Adjustment => {
  switch (kind) {
    case 'brightness-contrast': return { kind, brightness: 0, contrast: 0 };
    case 'hue-saturation': return { kind, hue: 0, saturation: 0, lightness: 0 };
    case 'levels': return { kind, inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    case 'curves': return { kind, points: [[0, 0], [255, 255]] };
    case 'exposure': return { kind, exposure: 0, offset: 0, gamma: 1 };
    case 'vibrance': return { kind, vibrance: 0, saturation: 0 };
    case 'color-balance': return { kind, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0] };
    case 'photo-filter': return { kind, color: '#ec8a00', density: 25 };
    case 'gradient-map': return { kind, stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] };
    case 'threshold': return { kind, level: 128 };
    case 'posterize': return { kind, levels: 4 };
    default: return { kind } as Adjustment;
  }
};
export const ADJUSTMENT_LABELS: Record<AdjustmentKind, string> = {
  'brightness-contrast': 'Brightness / Contrast', 'hue-saturation': 'Hue / Saturation', levels: 'Levels', curves: 'Curves',
  exposure: 'Exposure', vibrance: 'Vibrance', 'color-balance': 'Color Balance', 'photo-filter': 'Photo Filter',
  'gradient-map': 'Gradient Map', invert: 'Invert', grayscale: 'Black & White', sepia: 'Sepia', threshold: 'Threshold', posterize: 'Posterize',
};

// ---------------- Layer effects ----------------
export type LayerEffect =
  | { id: string; kind: 'drop-shadow'; enabled: boolean; color: string; opacity: number; x: number; y: number; blur: number; spread: number }
  | { id: string; kind: 'inner-shadow'; enabled: boolean; color: string; opacity: number; x: number; y: number; blur: number }
  | { id: string; kind: 'outer-glow'; enabled: boolean; color: string; opacity: number; blur: number; spread: number }
  | { id: string; kind: 'stroke'; enabled: boolean; color: string; opacity: number; width: number; position: 'outside' | 'inside' | 'center' }
  | { id: string; kind: 'color-overlay'; enabled: boolean; color: string; opacity: number; blend: BlendMode };
export type EffectKind = LayerEffect['kind'];
export const EFFECT_LABELS: Record<EffectKind, string> = {
  'drop-shadow': 'Drop Shadow', 'inner-shadow': 'Inner Shadow', 'outer-glow': 'Outer Glow', stroke: 'Stroke', 'color-overlay': 'Color Overlay',
};
export function defaultEffect(kind: EffectKind): LayerEffect {
  const id = uid('fx');
  switch (kind) {
    case 'drop-shadow': return { id, kind, enabled: true, color: '#000000', opacity: 0.5, x: 6, y: 6, blur: 8, spread: 0 };
    case 'inner-shadow': return { id, kind, enabled: true, color: '#000000', opacity: 0.5, x: 3, y: 3, blur: 6 };
    case 'outer-glow': return { id, kind, enabled: true, color: '#ffe066', opacity: 0.75, blur: 14, spread: 2 };
    case 'stroke': return { id, kind, enabled: true, color: '#000000', opacity: 1, width: 3, position: 'outside' };
    case 'color-overlay': return { id, kind, enabled: true, color: '#ff4d6d', opacity: 1, blend: 'normal' };
  }
}

// ---------------- Layers ----------------
interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  clip: boolean; // clipping mask → clips to the layer beneath
  alphaLock: boolean;
  effects: LayerEffect[];
  mask: RasterSurface | null;
  maskEnabled: boolean;
  tag?: string; // color label
  reference?: boolean;
}
export interface RasterLayer extends LayerBase { type: 'raster'; surface: RasterSurface }
export interface VectorLayer extends LayerBase { type: 'vector'; objects: VObject[] }
export interface GroupLayer extends LayerBase { type: 'group'; children: Layer[]; expanded: boolean; passThrough: boolean }
export interface AdjustmentLayer extends LayerBase { type: 'adjustment'; adj: Adjustment }
export type Layer = RasterLayer | VectorLayer | GroupLayer | AdjustmentLayer;
export type LayerType = Layer['type'];

const layerBase = (name: string): LayerBase => ({
  id: uid('ly'), name, visible: true, locked: false, opacity: 1, blend: 'normal', clip: false, alphaLock: false,
  effects: [], mask: null, maskEnabled: true,
});
export const createRasterLayer = (name: string, w: number, h: number): RasterLayer => ({ ...layerBase(name), type: 'raster', surface: new RasterSurface(w, h) });
export const createVectorLayer = (name = 'Vector'): VectorLayer => ({ ...layerBase(name), type: 'vector', objects: [] });
export const createGroupLayer = (name = 'Group', children: Layer[] = []): GroupLayer => ({ ...layerBase(name), type: 'group', children, expanded: true, passThrough: true });
export const createAdjustmentLayer = (adj: Adjustment): AdjustmentLayer => ({ ...layerBase(ADJUSTMENT_LABELS[adj.kind]), type: 'adjustment', adj });

// ---------------- Page ----------------
export interface PageBackground {
  color: string | null; // null = transparent
  image?: { assetId: string; fit: 'cover' | 'contain' | 'stretch' } | null;
}
export interface Guide { id: string; axis: 'h' | 'v'; pos: number }
export interface Page {
  id: string;
  name: string;
  width: number;
  height: number;
  x: number; // free-layout world position
  y: number;
  background: PageBackground;
  layers: Layer[];
  guides: Guide[];
}
export const createPage = (w: number, h: number, name = 'Page', bg: Partial<PageBackground> = {}): Page => ({
  id: uid('pg'), name, width: w, height: h, x: 0, y: 0,
  background: { color: '#ffffff', image: null, ...bg },
  layers: [], guides: [],
});

// ---------------- Document ----------------
export type PageLayout = 'single' | 'vertical' | 'horizontal' | 'spread' | 'grid' | 'free';
export type Units = 'px' | 'in' | 'cm' | 'mm' | 'pt';
export interface AssetRecord { id: string; name: string; mime: string; kind: 'image' | 'font' | 'other'; blob: Blob }
export interface SymmetrySettings { enabled: boolean; mode: 'vertical' | 'horizontal' | 'both' | 'radial'; axes: number; cx: number; cy: number }
export interface GridSettings { show: boolean; snap: boolean; size: number; subdivisions: number; kind: 'square' | 'isometric' }
export interface PerspectiveSettings { enabled: boolean; points: { x: number; y: number }[]; snap: boolean }
export interface QDocument {
  id: string;
  title: string;
  created: number;
  modified: number;
  dpi: number;
  units: Units;
  pages: Page[];
  layout: PageLayout;
  assets: Map<string, AssetRecord>;
  tags: string[];
  folder: string | null;
  starred: boolean;
  grid: GridSettings;
  symmetry: SymmetrySettings;
  perspective: PerspectiveSettings;
  author: string;
}
export const createDocument = (title = 'Untitled'): QDocument => ({
  id: uid('doc'), title, created: Date.now(), modified: Date.now(), dpi: 96, units: 'px',
  pages: [], layout: 'single', assets: new Map(), tags: [], folder: null, starred: false,
  grid: { show: false, snap: false, size: 64, subdivisions: 4, kind: 'square' },
  symmetry: { enabled: false, mode: 'vertical', axes: 6, cx: 0, cy: 0 },
  perspective: { enabled: false, points: [], snap: true },
  author: '',
});

// ---------------- Traversal helpers ----------------
export function walkLayers(layers: Layer[], fn: (l: Layer, parent: GroupLayer | null, index: number, siblings: Layer[]) => void | boolean, parent: GroupLayer | null = null): boolean {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (fn(l, parent, i, layers) === false) return false;
    if (l.type === 'group' && walkLayers(l.children, fn, l) === false) return false;
  }
  return true;
}
export function findLayer(layers: Layer[], id: string): { layer: Layer; parent: GroupLayer | null; index: number; siblings: Layer[] } | null {
  let found: ReturnType<typeof findLayer> = null;
  walkLayers(layers, (l, parent, index, siblings) => {
    if (l.id === id) { found = { layer: l, parent, index, siblings }; return false; }
  });
  return found;
}
export function allLayers(layers: Layer[]): Layer[] {
  const out: Layer[] = [];
  walkLayers(layers, (l) => { out.push(l); });
  return out;
}
export const isRaster = (l: Layer | null | undefined): l is RasterLayer => !!l && l.type === 'raster';
export const isVector = (l: Layer | null | undefined): l is VectorLayer => !!l && l.type === 'vector';
export const isGroup = (l: Layer | null | undefined): l is GroupLayer => !!l && l.type === 'group';

export function findPage(doc: QDocument, id: string): Page | undefined { return doc.pages.find((p) => p.id === id); }
export const pageRect = (p: Page): Rect => ({ x: 0, y: 0, w: p.width, h: p.height });

/** Walk every vector object (including inside groups) on a page. */
export function walkObjects(page: Page, fn: (o: VObject, layer: VectorLayer) => void | boolean) {
  walkLayers(page.layers, (l) => {
    if (l.type !== 'vector') return;
    const rec = (objs: VObject[]): boolean => {
      for (const o of objs) {
        if (fn(o, l) === false) return false;
        if (o.type === 'group' && !rec(o.children)) return false;
      }
      return true;
    };
    return rec(l.objects) ? undefined : false;
  });
}
export function findObject(page: Page, id: string): { obj: VObject; layer: VectorLayer } | null {
  let res: { obj: VObject; layer: VectorLayer } | null = null;
  walkObjects(page, (o, l) => { if (o.id === id) { res = { obj: o, layer: l }; return false; } });
  return res;
}

// ---------------- Page size presets ----------------
export interface SizePreset { id: string; name: string; w: number; h: number; dpi?: number; group: string }
const mm = (v: number, dpi: number) => Math.round((v / 25.4) * dpi);
export const SIZE_PRESETS: SizePreset[] = [
  { id: 'hd', name: 'HD 1920 × 1080', w: 1920, h: 1080, group: 'Screen' },
  { id: '4k', name: '4K UHD 3840 × 2160', w: 3840, h: 2160, group: 'Screen' },
  { id: 'sq2k', name: 'Square 2048 × 2048', w: 2048, h: 2048, group: 'Screen' },
  { id: 'a4-150', name: 'A4 · 150 dpi', w: mm(210, 150), h: mm(297, 150), dpi: 150, group: 'Print' },
  { id: 'a4-300', name: 'A4 · 300 dpi', w: mm(210, 300), h: mm(297, 300), dpi: 300, group: 'Print' },
  { id: 'a3-300', name: 'A3 · 300 dpi', w: mm(297, 300), h: mm(420, 300), dpi: 300, group: 'Print' },
  { id: 'a5-300', name: 'A5 · 300 dpi', w: mm(148, 300), h: mm(210, 300), dpi: 300, group: 'Print' },
  { id: 'letter', name: 'US Letter · 150 dpi', w: 1275, h: 1650, dpi: 150, group: 'Print' },
  { id: 'poster', name: 'Poster 18×24 in · 150 dpi', w: 2700, h: 3600, dpi: 150, group: 'Print' },
  { id: 'ig-post', name: 'Instagram Post 1080 × 1350', w: 1080, h: 1350, group: 'Social' },
  { id: 'ig-story', name: 'Story / Reel 1080 × 1920', w: 1080, h: 1920, group: 'Social' },
  { id: 'yt-thumb', name: 'YouTube Thumbnail 1280 × 720', w: 1280, h: 720, group: 'Social' },
  { id: 'twitter', name: 'X / Twitter Header 1500 × 500', w: 1500, h: 500, group: 'Social' },
  { id: 'icon', name: 'App Icon 1024 × 1024', w: 1024, h: 1024, group: 'Design' },
  { id: 'favicon', name: 'Favicon 512 × 512', w: 512, h: 512, group: 'Design' },
  { id: 'banner', name: 'Web Banner 1200 × 628', w: 1200, h: 628, group: 'Design' },
  { id: 'comic', name: 'Comic Page 2063 × 3150', w: 2063, h: 3150, dpi: 300, group: 'Art' },
  { id: 'sketch', name: 'Sketchbook 3000 × 2000', w: 3000, h: 2000, group: 'Art' },
  { id: 'pixel', name: 'Pixel Art 128 × 128', w: 128, h: 128, group: 'Art' },
];

export const unitFactor = (u: Units, dpi: number): number => // px per 1 unit
  u === 'px' ? 1 : u === 'in' ? dpi : u === 'cm' ? dpi / 2.54 : u === 'mm' ? dpi / 25.4 : dpi / 72;
