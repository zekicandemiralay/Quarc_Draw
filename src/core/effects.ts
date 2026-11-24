// Non-destructive layer effects (drop shadow, glow, stroke, overlay, inner shadow).
// Effects are computed from the alpha silhouette of the layer pixels in device space.

import type { LayerEffect } from './model';
import { blendToComposite } from './model';
import { acquire, release } from './canvaspool';
import { cssColor } from './vector';
import { parseColor, rgbaToCss } from './color';

const withAlpha = (color: string, a: number) => { const c = parseColor(color); return rgbaToCss({ ...c, a: c.a * a }); };

/** draw only the shadow of `src` (not the source itself) */
function drawShadowOnly(dst: CanvasRenderingContext2D, src: HTMLCanvasElement, color: string, dx: number, dy: number, blur: number) {
  const off = src.width + 200;
  dst.save();
  dst.setTransform(1, 0, 0, 1, 0, 0);
  dst.shadowColor = color;
  dst.shadowBlur = blur;
  dst.shadowOffsetX = off + dx;
  dst.shadowOffsetY = dy;
  dst.drawImage(src, -off, 0);
  dst.restore();
}

/** morphological dilation of alpha silhouette by sampling offsets on a circle */
function dilated(src: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const out = acquire(src.width, src.height);
  const ctx = out.getContext('2d')!;
  if (r <= 0.5) { ctx.drawImage(src, 0, 0); return out; }
  const rings = r > 6 ? 3 : r > 2.5 ? 2 : 1;
  for (let ring = 1; ring <= rings; ring++) {
    const rr = (r * ring) / rings;
    const steps = Math.max(12, Math.ceil(rr * 5));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.drawImage(src, Math.cos(a) * rr, Math.sin(a) * rr);
    }
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

function tinted(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const out = acquire(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  return out;
}

function inverse(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = acquire(src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(src, 0, 0);
  return out;
}

/**
 * Compose layer pixels `T` plus its effects into `E`.
 * k = device pixels per document pixel.
 */
export function composeWithEffects(E: CanvasRenderingContext2D, T: HTMLCanvasElement, effects: LayerEffect[], k: number) {
  const active = effects.filter((e) => e.enabled);
  // --- below the layer ---
  for (const fx of active) {
    if (fx.kind === 'drop-shadow') {
      let src = T, tmp: HTMLCanvasElement | null = null;
      if (fx.spread > 0) src = tmp = dilated(T, fx.spread * k);
      drawShadowOnly(E, src, withAlpha(fx.color, fx.opacity), fx.x * k, fx.y * k, fx.blur * k);
      if (tmp) release(tmp);
    } else if (fx.kind === 'outer-glow') {
      let src = T, tmp: HTMLCanvasElement | null = null;
      if (fx.spread > 0) src = tmp = dilated(T, fx.spread * k);
      const col = withAlpha(fx.color, fx.opacity);
      drawShadowOnly(E, src, col, 0, 0, fx.blur * k);
      drawShadowOnly(E, src, col, 0, 0, fx.blur * k * 0.5);
      if (tmp) release(tmp);
    } else if (fx.kind === 'stroke' && fx.position !== 'inside') {
      const w = fx.position === 'center' ? fx.width / 2 : fx.width;
      const d = dilated(T, w * k);
      const t = tinted(d, withAlpha(fx.color, fx.opacity));
      E.drawImage(t, 0, 0);
      release(d); release(t);
    }
  }
  // --- the layer itself ---
  E.drawImage(T, 0, 0);
  // --- above the layer ---
  for (const fx of active) {
    if (fx.kind === 'color-overlay') {
      const o = tinted(T, withAlpha(fx.color, fx.opacity));
      E.save();
      E.globalCompositeOperation = blendToComposite(fx.blend);
      E.drawImage(o, 0, 0);
      E.restore();
      release(o);
    } else if (fx.kind === 'stroke' && fx.position !== 'outside') {
      const inv = inverse(T);
      const dil = dilated(inv, (fx.position === 'center' ? fx.width / 2 : fx.width) * k);
      const band = acquire(T.width, T.height);
      const bc = band.getContext('2d')!;
      bc.drawImage(dil, 0, 0);
      bc.globalCompositeOperation = 'destination-in';
      bc.drawImage(T, 0, 0);
      const t = tinted(band, withAlpha(fx.color, fx.opacity));
      E.drawImage(t, 0, 0);
      release(inv); release(dil); release(band); release(t);
    } else if (fx.kind === 'inner-shadow') {
      const inv = inverse(T);
      const sh = acquire(T.width, T.height);
      drawShadowOnly(sh.getContext('2d')!, inv, withAlpha(fx.color, fx.opacity), fx.x * k, fx.y * k, fx.blur * k);
      const shc = sh.getContext('2d')!;
      shc.globalCompositeOperation = 'destination-in';
      shc.drawImage(T, 0, 0);
      E.drawImage(sh, 0, 0);
      release(inv); release(sh);
    }
  }
  void cssColor;
}

export const hasActiveEffects = (effects: LayerEffect[]) => effects.some((e) => e.enabled);
