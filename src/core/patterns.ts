// Procedural seamless patterns used for fills, textures and brush grain.

import { createCanvas, ctx2d } from './util';

export interface PatternDef { id: string; label: string; size: number; draw: (c: CanvasRenderingContext2D, s: number, color: string) => void }

const stroke = (c: CanvasRenderingContext2D, color: string, w = 1.5) => { c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'square'; };

export const PATTERNS: PatternDef[] = [
  { id: 'hatch', label: 'Diagonal Hatch', size: 12, draw: (c, s, col) => { stroke(c, col); c.beginPath(); c.moveTo(-1, s + 1); c.lineTo(s + 1, -1); c.moveTo(-1, 1); c.lineTo(1, -1); c.moveTo(s - 1, s + 1); c.lineTo(s + 1, s - 1); c.stroke(); } },
  { id: 'hatch-back', label: 'Back Hatch', size: 12, draw: (c, s, col) => { stroke(c, col); c.beginPath(); c.moveTo(-1, -1); c.lineTo(s + 1, s + 1); c.moveTo(-1, s - 1); c.lineTo(1, s + 1); c.moveTo(s - 1, -1); c.lineTo(s + 1, 1); c.stroke(); } },
  { id: 'crosshatch', label: 'Crosshatch', size: 12, draw: (c, s, col) => { PATTERNS[0].draw(c, s, col); PATTERNS[1].draw(c, s, col); } },
  { id: 'dots', label: 'Polka Dots', size: 16, draw: (c, s, col) => { c.fillStyle = col; c.beginPath(); c.arc(s / 2, s / 2, s * 0.18, 0, Math.PI * 2); c.fill(); } },
  { id: 'dots-fine', label: 'Fine Dots', size: 8, draw: (c, s, col) => { c.fillStyle = col; c.beginPath(); c.arc(s / 2, s / 2, s * 0.14, 0, Math.PI * 2); c.fill(); } },
  { id: 'grid', label: 'Grid', size: 16, draw: (c, s, col) => { stroke(c, col, 1); c.beginPath(); c.moveTo(0.5, 0); c.lineTo(0.5, s); c.moveTo(0, 0.5); c.lineTo(s, 0.5); c.stroke(); } },
  { id: 'checker', label: 'Checkerboard', size: 16, draw: (c, s, col) => { c.fillStyle = col; c.fillRect(0, 0, s / 2, s / 2); c.fillRect(s / 2, s / 2, s / 2, s / 2); } },
  { id: 'stripes-h', label: 'Horizontal Stripes', size: 12, draw: (c, s, col) => { c.fillStyle = col; c.fillRect(0, 0, s, s / 3); } },
  { id: 'stripes-v', label: 'Vertical Stripes', size: 12, draw: (c, s, col) => { c.fillStyle = col; c.fillRect(0, 0, s / 3, s); } },
  { id: 'stripes-d', label: 'Diagonal Stripes', size: 16, draw: (c, s, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(0, s * 0.5); c.lineTo(s * 0.5, 0); c.lineTo(s, 0); c.lineTo(0, s); c.closePath(); c.fill(); c.beginPath(); c.moveTo(s * 0.5, s); c.lineTo(s, s * 0.5); c.lineTo(s, s); c.closePath(); c.fill(); } },
  { id: 'waves', label: 'Waves', size: 20, draw: (c, s, col) => { stroke(c, col, 1.6); c.beginPath(); c.moveTo(0, s / 2); c.bezierCurveTo(s * 0.25, 0, s * 0.25, 0, s / 2, s / 2); c.bezierCurveTo(s * 0.75, s, s * 0.75, s, s, s / 2); c.stroke(); } },
  { id: 'zigzag', label: 'Zig-Zag', size: 16, draw: (c, s, col) => { stroke(c, col, 1.6); c.beginPath(); c.moveTo(0, s * 0.75); c.lineTo(s / 2, s * 0.25); c.lineTo(s, s * 0.75); c.stroke(); } },
  { id: 'bricks', label: 'Bricks', size: 24, draw: (c, s, col) => { stroke(c, col, 1.2); const h = s / 2; c.strokeRect(0.5, 0.5, s - 1, h - 1); c.beginPath(); c.moveTo(s / 2, h); c.lineTo(s / 2, s); c.moveTo(0, s - 0.5); c.lineTo(s, s - 0.5); c.stroke(); } },
  { id: 'triangles', label: 'Triangles', size: 20, draw: (c, s, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(s / 2, s * 0.15); c.lineTo(s * 0.85, s * 0.85); c.lineTo(s * 0.15, s * 0.85); c.closePath(); c.fill(); } },
  { id: 'plus', label: 'Plus Signs', size: 18, draw: (c, s, col) => { stroke(c, col, 1.6); c.beginPath(); c.moveTo(s / 2, s * 0.3); c.lineTo(s / 2, s * 0.7); c.moveTo(s * 0.3, s / 2); c.lineTo(s * 0.7, s / 2); c.stroke(); } },
  { id: 'scales', label: 'Scales', size: 20, draw: (c, s, col) => { stroke(c, col, 1.2); for (const [x, y] of [[s / 2, 0], [0, s / 2], [s, s / 2], [s / 2, s]]) { c.beginPath(); c.arc(x, y, s / 2, 0, Math.PI * 2); c.stroke(); } } },
  { id: 'noise', label: 'Speckle', size: 64, draw: (c, s, col) => { c.fillStyle = col; let a = 12345; for (let i = 0; i < 180; i++) { a = (a * 1664525 + 1013904223) >>> 0; const x = (a % s), y = ((a >>> 8) % s); c.globalAlpha = 0.25 + ((a >>> 16) % 70) / 100; c.fillRect(x, y, 1 + ((a >>> 4) % 2), 1 + ((a >>> 6) % 2)); } c.globalAlpha = 1; } },
];

const tiles = new Map<string, HTMLCanvasElement>();
export function patternTile(id: string, color: string): HTMLCanvasElement | null {
  const def = PATTERNS.find((p) => p.id === id);
  if (!def) return null;
  const key = `${id}|${color}`;
  let t = tiles.get(key);
  if (!t) {
    t = createCanvas(def.size, def.size);
    def.draw(ctx2d(t), def.size, color);
    if (tiles.size > 300) tiles.clear();
    tiles.set(key, t);
  }
  return t;
}
export function getPattern(id: string, color: string, ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const t = patternTile(id, color);
  return t ? ctx.createPattern(t, 'repeat') : null;
}
