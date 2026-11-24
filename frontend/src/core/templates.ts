// Paper templates for notebook pages (lined, grid, dotted, Cornell, music, planner …).
// Drawn procedurally so they stay crisp at any zoom and in exports.

import type { TemplateSpec, TemplateKind } from './model';

export interface TemplateInfo { kind: TemplateKind; label: string; spacing: number; color: string; margin: boolean }
export const TEMPLATES: TemplateInfo[] = [
  { kind: 'lined', label: 'Lined (college)', spacing: 44, color: '#9ec5e8', margin: true },
  { kind: 'lined', label: 'Lined (narrow)', spacing: 34, color: '#9ec5e8', margin: true },
  { kind: 'lined', label: 'Lined (wide)', spacing: 56, color: '#9ec5e8', margin: true },
  { kind: 'grid', label: 'Grid (5 mm)', spacing: 30, color: '#b8c7d9', margin: false },
  { kind: 'grid', label: 'Grid (large)', spacing: 60, color: '#b8c7d9', margin: false },
  { kind: 'graph', label: 'Graph paper', spacing: 30, color: '#7fb69a', margin: false },
  { kind: 'dots', label: 'Dot grid', spacing: 36, color: '#8a98a8', margin: false },
  { kind: 'isometric', label: 'Isometric dots', spacing: 40, color: '#8a98a8', margin: false },
  { kind: 'hex', label: 'Hex grid', spacing: 44, color: '#b8c7d9', margin: false },
  { kind: 'cornell', label: 'Cornell notes', spacing: 44, color: '#9ec5e8', margin: false },
  { kind: 'checklist', label: 'Checklist', spacing: 56, color: '#9ec5e8', margin: false },
  { kind: 'planner', label: 'Weekly planner', spacing: 44, color: '#9ec5e8', margin: false },
  { kind: 'music', label: 'Music staff', spacing: 14, color: '#555555', margin: false },
  { kind: 'storyboard', label: 'Storyboard', spacing: 40, color: '#8a98a8', margin: false },
];
export const makeTemplate = (i: TemplateInfo): TemplateSpec => ({ kind: i.kind, spacing: i.spacing, color: i.color, margin: i.margin });

/** Draw template into the page-space rect [0,0,w,h]. ctx must carry the page→device transform. `px` = device px per page unit (for hairlines). */
export function drawTemplate(ctx: CanvasRenderingContext2D, t: TemplateSpec, w: number, h: number, px = 1) {
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  ctx.globalAlpha = t.opacity ?? 1;
  const hair = Math.max(1 / px, 1);
  ctx.lineWidth = hair; ctx.strokeStyle = t.color; ctx.fillStyle = t.color;
  const s = t.spacing;
  const line = (x1: number, y1: number, x2: number, y2: number) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  switch (t.kind) {
    case 'lined': {
      const top = s * 2.2;
      for (let y = top; y < h - s * 0.5; y += s) line(0, y, w, y);
      if (t.margin) { ctx.strokeStyle = '#e8a0a0'; line(s * 2.2, 0, s * 2.2, h); }
      break;
    }
    case 'grid': {
      for (let x = s; x < w; x += s) line(x, 0, x, h);
      for (let y = s; y < h; y += s) line(0, y, w, y);
      break;
    }
    case 'graph': {
      ctx.globalAlpha = (t.opacity ?? 1) * 0.55;
      for (let x = s / 5; x < w; x += s / 5) line(x, 0, x, h);
      for (let y = s / 5; y < h; y += s / 5) line(0, y, w, y);
      ctx.globalAlpha = t.opacity ?? 1;
      ctx.lineWidth = hair * 1.4;
      for (let x = s; x < w; x += s) line(x, 0, x, h);
      for (let y = s; y < h; y += s) line(0, y, w, y);
      break;
    }
    case 'dots': {
      const r = Math.max(1.6, s / 18);
      for (let y = s; y < h; y += s) for (let x = s; x < w; x += s) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'isometric': {
      const r = Math.max(1.6, s / 20), dy = s * 0.866;
      let row = 0;
      for (let y = s; y < h; y += dy, row++) for (let x = s + (row % 2 ? s / 2 : 0); x < w; x += s) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'hex': {
      const r = s / 2, hh = r * Math.sqrt(3);
      for (let row = 0, y = r; y < h + hh; row++, y += hh / 2 * 1) {
        for (let x = (row % 2 ? r * 1.5 : 0); x < w + r; x += r * 3) {
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k; const px_ = x + r * Math.cos(a), py_ = y + r * Math.sin(a); k ? ctx.lineTo(px_, py_) : ctx.moveTo(px_, py_); }
          ctx.closePath(); ctx.stroke();
        }
      }
      break;
    }
    case 'cornell': {
      const top = s * 2.4, cue = w * 0.28, bottom = h - h * 0.16;
      for (let y = top; y < bottom; y += s) line(cue, y, w, y);
      for (let y = top; y < bottom; y += s) line(0, y, cue, y);
      ctx.strokeStyle = '#d99'; ctx.lineWidth = hair * 1.6;
      line(cue, 0, cue, bottom); line(0, bottom, w, bottom); line(0, top - s * 0.4, w, top - s * 0.4);
      break;
    }
    case 'checklist': {
      const top = s * 1.8;
      for (let y = top; y < h - s; y += s) {
        line(s * 1.6, y, w - s * 0.6, y);
        ctx.strokeRect(s * 0.5, y - s * 0.62, s * 0.55, s * 0.55);
      }
      break;
    }
    case 'planner': {
      const top = s * 2, colW = (w - s) / 2, rows = 4;
      ctx.lineWidth = hair * 1.4;
      const rh = (h - top - s) / rows;
      for (let c = 0; c < 2; c++) for (let r = 0; r < rows; r++) {
        const x = s / 2 + c * colW, y = top + r * rh;
        ctx.strokeRect(x, y, colW - s / 4, rh - s / 4);
        ctx.lineWidth = hair;
        for (let ly = y + s; ly < y + rh - s / 3; ly += s * 0.8) line(x + 6, ly, x + colW - s / 4 - 6, ly);
        ctx.lineWidth = hair * 1.4;
      }
      break;
    }
    case 'music': {
      const gap = s, staffH = gap * 4, step = staffH + gap * 4;
      for (let y = gap * 3; y + staffH < h - gap * 2; y += step) for (let i = 0; i < 5; i++) line(gap * 2, y + i * gap, w - gap * 2, y + i * gap);
      break;
    }
    case 'storyboard': {
      const cols = 2, rows = 3, mx = s, my = s * 1.2, cw = (w - mx * (cols + 1)) / cols, ch = (h - my * 2 - s * 3) / rows;
      ctx.lineWidth = hair * 1.5;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = mx + c * (cw + mx), y = my + r * (ch + s);
        ctx.strokeRect(x, y, cw, cw * 0.5625 < ch ? cw * 0.5625 : ch);
        line(x, y + (cw * 0.5625 < ch ? cw * 0.5625 : ch) + s * 0.5, x + cw, y + (cw * 0.5625 < ch ? cw * 0.5625 : ch) + s * 0.5);
      }
      break;
    }
  }
  ctx.restore();
}
