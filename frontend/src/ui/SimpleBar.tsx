// The floating bar of full-screen drawing: brush, eraser, colour, size, undo, redo — and a big way out.

import { useRef, useState } from 'react';
import type { Editor } from '../editor/editor';
import { useEditor } from '../editor/editor';
import { exitFullDraw } from '../app/fullDraw';
import { Popover } from './common';
import { ColorPicker } from './ColorPicker';
import { Icon } from './icons';

const MAX_SIZE = 800;
const toLog = (s: number) => Math.log(Math.max(1, s));
const fromLog = (v: number) => Math.max(1, Math.round(Math.exp(v)));

export function SimpleBar({ ed }: { ed: Editor }) {
  const toolId = useEditor(ed, ['tool'], () => ed.toolId);
  const fg = useEditor(ed, ['colors'], () => ed.fg);
  const size = useEditor(ed, ['brush', 'tool'], () => ed.brush.size);
  const { canUndo, canRedo } = useEditor(ed, ['history'], () => ({ canUndo: ed.history.canUndo, canRedo: ed.history.canRedo }));
  const [pick, setPick] = useState<DOMRect | null>(null);
  const closedAt = useRef(0); // a tap on the swatch while the picker is open closes it (and must not reopen it)
  const dot = Math.max(3, Math.min(22, size / 3));

  return (
    <div className="simplebar" role="toolbar" aria-label="Full-screen drawing tools">
      <button className="sb-exit" title="Back to the normal view (Esc)" onClick={exitFullDraw}><Icon name="collapse" size={17} /><span>Exit</span></button>
      <span className="sb-sep" />
      <button className={`sb-btn ${toolId === 'brush' ? 'on' : ''}`} title="Brush (B)" aria-pressed={toolId === 'brush'} onClick={() => ed.setTool('brush')}><Icon name="brush" size={19} /></button>
      <button className={`sb-btn ${toolId === 'eraser' ? 'on' : ''}`} title="Eraser (E)" aria-pressed={toolId === 'eraser'} onClick={() => ed.setTool('eraser')}><Icon name="eraser" size={19} /></button>
      <button className="sb-color" title="Colour" aria-label="Colour" onClick={(e) => { if (!pick && performance.now() - closedAt.current > 350) setPick(e.currentTarget.getBoundingClientRect()); }}><i style={{ background: fg }} /></button>
      <span className="sb-sep" />
      <label className="sb-size" title="Brush size">
        <span className="sb-dot"><i style={{ width: dot, height: dot }} /></span>
        <input type="range" min={0} max={Math.log(MAX_SIZE)} step={0.01} value={toLog(size)} onChange={(e) => ed.setBrush({ size: fromLog(+e.target.value) })} aria-label="Brush size" />
        <b>{Math.round(size)}</b>
      </label>
      <span className="sb-sep" />
      <button className="sb-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => ed.undo()}><Icon name="undo" size={19} /></button>
      <button className="sb-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => ed.redo()}><Icon name="redo" size={19} /></button>
      {pick && (
        <Popover anchor={{ x: pick.left - 100, y: pick.top, w: pick.width, h: pick.height + 4 }} onClose={() => { ed.pushRecentColor(ed.fg); closedAt.current = performance.now(); setPick(null); }}>
          <ColorPicker compact color={fg} onChange={(c) => ed.setFg(c)} />
        </Popover>
      )}
    </div>
  );
}
