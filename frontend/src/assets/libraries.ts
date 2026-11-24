// Built-in supporting material: swatch palettes, gradients, vector shapes / stickers.

import type { GradientStop } from '../core/color';

export interface Palette { id: string; name: string; colors: string[] }
export const PALETTES: Palette[] = [
  { id: 'quarc', name: 'Quarc', colors: ['#0b3d36', '#11917d', '#1fc8ac', '#7ff0dc', '#d8fff7', '#10223d', '#2c3e9b', '#5b7cfa', '#ff4d6d', '#ffb020', '#ffe066', '#3ddc97'] },
  { id: 'basic', name: 'Basic', colors: ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#80ff00', '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff', '#ff0080', '#8b4513'] },
  { id: 'material', name: 'Material', colors: ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548', '#607d8b'] },
  { id: 'pastel', name: 'Pastel', colors: ['#ffd1dc', '#ffb7b2', '#ffdac1', '#fff5ba', '#e2f0cb', '#b5ead7', '#c7ceea', '#d5c6e0', '#f8c8dc', '#aee6ff', '#fde2e4', '#cdeac0'] },
  { id: 'earth', name: 'Earth', colors: ['#3b2f2f', '#5a4632', '#8c6a43', '#b88a55', '#d9b98a', '#6b705c', '#a5a58d', '#cb997e', '#ddbea9', '#ffe8d6', '#4f5d2f', '#7a8450'] },
  { id: 'skin', name: 'Skin tones', colors: ['#fde7d7', '#f8d5bd', '#efc2a0', '#e0a97f', '#c98c5f', '#a8693f', '#8a5030', '#6b3a22', '#4d2a18', '#35200f'] },
  { id: 'neon', name: 'Neon', colors: ['#ff006e', '#fb5607', '#ffbe0b', '#8ac926', '#3a86ff', '#8338ec', '#00f5d4', '#f15bb5', '#fee440', '#00bbf9'] },
  { id: 'retro', name: 'Retro 70s', colors: ['#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51', '#8d5524', '#f2cc8f', '#81b29a', '#3d405b', '#e07a5f'] },
  { id: 'gray', name: 'Grayscale', colors: ['#000000', '#1a1a1a', '#333333', '#4d4d4d', '#666666', '#808080', '#999999', '#b3b3b3', '#cccccc', '#e6e6e6', '#ffffff'] },
  { id: 'sunset', name: 'Sunset', colors: ['#250902', '#640d14', '#a4161a', '#e5383b', '#ff7b00', '#ffb700', '#ffd60a', '#ffee99'] },
  { id: 'ocean', name: 'Ocean', colors: ['#03045e', '#023e8a', '#0077b6', '#0096c7', '#00b4d8', '#48cae4', '#90e0ef', '#caf0f8'] },
];

export interface GradientPreset { id: string; name: string; stops: GradientStop[] }
const G = (id: string, name: string, ...cols: string[]): GradientPreset => ({ id, name, stops: cols.map((c, i) => ({ pos: cols.length === 1 ? 0 : i / (cols.length - 1), color: c })) });
export const GRADIENTS: GradientPreset[] = [
  G('quarc', 'Quarc', '#1fc8ac', '#2c3e9b'), G('sunset', 'Sunset', '#ff512f', '#dd2476'), G('ocean', 'Ocean', '#2193b0', '#6dd5ed'),
  G('aurora', 'Aurora', '#00c6ff', '#0072ff', '#7f00ff'), G('candy', 'Candy', '#ff9a9e', '#fad0c4', '#fbc2eb'), G('forest', 'Forest', '#134e5e', '#71b280'),
  G('peach', 'Peach', '#ffecd2', '#fcb69f'), G('midnight', 'Midnight', '#232526', '#414345'), G('fire', 'Fire', '#f12711', '#f5af19'),
  G('rainbow', 'Rainbow', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'), G('metal', 'Chrome', '#e6e9f0', '#8d99ae', '#edf2f4', '#6c757d'),
  G('mint', 'Mint', '#00b09b', '#96c93d'), G('royal', 'Royal', '#141e30', '#243b55'), G('bw', 'Black → White', '#000000', '#ffffff'),
  { id: 'fade', name: 'Fade out', stops: [{ pos: 0, color: '#000000ff' }, { pos: 1, color: '#00000000' }] },
];

export interface ShapeDef { id: string; name: string; d: string; evenodd?: boolean; group: string }
export const SHAPES: ShapeDef[] = [
  { id: 'heart', name: 'Heart', group: 'Symbols', d: 'M50 88 C20 65 8 48 8 32 C8 18 19 10 31 10 C40 10 47 15 50 22 C53 15 60 10 69 10 C81 10 92 18 92 32 C92 48 80 65 50 88 Z' },
  { id: 'cloud', name: 'Cloud', group: 'Symbols', d: 'M25 74 C8 74 4 52 20 47 C20 28 44 20 54 36 C64 26 86 34 82 52 C98 52 100 74 82 74 Z' },
  { id: 'bolt', name: 'Lightning', group: 'Symbols', d: 'M58 4 L18 56 H46 L38 96 L82 40 H54 Z' },
  { id: 'drop', name: 'Drop', group: 'Symbols', d: 'M50 6 C50 6 20 42 20 62 C20 80 33 94 50 94 C67 94 80 80 80 62 C80 42 50 6 50 6 Z' },
  { id: 'moon', name: 'Moon', group: 'Symbols', d: 'M70 8 C45 10 26 30 26 54 C26 78 48 94 74 92 C52 84 46 66 50 50 C54 34 60 22 70 8 Z' },
  { id: 'leaf', name: 'Leaf', group: 'Symbols', d: 'M12 88 C12 40 44 10 92 8 C92 56 62 90 12 88 Z' },
  { id: 'check', name: 'Check mark', group: 'Symbols', d: 'M12 54 L36 78 L88 24 L80 16 L36 62 L20 46 Z' },
  { id: 'cross', name: 'Cross', group: 'Symbols', d: 'M20 10 L50 40 L80 10 L90 20 L60 50 L90 80 L80 90 L50 60 L20 90 L10 80 L40 50 L10 20 Z' },
  { id: 'plus', name: 'Plus', group: 'Symbols', d: 'M38 8 H62 V38 H92 V62 H62 V92 H38 V62 H8 V38 H38 Z' },
  { id: 'pin', name: 'Location pin', group: 'Symbols', evenodd: true, d: 'M50 4 C31 4 18 18 18 35 C18 58 50 96 50 96 C50 96 82 58 82 35 C82 18 69 4 50 4 Z M50 24 a11 11 0 1 0 0.01 0 Z' },
  { id: 'shield', name: 'Shield', group: 'Symbols', d: 'M50 4 L90 18 V48 C90 74 72 90 50 98 C28 90 10 74 10 48 V18 Z' },
  { id: 'home', name: 'House', group: 'Symbols', d: 'M50 8 L94 48 H82 V92 H58 V64 H42 V92 H18 V48 H6 Z' },
  { id: 'bubble', name: 'Speech bubble', group: 'Callouts', d: 'M10 14 H90 Q96 14 96 20 V62 Q96 68 90 68 H48 L26 90 L30 68 H10 Q4 68 4 62 V20 Q4 14 10 14 Z' },
  { id: 'bubble2', name: 'Thought bubble', group: 'Callouts', d: 'M30 60 C10 60 4 38 22 32 C22 12 52 6 62 24 C74 12 98 22 92 42 C106 50 96 66 80 62 C74 70 56 70 50 62 C46 64 36 64 30 60 Z M24 78 a5 5 0 1 0 0.01 0 Z M12 90 a3 3 0 1 0 0.01 0 Z' },
  { id: 'banner', name: 'Ribbon banner', group: 'Callouts', d: 'M4 24 H96 L86 46 L96 68 H4 L14 46 Z' },
  { id: 'tag', name: 'Label tag', group: 'Callouts', evenodd: true, d: 'M6 50 L34 20 H94 V80 H34 Z M30 46 a5 5 0 1 0 0.01 0 Z' },
  { id: 'arrow-r', name: 'Arrow right', group: 'Arrows', d: 'M4 38 H56 V14 L96 50 L56 86 V62 H4 Z' },
  { id: 'arrow-curve', name: 'Curved arrow', group: 'Arrows', d: 'M8 80 C8 40 36 22 66 24 V8 L96 34 L66 60 V44 C46 44 30 56 26 80 Z' },
  { id: 'chevron', name: 'Chevron', group: 'Arrows', d: 'M20 6 L70 50 L20 94 L8 80 L46 50 L8 20 Z' },
  { id: 'arrow-both', name: 'Double arrow', group: 'Arrows', d: 'M2 50 L26 24 V40 H74 V24 L98 50 L74 76 V60 H26 V76 Z' },
  { id: 'crown', name: 'Crown', group: 'Fun', d: 'M6 78 L12 30 L32 52 L50 18 L68 52 L88 30 L94 78 Z' },
  { id: 'flag', name: 'Flag', group: 'Fun', d: 'M16 6 H24 V94 H16 Z M24 12 C40 4 52 24 68 16 C76 12 84 12 90 14 V54 C84 52 76 52 68 56 C52 64 40 44 24 52 Z' },
  { id: 'ghost', name: 'Ghost', group: 'Fun', evenodd: true, d: 'M50 6 C28 6 16 22 16 42 V92 L30 80 L40 92 L50 80 L60 92 L70 80 L84 92 V42 C84 22 72 6 50 6 Z M38 38 a5 6 0 1 0 0.01 0 Z M62 38 a5 6 0 1 0 0.01 0 Z' },
  { id: 'gem', name: 'Gem', group: 'Fun', d: 'M28 10 H72 L96 38 L50 94 L4 38 Z' },
];
