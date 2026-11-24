// Tool base class and shared option types.

import type { Vec } from '../core/geometry';
import type { Page, FontSpec, Paint, StrokeStyle, InkKind } from '../core/model';
import type { SelectMode } from '../core/selection';
import type { GradientStop } from '../core/color';
import type { Editor } from '../editor/editor';
import { INK_DEFAULTS } from '../core/vector';

export interface ToolPointer {
  /** world coordinates */
  world: Vec;
  /** page-local coordinates for `page` (even outside the page bounds while a gesture is captured) */
  local: Vec;
  page: Page | null;
  screen: Vec;
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: string;
  shift: boolean; alt: boolean; ctrl: boolean; meta: boolean; space: boolean;
  button: number;
  buttons: number;
  time: number;
  detail: number; // click count
}

export interface OverlayCtx {
  ctx: CanvasRenderingContext2D;
  /** world→screen (CSS px) */
  toScreen: (p: Vec) => Vec;
  /** page-local → screen (CSS px) for the given page */
  localToScreen: (page: Page, p: Vec) => Vec;
  /** matrix mapping page-local → screen (CSS px) */
  pageMatrix: (page: Page) => import('../core/geometry').Mat;
  zoom: number;
  page: Page | null;
  time: number;
}

export abstract class Tool {
  abstract readonly id: string;
  abstract readonly name: string;
  cursor = 'crosshair';
  constructor(protected ed: Editor) {}
  activate(): void {}
  deactivate(): void {}
  pointerDown(_e: ToolPointer): void {}
  pointerMove(_e: ToolPointer): void {}
  pointerUp(_e: ToolPointer): void {}
  hover(_e: ToolPointer): void {}
  keyDown(_e: KeyboardEvent): boolean { return false; }
  keyUp(_e: KeyboardEvent): void {}
  drawOverlay(_o: OverlayCtx): void {}
  /** finish any in-progress work (text edit, pen path…) – called on tool switch / Enter */
  commit(): void {}
  cancel(): void {}
  /** true when this tool wants continuous redraw (animated overlay) */
  get animated(): boolean { return false; }
}

export interface ToolOptions {
  // selection tools
  selectMode: SelectMode;
  feather: number;
  tolerance: number;
  contiguous: boolean;
  sampleMerged: boolean;
  marqueeStyle: 'free' | 'square' | 'fixed';
  marqueeW: number; marqueeH: number;
  selectBrushSize: number;
  // move
  autoSelect: boolean;
  // fill / gradient
  fillTolerance: number; fillContiguous: boolean; fillExpand: number; fillSampleMerged: boolean; fillMode: 'color' | 'pattern';
  fillPattern: string;
  gradientKind: 'linear' | 'radial' | 'angle' | 'reflected' | 'diamond';
  gradientStops: GradientStop[]; gradientReverse: boolean; gradientUseFgBg: boolean;
  // shapes
  shapeFill: Paint | null; shapeStroke: StrokeStyle | null; cornerRadius: number; polygonSides: number; starInner: number; shapeFromCenter: boolean;
  // text
  font: FontSpec; textAlign: 'left' | 'center' | 'right'; lineHeight: number; letterSpacing: number; textUnderline: boolean; textStrike: boolean;
  // ink (vector pen)
  inkKind: InkKind; inkSize: number; inkSmoothing: number; inkOpacity: number; inkShapeSnap: boolean; inkPressure: boolean;
  inkPrefs: Record<string, { size: number; opacity: number }>;
  // eraser (stroke)
  strokeEraserSize: number; strokeEraserMode: 'stroke' | 'pixel';
  // eyedropper
  sampleSize: number; sampleLayerOnly: boolean;
  // pen/node
  penAutoClose: boolean; pathSmoothing: number;
  // crop
  cropRatio: 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | 'a4' | 'original';
  // snapping
  snapGrid: boolean; snapGuides: boolean; snapObjects: boolean;
  // quick shape (hold at end of stroke)
  quickShape: boolean;
  // note color
  noteColor: string;
  // markup
  markupColor: string; markupKind: 'highlight' | 'underline' | 'strike' | 'squiggle';
  // laser
  laserColor: string;
  // brush
  brushSizeScale: number;
}

export const defaultToolOptions = (): ToolOptions => ({
  selectMode: 'replace', feather: 0, tolerance: 32, contiguous: true, sampleMerged: false, marqueeStyle: 'free', marqueeW: 256, marqueeH: 256, selectBrushSize: 40,
  autoSelect: true,
  fillTolerance: 24, fillContiguous: true, fillExpand: 1, fillSampleMerged: false, fillMode: 'color', fillPattern: 'hatch',
  gradientKind: 'linear', gradientStops: [{ pos: 0, color: '#1abc9c' }, { pos: 1, color: '#2c3e9b' }], gradientReverse: false, gradientUseFgBg: true,
  shapeFill: { kind: 'solid', color: '#1abc9c' }, shapeStroke: { color: '#0b3d36', width: 3, cap: 'round', join: 'round', dash: [] },
  cornerRadius: 0, polygonSides: 5, starInner: 0.5, shapeFromCenter: false,
  font: { family: 'Segoe UI', size: 48, weight: 400, italic: false }, textAlign: 'left', lineHeight: 1.25, letterSpacing: 0, textUnderline: false, textStrike: false,
  inkKind: 'pen', inkSize: 4, inkSmoothing: 0.55, inkOpacity: 1, inkShapeSnap: true, inkPressure: true,
  inkPrefs: Object.fromEntries(Object.entries(INK_DEFAULTS).map(([k, v]) => [k, { size: v.size, opacity: v.opacity }])),
  strokeEraserSize: 24, strokeEraserMode: 'stroke',
  sampleSize: 1, sampleLayerOnly: false,
  penAutoClose: true, pathSmoothing: 0.5,
  cropRatio: 'free',
  snapGrid: true, snapGuides: true, snapObjects: true,
  quickShape: true,
  noteColor: '#ffe066',
  markupColor: '#ffe14d', markupKind: 'highlight',
  laserColor: '#ff2d55',
  brushSizeScale: 1,
});
