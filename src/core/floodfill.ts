// Flood fill / magic-wand region detection on RGBA buffers.

export interface FloodOptions {
  tolerance: number; // 0..255 (max channel difference, alpha included)
  contiguous: boolean;
  /** if provided, pixels where limit[i]==0 act as barriers (e.g. outside the current selection) */
  limit?: Uint8Array | null;
}

export function floodMask(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, opt: FloodOptions): Uint8Array {
  const out = new Uint8Array(w * h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return out;
  const si = (sy * w + sx) * 4;
  const tr = data[si], tg = data[si + 1], tb = data[si + 2], ta = data[si + 3];
  const tol = opt.tolerance;
  const lim = opt.limit ?? null;

  const matches = (p: number): boolean => {
    const i = p * 4;
    const a = data[i + 3];
    // two fully transparent pixels always match regardless of rgb
    if (a === 0 && ta === 0) return true;
    return Math.abs(data[i] - tr) <= tol && Math.abs(data[i + 1] - tg) <= tol && Math.abs(data[i + 2] - tb) <= tol && Math.abs(a - ta) <= tol;
  };

  if (!opt.contiguous) {
    for (let p = 0; p < w * h; p++) if ((!lim || lim[p]) && matches(p)) out[p] = 255;
    return out;
  }

  const visited = new Uint8Array(w * h);
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!;
    let x = x0;
    // move left
    while (x >= 0 && !visited[y * w + x] && (!lim || lim[y * w + x]) && matches(y * w + x)) x--;
    x++;
    let spanUp = false, spanDn = false;
    while (x < w && !visited[y * w + x] && (!lim || lim[y * w + x]) && matches(y * w + x)) {
      const p = y * w + x;
      visited[p] = 1; out[p] = 255;
      if (y > 0) {
        const q = p - w;
        const ok = !visited[q] && (!lim || lim[q]) && matches(q);
        if (ok && !spanUp) { stack.push(x, y - 1); spanUp = true; } else if (!ok) spanUp = false;
      }
      if (y < h - 1) {
        const q = p + w;
        const ok = !visited[q] && (!lim || lim[q]) && matches(q);
        if (ok && !spanDn) { stack.push(x, y + 1); spanDn = true; } else if (!ok) spanDn = false;
      }
      x++;
    }
  }
  return out;
}
