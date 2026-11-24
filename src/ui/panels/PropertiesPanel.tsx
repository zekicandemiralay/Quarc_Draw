// Properties of the selected vector objects (fill, stroke, text, geometry) + quick object actions.

import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import type { Paint, VObject, VText, StrokeStyle } from '../../core/model';
import { BLEND_MODES, solid } from '../../core/model';
import { objectsBounds, objectBounds } from '../../core/vector';
import { mMul, mScale, mTranslate, mRotate, rad } from '../../core/geometry';
import * as O from '../../editor/objectOps';
import { ColorButton } from '../ColorPicker';
import { GradientEditor } from '../GradientEditor';
import { NumInput, Seg, Slider, Field, PopButton } from '../common';
import { Icon } from '../icons';
import { PATTERNS } from '../../core/patterns';
import { PRESET_FONTS } from '../fonts';
import { runCommand } from '../../app/commands';
import { openDialog } from '../../app/bus';
import { prefs } from '../../app/store';

export function ObjectQuickActions({ ed }: { ed: Editor }) {
  const n = useEditor(ed, ['objsel'], () => ed.objSel.length);
  if (!n) return <span className="hint">Select objects to see alignment and arrange tools</span>;
  const B = ({ cmd, icon, title }: { cmd: string; icon: string; title: string }) => <button className="btn ghost icon sm" title={title} onClick={() => runCommand(cmd)}><Icon name={icon} size={15} /></button>;
  return (
    <>
      <B cmd="object.align.left" icon="align" title="Align left" /><B cmd="object.align.hcenter" icon="align" title="Align centres horizontally" /><B cmd="object.align.top" icon="align" title="Align top" />
      <div className="sep" />
      <B cmd="object.front" icon="chevron-up" title="Bring to front" /><B cmd="object.back" icon="chevron-down" title="Send to back" />
      <B cmd="object.group" icon="group" title="Group (Ctrl+G)" /><B cmd="object.flipH" icon="swap" title="Flip horizontal" />
      <PopButton className="btn ghost sm" title="Shape operations" content={(close) => (
        <div className="col" style={{ padding: 6, gap: 2, minWidth: 190 }}>
          {['object.unite', 'object.subtract', 'object.intersect', 'object.exclude', 'object.topath', 'object.dist.h', 'object.dist.v'].map((c) => <button key={c} className="menu-item" onClick={() => { close(); runCommand(c); }}>{c.replace('object.', '').replace('.', ' ')}</button>)}
        </div>
      )}>Shape ▾</PopButton>
      <button className="btn ghost icon sm" title="Delete" onClick={() => O.deleteObjects(ed)}><Icon name="trash" size={15} /></button>
      <span className="hint">{n} selected</span>
    </>
  );
}

const PaintEditor = ({ label, paint, onChange, allowGradient = true }: { label: string; paint: Paint | null; onChange: (p: Paint | null) => void; allowGradient?: boolean }) => {
  const kind = paint?.kind ?? 'none';
  const defStops = [{ pos: 0, color: '#1fc8ac' }, { pos: 1, color: '#2c3e9b' }];
  return (
    <div className="col" style={{ gap: 6 }}>
      <Field label={label}>
        <select className="select" value={kind} onChange={(e) => {
          const k = e.target.value;
          if (k === 'none') onChange(null);
          else if (k === 'solid') onChange(solid(paint?.kind === 'solid' ? paint.color : '#1fc8ac'));
          else if (k === 'linear') onChange({ kind: 'linear', stops: paint && 'stops' in paint ? paint.stops : defStops, x1: 0, y1: 0, x2: 1, y2: 1 });
          else if (k === 'radial') onChange({ kind: 'radial', stops: paint && 'stops' in paint ? paint.stops : defStops, cx: 0.5, cy: 0.5, r: 0.7 });
          else onChange({ kind: 'pattern', pattern: 'hatch', scale: 1, color: '#000000' });
        }}>
          <option value="none">None</option><option value="solid">Solid</option>{allowGradient && <><option value="linear">Linear gradient</option><option value="radial">Radial gradient</option></>}<option value="pattern">Pattern</option>
        </select>
        {paint?.kind === 'solid' && <ColorButton color={paint.color} onChange={(c) => onChange(solid(c))} />}
        {paint?.kind === 'pattern' && <ColorButton color={paint.color ?? '#000'} onChange={(c) => onChange({ ...paint, color: c })} />}
      </Field>
      {(paint?.kind === 'linear' || paint?.kind === 'radial') && <GradientEditor stops={paint.stops} onChange={(stops) => onChange({ ...paint, stops })} presets={false} />}
      {paint?.kind === 'linear' && <Slider label="Angle" value={Math.round((Math.atan2(paint.y2 - paint.y1, paint.x2 - paint.x1) * 180) / Math.PI)} min={-180} max={180} format={(v) => `${v}°`} onChange={(v) => { const a = rad(v); onChange({ ...paint, x1: 0.5 - Math.cos(a) / 2, y1: 0.5 - Math.sin(a) / 2, x2: 0.5 + Math.cos(a) / 2, y2: 0.5 + Math.sin(a) / 2 }); }} />}
      {paint?.kind === 'pattern' && (<>
        <Field label="Pattern"><select className="select grow" value={paint.pattern} onChange={(e) => onChange({ ...paint, pattern: e.target.value })}>{PATTERNS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>
        <Slider label="Scale" value={paint.scale} min={0.25} max={6} step={0.05} onChange={(v) => onChange({ ...paint, scale: v })} />
      </>)}
    </div>
  );
};

export function PropertiesPanel({ ed }: { ed: Editor }) {
  useEditor(ed, ['objsel', 'doc'], () => ed.versions.doc + ed.versions.objsel);
  const objs = ed.selectedObjects();
  const upd = (fn: (o: VObject) => VObject, label = 'Properties') => O.updateSelected(ed, fn, label, `prop:${label}`);
  if (!objs.length) {
    const pg = ed.page;
    return (
      <div className="col">
        <div className="hint">Select an object with the Move tool to edit its fill, stroke, text and geometry.</div>
        <dl className="kv">
          <dt>Page</dt><dd>{pg.name}</dd><dt>Size</dt><dd>{pg.width} × {pg.height} px</dd><dt>Resolution</dt><dd>{ed.doc.dpi} dpi</dd>
          <dt>Layers</dt><dd>{ed.countLayers()}</dd>
        </dl>
        <button className="btn sm" onClick={() => openDialog('page-setup')}>Page background & template…</button>
      </div>
    );
  }
  const o = objs[0], single = objs.length === 1;
  const b = objectsBounds(objs)!;
  const hasFill = objs.some((x) => x.type !== 'line' && x.type !== 'ink' && x.type !== 'image' && x.type !== 'markup' && x.type !== 'note');
  const geometry = (nb: { x: number; y: number; w: number; h: number }) => {
    const sx = b.w > 0 ? nb.w / b.w : 1, sy = b.h > 0 ? nb.h / b.h : 1;
    const m = mMul(mTranslate(nb.x, nb.y), mMul(mScale(sx, sy), mTranslate(-b.x, -b.y)));
    O.transformObjects(ed, ed.objSel, m, 'Resize');
  };
  const rotateBy = (deg: number) => { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; O.transformObjects(ed, ed.objSel, mMul(mTranslate(cx, cy), mMul(mRotate(rad(deg)), mTranslate(-cx, -cy))), 'Rotate'); };
  void objectBounds;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row"><span className="badge">{single ? o.type : `${objs.length} objects`}</span><span className="spacer" />
        <button className="btn ghost icon sm" title={o.locked ? 'Unlock' : 'Lock'} onClick={() => runCommand('object.lock')}><Icon name={o.locked ? 'lock' : 'unlock'} size={14} /></button>
        <button className="btn ghost icon sm" title="Hide" onClick={() => runCommand('object.hide')}><Icon name="eye-off" size={14} /></button></div>
      <div className="grid2">
        <Field label="X"><NumInput value={b.x} onChange={(v) => geometry({ ...b, x: v })} width={70} decimals={1} /></Field>
        <Field label="Y"><NumInput value={b.y} onChange={(v) => geometry({ ...b, y: v })} width={70} decimals={1} /></Field>
        <Field label="W"><NumInput value={b.w} onChange={(v) => geometry({ ...b, w: Math.max(0.1, v) })} width={70} decimals={1} /></Field>
        <Field label="H"><NumInput value={b.h} onChange={(v) => geometry({ ...b, h: Math.max(0.1, v) })} width={70} decimals={1} /></Field>
      </div>
      <div className="row"><span className="hint">Rotate by</span><NumInput value={0} onChange={rotateBy} width={60} suffix="°" /><button className="btn sm" onClick={() => rotateBy(90)}>90°</button><button className="btn sm" onClick={() => runCommand('object.flipH')}>Flip H</button><button className="btn sm" onClick={() => runCommand('object.flipV')}>Flip V</button></div>
      <div className="divider" />
      {hasFill && <PaintEditor label="Fill" paint={o.fill} onChange={(p) => upd((x) => ({ ...x, fill: p }), 'Fill')} />}
      {(o.type === 'ink' || o.type === 'markup' || o.type === 'note') && o.type === 'ink' && <Field label="Colour"><ColorButton color={o.fill?.kind === 'solid' ? o.fill.color : '#000'} onChange={(c) => upd((x) => ({ ...x, fill: solid(c) }), 'Colour')} /></Field>}
      {o.type !== 'ink' && o.type !== 'markup' && o.type !== 'note' && (
        <div className="col" style={{ gap: 6 }}>
          <Field label="Stroke">
            <ColorButton color={o.stroke?.color ?? '#00000000'} onChange={(c) => upd((x) => ({ ...x, stroke: { ...(x.stroke ?? { width: 2, cap: 'round', join: 'round', dash: [] }), color: c } }), 'Stroke')} />
            <button className="btn ghost icon sm" title="No stroke" onClick={() => upd((x) => ({ ...x, stroke: null }), 'Stroke')}><Icon name="close" size={12} /></button>
          </Field>
          {o.stroke && (<>
            <Slider label="Width" value={o.stroke.width} min={0.5} max={80} step={0.5} format={(v) => `${v}px`} onChange={(v) => upd((x) => ({ ...x, stroke: { ...x.stroke!, width: v } }), 'Stroke width')} />
            <Field label="Ends"><Seg<StrokeStyle['cap']> value={o.stroke.cap} onChange={(v) => upd((x) => ({ ...x, stroke: { ...x.stroke!, cap: v } }), 'Cap')} options={[{ value: 'butt', label: 'Butt' }, { value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} /></Field>
            <Field label="Joins"><Seg<StrokeStyle['join']> value={o.stroke.join} onChange={(v) => upd((x) => ({ ...x, stroke: { ...x.stroke!, join: v } }), 'Join')} options={[{ value: 'miter', label: 'Miter' }, { value: 'round', label: 'Round' }, { value: 'bevel', label: 'Bevel' }]} /></Field>
            <Field label="Dash"><select className="select grow" value={o.stroke.dash.length ? (o.stroke.dash[0] <= o.stroke.width ? 'dot' : 'dash') : 'solid'} onChange={(e) => upd((x) => ({ ...x, stroke: { ...x.stroke!, dash: e.target.value === 'solid' ? [] : e.target.value === 'dot' ? [0.1, x.stroke!.width * 2] : [x.stroke!.width * 4, x.stroke!.width * 2.5] } }), 'Dash')}><option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option></select></Field>
          </>)}
        </div>
      )}
      <div className="divider" />
      <Slider label="Opacity" value={Math.round(o.opacity * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => upd((x) => ({ ...x, opacity: v / 100 }), 'Opacity')} />
      <Field label="Blend"><select className="select grow" value={o.blend ?? 'normal'} onChange={(e) => upd((x) => ({ ...x, blend: e.target.value as any }), 'Blend')}>{BLEND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
      <Field label="Shadow"><button className={`btn sm ${o.shadow ? 'on' : ''}`} onClick={() => upd((x) => ({ ...x, shadow: x.shadow ? undefined : { color: '#00000066', blur: 10, x: 4, y: 6 } }), 'Shadow')}>{o.shadow ? 'On' : 'Off'}</button>
        {o.shadow && <><ColorButton color={o.shadow.color} onChange={(c) => upd((x) => ({ ...x, shadow: { ...x.shadow!, color: c } }), 'Shadow')} /><NumInput value={o.shadow.blur} width={46} onChange={(v) => upd((x) => ({ ...x, shadow: { ...x.shadow!, blur: v } }), 'Shadow')} /></>}</Field>
      {single && o.type === 'rect' && <Slider label="Corner radius" value={o.rx} min={0} max={Math.min(o.w, o.h) / 2} onChange={(v) => upd((x) => (x.type === 'rect' ? { ...x, rx: v } : x), 'Corner radius')} />}
      {single && o.type === 'polygon' && (<><Slider label="Sides" value={o.sides} min={3} max={24} onChange={(v) => upd((x) => (x.type === 'polygon' ? { ...x, sides: v } : x), 'Sides')} /><Slider label="Star depth" value={o.inner} min={0} max={0.95} step={0.01} onChange={(v) => upd((x) => (x.type === 'polygon' ? { ...x, inner: v } : x), 'Star')} /></>)}
      {single && o.type === 'line' && <Field label="Arrows"><button className={`btn sm ${o.arrowStart ? 'on' : ''}`} onClick={() => upd((x) => (x.type === 'line' ? { ...x, arrowStart: !x.arrowStart } : x), 'Arrow')}>Start</button><button className={`btn sm ${o.arrowEnd ? 'on' : ''}`} onClick={() => upd((x) => (x.type === 'line' ? { ...x, arrowEnd: !x.arrowEnd } : x), 'Arrow')}>End</button></Field>}
      {single && o.type === 'ink' && <Slider label="Pen size" value={o.size} min={0.5} max={120} step={0.5} onChange={(v) => upd((x) => (x.type === 'ink' ? { ...x, size: v } : x), 'Pen size')} />}
      {single && o.type === 'text' && <TextProps ed={ed} o={o} upd={upd} />}
      {single && o.type === 'note' && (<><Field label="Colour">{['#ffe066', '#ffb3c1', '#b8f2e6', '#c7d2fe', '#ffd6a5'].map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => upd((x) => (x.type === 'note' ? { ...x, color: c } : x), 'Note colour')} />)}</Field>
        <button className="btn sm" onClick={() => openDialog('note', { objId: o.id, editorId: ed.id })}>Edit note text…</button></>)}
      {single && o.type === 'markup' && (<><Field label="Colour">{['#ffe14d', '#7df0a3', '#7fd4ff', '#ffa6c9', '#ffb86b'].map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => upd((x) => (x.type === 'markup' ? { ...x, color: c } : x), 'Markup colour')} />)}</Field>
        <div className="hint">“{o.quote.slice(0, 120)}”</div>
        <textarea className="input" rows={3} placeholder="Add a comment…" value={o.comment} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => upd((x) => (x.type === 'markup' ? { ...x, comment: e.target.value } : x), 'Comment')} /></>)}
      <Field label="Link"><input className="input grow" placeholder="https://… or page number" value={o.link?.url ?? (o.link?.page !== undefined ? String(o.link.page + 1) : '')} onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => { const v = e.target.value.trim(); upd((x) => ({ ...x, link: !v ? undefined : /^\d+$/.test(v) ? { page: parseInt(v) - 1 } : { url: v } }), 'Link'); }} /></Field>
    </div>
  );
}

function TextProps({ o, upd }: { ed: Editor; o: VText; upd: (fn: (o: VObject) => VObject, label?: string) => void }) {
  const userFonts = prefs.useSelect((p) => p.fonts);
  const fonts = [...userFonts, ...PRESET_FONTS];
  const f = (patch: Partial<VText['font']>) => upd((x) => (x.type === 'text' ? { ...x, font: { ...x.font, ...patch } } : x), 'Font');
  const t = (patch: Partial<VText>) => upd((x) => (x.type === 'text' ? { ...x, ...patch } : x), 'Text');
  return (
    <div className="col" style={{ gap: 6 }}>
      <textarea className="input" rows={3} value={o.text} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => t({ text: e.target.value })} />
      <Field label="Font"><select className="select grow" value={o.font.family} onChange={(e) => f({ family: e.target.value })}>{!fonts.includes(o.font.family) && <option>{o.font.family}</option>}{fonts.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
      <Field label="Size"><NumInput value={o.font.size} width={60} onChange={(v) => f({ size: v })} decimals={0} />
        <button className={`btn sm icon ${o.font.weight >= 700 ? 'on' : ''}`} onClick={() => f({ weight: o.font.weight >= 700 ? 400 : 700 })} style={{ fontWeight: 800 }}>B</button>
        <button className={`btn sm icon ${o.font.italic ? 'on' : ''}`} onClick={() => f({ italic: !o.font.italic })} style={{ fontStyle: 'italic' }}>I</button></Field>
      <Field label="Align"><Seg value={o.align} onChange={(v) => t({ align: v })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /></Field>
      <Slider label="Leading" value={o.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => t({ lineHeight: v })} />
      <Slider label="Tracking" value={o.letterSpacing} min={-5} max={40} step={0.5} onChange={(v) => t({ letterSpacing: v })} />
      <Field label="Box width"><NumInput value={o.boxW ?? 0} width={70} onChange={(v) => t({ boxW: v > 10 ? v : null })} suffix="0 = auto" /></Field>
    </div>
  );
}
