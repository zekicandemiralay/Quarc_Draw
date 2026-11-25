// "Campfire by the Lake" — a night landscape in oil, painted inside Quarc Draw (on top of kit.js).
// Stars and the Milky Way over moonlit mountains, a still lake, and on the near shore a campfire, a glowing tent and someone keeping
// warm on a tree stump. Two lights: the cold crescent moon up right, the warm fire below. Every mark is a pen stroke through the app's
// own brushes, on the app's layers. Seeded: the same script paints the same picture.

(() => {
  'use strict';
  const K = window.ArtKit;
  const { W, H, R, rnd, gauss, clamp, mix, lighten, darken, ramp, jit, stroke, dab, line, hatch, contour, rectPoly, newLayer, nameFirstLayer, ellipsePts, vignette, flowFill } = K;
  K.seed(2207); // a summer night

  const api = {};
  const LAKE_Y = 905;                                   // where the far shore meets the water
  const FIRE = { x: 1500, y: 1262 };                    // the base of the flames
  const MOON = { x: 2060, y: 250, r: 54 };
  const shoreY = (x) => 1128 + 22 * Math.sin(x / 310 + 0.6) + 12 * Math.sin(x / 97);
  /** how much firelight reaches a point (0..1) — it falls off quickly, flattened because the ground recedes */
  const fireLight = (x, y, reach = 620) => { const dx = (x - FIRE.x) / reach, dy = (y - FIRE.y) / (reach * 0.62); return Math.exp(-(dx * dx + dy * dy) * 1.6); };
  /** fill the rows of a shape given as spans per row */
  async function rowFill(y0, y1, step, spans, o) {
    for (let y = y0; y <= y1; y += step) for (const [xa, xb] of spans(y)) {
      let x = xa;
      while (x < xb - 0.5) {
        const xe = Math.min(xb, x + rnd(o.minLen ?? 20, o.maxLen ?? 90));
        await stroke(line(x, y + gauss() * 0.4, xe, y + gauss() * 0.4, { step: 6, jitter: 0.2 }), { preset: o.preset, color: jit(o.colorAt((x + xe) / 2, y), 2, 0.03, 0.02), size: o.size, opacity: o.opacity ?? 1, wet: o.wet ?? 0.1, pressure: 0.9 });
        x = xe - o.size * 0.3;
        if (xe >= xb) break;
      }
    }
  }
  /** a smooth "noise" from a few sine waves (deterministic) */
  const waves = (x, list) => list.reduce((s, [a, l, p]) => s + a * Math.sin(x / l + p), 0);

  // ------------------------------------------------------------------ 1. the night sky
  const SKY = [[0, '#040817'], [0.3, '#0a1331'], [0.62, '#13244a'], [0.85, '#1c3560'], [1, '#27466e']];
  function skyAt(x, y) {
    const t = clamp(y / LAKE_Y, 0, 1);
    let c = ramp(SKY, t);
    const dm = Math.hypot(x - MOON.x, (y - MOON.y) * 1.1);
    c = mix(c, '#3a5688', Math.exp(-((dm / 480) ** 2)) * 0.45);                         // the moon lights its corner of the sky
    if (t > 0.78) c = mix(c, '#3b3360', (t - 0.78) / 0.22 * 0.3 * clamp(1.2 - x / 1600, 0, 1)); // the last violet of dusk, low in the west
    return c;
  }
  api.sky = async () => {
    nameFirstLayer('Night sky');
    await hatch(rectPoly(-40, -20, W() + 40, LAKE_Y + 40), { step: 34, size: 118, minLen: 600, maxLen: 1050, amp: 8, colorAt: skyAt, dh: 3, ds: 0.04, dl: 0.018, opacity: 1, wet: 0.3 });
    await hatch(rectPoly(-40, LAKE_Y, W() + 40, H() + 40), { step: 34, size: 120, minLen: 600, maxLen: 1050, amp: 4, colorAt: (x, y) => mix('#0f1b38', '#0b0f19', clamp((y - LAKE_Y) / 400, 0, 1)), dh: 3, dl: 0.015, opacity: 1, wet: 0.2 });
    await hatch(rectPoly(-40, -10, W() + 40, LAKE_Y + 20), { step: 18, size: 54, minLen: 260, maxLen: 640, amp: 6, colorAt: skyAt, dh: 5, ds: 0.05, dl: 0.03, opacity: 0.7, wet: 0.45, tilt: -0.01 });
  };

  // ------------------------------------------------------------------ 2. the Milky Way and the stars
  const BAND = { x0: 120, y0: 860, x1: 2420, y1: -120 };
  const bandAt = (t) => [BAND.x0 + (BAND.x1 - BAND.x0) * t, BAND.y0 + (BAND.y1 - BAND.y0) * t];
  const BAND_N = (() => { const dx = BAND.x1 - BAND.x0, dy = BAND.y1 - BAND.y0, l = Math.hypot(dx, dy); return [-dy / l, dx / l]; })();
  const inBand = (t, off) => { const [x, y] = bandAt(t); return [x + BAND_N[0] * off, y + BAND_N[1] * off]; };
  api.milkyway = async () => {
    newLayer('Milky Way', { blend: 'screen', opacity: 0.9 });
    for (let i = 0; i < 170; i++) {                                                         // the soft river of light
      const t = rnd(0, 1), w = 150 + 70 * Math.sin(Math.PI * t), [x, y] = inBand(t, gauss() * w * 0.5);
      await dab(x, y, { preset: 'paint-airbrush', size: rnd(240, 420), color: jit(mix('#3d4b86', '#8a80bd', rnd(0, 1)), 6, 0.06, 0.04), opacity: 0.75 });
    }
    for (let i = 0; i < 90; i++) {                                                          // a brighter thread along its middle
      const t = rnd(0.1, 0.85), [x, y] = inBand(t, gauss() * 34);
      await dab(x, y, { preset: 'paint-airbrush', size: rnd(80, 150), color: jit('#cfc6ee', 5, 0.05, 0.03), opacity: 0.5 });
    }
    for (let i = 0; i < 46; i++) {                                                          // its brighter heart
      const t = rnd(0.32, 0.62), [x, y] = inBand(t, gauss() * 60);
      await dab(x, y, { preset: 'paint-airbrush', size: rnd(140, 240), color: jit(mix('#c9bde8', '#ead3c4', rnd(0, 1)), 5, 0.05, 0.03), opacity: 0.45 });
    }
    newLayer('Dust lanes', { opacity: 0.55 });                                              // the dark rifts of dust along it
    for (let i = 0; i < 60; i++) {
      const t = rnd(0.12, 0.85), [x, y] = inBand(t, 22 * Math.sin(t * 9) + gauss() * 18);
      await dab(x, y, { preset: 'paint-airbrush', size: rnd(70, 150), color: '#050b20', opacity: 0.55 });
    }
  };
  api.stars = async () => {
    newLayer('Stars');
    const tints = ['#ffffff', '#dfe8ff', '#fff3d9', '#cddcff', '#ffffff'];
    for (let i = 0; i < 950; i++) {
      let x, y;
      if (rnd(0, 1) < 0.58) { const t = rnd(0, 1); [x, y] = inBand(t, gauss() * (90 + 60 * Math.sin(Math.PI * t))); }
      else { x = rnd(0, W()); y = Math.pow(rnd(0, 1), 1.25) * (LAKE_Y - 120); }
      if (y < 2 || y > LAKE_Y - 40 || Math.hypot(x - MOON.x, y - MOON.y) < MOON.r * 1.6) continue;
      const big = Math.pow(rnd(0, 1), 3);
      await dab(x, y, { preset: 'paint-gouache', size: 1.6 + big * 3.6, color: tints[i % tints.length], opacity: clamp(0.45 + big + rnd(0, 0.3), 0, 1) });
    }
    for (let i = 0; i < 26; i++) {                                                          // a few bright ones, with a glint
      const x = rnd(60, W() - 60), y = rnd(20, LAKE_Y - 260);
      if (Math.hypot(x - MOON.x, y - MOON.y) < 160) continue;
      await dab(x, y, { preset: 'paint-airbrush', size: 46, color: '#bcd0ff', opacity: 0.5 });
      await dab(x, y, { preset: 'paint-gouache', size: rnd(5, 7), color: '#ffffff', opacity: 1 });
      const g = rnd(12, 22);
      await stroke([[x - g, y], [x + g, y]], { preset: 'paint-gouache', color: '#e9f0ff', size: 1.4, opacity: 0.55, pressure: 0.7 });
      await stroke([[x, y - g], [x, y + g]], { preset: 'paint-gouache', color: '#e9f0ff', size: 1.4, opacity: 0.55, pressure: 0.7 });
    }
  };

  // ------------------------------------------------------------------ 3. the crescent moon
  api.moon = async () => {
    newLayer('Moon');
    for (const [size, col, n] of [[620, '#4c66a2', 5], [300, '#8ea6d8', 4], [150, '#c9d6f2', 3]]) for (let i = 0; i < n; i++) await dab(MOON.x + gauss() * 6, MOON.y + gauss() * 6, { preset: 'paint-airbrush', size, color: col, opacity: 0.45 });
    const { x: mx, y: my, r } = MOON, ix = mx + 24, iy = my - 13, ir = r * 0.93;
    // the lit sliver: rows of the disc minus the disc of the shadow
    const spans = (y) => {
      const dy = y - my; if (Math.abs(dy) >= r) return [];
      const h = Math.sqrt(r * r - dy * dy), out = [mx - h, mx + h], di = y - iy;
      if (Math.abs(di) >= ir) return [out];
      const hi = Math.sqrt(ir * ir - di * di), inn = [ix - hi, ix + hi], res = [];
      if (inn[0] > out[0]) res.push([out[0], Math.min(out[1], inn[0])]);
      if (inn[1] < out[1]) res.push([Math.max(out[0], inn[1]), out[1]]);
      return res;
    };
    await rowFill(my - r, my + r, 3, spans, { size: 6, minLen: 10, maxLen: 50, colorAt: (x, y) => mix('#fffbe8', '#d9cfa8', clamp((x - (mx - r)) / (r * 1.2), 0, 1)), opacity: 1, wet: 0.2 });
    // the faint "earthshine" on the dark part
    await rowFill(my - r + 4, my + r - 4, 6, (y) => { const di = y - iy; if (Math.abs(di) >= ir - 2) return []; const hi = Math.sqrt((ir - 2) ** 2 - di * di), dy = y - my; if (Math.abs(dy) >= r) return []; const h = Math.sqrt(r * r - dy * dy); return [[Math.max(mx - h, ix - hi), Math.min(mx + h, ix + hi)]]; }, { size: 8, minLen: 20, maxLen: 70, colorAt: () => '#1e2d55', opacity: 0.5, wet: 0.4 });
  };

  // ------------------------------------------------------------------ 4. moonlit mountains, far to near
  /** a sharp peak: a tent shape with slightly concave flanks */
  const peak = (x, cx, w, h) => h * Math.pow(Math.max(0, 1 - Math.abs(x - cx) / w), 1.35);
  const RIDGES = [
    { name: 'Far mountains', f: (x) => LAKE_Y - 300 - peak(x, 640, 460, 230) - peak(x, 1150, 330, 120) - peak(x, 1760, 520, 300) - peak(x, 2330, 360, 150) - waves(x, [[22, 140, 0.3], [11, 47, 1.7], [5, 17, 0.9]]), base: '#1d2a50', lit: '#6276aa', haze: '#2a3d6c', snow: true },
    { name: 'Mountains', f: (x) => LAKE_Y - 160 - peak(x, 330, 420, 170) - peak(x, 950, 300, 90) - peak(x, 2170, 460, 190) - waves(x, [[18, 88, 1.1], [9, 31, 0.4], [4, 11, 2.2]]), base: '#111b37', lit: '#2f4373', haze: '#1b2b52' },
    { name: 'Hills', f: (x) => LAKE_Y - 50 - peak(x, 1250, 700, 46) - waves(x, [[12, 70, 0.7], [6, 27, 1.9]]), base: '#0a1226', lit: '#1a2848', haze: '#13213f' },
  ];
  api.mountains = async () => {
    for (const R of RIDGES) {
      newLayer(R.name);
      const poly = [[-40, LAKE_Y + 6]]; for (let x = -40; x <= W() + 40; x += 8) poly.push([x, R.f(x)]); poly.push([W() + 40, LAKE_Y + 6]);
      const slope = (x) => (R.f(x + 5) - R.f(x - 5)) / 10;                                    // > 0: the face looks right, to the moon
      // the mass, the way a painter builds a mountain: strokes laid along each face — parallel to the ridge above on the big
      // planes, and some down the fall line into the gullies — light planes where a face turns to the moon, dark where it turns away
      const ridgeAngle = (x) => Math.atan2(R.f(x + 10) - R.f(x - 10), 20);
      const faceColor = (x, y) => {
        const sl = slope(x), d = clamp((y - R.f(x)) / Math.max(40, LAKE_Y - R.f(x)), 0, 1);
        let c = sl > 0.04 ? mix(R.lit, R.base, 0.15 + d * 0.75) : mix(R.base, '#060a18', 0.25 + (1 - d) * 0.2);
        return mix(c, R.haze, clamp((y - (LAKE_Y - 110)) / 110, 0, 1) * 0.55);              // mist gathers at their feet
      };
      const dir = (x, y) => { const sl = slope(x); return rnd(0, 1) < 0.78 ? ridgeAngle(x) : Math.PI / 2 - Math.sign(sl || 1) * 0.45; };
      await flowFill(poly, { dir, colorAt: faceColor, spacing: 30, len: [60, 150], size: [18, 30], wobble: 0.1, opacity: 1, wet: 0.35, dl: 0.03 });
      await flowFill(poly, { dir, colorAt: faceColor, spacing: 20, len: [30, 90], size: [8, 16], wobble: 0.14, opacity: 0.85, wet: 0.4, dl: 0.045 });
      await contour(poly.slice(1, -1), { colorAt: () => R.base, size: 12, chunk: 160, opacity: 0.9, wet: 0.25 });   // a clean silhouette
      // a moonlit rim only along the edges facing the moon
      let run = [];
      for (let x = -40; x <= W() + 40; x += 8) {
        if (slope(x) > 0.03) run.push([x, R.f(x) + 1.5]);
        else if (run.length) { if (run.length > 2) await contour(run, { colorAt: () => mix(R.lit, '#b7c6e6', R.snow ? 0.45 : 0.15), size: 4, chunk: 120, opacity: 0.75, wet: 0.2 }); run = []; }
      }
      if (run.length > 2) await contour(run, { colorAt: () => mix(R.lit, '#b7c6e6', R.snow ? 0.45 : 0.15), size: 4, chunk: 120, opacity: 0.75, wet: 0.2 });
      if (R.snow) for (let x = 0; x < W(); x += 6) {                                          // snow on the high, moonlit faces
        const top = R.f(x), sl = slope(x); if (top > LAKE_Y - 440 || sl < 0.06) continue;
        const len = rnd(18, 80) * clamp((LAKE_Y - 440 - top) / 110 + 0.5, 0.5, 1.4);
        const a = Math.atan2(R.f(x + 10) - R.f(x - 10), 20) + gauss() * 0.2, y0 = top + rnd(6, 6 + 0.5 * len), l2 = len * 0.6;
        const xe = x + Math.cos(a) * l2, ye = y0 + Math.sin(a) * l2;
        if (ye < R.f(xe) + 5 || y0 < R.f(x) + 5) continue;                                    // never past the silhouette
        await stroke(line(x, y0, x + Math.cos(a) * l2, y0 + Math.sin(a) * l2, { step: 7, jitter: 0.5 }), { color: jit(mix('#b9c7e5', '#eef3fc', rnd(0, 1)), 3, 0.04, 0.03), size: rnd(4, 8), opacity: 0.85, wet: 0.2 });
      }
      for (let k = 0; k < 14; k++) {                                                          // mist at their feet
        const y = LAKE_Y - rnd(8, 70), x = rnd(-200, W()), len = rnd(300, 800);
        await stroke(line(x, y, x + len, y + gauss() * 4, { amp: 5, step: 30 }), { color: jit(R.haze, 3, 0.04, 0.03), size: rnd(20, 40), opacity: 0.22, wet: 0.6 });
      }
    }
  };

  // ------------------------------------------------------------------ 5. the lake
  function lakeAt(x, y) {
    const d = y - LAKE_Y;
    let c = mix('#1c3460', '#0a1430', clamp(d / 240, 0, 1));                                  // it mirrors the sky's glow far away
    if (d < (LAKE_Y - RIDGES[1].f(x)) * 0.5) c = mix(c, '#0f1a35', 0.6);                       // the mountains, upside down
    if (d < 16) c = mix(c, '#050a12', 0.65);                                                   // and the dark trees on the far shore
    const mw = 16 + d * 0.45, ripple = 0.5 + 0.5 * Math.sin(y * 0.33 + Math.sin(x / 50));
    c = mix(c, '#c9d6f0', Math.exp(-(((x - MOON.x) / mw) ** 2)) * 0.55 * ripple);             // the moon's silver path
    return mix(c, '#d8732c', fireLight(x, y, 720) * 0.5);                                      // and the warm light of the fire
  }
  api.lake = async () => {
    newLayer('Lake');
    const lakeBand = (y0, y1) => [[-40, y0], [W() + 40, y0], [W() + 40, y1], [-40, y1]];
    await flowFill(lakeBand(LAKE_Y + 1, LAKE_Y + 70), { dir: () => 0, wobble: 0.03, colorAt: lakeAt, spacing: 9, len: [60, 200], size: [6, 11], opacity: 0.95, wet: 0.4, dh: 3, ds: 0.04, dl: 0.03 });
    await flowFill(lakeBand(LAKE_Y + 60, 1205), { dir: () => 0, wobble: 0.04, colorAt: lakeAt, spacing: 15, len: [120, 380], size: [11, 22], opacity: 0.95, wet: 0.4, dh: 3, ds: 0.04, dl: 0.03 });
    for (let i = 0; i < 70; i++) {                                                             // glints on the moon path
      const y = rnd(LAKE_Y + 6, 1160), d = y - LAKE_Y, x = MOON.x + gauss() * (16 + d * 0.45) * 0.6, len = 10 + d * 0.15;
      await stroke([[x - len / 2, y], [x + len / 2, y + gauss() * 0.4]], { color: jit('#e3ebfb', 2, 0.03, 0.02), size: 2.5 + d * 0.01, opacity: 0.85, wet: 0, pressure: 0.85 });
    }
    for (let i = 0; i < 40; i++) {                                                             // the fire, broken up on the water
      const y = rnd(1060, 1185), x = FIRE.x + gauss() * (24 + (y - 1060) * 0.5), len = rnd(12, 40);
      await stroke([[x - len / 2, y], [x + len / 2, y + gauss() * 0.4]], { color: jit(mix('#ff9a3c', '#ffd27a', rnd(0, 1)), 4, 0.05, 0.03), size: rnd(2.5, 4.5), opacity: 0.8, wet: 0, pressure: 0.85 });
    }
    for (let i = 0; i < 34; i++) {                                                             // a breath of mist on the far water
      const y = LAKE_Y + rnd(-6, 60), x = rnd(-200, W()), len = rnd(260, 720);
      await stroke(line(x, y, x + len, y + gauss() * 3, { amp: 4, step: 30 }), { color: jit('#8fa6cf', 3, 0.04, 0.03), size: rnd(18, 34), opacity: 0.16, wet: 0.6 });
    }
  };

  // ------------------------------------------------------------------ 6. pines
  /** a pine silhouette from tiers of drooping branches; `rim` = how much firelight catches the side facing the fire */
  async function pine(x, base, h, col, rim = 0) {
    await stroke([[x, base], [x + gauss() * 0.5, base - h * 0.5], [x + gauss() * 0.5, base - h]], { color: col, size: Math.max(2, h * 0.025), opacity: 1, wet: 0, pressure: 0.8 });
    const n = clamp(Math.round(h / 13), 4, 70), toFire = Math.sign(FIRE.x - x) || 1;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), y = base - h * (0.1 + 0.88 * t), hw = h * 0.24 * (1 - t * 0.88) * rnd(0.8, 1.15), sz = Math.max(1.6, h * 0.045 * (1 - t * 0.45));
      for (const side of [-1, 1]) {
        const tip = [x + side * hw, y + hw * 0.32 + h * 0.02], mid = [x + side * hw * 0.5, y + hw * 0.1];
        await stroke([[x, y - sz * 0.3], mid, tip], { color: jit(col, 3, 0.03, 0.015), size: sz, opacity: 1, wet: 0, pressure: 0.85 });
        if (rim > 0.04 && side === toFire && rnd(0, 1) < 0.8) await stroke([mid, tip].map(([a, b]) => [a, b - sz * 0.35]), { color: jit(mix(col, '#d0702d', clamp(rim * 1.5, 0, 0.9)), 4, 0.05, 0.03), size: sz * 0.45, opacity: 0.9, wet: 0, pressure: 0.8 });
      }
    }
  }
  api.forest = async () => {
    newLayer('Far forest');
    // the tree line: a dark band whose top is a row of pointed crowns of different heights
    const tops = [];
    for (let x = -30; x < W() + 30; x += rnd(9, 20)) {
      const cluster = 0.55 + 0.45 * Math.sin(x / 260 + 1.3) * Math.sin(x / 113), h = rnd(12, 30) * (0.6 + cluster * 0.9);
      tops.push([x - rnd(4, 8), LAKE_Y - h * 0.35], [x, LAKE_Y - h], [x + rnd(4, 8), LAKE_Y - h * 0.35]);
    }
    const band = [...tops, [W() + 30, LAKE_Y + 6], [-30, LAKE_Y + 6]];
    await hatch(band, { step: 4, size: 9, minLen: 30, maxLen: 140, amp: 0.6, colorAt: () => '#060b17', dh: 2, dl: 0.012, opacity: 1, wet: 0 });
    for (let k = 0; k < tops.length - 2; k += 3) {                                             // each crown traced, so it stays pointed
      await stroke([tops[k], tops[k + 1], tops[k + 2]], { preset: 'paint-gouache', color: '#060b17', size: 3.5, opacity: 1, pressure: 0.85 });
    }
    // a few taller trees standing out of the line
    for (let k = 0; k < 26; k++) { const x = rnd(0, W()); await pine(x, LAKE_Y + 3, rnd(50, 90), '#060b17'); }
  };

  // ------------------------------------------------------------------ 7. the near shore
  function groundAt(x, y) {
    const f = fireLight(x, y);
    let c = mix('#121812', '#1b2218', clamp((y - 1130) / 300, 0, 1));
    c = mix(c, '#283044', 0.28 * (1 - f));                                                       // cold moonlight away from the fire
    c = mix(c, '#6e3f1c', f * 0.85);
    return mix(c, '#b8692f', f * f * 0.6);
  }
  api.ground = async () => {
    newLayer('Shore');
    const top = []; for (let x = -40; x <= W() + 40; x += 12) top.push([x, shoreY(x)]);
    const shoreAngle = (x) => Math.atan2(shoreY(x + 20) - shoreY(x - 20), 40);
    const groundPoly = [...top, [W() + 40, H() + 40], [-40, H() + 40]];
    await flowFill(groundPoly, { dir: (x, y) => shoreAngle(x) * clamp(1 - (y - 1130) / 260, 0, 1), wobble: 0.16, colorAt: groundAt, spacing: 26, len: [90, 240], size: [26, 40], opacity: 1, wet: 0.35, dh: 5, ds: 0.06, dl: 0.035 });
    await flowFill(groundPoly, { dir: (x, y) => shoreAngle(x) * clamp(1 - (y - 1130) / 260, 0, 1), wobble: 0.22, colorAt: groundAt, spacing: 20, len: [40, 140], size: [10, 20], opacity: 0.85, wet: 0.4, dh: 6, ds: 0.07, dl: 0.045 });
    await contour(top, { colorAt: ([x, y]) => mix('#3a5482', '#e08b45', clamp(fireLight(x, y, 750) * 1.6, 0, 1)), size: 5, chunk: 120, opacity: 0.7, wet: 0.2 });   // the wet edge of the water
    for (let i = 0; i < 70; i++) {                                                               // reeds along the water
      const x = rnd(0, 1) < 0.5 ? rnd(-10, 820) : rnd(1900, W() + 10), b = shoreY(x) + rnd(-2, 10), h = rnd(35, 95);
      await stroke(line(x, b, x + gauss() * 8 + 6, b - h, { step: 10, jitter: 0.5 }), { color: jit(mix('#0c130d', '#a0622c', fireLight(x, b, 800)), 3, 0.04, 0.03), size: rnd(2, 3.5), opacity: 0.95, wet: 0, pressure: 0.8 });
    }
    // two mid-sized pines near the camp, warm on the side facing the fire
    for (const [x, h] of [[820, 360], [2080, 400], [2175, 270]]) { const b = shoreY(x) + 26; await pine(x, b, h, '#060b12', fireLight(x, b - h * 0.35, 1100)); }
    // grass, thicker towards us, lit near the fire
    for (let i = 0; i < 300; i++) {
      const y = 1150 + Math.pow(rnd(0, 1), 0.7) * 300, x = rnd(-20, W() + 20); if (y < shoreY(x) + 12) continue;
      const near = (y - 1150) / 290, f = fireLight(x, y), n = 3 + Math.round(rnd(0, 3));
      for (let k = 0; k < n; k++) {
        const h = (12 + 46 * near) * rnd(0.6, 1.2), lean = gauss() * 0.35;
        await stroke([[x + k * 3, y], [x + k * 3 + lean * h * 0.4, y - h * 0.55], [x + k * 3 + lean * h, y - h]], { color: jit(mix(mix('#0b110b', '#1d2a1c', rnd(0, 1)), '#b06a2e', f * 0.9), 4, 0.05, 0.03), size: 1.5 + near * 2.5, opacity: 0.95, wet: 0, pressure: 0.8 });
      }
    }
  };

  // ------------------------------------------------------------------ 8. the camp: a tent, stones and burning logs, someone sitting on a stump
  const lerp2 = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const arcPts = (cx, cy, rx, ry, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
  api.camp = async () => {
    newLayer('Water patch');                                  // the lake phase's "fire on the water" dashes float above the flames: paint that stretch of water again, calmer
    const waterPoly = [...Array.from({ length: 14 }, (_, k) => [1360 + k * 20, 1036]), ...Array.from({ length: 14 }, (_, k) => [1620 - k * 20, shoreY(1620 - k * 20) - 6])];
    await flowFill(waterPoly, { dir: () => 0, wobble: 0.04, colorAt: lakeAt, spacing: 11, len: [110, 260], size: [11, 18], opacity: 0.97, wet: 0.4, dh: 3, ds: 0.04, dl: 0.03 });
    for (let i = 0; i < 9; i++) { const y = rnd(1070, 1108), x = FIRE.x + gauss() * 40; await stroke([[x - 50, y], [x + 50, y + gauss()]], { color: jit('#b8602a', 4, 0.05, 0.03), size: rnd(5, 8), opacity: 0.2, wet: 0.3 }); }   // a faint warm shimmer instead
    const edge = []; for (let x = 1340; x <= 1660; x += 12) edge.push([x, shoreY(x)]);          // the patch hid a bit of the water's edge: draw it again
    await contour(edge, { colorAt: ([x, y]) => mix('#3a5482', '#e08b45', clamp(fireLight(x, y, 750) * 1.6, 0, 1)), size: 5, chunk: 120, opacity: 0.7, wet: 0.2 });
    newLayer('Camp');
    // ---- the tent: an A-frame seen from the front-right. Its gable faces the fire (warm, lit by the flames and by a lantern inside);
    // the long slope on the left turns away from the fire into cold shadow. Strokes run along the fall of the canvas, ridge to ground.
    const Af = [1128, 1004], Ab = [978, 1034], Bl = [1000, 1252], Br = [1254, 1264], Cl = [846, 1226];   // ridge ends, gable corners, back corner
    const Da = [1134, 1080], Dl = [1080, 1256], Dr = [1196, 1263];                                        // the door
    await dab(900, 1246, { preset: 'paint-airbrush', size: 260, color: '#04060b', opacity: 0.5 });       // its shadow on the ground, away from the fire
    await dab(1130, 1268, { preset: 'paint-airbrush', size: 200, color: '#1a0d06', opacity: 0.35 });
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k <= 28; k++) {                                   // the shadowed slope
      const u = clamp((k + (pass ? 0.5 : 0) + gauss() * 0.15) / 28, 0, 1), top = lerp2(Af, Ab, u), bot = lerp2(Bl, Cl, u), s0 = rnd(0, 0.05);
      const pts = Array.from({ length: 7 }, (_, m) => { const t = s0 + (1 - s0) * (m / 6), p = lerp2(top, bot, t); return [p[0] + Math.sin(Math.PI * t) * gauss() * 1.2, p[1]]; });
      const warm = clamp((0.35 - u) / 0.35, 0, 1) * 0.55;                                                  // its front edge still catches the lantern and the fire
      await stroke(pts, { color: jit(mix(mix(mix('#40283a', '#222a4a', u), '#9a5428', warm), '#0d1020', clamp(u - 0.6, 0, 0.4)), 3, 0.05, 0.035), size: 17 * rnd(0.85, 1.15), opacity: 0.96, wet: 0.35 });
    }
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k <= 24; k++) {                                   // the gable: fan from the apex, brighter towards the fire
      const u = clamp((k + (pass ? 0.5 : 0) + gauss() * 0.15) / 24, 0, 1), b = lerp2(Bl, Br, u), s0 = rnd(0.02, 0.1);
      const pts = Array.from({ length: 7 }, (_, m) => lerp2(Af, b, s0 + (1 - s0) * (m / 6)));
      await stroke(pts, { color: jit(mix(mix('#a8521f', '#f3a44c', Math.pow(u, 0.85)), '#ffc878', 0.2 * Math.sin(Math.PI * u)), 3, 0.04, 0.03), size: 16 * rnd(0.85, 1.15), opacity: 0.96, wet: 0.35 });
    }
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k <= 12; k++) {                                   // the open door, glowing from the lantern
      const u = clamp((k + (pass ? 0.5 : 0)) / 12, 0, 1), b = lerp2(Dl, Dr, u);
      const pts = Array.from({ length: 6 }, (_, m) => lerp2(Da, b, 0.02 + 0.98 * (m / 5)));
      await stroke(pts, { color: jit(mix('#ffeeb8', '#ff9a3a', Math.abs(u - 0.5) * 1.7), 3, 0.04, 0.03), size: 11 * rnd(0.9, 1.1), opacity: 0.97, wet: 0.3 });
    }
    await dab(1137, 1190, { preset: 'paint-airbrush', size: 190, color: '#ffd27a', opacity: 0.4 });          // the lantern's light spilling over the door
    const seam = (p, q, c, size, op) => stroke(line(...p, ...q, { step: 12, jitter: 0.4 }), { color: c, size, opacity: op, wet: 0.2, pressure: 0.8 });
    await seam(Af, Br, '#ffdca4', 4.5, 0.8);                                                               // the gable's right edge, lit by the fire
    await seam(Af, Bl, '#6e3312', 4, 0.7); await seam(Af, Ab, '#caa070', 4, 0.6);                          // its left edge, and the ridge
    await seam(Bl, Br, '#3c1c0c', 6, 0.55); await seam(Bl, Cl, '#0b0e19', 6, 0.7);                         // where the canvas meets the ground
    await seam(Da, Dl, '#7a3a14', 4, 0.75); await seam(Da, Dr, '#a8561e', 4, 0.75);                        // the door's edges
    for (const [u, v] of [[0.22, 0.18], [0.5, 0.3], [0.78, 0.2]]) {                                        // creases in the slope
      const a = lerp2(Af, Ab, u), b = lerp2(Bl, Cl, clamp(u + v, 0, 1));
      await stroke(line(a[0], a[1] + 30, b[0], b[1] - 16, { step: 18, jitter: 1.2 }), { color: jit('#4b3a66', 3, 0.05, 0.03), size: 6, opacity: 0.45, wet: 0.2, pressure: 0.7 });
    }
    for (const [p, q] of [[[1036, 1250], [1104, 1094]], [[1240, 1262], [1170, 1108]]]) await stroke(line(...p, ...q, { step: 20, jitter: 1 }), { color: '#a24f1b', size: 5, opacity: 0.35, wet: 0.2, pressure: 0.7 });
    for (const [p, q, c] of [[Af, [1352, 1292], '#d9b890'], [Ab, [776, 1262], '#6e5a52']]) {                 // guy ropes, with a stake at each end
      const m = lerp2(p, q, 0.5);
      await stroke([p, [m[0], m[1] + 7], q], { color: c, size: 1.9, opacity: 0.7, wet: 0, pressure: 0.7 });
      await stroke([[q[0] - 3, q[1] - 10], q], { color: '#2a1a10', size: 3.2, opacity: 0.95, wet: 0, pressure: 0.8 });
    }
    const baseY = (x) => (x < 1000 ? 1226 + ((x - 846) / 154) * 26 : 1252 + ((x - 1000) / 254) * 12);
    for (let i = 0; i < 90; i++) {                                                                          // grass in front of the tent's foot
      const x = rnd(840, 1262), y = baseY(x) + rnd(-2, 8), h = rnd(14, 34), f = fireLight(x, y), lean = gauss() * 0.3;
      await stroke([[x, y], [x + lean * h * 0.4, y - h * 0.55], [x + lean * h, y - h]], { color: jit(mix(mix('#0b110b', '#1d2a1c', rnd(0, 1)), '#b06a2e', f * 0.9), 4, 0.05, 0.03), size: rnd(2, 3.6), opacity: 0.95, wet: 0, pressure: 0.8 });
    }

    // ---- a ring of stones round the fire. Each is shaded on its own: warm on the side that faces the flames, dark on the other, a shadow behind it.
    const stones = Array.from({ length: 13 }, (_, k) => {
      const a = (k / 13) * Math.PI * 2 + 0.25 + gauss() * 0.08;
      return { sx: FIRE.x + Math.cos(a) * 100 * rnd(0.94, 1.06), sy: FIRE.y + 12 + Math.sin(a) * 31 * rnd(0.94, 1.06), rx: rnd(15, 25), ry: rnd(11, 16), rot: rnd(-0.2, 0.2) };
    }).sort((p, q) => p.sy - q.sy);
    const stone = async ({ sx, sy, rx, ry, rot }) => {
      let ux = FIRE.x - sx, uy = FIRE.y - 14 - sy; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;      // the way to the flames
      await dab(sx - ux * rx * 0.55, sy + ry * 0.55 - uy * ry * 0.3, { preset: 'paint-airbrush', size: rx * 2.4, color: '#06080c', opacity: 0.55 });
      await hatch(ellipsePts(sx, sy, rx, ry, rot), {
        step: 4, size: 9, minLen: 6, maxLen: 36, dl: 0.03, opacity: 1, wet: 0.2,
        colorAt: (x, y) => { const d = clamp(0.5 + 0.5 * (((x - sx) * ux) / rx + ((y - sy) * uy) / ry), 0, 1); return mix(mix('#1b1718', '#5a4034', d), '#c4632a', d * d * 0.5); },
      });
      const f0 = Math.atan2(uy / ry, ux / rx), rim = (r, n = 9) => Array.from({ length: n }, (_, i) => { const a = f0 + (i / (n - 1) - 0.5) * 1.8; return [sx + Math.cos(a) * rx * r, sy + Math.sin(a) * ry * r]; });
      await stroke(rim(0.8), { preset: 'paint-gouache', color: jit('#e6803a', 4, 0.05, 0.03), size: 4, opacity: 0.6, pressure: 0.8 });
      await stroke(rim(0.74, 4), { preset: 'paint-gouache', color: '#ffbf72', size: 2, opacity: 0.55, pressure: 0.8 });
    };
    for (const s of stones.filter((q) => q.sy < FIRE.y + 14)) await stone(s);                                // the far ones first
    // the burning logs, leaning together over the embers
    const crown = [FIRE.x + 4, FIRE.y - 36];
    for (const [bx, by, th] of [[1412, 1268, 21], [1590, 1266, 21], [1462, 1292, 23], [1546, 1294, 23]]) {
      const tip = [crown[0] + gauss() * 6 + (bx < FIRE.x ? -8 : 8), crown[1] + gauss() * 6], side = bx < FIRE.x ? 1 : -1;
      await stroke(line(bx, by, tip[0], tip[1], { step: 10, jitter: 0.35 }), { color: '#25160d', size: th, opacity: 1, wet: 0.1, pressure: 0.95 });
      await stroke(line(bx + side * 6, by - 5, tip[0] - side * 2, tip[1] + 5, { step: 9, jitter: 0.8 }), { color: jit('#c24f16', 4, 0.05, 0.04), size: 5, opacity: 0.85, wet: 0, pressure: 0.8 });   // the side that faces the fire glows
      for (let k = 0; k < 4; k++) { const t = rnd(0.15, 0.85); await dab(bx + (tip[0] - bx) * t + side * 4, by + (tip[1] - by) * t - 3, { preset: 'paint-gouache', size: rnd(3, 6), color: '#ff7a24', opacity: 0.85 }); }   // glowing cracks
      await dab(bx + (tip[0] - bx) * 0.5, by + (tip[1] - by) * 0.5, { preset: 'paint-airbrush', size: 46, color: '#ff4a10', opacity: 0.3 });
    }
    for (const s of stones.filter((q) => q.sy >= FIRE.y + 14)) await stone(s);                               // the near ones in front of the logs

    // ---- a tree stump to sit on, lit on the side that faces the fire
    const T = [1802, 1290], SR = 56, SRY = 16, SH = 62;
    await dab(T[0] + 66, T[1] + SH + 8, { preset: 'paint-airbrush', size: 230, color: '#04060a', opacity: 0.55 });   // its shadow, away from the fire
    const sidePoly = [[T[0] - SR, T[1]], ...arcPts(T[0], T[1] + SH, SR, SRY, Math.PI, 0), ...arcPts(T[0], T[1], SR, SRY, 0, Math.PI)];
    const barkAt = (x) => { const u = clamp((x - (T[0] - SR)) / (2 * SR), 0, 1); return mix(mix('#b3692f', '#6e3b1b', Math.pow(u, 0.7) * 1.2), '#1d0f08', clamp((u - 0.55) / 0.45, 0, 1) * 0.8); };
    await flowFill(sidePoly, { dir: () => Math.PI / 2, wobble: 0.07, colorAt: barkAt, spacing: 6, len: [26, 60], size: [6, 10], opacity: 1, wet: 0.2, dh: 4, ds: 0.05, dl: 0.04 });
    await hatch(ellipsePts(T[0], T[1], SR, SRY), { step: 4, size: 8, minLen: 8, maxLen: 40, colorAt: (x) => mix('#e0a15e', '#8e5628', clamp(((x - T[0]) / SR) * 0.5 + 0.5, 0, 1) * 0.8), dl: 0.025, opacity: 1, wet: 0.2 });
    for (const k of [0.8, 0.58, 0.36]) await contour(ellipsePts(T[0], T[1], SR * k, SRY * k, 0, 28).concat([[T[0] + SR * k, T[1]]]), { colorAt: () => '#7c4620', size: 2.2, chunk: 90, opacity: 0.55, wet: 0.1 });   // the rings of the wood
    await contour(arcPts(T[0], T[1], SR, SRY, 0, Math.PI, 20), { colorAt: ([x]) => (x < T[0] ? '#f0a55a' : '#a8642e'), size: 3.5, chunk: 90, opacity: 0.9, wet: 0.1 });

    // ---- someone keeping warm on the stump: side view, hunched forward, elbow on the knee, hand held out to the fire, boots on the ground.
    // Dark blue jacket, a knitted hat, the face lit by the flames; warm rim light on the side facing the fire, a cool one from the moon on the back.
    const G = { preset: 'paint-gouache', color: '#1b2134', opacity: 1, pressure: 0.92 };
    await stroke([[1814, 1286], [1776, 1280], [1742, 1270]], { ...G, size: 31 });                           // thigh along the stump
    await stroke([[1742, 1270], [1734, 1308], [1728, 1344]], { ...G, size: 22 });                           // shin
    await stroke([[1730, 1347], [1708, 1351], [1690, 1350]], { ...G, color: '#0d0f16', size: 15 });         // boot
    await stroke([[1816, 1290], [1828, 1252], [1818, 1216], [1790, 1192]], { ...G, size: 58 });             // back and hips
    await stroke([[1800, 1262], [1782, 1232], [1768, 1204]], { ...G, size: 50 });                           // chest
    await dab(1776, 1196, { ...G, size: 54 });                                                              // shoulders
    await stroke([[1774, 1212], [1752, 1240], [1738, 1262]], { ...G, size: 19 });                           // upper arm, to the elbow on the knee
    await stroke([[1738, 1262], [1712, 1244], [1688, 1234]], { ...G, size: 17 });                           // forearm
    await dab(1681, 1232, { preset: 'paint-gouache', color: '#d98a58', size: 14, opacity: 1 });            // the hand, warm
    await dab(1768, 1190, { ...G, color: '#7a3a2a', size: 22 });                                            // a scarf
    await dab(1772, 1163, { ...G, color: '#1a1520', size: 31 });                                            // hair at the back of the head
    await dab(1757, 1169, { ...G, color: '#c9835a', size: 31 });                                            // the face, lit by the fire
    await dab(1741, 1172, { ...G, color: '#d9966a', size: 8 });                                             // nose
    await dab(1750, 1165, { ...G, color: '#2a1a14', size: 3 });                                           // eye
    await stroke([[1746, 1153], [1762, 1143], [1782, 1147], [1787, 1160]], { ...G, color: '#6a2a22', size: 20 });   // a knitted hat
    await stroke([[1743, 1157], [1762, 1150], [1786, 1155]], { ...G, color: '#8c3a2c', size: 7 });          // its folded brim
    for (const [pts, c, size, op] of [
      [[[1752, 1250], [1746, 1224], [1752, 1200]], '#e0782f', 4, 0.85],                                      // chest
      [[[1812, 1272], [1776, 1266], [1748, 1256]], '#c85f26', 4, 0.7],                                       // top of the thigh
      [[[1722, 1300], [1718, 1330]], '#c85f26', 3.5, 0.8],                                                   // shin
      [[[1736, 1266], [1712, 1252], [1690, 1242]], '#f08a3c', 3, 0.85],                                      // forearm
      [[[1696, 1344], [1690, 1349]], '#f0a05a', 3, 0.9],                                                     // boot toe
      [[[1748, 1150], [1762, 1143]], '#f08040', 3, 0.85],                                                    // hat
      [[[1834, 1262], [1838, 1230], [1822, 1204]], '#4d5f95', 3, 0.7],                                       // moonlight on the back
    ]) await stroke(pts, { preset: 'paint-gouache', color: c, size, opacity: op, pressure: 0.75 });
  };

  // ------------------------------------------------------------------ 9. the fire, sparks and smoke
  api.fire = async () => {
    newLayer('Fire');
    for (let i = 0; i < 45; i++) { const a = rnd(0, Math.PI * 2), r = Math.sqrt(rnd(0, 1)); await dab(FIRE.x + Math.cos(a) * 58 * r, FIRE.y + 6 + Math.sin(a) * 13 * r, { preset: 'paint-gouache', size: rnd(4, 9), color: ['#ff4d12', '#ff8a1f', '#ffd25a'][i % 3], opacity: 0.95 }); }   // a bed of embers
    for (const [size, col, n] of [[300, '#8e200a', 3], [190, '#e2561a', 3], [110, '#ffa42e', 3]]) for (let i = 0; i < n; i++) await dab(FIRE.x + gauss() * 6, FIRE.y - 55 + gauss() * 6, { preset: 'paint-airbrush', size, color: col, opacity: 0.5 });   // the glowing body of the fire
    // tongues of flame: each a tapering ribbon of round touches along a swaying path — broad at the foot, a point at the tip. Tall in the middle, short at the sides,
    // leaning a little to the left (a breath of wind). Deep red outside, then orange, yellow and a white-hot core low down.
    const licks = Array.from({ length: 11 }, (_, i) => {
      const f = ((i + 0.5) / 11) * 2 - 1, centre = Math.exp(-((f / 0.62) ** 2));
      return { x0: FIRE.x + f * 50 + gauss() * 4, h: (80 + centre * 190) * rnd(0.78, 1.12), lean: -rnd(0, 42) + f * 26, w: 30 * (0.6 + 0.55 * centre) * rnd(0.88, 1.1), ph: rnd(0, 6.28), amp: rnd(7, 17) };
    }).sort((a, b) => b.h - a.h);
    const path = (L, t) => [L.x0 + L.lean * Math.pow(t, 1.7) + Math.sin(t * 3.6 + L.ph) * L.amp * Math.min(1, t * 2.2), FIRE.y - 4 - L.h * t];
    for (const [scale, col, op, reach, hard] of [[1, '#b5260d', 0.9, 1, 0.3], [0.8, '#ee6015', 0.95, 0.96, 0.45], [0.58, '#ffa92c', 0.97, 0.82, 0.55], [0.36, '#ffe27c', 1, 0.6, 0.6], [0.2, '#fff8dc', 1, 0.34, 0.6]]) {
      for (const L of licks) {
        // the ribbon is laid in overlapping strokes, each a little narrower than the one below it, so it tapers to a point without any beads
        const M = Math.max(4, Math.round((L.h * reach) / 40));
        for (let m = 0; m < M; m++) {
          const u0 = m / M, u1 = (m + 1) / M, um = (u0 + u1) / 2, r = L.w * scale * Math.pow(1 - um, 0.9);
          if (r < 1.8) continue;
          const a = Math.max(0, u0 - 0.6 / M), b = Math.min(1, u1 + 0.6 / M);
          await stroke(Array.from({ length: 5 }, (_, k) => path(L, (a + (b - a) * (k / 4)) * reach)), { preset: 'paint-gouache', hardness: hard, color: jit(col, 2, 0.03, 0.02), size: r * 2.3, opacity: op * (1 - 0.3 * um), pressure: 1 });
        }
      }
    }
    for (let i = 0; i < 2; i++) await dab(FIRE.x, FIRE.y - 26, { preset: 'paint-airbrush', size: 110, color: '#fff0b0', opacity: 0.45 });   // white-hot at the heart
    newLayer('Sparks and smoke');
    for (let i = 0; i < 4; i++) {                                                                // smoke: soft puffs, wider and fainter as they rise and drift left
      let x = FIRE.x + gauss() * 10, y = FIRE.y - 200;
      for (let k = 0; k < 22; k++) {
        const t = k / 21;
        x += Math.sin(k * 0.7 + i * 2) * 9 - 7 * t; y -= 22 + 6 * t;
        await dab(x, y, { preset: 'paint-airbrush', size: 50 + 170 * t, color: jit(t < 0.18 ? '#6a4636' : '#525a70', 4, 0.04, 0.03), opacity: 0.32 * (1 - t * 0.7) });
      }
    }
    for (let i = 0; i < 80; i++) {                                                               // sparks flying up: tiny glowing flecks
      const t = Math.pow(rnd(0, 1), 0.8), y = FIRE.y - 130 - t * 540, x = FIRE.x + gauss() * (16 + t * 110) + Math.sin(t * 6 + i) * 30 - t * t * 90, len = rnd(1.5, 6) * (1 - t * 0.5);
      await stroke([[x, y + len], [x - 1, y]], { preset: 'paint-gouache', color: jit(mix('#fff0a0', '#ff6a1f', t), 3, 0.05, 0.03), size: (2 + rnd(0, 2.5)) * (1 - t * 0.55), opacity: 1 - t * 0.55, pressure: 0.85 });
    }
  };

  // ------------------------------------------------------------------ 10. framing pines in the foreground
  api.pines = async () => {
    newLayer('Pines');
    for (const [x, b, h] of [[60, 1310, 1180], [225, 1240, 900], [385, 1196, 610], [2300, 1206, 760], [2440, 1296, 1080], [2540, 1340, 1220]]) await pine(x, b, h, '#03070d', fireLight(x, b - h * 0.25, 1500) * 0.6);
  };

  // ------------------------------------------------------------------ 11. light: the fire's glow, the tent, the moon; vignette
  api.glow = async () => {
    newLayer('Firelight', { blend: 'screen', opacity: 0.55 });
    for (let i = 0; i < 5; i++) await dab(FIRE.x + gauss() * 12, FIRE.y - 70 + gauss() * 10, { preset: 'paint-airbrush', size: 1400, color: '#ff7a2c', opacity: 0.45 });
    for (let i = 0; i < 4; i++) await dab(FIRE.x, FIRE.y - 80, { preset: 'paint-airbrush', size: 700, color: '#ffa64c', opacity: 0.45 });
    for (let i = 0; i < 3; i++) await dab(FIRE.x, FIRE.y - 90, { preset: 'paint-airbrush', size: 300, color: '#ffd37a', opacity: 0.5 });
    for (let i = 0; i < 3; i++) await dab(1137, 1196, { preset: 'paint-airbrush', size: 260, color: '#ffc061', opacity: 0.45 });
    newLayer('Moonlight', { blend: 'screen', opacity: 0.35 });
    for (let i = 0; i < 3; i++) await dab(MOON.x, MOON.y, { preset: 'paint-airbrush', size: 520, color: '#7f98cf', opacity: 0.45 });
    vignette('Vignette', { cx: 0.56, cy: 0.62, inner: 0.4, color: '3,5,12', strength: 0.95, opacity: 0.72 });
  };

  window.Painter = {
    title: 'Campfire by the Lake', file: 'campfire-by-the-lake', width: 2560, height: 1440,
    phases: ['sky', 'milkyway', 'stars', 'moon', 'mountains', 'lake', 'forest', 'ground', 'camp', 'fire', 'pines', 'glow'], run: api,
    crops: [['crop-camp', 900, 960, 1100, 460], ['crop-tent', 800, 960, 520, 360], ['crop-fire', 1340, 960, 320, 360], ['crop-person', 1640, 1110, 300, 270], ['crop-sky', 1400, 60, 1000, 560]],
  };
})();
