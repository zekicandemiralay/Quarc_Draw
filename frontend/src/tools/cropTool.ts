// Crop tool: drag handles to define the new page bounds, Enter to apply.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Rect, Vec } from '../core/geometry';
import { cropPage } from '../editor/pageOps';

type H = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

const RATIOS: Record<string, number | null> = { free: null, '1:1': 1, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9, '9:16': 9 / 16, a4: 210 / 297 };

export class CropTool extends Tool {
  id = 'crop'; name = 'Crop';
  cursor = 'crosshair';
  private rect: Rect | null = null;
  private handle: H | null = null;
  private start: Vec = { x: 0, y: 0 };
  private orig: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private pageId = '';

  activate() { const pg = this.ed.page; this.rect = { x: 0, y: 0, w: pg.width, h: pg.height }; this.pageId = pg.id; this.ed.requestOverlay(); }
  deactivate() { this.rect = null; this.ed.requestOverlay(); }

  private ratio(): number | null {
    const r = this.ed.opts.cropRatio;
    if (r === 'original') { const p = this.ed.page; return p.width / p.height; }
    return RATIOS[r] ?? null;
  }
  private hit(p: Vec): H | null {
    const r = this.rect; if (!r) return null;
    const tol = 10 / this.ed.view.zoom;
    const near = (x: number, y: number) => Math.abs(p.x - x) < tol && Math.abs(p.y - y) < tol;
    const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
    const names: H[][] = [['nw', 'n', 'ne'], ['w', 'move', 'e'], ['sw', 's', 'se']];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) if (!(i === 1 && j === 1) && near(xs[i], ys[j])) return names[j][i];
    if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) return 'move';
    return null;
  }
  pointerDown(e: ToolPointer) {
    if (!e.page || !this.rect) return;
    this.pageId = e.page.id;
    const h = this.hit(e.local);
    if (h) { this.handle = h; this.start = e.local; this.orig = { ...this.rect }; }
    else { this.handle = 'se'; this.rect = { x: e.local.x, y: e.local.y, w: 1, h: 1 }; this.orig = { ...this.rect }; this.start = e.local; }
  }
  pointerMove(e: ToolPointer) {
    if (!this.handle || !this.rect) return;
    const pg = this.ed.page, dx = e.local.x - this.start.x, dy = e.local.y - this.start.y, o = this.orig;
    let { x, y, w, h } = o;
    if (this.handle === 'move') { x = Math.min(Math.max(0, o.x + dx), pg.width - o.w); y = Math.min(Math.max(0, o.y + dy), pg.height - o.h); }
    else {
      if (this.handle.includes('w')) { x = o.x + dx; w = o.w - dx; }
      if (this.handle.includes('e')) w = o.w + dx;
      if (this.handle.includes('n')) { y = o.y + dy; h = o.h - dy; }
      if (this.handle.includes('s')) h = o.h + dy;
      const ratio = this.ratio();
      if (ratio && this.handle !== 'n' && this.handle !== 's') { const nh = w / ratio; if (this.handle.includes('n')) y = o.y + o.h - nh; h = nh; }
      else if (ratio) { const nw = h * ratio; w = nw; }
      if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      x = Math.max(0, x); y = Math.max(0, y); w = Math.min(w, pg.width - x); h = Math.min(h, pg.height - y);
    }
    this.rect = { x, y, w: Math.max(1, w), h: Math.max(1, h) };
    this.ed.requestOverlay();
  }
  hover(e: ToolPointer) {
    const h = this.hit(e.local);
    this.cursor = h === 'move' ? 'move' : h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : h ? 'nesw-resize' : 'crosshair';
  }
  pointerUp() { this.handle = null; }
  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') { this.apply(); return true; }
    if (e.key === 'Escape') { this.activate(); return true; }
    return false;
  }
  apply() {
    if (!this.rect) return;
    const r = this.rect;
    const pg = this.ed.page;
    if (r.w >= pg.width - 0.5 && r.h >= pg.height - 0.5) return;
    cropPage(this.ed, pg, r);
    this.activate();
  }
  get cropRect() { return this.rect; }
  drawOverlay(o: OverlayCtx) {
    if (!this.rect || !o.page || o.page.id !== this.pageId) return;
    const { ctx } = o, r = this.rect, pg = o.page;
    const ts = (x: number, y: number) => o.localToScreen(pg, { x, y });
    const tl = ts(r.x, r.y), br = ts(r.x + r.w, r.y + r.h), P0 = ts(0, 0), P1 = ts(pg.width, pg.height);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.rect(P0.x, P0.y, P1.x - P0.x, P1.y - P0.y); ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y); ctx.fill('evenodd');
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) { // rule of thirds
      ctx.beginPath(); ctx.moveTo(tl.x + ((br.x - tl.x) * i) / 3, tl.y); ctx.lineTo(tl.x + ((br.x - tl.x) * i) / 3, br.y); ctx.moveTo(tl.x, tl.y + ((br.y - tl.y) * i) / 3); ctx.lineTo(br.x, tl.y + ((br.y - tl.y) * i) / 3); ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 1.5;
    for (const [x, y] of [[tl.x, tl.y], [(tl.x + br.x) / 2, tl.y], [br.x, tl.y], [br.x, (tl.y + br.y) / 2], [br.x, br.y], [(tl.x + br.x) / 2, br.y], [tl.x, br.y], [tl.x, (tl.y + br.y) / 2]]) { ctx.beginPath(); ctx.rect(x - 5, y - 5, 10, 10); ctx.fill(); ctx.stroke(); }
    const label = `${Math.round(r.w)} × ${Math.round(r.h)}`;
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(tl.x, tl.y - 24, ctx.measureText(label).width + 12, 20); ctx.fillStyle = '#fff'; ctx.fillText(label, tl.x + 6, tl.y - 10);
    ctx.restore();
  }
}
