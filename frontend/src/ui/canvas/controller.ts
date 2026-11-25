// Pointer / touch / pen / wheel input → tools and view navigation.

import type { Editor } from '../../editor/editor';
import type { Page } from '../../core/model';
import type { Vec } from '../../core/geometry';
import type { Tool, ToolPointer } from '../../tools/tool';
import { prefs } from '../../app/store';
import { bus } from '../../app/bus';
import { normAngle, stickyRotation, detentTick, ROTATE_ENGAGE } from '../../core/viewport';

const BRUSH_FAMILY = new Set(['brush', 'smudge', 'blur', 'sharpen', 'dodge', 'burn']);

interface Active { id: number; tool: Tool; page: Page | null; pan: boolean; temp: boolean; lastScreen: Vec }

export class CanvasController {
  private pts = new Map<number, { x: number; y: number; type: string; t: number }>();
  private active: Active | null = null;
  private gesture: { dist: number; zoom: number; angle: number; rot: number; cx: number; cy: number; start: number; moved: number; fingers: number; raw: number; twist: number; engaged: boolean; snapped: boolean } | null = null;
  private lastPen = 0;
  private lastClick = { t: 0, x: 0, y: 0, n: 0 };
  private onAll: [string, (e: any) => void][] = [];

  constructor(private ed: Editor, private el: HTMLElement) {}

  attach() {
    const add = (type: string, fn: (e: any) => void, opts?: any) => { this.el.addEventListener(type, fn, opts); this.onAll.push([type, fn]); };
    add('pointerdown', (e) => this.down(e));
    add('pointermove', (e) => this.move(e));
    add('pointerup', (e) => this.up(e));
    add('pointercancel', (e) => this.up(e, true));
    add('pointerleave', () => { if (!this.active) { this.ed.pointerLocal = null; this.ed.changed('status'); } });
    add('wheel', (e) => this.wheel(e), { passive: false });
    add('contextmenu', (e) => { e.preventDefault(); if (!this.active) bus.emit('context-menu', { x: e.clientX, y: e.clientY }); });
    add('dblclick', (e) => e.preventDefault());
  }
  detach() { for (const [t, f] of this.onAll) this.el.removeEventListener(t, f); this.onAll = []; }

  /**
   * The status bar shows the pointer position. Re-rendering it (React, then style + layout of the page) costs more than the
   * drawing itself — it was the single biggest cost of a stroke on a slow device — so it is refreshed a few times a second
   * while hovering and not at all while a stroke is in progress (it catches up when the pen lifts).
   */
  private statusTimer = 0;
  private statusSoon() {
    if (this.statusTimer) return;
    this.statusTimer = window.setTimeout(() => { this.statusTimer = 0; this.ed.changed('status'); }, 120);
  }

  private rect() { return this.el.getBoundingClientRect(); }
  private screenOf(e: PointerEvent | WheelEvent): Vec { const r = this.rect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  private build(e: PointerEvent, page: Page | null, screen?: Vec, detail = 0): ToolPointer {
    const ed = this.ed, s = screen ?? this.screenOf(e);
    const world = ed.view.toWorld(s);
    const hit = page ? { page, local: ed.view.worldToLocal(page, world) } : null;
    return {
      world, local: hit?.local ?? world, page, screen: s,
      pressure: e.pointerType === 'mouse' ? (e.buttons ? 0.5 : 0) : e.pressure, tiltX: e.tiltX || 0, tiltY: e.tiltY || 0,
      pointerType: e.pointerType, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, space: ed.spaceDown,
      button: e.button, buttons: e.buttons, time: e.timeStamp, detail,
    };
  }

  private pickPage(e: PointerEvent): Page | null {
    const ed = this.ed, w = ed.view.toWorld(this.screenOf(e));
    return ed.view.pageAt(ed.doc, w, ed.page)?.page ?? null;
  }

  private toolFor(e: PointerEvent): { tool: Tool; temp: boolean } {
    const ed = this.ed;
    const eraserEnd = e.pointerType === 'pen' && (e.buttons & 32) !== 0;
    if (eraserEnd) return { tool: ed.getTool('eraser'), temp: true };
    if (e.altKey && BRUSH_FAMILY.has(ed.toolId) && e.pointerType === 'mouse') return { tool: ed.getTool('eyedropper'), temp: true };
    return { tool: ed.tool, temp: false };
  }

  // ------------------------------------------------------------ events
  private down(e: PointerEvent) {
    const ed = this.ed;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic / unknown pointer id */ }
    const now = performance.now();
    ed.lastInputAt = now;
    if (e.pointerType === 'pen') this.lastPen = now;
    const p = prefs.get();
    if (e.pointerType === 'touch' && p.palmRejection && now - this.lastPen < 700) return;
    this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType, t: now });

    const touches = [...this.pts.values()].filter((q) => q.type === 'touch');
    // multi-touch → navigation gesture, cancel any stroke in flight
    if (e.pointerType === 'touch' && touches.length >= 2) {
      if (this.active) { this.active.tool.cancel(); this.active = null; }
      this.beginGesture(touches);
      return;
    }
    // pen-only mode: single touch pans
    const touchPan = e.pointerType === 'touch' && p.penOnly;
    const wantPan = e.button === 1 || (ed.spaceDown && e.button === 0) || touchPan;
    const s = this.screenOf(e);
    if (wantPan) { this.active = { id: e.pointerId, tool: ed.getTool('hand'), page: null, pan: true, temp: true, lastScreen: s }; this.el.style.cursor = 'grabbing'; return; }
    if (e.button === 2) return;

    // click counting for double-click detection
    const dx = e.clientX - this.lastClick.x, dy = e.clientY - this.lastClick.y;
    const n = now - this.lastClick.t < 380 && Math.hypot(dx, dy) < 8 ? this.lastClick.n + 1 : 1;
    this.lastClick = { t: now, x: e.clientX, y: e.clientY, n };

    const { tool, temp } = this.toolFor(e);
    const page = this.pickPage(e);
    this.active = { id: e.pointerId, tool, page, pan: false, temp, lastScreen: s };
    const tp = this.build(e, page, s, n);
    tool.pointerDown(tp);
    ed.requestOverlay();
  }

  private move(e: PointerEvent) {
    const ed = this.ed;
    const rec = this.pts.get(e.pointerId);
    if (rec) { rec.x = e.clientX; rec.y = e.clientY; }
    if (this.gesture) { this.updateGesture(); return; }
    const a = this.active;
    if (a && a.id === e.pointerId) {
      if (a.pan) {
        const s = this.screenOf(e);
        ed.view.panBy(s.x - a.lastScreen.x, s.y - a.lastScreen.y); a.lastScreen = s;
        ed.syncActivePageToView(); ed.changed('view');
        return;
      }
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const list = events.length ? events : [e];
      for (const ev of list) a.tool.pointerMove(this.build(ev, a.page, undefined, 0));
      a.tool.moveEnd();
      ed.lastInputAt = performance.now();
      ed.pointerLocal = a.page ? ed.view.worldToLocal(a.page, ed.view.toWorld(this.screenOf(e))) : null;
      return;
    }
    // hover
    if (e.pointerType === 'touch') return;
    const page = this.pickPage(e);
    const tp = this.build(e, page);
    ed.pointerLocal = page ? tp.local : null;
    this.statusSoon();
    const tool = ed.spaceDown ? ed.getTool('hand') : ed.tool;
    tool.hover(tp);
    this.el.style.cursor = tool.cursor;
  }

  private up(e: PointerEvent, cancelled = false) {
    const ed = this.ed;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const rec = this.pts.get(e.pointerId);
    this.pts.delete(e.pointerId);
    if (this.gesture) {
      const g = this.gesture;
      const remaining = [...this.pts.values()].filter((q) => q.type === 'touch').length;
      if (remaining < 2) {
        // tap gestures: quick two-finger tap = undo, three-finger tap = redo
        if (!cancelled && performance.now() - g.start < 260 && g.moved < 12) { if (g.fingers === 2) ed.undo(); else if (g.fingers >= 3) ed.redo(); }
        this.gesture = null;
        if (remaining === 0) this.active = null;
      }
      return;
    }
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    if (a.pan) { this.el.style.cursor = a.temp ? ed.tool.cursor : 'default'; return; }
    if (cancelled) { a.tool.cancel(); return; }
    a.tool.pointerUp(this.build(e, a.page, undefined, this.lastClick.n));
    ed.requestOverlay();
    this.statusSoon();
    void rec;
  }

  // ------------------------------------------------------------ gestures
  private beginGesture(touches: { x: number; y: number }[]) {
    const [a, b] = touches;
    const r = this.rect();
    this.gesture = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.ed.view.zoom, angle: Math.atan2(b.y - a.y, b.x - a.x), rot: this.ed.view.rotation,
      cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, start: performance.now(), moved: 0, fingers: touches.length,
      raw: this.ed.view.rotation, twist: 0, engaged: false, snapped: stickyRotation(this.ed.view.rotation).snapped,
    };
  }
  private updateGesture() {
    const g = this.gesture; if (!g) return;
    const touches = [...this.pts.values()].filter((q) => q.type === 'touch');
    if (touches.length < 2) return;
    const [a, b] = touches, r = this.rect(), v = this.ed.view;
    g.fingers = Math.max(g.fingers, touches.length);
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
    g.moved += Math.abs(cx - g.cx) + Math.abs(cy - g.cy) + Math.abs(dist - g.dist);
    v.panBy(cx - g.cx, cy - g.cy);
    v.zoomAt({ x: cx, y: cy }, v.zoom * (dist / g.dist));
    // rotation: only after a deliberate twist, then free — except near upright / quarter turns, where it sticks
    const da = normAngle(angle - g.angle);
    if (g.engaged) g.raw += da; else if (Math.abs((g.twist += da)) > ROTATE_ENGAGE) g.engaged = true;
    if (g.engaged) {
      const s = stickyRotation(g.raw);
      if (s.snapped && !g.snapped) detentTick();
      g.snapped = s.snapped;
      if (Math.abs(normAngle(s.rot - v.rotation)) > 1e-9) v.rotateAt({ x: cx, y: cy }, s.rot);
    }
    g.dist = dist; g.angle = angle; g.cx = cx; g.cy = cy;
    this.ed.syncActivePageToView();
    this.ed.changed('view');
  }

  // ------------------------------------------------------------ wheel
  private wheel(e: WheelEvent) {
    e.preventDefault();
    const ed = this.ed, v = ed.view, s = this.screenOf(e);
    const mouseWheel = e.deltaMode === 1 || (Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 && e.deltaX === 0);
    if (e.ctrlKey || (mouseWheel && !e.shiftKey)) {
      const k = Math.exp(-e.deltaY * (e.ctrlKey && !mouseWheel ? 0.01 : 0.0016) * (e.deltaMode === 1 ? 16 : 1));
      v.zoomAt(s, v.zoom * k);
    } else {
      const f = e.deltaMode === 1 ? 24 : 1;
      if (e.shiftKey && e.deltaX === 0) v.panBy(-e.deltaY * f, 0); else v.panBy(-e.deltaX * f, -e.deltaY * f);
    }
    ed.syncActivePageToView();
    ed.changed('view');
  }
}
