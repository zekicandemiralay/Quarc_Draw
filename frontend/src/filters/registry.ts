// Filter registry: each filter declares its parameters so the UI can build a live-preview dialog automatically.

import * as P from './pixels';
import type { Pix } from './pixels';

export type ParamValue = number | boolean | string;
export interface ParamDef {
  key: string; label: string;
  type: 'range' | 'select' | 'bool' | 'color';
  min?: number; max?: number; step?: number; default: ParamValue;
  options?: { value: string; label: string }[];
  /** value is in document pixels – multiplied by preview scale when previewing on a downsized copy */
  px?: boolean;
}
export type FilterCategory = 'Blur' | 'Sharpen' | 'Noise' | 'Stylize' | 'Distort' | 'Color';
export interface FilterDef {
  id: string; label: string; category: FilterCategory; params: ParamDef[];
  apply(pix: Pix, v: Record<string, any>): Pix;
}
const range = (key: string, label: string, min: number, max: number, def: number, step = 1, px = false): ParamDef => ({ key, label, type: 'range', min, max, step, default: def, px });

export const FILTERS: FilterDef[] = [
  { id: 'gaussian-blur', label: 'Gaussian Blur…', category: 'Blur', params: [range('radius', 'Radius', 0.1, 100, 8, 0.1, true)], apply: (p, v) => P.gaussianBlur(p, v.radius) },
  { id: 'box-blur', label: 'Box Blur…', category: 'Blur', params: [range('radius', 'Radius', 1, 60, 6, 1, true)], apply: (p, v) => P.boxBlur(p, v.radius) },
  { id: 'motion-blur', label: 'Motion Blur…', category: 'Blur', params: [range('angle', 'Angle', -180, 180, 0), range('distance', 'Distance', 2, 120, 24, 1, true)], apply: (p, v) => P.motionBlur(p, v.angle, v.distance) },
  { id: 'zoom-blur', label: 'Zoom Blur…', category: 'Blur', params: [range('amount', 'Amount', 1, 100, 30)], apply: (p, v) => P.radialBlur(p, 'zoom', v.amount, p.width / 2, p.height / 2) },
  { id: 'spin-blur', label: 'Spin Blur…', category: 'Blur', params: [range('amount', 'Amount', 1, 100, 30)], apply: (p, v) => P.radialBlur(p, 'spin', v.amount, p.width / 2, p.height / 2) },
  { id: 'unsharp', label: 'Unsharp Mask…', category: 'Sharpen', params: [range('amount', 'Amount %', 1, 500, 120), range('radius', 'Radius', 0.3, 40, 2, 0.1, true), range('threshold', 'Threshold', 0, 64, 0)], apply: (p, v) => P.unsharpMask(p, v.amount, v.radius, v.threshold) },
  { id: 'sharpen', label: 'Sharpen', category: 'Sharpen', params: [range('strength', 'Strength', 0.1, 3, 1, 0.1)], apply: (p, v) => P.sharpen3(p, v.strength) },
  { id: 'add-noise', label: 'Add Noise…', category: 'Noise', params: [range('amount', 'Amount %', 1, 100, 12), { key: 'mono', label: 'Monochromatic', type: 'bool', default: false }], apply: (p, v) => P.addNoise(p, v.amount, !!v.mono, 7) },
  { id: 'median', label: 'Median (Despeckle)…', category: 'Noise', params: [range('radius', 'Radius', 1, 4, 1, 1)], apply: (p, v) => P.median(p, v.radius) },
  { id: 'emboss', label: 'Emboss…', category: 'Stylize', params: [range('angle', 'Angle', -180, 180, 135), range('depth', 'Depth', 0.2, 4, 1, 0.1)], apply: (p, v) => P.emboss(p, v.angle, v.depth) },
  { id: 'find-edges', label: 'Find Edges', category: 'Stylize', params: [{ key: 'invert', label: 'Dark lines on white', type: 'bool', default: true }], apply: (p, v) => P.findEdges(p, !!v.invert) },
  { id: 'pixelate', label: 'Pixelate (Mosaic)…', category: 'Stylize', params: [range('size', 'Cell size', 2, 120, 12, 1, true)], apply: (p, v) => P.pixelate(p, v.size) },
  { id: 'halftone', label: 'Halftone…', category: 'Stylize', params: [range('cell', 'Dot size', 3, 40, 10, 1, true), range('angle', 'Angle', 0, 90, 45), { key: 'color', label: 'Colour dots', type: 'bool', default: false }], apply: (p, v) => P.halftone(p, v.cell, v.angle, !!v.color) },
  { id: 'oil', label: 'Oil Paint…', category: 'Stylize', params: [range('radius', 'Brush size', 1, 8, 3, 1, true)], apply: (p, v) => P.oilPaint(p, v.radius) },
  { id: 'glow', label: 'Glow…', category: 'Stylize', params: [range('threshold', 'Threshold', 0, 255, 180), range('radius', 'Radius', 1, 80, 14, 1, true), range('intensity', 'Intensity', 1, 300, 100)], apply: (p, v) => P.glow(p, v.threshold, v.radius, v.intensity) },
  { id: 'vignette', label: 'Vignette…', category: 'Stylize', params: [range('amount', 'Amount', 0, 100, 60), range('size', 'Size', 0, 100, 40), range('feather', 'Feather', 1, 100, 60)], apply: (p, v) => P.vignette(p, v.amount, v.size, v.feather) },
  { id: 'chromatic', label: 'Chromatic Aberration…', category: 'Stylize', params: [range('amount', 'Offset', 1, 30, 4, 1, true)], apply: (p, v) => P.chromaticAberration(p, v.amount) },
  { id: 'twirl', label: 'Twirl…', category: 'Distort', params: [range('angle', 'Angle', -720, 720, 120), range('radius', 'Radius %', 5, 100, 100)], apply: (p, v) => P.twirl(p, v.angle, v.radius) },
  { id: 'spherize', label: 'Spherize / Pinch…', category: 'Distort', params: [range('amount', 'Amount', -100, 100, 50)], apply: (p, v) => P.spherize(p, v.amount) },
  { id: 'ripple', label: 'Ripple…', category: 'Distort', params: [range('amplitude', 'Amplitude', 1, 60, 8, 1, true), range('wavelength', 'Wavelength', 8, 400, 60, 1, true)], apply: (p, v) => P.ripple(p, v.amplitude, v.wavelength) },
  { id: 'wave', label: 'Wave…', category: 'Distort', params: [range('amplitude', 'Amplitude', 1, 100, 14, 1, true), range('wavelength', 'Wavelength', 8, 600, 120, 1, true), { key: 'vertical', label: 'Horizontal displacement', type: 'bool', default: false }], apply: (p, v) => P.wave(p, v.amplitude, v.wavelength, !!v.vertical) },
];
export const FILTER_CATEGORIES: FilterCategory[] = ['Blur', 'Sharpen', 'Noise', 'Stylize', 'Distort', 'Color'];
export const getFilter = (id: string) => FILTERS.find((f) => f.id === id);

export const defaultsFor = (f: FilterDef): Record<string, ParamValue> => Object.fromEntries(f.params.map((p) => [p.key, p.default]));
export function scaleParams(f: FilterDef, v: Record<string, ParamValue>, scale: number): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = { ...v };
  for (const p of f.params) if (p.px && typeof out[p.key] === 'number') out[p.key] = Math.max(p.min ?? 0, (out[p.key] as number) * scale);
  return out;
}
