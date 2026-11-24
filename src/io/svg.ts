// SVG import (to editable vector objects) and export.

import type { Mat, Vec } from '../core/geometry';
import { IDENTITY, mMul, mTranslate, mScale, mRotate, mSkew, mApply, rad } from '../core/geometry';
import type { Paint, PathNode, QDocument, StrokeStyle, SubPath, VObject, VPath, Page, Layer, VText } from '../core/model';
import { baseObject, solid } from '../core/model';
import { inkPolygon, subpathsOf, localGeometryBounds, layoutText, fontString, cssColor } from '../core/vector';
import { rgbaToHex, parseColor } from '../core/color';
import { uid } from '../core/util';

// ------------------------------------------------------------------ import
const numRe = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
export const parseNums = (s: string | null | undefined): number[] => (s ? (s.match(numRe) ?? []).map(Number) : []);

function parseTransform(s: string | null): Mat {
  if (!s) return IDENTITY;
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const a = parseNums(r[2]);
    let t: Mat = IDENTITY;
    switch (r[1]) {
      case 'matrix': t = { a: a[0], b: a[1], c: a[2], d: a[3], e: a[4], f: a[5] }; break;
      case 'translate': t = mTranslate(a[0] ?? 0, a[1] ?? 0); break;
      case 'scale': t = mScale(a[0] ?? 1, a[1] ?? a[0] ?? 1); break;
      case 'rotate': t = a.length >= 3 ? mMul(mTranslate(a[1], a[2]), mMul(mRotate(rad(a[0])), mTranslate(-a[1], -a[2]))) : mRotate(rad(a[0] ?? 0)); break;
      case 'skewX': t = mSkew(rad(a[0] ?? 0), 0); break;
      case 'skewY': t = mSkew(0, rad(a[0] ?? 0)); break;
    }
    m = mMul(m, t);
  }
  return m;
}

function arcToBeziers(x1: number, y1: number, rx: number, ry: number, phi: number, fa: number, fs: number, x2: number, y2: number): number[][] {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const cp = Math.cos(rad(phi)), sp = Math.sin(rad(phi));
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (den || 1)));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2) - 1e-6);
  const out: number[][] = [];
  const delta = dth / n, t = (4 / 3) * Math.tan(delta / 4);
  for (let i = 0; i < n; i++) {
    const a1 = th1 + i * delta, a2 = a1 + delta;
    const p = (a: number, k: number, dir: number): [number, number] => {
      const ex = rx * Math.cos(a), ey = ry * Math.sin(a), tx = -rx * Math.sin(a), ty = ry * Math.cos(a);
      const x = ex + dir * k * tx, y = ey + dir * k * ty;
      return [cp * x - sp * y + cx, sp * x + cp * y + cy];
    };
    const c1 = p(a1, t, 1), c2 = p(a2, t, -1), e = p(a2, 0, 1);
    out.push([c1[0], c1[1], c2[0], c2[1], e[0], e[1]]);
  }
  return out;
}

export function parsePathData(d: string): SubPath[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const paths: SubPath[] = [];
  let cur: PathNode[] = [];
  let cmd = '', i = 0, cx = 0, cy = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lastCmd = '';
  const num = () => Number(tokens[i++]);
  const flag = () => { const t = tokens[i]; if (t.length > 1 && /^[01]/.test(t) && !t.includes('.')) { tokens[i] = t.slice(1); return Number(t[0]); } i++; return Number(t); };
  const nd = (x: number, y: number): PathNode => ({ x, y, ix: 0, iy: 0, ox: 0, oy: 0 });
  const finish = (closed: boolean) => {
    if (!cur.length) return;
    if (closed && cur.length > 1) {
      const f = cur[0], l = cur[cur.length - 1];
      if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; cur.pop(); }
    }
    paths.push({ nodes: cur, closed }); cur = [];
  };
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => {
    const last = cur[cur.length - 1];
    last.ox = c1x - last.x; last.oy = c1y - last.y;
    const n = nd(x, y); n.ix = c2x - x; n.iy = c2y - y; cur.push(n);
    lcx = c2x; lcy = c2y; cx = x; cy = y;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; i++; if (cmd === 'Z' || cmd === 'z') { finish(true); cx = sx; cy = sy; lastCmd = 'Z'; continue; } }
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    if (C === 'M') { finish(false); const x = num() + ox, y = num() + oy; cur = [nd(x, y)]; cx = sx = x; cy = sy = y; }
    else if (C === 'L') { if (!cur.length) cur = [nd(cx, cy)]; const x = num() + ox, y = num() + oy; cur.push(nd(x, y)); cx = x; cy = y; }
    else if (C === 'H') { if (!cur.length) cur = [nd(cx, cy)]; const x = num() + ox; cur.push(nd(x, cy)); cx = x; }
    else if (C === 'V') { if (!cur.length) cur = [nd(cx, cy)]; const y = num() + oy; cur.push(nd(cx, y)); cy = y; }
    else if (C === 'C') { if (!cur.length) cur = [nd(cx, cy)]; cubic(num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy); }
    else if (C === 'S') {
      if (!cur.length) cur = [nd(cx, cy)];
      const refl = lastCmd === 'C' || lastCmd === 'S' ? { x: 2 * cx - lcx, y: 2 * cy - lcy } : { x: cx, y: cy };
      cubic(refl.x, refl.y, num() + ox, num() + oy, num() + ox, num() + oy);
    } else if (C === 'Q') {
      if (!cur.length) cur = [nd(cx, cy)];
      const qx = num() + ox, qy = num() + oy, x = num() + ox, y = num() + oy;
      cubic(cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
      lcx = qx; lcy = qy;
    } else if (C === 'T') {
      if (!cur.length) cur = [nd(cx, cy)];
      const q = lastCmd === 'Q' || lastCmd === 'T' ? { x: 2 * cx - lcx, y: 2 * cy - lcy } : { x: cx, y: cy };
      const x = num() + ox, y = num() + oy;
      cubic(cx + (2 / 3) * (q.x - cx), cy + (2 / 3) * (q.y - cy), x + (2 / 3) * (q.x - x), y + (2 / 3) * (q.y - y), x, y);
      lcx = q.x; lcy = q.y;
    } else if (C === 'A') {
      if (!cur.length) cur = [nd(cx, cy)];
      const rx = num(), ry = num(), phi = num(), fa = flag(), fs = flag(), x = num() + ox, y = num() + oy;
      for (const b of arcToBeziers(cx, cy, rx, ry, phi, fa, fs, x, y)) cubic(b[0], b[1], b[2], b[3], b[4], b[5]);
      cx = x; cy = y;
    } else { i++; continue; }
    lastCmd = C;
  }
  finish(false);
  return paths;
}

interface Style { [k: string]: string }
interface Ctx { tf: Mat; style: Style; opacity: number }

function parseCss(text: string): Map<string, Style> {
  const rules = new Map<string, Style>();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text.replace(/\/\*[\s\S]*?\*\//g, '')))) {
    const decl: Style = {};
    for (const part of m[2].split(';')) { const k = part.indexOf(':'); if (k > 0) decl[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
    for (const sel of m[1].split(',')) rules.set(sel.trim(), { ...(rules.get(sel.trim()) ?? {}), ...decl });
  }
  return rules;
}

let colorCtx: CanvasRenderingContext2D | null = null;
function normalizeColor(v: string, current: string): string | null {
  v = v.trim();
  if (!v || v === 'none') return null;
  if (v === 'currentColor') v = current;
  colorCtx ??= document.createElement('canvas').getContext('2d')!;
  colorCtx.fillStyle = '#000'; colorCtx.fillStyle = v;
  const out = colorCtx.fillStyle as string;
  return out.startsWith('#') ? out : rgbaToHex(parseColor(out), true);
}

export interface SvgImportResult { width: number; height: number; objects: VObject[]; warnings: string[] }

export function parseSvg(text: string): SvgImportResult {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = dom.documentElement as unknown as SVGSVGElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || dom.querySelector('parsererror')) throw new Error('Invalid SVG file');
  const warnings: string[] = [];
  const vb = parseNums(root.getAttribute('viewBox'));
  const wAttr = parseFloat(root.getAttribute('width') ?? ''), hAttr = parseFloat(root.getAttribute('height') ?? '');
  const width = !isNaN(wAttr) && !(root.getAttribute('width') ?? '').includes('%') ? wAttr : vb[2] ?? 1024;
  const height = !isNaN(hAttr) && !(root.getAttribute('height') ?? '').includes('%') ? hAttr : vb[3] ?? 768;
  const css = new Map<string, Style>();
  dom.querySelectorAll('style').forEach((s) => parseCss(s.textContent ?? '').forEach((v, k) => css.set(k, { ...(css.get(k) ?? {}), ...v })));
  const defs = new Map<string, Element>();
  dom.querySelectorAll('[id]').forEach((el) => defs.set(el.getAttribute('id')!, el));

  const objects: VObject[] = [];
  const rootTf = vb.length === 4 ? mMul(mScale(width / vb[2], height / vb[3]), mTranslate(-vb[0], -vb[1])) : IDENTITY;

  const styleOf = (el: Element, parent: Style): Style => {
    const s: Style = { ...parent };
    const own: Style = {};
    for (const a of Array.from(el.attributes)) own[a.name] = a.value;
    const tag = el.tagName.toLowerCase();
    const fromCss = { ...(css.get(tag) ?? {}) };
    for (const c of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) Object.assign(fromCss, css.get('.' + c), css.get(`${tag}.${c}`));
    const id = el.getAttribute('id'); if (id) Object.assign(fromCss, css.get('#' + id));
    const inline: Style = {};
    for (const part of (el.getAttribute('style') ?? '').split(';')) { const k = part.indexOf(':'); if (k > 0) inline[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
    const inheritable = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill-rule', 'fill-opacity', 'stroke-opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor'];
    for (const k of inheritable) { const v = inline[k] ?? fromCss[k] ?? own[k]; if (v !== undefined) s[k] = v; }
    s.opacity = inline.opacity ?? fromCss.opacity ?? own.opacity ?? '1';
    return s;
  };

  const resolveGradient = (ref: string, opacity: number): Paint | null => {
    const el = defs.get(ref.replace(/^url\(#?['"]?/, '').replace(/['"]?\)$/, ''));
    if (!el) return null;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'lineargradient' && tag !== 'radialgradient') return null;
    let stopsEl: Element = el;
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
    const stops = (n: Element) => Array.from(n.querySelectorAll(':scope > stop'));
    let st = stops(stopsEl);
    if (!st.length && href) { const h = defs.get(href.replace('#', '')); if (h) { stopsEl = h; st = stops(h); } }
    const gs = st.map((s) => {
      const off = (s.getAttribute('offset') ?? '0'); const pos = off.endsWith('%') ? parseFloat(off) / 100 : parseFloat(off);
      const sst: Style = {}; for (const part of (s.getAttribute('style') ?? '').split(';')) { const k = part.indexOf(':'); if (k > 0) sst[part.slice(0, k).trim()] = part.slice(k + 1).trim(); }
      const col = normalizeColor(sst['stop-color'] ?? s.getAttribute('stop-color') ?? '#000', '#000') ?? '#000000';
      const op = parseFloat(sst['stop-opacity'] ?? s.getAttribute('stop-opacity') ?? '1') * opacity;
      const c = parseColor(col); c.a *= op;
      return { pos: isNaN(pos) ? 0 : pos, color: rgbaToHex(c, true) };
    });
    if (!gs.length) return null;
    const g = (k: string, d: number) => { const v = el.getAttribute(k); if (v === null) return d; return v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v); };
    if (tag === 'lineargradient') return { kind: 'linear', stops: gs, x1: g('x1', 0), y1: g('y1', 0), x2: g('x2', 1), y2: g('y2', 0) };
    return { kind: 'radial', stops: gs, cx: g('cx', 0.5), cy: g('cy', 0.5), r: g('r', 0.5) };
  };

  const paintOf = (val: string | undefined, opacity: number, current: string): Paint | null => {
    if (val === undefined) val = '#000000';
    if (val.startsWith('url(')) return resolveGradient(val, opacity);
    const c = normalizeColor(val, current);
    if (!c) return null;
    const rgba = parseColor(c); rgba.a *= opacity;
    return solid(rgbaToHex(rgba, true));
  };

  const mk = (el: Element, ctx: Ctx, st: Style, geom: Partial<VObject> & { type: VObject['type'] }): VObject | null => {
    const op = parseFloat(st.opacity ?? '1') * ctx.opacity;
    const current = st.color ?? '#000000';
    const fill = geom.type === 'line' ? null : paintOf(st.fill, parseFloat(st['fill-opacity'] ?? '1'), current);
    let stroke: StrokeStyle | null = null;
    const sp = paintOf(st.stroke, parseFloat(st['stroke-opacity'] ?? '1'), current);
    if (sp && sp.kind === 'solid') {
      stroke = {
        color: sp.color, width: parseFloat(st['stroke-width'] ?? '1') || 1, cap: (st['stroke-linecap'] as any) === 'round' ? 'round' : (st['stroke-linecap'] as any) === 'square' ? 'square' : 'butt',
        join: (st['stroke-linejoin'] as any) === 'round' ? 'round' : (st['stroke-linejoin'] as any) === 'bevel' ? 'bevel' : 'miter', dash: parseNums(st['stroke-dasharray']),
      };
    }
    const own = parseTransform(el.getAttribute('transform'));
    return { ...baseObject(), id: uid('ob'), fill, stroke, opacity: op, tf: mMul(ctx.tf, own), ...geom } as VObject;
  };

  const walk = (el: Element, ctx: Ctx) => {
    const tag = el.tagName.toLowerCase();
    if (['defs', 'style', 'title', 'desc', 'metadata', 'lineargradient', 'radialgradient', 'clippath', 'mask', 'filter', 'symbol', 'marker', 'pattern'].includes(tag)) {
      if (['filter', 'mask', 'clippath'].includes(tag)) warnings.push(`<${tag}> is not supported and was ignored`);
      return;
    }
    if (el.getAttribute('display') === 'none' || (el.getAttribute('style') ?? '').includes('display:none')) return;
    const st = styleOf(el, ctx.style);
    const own = parseTransform(el.getAttribute('transform'));
    const n = (k: string, d = 0) => { const v = parseFloat(el.getAttribute(k) ?? ''); return isNaN(v) ? d : v; };
    const g = (k: string) => el.getAttribute(k);
    void g;
    switch (tag) {
      case 'svg': case 'g': case 'a': {
        const sub: Ctx = { tf: mMul(ctx.tf, tag === 'svg' && el !== root ? mTranslate(n('x'), n('y')) : own), style: st, opacity: ctx.opacity * parseFloat(st.opacity ?? '1') };
        for (const c of Array.from(el.children)) walk(c, sub);
        return;
      }
      case 'use': {
        const href = (el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '').replace('#', '');
        const target = defs.get(href);
        if (target) { const sub: Ctx = { tf: mMul(ctx.tf, mMul(own, mTranslate(n('x'), n('y')))), style: st, opacity: ctx.opacity }; walk(target, sub); }
        return;
      }
      case 'rect': { const o = mk(el, ctx, st, { type: 'rect', x: n('x'), y: n('y'), w: n('width'), h: n('height'), rx: n('rx', n('ry')) } as any); if (o) objects.push(o); return; }
      case 'circle': { const r = n('r'); const o = mk(el, ctx, st, { type: 'ellipse', cx: n('cx'), cy: n('cy'), rx: r, ry: r } as any); if (o) objects.push(o); return; }
      case 'ellipse': { const o = mk(el, ctx, st, { type: 'ellipse', cx: n('cx'), cy: n('cy'), rx: n('rx'), ry: n('ry') } as any); if (o) objects.push(o); return; }
      case 'line': { const o = mk(el, ctx, st, { type: 'line', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), arrowStart: false, arrowEnd: false } as any); if (o) objects.push(o); return; }
      case 'polyline': case 'polygon': {
        const nums = parseNums(el.getAttribute('points'));
        const nodes: PathNode[] = [];
        for (let i = 0; i + 1 < nums.length; i += 2) nodes.push({ x: nums[i], y: nums[i + 1], ix: 0, iy: 0, ox: 0, oy: 0 });
        const o = mk(el, ctx, st, { type: 'path', paths: [{ nodes, closed: tag === 'polygon' }], fillRule: 'nonzero' } as any); if (o) objects.push(o); return;
      }
      case 'path': {
        const paths = parsePathData(el.getAttribute('d') ?? '');
        if (!paths.length) return;
        const o = mk(el, ctx, st, { type: 'path', paths, fillRule: st['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero' } as any) as VPath | null;
        if (o) { o.paths.forEach((p) => { if (!p.closed && st.fill && st.fill !== 'none') { /* implicit close for fill only */ } }); objects.push(o); }
        return;
      }
      case 'text': {
        const lines: string[] = [];
        const tspans = el.querySelectorAll(':scope > tspan');
        if (tspans.length) tspans.forEach((t) => lines.push(t.textContent ?? '')); else lines.push(el.textContent ?? '');
        const size = parseFloat(st['font-size'] ?? '16') || 16;
        const anchor = st['text-anchor'];
        const t = mk(el, ctx, st, {
          type: 'text', x: n('x'), y: n('y') - size, text: lines.join('\n'), font: { family: (st['font-family'] ?? 'sans-serif').replace(/['"]/g, ''), size, weight: st['font-weight'] === 'bold' ? 700 : parseInt(st['font-weight'] ?? '400') || 400, italic: st['font-style'] === 'italic' },
          align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left', lineHeight: 1.2, letterSpacing: 0, boxW: null, underline: false, strike: false,
        } as any) as VText | null;
        if (t) {
          if (anchor === 'middle' || anchor === 'end') {
            const w = layoutText(t).bounds.w; t.x -= anchor === 'middle' ? w / 2 : w;
          }
          t.stroke = null; objects.push(t);
        }
        return;
      }
      case 'image': {
        warnings.push('Embedded <image> elements are imported as a placeholder frame');
        return;
      }
    }
    for (const c of Array.from(el.children)) walk(c, ctx);
  };
  walk(root, { tf: rootTf, style: {}, opacity: 1 });

  // userSpaceOnUse gradients: treat coordinates as bbox-relative approximations when out of [0,1]
  for (const o of objects) {
    if (o.fill && (o.fill.kind === 'linear' || o.fill.kind === 'radial') && o.type !== 'text') {
      const b = localGeometryBounds(o);
      const f = o.fill as any;
      const out = [f.x1, f.y1, f.x2, f.y2, f.cx, f.cy].some((v: number | undefined) => v !== undefined && (v > 1.5 || v < -0.5));
      if (out && b.w > 0 && b.h > 0) {
        if (o.fill.kind === 'linear') o.fill = { ...o.fill, x1: (f.x1 - b.x) / b.w, y1: (f.y1 - b.y) / b.h, x2: (f.x2 - b.x) / b.w, y2: (f.y2 - b.y) / b.h };
        else o.fill = { ...o.fill, cx: (f.cx - b.x) / b.w, cy: (f.cy - b.y) / b.h, r: f.r / Math.max(b.w, b.h) };
      }
    }
  }
  return { width, height, objects, warnings: [...new Set(warnings)] };
}

// ------------------------------------------------------------------ export
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f2 = (n: number) => +n.toFixed(3);
const matStr = (m: Mat) => `matrix(${f2(m.a)} ${f2(m.b)} ${f2(m.c)} ${f2(m.d)} ${f2(m.e)} ${f2(m.f)})`;
const colorAttr = (c: string) => { const p = parseColor(c); return { rgb: rgbaToHex({ ...p, a: 1 }), a: p.a }; };

function pathD(sp: SubPath): string {
  const n = sp.nodes; if (!n.length) return '';
  let d = `M${f2(n[0].x)} ${f2(n[0].y)}`;
  const seg = (a: PathNode, b: PathNode) => (a.ox || a.oy || b.ix || b.iy ? ` C${f2(a.x + a.ox)} ${f2(a.y + a.oy)} ${f2(b.x + b.ix)} ${f2(b.y + b.iy)} ${f2(b.x)} ${f2(b.y)}` : ` L${f2(b.x)} ${f2(b.y)}`);
  for (let i = 0; i < n.length - 1; i++) d += seg(n[i], n[i + 1]);
  if (sp.closed && n.length > 1) { d += seg(n[n.length - 1], n[0]) + 'Z'; }
  return d;
}

export function objectToSvg(o: VObject, defs: string[], assetUrl: (id: string) => string | null): string {
  if (o.hidden) return '';
  const attrs: string[] = [];
  if (!(o.tf.a === 1 && o.tf.b === 0 && o.tf.c === 0 && o.tf.d === 1 && o.tf.e === 0 && o.tf.f === 0)) attrs.push(`transform="${matStr(o.tf)}"`);
  if (o.opacity < 1) attrs.push(`opacity="${f2(o.opacity)}"`);
  if (o.blend && o.blend !== 'normal') attrs.push(`style="mix-blend-mode:${o.blend === 'add' ? 'plus-lighter' : o.blend}"`);
  const fillAttr = (): string => {
    const p = o.fill;
    if (!p) return 'fill="none"';
    if (p.kind === 'solid') { const c = colorAttr(p.color); return `fill="${c.rgb}"${c.a < 1 ? ` fill-opacity="${f2(c.a)}"` : ''}`; }
    if (p.kind === 'pattern') { const c = colorAttr(p.color ?? '#000'); return `fill="${c.rgb}" fill-opacity="0.5"`; }
    const id = uid('g');
    const stops = p.stops.map((s) => { const c = colorAttr(s.color); return `<stop offset="${f2(s.pos)}" stop-color="${c.rgb}" stop-opacity="${f2(c.a)}"/>`; }).join('');
    defs.push(p.kind === 'linear' ? `<linearGradient id="${id}" x1="${f2(p.x1)}" y1="${f2(p.y1)}" x2="${f2(p.x2)}" y2="${f2(p.y2)}">${stops}</linearGradient>` : `<radialGradient id="${id}" cx="${f2(p.cx)}" cy="${f2(p.cy)}" r="${f2(p.r)}">${stops}</radialGradient>`);
    return `fill="url(#${id})"`;
  };
  const strokeAttr = (): string => {
    const s = o.stroke; if (!s || s.width <= 0) return '';
    const c = colorAttr(s.color);
    return ` stroke="${c.rgb}" stroke-width="${f2(s.width)}" stroke-linecap="${s.cap}" stroke-linejoin="${s.join}"${c.a < 1 ? ` stroke-opacity="${f2(c.a)}"` : ''}${s.dash.length ? ` stroke-dasharray="${s.dash.join(' ')}"` : ''}`;
  };
  const a = attrs.join(' ');
  switch (o.type) {
    case 'ink': {
      const { poly } = inkPolygon({ ...o, tf: IDENTITY } as any);
      // inkPolygon bakes tf, so recompute with identity then rely on outer transform attr
      if (!poly.length) return '';
      const d = 'M' + poly.map((p) => `${f2(p.x)} ${f2(p.y)}`).join('L') + 'Z';
      return `<path d="${d}" ${fillAttr()} ${a}/>`;
    }
    case 'text': {
      const lay = layoutText(o);
      const f = o.font;
      const tspans = lay.lines.map((l) => `<tspan x="${f2(l.x)}" y="${f2(l.y + (lay.lineH - f.size) / 2 + f.size * 0.82)}">${esc(l.text)}</tspan>`).join('');
      return `<text ${fillAttr()}${strokeAttr()} font-family="${esc(f.family)}" font-size="${f.size}" font-weight="${f.weight}" font-style="${f.italic ? 'italic' : 'normal'}" ${o.letterSpacing ? `letter-spacing="${o.letterSpacing}"` : ''} xml:space="preserve" ${a}>${tspans}</text>`;
    }
    case 'image': {
      const url = assetUrl(o.assetId);
      return url ? `<image x="${f2(o.x)}" y="${f2(o.y)}" width="${f2(o.w)}" height="${f2(o.h)}" href="${url}" preserveAspectRatio="none" ${a}/>` : '';
    }
    case 'note': return `<rect x="${f2(o.x)}" y="${f2(o.y)}" width="${f2(o.w)}" height="${f2(o.h)}" rx="6" fill="${colorAttr(o.color).rgb}" ${a}/><text x="${f2(o.x + 10)}" y="${f2(o.y + 28)}" font-size="16" font-family="sans-serif">${esc(o.text)}</text>`;
    case 'markup': return o.quads.map((q) => { const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]]; return `<rect x="${f2(Math.min(...xs))}" y="${f2(Math.min(...ys))}" width="${f2(Math.max(...xs) - Math.min(...xs))}" height="${f2(Math.max(...ys) - Math.min(...ys))}" fill="${colorAttr(o.color).rgb}" style="mix-blend-mode:multiply" opacity="0.5" ${a}/>`; }).join('');
    case 'group': return `<g ${a}>${o.children.map((c) => objectToSvg(c, defs, assetUrl)).join('')}</g>`;
    default: {
      const d = subpathsOf(o).map(pathD).join(' ');
      if (!d) return '';
      const rule = o.type === 'path' && o.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      return `<path d="${d}" ${o.type === 'line' ? 'fill="none"' : fillAttr()}${rule}${strokeAttr()} ${a}/>`;
    }
  }
}

export interface SvgExportOptions { rasterLayers: 'embed' | 'skip'; layerImage: (l: Layer, page: Page) => string | null; assetUrl: (id: string) => string | null }
export function pageToSvg(doc: QDocument, page: Page, o: SvgExportOptions): string {
  const defs: string[] = [];
  const parts: string[] = [];
  const bg = page.background;
  if (bg.color) parts.push(`<rect width="${page.width}" height="${page.height}" fill="${colorAttr(bg.color).rgb}"/>`);
  const walk = (layers: Layer[]) => {
    for (const l of layers) {
      if (!l.visible) continue;
      let inner = '';
      if (l.type === 'vector') inner = l.objects.map((ob) => objectToSvg(ob, defs, o.assetUrl)).join('');
      else if (l.type === 'raster' && o.rasterLayers === 'embed') { const url = o.layerImage(l, page); if (url) inner = `<image width="${page.width}" height="${page.height}" href="${url}"/>`; }
      else if (l.type === 'group') { const sub: string[] = []; const saved = parts.length; walk(l.children); inner = parts.splice(saved).join(''); void sub; }
      if (!inner) continue;
      const style = [l.opacity < 1 ? `opacity:${f2(l.opacity)}` : '', l.blend !== 'normal' ? `mix-blend-mode:${l.blend === 'add' ? 'plus-lighter' : l.blend}` : ''].filter(Boolean).join(';');
      parts.push(`<g id="${esc(l.name.replace(/\s+/g, '_'))}"${style ? ` style="${style}"` : ''}>${inner}</g>`);
    }
  };
  walk(page.layers);
  void cssColor; void fontString;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">\n${defs.length ? `<defs>${defs.join('')}</defs>\n` : ''}${parts.join('\n')}\n</svg>\n`;
}
export type { Vec };
void mApply;
