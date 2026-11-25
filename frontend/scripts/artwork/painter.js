// "Harbour at Dusk" — an oil painting made INSIDE Quarc Draw.
//
// This file runs in the page of the real app. It does not draw pixels itself: it sits at the canvas like a hand with a pen and
// sends the same pen events a tablet would (position + pressure), so every mark is made by the app's own brush engine —
// the Oil Bristle brush with wet colour mixing and canvas grain, the airbrush for glows — on separate layers.
// scripts/paint-artwork.mjs drives it. Everything is seeded: the same script paints the same picture.

(() => {
  'use strict';
  const ed = () => window.__quarc.ed;
  const W = () => ed().page.width, H = () => ed().page.height;

  // ------------------------------------------------------------------ small helpers
  let seed = 20261125;
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
    'paint-oil': { hardness: 1, flow: 0.9, smoothing: 0.3, wet: 0.7, grainDepth: 0.13, grainScale: 1.6 },
    'paint-acrylic': { hardness: 1, flow: 0.95, smoothing: 0.35, wet: 0.25, grainDepth: 0.12, grainScale: 1.6 },
    'paint-airbrush': { hardness: 0, flow: 0.12, smoothing: 0.25, wet: 0 },
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
        let x = xa - rnd(0, o.size * 0.25);
        while (x < xb) {
          const xe = Math.min(xb + o.size * 0.2, x + rnd(o.minLen ?? 120, o.maxLen ?? 380));
          const yy = y + gauss() * o.step * 0.22, tilt = (o.tilt ?? 0) + gauss() * 0.01;
          const c = jit(o.colorAt((x + xe) / 2, yy), o.dh ?? 4, o.ds ?? 0.05, o.dl ?? 0.045);
          await stroke(line(x, yy, xe, yy + (xe - x) * tilt, { amp: o.amp ?? 3, waves: 1, step: o.size > 40 ? 22 : 14 }), { color: c, size: o.size * rnd(0.85, 1.15), opacity: o.opacity ?? 0.92, preset: o.preset, wet: o.wet });
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

  // ------------------------------------------------------------------ the scene
  const horizonY = () => Math.round(H() * 0.6);
  const sun = () => ({ x: W() * 0.63, y: horizonY() - H() * 0.045 });
  const SKY = [[0, '#0e1a44'], [0.16, '#1a3573'], [0.34, '#2b69a0'], [0.50, '#46aab6'], [0.62, '#9fd3b0'], [0.72, '#f3dc92'], [0.84, '#ffb369'], [0.94, '#ff7e5c'], [1, '#ff6b60']];
  function skyAt(x, y) {
    const t = clamp(y / horizonY(), 0, 1), s = sun();
    let c = ramp(SKY, t);
    const dx = (x - s.x) / (W() * 0.42), dy = (y - s.y) / (H() * 0.42);
    return mix(c, '#ffd9a2', Math.exp(-(dx * dx + dy * dy) * 2.4) * 0.6 * smooth(clamp(t * 1.15, 0, 1)));
  }

  function newLayer(name, { blend, opacity } = {}) {
    const e = ed();
    e.setActiveLayer(null); e.ensureRasterTarget();
    const l = e.page.layers[e.page.layers.length - 1];
    l.name = name; if (blend) l.blend = blend; if (opacity !== undefined) l.opacity = opacity;
    e.setActiveLayer(l.id); e.changed('layers', 'doc');
    return l.id;
  }
  function nameFirstLayer(name) { const e = ed(); const l = e.page.layers[0]; l.name = name; e.setActiveLayer(l.id); e.changed('layers'); }

  const api = {};

  // ---- 1. sky ---------------------------------------------------------
  api.sky = async () => {
    nameFirstLayer('Sky');
    const w = W(), hz = horizonY();
    // underpainting: broad flat strokes
    await hatch(rectPoly(-40, -20, w + 40, hz + 30), { step: 34, size: 120, minLen: 650, maxLen: 1100, amp: 9, colorAt: skyAt, dl: 0.03, dh: 3, opacity: 1, wet: 0.25 });
    // second pass: smaller strokes, more colour movement
    await hatch(rectPoly(-40, -10, w + 40, hz + 20), { step: 16, size: 58, minLen: 260, maxLen: 620, amp: 6, colorAt: skyAt, dl: 0.06, dh: 7, ds: 0.07, opacity: 0.8, wet: 0.45, tilt: -0.012 });
  };

  // ---- 2. clouds + sun --------------------------------------------------
  const CLOUDS = [
    { cx: 0.13, cy: 0.33, rx: 0.2, ry: 0.07 }, { cx: 0.50, cy: 0.26, rx: 0.27, ry: 0.055 }, { cx: 0.86, cy: 0.35, rx: 0.2, ry: 0.065 },
    { cx: 0.30, cy: 0.49, rx: 0.25, ry: 0.032 }, { cx: 0.79, cy: 0.52, rx: 0.23, ry: 0.03 }, { cx: 0.58, cy: 0.42, rx: 0.14, ry: 0.036 },
    { cx: 0.04, cy: 0.51, rx: 0.12, ry: 0.028 }, { cx: 0.96, cy: 0.19, rx: 0.15, ry: 0.04 }, { cx: 0.36, cy: 0.16, rx: 0.15, ry: 0.032 },
  ];
  api.clouds = async () => {
    const w = W(), h = H(), s = sun();
    for (const c of CLOUDS) {
      const cx = c.cx * w, cy = c.cy * h, rx = c.rx * w, ry = c.ry * h, warm = clamp((c.cy - 0.18) / 0.34, 0, 1);
      const top = mix('#46599f', '#8a5c9e', warm), bottom = mix('#ee8aa6', '#ffc07c', warm);
      const colorAt = (x, y) => {
        const v = clamp((y - (cy - ry)) / (2 * ry), 0, 1), g = Math.exp(-Math.pow((x - s.x) / (w * 0.34), 2));
        let col = mix(top, bottom, Math.pow(v, 1.35));
        col = mix(col, '#fff0cb', g * 0.4 * v);
        return v > 0.82 ? lighten(col, 0.12 * g + 0.04) : col;
      };
      // a lumpy outline instead of a perfect ellipse
      const poly = [];
      for (let i = 0; i < 44; i++) { const a = (i / 44) * Math.PI * 2, lump = 1 + 0.16 * Math.sin(a * 3 + c.cx * 9) + 0.07 * gauss(); poly.push([cx + Math.cos(a) * rx * lump, cy + Math.sin(a) * ry * lump * (Math.sin(a) > 0 ? 0.8 : 1.15)]); }
      await hatch(poly, { step: 13, size: 40, minLen: 90, maxLen: 300, amp: 3, colorAt, dh: 5, ds: 0.06, dl: 0.05, opacity: 0.9, wet: 0.5, tilt: -0.02 });
    }
    // thin wisps that tie the banks together, peach where the light is
    for (let i = 0; i < 36; i++) {
      const y = rnd(0.36, 0.57) * h, x = rnd(-0.1, 1.0) * w, len = rnd(260, 700), warm = clamp((y / h - 0.3) / 0.27, 0, 1);
      await stroke(line(x, y, x + len, y + gauss() * 8, { amp: 5, waves: 1, step: 26 }), { color: jit(mix('#b57ea8', '#ffb98a', warm), 5, 0.06, 0.05), size: rnd(12, 24), opacity: 0.38, wet: 0.5 });
    }
  };
  api.sun = async () => {
    const s = sun();
    // soft halo: many light dabs of the airbrush, each a little off-centre so no ring ever lines up
    for (const [size, col, n, spread] of [[1500, '#ffb070', 8, 40], [950, '#ffcf8a', 8, 24], [560, '#ffe2a2', 7, 12], [280, '#fff0c4', 6, 5]])
      for (let i = 0; i < n; i++) await dab(s.x + gauss() * spread, s.y + gauss() * spread * 0.6, { preset: 'paint-airbrush', size, color: col, opacity: 0.5 });
    // the disc itself, in thick oil: rows of strokes inside a circle, paler towards the middle
    const disc = []; for (let i = 0; i < 56; i++) { const a = (i / 56) * Math.PI * 2; disc.push([s.x + Math.cos(a) * 66, s.y + Math.sin(a) * 66]); }
    await hatch(disc, { step: 5, size: 26, minLen: 30, maxLen: 120, amp: 1.2, colorAt: (x, y) => mix('#fffdf0', '#ffe39a', clamp(Math.hypot(x - s.x, y - s.y) / 66, 0, 1) ** 1.6), dh: 2, ds: 0.03, dl: 0.015, opacity: 1, wet: 0.55 });
    await contour(disc.concat([disc[0], disc[1]]).map((p) => [s.x + (p[0] - s.x) * 1.0, s.y + (p[1] - s.y) * 1.0]), { colorAt: () => '#fff0bd', size: 15, chunk: 70, opacity: 0.9, wet: 0.5 });
  };

  // ---- 3. headland + lighthouse -----------------------------------------
  api.land = async () => {
    newLayer('Headland');
    const w = W(), hz = horizonY();
    const ridge = (x) => { const u = x / (w * 0.43); return hz - 14 - 118 * Math.exp(-Math.pow((u - 0.34) / 0.34, 2)) - 38 * Math.exp(-Math.pow((u - 0.82) / 0.1, 2)) - 12 * Math.sin(x / 61) - 8 * Math.sin(x / 23 + 1); };
    const poly = [[-30, hz + 6]]; for (let x = -30; x <= w * 0.45; x += 24) poly.push([x, x > w * 0.43 ? hz - 2 : ridge(Math.min(x, w * 0.43))]); poly.push([w * 0.45, hz + 6]);
    const top = (y) => clamp((hz - y) / 135, 0, 1);
    await hatch(poly, { step: 9, size: 24, minLen: 60, maxLen: 200, amp: 2, colorAt: (x, y) => mix('#3d3b7d', '#7a70b4', Math.pow(top(y), 0.8) * 0.9 + 0.05 * Math.sin(x / 90)), dh: 4, ds: 0.05, dl: 0.03, opacity: 0.95, wet: 0.35 });
    await contour(poly.slice(1, -1), { colorAt: () => mix('#6c63aa', '#9186c4', rnd(0, 1)), size: 15, chunk: 130, opacity: 0.85, wet: 0.35 });
    // a low far island at the other end of the horizon
    const isl = (x) => hz - 6 - 26 * Math.exp(-Math.pow((x - w * 0.915) / (w * 0.03), 2)) - 10 * Math.sin(x / 17);
    const ip = [[w * 0.86, hz + 4]]; for (let x = w * 0.86; x <= w * 0.97; x += 14) ip.push([x, isl(x)]); ip.push([w * 0.97, hz + 4]);
    await hatch(ip, { step: 6, size: 14, minLen: 30, maxLen: 120, amp: 1, colorAt: (x, y) => mix('#5b5aa0', '#8b7fb6', clamp((hz - y) / 30, 0, 1)), dl: 0.03, opacity: 0.95, wet: 0.3 });
    // haze at the water line
    await hatch(rectPoly(-30, hz - 14, w * 0.45, hz + 4), { step: 6, size: 18, minLen: 80, maxLen: 240, amp: 1.5, colorAt: () => '#f0a8a2', dl: 0.03, opacity: 0.5, wet: 0.4 });
    // the lighthouse on its point
    const lx = w * 0.352, lb = ridge(w * 0.352) + 6, th = 78;
    await hatch([[lx - 8, lb], [lx + 8, lb], [lx + 5, lb - th], [lx - 5, lb - th]], { step: 5, size: 11, minLen: 6, maxLen: 20, amp: 0.5, colorAt: (x, y) => (Math.floor((y - (lb - th)) / 14) % 2 ? '#c9473c' : '#f6ecdc'), dl: 0.02, opacity: 1, wet: 0 });
    await hatch(rectPoly(lx - 9, lb - th - 12, lx + 9, lb - th), { step: 4, size: 8, minLen: 8, maxLen: 18, colorAt: () => '#ffe9a8', dl: 0.02, opacity: 1, wet: 0 });
    await hatch([[lx - 11, lb - th - 12], [lx + 11, lb - th - 12], [lx, lb - th - 26]], { step: 4, size: 8, minLen: 6, maxLen: 20, colorAt: () => '#2c2a45', opacity: 1, wet: 0 });
    for (let i = 0; i < 5; i++) await dab(lx, lb - th - 6, { preset: 'paint-airbrush', size: 120, color: '#ffe2a0', opacity: 0.5 });
  };

  // ---- 4. sea + reflections + boat -----------------------------------------
  api.sea = async () => {
    newLayer('Sea');
    const w = W(), h = H(), hz = horizonY(), s = sun();
    const SEA = [[0, '#ffbd8e'], [0.05, '#f09984'], [0.16, '#5ab0b4'], [0.38, '#2b8a99'], [0.7, '#14506b'], [1, '#0b2a42']];
    const waveW = (tt) => 30 + 430 * tt;                                   // the sun's glitter path widens towards us
    const colorAt = (x, y) => {
      const tt = clamp((y - hz) / (h - hz), 0, 1);
      let c = ramp(SEA, Math.pow(tt, 0.8));
      const dx = (x - s.x) / waveW(tt), glow = Math.exp(-dx * dx) * (1 - 0.35 * tt);
      c = mix(c, '#ffdb8c', glow * 0.78);
      const ripple = Math.sin(y * 0.19 + Math.sin(x / 140) * 2) * 0.5 + 0.5;  // alternating light / dark bands of water
      return ripple > 0.62 ? lighten(c, 0.09 + 0.1 * glow) : ripple < 0.3 ? darken(c, 0.12) : c;
    };
    // far to near, so the strokes of the foreground overlap those behind
    for (let y = hz + 3; y < h + 70; ) {
      const tt = clamp((y - hz) / (h - hz), 0, 1), step = 9 + 40 * Math.pow(tt, 1.25), size = step * 1.7;
      let x = -rnd(0, 200);
      while (x < w) {
        const len = 140 + 620 * tt * rnd(0.6, 1.2), yy = y + gauss() * step * 0.3;
        const c = jit(colorAt(x + len / 2, yy), 4, 0.05, 0.04);
        await stroke(line(x, yy, x + len, yy + gauss() * 2, { amp: 1.5 + 5 * tt, waves: 1 + Math.round(tt * 2), step: 22 }), { color: c, size, opacity: 0.93, wet: 0.45 });
        x += len * 0.78;
      }
      y += step * rnd(0.8, 1.1);
    }
    // long dark swells and pale crests, slanting a little, so the water is not just stripes
    for (let i = 0; i < 70; i++) {
      const tt = Math.pow(rnd(0.05, 1), 1.0), y = hz + 14 + tt * (h - hz - 40), x = rnd(-100, w), len = 120 + 480 * tt * rnd(0.6, 1.1);
      const dark = R() < 0.55;
      await stroke(line(x, y, x + len, y + gauss() * 6, { amp: 4 + 8 * tt, waves: 2, step: 24 }), { color: jit(dark ? '#0f4560' : '#7fcfcf', 3, 0.05, 0.04), size: 10 + 26 * tt, opacity: dark ? 0.4 : 0.32, wet: 0.35 });
    }
    // glitter: short, bright, thick strokes on the crests inside the sun's path
    for (let i = 0; i < 230; i++) {
      const tt = Math.pow(rnd(0.02, 1), 1.1), y = hz + 6 + tt * (h - hz - 20), dx = gauss() * waveW(tt) * 0.55;
      const len = 20 + 110 * tt * rnd(0.5, 1.2);
      await stroke(line(s.x + dx - len / 2, y, s.x + dx + len / 2, y + gauss(), { step: 10, jitter: 0.3 }), { color: jit(mix('#ffe8a8', '#fffbe9', rnd(0, 1)), 3, 0.04, 0.03), size: 6 + 9 * tt, opacity: 0.95, wet: 0.05 });
    }
  };

  api.boat = async () => {
    newLayer('Boat');
    const w = W(), hz = horizonY(), bx = w * 0.41, by = hz + 112, k = 1.15, P = (x, y) => [bx + x * k, by + y * k];
    // reflection first (it lies on the water, under the hull)
    for (let i = 0; i < 22; i++) { const y = by + 18 * k + i * 7 * k, len = (70 - i * 1.6) * k * rnd(0.7, 1.1); await stroke(line(bx - len / 2 + gauss() * 8, y, bx + len / 2 + gauss() * 8, y, { amp: 2, step: 12 }), { color: jit(i % 3 === 0 ? '#c9814f' : '#1c2540', 3, 0.05, 0.04), size: 8 * k, opacity: 0.85, wet: 0.3 }); }
    for (const [poly, base, hi] of [
      [[P(-84, 0), P(84, 0), P(70, 20), P(40, 29), P(-46, 29), P(-72, 18)], '#1b1d33', '#8a5442'],                // hull
      [[P(-4, -6), P(-4, -205), P(66, -22)], '#ffe6bc', '#fff4dc'],                                              // main sail
      [[P(-12, -8), P(-12, -168), P(-84, -12)], '#e59a86', '#f6c3a4'],                                           // jib (in shade)
    ]) {
      const ys = poly.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
      await hatch(poly, { step: 5 * k, size: 11 * k, minLen: 10, maxLen: 70, amp: 0.6, colorAt: (x, y) => mix(base, hi, clamp((y1 - y) / (y1 - y0), 0, 1) * (base === '#1b1d33' ? 0.18 : 0.55)) , dh: 3, ds: 0.04, dl: 0.03, opacity: 1, wet: 0.1 });
    }
    // mast, boom and the warm light on the hull's rim
    await stroke(line(...P(-4, 8), ...P(-4, -214), { step: 8, jitter: 0.1 }), { color: '#2b2433', size: 4 * k, opacity: 1, wet: 0, pressure: 0.8 });
    await stroke(line(...P(-4, -8), ...P(74, -10), { step: 8, jitter: 0.1 }), { color: '#2b2433', size: 3.5 * k, opacity: 1, wet: 0, pressure: 0.8 });
    await stroke(line(...P(-70, 1), ...P(80, 1), { step: 8, jitter: 0.2 }), { color: '#e8a15d', size: 4 * k, opacity: 0.95, wet: 0, pressure: 0.8 });
  };

  // ---- 5. foreground rocks --------------------------------------------------
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
  api.rocks = async () => {
    newLayer('Foreground');
    const w = W(), h = H(), s = sun(), floor = h + 90;
    const rocks = [
      roughen([[-30, 1150], [70, 1096], [150, 1128], [215, 1078], [310, 1064], [395, 1116], [470, 1180], [545, 1246], [640, 1322], [740, 1396], [800, floor]], 26),
      roughen([[w + 30, 1196], [w - 80, 1172], [w - 170, 1224], [w - 262, 1252], [w - 360, 1324], [w - 450, floor]], 22),
      roughen([[w * 0.56, floor], [w * 0.575, 1396], [w * 0.612, 1374], [w * 0.655, 1402], [w * 0.69, floor]], 10),
    ];
    for (const top of rocks) {
      const poly = top.concat([[top[top.length - 1][0], floor + 40], [top[0][0], floor + 40]]);
      const ys = top.map((p) => p[1]), y0 = Math.min(...ys);
      await hatch(poly, { step: 11, size: 30, minLen: 40, maxLen: 200, amp: 2, tilt: 0.03, colorAt: (x, y) => mix('#14283b', '#030911', clamp((y - y0) / 300, 0, 1) * 0.92 + 0.08 * Math.sin(x / 29)), dh: 5, ds: 0.05, dl: 0.03, opacity: 0.98, wet: 0.12 });
      await contour(top, { colorAt: () => '#0a1522', size: 20, chunk: 160, opacity: 0.95, wet: 0.1 });
      // warm rim light along the stretches of outline that face the sun: whole runs in one go, thick then thin
      let run = [];
      const flush = async () => {
        if (run.length > 2) {
          await stroke(run.map((p) => [p[0] + gauss() * 0.6, p[1] + gauss() * 0.6]), { color: jit(mix('#d9803f', '#f5b565', rnd(0, 1)), 4, 0.05, 0.03), size: rnd(9, 13), opacity: 0.88, wet: 0.1, pressure: 0.85 });
          await stroke(run.filter((_, k) => k % 1 === 0).map((p) => [p[0] + gauss() * 0.5, p[1] + gauss() * 0.5 - 1]), { color: jit('#ffd993', 3, 0.04, 0.03), size: rnd(4, 6), opacity: 0.8, wet: 0, pressure: 0.8 });
        }
        run = [];
      };
      for (let i = 0; i < top.length - 1; i++) {
        const [ax, ay] = top[i], [bx, by] = top[i + 1], ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1;
        const nx = ey / len, ny = -ex / len, mx = (ax + bx) / 2, my = (ay + by) / 2;
        const lit = (s.x - mx) * nx + (s.y - my) * ny > 0 && my < h - 40;
        if (lit) { if (!run.length) run.push([ax + nx * 2, ay + ny * 2]); run.push([bx + nx * 2, by + ny * 2]); if (run.length > 9) await flush(); } else await flush();
      }
      await flush();
    }
    // dark water, reflections of the rim light, ripples and foam at the foot of the rocks
    for (let i = 0; i < 100; i++) {
      const x = rnd(0, 950), y = rnd(1290, h - 4), len = rnd(50, 210), c = R();
      await stroke(line(x, y, x + len, y + gauss() * 2, { amp: 3, step: 16 }), { color: jit(c < 0.5 ? '#245e72' : c < 0.85 ? '#5fb3b8' : '#d9ecd9', 4, 0.05, 0.05), size: rnd(8, 18), opacity: c < 0.85 ? 0.5 : 0.7, wet: 0.3 });
    }
    for (let i = 0; i < 80; i++) {
      const x = rnd(w - 950, w), y = rnd(1330, h - 4), len = rnd(50, 210), c = R();
      await stroke(line(x, y, x + len, y + gauss() * 2, { amp: 3, step: 16 }), { color: jit(c < 0.5 ? '#215a6c' : c < 0.85 ? '#58aab0' : '#d4e8d6', 4, 0.05, 0.05), size: rnd(8, 18), opacity: c < 0.85 ? 0.5 : 0.65, wet: 0.3 });
    }
    // foam along the middle rock
    for (let i = 0; i < 26; i++) { const x = rnd(w * 0.52, w * 0.72), y = rnd(1385, h - 6); await stroke(line(x, y, x + rnd(40, 130), y + gauss() * 2, { amp: 2, step: 12 }), { color: jit('#eaf5ec', 3, 0.03, 0.03), size: rnd(7, 13), opacity: 0.75, wet: 0.2 }); }
  };

  // ---- 6. glaze: warm bloom + vignette + a few thick highlights ------------------
  api.glaze = async () => {
    const e = ed(), w = W(), h = H(), s = sun();
    newLayer('Highlights');
    // impasto accents: thick, bright, unblended
    for (let i = 0; i < 46; i++) {
      const c = CLOUDS[Math.floor(rnd(0, CLOUDS.length))], x = (c.cx + gauss() * c.rx * 0.5) * w, y = (c.cy + c.ry * rnd(0.3, 0.92)) * h, len = rnd(26, 90), sl = gauss() * 0.06;
      const nearSun = Math.exp(-Math.pow((x - s.x) / (w * 0.3), 2));
      await stroke(line(x, y, x + len, y + len * sl, { amp: 2.5, step: 12, jitter: 0.6 }), { color: jit(mix('#ffc98a', '#fff0c8', clamp(nearSun + rnd(0, 0.4), 0, 1)), 5, 0.07, 0.04), size: rnd(10, 19), opacity: 0.8, wet: 0.15 });
    }
    // a few gulls against the glow: two quick arcs each
    newLayer('Gulls');
    for (const [gx, gy, k] of [[0.70, 0.30, 1.0], [0.745, 0.255, 0.8], [0.665, 0.215, 0.7], [0.80, 0.335, 0.6], [0.22, 0.43, 0.55], [0.255, 0.405, 0.45]]) {
      const x = gx * w, y = gy * h, a = 34 * k;
      const col = '#2a2542';
      await stroke([[x - a, y + 4 * k], [x - a * 0.5, y - 7 * k], [x, y + 3 * k]], { color: col, size: 4.5 * k + 1, opacity: 0.95, wet: 0, pressure: 0.8 });
      await stroke([[x, y + 3 * k], [x + a * 0.5, y - 8 * k], [x + a, y + 5 * k]], { color: col, size: 4.5 * k + 1, opacity: 0.95, wet: 0, pressure: 0.8 });
    }
    newLayer('Warm glow', { blend: 'screen', opacity: 0.5 });
    for (let i = 0; i < 6; i++) await dab(s.x, s.y + 30, { preset: 'paint-airbrush', size: 1800, color: '#ff8c4a', opacity: 0.5 });
    for (let i = 0; i < 5; i++) await dab(s.x, s.y, { preset: 'paint-airbrush', size: 700, color: '#ffc77a', opacity: 0.5 });
    // vignette: painted straight onto its own layer with the app's raster surface (a soft radial falloff)
    const vid = newLayer('Vignette', { blend: 'multiply', opacity: 0.75 });
    const layer = e.page.layers.find((l) => l.id === vid), c = layer.surface.canvas.getContext('2d');
    const g = c.createRadialGradient(w * 0.55, h * 0.52, h * 0.38, w * 0.5, h * 0.5, w * 0.78);
    g.addColorStop(0, 'rgba(10,18,40,0)'); g.addColorStop(0.7, 'rgba(10,18,40,0.55)'); g.addColorStop(1, 'rgba(4,8,22,0.95)');
    c.fillStyle = g; c.fillRect(0, 0, w, h); layer.surface.touch();
    e.changed('layers', 'doc');
  };

  window.Painter = api;
})();
