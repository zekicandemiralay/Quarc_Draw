// Text-markup tools for PDFs: highlight / underline / strikethrough / squiggle / select-and-copy.
// Selection works on the text boxes extracted by pdf.js (no DOM text layer needed, so it follows pan/zoom/rotation for free).

import { Tool, ToolPointer, OverlayCtx } from '../tools/tool';
import type { Editor } from '../editor/editor';
import type { Vec } from '../core/geometry';
import type { MarkupKind, VMarkup } from '../core/model';
import { baseObject } from '../core/model';
import { getPdfSource, PageText, quadFor } from './pdfSource';
import { addObject } from '../editor/objectOps';
import { uid } from '../core/util';
import { toast } from '../app/bus';

interface Pos { box: number; ch: number }
const cmp = (a: Pos, b: Pos) => (a.box !== b.box ? a.box - b.box : a.ch - b.ch);

export class MarkupTool extends Tool {
  cursor = 'text';
  private text: PageText | null = null;
  private pageId = '';
  private a: Pos | null = null;
  private b: Pos | null = null;
  constructor(ed: Editor, public id: string, private kind: MarkupKind | 'select', public name = 'Text markup') { super(ed); }

  private nearest(p: Vec): Pos | null {
    const boxes = this.text?.boxes;
    if (!boxes?.length) return null;
    let best: Pos | null = null, bestD = Infinity;
    boxes.forEach((bx, i) => {
      const dx = p.x - bx.ox, dy = p.y - bx.oy;
      const along = dx * bx.ux + dy * bx.uy, up = dx * bx.tx + dy * bx.ty;
      const ea = along < 0 ? -along : along > bx.width ? along - bx.width : 0;
      const eu = up > 0.92 * bx.height ? up - 0.92 * bx.height : up < -0.24 * bx.height ? -0.24 * bx.height - up : 0;
      const d = Math.hypot(ea, eu * 1.6); // weigh vertical distance higher so the right line wins
      if (d < bestD) { bestD = d; best = { box: i, ch: Math.round(Math.min(1, Math.max(0, along / (bx.width || 1))) * bx.str.length) }; }
    });
    return best;
  }

  private range(): { quads: Vec[][]; text: string } | null {
    if (!this.a || !this.b || !this.text) return null;
    const [s, e] = cmp(this.a, this.b) <= 0 ? [this.a, this.b] : [this.b, this.a];
    const quads: Vec[][] = [];
    let text = '';
    for (let i = s.box; i <= e.box; i++) {
      const bx = this.text.boxes[i];
      const c0 = i === s.box ? s.ch : 0, c1 = i === e.box ? e.ch : bx.str.length;
      if (c1 <= c0) continue;
      quads.push(quadFor(bx, c0, c1));
      const piece = bx.str.slice(c0, c1);
      const prev = this.text.boxes[i - 1];
      text += text ? (prev && Math.abs(prev.oy - bx.oy) > bx.height * 0.5 ? '\n' : ' ') + piece : piece;
    }
    return quads.length ? { quads, text } : null;
  }

  pointerDown(e: ToolPointer) {
    if (!e.page) return;
    const ed = this.ed;
    if (e.page.id !== ed.page.id) ed.setActivePage(e.page.id);
    const idx = e.page.background.pdfPage;
    const src = getPdfSource(ed.doc.id);
    this.pageId = e.page.id; this.a = this.b = null; this.text = null;
    if (idx === null || !src) { ed.setStatus('This page has no text layer'); return; }
    src.getText(idx).then((t) => {
      this.text = t;
      this.a = this.b = this.nearest(e.local);
      ed.requestOverlay();
    });
  }
  pointerMove(e: ToolPointer) {
    if (!this.a) return;
    this.b = this.nearest(e.local) ?? this.b;
    this.ed.requestOverlay();
  }
  pointerUp() {
    const r = this.range();
    this.a = this.b = null;
    const ed = this.ed;
    if (!r) { ed.requestOverlay(); return; }
    if (this.kind === 'select') {
      navigator.clipboard?.writeText(r.text).then(() => toast('Text copied', 'success')).catch(() => toast('Could not access the clipboard', 'error'));
    } else {
      const flat = r.quads.map((q) => q.flatMap((p) => [p.x, p.y]));
      const m: VMarkup = {
        ...baseObject(), id: uid('ob'), type: 'markup', kind: this.kind, quads: flat, color: ed.opts.markupColor, quote: r.text, comment: '', fill: null,
      };
      addObject(ed, m, `${this.kind[0].toUpperCase()}${this.kind.slice(1)}`);
      ed.objSel = [];
      ed.changed('objsel');
    }
    ed.requestOverlay();
  }
  cancel() { this.a = this.b = null; }
  drawOverlay(o: OverlayCtx) {
    if (!o.page || o.page.id !== this.pageId) return;
    const r = this.range();
    if (!r) return;
    const { ctx } = o;
    ctx.save();
    ctx.fillStyle = this.kind === 'select' ? 'rgba(26,115,232,0.30)' : this.kind === 'highlight' ? this.ed.opts.markupColor + '99' : 'rgba(26,188,156,0.22)';
    for (const q of r.quads) {
      ctx.beginPath();
      q.forEach((p, i) => { const s = o.localToScreen(o.page!, p); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}
