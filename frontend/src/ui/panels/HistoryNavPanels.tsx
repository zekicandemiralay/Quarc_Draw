// History panel + Navigator panel.

import { useEffect, useRef } from 'react';
import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import { renderPageToCanvas } from '../../core/render';
import { timeAgo } from '../../core/util';
import { Icon } from '../icons';

export function HistoryPanel({ ed }: { ed: Editor }) {
  useEditor(ed, ['history'], () => ed.history.revision);
  const items = ed.history.items;
  const cur = ed.history.currentIndex;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('.now')?.scrollIntoView({ block: 'nearest' }); }, [cur, items.length]);
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row">
        <button className="btn sm" disabled={!ed.history.canUndo} onClick={() => ed.undo()}><Icon name="undo" size={14} />Undo</button>
        <button className="btn sm" disabled={!ed.history.canRedo} onClick={() => ed.redo()}><Icon name="redo" size={14} />Redo</button>
        <span className="hint" style={{ marginLeft: 'auto' }}>{items.length} steps</span>
      </div>
      <div ref={list} style={{ maxHeight: 300, overflowY: 'auto' }}>
        <div className={`history-item ${cur === 0 ? 'now' : ''}`} onClick={() => { ed.history.jumpTo(0); ed.changed('doc', 'layers'); }}><Icon name="file" size={13} /><span className="hint">Document opened</span></div>
        {items.map((it, i) => (
          <div key={i} className={`history-item ${it.state === 'undone' ? 'undone' : ''} ${cur === i + 1 ? 'now' : ''}`} onClick={() => { ed.history.jumpTo(i + 1); ed.changed('doc', 'layers'); }}>
            <span style={{ flex: 1 }}>{it.label}</span><span className="hint">{timeAgo(it.time)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NavigatorPanel({ ed }: { ed: Editor }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const tick = useEditor(ed, ['doc', 'layers', 'page'], () => ed.versions.doc + ed.versions.layers + ed.versions.page);
  const view = useEditor(ed, ['view'], () => ed.versions.view);
  void view;
  const pg = ed.page;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const k = Math.min(260 / pg.width, 160 / pg.height, 1);
    const t = setTimeout(() => {
      const p = renderPageToCanvas(ed.doc, pg, k);
      c.width = p.width; c.height = p.height; c.getContext('2d')!.drawImage(p, 0, 0);
      positionFrame();
    }, 120);
    return () => clearTimeout(t);
  }, [ed, pg.id, pg.width, pg.height, tick]);

  const positionFrame = () => {
    const c = ref.current, f = frame.current; if (!c || !f) return;
    const k = c.width / pg.width;
    const r = ed.worldRectOf(pg), vis = ed.view.visibleWorldRect();
    const x = (vis.x - r.x) * k, y = (vis.y - r.y) * k, w = vis.w * k, h = vis.h * k;
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(c.width, x + w), y1 = Math.min(c.height, y + h);
    f.style.cssText = `left:${x0}px;top:${y0}px;width:${Math.max(4, x1 - x0)}px;height:${Math.max(4, y1 - y0)}px;display:${x1 > x0 && y1 > y0 ? 'block' : 'none'}`;
  };
  useEffect(() => ed.events.on('view', positionFrame));
  const pan = (e: React.PointerEvent) => {
    const c = ref.current!, b = c.getBoundingClientRect(), k = c.width / pg.width;
    const r = ed.worldRectOf(pg);
    const move = (ev: { clientX: number; clientY: number }) => {
      ed.view.cx = r.x + ((ev.clientX - b.left) / b.width) * c.width / k; ed.view.cy = r.y + ((ev.clientY - b.top) / b.height) * c.height / k;
      ed.changed('view');
    };
    move(e);
    const el = e.currentTarget as HTMLElement; el.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => move(ev), up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  };
  const z = useEditor(ed, ['view'], () => ed.view.zoom);
  return (
    <div className="col">
      <div className="nav-view" onPointerDown={pan} style={{ cursor: 'crosshair' }}><canvas ref={ref} /><div className="frame" ref={frame} /></div>
      <div className="row">
        <button className="btn ghost icon sm" onClick={() => ed.zoomBy(1 / 1.25)}><Icon name="minus" size={14} /></button>
        <input className="slider" type="range" min={Math.log(0.05)} max={Math.log(32)} step={0.01} value={Math.log(z)} onChange={(e) => ed.zoomTo(Math.exp(parseFloat(e.target.value)))} />
        <button className="btn ghost icon sm" onClick={() => ed.zoomBy(1.25)}><Icon name="plus" size={14} /></button>
        <span className="hint" style={{ minWidth: 42, textAlign: 'right' }}>{Math.round(z * 100)}%</span>
      </div>
    </div>
  );
}
