// Colour panel: picker, harmony, palettes.

import { useState } from 'react';
import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import { ColorPicker } from '../ColorPicker';
import { Seg } from '../common';
import { Harmony, harmony, parseColor, rgbaToHex } from '../../core/color';
import { PALETTES } from '../../assets/libraries';
import { prefs } from '../../app/store';
import { Icon } from '../icons';
import { toast } from '../../app/bus';

export function ColorPanel({ ed }: { ed: Editor }) {
  const { fg, bg } = useEditor(ed, ['colors'], () => ({ fg: ed.fg, bg: ed.bg }));
  const [target, setTarget] = useState<'fg' | 'bg'>('fg');
  const [tab, setTab] = useState<'picker' | 'harmony' | 'palettes'>('picker');
  const cur = target === 'fg' ? fg : bg;
  const setCur = (c: string) => (target === 'fg' ? ed.setFg(c) : ed.setBg(c));
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Seg value={target} onChange={setTarget} options={[{ value: 'fg', label: 'Foreground' }, { value: 'bg', label: 'Background' }]} />
        <button className="btn ghost icon sm" title="Swap (X)" onClick={() => ed.swapColors()}><Icon name="swap" size={14} /></button>
      </div>
      <Seg value={tab} onChange={setTab} options={[{ value: 'picker', label: 'Picker' }, { value: 'harmony', label: 'Harmony' }, { value: 'palettes', label: 'Palettes' }]} />
      {tab === 'picker' && <ColorPicker color={cur} onChange={setCur} />}
      {tab === 'harmony' && <HarmonyView color={cur} onPick={setCur} />}
      {tab === 'palettes' && <Palettes onPick={(c) => { setCur(c); ed.pushRecentColor(c); }} current={cur} />}
    </div>
  );
}

function HarmonyView({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [kind, setKind] = useState<Harmony>('analogous');
  const cols = harmony(parseColor(color), kind).map((c) => rgbaToHex(c));
  return (
    <div className="col">
      <select className="select" value={kind} onChange={(e) => setKind(e.target.value as Harmony)}>
        {['complementary', 'analogous', 'triadic', 'tetradic', 'split', 'monochromatic'].map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
      </select>
      <div className="row" style={{ gap: 6 }}>{cols.map((c, i) => <button key={c + i} className="swatch" style={{ width: 40, height: 40, background: c }} title={c} onClick={() => onPick(c)} />)}</div>
      <div className="hint">Click a colour to use it. The harmony is built around the current colour.</div>
    </div>
  );
}

function Palettes({ onPick, current }: { onPick: (c: string) => void; current: string }) {
  const custom = prefs.useSelect((p) => p.swatches);
  const all = [...custom, ...PALETTES];
  return (
    <div className="col" style={{ gap: 10 }}>
      {all.map((p) => (
        <div key={p.id}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <span className="hint">{p.name}</span>
            {custom.some((c) => c.id === p.id) && <button className="btn ghost icon sm" title="Delete palette" onClick={() => prefs.set({ swatches: custom.filter((c) => c.id !== p.id) })}><Icon name="trash" size={12} /></button>}
          </div>
          <div className="swatch-grid">{p.colors.map((c, i) => <button key={c + i} className="swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />)}</div>
        </div>
      ))}
      <button className="btn sm" onClick={() => { const n = prefs.get().swatches; const id = 'u' + Date.now(); prefs.set({ swatches: [...n, { id, name: `My palette ${n.length + 1}`, colors: [current] }] }); toast('New palette created with the current colour'); }}>
        <Icon name="plus" size={13} />New palette from current colour
      </button>
      {custom.length > 0 && <button className="btn sm" onClick={() => { const last = custom[custom.length - 1]; prefs.set({ swatches: custom.map((p) => (p.id === last.id ? { ...p, colors: [...p.colors, current] } : p)) }); }}>Add current colour to “{custom[custom.length - 1].name}”</button>}
    </div>
  );
}
