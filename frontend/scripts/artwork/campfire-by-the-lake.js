// "Campfire by the Lake" — a night landscape in oil, painted inside Quarc Draw (on top of kit.js).
// Stars and the Milky Way over moonlit mountains, a still lake, and on the near shore a campfire, a glowing tent and someone keeping
// warm on a log. Two lights: the cold crescent moon up right, the warm fire below. Every mark is a pen stroke through the app's
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

  // ------------------------------------------------------------------ 8. the camp: tent, log seat, a figure, stones and logs
  api.camp = async () => {
    newLayer('Camp');
    // the tent, glowing from the lantern inside: the canvas painted in strokes running from the peak down to the ground
    const A = [1082, 1012], BL = [905, 1222], FL = [962, 1252], FR = [1218, 1242], D = [1090, 1084], DL = [1040, 1248], DR = [1142, 1246];
    const fan = async (apex, b0, b1, n, colorAt, size) => {
      for (let pass = 0; pass < 2; pass++) for (let k = 0; k <= n; k++) {
        const u = clamp((k + (pass ? 0.5 : 0) + gauss() * 0.2) / n, 0, 1), b = [b0[0] + (b1[0] - b0[0]) * u, b0[1] + (b1[1] - b0[1]) * u];
        const s0 = rnd(0.02, 0.1), pts = Array.from({ length: 6 }, (_, m) => { const t = s0 + (1 - s0) * (m / 5); return [apex[0] + (b[0] - apex[0]) * t + Math.sin(Math.PI * t) * gauss() * 1.5, apex[1] + (b[1] - apex[1]) * t]; });
        await stroke(pts, { color: jit(colorAt(u), 3, 0.04, 0.025), size: size * rnd(0.85, 1.15), opacity: 0.95, wet: 0.35 });
      }
    };
    await fan(A, BL, FL, 9, (u) => mix('#7a3a16', '#a5521f', u), 15);                                                  // the side away from the fire, in shadow
    await fan(A, FL, FR, 20, (u) => mix(mix('#d27428', '#f0a44c', clamp(u * 1.2, 0, 1)), '#ffbf6a', 0.25 * Math.sin(Math.PI * u)), 15);   // the front, lit from inside and by the fire
    await fan(D, DL, DR, 10, (u) => mix('#fff0b4', '#ffbe55', Math.abs(u - 0.5) * 1.6), 10);                         // the open door, glowing
    for (const [p, q, c] of [[A, FL, '#ffd38a'], [A, FR, '#c4661f'], [A, BL, '#5e2a10'], [BL, FL, '#5e2a10'], [FL, FR, '#8a4518']])
      await stroke(line(...p, ...q, { step: 10, jitter: 0.5 }), { color: c, size: 3.5, opacity: 0.55, wet: 0.2, pressure: 0.8 });   // seams: soft, in the canvas' own colours
    for (const [p, q] of [[A, [870, 1272]], [A, [1270, 1266]]]) await stroke(line(...p, ...q, { step: 16, jitter: 0.2 }), { color: '#8a6a52', size: 1.6, opacity: 0.45, wet: 0, pressure: 0.7 });   // guy lines
    // the log seat
    const L0 = [1636, 1318], L1 = [1846, 1302];
    await stroke(line(...L0, ...L1, { step: 12, jitter: 0.4 }), { color: '#2e1c11', size: 36, opacity: 1, wet: 0.2, pressure: 0.95 });
    for (let k = 0; k < 6; k++) { const t = k / 6; await stroke(line(L0[0] + (L1[0] - L0[0]) * t, L0[1] + (L1[1] - L0[1]) * t - 12 + gauss() * 3, L0[0] + (L1[0] - L0[0]) * (t + 0.14), L0[1] + (L1[1] - L0[1]) * (t + 0.14) - 12, { step: 8 }), { color: jit(mix('#4a2c18', '#c27a3c', clamp(1 - t * 1.6, 0, 1)), 4, 0.05, 0.03), size: 5, opacity: 0.85, wet: 0.1 }); }
    await hatch(ellipsePts(L0[0] + 2, L0[1], 7, 14), { step: 4, size: 5, minLen: 5, maxLen: 14, colorAt: () => '#9a5f33', opacity: 0.9, wet: 0.2 });   // the cut end, warm in the firelight
    // someone keeping warm, hunched forward, hands held out to the fire (soft round strokes: a silhouette, rim-lit by the flames)
    const body = '#0d0a0b', G = { preset: 'paint-gouache', color: body, opacity: 1, pressure: 0.92 };
    await stroke([[1752, 1300], [1756, 1266], [1748, 1232], [1732, 1208]], { ...G, size: 50 });                 // back, curved
    await stroke([[1724, 1298], [1718, 1262], [1716, 1226]], { ...G, size: 40 });                               // chest and lap
    await stroke([[1718, 1200], [1722, 1196]], { ...G, size: 46 });                                             // shoulders
    await stroke([[1716, 1168], [1720, 1172]], { ...G, size: 40 });                                             // head
    await stroke([[1700, 1156], [1716, 1146], [1734, 1152]], { ...G, color: '#3a1c14', size: 16 });              // a knitted hat
    await stroke([[1712, 1212], [1690, 1236], [1664, 1248]], { ...G, size: 17 });                               // arm, hands held to the fire
    await dab(1660, 1249, { ...G, size: 15 });
    await stroke([[1738, 1300], [1704, 1294], [1672, 1296]], { ...G, size: 28 });                               // thigh
    await stroke([[1672, 1296], [1666, 1324], [1660, 1350]], { ...G, size: 21 });                               // shin
    await stroke([[1648, 1352], [1668, 1354]], { ...G, size: 12 });                                             // boot
    for (const pts of [[[1696, 1160], [1694, 1178], [1700, 1192]], [[1696, 1210], [1694, 1240], [1700, 1292]], [[1680, 1236], [1662, 1244]], [[1690, 1286], [1666, 1290], [1652, 1322]], [[1702, 1150], [1716, 1142]]])
      await stroke(pts, { preset: 'paint-gouache', color: jit('#ee8a3e', 4, 0.05, 0.03), size: 4.5, opacity: 0.9, pressure: 0.75 });  // firelight on the side facing it
    // a ring of stones, warm where they face the flames
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + 0.2, sx = FIRE.x + Math.cos(a) * 96, sy = FIRE.y + 10 + Math.sin(a) * 30, rx = rnd(15, 24), ry = rnd(10, 14);
      await hatch(ellipsePts(sx, sy, rx, ry), { step: 4, size: 9, minLen: 6, maxLen: 40, colorAt: (x, y) => mix(mix('#2a2526', '#4a3d36', clamp((sy - y) / ry, 0, 1)), '#6a3c1e', 0.35), dl: 0.03, opacity: 1, wet: 0.2 });
      await stroke([[sx - rx * 0.6, sy - ry * 0.5], [sx, sy - ry * 0.85], [sx + rx * 0.6, sy - ry * 0.5]], { preset: 'paint-gouache', color: jit('#f0974c', 4, 0.05, 0.03), size: 6, opacity: 0.9, pressure: 0.8 });
    }
    // logs, burning
    for (const [x0, y0, x1, y1] of [[1420, 1270, 1560, 1240], [1440, 1238, 1585, 1272], [1500, 1282, 1520, 1226], [1455, 1258, 1548, 1258]]) {
      await stroke(line(x0, y0, x1, y1, { step: 10, jitter: 0.3 }), { color: '#22150d', size: 20, opacity: 1, wet: 0.1, pressure: 0.95 });
      await stroke(line(x0 + 8, y0 - 6, x1 - 8, y1 - 6, { step: 8, jitter: 0.6 }), { color: jit('#ff6a1f', 4, 0.05, 0.03), size: 4, opacity: 0.9, wet: 0, pressure: 0.8 });
    }
  };

  // ------------------------------------------------------------------ 9. the fire, sparks and smoke
  api.fire = async () => {
    newLayer('Fire');
    for (let i = 0; i < 50; i++) { const a = rnd(0, Math.PI * 2), r = Math.sqrt(rnd(0, 1)); await dab(FIRE.x + Math.cos(a) * 62 * r, FIRE.y + 4 + Math.sin(a) * 15 * r, { preset: 'paint-gouache', size: rnd(4, 9), color: ['#ff4d12', '#ff8a1f', '#ffd25a'][i % 3], opacity: 0.95 }); }
    for (const [size, col, n] of [[260, '#a82a0c', 4], [170, '#f06a16', 4], [100, '#ffb33a', 3]]) for (let i = 0; i < n; i++) await dab(FIRE.x + gauss() * 6, FIRE.y - 70 + gauss() * 8, { preset: 'paint-airbrush', size, color: col, opacity: 0.55 });   // the fire's glowing body
    // tongues of flame, layer by layer: deep red outside, white-yellow at the heart (a soft round brush: fire has no bristle marks)
    for (const [n, hk, size, col, op] of [[16, 1, 34, '#b8290f', 0.8], [16, 0.88, 26, '#ee6316', 0.88], [14, 0.72, 18, '#ffab32', 0.95], [10, 0.52, 12, '#ffe17e', 1], [6, 0.32, 7, '#fff6d4', 1]]) {
      for (let i = 0; i < n; i++) {
        const x0 = FIRE.x + gauss() * 26, centre = Math.exp(-(((x0 - FIRE.x) / 55) ** 2)), h = (70 + Math.pow(rnd(0, 1), 0.7) * 190) * (0.45 + 0.55 * centre) * hk;
        const ph = rnd(0, 6.28), amp = rnd(8, 20), pts = [];
        for (let k = 0; k <= 11; k++) { const t = k / 11; pts.push([x0 + Math.sin(t * 3.2 + ph) * amp * t - 12 * t * t, FIRE.y - 4 - h * t]); }
        await stroke(pts, { preset: 'paint-gouache', hardness: 0.55, color: jit(col, 4, 0.05, 0.03), size: size * rnd(0.8, 1.2), opacity: op });
      }
    }
    newLayer('Sparks and smoke');
    for (let i = 0; i < 4; i++) {                                                                // smoke: soft puffs, wider and fainter as they rise and drift left
      let x = FIRE.x + gauss() * 10, y = FIRE.y - 200;
      for (let k = 0; k < 22; k++) {
        const t = k / 21;
        x += Math.sin(k * 0.7 + i * 2) * 9 - 7 * t; y -= 22 + 6 * t;
        await dab(x, y, { preset: 'paint-airbrush', size: 50 + 170 * t, color: jit(t < 0.18 ? '#6a4636' : '#525a70', 4, 0.04, 0.03), opacity: 0.32 * (1 - t * 0.7) });
      }
    }
    for (let i = 0; i < 80; i++) {                                                               // sparks flying up
      const t = Math.pow(rnd(0, 1), 0.8), y = FIRE.y - 110 - t * 560, x = FIRE.x + gauss() * (16 + t * 110) + Math.sin(t * 6 + i) * 30 - t * t * 90, len = rnd(4, 11) * (1 - t * 0.5);
      await stroke([[x, y + len], [x - 1.5, y]], { preset: 'paint-gouache', color: jit(mix('#fff0a0', '#ff6a1f', t), 3, 0.05, 0.03), size: (2 + rnd(0, 3)) * (1 - t * 0.55), opacity: 1 - t * 0.55, pressure: 0.85 });
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
    for (let i = 0; i < 3; i++) await dab(1092, 1196, { preset: 'paint-airbrush', size: 260, color: '#ffc061', opacity: 0.45 });
    newLayer('Moonlight', { blend: 'screen', opacity: 0.35 });
    for (let i = 0; i < 3; i++) await dab(MOON.x, MOON.y, { preset: 'paint-airbrush', size: 520, color: '#7f98cf', opacity: 0.45 });
    vignette('Vignette', { cx: 0.56, cy: 0.62, inner: 0.4, color: '3,5,12', strength: 0.95, opacity: 0.72 });
  };

  window.Painter = {
    title: 'Campfire by the Lake', file: 'campfire-by-the-lake', width: 2560, height: 1440,
    phases: ['sky', 'milkyway', 'stars', 'moon', 'mountains', 'lake', 'forest', 'ground', 'camp', 'fire', 'pines', 'glow'], run: api,
    crops: [['crop-camp', 900, 960, 1100, 460], ['crop-sky', 1400, 60, 1000, 560]],
  };
})();
