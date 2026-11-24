// Built-in brush library. Users can tweak any preset and save their own (stored in preferences).

import { BrushSettings, DEFAULT_BRUSH } from './engine';

const B = (id: string, name: string, category: string, o: Partial<BrushSettings>): BrushSettings => ({ ...DEFAULT_BRUSH, id, name, category, ...o });

export const BRUSH_PRESETS: BrushSettings[] = [
  // ---- Pencil ----
  B('pencil-hb', 'HB Pencil', 'Pencil', { size: 5, hardness: 0.8, flow: 0.8, spacing: 0.07, grain: 'paper', grainDepth: 0.45, pressureSize: 0.35, pressureOpacity: 0.7, smoothing: 0.15 }),
  B('pencil-6b', '6B Soft Pencil', 'Pencil', { size: 12, hardness: 0.55, flow: 0.7, opacity: 0.9, grain: 'rough', grainDepth: 0.6, pressureSize: 0.5, pressureOpacity: 0.8, spacing: 0.06 }),
  B('pencil-mech', 'Mechanical Pencil', 'Pencil', { size: 2.5, hardness: 0.95, flow: 1, grain: 'paper', grainDepth: 0.15, pressureSize: 0.1, pressureOpacity: 0.3, spacing: 0.05, smoothing: 0.2 }),
  B('pencil-color', 'Colored Pencil', 'Pencil', { size: 9, hardness: 0.7, flow: 0.55, opacity: 0.95, grain: 'canvas', grainDepth: 0.7, pressureOpacity: 0.9, pressureSize: 0.2, spacing: 0.05 }),
  // ---- Ink ----
  B('ink-technical', 'Technical Pen', 'Ink', { size: 3, hardness: 1, flow: 1, grain: 'none', pressureSize: 0, pressureOpacity: 0, smoothing: 0.35, spacing: 0.05 }),
  B('ink-gel', 'Gel Pen', 'Ink', { size: 5, hardness: 1, flow: 1, grain: 'none', pressureSize: 0.45, minSize: 0.45, pressureOpacity: 0, smoothing: 0.4, spacing: 0.04 }),
  B('ink-brush', 'Brush Pen', 'Ink', { size: 18, hardness: 1, flow: 1, grain: 'none', pressureSize: 1, minSize: 0.08, pressureOpacity: 0, smoothing: 0.55, spacing: 0.04 }),
  B('ink-dip', 'Dip Pen (G-Pen)', 'Ink', { size: 10, hardness: 1, flow: 1, grain: 'none', pressureSize: 1, minSize: 0.15, pressureOpacity: 0, smoothing: 0.5, spacing: 0.04, roundness: 1 }),
  B('ink-calli', 'Calligraphy Nib', 'Ink', { size: 18, hardness: 1, flow: 1, roundness: 0.22, angle: 40, grain: 'none', pressureSize: 0.2, smoothing: 0.4, spacing: 0.04 }),
  B('ink-fineliner', 'Fineliner', 'Ink', { size: 2, hardness: 1, flow: 1, grain: 'none', pressureSize: 0, smoothing: 0.3, spacing: 0.05 }),
  // ---- Marker ----
  B('marker-felt', 'Felt Marker', 'Marker', { size: 16, hardness: 0.92, flow: 0.45, opacity: 0.9, grain: 'none', pressureSize: 0, pressureOpacity: 0, smoothing: 0.3, spacing: 0.06 }),
  B('marker-chisel', 'Chisel Marker', 'Marker', { size: 28, tip: 'square', hardness: 1, roundness: 0.35, angle: 45, flow: 0.5, opacity: 0.85, grain: 'none', pressureSize: 0, smoothing: 0.3, spacing: 0.05 }),
  B('marker-highlight', 'Highlighter', 'Marker', { size: 30, tip: 'square', hardness: 1, roundness: 0.5, angle: 0, flow: 1, opacity: 0.45, blend: 'multiply', grain: 'none', pressureSize: 0, pressureOpacity: 0, smoothing: 0.5, spacing: 0.04 }),
  B('marker-alcohol', 'Alcohol Marker', 'Marker', { size: 22, hardness: 0.85, flow: 0.35, opacity: 0.8, blend: 'multiply', grain: 'none', pressureSize: 0, smoothing: 0.35, spacing: 0.05 }),
  // ---- Paint ----
  B('paint-airbrush', 'Soft Airbrush', 'Paint', { size: 60, hardness: 0, flow: 0.12, spacing: 0.1, grain: 'none', pressureSize: 0.2, pressureOpacity: 0.8, smoothing: 0.25 }),
  B('paint-hard-air', 'Hard Airbrush', 'Paint', { size: 40, hardness: 0.75, flow: 0.25, spacing: 0.08, grain: 'none', pressureSize: 0.2, pressureOpacity: 0.7 }),
  B('paint-oil', 'Oil Bristle', 'Paint', { size: 36, tip: 'bristle', hardness: 1, flow: 0.9, followStroke: true, spacing: 0.1, wet: 0.7, grain: 'canvas', grainDepth: 0.25, pressureSize: 0.4, minSize: 0.5, pressureOpacity: 0.3, smoothing: 0.3, jitterAngle: 6 }),
  B('paint-acrylic', 'Acrylic Flat', 'Paint', { size: 40, tip: 'square', hardness: 1, roundness: 0.55, followStroke: true, flow: 0.95, spacing: 0.08, wet: 0.25, grain: 'canvas', grainDepth: 0.2, pressureSize: 0.35, smoothing: 0.35 }),
  B('paint-gouache', 'Gouache', 'Paint', { size: 30, hardness: 0.9, flow: 0.8, spacing: 0.06, grain: 'rough', grainDepth: 0.15, pressureSize: 0.35, pressureOpacity: 0.3, wet: 0.15, smoothing: 0.35 }),
  B('paint-water', 'Watercolor', 'Paint', { size: 48, hardness: 0.25, flow: 0.07, opacity: 0.85, spacing: 0.08, blend: 'multiply', grain: 'paper', grainDepth: 0.55, grainScale: 1.5, pressureSize: 0.3, pressureOpacity: 0.6, jitterOpacity: 0.3, smoothing: 0.5, wet: 0.2 }),
  B('paint-wash', 'Wet Wash', 'Paint', { size: 90, hardness: 0.1, flow: 0.05, opacity: 0.7, spacing: 0.1, blend: 'multiply', grain: 'rough', grainDepth: 0.4, pressureOpacity: 0.5, smoothing: 0.6 }),
  // ---- Charcoal & pastel ----
  B('char-charcoal', 'Charcoal', 'Charcoal & Chalk', { size: 22, tip: 'chalk', hardness: 0.55, flow: 0.75, spacing: 0.05, grain: 'rough', grainDepth: 0.75, pressureSize: 0.45, pressureOpacity: 0.7, jitterAngle: 180, smoothing: 0.2 }),
  B('char-pastel', 'Soft Pastel', 'Charcoal & Chalk', { size: 34, tip: 'chalk', hardness: 0.4, flow: 0.5, spacing: 0.06, grain: 'canvas', grainDepth: 0.7, pressureOpacity: 0.8, jitterAngle: 180, smoothing: 0.2 }),
  B('char-chalk', 'Chalk', 'Charcoal & Chalk', { size: 20, tip: 'chalk', hardness: 0.7, flow: 0.9, spacing: 0.05, grain: 'noise', grainDepth: 0.55, pressureSize: 0.2, jitterAngle: 180, smoothing: 0.15 }),
  B('char-crayon', 'Wax Crayon', 'Charcoal & Chalk', { size: 18, tip: 'chalk', hardness: 0.9, flow: 0.85, spacing: 0.05, grain: 'canvas', grainDepth: 0.65, pressureSize: 0.1, pressureOpacity: 0.4, jitterAngle: 180 }),
  // ---- Special ----
  B('fx-spray', 'Spray Paint', 'Special', { size: 70, tip: 'spray', hardness: 0.7, count: 14, flow: 0.55, spacing: 0.12, grain: 'none', pressureOpacity: 0.4, smoothing: 0.2 }),
  B('fx-splatter', 'Splatter', 'Special', { size: 30, tip: 'round', hardness: 0.95, scatter: 2.4, count: 5, jitterSize: 0.85, flow: 1, spacing: 0.9, grain: 'none', pressureSize: 0, smoothing: 0 }),
  B('fx-stipple', 'Stipple', 'Special', { size: 6, hardness: 0.95, scatter: 1.6, count: 3, jitterSize: 0.5, flow: 1, spacing: 0.7, grain: 'none', pressureSize: 0.3 }),
  B('fx-stars', 'Star Stamp', 'Special', { size: 28, tip: 'star', hardness: 1, flow: 1, spacing: 1.1, followStroke: false, jitterAngle: 180, jitterSize: 0.4, scatter: 0.4, grain: 'none', pressureSize: 0, smoothing: 0 }),
  B('fx-leaves', 'Leaf Scatter', 'Special', { size: 30, tip: 'leaf', hardness: 1, flow: 1, spacing: 0.9, jitterAngle: 180, jitterSize: 0.5, scatter: 1.0, count: 1, grain: 'none', pressureSize: 0, smoothing: 0 }),
  B('fx-glow', 'Glow Pen', 'Special', { size: 26, hardness: 0.2, flow: 0.2, spacing: 0.06, blend: 'screen', grain: 'none', pressureSize: 0.2, pressureOpacity: 0.4, smoothing: 0.35 }),
  // ---- Erasers ----
  B('erase-hard', 'Hard Eraser', 'Eraser', { mode: 'erase', size: 30, hardness: 1, flow: 1, grain: 'none', pressureSize: 0.2, pressureOpacity: 0, smoothing: 0.1, spacing: 0.05 }),
  B('erase-soft', 'Soft Eraser', 'Eraser', { mode: 'erase', size: 50, hardness: 0.2, flow: 0.6, grain: 'none', pressureOpacity: 0.5, pressureSize: 0.2, spacing: 0.08 }),
  B('erase-pencil', 'Pencil Eraser', 'Eraser', { mode: 'erase', size: 14, hardness: 0.85, flow: 0.9, grain: 'paper', grainDepth: 0.4, pressureSize: 0.2, spacing: 0.06 }),
  B('erase-chalk', 'Chalk Eraser', 'Eraser', { mode: 'erase', size: 36, tip: 'chalk', hardness: 0.6, flow: 0.8, grain: 'rough', grainDepth: 0.5, spacing: 0.06 }),
  // ---- Retouch tools ----
  B('tool-smudge', 'Smudge', 'Retouch', { mode: 'smudge', size: 40, hardness: 0.3, spacing: 0.1, strength: 0.7, grain: 'none', pressureSize: 0, pressureOpacity: 0.5, smoothing: 0.2 }),
  B('tool-blur', 'Blur', 'Retouch', { mode: 'blur', size: 50, hardness: 0.3, spacing: 0.15, strength: 0.7, grain: 'none', pressureSize: 0, pressureOpacity: 0.5 }),
  B('tool-sharpen', 'Sharpen', 'Retouch', { mode: 'sharpen', size: 40, hardness: 0.3, spacing: 0.15, strength: 0.5, grain: 'none', pressureSize: 0 }),
  B('tool-dodge', 'Dodge (Lighten)', 'Retouch', { mode: 'dodge', size: 60, hardness: 0.2, spacing: 0.12, strength: 0.5, range: 'midtones', grain: 'none', pressureSize: 0, pressureOpacity: 0.5 }),
  B('tool-burn', 'Burn (Darken)', 'Retouch', { mode: 'burn', size: 60, hardness: 0.2, spacing: 0.12, strength: 0.5, range: 'midtones', grain: 'none', pressureSize: 0, pressureOpacity: 0.5 }),
  B('tool-clone', 'Clone Stamp', 'Retouch', { mode: 'clone', size: 50, hardness: 0.5, spacing: 0.1, grain: 'none', pressureSize: 0, opacity: 1, flow: 1 }),
];
export const BRUSH_CATEGORIES = [...new Set(BRUSH_PRESETS.map((b) => b.category))];
export const getBrush = (id: string) => BRUSH_PRESETS.find((b) => b.id === id);
