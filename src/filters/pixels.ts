// Pure pixel-processing algorithms operating on RGBA8 buffers (non-premultiplied, like ImageData).
// No DOM access so everything here can be unit-tested in Node.

import { buildGradientLUT, parseColor } from '../core/color';
import type { Adjustment } from '../core/model';

export interface Pix { data: Uint8ClampedArray; width: number; height: number }
export const makePix = (w: number, h: number): Pix => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
/** wrap a Pix as ImageData (TS 5.7+ needs the ArrayBuffer-backed typing) */
export const toImageData = (p: Pix): ImageData => new ImageData(p.data as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height);
export const clonePix = (p: Pix): Pix => ({ data: new Uint8ClampedArray(p.data), width: p.width, height: p.height });
const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ---------------- LUT helpers ----------------
function applyLUT(p: Pix, r: Uint8Array | Uint8ClampedArray, g = r, b = r) {
  const d = p.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
}
const makeLUT = (f: (x: number) => number) => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = Math.round(f(i)); return l; };

/** Monotone cubic (Fritsch–Carlson) curve through control points → 256-entry LUT */
export function curveLUT(points: [number, number][]): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return makeLUT((x) => x);
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const dx: number[] = [], dy: number[] = [], m: number[] = [], t: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i] || 1e-6); dy.push(ys[i + 1] - ys[i]); m.push(dy[i] / dx[i]); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return makeLUT((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i], s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * t[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * t[i + 1];
  });
}

// ---------------- Adjustments ----------------
export function applyAdjustment(p: Pix, a: Adjustment): Pix {
  const d = p.data;
  switch (a.kind) {
    case 'brightness-contrast': {
      const c = a.contrast * 2.55, f = (259 * (c + 255)) / (255 * (259 - c));
      applyLUT(p, makeLUT((x) => f * (x + a.brightness * 2.55 - 128) + 128));
      break;
    }
    case 'levels': {
      const range = Math.max(1, a.inWhite - a.inBlack), g = 1 / Math.max(0.01, a.gamma);
      applyLUT(p, makeLUT((x) => a.outBlack + (a.outWhite - a.outBlack) * clamp01((x - a.inBlack) / range) ** g));
      break;
    }
    case 'curves': applyLUT(p, curveLUT(a.points)); break;
    case 'exposure': {
      const mul = 2 ** a.exposure, g = 1 / Math.max(0.01, a.gamma);
      applyLUT(p, makeLUT((x) => 255 * clamp01((x / 255) * mul + a.offset) ** g));
      break;
    }
    case 'invert': applyLUT(p, makeLUT((x) => 255 - x)); break;
    case 'threshold': {
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; const v = l >= a.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      break;
    }
    case 'posterize': {
      const n = Math.max(2, a.levels);
      applyLUT(p, makeLUT((x) => Math.round((Math.floor((x / 256) * n) / (n - 1)) * 255)));
      break;
    }
    case 'grayscale': {
      for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = l; }
      break;
    }
    case 'sepia': {
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = 0.393 * r + 0.769 * g + 0.189 * b; d[i + 1] = 0.349 * r + 0.686 * g + 0.168 * b; d[i + 2] = 0.272 * r + 0.534 * g + 0.131 * b;
      }
      break;
    }
    case 'hue-saturation': {
      const sat = 1 + a.saturation / 100, lh = a.lightness / 100, hue = a.hue / 360;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn;
        let h = 0, s = 0, l = (mx + mn) / 2;
        if (dl > 1e-6) {
          s = dl / (1 - Math.abs(2 * l - 1) + 1e-9);
          h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4;
          h /= 6; if (h < 0) h += 1;
        }
        h = (h + hue + 1) % 1;
        s = clamp01(s * sat);
        l = lh > 0 ? l + (1 - l) * lh : l * (1 + lh);
        const c = (1 - Math.abs(2 * l - 1)) * s, hh = h * 6, x = c * (1 - Math.abs((hh % 2) - 1)), m = l - c / 2;
        let rr = 0, gg = 0, bb = 0;
        if (hh < 1) { rr = c; gg = x; } else if (hh < 2) { rr = x; gg = c; } else if (hh < 3) { gg = c; bb = x; }
        else if (hh < 4) { gg = x; bb = c; } else if (hh < 5) { rr = x; bb = c; } else { rr = c; bb = x; }
        d[i] = (rr + m) * 255; d[i + 1] = (gg + m) * 255; d[i + 2] = (bb + m) * 255;
      }
      break;
    }
    case 'vibrance': {
      const vb = a.vibrance / 100, st = 1 + a.saturation / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const s = mx === 0 ? 0 : (mx - mn) / mx;
        const f = (1 + vb * (1 - s)) * st;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        d[i] = l + (r - l) * f; d[i + 1] = l + (g - l) * f; d[i + 2] = l + (b - l) * f;
      }
      break;
    }
    case 'color-balance': {
      const k = 0.64;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        const ws = 1 - smoothstep(0, 0.55, l), wh = smoothstep(0.45, 1, l), wm = clamp01(1 - ws - wh + 0.0);
        for (let c = 0; c < 3; c++) d[i + c] += (a.shadows[c] * ws + a.midtones[c] * wm + a.highlights[c] * wh) * k;
      }
      break;
    }
    case 'photo-filter': {
      const col = parseColor(a.color), dens = a.density / 100;
      const lum = Math.max(1, 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b);
      const fr = col.r / lum, fg = col.g / lum, fb = col.b / lum;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i] + (clamp255(d[i] * fr) - d[i]) * dens; d[i + 1] = d[i + 1] + (clamp255(d[i + 1] * fg) - d[i + 1]) * dens; d[i + 2] = d[i + 2] + (clamp255(d[i + 2] * fb) - d[i + 2]) * dens;
      }
      break;
    }
    case 'gradient-map': {
      const lut = buildGradientLUT(a.stops);
      for (let i = 0; i < d.length; i += 4) {
        const l = Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * 4;
        d[i] = lut[l]; d[i + 1] = lut[l + 1]; d[i + 2] = lut[l + 2];
      }
      break;
    }
  }
  return p;
}

// ---------------- Convolution / blur ----------------
interface Planes { r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array }
function toPremul(p: Pix): Planes {
  const n = p.width * p.height, r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n), a = new Float32Array(n);
  const d = p.data;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const al = d[i + 3] / 255; a[j] = al; r[j] = d[i] * al; g[j] = d[i + 1] * al; b[j] = d[i + 2] * al;
  }
  return { r, g, b, a };
}
function fromPremul(pl: Planes, p: Pix) {
  const n = p.width * p.height, d = p.data;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const al = pl.a[j];
    if (al > 0.0001) { d[i] = pl.r[j] / al; d[i + 1] = pl.g[j] / al; d[i + 2] = pl.b[j] / al; } else { d[i] = d[i + 1] = d[i + 2] = 0; }
    d[i + 3] = al * 255;
  }
}
function boxBlurPlane(src: Float32Array, tmp: Float32Array, w: number, h: number, r: number) {
  if (r < 1) return;
  const inv = 1 / (r + r + 1);
  // horizontal: src → tmp
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let x = 0; x < r; x++) acc += src[row + Math.min(x, w - 1)];
    for (let x = 0; x < w; x++) {
      acc += src[row + Math.min(x + r, w - 1)] - src[row + Math.max(x - r - 1, 0)];
      tmp[row + x] = acc * inv;
    }
  }
  // vertical: tmp → src
  for (let x = 0; x < w; x++) {
    let acc = tmp[x] * (r + 1);
    for (let y = 0; y < r; y++) acc += tmp[Math.min(y, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      acc += tmp[Math.min(y + r, h - 1) * w + x] - tmp[Math.max(y - r - 1, 0) * w + x];
      src[y * w + x] = acc * inv;
    }
  }
}
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
}
export function gaussianBlur(p: Pix, sigma: number): Pix {
  if (sigma <= 0.1) return p;
  const pl = toPremul(p);
  const tmp = new Float32Array(p.width * p.height);
  const boxes = boxesForGauss(sigma, 3);
  for (const ch of [pl.r, pl.g, pl.b, pl.a]) for (const r of boxes) boxBlurPlane(ch, tmp, p.width, p.height, Math.round(r));
  fromPremul(pl, p);
  return p;
}
export function boxBlur(p: Pix, radius: number): Pix {
  const pl = toPremul(p);
  const tmp = new Float32Array(p.width * p.height);
  for (const ch of [pl.r, pl.g, pl.b, pl.a]) boxBlurPlane(ch, tmp, p.width, p.height, Math.round(radius));
  fromPremul(pl, p);
  return p;
}

function bilinear(d: Uint8ClampedArray, w: number, h: number, x: number, y: number, out: number[]) {
  x = Math.min(Math.max(x, 0), w - 1.001); y = Math.min(Math.max(y, 0), h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
  const a00 = d[i00 + 3] * w00, a10 = d[i10 + 3] * w10, a01 = d[i01 + 3] * w01, a11 = d[i11 + 3] * w11;
  const A = a00 + a10 + a01 + a11;
  if (A < 1e-6) { out[0] = out[1] = out[2] = out[3] = 0; return; }
  for (let c = 0; c < 3; c++) out[c] = (d[i00 + c] * a00 + d[i10 + c] * a10 + d[i01 + c] * a01 + d[i11 + c] * a11) / A;
  out[3] = A;
}

export function motionBlur(p: Pix, angleDeg: number, distance: number): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const n = Math.max(2, Math.round(distance)), a = (angleDeg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  const o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    for (let k = 0; k < n; k++) {
      const t = k - (n - 1) / 2;
      bilinear(src, w, h, x + dx * t, y + dy * t, o);
      const aa = o[3]; r += o[0] * aa; g += o[1] * aa; b += o[2] * aa; al += aa;
    }
    const i = (y * w + x) * 4;
    if (al > 0) { d[i] = r / al; d[i + 1] = g / al; d[i + 2] = b / al; d[i + 3] = al / n; } else d[i + 3] = 0;
  }
  return p;
}
export function radialBlur(p: Pix, mode: 'zoom' | 'spin', amount: number, cx: number, cy: number): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const n = 18, o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, al = 0;
    const vx = x - cx, vy = y - cy;
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1) - 0.5) * (amount / 100);
      let sx: number, sy: number;
      if (mode === 'zoom') { sx = cx + vx * (1 + t); sy = cy + vy * (1 + t); }
      else { const ang = t * 0.6, c = Math.cos(ang), s = Math.sin(ang); sx = cx + vx * c - vy * s; sy = cy + vx * s + vy * c; }
      bilinear(src, w, h, sx, sy, o);
      r += o[0] * o[3]; g += o[1] * o[3]; b += o[2] * o[3]; al += o[3];
    }
    const i = (y * w + x) * 4;
    if (al > 0) { d[i] = r / al; d[i + 1] = g / al; d[i + 2] = b / al; d[i + 3] = al / n; } else d[i + 3] = 0;
  }
  return p;
}

export function unsharpMask(p: Pix, amount: number, radius: number, threshold: number): Pix {
  const blurred = gaussianBlur(clonePix(p), radius);
  const d = p.data, b = blurred.data, k = amount / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - b[i + c];
      if (Math.abs(diff) >= threshold) d[i + c] = d[i + c] + diff * k;
    }
  }
  return p;
}

export function addNoise(p: Pix, amount: number, mono: boolean, seed = 1): Pix {
  const d = p.data;
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;
  const k = (amount / 100) * 128;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    if (mono) { const n = gauss() * k; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    else { d[i] += gauss() * k; d[i + 1] += gauss() * k; d[i + 2] += gauss() * k; }
  }
  return p;
}

export function median(p: Pix, radius: number): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const size = (2 * radius + 1) ** 2, buf = new Uint8Array(size);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 4; c++) {
      let n = 0;
      for (let yy = -radius; yy <= radius; yy++) {
        const py = Math.min(h - 1, Math.max(0, y + yy));
        for (let xx = -radius; xx <= radius; xx++) buf[n++] = src[(py * w + Math.min(w - 1, Math.max(0, x + xx))) * 4 + c];
      }
      const sub = buf.subarray(0, n); sub.sort();
      d[i + c] = sub[n >> 1];
    }
  }
  return p;
}

export function convolve3(p: Pix, k: number[], divisor = 1, bias = 0, keepAlpha = true): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
      const px = Math.min(w - 1, Math.max(0, x + xx)), py = Math.min(h - 1, Math.max(0, y + yy));
      const i = (py * w + px) * 4, kv = k[n++];
      r += src[i] * kv; g += src[i + 1] * kv; b += src[i + 2] * kv;
    }
    const o = (y * w + x) * 4;
    d[o] = r / divisor + bias; d[o + 1] = g / divisor + bias; d[o + 2] = b / divisor + bias;
    if (!keepAlpha) d[o + 3] = 255;
  }
  return p;
}
export const sharpen3 = (p: Pix, strength = 1) => convolve3(p, [0, -strength, 0, -strength, 1 + 4 * strength, -strength, 0, -strength, 0]);
export function emboss(p: Pix, angleDeg: number, depth: number): Pix {
  const a = (angleDeg * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a);
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const lum = (x: number, y: number) => { const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; return 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 128 + (lum(Math.round(x + dx), Math.round(y + dy)) - lum(Math.round(x - dx), Math.round(y - dy))) * depth;
    const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = v;
  }
  return p;
}
export function findEdges(p: Pix, invert = true): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const L = (x: number, y: number) => { const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4; return 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const gx = -L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1) + L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1);
    const gy = -L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1) + L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1);
    const m = Math.min(255, Math.hypot(gx, gy));
    const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = invert ? 255 - m : m;
  }
  return p;
}
export function pixelate(p: Pix, size: number): Pix {
  const { width: w, height: h } = p, d = p.data, s = Math.max(1, Math.round(size));
  for (let by = 0; by < h; by += s) for (let bx = 0; bx < w; bx += s) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const ye = Math.min(h, by + s), xe = Math.min(w, bx + s);
    for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4, al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++; }
    const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / n;
    for (let y = by; y < ye; y++) for (let x = bx; x < xe; x++) { const i = (y * w + x) * 4; d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = A; }
  }
  return p;
}
export function halftone(p: Pix, cell: number, angleDeg: number, color: boolean): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const a = (angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x * ca + y * sa) / cell, vv = (-x * sa + y * ca) / cell;
    const cu = Math.floor(u) + 0.5, cv = Math.floor(vv) + 0.5;
    const cx = Math.round((cu * ca - cv * sa) * cell), cy = Math.round((cu * sa + cv * ca) * cell);
    const sx = Math.min(w - 1, Math.max(0, cx)), sy = Math.min(h - 1, Math.max(0, cy));
    const si = (sy * w + sx) * 4;
    const lum = (0.2126 * src[si] + 0.7152 * src[si + 1] + 0.0722 * src[si + 2]) / 255;
    const r = Math.sqrt(1 - lum) * cell * 0.72;
    const dist = Math.hypot(u - cu, vv - cv) * cell;
    const inside = clamp01(r - dist + 0.5);
    const o = (y * w + x) * 4;
    if (color) { d[o] = 255 - (255 - src[si]) * inside; d[o + 1] = 255 - (255 - src[si + 1]) * inside; d[o + 2] = 255 - (255 - src[si + 2]) * inside; }
    else { const v = 255 * (1 - inside); d[o] = d[o + 1] = d[o + 2] = v; }
  }
  return p;
}
export function oilPaint(p: Pix, radius: number): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data, r = Math.max(1, Math.round(radius));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // Kuwahara: pick the quadrant with the smallest luminance variance
    let best = Infinity, br = 0, bg = 0, bb = 0;
    for (let q = 0; q < 4; q++) {
      const x0 = q % 2 ? x : x - r, y0 = q < 2 ? y - r : y;
      let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, n = 0;
      for (let yy = y0; yy <= y0 + r; yy++) for (let xx = x0; xx <= x0 + r; xx++) {
        const px = Math.min(w - 1, Math.max(0, xx)), py = Math.min(h - 1, Math.max(0, yy)), i = (py * w + px) * 4;
        const l = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
        sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; sl += l; sl2 += l * l; n++;
      }
      const v = sl2 / n - (sl / n) ** 2;
      if (v < best) { best = v; br = sr / n; bg = sg / n; bb = sb / n; }
    }
    const o = (y * w + x) * 4; d[o] = br; d[o + 1] = bg; d[o + 2] = bb;
  }
  return p;
}
export function vignette(p: Pix, amount: number, size: number, feather: number): Pix {
  const { width: w, height: h } = p, d = p.data, cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
  const inner = (size / 100) * maxR, outer = inner + Math.max(1, (feather / 100) * maxR);
  const a = amount / 100;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = smoothstep(inner, outer, Math.hypot(x - cx, y - cy));
    const f = 1 - a * t, o = (y * w + x) * 4;
    d[o] *= f; d[o + 1] *= f; d[o + 2] *= f;
  }
  return p;
}
export function glow(p: Pix, threshold: number, radius: number, intensity: number): Pix {
  const bright = clonePix(p);
  const bd = bright.data;
  for (let i = 0; i < bd.length; i += 4) {
    const l = 0.2126 * bd[i] + 0.7152 * bd[i + 1] + 0.0722 * bd[i + 2];
    const k = l >= threshold ? 1 : 0;
    bd[i] *= k; bd[i + 1] *= k; bd[i + 2] *= k; if (!k) bd[i + 3] = 0;
  }
  gaussianBlur(bright, radius);
  const d = p.data, s = intensity / 100;
  for (let i = 0; i < d.length; i += 4) {
    const a = bd[i + 3] / 255 * s;
    for (let c = 0; c < 3; c++) d[i + c] = 255 - (255 - d[i + c]) * (1 - (bd[i + c] / 255) * a);
  }
  return p;
}
export function chromaticAberration(p: Pix, amount: number): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data, a = Math.round(amount);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    d[o] = src[(y * w + Math.min(w - 1, Math.max(0, x + a))) * 4];
    d[o + 2] = src[(y * w + Math.min(w - 1, Math.max(0, x - a))) * 4 + 2];
  }
  return p;
}

/** Generic inverse-mapping warp: for each destination pixel, `map` returns the source coordinate. */
export function warp(p: Pix, map: (x: number, y: number, out: [number, number]) => void): Pix {
  const src = new Uint8ClampedArray(p.data), { width: w, height: h } = p, d = p.data;
  const out: [number, number] = [0, 0], o = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    map(x, y, out);
    const i = (y * w + x) * 4;
    if (out[0] < -1 || out[1] < -1 || out[0] > w || out[1] > h) { d[i + 3] = 0; continue; }
    bilinear(src, w, h, out[0], out[1], o);
    d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = o[3];
  }
  return p;
}
export const twirl = (p: Pix, angleDeg: number, radiusPct: number) => {
  const cx = p.width / 2, cy = p.height / 2, R = (Math.min(p.width, p.height) / 2) * (radiusPct / 100), ang = (angleDeg * Math.PI) / 180;
  return warp(p, (x, y, out) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r >= R) { out[0] = x; out[1] = y; return; }
    const t = (1 - r / R) ** 2 * ang, c = Math.cos(t), s = Math.sin(t);
    out[0] = cx + dx * c - dy * s; out[1] = cy + dx * s + dy * c;
  });
};
export const spherize = (p: Pix, amount: number) => {
  const cx = p.width / 2, cy = p.height / 2, R = Math.min(p.width, p.height) / 2, k = amount / 100;
  return warp(p, (x, y, out) => {
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r >= R || r === 0) { out[0] = x; out[1] = y; return; }
    const nr = r / R, f = k >= 0 ? nr ** (1 + k) / nr * 1 : nr ** (1 / (1 - k)) / nr;
    out[0] = cx + dx * f; out[1] = cy + dy * f;
  });
};
export const ripple = (p: Pix, amplitude: number, wavelength: number) => warp(p, (x, y, out) => {
  out[0] = x + Math.sin((y / wavelength) * Math.PI * 2) * amplitude; out[1] = y + Math.sin((x / wavelength) * Math.PI * 2) * amplitude;
});
export const wave = (p: Pix, amplitude: number, wavelength: number, vertical: boolean) => warp(p, (x, y, out) => {
  if (vertical) { out[0] = x + Math.sin((y / wavelength) * Math.PI * 2) * amplitude; out[1] = y; }
  else { out[0] = x; out[1] = y + Math.sin((x / wavelength) * Math.PI * 2) * amplitude; }
});

/** Resample using box filter (downscale) / bilinear (upscale). Returns new buffer. */
export function resizePix(p: Pix, nw: number, nh: number): Pix {
  const out = makePix(nw, nh), { width: w, height: h } = p, d = p.data, o = out.data, tmp = [0, 0, 0, 0];
  if (nw < w || nh < h) {
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((x + 1) * sx)));
      const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((y + 1) * sy)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * w + xx) * 4, al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++; }
      const i = (y * nw + x) * 4;
      if (a) { o[i] = r / a; o[i + 1] = g / a; o[i + 2] = b / a; }
      o[i + 3] = a / n;
    }
  } else {
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      bilinear(d, w, h, ((x + 0.5) * w) / nw - 0.5, ((y + 0.5) * h) / nh - 0.5, tmp);
      const i = (y * nw + x) * 4; o[i] = tmp[0]; o[i + 1] = tmp[1]; o[i + 2] = tmp[2]; o[i + 3] = tmp[3];
    }
  }
  return out;
}

// ---------------- Masks (Uint8 alpha arrays, size w*h) ----------------
export function boxBlurMask(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r < 1) return m;
  const f = new Float32Array(m), tmp = new Float32Array(w * h);
  for (let i = 0; i < 3; i++) boxBlurPlane(f, tmp, w, h, Math.max(1, Math.round(r / 1.7)));
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(f[i]);
  return out;
}
/** morphological grow (dilate=true) or shrink – circle-ish kernel via separable passes (approximate, fast) */
export function morphMask(m: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  let src = m;
  for (let pass = 0; pass < Math.round(r); pass++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = src[y * w + x];
      const l = x > 0 ? src[y * w + x - 1] : (dilate ? 0 : 255), rr = x < w - 1 ? src[y * w + x + 1] : (dilate ? 0 : 255);
      const u = y > 0 ? src[(y - 1) * w + x] : (dilate ? 0 : 255), dn = y < h - 1 ? src[(y + 1) * w + x] : (dilate ? 0 : 255);
      if (dilate) v = Math.max(v, l, rr, u, dn); else v = Math.min(v, l, rr, u, dn);
      out[y * w + x] = v;
    }
    src = out;
  }
  return src;
}
