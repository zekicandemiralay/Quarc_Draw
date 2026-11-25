import { describe, it, expect } from 'vitest';
import { mApply, mInvert, mMul, mRotate, mTranslate, mScale, simplifyPolyline, bezFlatten, rectUnion, rectIntersect, distToSegment, pointInPolygon, catmullToBezier } from '../../src/core/geometry';
import { hexToRgba, rgbaToHex, rgbaToHsv, hsvToRgba, parseColor, rgbaToLab, labToRgba, harmony, buildGradientLUT } from '../../src/core/color';
import { applyAdjustment, gaussianBlur, makePix, curveLUT, pixelate, resizePix, unsharpMask, boxBlurMask, morphMask } from '../../src/filters/pixels';
import { Selection } from '../../src/core/selection';
import { floodMask } from '../../src/core/floodfill';
import { History } from '../../src/core/history';
import { parsePathData } from '../../src/io/svg';
import { TransformBox } from '../../src/tools/transformBox';

describe('geometry', () => {
  it('matrix multiply / invert round-trips', () => {
    const m = mMul(mTranslate(10, 20), mMul(mRotate(0.7), mScale(2, 3)));
    const p = { x: 5, y: -7 };
    const q = mApply(mInvert(m), mApply(m, p));
    expect(q.x).toBeCloseTo(5, 6); expect(q.y).toBeCloseTo(-7, 6);
  });
  it('rect union / intersect', () => {
    expect(rectUnion({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 15, h: 15 });
    expect(rectIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 5, h: 5 })).toBeNull();
  });
  it('bezier flatten stays near curve and segment distance works', () => {
    const pts = bezFlatten({ p0: { x: 0, y: 0 }, c1: { x: 0, y: 100 }, c2: { x: 100, y: 100 }, p1: { x: 100, y: 0 } }, 0.2);
    expect(pts.length).toBeGreaterThan(8);
    expect(distToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });
  it('RDP simplification keeps endpoints and drops collinear points', () => {
    const s = simplifyPolyline([{ x: 0, y: 0 }, { x: 5, y: 0.01 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 0.5);
    expect(s.length).toBe(3);
  });
  it('point in polygon', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
  it('catmull-rom produces a bezier per segment', () => {
    expect(catmullToBezier([{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 0 }]).length).toBe(2);
  });
});

describe('color', () => {
  it('hex round trip incl. alpha and shorthand', () => {
    expect(rgbaToHex(hexToRgba('#1abc9c'))).toBe('#1abc9c');
    expect(hexToRgba('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(hexToRgba('#00000080').a).toBeCloseTo(0.5, 2);
  });
  it('hsv round trip', () => {
    const c = hsvToRgba(rgbaToHsv({ r: 200, g: 100, b: 50, a: 1 }));
    expect(Math.round(c.r)).toBe(200); expect(Math.round(c.g)).toBe(100); expect(Math.round(c.b)).toBe(50);
  });
  it('parses css formats', () => {
    expect(parseColor('rgb(10,20,30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10,20,30,0.5)').a).toBe(0.5);
    expect(Math.round(parseColor('hsl(0,100%,50%)').r)).toBe(255);
  });
  it('lab round trip', () => {
    const [L, a, b] = rgbaToLab({ r: 120, g: 200, b: 30, a: 1 });
    const c = labToRgba(L, a, b);
    expect(Math.round(c.r)).toBeCloseTo(120, -1); expect(Math.round(c.g)).toBeCloseTo(200, -1);
  });
  it('harmony + gradient lut', () => {
    expect(harmony({ r: 255, g: 0, b: 0, a: 1 }, 'triadic').length).toBe(3);
    const lut = buildGradientLUT([{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }]);
    expect(lut[0]).toBe(0); expect(lut[255 * 4]).toBe(255);
  });
});

const solid = (w: number, h: number, c: [number, number, number, number]) => {
  const p = makePix(w, h);
  for (let i = 0; i < w * h; i++) { p.data[i * 4] = c[0]; p.data[i * 4 + 1] = c[1]; p.data[i * 4 + 2] = c[2]; p.data[i * 4 + 3] = c[3]; }
  return p;
};

describe('pixel filters', () => {
  it('invert + grayscale + threshold', () => {
    const p = solid(2, 2, [200, 100, 50, 255]);
    applyAdjustment(p, { kind: 'invert' });
    expect([p.data[0], p.data[1], p.data[2], p.data[3]]).toEqual([55, 155, 205, 255]);
    applyAdjustment(solid(1, 1, [10, 10, 10, 255]), { kind: 'threshold', level: 128 });
  });
  it('levels maps black/white points', () => {
    const p = solid(1, 1, [100, 100, 100, 255]);
    applyAdjustment(p, { kind: 'levels', inBlack: 100, inWhite: 200, gamma: 1, outBlack: 0, outWhite: 255 });
    expect(p.data[0]).toBe(0);
  });
  it('curves LUT is monotone for monotone control points', () => {
    const lut = curveLUT([[0, 0], [64, 40], [192, 220], [255, 255]]);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });
  it('gaussian blur preserves a flat colour and does not darken transparent edges', () => {
    const p = solid(16, 16, [255, 0, 0, 255]);
    gaussianBlur(p, 3);
    expect(p.data[(8 * 16 + 8) * 4]).toBe(255);
    // half-transparent image: colour must stay red (premultiplied blur), only alpha changes
    const q = makePix(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) { const i = (y * 16 + x) * 4; q.data[i] = 255; q.data[i + 3] = 255; }
    gaussianBlur(q, 2);
    const i = (8 * 16 + 9) * 4;
    expect(q.data[i + 3]).toBeGreaterThan(0); expect(q.data[i]).toBeGreaterThan(240);
  });
  it('pixelate averages cells; resize changes dimensions', () => {
    const p = makePix(4, 4); p.data.fill(255);
    expect(pixelate(p, 2).width).toBe(4);
    expect(resizePix(solid(8, 8, [1, 2, 3, 255]), 4, 2)).toMatchObject({ width: 4, height: 2 });
    expect(unsharpMask(solid(4, 4, [10, 10, 10, 255]), 100, 1, 0).data[0]).toBe(10);
  });
  it('mask grow/shrink', () => {
    const m = new Uint8Array(25); m[12] = 255;
    const g = morphMask(m, 5, 5, 1, true);
    expect(g[7]).toBe(255); expect(g[11]).toBe(255);
    expect(morphMask(g, 5, 5, 1, false)[12]).toBe(255);
    expect(boxBlurMask(m, 5, 5, 2).some((v) => v > 0 && v < 255)).toBe(true);
  });
});

describe('selection', () => {
  const make = () => new Selection(20, 20);
  it('combine modes', () => {
    const s = make();
    const a = new Uint8Array(400); for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) a[y * 20 + x] = 255;
    const b = new Uint8Array(400); for (let y = 6; y < 14; y++) for (let x = 6; x < 14; x++) b[y * 20 + x] = 255;
    s.combine(a, 'replace');
    expect(s.bounds).toEqual({ x: 2, y: 2, w: 8, h: 8 });
    s.combine(b, 'add');
    expect(s.bounds).toEqual({ x: 2, y: 2, w: 12, h: 12 });
    s.combine(b, 'subtract');
    expect(s.valueAt(7, 7)).toBe(0); expect(s.valueAt(3, 3)).toBe(255);
    s.combine(a, 'intersect');
    expect(s.valueAt(3, 3)).toBe(255);
  });
  it('invert and clear', () => {
    const s = make(); s.selectAll(); s.invert();
    expect(s.isEmpty).toBe(true);
    const a = new Uint8Array(400); a[0] = 255; s.combine(a, 'replace'); s.invert();
    expect(s.valueAt(0, 0)).toBe(0); expect(s.valueAt(1, 0)).toBe(255);
  });
  it('translate moves the mask', () => {
    const s = make(); const a = new Uint8Array(400); a[5 * 20 + 5] = 255; s.combine(a, 'replace');
    s.translate(3, 2);
    expect(s.valueAt(8, 7)).toBe(255); expect(s.valueAt(5, 5)).toBe(0);
  });
  it('contours trace a closed outline around a rectangle', () => {
    const s = make(); const a = new Uint8Array(400);
    for (let y = 5; y < 10; y++) for (let x = 5; x < 12; x++) a[y * 20 + x] = 255;
    s.combine(a, 'replace');
    const c = s.contours();
    expect(c.length).toBe(1);
    const pts = c[0];
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    // contour follows pixel edges: columns 5..11 → x 5..12, rows 5..9 → y 5..10
    expect(Math.min(...xs)).toBeCloseTo(5, 5); expect(Math.max(...xs)).toBeCloseTo(12, 5);
    expect(Math.min(...ys)).toBeCloseTo(5, 5); expect(Math.max(...ys)).toBeCloseTo(10, 5);
    expect(pts.length).toBeLessThanOrEqual(10); // 4 straight sides + 4 cut corners (+closing point)
    expect(pts[0]).toEqual(pts[pts.length - 1]); // closed loop
  });
  it('resize keeps content with offset', () => {
    const s = make(); const a = new Uint8Array(400); a[0] = 255; s.combine(a, 'replace');
    s.resize(30, 30, 4, 4);
    expect(s.valueAt(4, 4)).toBe(255);
  });
});

describe('flood fill', () => {
  it('contiguous fill stops at boundary; global fill does not', () => {
    const w = 10, h = 10, d = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 0; y < h; y++) { const i = (y * w + 5) * 4; d[i] = d[i + 1] = d[i + 2] = 0; }
    const a = floodMask(d, w, h, 1, 1, { tolerance: 10, contiguous: true });
    expect(a[1 * w + 1]).toBe(255); expect(a[1 * w + 8]).toBe(0);
    const b = floodMask(d, w, h, 1, 1, { tolerance: 10, contiguous: false });
    expect(b[1 * w + 8]).toBe(255);
  });
  it('respects the selection limit', () => {
    const w = 6, h = 1, d = new Uint8ClampedArray(w * h * 4).fill(255);
    const limit = new Uint8Array([255, 255, 0, 255, 255, 255]);
    const m = floodMask(d, w, h, 0, 0, { tolerance: 5, contiguous: true, limit });
    expect(Array.from(m)).toEqual([255, 255, 0, 0, 0, 0]);
  });
});

describe('history', () => {
  it('undo / redo / group / coalesce', () => {
    const h = new History(); let v = 0;
    const set = (to: number, from: number) => h.push({ label: `set ${to}`, bytes: 1, undo: () => { v = from; }, redo: () => { v = to; } });
    v = 1; set(1, 0); v = 2; set(2, 1);
    expect(h.undo()).toBe(true); expect(v).toBe(1);
    expect(h.redo()).toBe(true); expect(v).toBe(2);
    h.beginGroup(); v = 3; set(3, 2); v = 4; set(4, 3); h.endGroup('group');
    expect(h.items.filter((i) => i.state === 'done').length).toBe(3);
    h.undo(); expect(v).toBe(2);
    h.redo();
    h.push({ label: 'slider', key: 'k', bytes: 1, undo: () => { v = 4; }, redo: () => { v = 5; } });
    expect(h.coalesce('k', () => { v = 6; })).toBe(true);
    h.undo(); expect(v).toBe(4);
    h.redo(); expect(v).toBe(6);
  });
  it('new push clears redo; trim by entries', () => {
    const h = new History(); h.maxEntries = 3;
    for (let i = 0; i < 6; i++) h.push({ label: String(i), bytes: 1, undo() {}, redo() {} });
    expect(h.items.length).toBe(3);
    h.undo(); h.push({ label: 'x', bytes: 1, undo() {}, redo() {} });
    expect(h.canRedo).toBe(false);
  });
});

describe('svg path parser', () => {
  it('handles M/L/H/V/Z and relative commands', () => {
    const p = parsePathData('M10 10 H50 V50 h-40 z');
    expect(p.length).toBe(1);
    expect(p[0].closed).toBe(true);
    expect(p[0].nodes.map((n) => [n.x, n.y])).toEqual([[10, 10], [50, 10], [50, 50], [10, 50]]);
  });
  it('handles cubic, smooth cubic, quadratic and arcs', () => {
    const c = parsePathData('M0 0 C10 0 20 10 20 20 S30 40 40 40');
    expect(c[0].nodes.length).toBe(3);
    expect(c[0].nodes[0].ox).toBe(10);
    const q = parsePathData('M0 0 Q10 10 20 0 T40 0');
    expect(q[0].nodes.length).toBe(3);
    const a = parsePathData('M0 0 A10 10 0 0 1 20 0');
    expect(a[0].nodes.length).toBeGreaterThanOrEqual(2);
    expect(a[0].nodes[a[0].nodes.length - 1].x).toBeCloseTo(20, 4);
  });
  it('multiple subpaths and implicit lineto after M', () => {
    const p = parsePathData('M0 0 10 0 10 10 M50 50 L60 60');
    expect(p.length).toBe(2);
    expect(p[0].nodes.length).toBe(3);
  });
  it('compact number formats', () => {
    const p = parsePathData('M.5.5L1e1-2');
    expect(p[0].nodes[0].x).toBeCloseTo(0.5); expect(p[0].nodes[1].x).toBe(10); expect(p[0].nodes[1].y).toBe(-2);
  });
});

describe('transform box', () => {
  it('scaling from the south-east handle scales about the north-west corner', () => {
    const box = new TransformBox({ x: 0, y: 0, w: 100, h: 100 });
    box.begin('se', { x: 100, y: 100 });
    box.drag({ x: 200, y: 150 }, { shift: false, alt: false, ctrl: false });
    expect(mApply(box.m, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const br = mApply(box.m, { x: 100, y: 100 });
    expect(br.x).toBeCloseTo(200, 6); expect(br.y).toBeCloseTo(150, 6);
  });
  it('shift keeps proportions; rotate handle rotates about the centre', () => {
    const box = new TransformBox({ x: 0, y: 0, w: 100, h: 50 });
    box.begin('se', { x: 100, y: 50 });
    box.drag({ x: 200, y: 60 }, { shift: true, alt: false, ctrl: false });
    const br = mApply(box.m, { x: 100, y: 50 });
    expect(br.x / br.y).toBeCloseTo(2, 5);
    const b2 = new TransformBox({ x: 0, y: 0, w: 100, h: 100 });
    b2.begin('rot', { x: 50, y: -30 });
    b2.drag({ x: 130, y: 50 }, { shift: false, alt: false, ctrl: false });
    const c = mApply(b2.m, { x: 50, y: 50 });
    expect(c.x).toBeCloseTo(50, 6); expect(c.y).toBeCloseTo(50, 6);
  });
});

import { stickyRotation, normAngle } from '../../src/core/viewport';
describe('view rotation detents', () => {
  const d = (deg: number) => (deg * Math.PI) / 180;
  it('sticks to exactly upright within a few degrees', () => {
    expect(stickyRotation(d(6))).toEqual({ rot: 0, snapped: true });
    expect(stickyRotation(d(-7.5))).toEqual({ rot: 0, snapped: true });
    expect(stickyRotation(d(361))).toEqual({ rot: 0, snapped: true });
  });
  it('sticks more gently at quarter turns', () => {
    expect(stickyRotation(d(93)).rot).toBeCloseTo(Math.PI / 2, 9);
    expect(stickyRotation(d(-178)).rot).toBeCloseTo(Math.PI, 9);
    expect(stickyRotation(d(97)).snapped).toBe(false);
  });
  it('turns freely elsewhere', () => {
    const s = stickyRotation(d(30));
    expect(s.snapped).toBe(false);
    expect(s.rot).toBeCloseTo(d(30), 9);
  });
  it('wraps angles into (-180°, 180°]', () => {
    expect(normAngle(d(190))).toBeCloseTo(d(-170), 9);
    expect(normAngle(d(-540))).toBeCloseTo(Math.PI, 9);
  });
});
