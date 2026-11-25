// Art kit: the "hand" that paints inside Quarc Draw. It never draws pixels itself — it sends the same pen events a tablet sends
// (position + pressure) to the app's canvas, so every mark comes from the app's own brush engine, on the app's own layers.
// The pieces (harbour-at-dusk.js, sunflowers.js…) use it; scripts/paint-artwork.mjs loads them into the running app.

(() => {
  'use strict';
  const ed = () => window.__quarc.ed;
  const W = () => ed().page.width, H = () => ed().page.height;

  // ------------------------------------------------------------------ small helpers
  let seed = 1;
  const R = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rnd = (a, b) => a + (b - a) * R();
  const gauss = () => (R() + R() + R() - 1.5) / 0.87;                      // roughly N(0, 1)
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgb2hex = (c) => '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((v, i) => v + (B[i] - v) * t)); };
  const lighten = (c, t) => mix(c, '#ffffff', t), darken = (c, t) => mix(c, '#000000', t);
  const ramp = (stops, t) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    return stops[stops.length - 1][1];
  };
  const rgb2hsl = ([r, g, b]) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; };
  const hsl2rgb = ([h, s, l]) => { h = ((h % 360) + 360) % 360 / 360; const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }; if (s === 0) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]; };
  /** a painter never mixes the exact same colour twice */
  const jit = (c, dh = 4, ds = 0.05, dl = 0.045) => { const [h, s, l] = rgb2hsl(hex2rgb(c)); return rgb2hex(hsl2rgb([h + gauss() * dh, clamp(s + gauss() * ds, 0, 1), clamp(l + gauss() * dl, 0, 1)])); };

  // ------------------------------------------------------------------ the pen
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let current = null, strokes = 0;
  const PRESET_DEFAULTS = {
    'paint-oil': { hardness: 1, flow: 0.9, smoothing: 0.3, wet: 0.7, grainDepth: 0.09, grainScale: 1.0 },
    'paint-acrylic': { hardness: 1, flow: 0.95, smoothing: 0.35, wet: 0.25, grainDepth: 0.08, grainScale: 1.0 },
    'paint-airbrush': { hardness: 0, flow: 0.12, smoothing: 0.25, wet: 0 },
    'paint-gouache': { hardness: 0.9, flow: 0.85, smoothing: 0.2, wet: 0 },
  };
  function setup(o) {
    const e = ed(), preset = o.preset || 'paint-oil';
    if (current !== preset) { e.setBrushPreset(preset); current = preset; }
    const d = PRESET_DEFAULTS[preset] || {};
    e.setBrush({ size: o.size, opacity: o.opacity ?? 1, wet: o.wet ?? d.wet ?? 0, flow: o.flow ?? d.flow ?? 0.9, smoothing: o.smoothing ?? d.smoothing ?? 0.3, hardness: o.hardness ?? d.hardness ?? 1, ...(d.grainDepth !== undefined ? { grainDepth: d.grainDepth, grainScale: d.grainScale } : {}) });
    e.setFg(o.color);
  }
  /** one pen stroke along `pts` (page coordinates) with a natural pressure swell */
  async function stroke(pts, o) {
    setup(o);
    const e = ed(), el = document.querySelector('canvas.overlay'), b = document.querySelector('.viewport').getBoundingClientRect(), pm = e.view.pageMatrix(e.page);
    const w = W(), h = H(), n = pts.length, pw = o.pressure ?? rnd(0.62, 0.95);
    const X = (p) => b.left + pm.a * clamp(p[0], 0.6, w - 0.6) + pm.c * clamp(p[1], 0.6, h - 0.6) + pm.e;
    const Y = (p) => b.top + pm.b * clamp(p[0], 0.6, w - 0.6) + pm.d * clamp(p[1], 0.6, h - 0.6) + pm.f;
    const ev = (type, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const pr = type === 'pointerup' ? 0 : clamp(pw * (0.55 + 0.45 * Math.pow(Math.sin(Math.PI * clamp(t, 0.04, 0.96)), 0.55)), 0.15, 1);
      return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'pen', isPrimary: true, clientX: X(pts[i]), clientY: Y(pts[i]), pressure: pr, buttons: type === 'pointerup' ? 0 : 1, button: 0 });
    };
    el.dispatchEvent(ev('pointerdown', 0));
    for (let i = 1; i < n; i++) el.dispatchEvent(ev('pointermove', i));
    el.dispatchEvent(ev('pointerup', n - 1));
    if (++strokes % 24 === 0) await tick();
  }
  /** a single dab — used for soft glows */
  const dab = (x, y, o) => stroke([[x, y], [x + 0.2, y]], { ...o, pressure: 1 });
  /** points along a slightly wavy line */
  function line(x0, y0, x1, y1, { amp = 0, waves = 1, step = 18, jitter = 0.7 } = {}) {
    const len = Math.max(1, Math.hypot(x1 - x0, y1 - y0)), n = Math.max(3, Math.ceil(len / step)), ph = rnd(0, 6.28);
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, off = amp * Math.sin(ph + t * Math.PI * 2 * waves) + gauss() * jitter; pts.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]); }
    return pts;
  }
  /** fill a polygon with rows of strokes (what a painter does with a flat brush) */
  async function hatch(poly, o) {
    const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    for (let y = y0 + o.step * 0.5; y <= y1; y += o.step * rnd(0.85, 1.15)) {
      const xs = [];
      for (let i = 0; i < poly.length; i++) { const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length]; if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k], xb = xs[k + 1];
        if (xb - xa < 1.5) continue;
        const ins = o.inset ?? 0;                          // keep strokes inside the shape (crisp silhouettes)
        let x = xa + ins - rnd(0, o.size * 0.25) * (ins ? 0 : 1);
        while (x < xb - ins) {
          const xe = Math.min(xb - ins + (ins ? 0 : o.size * 0.2), x + rnd(o.minLen ?? 120, o.maxLen ?? 380));
          const yy = y + gauss() * o.step * 0.22, tilt = (o.tilt ?? 0) + gauss() * 0.01;
          const c = jit(o.colorAt((x + xe) / 2, yy), o.dh ?? 4, o.ds ?? 0.05, o.dl ?? 0.045);
          await stroke(line(x, yy, xe, yy + (xe - x) * tilt, { amp: o.amp ?? 3, waves: 1, step: o.size > 40 ? 22 : 14 }), { color: c, size: o.size * rnd(0.85, 1.15), opacity: o.opacity ?? 0.92, preset: o.preset, wet: o.wet });
          if (ins && xe >= xb - ins - 0.5) break;          // an inset row ends at the shape's edge (it must not start over)
          x = xe - o.size * 0.18;
        }
      }
    }
  }
  /** strokes that follow a polyline in overlapping chunks (soft, painterly edges) */
  async function contour(pts, o) {
    let acc = [pts[0]], dist = 0;
    for (let i = 1; i < pts.length; i++) {
      acc.push(pts[i]); dist += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (dist > (o.chunk ?? 150) || i === pts.length - 1) {
        if (acc.length > 1) await stroke(acc.map((p) => [p[0] + gauss() * 0.5, p[1] + gauss() * 0.5]), { color: jit(o.colorAt(acc[0]), 3, 0.04, 0.03), size: o.size * rnd(0.9, 1.1), opacity: o.opacity ?? 0.95, wet: o.wet ?? 0.2, pressure: 0.85 });
        acc = [pts[i]]; dist = 0;
      }
    }
  }
  /** rows of strokes over a rectangle (skies, water) */
  const rectPoly = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  function newLayer(name, { blend, opacity } = {}) {
    const e = ed();
    e.setActiveLayer(null); e.ensureRasterTarget();
    const l = e.page.layers[e.page.layers.length - 1];
    l.name = name; if (blend) l.blend = blend; if (opacity !== undefined) l.opacity = opacity;
    e.setActiveLayer(l.id); e.changed('layers', 'doc');
    return l.id;
  }
  function nameFirstLayer(name) { const e = ed(); const l = e.page.layers[0]; l.name = name; e.setActiveLayer(l.id); e.changed('layers'); }

  /** break a straight polyline up into a rough, natural one */
  function roughen(pts, amp, levels = 3) {
    let p = pts;
    for (let l = 0; l < levels; l++) {
      const q = [];
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, ay] = p[i], [bx, by] = p[i + 1], len = Math.hypot(bx - ax, by - ay) || 1;
        q.push(p[i], [(ax + bx) / 2 + (-(by - ay) / len) * gauss() * amp, (ay + by) / 2 + ((bx - ax) / len) * gauss() * amp]);
      }
      q.push(p[p.length - 1]); p = q; amp *= 0.55;
    }
    return p;
  }
  /** is (x, y) inside the polygon? (even-odd) */
  const inside = (poly, x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  /**
   * Fill a shape the way a painter models a form: short, slightly curved strokes laid along the planes of the subject
   * (`dir(x, y)` gives the direction, in radians), placed in random order so no rows show, each kept inside the shape.
   * o: { dir, colorAt, spacing, len: [min, max], size: [min, max], wobble?, opacity?, wet?, preset?, dh?, ds?, dl? }
   */
  async function flowFill(poly, o) {
    const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]), sp = o.spacing;
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), pts = [];
    for (let y = y0 + sp / 2; y < y1; y += sp) for (let x = x0 + sp / 2; x < x1; x += sp) { const px = x + (R() - 0.5) * sp, py = y + (R() - 0.5) * sp; if (inside(poly, px, py)) pts.push([px, py]); }
    for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
    for (const [px, py] of pts) {
      const a = o.dir(px, py) + gauss() * (o.wobble ?? 0.12), L = rnd(o.len[0], o.len[1]), dx = Math.cos(a), dy = Math.sin(a);
      let t0 = -L / 2, t1 = L / 2;                                  // walk each end in until it lies inside the shape
      while (t1 - t0 > 4 && !inside(poly, px + dx * t0, py + dy * t0)) t0 += 3;
      while (t1 - t0 > 4 && !inside(poly, px + dx * t1, py + dy * t1)) t1 -= 3;
      if (t1 - t0 < 4) continue;
      const bend = gauss() * L * 0.06, nx = -dy, ny = dx, n = Math.max(3, Math.ceil((t1 - t0) / 12));
      const pts2 = Array.from({ length: n + 1 }, (_, k) => { const t = t0 + ((t1 - t0) * k) / n, u = k / n; return [px + dx * t + nx * bend * Math.sin(Math.PI * u), py + dy * t + ny * bend * Math.sin(Math.PI * u)]; });
      await stroke(pts2, { preset: o.preset, color: jit(o.colorAt(px, py), o.dh ?? 4, o.ds ?? 0.05, o.dl ?? 0.04), size: rnd(o.size[0], o.size[1]), opacity: o.opacity ?? 0.92, wet: o.wet ?? 0.35 });
    }
  }
  /** points around an ellipse (rx, ry, rotated by rot) */
  const ellipsePts = (cx, cy, rx, ry, rot = 0, n = 48) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]; });
  /** a soft radial darkening on its own multiply layer, painted straight onto the layer's raster surface */
  function vignette(name, { cx = 0.5, cy = 0.5, inner = 0.38, color = '10,18,40', strength = 0.95, opacity = 0.75 } = {}) {
    const e = ed(), w = W(), h = H();
    const id = newLayer(name, { blend: 'multiply', opacity });
    const layer = e.page.layers.find((l) => l.id === id), c = layer.surface.canvas.getContext('2d');
    const g = c.createRadialGradient(w * cx, h * cy, Math.min(w, h) * inner, w * 0.5, h * 0.5, Math.max(w, h) * 0.78);
    g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.7, `rgba(${color},${strength * 0.58})`); g.addColorStop(1, `rgba(${color},${strength})`);
    c.fillStyle = g; c.fillRect(0, 0, w, h); layer.surface.touch();
    e.changed('layers', 'doc');
  }

  window.ArtKit = {
    ed, W, H, R, rnd, gauss, clamp, smooth, hex2rgb, rgb2hex, mix, lighten, darken, ramp, jit,
    stroke, dab, line, hatch, contour, rectPoly, newLayer, nameFirstLayer, roughen, ellipsePts, vignette, flowFill, inside,
    /** start the random sequence: the same seed paints the same picture */
    seed(n) { seed = n | 0; },
  };
})();
