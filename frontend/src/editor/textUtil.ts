// Helpers for creating text objects programmatically (paste text, templates, stamps).

import type { Editor } from './editor';
import type { VText } from '../core/model';
import { baseObject, solid } from '../core/model';
import { uid } from '../core/util';
import { addObject } from './objectOps';

export function createTextObject(ed: Editor, text: string, at?: { x: number; y: number }, patch: Partial<VText> = {}): VText {
  const o = ed.opts;
  const vis = ed.view.visibleWorldRect(), wr = ed.worldRectOf(ed.page);
  const cx = at?.x ?? Math.min(Math.max(vis.x + vis.w / 2, wr.x), wr.x + wr.w) - wr.x - 100;
  const cy = at?.y ?? Math.min(Math.max(vis.y + vis.h / 2, wr.y), wr.y + wr.h) - wr.y - 40;
  const t: VText = {
    ...baseObject(), id: uid('ob'), type: 'text', x: cx, y: cy, text, font: { ...o.font }, align: o.textAlign, lineHeight: o.lineHeight,
    letterSpacing: o.letterSpacing, boxW: text.length > 60 ? Math.min(ed.page.width * 0.7, 700) : null, underline: false, strike: false, fill: solid(ed.fg), stroke: null, ...patch,
  };
  addObject(ed, t, 'Add text');
  return t;
}
