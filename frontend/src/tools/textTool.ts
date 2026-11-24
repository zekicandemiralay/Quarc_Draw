// Text tool: in-place WYSIWYG editing with a DOM textarea that tracks pan / zoom / rotation.

import { Tool, ToolPointer } from './tool';
import type { Editor } from '../editor/editor';
import type { VText } from '../core/model';
import { baseObject, findObject, solid } from '../core/model';
import { fontString, layoutText } from '../core/vector';
import { addObject, updateObjects, deleteObjects } from '../editor/objectOps';
import { pickObjectAt } from './moveTools';
import { paintColor } from '../core/vector';
import { uid } from '../core/util';

export class TextTool extends Tool {
  id = 'text'; name = 'Text';
  cursor = 'text';
  private wrap: HTMLDivElement | null = null;
  private ta: HTMLTextAreaElement | null = null;
  private work: VText | null = null;
  private isNew = false;
  private pageId = '';
  private off: (() => void) | null = null;
  private dragStart: { x: number; y: number } | null = null;

  get editing() { return !!this.work; }

  deactivate() { this.commit(); }

  pointerDown(e: ToolPointer) {
    const ed = this.ed;
    if (!e.page) return;
    // clicking elsewhere while editing commits first
    if (this.work) { this.commit(); }
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const hit = pickObjectAt(ed, e.local);
    if (hit && hit.type === 'text') { this.editObject(hit.id); return; }
    const o = ed.opts;
    const t: VText = {
      ...baseObject(), id: uid('ob'), type: 'text', x: e.local.x, y: e.local.y, text: '', font: { ...o.font }, align: o.textAlign,
      lineHeight: o.lineHeight, letterSpacing: o.letterSpacing, boxW: null, underline: o.textUnderline, strike: o.textStrike,
      fill: solid(ed.fg), stroke: null,
    };
    this.dragStart = { x: e.local.x, y: e.local.y };
    this.pageId = e.page.id;
    this.begin(t, true);
  }
  pointerMove(e: ToolPointer) {
    if (this.dragStart && this.work && this.isNew) {
      const w = e.local.x - this.dragStart.x;
      if (Math.abs(w) > 24) { this.work = { ...this.work, boxW: Math.abs(w), x: Math.min(this.dragStart.x, e.local.x) }; this.sync(); }
    }
  }
  pointerUp() { this.dragStart = null; this.ta?.focus(); }

  /** begin editing an existing text object */
  editObject(id: string) {
    const f = findObject(this.ed.page, id);
    if (!f || f.obj.type !== 'text') return;
    this.pageId = this.ed.page.id;
    this.begin(f.obj, false);
  }

  private begin(t: VText, isNew: boolean) {
    const ed = this.ed;
    const host = ed.overlayHost;
    if (!host) return;
    this.work = t; this.isNew = isNew;
    if (!isNew) { ed.hiddenObjects.add(t.id); ed.objSel = [t.id]; ed.changed('objsel'); ed.requestRender(); }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none;z-index:20;';
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.value = t.text;
    ta.wrap = 'off';
    ta.setAttribute('data-text-editor', '1');
    ta.style.cssText = 'position:absolute;left:0;top:0;margin:0;padding:0;border:none;outline:1px dashed #1abc9c;outline-offset:3px;background:rgba(255,255,255,0.0);resize:none;overflow:hidden;pointer-events:auto;transform-origin:0 0;caret-color:currentColor;';
    wrap.appendChild(ta);
    host.appendChild(wrap);
    this.wrap = wrap; this.ta = ta;
    ta.addEventListener('input', () => { if (this.work) { this.work = { ...this.work, text: ta.value }; this.sync(); } });
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') { ev.preventDefault(); this.commit(); ed.setTool('move'); }
      else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); this.commit(); ed.setTool('move'); }
      else if (ev.key === 'Tab') { ev.preventDefault(); const s = ta.selectionStart; ta.setRangeText('\t', s, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input')); }
    });
    ta.addEventListener('keyup', (ev) => ev.stopPropagation());
    this.off = ed.events.on('view', () => this.sync());
    this.sync();
    setTimeout(() => { ta.focus(); if (!isNew) ta.select(); }, 0);
  }

  private sync() {
    const ed = this.ed, t = this.work, wrap = this.wrap, ta = this.ta;
    if (!t || !wrap || !ta) return;
    const page = ed.doc.pages.find((p) => p.id === this.pageId);
    if (!page) return;
    const m = ed.view.pageMatrix(page);
    wrap.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
    const lay = layoutText({ ...t, text: t.text || ' ' });
    const w = (t.boxW ?? lay.bounds.w) + 12, h = Math.max(lay.bounds.h, t.font.size * t.lineHeight) + 2;
    ta.style.font = fontString(t.font);
    ta.style.lineHeight = String(t.lineHeight);
    ta.style.letterSpacing = `${t.letterSpacing}px`;
    ta.style.textAlign = t.align;
    ta.style.whiteSpace = t.boxW ? 'pre-wrap' : 'pre';
    ta.style.color = paintColor(t.fill);
    ta.style.textDecoration = [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    ta.style.width = `${w}px`; ta.style.height = `${h}px`;
    const tf = t.tf;
    ta.style.transform = `matrix(${tf.a},${tf.b},${tf.c},${tf.d},${tf.e},${tf.f}) translate(${t.x}px,${t.y}px)`;
    // textarea's own origin is its top-left, so offset translate is applied inside matrix
    ta.style.left = '0px'; ta.style.top = '0px';
  }

  /** update formatting of the text being edited (called from the options bar) */
  format(patch: Partial<VText>) {
    if (!this.work) return false;
    this.work = { ...this.work, ...patch };
    this.sync();
    return true;
  }

  commit() {
    const ed = this.ed, t = this.work;
    if (!t) return;
    const text = this.ta?.value ?? t.text;
    this.work = null;
    this.off?.(); this.off = null;
    this.wrap?.remove(); this.wrap = null; this.ta = null;
    ed.hiddenObjects.delete(t.id);
    const final: VText = { ...t, text };
    if (this.isNew) { if (text.trim()) addObject(ed, final, 'Add text'); }
    else if (!text.trim()) deleteObjects(ed, [t.id]);
    else updateObjects(ed, [t.id], () => final, 'Edit text');
    ed.requestRender();
  }
  cancel() { if (this.work) { const t = this.work; this.work = null; this.off?.(); this.wrap?.remove(); this.wrap = null; this.ta = null; this.ed.hiddenObjects.delete(t.id); this.ed.requestRender(); } }
}
