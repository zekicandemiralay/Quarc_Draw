// Interactive transform box (scale / rotate / move) used by the Move and Transform tools.

import type { Mat, Rect, Vec } from '../core/geometry';
import { IDENTITY, mApply, mApplyDir, mInvert, mMul, mRotate, mTranslate, norm, dot, sub, add, len, rectCorners, rectCenter } from '../core/geometry';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot' | 'body';

const HANDLE_UV: Record<string, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const OPPOSITE: Record<string, string> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

export interface DragMods { shift: boolean; alt: boolean; ctrl: boolean }

export class TransformBox {
  /** m maps the original rect into its current page-space position */
  m: Mat = IDENTITY;
  private m0: Mat = IDENTITY;
  private handle: HandleId | null = null;
  private p0: Vec = { x: 0, y: 0 };
  constructor(public rect: Rect) {}

  corners(): Vec[] { return rectCorners(this.rect).map((p) => mApply(this.m, p)); }
  center(): Vec { return mApply(this.m, rectCenter(this.rect)); }
  handlePos(id: HandleId, zoom = 1): Vec {
    if (id === 'rot') {
      const top = this.handlePos('n');
      const up = norm(mApplyDir(this.m, { x: 0, y: -1 }));
      return add(top, { x: up.x * 30 / zoom, y: up.y * 30 / zoom });
    }
    if (id === 'body') return this.center();
    const [u, v] = HANDLE_UV[id];
    return mApply(this.m, { x: this.rect.x + this.rect.w * u, y: this.rect.y + this.rect.h * v });
  }
  hit(p: Vec, zoom: number, allowRotate = true): HandleId | null {
    const tol = 9 / zoom;
    const ids: HandleId[] = ['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'];
    for (const id of ids) { const h = this.handlePos(id); if (Math.abs(h.x - p.x) <= tol && Math.abs(h.y - p.y) <= tol) return id; }
    if (allowRotate) { const r = this.handlePos('rot', zoom); if (Math.hypot(r.x - p.x, r.y - p.y) <= tol * 1.2) return 'rot'; }
    // body test: inside polygon of corners
    const c = this.corners();
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) { if (c[i].y > p.y !== c[j].y > p.y && p.x < ((c[j].x - c[i].x) * (p.y - c[i].y)) / (c[j].y - c[i].y) + c[i].x) inside = !inside; }
    return inside ? 'body' : null;
  }

  begin(id: HandleId, p: Vec) { this.handle = id; this.p0 = p; this.m0 = this.m; }
  get active() { return this.handle !== null; }
  end() { this.handle = null; }

  /** Updates this.m while dragging. */
  drag(p: Vec, mods: DragMods): Mat {
    const id = this.handle!;
    const c0 = mApply(this.m0, rectCenter(this.rect));
    let D: Mat;
    if (id === 'body') {
      let dx = p.x - this.p0.x, dy = p.y - this.p0.y;
      if (mods.shift) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      D = mTranslate(dx, dy);
    } else if (id === 'rot') {
      let a = Math.atan2(p.y - c0.y, p.x - c0.x) - Math.atan2(this.p0.y - c0.y, this.p0.x - c0.x);
      if (mods.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      D = mMul(mTranslate(c0.x, c0.y), mMul(mRotate(a), mTranslate(-c0.x, -c0.y)));
    } else {
      const ex = norm(mApplyDir(this.m0, { x: 1, y: 0 })), ey = norm(mApplyDir(this.m0, { x: 0, y: 1 }));
      const [u, v] = HANDLE_UV[id];
      const H = mApply(this.m0, { x: this.rect.x + this.rect.w * u, y: this.rect.y + this.rect.h * v });
      const [au, av] = HANDLE_UV[OPPOSITE[id]];
      const A = mods.alt ? c0 : mApply(this.m0, { x: this.rect.x + this.rect.w * au, y: this.rect.y + this.rect.h * av });
      const dH = sub(H, A), dP = sub(p, A);
      let sx = id === 'n' || id === 's' ? 1 : dot(dP, ex) / (dot(dH, ex) || 1e-6);
      let sy = id === 'e' || id === 'w' ? 1 : dot(dP, ey) / (dot(dH, ey) || 1e-6);
      const corner = id.length === 2;
      if (mods.shift && corner) { const s = Math.abs(sx) > Math.abs(sy) ? sx : sy; sx = s; sy = s; }
      else if (mods.shift) { const s = id === 'n' || id === 's' ? sy : sx; sx = s; sy = s; }
      const B: Mat = { a: ex.x, b: ex.y, c: ey.x, d: ey.y, e: 0, f: 0 };
      const S: Mat = { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
      D = mMul(mTranslate(A.x, A.y), mMul(B, mMul(S, mMul(mInvert(B), mTranslate(-A.x, -A.y)))));
    }
    this.m = mMul(D, this.m0);
    return D;
  }
  /** total transform from the original rect to the current state */
  get total(): Mat { return this.m; }

  cursorFor(id: HandleId | null): string {
    switch (id) {
      case 'nw': case 'se': return 'nwse-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'n': case 's': return 'ns-resize';
      case 'e': case 'w': return 'ew-resize';
      case 'rot': return 'alias';
      case 'body': return 'move';
      default: return 'default';
    }
  }

  draw(ctx: CanvasRenderingContext2D, toScreen: (p: Vec) => Vec, zoom: number, showRotate = true) {
    const c = this.corners().map(toScreen);
    ctx.save();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#1abc9c'; ctx.stroke();
    const sq = (p: Vec) => { ctx.beginPath(); ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#0d8f77'; ctx.lineWidth = 1.5; ctx.stroke(); };
    for (const id of Object.keys(HANDLE_UV) as HandleId[]) sq(toScreen(this.handlePos(id)));
    if (showRotate) {
      const top = toScreen(this.handlePos('n')), r = toScreen(this.handlePos('rot', zoom));
      ctx.strokeStyle = '#1abc9c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(r.x, r.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(r.x, r.y, 5.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#0d8f77'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    ctx.restore();
    void len;
  }
}
