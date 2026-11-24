// View navigation tools: hand (pan), zoom, rotate view.

import { Tool, ToolPointer } from './tool';
import type { Vec } from '../core/geometry';

export class HandTool extends Tool {
  id = 'hand'; name = 'Hand';
  cursor = 'grab';
  private last: Vec | null = null;
  pointerDown(e: ToolPointer) { this.last = e.screen; this.cursor = 'grabbing'; }
  pointerMove(e: ToolPointer) {
    if (!this.last) return;
    this.ed.view.panBy(e.screen.x - this.last.x, e.screen.y - this.last.y);
    this.last = e.screen;
    this.ed.changed('view');
  }
  pointerUp() { this.last = null; this.cursor = 'grab'; }
}

export class ZoomTool extends Tool {
  id = 'zoom'; name = 'Zoom';
  cursor = 'zoom-in';
  private start: Vec | null = null;
  private startZoom = 1;
  private moved = false;
  pointerDown(e: ToolPointer) { this.start = e.screen; this.startZoom = this.ed.view.zoom; this.moved = false; }
  pointerMove(e: ToolPointer) {
    if (!this.start) return;
    const dx = e.screen.x - this.start.x;
    if (Math.abs(dx) > 3) { this.moved = true; this.ed.view.zoomAt(this.start, this.startZoom * Math.exp(dx / 160)); this.ed.changed('view'); }
  }
  pointerUp(e: ToolPointer) {
    if (this.start && !this.moved) this.ed.zoomBy(e.alt ? 1 / 1.6 : 1.6, e.screen);
    this.start = null;
  }
}

export class RotateViewTool extends Tool {
  id = 'rotate-view'; name = 'Rotate View';
  cursor = 'alias';
  private startAngle = 0;
  private startRot = 0;
  private active = false;
  private ang(p: Vec) { const c = { x: this.ed.view.width / 2, y: this.ed.view.height / 2 }; return Math.atan2(p.y - c.y, p.x - c.x); }
  pointerDown(e: ToolPointer) { this.active = true; this.startAngle = this.ang(e.screen); this.startRot = this.ed.view.rotation; }
  pointerMove(e: ToolPointer) {
    if (!this.active) return;
    let r = this.startRot + (this.ang(e.screen) - this.startAngle);
    if (e.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12); // snap to 15°
    this.ed.view.rotateAt({ x: this.ed.view.width / 2, y: this.ed.view.height / 2 }, r);
    this.ed.changed('view');
  }
  pointerUp() { this.active = false; }
  keyDown(e: KeyboardEvent) { if (e.key === 'Escape') { this.ed.view.resetRotation(); this.ed.changed('view'); return true; } return false; }
}
