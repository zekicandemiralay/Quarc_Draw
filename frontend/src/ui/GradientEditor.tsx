// Gradient stop editor (used for the gradient tool and for object fills).

import { useRef, useState } from 'react';
import type { GradientStop } from '../core/color';
import { ColorPicker } from './ColorPicker';
import { sampleGradient, rgbaToHex } from '../core/color';
import { GRADIENTS } from '../assets/libraries';
import { prefs } from '../app/store';
import { Icon } from './icons';

const css = (stops: GradientStop[]) => `linear-gradient(90deg, ${[...stops].sort((a, b) => a.pos - b.pos).map((s) => `${s.color} ${Math.round(s.pos * 100)}%`).join(', ')})`;

export function GradientEditor({ stops, onChange, presets = true }: { stops: GradientStop[]; onChange: (s: GradientStop[]) => void; presets?: boolean }) {
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const user = prefs.useSelect((p) => p.userGradients);
  const cur = stops[Math.min(sel, stops.length - 1)];
  const setStop = (i: number, p: Partial<GradientStop>) => onChange(stops.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const dragStop = (e: React.PointerEvent, i: number) => {
    e.stopPropagation(); setSel(i);
    const el = bar.current!; const r = el.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => setStop(i, { pos: Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) });
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const addStop = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    const pos = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const c = rgbaToHex(sampleGradient(stops, pos), true);
    onChange([...stops, { pos, color: c }]);
    setSel(stops.length);
  };
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="gradient-bar" ref={bar} style={{ background: css(stops), marginBottom: 14 }} onDoubleClick={(e) => addStop(e as any)} title="Double-click to add a stop">
        {stops.map((s, i) => <div key={i} className={`stop ${i === sel ? 'on' : ''}`} style={{ left: `${s.pos * 100}%`, background: s.color }} onPointerDown={(e) => dragStop(e, i)} />)}
      </div>
      <div className="row">
        <span className="hint">Stop {sel + 1} of {stops.length}</span><span className="spacer" />
        <button className="btn sm" disabled={stops.length <= 2} onClick={() => { onChange(stops.filter((_, i) => i !== sel)); setSel(0); }}><Icon name="trash" size={13} />Remove</button>
        <button className="btn sm" onClick={() => onChange(stops.map((s) => ({ ...s, pos: 1 - s.pos })))}>Reverse</button>
      </div>
      {cur && <ColorPicker color={cur.color} onChange={(c) => setStop(Math.min(sel, stops.length - 1), { color: c })} />}
      {presets && (
        <div>
          <div className="hint" style={{ marginBottom: 4 }}>Presets</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {[...user, ...GRADIENTS].map((g) => <button key={g.id} title={g.name} className="swatch" style={{ width: 46, height: 22, background: css(g.stops) }} onClick={() => { onChange(g.stops.map((s) => ({ ...s }))); setSel(0); }} />)}
          </div>
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => prefs.set({ userGradients: [...user, { id: 'g' + Date.now(), name: 'My gradient', stops }] })}><Icon name="plus" size={13} />Save as preset</button>
        </div>
      )}
    </div>
  );
}
