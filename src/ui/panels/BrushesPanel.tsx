// Brush library + brush settings editor.

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import { BrushSettings, BrushStroke, registerImageTip, GrainKind, TipKind } from '../../brush/engine';
import { BRUSH_CATEGORIES, BRUSH_PRESETS } from '../../brush/presets';
import { RasterSurface } from '../../core/raster';
import { BLEND_MODES } from '../../core/model';
import { Slider, Seg, Field } from '../common';
import { prefs } from '../../app/store';
import { Icon } from '../icons';
import { pickFiles } from '../../app/actions';
import { blobToImage, createCanvas, ctx2d, uid } from '../../core/util';
import { toast } from '../../app/bus';

const previewCache = new Map<string, HTMLCanvasElement>();
export function brushPreview(b: BrushSettings, w = 150, h = 34): HTMLCanvasElement {
  const key = JSON.stringify([b.id, b.size, b.hardness, b.opacity, b.flow, b.tip, b.grain, b.angle, b.roundness, b.spacing, w, h]);
  const hit = previewCache.get(key);
  if (hit) return hit;
  const out = createCanvas(w, h);
  try {
    const s = new RasterSurface(w, h);
    s.canvas;
    const direct = ['smudge', 'blur', 'sharpen', 'dodge', 'burn', 'clone'].includes(b.mode);
    if (b.mode === 'erase' || direct) { const g = s.ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#6f86a0'); g.addColorStop(1, '#a8e0d5'); s.ctx.fillStyle = g; s.ctx.fillRect(6, h * 0.2, w - 12, h * 0.6); }
    if (b.mode !== 'clone') {
      const size = Math.max(1.5, Math.min(b.size, h * 0.8));
      const stroke = new BrushStroke({ settings: { ...b, size, smoothing: 0, pressureSize: Math.max(b.pressureSize, 0.2), opacity: Math.min(1, b.opacity + 0.05) }, color: '#cfe3f2', surface: s, selectionMask: null, alphaLock: false, symmetry: [], seed: 7 });
      const pts = 36;
      for (let i = 0; i <= pts; i++) {
        const t = i / pts, p = { x: 10 + t * (w - 20), y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.22, pressure: 0.25 + 0.75 * Math.sin(t * Math.PI), tiltX: 0, tiltY: 0, time: i * 8 };
        i === 0 ? stroke.begin(p) : stroke.move(p);
      }
      stroke.end();
      stroke.commit();
    }
    ctx2d(out).drawImage(s.canvas, 0, 0);
  } catch (e) { /* preview is cosmetic */ }
  if (previewCache.size > 200) previewCache.clear();
  previewCache.set(key, out);
  return out;
}

function Preview({ b, h = 34 }: { b: BrushSettings; h?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current; if (!c) return; const p = brushPreview(b, 150, h); c.width = p.width; c.height = p.height; const x = c.getContext('2d')!; x.clearRect(0, 0, c.width, c.height); x.drawImage(p, 0, 0); }, [b, h]);
  return <canvas ref={ref} />;
}

export function BrushPresetList({ ed, onPick }: { ed: Editor; onPick?: () => void }) {
  const cur = useEditor(ed, ['brush'], () => ed.brush.id);
  const user = prefs.useSelect((p) => p.userBrushes) as BrushSettings[];
  const [cat, setCat] = useState<string>('All');
  const cats = ['All', ...BRUSH_CATEGORIES, ...(user.length ? ['My brushes'] : [])];
  const list = [...BRUSH_PRESETS, ...user].filter((b) => cat === 'All' || (cat === 'My brushes' ? user.includes(b) : b.category === cat));
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 4 }}>
        {cats.map((c) => <button key={c} className={`btn sm ${cat === c ? 'on' : 'ghost'}`} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <div className="brush-grid" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {list.map((b) => (
          <button key={b.id} className={`brush-card ${cur === b.id ? 'on' : ''}`} onClick={() => { ed.setBrushPreset(b.id); onPick?.(); }} title={b.category}>
            <Preview b={b} />
            <div className="n">{b.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function BrushEditor({ ed }: { ed: Editor }) {
  const b = useEditor(ed, ['brush'], () => ed.brush);
  const set = (p: Partial<BrushSettings>) => ed.setBrush(p);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const importTip = async () => {
    const [f] = await pickFiles('image/*');
    if (!f) return;
    const img = await blobToImage(f);
    const reader = new FileReader();
    reader.onload = () => { const id = uid('tip'); registerImageTip(id, img); set({ tip: 'image', tipImage: id }); toast('Brush tip imported (it lasts for this session — save the brush to keep the shape)'); };
    reader.readAsDataURL(f);
  };
  const saveAs = () => {
    const name = window.prompt('Name for the new brush', `${b.name} copy`);
    if (!name) return;
    const nb = { ...b, id: uid('ub'), name, category: 'My brushes' };
    prefs.set({ userBrushes: [...prefs.get().userBrushes, nb] });
    ed.setBrushPreset(nb.id);
    toast(`Saved brush “${name}”`, 'success');
  };
  return (
    <div className="col" style={{ gap: 4 }}>
      <Preview b={b} h={46} />
      <Field label="Tip"><select className="select grow" value={b.tip} onChange={(e) => set({ tip: e.target.value as TipKind })}>{['round', 'square', 'bristle', 'chalk', 'spray', 'star', 'leaf', 'image'].map((t) => <option key={t} value={t}>{t}</option>)}</select><button className="btn sm" onClick={importTip}>Import…</button></Field>
      <Slider label="Size" value={b.size} min={1} max={600} onChange={(v) => set({ size: v })} format={(v) => `${Math.round(v)}px`} />
      <Slider label="Opacity" value={b.opacity} min={0.02} max={1} step={0.01} onChange={(v) => set({ opacity: v })} format={pct} />
      <Slider label="Flow" value={b.flow} min={0.02} max={1} step={0.01} onChange={(v) => set({ flow: v })} format={pct} />
      <Slider label="Hardness" value={b.hardness} min={0} max={1} step={0.01} onChange={(v) => set({ hardness: v })} format={pct} />
      <Slider label="Spacing" value={b.spacing} min={0.01} max={2} step={0.01} onChange={(v) => set({ spacing: v })} format={pct} />
      <Slider label="Roundness" value={b.roundness} min={0.05} max={1} step={0.01} onChange={(v) => set({ roundness: v })} format={pct} />
      <Slider label="Angle" value={b.angle} min={-180} max={180} onChange={(v) => set({ angle: v })} format={(v) => `${v}°`} />
      <label className="check"><input type="checkbox" checked={b.followStroke} onChange={(e) => set({ followStroke: e.target.checked })} />Rotate with stroke direction</label>
      <div className="divider" />
      <Slider label="Scatter" value={b.scatter} min={0} max={4} step={0.05} onChange={(v) => set({ scatter: v })} />
      <Slider label="Count" value={b.count} min={1} max={40} onChange={(v) => set({ count: v })} />
      <Slider label="Size jitter" value={b.jitterSize} min={0} max={1} step={0.01} onChange={(v) => set({ jitterSize: v })} format={pct} />
      <Slider label="Opacity jit." value={b.jitterOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ jitterOpacity: v })} format={pct} />
      <Slider label="Angle jitter" value={b.jitterAngle} min={0} max={180} onChange={(v) => set({ jitterAngle: v })} format={(v) => `${v}°`} />
      <div className="divider" />
      <Slider label="Pressure→size" value={b.pressureSize} min={0} max={1} step={0.01} onChange={(v) => set({ pressureSize: v })} format={pct} />
      <Slider label="Min size" value={b.minSize} min={0} max={1} step={0.01} onChange={(v) => set({ minSize: v })} format={pct} />
      <Slider label="Pressure→opac." value={b.pressureOpacity} min={0} max={1} step={0.01} onChange={(v) => set({ pressureOpacity: v })} format={pct} />
      <Slider label="Stabiliser" value={b.smoothing} min={0} max={1} step={0.01} onChange={(v) => set({ smoothing: v })} format={pct} />
      <Slider label="Wet mixing" value={b.wet} min={0} max={1} step={0.01} onChange={(v) => set({ wet: v })} format={pct} />
      <div className="divider" />
      <Field label="Grain"><select className="select grow" value={b.grain} onChange={(e) => set({ grain: e.target.value as GrainKind })}>{['none', 'paper', 'canvas', 'rough', 'noise'].map((g) => <option key={g} value={g}>{g}</option>)}</select></Field>
      <Slider label="Grain depth" value={b.grainDepth} min={0} max={1} step={0.01} onChange={(v) => set({ grainDepth: v })} format={pct} />
      <Slider label="Grain scale" value={b.grainScale} min={0.25} max={4} step={0.05} onChange={(v) => set({ grainScale: v })} />
      <Field label="Blend"><select className="select grow" value={b.blend} onChange={(e) => set({ blend: e.target.value as any })}>{BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm" onClick={() => ed.setBrushPreset(b.id)}><Icon name="undo" size={13} />Reset</button>
        <button className="btn sm primary" onClick={saveAs}><Icon name="save" size={13} />Save as new brush</button>
      </div>
    </div>
  );
}

export function BrushesPanel({ ed }: { ed: Editor }) {
  const [tab, setTab] = useState<'library' | 'settings'>('library');
  return (
    <div className="col">
      <Seg value={tab} onChange={setTab} options={[{ value: 'library', label: 'Library' }, { value: 'settings', label: 'Settings' }]} />
      {tab === 'library' ? <BrushPresetList ed={ed} /> : <BrushEditor ed={ed} />}
    </div>
  );
}
