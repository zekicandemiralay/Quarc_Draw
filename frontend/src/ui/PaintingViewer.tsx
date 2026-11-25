// The paintings, full screen, in a gilded frame on a gallery wall. Swipe (or ← →) for the next one, tap the wall or Esc to close.

import { useEffect, useRef, useState } from 'react';
import { PAINTINGS } from './paintings';
import { Icon } from './icons';

/** Horizontal swipe + tap on an element (touch, pen and mouse alike). `drag` is the live horizontal offset, for a little feedback. */
export function useSwipe(o: { prev: () => void; next: () => void; tap?: (target: HTMLElement) => void }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [drag, setDrag] = useState(0);
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;                       // buttons keep their own clicks
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current; if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > Math.abs(dy)) setDrag(dx);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = start.current; if (!s || s.id !== e.pointerId) return;
      start.current = null; setDrag(0);
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) (dx < 0 ? o.next : o.prev)();
      else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) o.tap?.(e.target as HTMLElement);
    },
    onPointerCancel: () => { start.current = null; setDrag(0); },
  };
  return { handlers, drag };
}

export function PaintingViewer({ index, onIndex, onClose }: { index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const n = PAINTINGS.length, p = PAINTINGS[index];
  const go = (d: number) => onIndex((index + d + n) % n);
  const { handlers, drag } = useSwipe({ prev: () => go(-1), next: () => go(1), tap: (t) => { if (!t.closest('.frame, .plaque, button')) onClose(); } });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const act = e.key === 'Escape' ? onClose : e.key === 'ArrowRight' ? () => go(1) : e.key === 'ArrowLeft' ? () => go(-1) : null;
      if (!act) return;
      e.preventDefault(); e.stopImmediatePropagation(); act();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`“${p.title}”`} {...handlers}>
      <button className="viewer-x" title="Close (Esc)" onClick={onClose}><Icon name="close" size={20} /></button>
      {n > 1 && <button className="viewer-nav prev" title="Previous painting (←)" onClick={() => go(-1)}><Icon name="chevron-left" size={28} /></button>}
      <figure className="frame" key={p.src} style={drag ? { transform: `translateX(${drag * 0.4}px) rotate(${drag * 0.004}deg)`, transition: 'none' } : undefined}>
        <div className="mat"><img src={p.src} alt={p.title} draggable={false} /></div>
      </figure>
      <div className="plaque"><b>{p.title}</b><span>Oil on canvas · painted in Quarc Draw</span></div>
      {n > 1 && <div className="dots viewer-dots">{PAINTINGS.map((q, k) => <button key={q.src} className={k === index ? 'on' : ''} title={`“${q.title}”`} onClick={() => onIndex(k)} />)}</div>}
      {n > 1 && <button className="viewer-nav next" title="Next painting (→)" onClick={() => go(1)}><Icon name="chevron-right" size={28} /></button>}
    </div>
  );
}
