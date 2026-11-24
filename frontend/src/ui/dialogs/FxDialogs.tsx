// Filter / adjustment dialogs (live preview), curves editor, layer effects, gradient editor.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Slider, Switch, Field } from '../common';
import { Icon } from '../icons';
import { ColorButton } from '../ColorPicker';
import { GradientEditor } from '../GradientEditor';
import type { Editor } from '../../editor/editor';
import { getFilter, defaultsFor, ParamValue, FilterDef } from '../../filters/registry';
import { makeFilterPreview, makeAdjustmentPreview, applyFilter, applyAdjustmentDestructive } from '../../editor/rasterOps';
import { Adjustment, ADJUSTMENT_LABELS, defaultAdjustment, EFFECT_LABELS, EffectKind, defaultEffect, LayerEffect, BLEND_MODES, findLayer } from '../../core/model';
import * as L from '../../editor/layerOps';
import { curveLUT } from '../../filters/pixels';
import { ctx2d } from '../../core/util';

// ---------------------------------------------------------------- Filter
export function FilterDialog({ ed, id, onClose }: { ed: Editor; id: string; onClose: () => void }) {
  const f = getFilter(id) as FilterDef;
  const [vals, setVals] = useState<Record<string, ParamValue>>(() => defaultsFor(f));
  const [preview, setPreview] = useState(true);
  const prev = useRef<ReturnType<typeof makeFilterPreview> | null>(null);
  const valsRef = useRef(vals); valsRef.current = vals;
  useEffect(() => {
    if (!ed.layer || ed.layer.type !== 'raster') { onClose(); return; }
    prev.current = makeFilterPreview(ed, f, () => valsRef.current);
    return () => prev.current?.close();
  }, []);
  useEffect(() => { const t = setTimeout(() => { if (preview) prev.current?.update(); else prev.current?.close(); }, 60); return () => clearTimeout(t); }, [vals, preview]);
  const ok = () => { prev.current?.close(); applyFilter(ed, f, vals); onClose(); };
  const cancel = () => { prev.current?.close(); onClose(); };
  return (
    <Dialog title={f.label.replace('…', '')} icon="sliders" onClose={cancel} footer={<>
      <label className="check" style={{ marginRight: 'auto' }}><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />Preview</label>
      <button className="btn" onClick={() => setVals(defaultsFor(f))}>Reset</button><button className="btn" onClick={cancel}>Cancel</button><button className="btn primary" onClick={ok}>Apply</button></>}>
      <div className="col" style={{ gap: 10 }}>
        {ed.hasSelection && <div className="hint">The filter only affects the current selection.</div>}
        {f.params.map((p) => p.type === 'range' ? (
          <Slider key={p.key} label={p.label} value={vals[p.key] as number} min={p.min!} max={p.max!} step={p.step} onChange={(v) => setVals((s) => ({ ...s, [p.key]: v }))} width={300} />
        ) : p.type === 'bool' ? <Switch key={p.key} on={!!vals[p.key]} onChange={(v) => setVals((s) => ({ ...s, [p.key]: v }))} label={p.label} /> : null)}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Curves
export function CurveEditor({ points, onChange, hist }: { points: [number, number][]; onChange: (p: [number, number][]) => void; hist?: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const S = 256;
  useEffect(() => {
    const c = ref.current!, x = c.getContext('2d')!;
    const cs = getComputedStyle(c);
    x.clearRect(0, 0, c.width, c.height);
    x.strokeStyle = cs.getPropertyValue('--line-hi'); x.lineWidth = 1;
    for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo((i * S) / 4, 0); x.lineTo((i * S) / 4, S); x.moveTo(0, (i * S) / 4); x.lineTo(S, (i * S) / 4); x.stroke(); }
    if (hist) { const mx = Math.max(...hist, 1); x.fillStyle = 'rgba(160,170,185,0.28)'; hist.forEach((v, i) => x.fillRect(i, S - (v / mx) * S * 0.9, 1, (v / mx) * S * 0.9)); }
    x.strokeStyle = 'rgba(160,170,185,0.5)'; x.beginPath(); x.moveTo(0, S); x.lineTo(S, 0); x.stroke();
    const lut = curveLUT(points);
    x.strokeStyle = cs.getPropertyValue('--accent'); x.lineWidth = 2; x.beginPath();
    for (let i = 0; i < 256; i++) { const yy = S - lut[i]; i ? x.lineTo(i, yy) : x.moveTo(i, yy); }
    x.stroke();
    points.forEach(([px, py]) => { x.fillStyle = '#fff'; x.strokeStyle = cs.getPropertyValue('--accent'); x.lineWidth = 2; x.beginPath(); x.arc(px, S - py, 5, 0, Math.PI * 2); x.fill(); x.stroke(); });
  }, [points, hist]);
  const pos = (e: React.PointerEvent): [number, number] => { const r = ref.current!.getBoundingClientRect(); return [Math.round(Math.min(255, Math.max(0, ((e.clientX - r.left) / r.width) * 255))), Math.round(Math.min(255, Math.max(0, 255 - ((e.clientY - r.top) / r.height) * 255)))]; };
  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pos(e);
    let idx = points.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 10);
    let pts = points;
    if (idx < 0) { pts = [...points, p].sort((a, b) => a[0] - b[0]); idx = pts.findIndex((q) => q === p); onChange(pts); }
    setDrag(idx);
  };
  const move = (e: React.PointerEvent) => {
    if (drag === null) return;
    const p = pos(e);
    const pts = points.map((q, i) => (i === drag ? ([i === 0 ? 0 : i === points.length - 1 ? 255 : Math.min(points[i + 1][0] - 1, Math.max(points[i - 1][0] + 1, p[0])), p[1]] as [number, number]) : q));
    // endpoints keep x fixed
    onChange(pts);
  };
  return <canvas ref={ref} className="curve-box" width={S} height={S} onPointerDown={down} onPointerMove={move} onPointerUp={() => setDrag(null)}
    onDoubleClick={(e) => { const r = ref.current!.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * 255, y = 255 - ((e.clientY - r.top) / r.height) * 255; const i = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 10); if (i > 0 && i < points.length - 1) onChange(points.filter((_, k) => k !== i)); }} />;
}

// ---------------------------------------------------------------- Adjustment (destructive or as layer)
function useHistogram(ed: Editor): number[] | undefined {
  return useMemo(() => {
    const l = ed.layer;
    if (!l || l.type !== 'raster') return undefined;
    const c = l.surface.peek(); if (!c) return undefined;
    const k = Math.min(1, 256 / Math.max(c.width, c.height));
    const t = document.createElement('canvas'); t.width = Math.max(1, Math.round(c.width * k)); t.height = Math.max(1, Math.round(c.height * k));
    const x = ctx2d(t, true); x.drawImage(c, 0, 0, t.width, t.height);
    const d = x.getImageData(0, 0, t.width, t.height).data, h = new Array(256).fill(0);
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) h[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    return h;
  }, [ed.layer?.id]);
}

export function AdjustDialog({ ed, kind, layerId, onClose }: { ed: Editor; kind: Adjustment['kind']; layerId?: string; onClose: () => void }) {
  const existing = layerId ? findLayer(ed.page.layers, layerId)?.layer : null;
  const [adj, setAdj] = useState<Adjustment>(() => (existing && existing.type === 'adjustment' ? existing.adj : defaultAdjustment(kind)));
  const [preview, setPreview] = useState(true);
  const adjRef = useRef(adj); adjRef.current = adj;
  const prev = useRef<ReturnType<typeof makeAdjustmentPreview> | null>(null);
  const hist = useHistogram(ed);
  const editingLayer = !!layerId;
  useEffect(() => {
    if (editingLayer) return;
    if (!ed.layer || ed.layer.type !== 'raster') { onClose(); return; }
    prev.current = makeAdjustmentPreview(ed, () => adjRef.current);
    return () => prev.current?.close();
  }, []);
  useEffect(() => {
    if (editingLayer) { L.setAdjustment(ed, layerId!, adj); return; }
    const t = setTimeout(() => { if (preview) prev.current?.update(); else prev.current?.close(); }, 50); return () => clearTimeout(t);
  }, [adj, preview]);
  const set = (p: any) => setAdj((a) => ({ ...a, ...p }) as Adjustment);
  const a: any = adj;
  const S = (key: string, label: string, min: number, max: number, step = 1) => <Slider key={key} label={label} value={a[key]} min={min} max={max} step={step} onChange={(v) => set({ [key]: v })} width={320} />;
  const close = () => { prev.current?.close(); onClose(); };
  return (
    <Dialog title={ADJUSTMENT_LABELS[adj.kind]} icon="sliders" onClose={close} footer={editingLayer ? <button className="btn primary" onClick={close}>Done</button> : <>
      <label className="check" style={{ marginRight: 'auto' }}><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />Preview</label>
      <button className="btn" onClick={() => setAdj(defaultAdjustment(adj.kind))}>Reset</button><button className="btn" onClick={close}>Cancel</button>
      <button className="btn" onClick={() => { prev.current?.close(); L.addAdjustmentLayer(ed, adj); onClose(); }} title="Non-destructive: edit it any time from the Layers panel"><Icon name="layers" size={14} />As layer</button>
      <button className="btn primary" onClick={() => { prev.current?.close(); applyAdjustmentDestructive(ed, adj, ADJUSTMENT_LABELS[adj.kind]); onClose(); }}>Apply</button></>}>
      <div className="col" style={{ gap: 10 }}>
        {adj.kind === 'brightness-contrast' && <>{S('brightness', 'Brightness', -100, 100)}{S('contrast', 'Contrast', -100, 100)}</>}
        {adj.kind === 'hue-saturation' && <>{S('hue', 'Hue', -180, 180)}{S('saturation', 'Saturation', -100, 100)}{S('lightness', 'Lightness', -100, 100)}</>}
        {adj.kind === 'levels' && <><div style={{ height: 70, display: 'flex', alignItems: 'flex-end', gap: 0, background: 'var(--input)', borderRadius: 6, overflow: 'hidden' }}>{hist ? (() => { const b = 64; const bins = Array.from({ length: b }, (_, i) => hist.slice(i * 4, i * 4 + 4).reduce((s, v) => s + v, 0)); const m = Math.max(...bins, 1); return bins.map((v, i) => <div key={i} style={{ flex: 1, height: `${(v / m) * 100}%`, background: 'var(--text-faint)' }} />); })() : null}</div>
          {S('inBlack', 'Input black', 0, 254)}{S('inWhite', 'Input white', 1, 255)}{S('gamma', 'Gamma', 0.1, 4, 0.01)}{S('outBlack', 'Output black', 0, 254)}{S('outWhite', 'Output white', 1, 255)}</>}
        {adj.kind === 'curves' && <div style={{ width: 300 }}><CurveEditor points={adj.points} onChange={(points) => set({ points })} hist={hist} /><div className="hint">Click to add a point · drag to shape · double-click a point to remove it</div></div>}
        {adj.kind === 'exposure' && <>{S('exposure', 'Exposure', -4, 4, 0.01)}{S('offset', 'Offset', -0.5, 0.5, 0.01)}{S('gamma', 'Gamma', 0.2, 3, 0.01)}</>}
        {adj.kind === 'vibrance' && <>{S('vibrance', 'Vibrance', -100, 100)}{S('saturation', 'Saturation', -100, 100)}</>}
        {adj.kind === 'color-balance' && (['shadows', 'midtones', 'highlights'] as const).map((r) => (
          <div key={r} className="col" style={{ gap: 4 }}><b style={{ textTransform: 'capitalize' }}>{r}</b>
            {['Cyan ↔ Red', 'Magenta ↔ Green', 'Yellow ↔ Blue'].map((lab, i) => <Slider key={lab} label={lab} value={(adj as any)[r][i]} min={-100} max={100} width={320} onChange={(v) => { const arr = [...(adj as any)[r]] as [number, number, number]; arr[i] = v; set({ [r]: arr }); }} />)}</div>
        ))}
        {adj.kind === 'photo-filter' && <><Field label="Colour"><ColorButton color={adj.color} alpha={false} onChange={(c) => set({ color: c })} />{['#ec8a00', '#e02020', '#1b6ef3', '#2ea44f', '#a56bff'].map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => set({ color: c })} />)}</Field>{S('density', 'Density', 0, 100)}</>}
        {adj.kind === 'gradient-map' && <GradientEditor stops={adj.stops} onChange={(stops) => set({ stops })} />}
        {adj.kind === 'threshold' && S('level', 'Level', 1, 255)}
        {adj.kind === 'posterize' && S('levels', 'Levels', 2, 16)}
        {['invert', 'grayscale', 'sepia'].includes(adj.kind) && <div className="hint">This adjustment has no settings.</div>}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Layer effects
export function EffectsDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  useEffect(() => ed.events.on('layers', () => setN((x) => x + 1)), [ed]);
  const [, setN] = useState(0);
  const layer = ed.layer;
  if (!layer) return <Dialog title="Layer effects" onClose={onClose}><div className="hint">Select a layer first.</div></Dialog>;
  const fx = layer.effects;
  const upd = (id: string, patch: any) => L.setEffects(ed, layer.id, fx.map((e) => (e.id === id ? ({ ...e, ...patch } as LayerEffect) : e)));
  return (
    <Dialog title={`Layer effects — ${layer.name}`} icon="fx" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row wrap">{(Object.keys(EFFECT_LABELS) as EffectKind[]).map((k) => <button key={k} className="btn sm" onClick={() => L.setEffects(ed, layer.id, [...fx, defaultEffect(k)])}><Icon name="plus" size={12} />{EFFECT_LABELS[k]}</button>)}</div>
        {!fx.length && <div className="hint">No effects yet. Effects are non-destructive and update live.</div>}
        {fx.map((e) => (
          <div key={e.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 10 }} className="col">
            <div className="row"><Switch on={e.enabled} onChange={(v) => upd(e.id, { enabled: v })} label={EFFECT_LABELS[e.kind]} /><span className="spacer" /><button className="btn ghost icon sm" onClick={() => L.setEffects(ed, layer.id, fx.filter((x) => x.id !== e.id))}><Icon name="trash" size={14} /></button></div>
            {e.kind !== 'color-overlay' && e.kind !== 'stroke' || true ? (
              <div className="grid2" style={{ gap: 6 }}>
                <Field label="Colour"><ColorButton color={e.color} alpha={false} onChange={(c) => upd(e.id, { color: c })} /></Field>
                <Slider label="Opacity" value={Math.round(e.opacity * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => upd(e.id, { opacity: v / 100 })} />
                {(e.kind === 'drop-shadow' || e.kind === 'inner-shadow') && <><Slider label="Offset X" value={e.x} min={-60} max={60} onChange={(v) => upd(e.id, { x: v })} /><Slider label="Offset Y" value={e.y} min={-60} max={60} onChange={(v) => upd(e.id, { y: v })} /></>}
                {(e.kind === 'drop-shadow' || e.kind === 'inner-shadow' || e.kind === 'outer-glow') && <Slider label="Blur" value={e.blur} min={0} max={80} onChange={(v) => upd(e.id, { blur: v })} />}
                {(e.kind === 'drop-shadow' || e.kind === 'outer-glow') && <Slider label="Spread" value={e.spread} min={0} max={40} onChange={(v) => upd(e.id, { spread: v })} />}
                {e.kind === 'stroke' && <><Slider label="Width" value={e.width} min={1} max={60} onChange={(v) => upd(e.id, { width: v })} /><Field label="Position"><select className="select" value={e.position} onChange={(ev) => upd(e.id, { position: ev.target.value })}><option value="outside">Outside</option><option value="center">Centre</option><option value="inside">Inside</option></select></Field></>}
                {e.kind === 'color-overlay' && <Field label="Blend"><select className="select" value={e.blend} onChange={(ev) => upd(e.id, { blend: ev.target.value })}>{BLEND_MODES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></Field>}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- Gradient editor dialog
export function GradientDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const [stops, setStops] = useState(ed.opts.gradientStops);
  return (
    <Dialog title="Gradient editor" icon="gradient" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { ed.setToolOpts({ gradientStops: stops, gradientUseFgBg: false }); onClose(); }}>OK</button></>}>
      <GradientEditor stops={stops} onChange={setStops} />
    </Dialog>
  );
}
