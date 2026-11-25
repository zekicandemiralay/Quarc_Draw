// Small utility tools: place an image, measure a distance.

import { Tool, ToolPointer, OverlayCtx } from './tool';
import type { Vec } from '../core/geometry';
import { bus } from '../app/bus';

export class ImageTool extends Tool {
  id = 'image'; name = 'Image';
  cursor = 'crosshair';
  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    if (e.page.id !== this.ed.page.id) this.ed.setActivePage(e.page.id);
    bus.emit('pick-image', { asObject: false });
    this.ed.setTool('move');
  }
}

export class MeasureTool extends Tool {
  id = 'measure'; name = 'Measure';
  cursor = 'crosshair';
  private a: Vec | null = null; private b: Vec | null = null; private pageId = '';
  pointerDown(e: ToolPointer) { if (e.page) { this.a = e.local; this.b = e.local; this.pageId = e.page.id; } }
  pointerMove(e: ToolPointer) { if (this.a) { this.b = e.local; this.ed.requestOverlay(); const dx = this.b.x - this.a.x, dy = this.b.y - this.a.y; this.ed.setStatus(`Distance ${Math.hypot(dx, dy).toFixed(1)} px · angle ${(Math.atan2(-dy, dx) * 180 / Math.PI).toFixed(1)}° · Δx ${dx.toFixed(1)} Δy ${dy.toFixed(1)}`, 0); } }
  pointerUp() { /* keep the line until next click */ }
  drawOverlay(o: OverlayCtx) {
    if (!this.a || !this.b || !o.page || o.page.id !== this.pageId) return;
    const A = o.localToScreen(o.page, this.a), B = o.localToScreen(o.page, this.b), { ctx } = o;
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.strokeStyle = '#ff9f0a'; ctx.lineWidth = 1.5; ctx.stroke();
    for (const p of [A, B]) { ctx.fillStyle = '#ff9f0a'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
    const d = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y).toFixed(1) + ' px';
    ctx.font = '12px system-ui'; ctx.fillStyle = 'rgba(0,0,0,0.75)'; const w = ctx.measureText(d).width; ctx.fillRect((A.x + B.x) / 2 + 8, (A.y + B.y) / 2 - 18, w + 10, 20);
    ctx.fillStyle = '#fff'; ctx.fillText(d, (A.x + B.x) / 2 + 13, (A.y + B.y) / 2 - 4); ctx.restore();
  }
}
