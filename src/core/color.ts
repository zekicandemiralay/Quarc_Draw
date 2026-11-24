// Color utilities: parsing, conversion (RGB/HSV/HSL/LAB), harmony, blending helpers.

export interface RGBA { r: number; g: number; b: number; a: number } // r,g,b 0..255, a 0..1
export interface HSV { h: number; s: number; v: number; a: number } // h 0..360, s,v 0..1
export interface HSL { h: number; s: number; l: number; a: number }

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

export function hexToRgba(hex: string): RGBA {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8 || /[^0-9a-f]/i.test(h)) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255,
  };
}

const hx = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');
export function rgbaToHex(c: RGBA, withAlpha = false): string {
  return '#' + hx(c.r) + hx(c.g) + hx(c.b) + (withAlpha && c.a < 1 ? hx(c.a * 255) : '');
}

/** Parses #hex, rgb(), rgba(), hsl(), hsla(), and a handful of named colors. */
export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) return hexToRgba(s);
  let m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  m = s.match(/^hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return hslToRgba({ h: +m[1], s: +m[2] / 100, l: +m[3] / 100, a });
  }
  const named: Record<string, string> = {
    black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00',
    orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', gray: '#808080', grey: '#808080', cyan: '#00ffff',
    magenta: '#ff00ff', brown: '#a52a2a', teal: '#008080', transparent: '#00000000', navy: '#000080',
  };
  if (named[s]) return hexToRgba(named[s]);
  return { r: 0, g: 0, b: 0, a: 1 };
}

export const rgbaToCss = (c: RGBA) =>
  c.a >= 1 ? `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})` : `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+c.a.toFixed(3)})`;

export function rgbaToHsv({ r, g, b, a }: RGBA): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}
export function hsvToRgba({ h, s, v, a }: HSV): RGBA {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}
export function rgbaToHsl({ r, g, b, a }: RGBA): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l, a };
}
export function hslToRgba({ h, s, l, a }: HSL): RGBA {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a };
}

export const luminance = (c: RGBA) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
export const contrastText = (c: RGBA) => (luminance(c) > 0.55 ? '#111' : '#fff');

export function mix(a: RGBA, b: RGBA, t: number): RGBA {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: a.a + (b.a - a.a) * t };
}

// ---- CIE LAB (D65) ----
const srgbToLin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const linToSrgb = (c: number) => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
export function rgbaToLab(c: RGBA): [number, number, number] {
  const r = srgbToLin(c.r), g = srgbToLin(c.g), b = srgbToLin(c.b);
  let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  let y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  let z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export function labToRgba(L: number, A: number, B: number, a = 1): RGBA {
  const y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
  const finv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = finv(x) * 0.95047, Y = finv(y), Z = finv(z) * 1.08883;
  const r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const g = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const b = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  return { r: clamp(linToSrgb(r), 0, 255), g: clamp(linToSrgb(g), 0, 255), b: clamp(linToSrgb(b), 0, 255), a };
}
export function colorDistance(a: RGBA, b: RGBA): number {
  const la = rgbaToLab(a), lb = rgbaToLab(b);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

// ---- Harmonies ----
export type Harmony = 'complementary' | 'analogous' | 'triadic' | 'tetradic' | 'split' | 'monochromatic' | 'shades';
export function harmony(base: RGBA, kind: Harmony): RGBA[] {
  const hsv = rgbaToHsv(base);
  const rot = (d: number): RGBA => hsvToRgba({ ...hsv, h: hsv.h + d });
  switch (kind) {
    case 'complementary': return [base, rot(180)];
    case 'analogous': return [rot(-30), base, rot(30)];
    case 'triadic': return [base, rot(120), rot(240)];
    case 'tetradic': return [base, rot(90), rot(180), rot(270)];
    case 'split': return [base, rot(150), rot(210)];
    case 'monochromatic': return [0.25, 0.45, 0.65, 0.85, 1].map((v) => hsvToRgba({ ...hsv, v: Math.min(1, v * Math.max(hsv.v, 0.5) + 0.1) }));
    case 'shades': return [0.2, 0.4, 0.6, 0.8, 1].map((t) => mix({ r: 255, g: 255, b: 255, a: base.a }, mix(base, { r: 0, g: 0, b: 0, a: base.a }, 1 - t), t === 1 ? 0 : 1 - t));
  }
}

// ---- Gradients ----
export interface GradientStop { pos: number; color: string }
export const sampleGradient = (stops: GradientStop[], t: number): RGBA => {
  const s = [...stops].sort((a, b) => a.pos - b.pos);
  if (!s.length) return { r: 0, g: 0, b: 0, a: 1 };
  if (t <= s[0].pos) return parseColor(s[0].color);
  for (let i = 0; i < s.length - 1; i++) {
    if (t <= s[i + 1].pos) {
      const span = s[i + 1].pos - s[i].pos || 1;
      return mix(parseColor(s[i].color), parseColor(s[i + 1].color), (t - s[i].pos) / span);
    }
  }
  return parseColor(s[s.length - 1].color);
};
export function buildGradientLUT(stops: GradientStop[], size = 256): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(size * 4);
  for (let i = 0; i < size; i++) {
    const c = sampleGradient(stops, i / (size - 1));
    lut[i * 4] = c.r; lut[i * 4 + 1] = c.g; lut[i * 4 + 2] = c.b; lut[i * 4 + 3] = c.a * 255;
  }
  return lut;
}
