// "Sunflowers" — a still life in oil, painted inside Quarc Draw (on top of kit.js).
// A cream jug of sunflowers on a wooden table against a swirling blue wall, light from the upper left. Every mark is a pen stroke
// through the app's own Oil Bristle brush on the app's layers. Seeded: the same script paints the same picture.

(() => {
  'use strict';
  const K = window.ArtKit;
  const { W, H, rnd, gauss, clamp, mix, lighten, darken, ramp, jit, stroke, dab, hatch, contour, rectPoly, newLayer, nameFirstLayer, ellipsePts, vignette } = K;
  K.seed(1888); // the summer of the sunflowers in Arles

  const api = {};
  const TABLE_Y = 1838, EDGE_Y = 2288, VASE_X = 1000, MOUTH_Y = 1300;
  const LIGHT = (() => { const l = Math.hypot(-1, -1.15); return [-1 / l, -1.15 / l]; })();   // light comes from the upper left

  // ------------------------------------------------------------------ 1. the wall: short curved strokes on a flow field
  const SWIRLS = [[250, 290, 270, 1], [1760, 330, 300, -1], [1840, 1480, 250, 1], [170, 1560, 230, -1], [1000, 160, 220, 1]];
  function flow(x, y) {
    const a = 0.5 * Math.sin(x / 260 + 0.8 * Math.sin(y / 330)) + 0.3 * Math.cos(y / 210 - x / 520);
    let vx = Math.cos(a), vy = Math.sin(a) * 0.6;
    for (const [sx, sy, r, dir] of SWIRLS) { const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy) + 1, w = 1.7 * Math.exp(-((d / r) ** 2)); vx += w * dir * (-dy / d); vy += w * dir * (dx / d); }
    const l = Math.hypot(vx, vy) || 1;
    return [vx / l, vy / l];
  }
  const WALL = [[0, '#6aa7b8'], [0.3, '#4384a0'], [0.6, '#2b6286'], [1, '#173c5c']];
  function wallAt(x, y) {
    let c = ramp(WALL, clamp(x / W() * 0.42 + y / TABLE_Y * 0.7, 0, 1));
    const halo = Math.exp(-(((x - 1000) / 820) ** 2 + ((y - 820) / 760) ** 2));          // a paler glow behind the bouquet
    return mix(c, '#8cc0c8', halo * 0.28);
  }
  api.wall = async () => {
    nameFirstLayer('Wall');
    await hatch(rectPoly(-40, -20, W() + 40, TABLE_Y + 40), { step: 32, size: 118, minLen: 500, maxLen: 900, amp: 8, colorAt: wallAt, dh: 4, dl: 0.03, opacity: 1, wet: 0.3 });
    // the swirling brushwork: a jittered grid of starting points, each stroke follows the field for a little while
    const sp = 50;
    for (let y = sp * 0.4; y < TABLE_Y + 20; y += sp) for (let x = sp * 0.4; x < W(); x += sp) {
      let px = x + gauss() * sp * 0.35, py = y + gauss() * sp * 0.35;
      const pts = [[px, py]], len = rnd(70, 135), steps = 6;
      for (let i = 0; i < steps; i++) { const [dx, dy] = flow(px, py); px += (dx * len) / steps; py += (dy * len) / steps; pts.push([px, py]); }
      const r = rnd(0, 1);
      let c = wallAt(x, y);
      if (r < 0.14) c = lighten(c, 0.14); else if (r < 0.24) c = darken(c, 0.16); else if (r < 0.29) c = mix(c, '#3f8a86', 0.5);
      await stroke(pts, { color: jit(c, 6, 0.07, 0.05), size: rnd(22, 34), opacity: 0.88, wet: 0.4 });
    }
  };

  // ------------------------------------------------------------------ 2. the table
  api.table = async () => {
    newLayer('Table');
    const w = W(), h = H();
    const top = (x, y) => { const t = clamp((y - TABLE_Y) / (EDGE_Y - TABLE_Y), 0, 1); return mix(mix('#9c5e26', '#d79a4c', t), '#e8b468', clamp(0.35 - x / w, 0, 0.35)); };
    await hatch(rectPoly(-40, TABLE_Y - 10, w + 40, h + 30), { step: 30, size: 72, minLen: 500, maxLen: 1000, amp: 2, colorAt: (x, y) => (y < EDGE_Y ? top(x, y) : '#5a2d13'), dh: 3, dl: 0.03, opacity: 1, wet: 0.25 });
    await hatch(rectPoly(-40, TABLE_Y - 6, w + 40, EDGE_Y + 8), { step: 16, size: 34, minLen: 220, maxLen: 640, amp: 2, tilt: 0.004, colorAt: top, dh: 4, ds: 0.06, dl: 0.04, opacity: 0.97, wet: 0.45 });
    for (let i = 0; i < 70; i++) {                                                         // grain of the wood
      const y = rnd(TABLE_Y + 8, EDGE_Y - 6), x = rnd(-100, w), len = rnd(200, 700);
      await stroke(K.line(x, y, x + len, y + len * 0.004 + gauss() * 2, { amp: 2, step: 24 }), { color: jit(R0() < 0.6 ? '#7a421a' : '#e2a85c', 4, 0.05, 0.04), size: rnd(4, 8), opacity: 0.5, wet: 0.3 });
    }
    await hatch(rectPoly(-40, EDGE_Y, w + 40, h + 30), { step: 15, size: 28, minLen: 200, maxLen: 600, amp: 1.5, colorAt: (x, y) => mix('#71391a', '#3c1f0d', clamp((y - EDGE_Y) / (h - EDGE_Y), 0, 1)), dh: 4, dl: 0.03, opacity: 0.98, wet: 0.3 });
    await contour(Array.from({ length: 21 }, (_, i) => [-10 + (i * (w + 20)) / 20, EDGE_Y + gauss() * 0.8]), { colorAt: () => '#eab56a', size: 9, chunk: 260, opacity: 0.9, wet: 0.2 });
  };
  const R0 = () => rnd(0, 1);

  // ------------------------------------------------------------------ the flowers' geometry
  const HEADS = [
    { x: 1190, y: 395, r: 122, tilt: 0.75, rot: 0.25 },
    { x: 1000, y: 650, r: 232, tilt: 1.0, rot: 0.1 },
    { x: 590, y: 860, r: 192, tilt: 0.82, rot: -0.35 },
    { x: 1420, y: 845, r: 204, tilt: 0.8, rot: 0.4 },
    { x: 380, y: 1320, r: 150, tilt: 0.55, rot: -0.72, droop: true },
    { x: 1630, y: 1340, r: 142, tilt: 0.5, rot: 0.78, droop: true },
    { x: 765, y: 1095, r: 160, tilt: 0.9, rot: -0.15 },
    { x: 1262, y: 1105, r: 156, tilt: 0.72, rot: 0.55 },
  ];
  /** a point in a flower head's own (round) coordinates, turned and foreshortened into the picture */
  const local = (h, u, v) => [h.x + u * Math.cos(h.rot) - v * h.tilt * Math.sin(h.rot), h.y + u * Math.sin(h.rot) + v * h.tilt * Math.cos(h.rot)];

  // a leaf: strokes running from the stalk to the tip, lighter on the side the light reaches, with veins and a darker edge
  async function leaf(bx, by, ang, len, wid, bend, light = 0.5) {
    const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    const at = (t, s) => { const hw = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.8) * (t > 0.92 ? (1 - t) / 0.08 : 1); return [bx + dx * len * t + nx * (bend * len * t * t + s * hw), by + dy * len * t + ny * (bend * len * t * t + s * hw)]; };
    const side = (s) => clamp(light + 0.32 * (nx * LIGHT[0] + ny * LIGHT[1]) * Math.sign(s || 1), 0, 1);   // the half turned to the light is lighter
    for (const s of [-0.85, -0.62, -0.38, -0.14, 0.14, 0.38, 0.62, 0.85]) {
      const sh = side(s) + gauss() * 0.06;
      await stroke(Array.from({ length: 12 }, (_, i) => at(i / 11, s + gauss() * 0.03)), { color: jit(ramp([[0, '#2f4a1a'], [0.45, '#557a2b'], [0.8, '#86aa45'], [1, '#b5cc6a']], clamp(sh, 0, 1)), 6, 0.07, 0.05), size: wid * 0.42, opacity: 0.93, wet: 0.45 });
    }
    for (let k = 1; k <= 5; k++) for (const sg of [-1, 1]) {                               // veins, running forward from the midrib
      const t0 = k / 6.2, t1 = Math.min(0.97, t0 + 0.16), a = at(t0, 0), b = at(t1, sg * 0.72);
      await stroke([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b], { color: jit(side(sg) > 0.55 ? '#a8c463' : '#36521c', 3, 0.05, 0.03), size: Math.max(3, wid * 0.06), opacity: 0.65, wet: 0.15, pressure: 0.75 });
    }
    await stroke(Array.from({ length: 10 }, (_, i) => at(i / 9 * 0.92, 0)), { color: jit('#c3d688', 3, 0.04, 0.03), size: Math.max(3, wid * 0.08), opacity: 0.85, wet: 0.1, pressure: 0.8 });
    const dark = side(-1) < side(1) ? -1 : 1;
    await stroke(Array.from({ length: 14 }, (_, i) => at(0.04 + (i / 13) * 0.93, dark * 0.98)), { color: '#26391a', size: Math.max(4, wid * 0.08), opacity: 0.7, wet: 0.1, pressure: 0.75 });
  }

  // ------------------------------------------------------------------ 3. the jug (the stems and leaves in its mouth come after it, in 4)
  const PROFILE = [[1290, 150], [1330, 127], [1400, 120], [1480, 176], [1580, 246], [1700, 272], [1820, 252], [1920, 200], [1972, 168]];
  const vr = (y) => { for (let i = 1; i < PROFILE.length; i++) if (y <= PROFILE[i][0]) { const [y0, r0] = PROFILE[i - 1], [y1, r1] = PROFILE[i], t = (y - y0) / (y1 - y0), s = t * t * (3 - 2 * t); return r0 + (r1 - r0) * s; } return PROFILE[PROFILE.length - 1][1]; };
  const BANDS = [[1632, 1688], [1752, 1770]];
  api.vase = async () => {
    newLayer('Shadow');
    await hatch(ellipsePts(1235, 1992, 330, 52, -0.04), { step: 9, size: 22, minLen: 60, maxLen: 260, amp: 1, colorAt: (x) => mix('#5a2f13', '#8b5222', clamp((x - 1000) / 560, 0, 1)), dl: 0.03, opacity: 0.6, wet: 0.6 });
    newLayer('Jug');
    const left = [], right = [];
    for (let y = 1290; y <= 1972; y += 8) { left.push([VASE_X - vr(y), y]); right.push([VASE_X + vr(y), y]); }
    // the silhouette, walked once round: down the left side, along the curved foot (left to right), up the right side
    const foot = Array.from({ length: 17 }, (_, i) => { const a = Math.PI - (i / 16) * Math.PI; return [VASE_X + 168 * Math.cos(a), 1972 + 24 * Math.sin(a)]; });
    const outline = [...left, ...foot, ...right.slice().reverse()];
    const body = outline;
    const shade = (x, y) => clamp((x - VASE_X) / vr(y), -1, 1);
    const cream = (u) => ramp([[0, '#fffaf0'], [0.18, '#f3e9d1'], [0.45, '#d9cdb0'], [0.75, '#a39a86'], [1, '#6c6862']], clamp((u + 0.62) / 1.5, 0, 1));
    const blue = (u) => ramp([[0, '#6d8fd0'], [0.25, '#3f63b4'], [0.6, '#2b4a92'], [1, '#18275a']], clamp((u + 0.62) / 1.5, 0, 1));
    await hatch(body, {
      step: 9, size: 21, minLen: 40, maxLen: 130, amp: 1.6, dh: 3, ds: 0.035, dl: 0.022, opacity: 0.97, wet: 0.45, inset: 9,
      colorAt: (x, y) => { const u = shade(x, y); let c = BANDS.some(([a, b]) => y >= a && y <= b) ? blue(u) : cream(u); if (u > 0.72) c = mix(c, '#5d86a0', 0.3 * (u - 0.72) / 0.28); return c; },
    });
    // form-following highlight and the outline painters of the time loved
    for (let k = 0; k < 3; k++) { const off = -0.5 + gauss() * 0.05; await stroke(Array.from({ length: 14 }, (_, i) => { const y = 1450 + i * 30 + rnd(-4, 4); return [VASE_X + off * vr(y), y]; }), { color: jit('#fffdf6', 2, 0.03, 0.02), size: rnd(10, 16), opacity: 0.45, wet: 0.4 }); }
    await contour(outline, { colorAt: () => '#33445c', size: 9, chunk: 180, opacity: 0.7, wet: 0.15 });
    // the mouth: dark inside, cream lip
    await hatch(ellipsePts(VASE_X, 1292, 132, 24), { step: 6, size: 12, minLen: 30, maxLen: 120, colorAt: () => '#2d2319', dl: 0.03, opacity: 1, wet: 0.2 });
    await contour(ellipsePts(VASE_X, 1292, 148, 30).concat([[VASE_X + 148, 1292]]), { colorAt: () => '#efe4c8', size: 13, chunk: 160, opacity: 0.95, wet: 0.2 });
  };

  // ------------------------------------------------------------------ 4. the bouquet in the jug (after the jug: the stems go down into its dark mouth)
  const LIP = (x) => MOUTH_Y - 8 + 30 * Math.sqrt(Math.max(0, 1 - ((x - VASE_X) / 148) ** 2));   // the front edge of the lip at x
  api.stems = async () => {
    newLayer('Stems');
    // leaves rising out of the mouth
    await leaf(900, 1288, Math.PI * 1.08, 300, 66, -0.18, 0.7);
    await leaf(1100, 1288, -0.2, 320, 70, 0.2, 0.35);
    await leaf(1005, 1285, -1.45, 230, 52, -0.15, 0.6);
    for (const h of HEADS) {
      const thick = 16 + h.r * 0.07;
      const mx = VASE_X + clamp((h.x - VASE_X) * 0.12, -85, 85) + gauss() * 8;
      const my = LIP(mx) + 5 - thick * 0.5;                    // the round end of the stem lies under the cream lip, painted over it below
      // leaning stems rise steeply out of the mouth and curve to their head; the drooping ones arch over the rim
      const cx = h.droop ? (h.x + mx) / 2 + (h.x - VASE_X) * 0.05 : mx + (h.x - mx) * 0.3;
      const cy = h.droop ? Math.min(h.y, my) - 0.95 * Math.abs(h.x - mx) : h.y + (my - h.y) * 0.5;   // a drooping head hangs from a neck that rises out of the jug, arches, and bends down
      const pts = Array.from({ length: 24 }, (_, k) => { const t = k / 23, u = 1 - t; return [u * u * h.x + 2 * u * t * cx + t * t * mx, u * u * h.y + 2 * u * t * cy + t * t * my]; });
      await stroke(pts, { color: jit('#4b6a28', 4, 0.05, 0.04), size: thick, opacity: 0.97, wet: 0.3, pressure: 0.85 });
      await stroke(pts.map(([x, y]) => [x - thick * 0.25, y - 2]), { color: jit('#87a845', 4, 0.05, 0.04), size: thick * 0.35, opacity: 0.85, wet: 0.2, pressure: 0.8 });
      const inside = pts.filter(([x, y]) => y > MOUTH_Y - 28 && Math.abs(x - VASE_X) < 140);   // down in the jug the stem is in shadow
      if (inside.length > 1) await stroke(inside, { color: '#18230f', size: thick * 1.02, opacity: 0.58, wet: 0.1, pressure: 0.85 });
    }
    // the front lip goes back over the stems' ends, so they really are inside the jug
    const lip = Array.from({ length: 25 }, (_, k) => { const a = (Math.PI * k) / 24; return [VASE_X + 148 * Math.cos(a), 1292 + 30 * Math.sin(a)]; });
    await contour(lip, { colorAt: () => '#efe4c8', size: 13, chunk: 160, opacity: 0.97, wet: 0.2 });
  };

  // ------------------------------------------------------------------ 5. the sunflowers
  async function petal(h, a, rIn, rOut, width, color, highlight) {
    const bend = gauss() * 0.1, pts = [];
    for (let i = 0; i <= 7; i++) { const t = i / 7, rr = rIn + (rOut - rIn) * t, aa = a + bend * Math.sin(Math.PI * t); pts.push(local(h, Math.cos(aa) * rr, Math.sin(aa) * rr)); }
    await stroke(pts, { color, size: width, opacity: 0.96, wet: 0.25, pressure: rnd(0.75, 0.95) });
    if (highlight) await stroke(pts.slice(1, 6), { color: highlight, size: width * 0.32, opacity: 0.85, wet: 0.1, pressure: 0.8 });
  }
  /** how much a direction in the head's plane faces the light (0..1) */
  function lit(h, a) { const [x0, y0] = local(h, 0, 0), [x1, y1] = local(h, Math.cos(a), Math.sin(a)); const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1; return 0.5 + 0.5 * ((dx * LIGHT[0] + dy * LIGHT[1]) / l); }
  async function head(h) {
    const { r } = h, rd = r * 0.43;
    // back ring: deeper orange petals
    const n1 = 24 + Math.round(r / 40);
    for (let i = 0; i < n1; i++) { const a = (i / n1) * Math.PI * 2 + gauss() * 0.05; await petal(h, a, rd * 0.9, r * rnd(0.98, 1.18), r * 0.2, jit(mix('#b8650f', '#e0921a', lit(h, a)), 4, 0.06, 0.04)); }
    // front ring: bright yellow, lighter where the light falls
    for (let i = 0; i < n1; i++) {
      const a = ((i + 0.5) / n1) * Math.PI * 2 + gauss() * 0.06, f = lit(h, a);
      await petal(h, a, rd * 0.95, r * rnd(0.86, 1.06), r * 0.19, jit(mix('#e7a11a', '#ffe36a', f), 4, 0.06, 0.04), f > 0.62 ? jit('#fff1a6', 3, 0.04, 0.03) : null);
    }
    // the disk, painted in rings as it grows, then the seeds: small round touches laid along the spiral (golden angle),
    // fresh green-ochre florets round the rim, a little lighter where the light falls
    for (let rr = rd; rr > rd * 0.1; rr -= r * 0.05) {
      const ring = ellipsePts(0, 0, rr, rr, 0, Math.max(16, Math.round(rr / 4))).map(([u, v]) => local(h, u, v));
      await contour(ring.concat([ring[0], ring[1]]), { colorAt: () => mix('#2e1a0c', '#4a2a12', rr / rd), size: r * 0.07, chunk: r * 0.7, opacity: 1, wet: 0.35 });
    }
    const n = Math.round((rd * rd) / 52);
    for (let k = 0; k < n; k++) {
      const rr = rd * Math.sqrt((k + 0.5) / n), a = k * 2.39996, rim = rr / rd;
      const c = rim > 0.83 ? mix('#7d6a22', '#b89a3a', rnd(0, 1)) : ['#24130a', '#6e3f16', '#94591d', '#4a2a10'][k % 4];
      const len = 2 + r * 0.012, ta = a + Math.PI / 2;                                         // a short touch across the spiral
      const p0 = local(h, Math.cos(a) * rr - Math.cos(ta) * len, Math.sin(a) * rr - Math.sin(ta) * len), p1 = local(h, Math.cos(a) * rr + Math.cos(ta) * len, Math.sin(a) * rr + Math.sin(ta) * len);
      await stroke([p0, p1], { preset: 'paint-gouache', color: jit(lighten(c, lit(h, a) * rim * 0.2), 4, 0.05, 0.04), size: 4 + r * 0.024, opacity: 0.95, wet: 0, pressure: 0.9 });
    }
    await contour(ellipsePts(0, 0, rd, rd, 0, 36).map(([u, v]) => local(h, u, v)).concat([local(h, rd, 0)]), { colorAt: () => '#7a3f10', size: r * 0.05, chunk: r * 0.8, opacity: 0.8, wet: 0.2 });
  }
  api.flowers = async () => {
    newLayer('Sunflowers');
    for (const h of HEADS) await head(h);
  };

  // ------------------------------------------------------------------ 6. front leaves, fallen petals, light
  api.details = async () => {
    newLayer('Front leaves');
    await leaf(940, 1306, Math.PI * 0.72, 330, 70, 0.22, 0.75);
    await leaf(1075, 1306, Math.PI * 0.2, 290, 62, -0.25, 0.4);
    newLayer('Fallen petals');
    for (const [x, y, a, c, bend] of [[690, 2050, -0.35, '#f2b72a', 0.18], [1440, 2110, 2.75, '#f6c63d', -0.15], [1540, 2058, 0.15, '#c98a2a', 0.22]]) {
      const len = 105, pt = (t, off) => { const b = bend * Math.sin(Math.PI * t) * len; return [x + Math.cos(a) * len * t - Math.sin(a) * (b + off), y + Math.sin(a) * len * t + Math.cos(a) * (b + off)]; };
      await stroke(Array.from({ length: 7 }, (_, i) => { const [px, py] = pt(i / 6, 0); return [px + 9, py + 13]; }), { color: '#5e2f12', size: 34, opacity: 0.4, wet: 0.5 });   // its shadow on the wood
      for (const off of [-7, 0, 7]) await stroke(Array.from({ length: 7 }, (_, i) => pt(i / 6, off * Math.sin(Math.PI * i / 6))), { color: jit(off < 0 ? lighten(c, 0.12) : off > 0 ? darken(c, 0.1) : c, 3, 0.05, 0.03), size: 22, opacity: 0.97, wet: 0.25 });
      await stroke([pt(0.25, -4), pt(0.5, -5), pt(0.72, -4)], { color: '#fff0a8', size: 7, opacity: 0.85, wet: 0.1, pressure: 0.8 });
    }
  };
  api.glaze = async () => {
    newLayer('Warm light', { blend: 'screen', opacity: 0.38 });
    for (let i = 0; i < 6; i++) await dab(260 + gauss() * 30, 250 + gauss() * 30, { preset: 'paint-airbrush', size: 1700, color: '#ffd59a', opacity: 0.45 });
    for (let i = 0; i < 4; i++) await dab(950 + gauss() * 30, 800 + gauss() * 30, { preset: 'paint-airbrush', size: 1100, color: '#ffc866', opacity: 0.35 });
    vignette('Vignette', { cx: 0.47, cy: 0.42, inner: 0.42, color: '22,14,8', strength: 0.9, opacity: 0.62 });
  };

  window.Painter = {
    title: 'Sunflowers', file: 'sunflowers', width: 2000, height: 2500,
    phases: ['wall', 'table', 'vase', 'stems', 'flowers', 'details', 'glaze'], run: api,
    crops: [['crop-flower', 740, 390, 520, 520], ['crop-mouth', 560, 950, 900, 520], ['crop-jug', 700, 1250, 620, 800]],
  };
})();
