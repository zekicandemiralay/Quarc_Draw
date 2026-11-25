// Context-sensitive options for the active tool.

import { useEffect, useState } from 'react';
import type { Editor } from '../editor/editor';
import { useEditor } from '../editor/editor';
import { toolMeta } from '../tools/catalog';
import { Icon } from './icons';
import { Slider, Seg, Switch, PopButton, NumInput } from './common';
import { ColorButton } from './ColorPicker';
import { BLEND_MODES } from '../core/model';
import type { BlendMode, Paint } from '../core/model';
import { openDialog } from '../app/bus';
import { BRUSH_CATEGORIES } from '../brush/presets';
import type { TextTool } from '../tools/textTool';
import type { TransformTool } from '../tools/moveTools';
import type { CropTool } from '../tools/cropTool';
import { runCommand } from '../app/commands';
import { prefs } from '../app/store';
import { PRESET_FONTS } from './fonts';
import { BrushPresetList } from './panels/BrushesPanel';
import { solid } from '../core/model';
import { ObjectQuickActions } from './panels/PropertiesPanel';

const logSize = (v: number) => Math.round(Math.exp(v));
const toLog = (s: number) => Math.log(Math.max(1, s));

function PaintButton({ paint, onChange, title, allowNone = true }: { paint: Paint | null; onChange: (p: Paint | null) => void; title: string; allowNone?: boolean }) {
  const color = paint?.kind === 'solid' ? paint.color : '#808080';
  return (
    <div className="row" style={{ gap: 4 }}>
      <ColorButton color={paint ? color : '#00000000'} title={title} onChange={(c) => onChange(solid(c))} />
      {allowNone && <button className={`btn icon sm ${paint ? '' : 'on'}`} title={`No ${title.toLowerCase()}`} onClick={() => onChange(null)} style={{ width: 22, height: 22 }}><Icon name="close" size={12} /></button>}
    </div>
  );
}

export function OptionsBar({ ed }: { ed: Editor }) {
  const toolId = useEditor(ed, ['tool'], () => ed.toolId);
  useEditor(ed, ['toolopts', 'brush', 'colors', 'objsel', 'selection'], () => 0);
  const m = toolMeta(toolId);
  const o = ed.opts, b = ed.brush;
  const set = (p: Partial<typeof o>) => ed.setToolOpts(p);
  const brushFamily = ['brush', 'eraser', 'smudge', 'blur', 'sharpen', 'dodge', 'burn', 'clone'].includes(toolId);
  const selMode = (
    <Seg value={o.selectMode} onChange={(v) => set({ selectMode: v })} options={[
      { value: 'replace', icon: 'marquee', title: 'New selection' }, { value: 'add', icon: 'plus', title: 'Add to selection (Shift)' },
      { value: 'subtract', icon: 'minus', title: 'Subtract from selection (Alt)' }, { value: 'intersect', icon: 'close', title: 'Intersect (Shift+Alt)' },
    ]} />
  );

  let body: React.ReactNode = null;
  if (brushFamily) {
    const isRetouch = ['smudge', 'blur', 'sharpen', 'dodge', 'burn'].includes(toolId);
    body = (
      <>
        <PopButton className="btn sm" title="Brush library" content={(close) => <div style={{ width: 340, padding: 6 }}><BrushPresetList ed={ed} onPick={close} /></div>}>
          <Icon name="brush" size={14} />{b.name}<Icon name="chevron-down" size={12} />
        </PopButton>
        <Slider label="Size" value={toLog(b.size)} min={0} max={Math.log(800)} step={0.01} format={(v) => `${logSize(v)}px`} onChange={(v) => ed.setBrush({ size: logSize(v) })} />
        {!isRetouch && <Slider label="Opacity" value={b.opacity} min={0.02} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ed.setBrush({ opacity: v })} />}
        {!isRetouch && toolId !== 'clone' && <Slider label="Flow" value={b.flow} min={0.02} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ed.setBrush({ flow: v })} />}
        {isRetouch && <Slider label="Strength" value={b.strength} min={0.05} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ed.setBrush({ strength: v })} />}
        <Slider label="Hardness" value={b.hardness} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ed.setBrush({ hardness: v })} />
        <Slider label="Smooth" value={b.smoothing} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => ed.setBrush({ smoothing: v })} />
        {(toolId === 'dodge' || toolId === 'burn') && <Seg value={b.range} onChange={(v) => ed.setBrush({ range: v })} options={[{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Mids' }, { value: 'highlights', label: 'Lights' }]} />}
        {toolId === 'brush' && (
          <select className="select" value={b.blend} title="Brush blend mode" onChange={(e) => ed.setBrush({ blend: e.target.value as BlendMode })}>
            {BLEND_MODES.map((bm) => <option key={bm.id} value={bm.id}>{bm.label}</option>)}
          </select>
        )}
        <button className="btn sm" onClick={() => openDialog('brush-editor')}><Icon name="sliders" size={14} />Brush settings</button>
        <SymmetryToggle ed={ed} />
        {toolId === 'clone' && <span className="hint">Alt-click to set the source</span>}
      </>
    );
  } else {
    switch (toolId) {
      case 'marquee-rect': case 'marquee-ellipse':
        body = (<>{selMode}<Slider label="Feather" value={o.feather} min={0} max={100} format={(v) => `${v}px`} onChange={(v) => set({ feather: v })} />
          <Seg value={o.marqueeStyle} onChange={(v) => set({ marqueeStyle: v })} options={[{ value: 'free', label: 'Free' }, { value: 'square', label: '1:1' }, { value: 'fixed', label: 'Fixed' }]} />
          {o.marqueeStyle === 'fixed' && <><NumInput value={o.marqueeW} onChange={(v) => set({ marqueeW: v })} width={56} /><span>×</span><NumInput value={o.marqueeH} onChange={(v) => set({ marqueeH: v })} width={56} /></>}
          <SelectionActions ed={ed} /></>);
        break;
      case 'lasso': case 'lasso-poly':
        body = (<>{selMode}<Slider label="Feather" value={o.feather} min={0} max={100} format={(v) => `${v}px`} onChange={(v) => set({ feather: v })} />{toolId === 'lasso-poly' && <span className="hint">Click points · double-click or Enter to close</span>}<SelectionActions ed={ed} /></>);
        break;
      case 'wand':
        body = (<>{selMode}<Slider label="Tolerance" value={o.tolerance} min={0} max={160} onChange={(v) => set({ tolerance: v })} />
          <Switch on={o.contiguous} onChange={(v) => set({ contiguous: v })} label="Contiguous" /><Switch on={o.sampleMerged} onChange={(v) => set({ sampleMerged: v })} label="All layers" /><SelectionActions ed={ed} /></>);
        break;
      case 'select-brush':
        body = (<><Slider label="Size" value={o.selectBrushSize} min={4} max={300} format={(v) => `${v}px`} onChange={(v) => set({ selectBrushSize: v })} /><span className="hint">Alt = subtract</span><SelectionActions ed={ed} /></>);
        break;
      case 'move': body = <><ObjectQuickActions ed={ed} /><span className="hint">Alt-drag duplicates · Shift constrains</span></>; break;
      case 'transform': {
        const t = ed.getTool('transform') as TransformTool;
        body = (<><button className="btn sm" onClick={() => t.flip(true)}>Flip H</button><button className="btn sm" onClick={() => t.flip(false)}>Flip V</button>
          <button className="btn sm" onClick={() => t.rotate90(true)}>Rotate 90°</button>
          <button className="btn sm primary" onClick={() => { t.commit(); ed.setTool('move'); }}><Icon name="check" size={14} />Apply</button>
          <button className="btn sm" onClick={() => { t.cancel(); ed.setTool('move'); }}>Cancel</button><span className="hint">Shift = proportional · Alt = from centre</span></>);
        break;
      }
      case 'crop': {
        const t = ed.getTool('crop') as CropTool;
        body = (<><select className="select" value={o.cropRatio} onChange={(e) => set({ cropRatio: e.target.value as any })}>
          <option value="free">Free</option><option value="original">Original ratio</option><option value="1:1">1 : 1</option><option value="4:3">4 : 3</option><option value="3:2">3 : 2</option><option value="16:9">16 : 9</option><option value="9:16">9 : 16</option><option value="a4">A4</option></select>
          <button className="btn sm primary" onClick={() => t.apply()}><Icon name="check" size={14} />Apply crop</button><span className="hint">Enter applies · Esc resets</span></>);
        break;
      }
      case 'eyedropper':
        body = (<><Seg value={String(o.sampleSize) as any} onChange={(v) => set({ sampleSize: Number(v) })} options={[{ value: '1', label: '1 px' }, { value: '3', label: '3×3' }, { value: '5', label: '5×5' }, { value: '11', label: '11×11' }]} /><Switch on={o.sampleLayerOnly} onChange={(v) => set({ sampleLayerOnly: v })} label="Current layer only" /><span className="hint">Alt = background colour</span></>);
        break;
      case 'bucket':
        body = (<><Slider label="Tolerance" value={o.fillTolerance} min={0} max={160} onChange={(v) => set({ fillTolerance: v })} /><Slider label="Expand" value={o.fillExpand} min={0} max={8} format={(v) => `${v}px`} onChange={(v) => set({ fillExpand: v })} />
          <Switch on={o.fillContiguous} onChange={(v) => set({ fillContiguous: v })} label="Contiguous" /><Switch on={o.fillSampleMerged} onChange={(v) => set({ fillSampleMerged: v })} label="All layers" /></>);
        break;
      case 'gradient':
        body = (<><Seg value={o.gradientKind} onChange={(v) => set({ gradientKind: v })} options={[{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }, { value: 'angle', label: 'Angle' }, { value: 'reflected', label: 'Reflect' }, { value: 'diamond', label: 'Diamond' }]} />
          <Switch on={o.gradientUseFgBg} onChange={(v) => set({ gradientUseFgBg: v })} label="FG → BG" />
          {!o.gradientUseFgBg && <button className="btn sm" onClick={() => openDialog('gradient-editor')} title="Edit gradient"><span style={{ width: 64, height: 14, borderRadius: 3, background: `linear-gradient(90deg, ${o.gradientStops.map((s) => `${s.color} ${s.pos * 100}%`).join(',')})`, display: 'inline-block' }} /></button>}
          <Switch on={o.gradientReverse} onChange={(v) => set({ gradientReverse: v })} label="Reverse" /></>);
        break;
      case 'rect': case 'ellipse': case 'polygon': case 'star': case 'line': case 'arrow': case 'pen': case 'freeform': case 'node':
        body = (<>
          {toolId !== 'line' && toolId !== 'arrow' && <div className="opt"><label>Fill</label><PaintButton paint={o.shapeFill} onChange={(p) => set({ shapeFill: p })} title="Fill" /></div>}
          <div className="opt"><label>Stroke</label><PaintButton paint={o.shapeStroke ? solid(o.shapeStroke.color) : null} onChange={(p) => set({ shapeStroke: p && p.kind === 'solid' ? { ...(o.shapeStroke ?? { width: 3, cap: 'round', join: 'round', dash: [] }), color: p.color } : null })} title="Stroke" /></div>
          <Slider label="Width" value={o.shapeStroke?.width ?? 0} min={0} max={60} step={0.5} format={(v) => `${v}px`} onChange={(v) => set({ shapeStroke: v === 0 ? null : { ...(o.shapeStroke ?? { color: ed.fg, cap: 'round', join: 'round', dash: [] }), width: v } as any })} />
          {toolId === 'rect' && <Slider label="Radius" value={o.cornerRadius} min={0} max={200} onChange={(v) => set({ cornerRadius: v })} />}
          {(toolId === 'polygon' || toolId === 'star') && <Slider label="Sides" value={o.polygonSides} min={3} max={16} onChange={(v) => set({ polygonSides: v })} />}
          {toolId === 'star' && <Slider label="Inner" value={o.starInner} min={0.1} max={0.9} step={0.01} onChange={(v) => set({ starInner: v })} />}
          {toolId === 'pen' && <span className="hint">Click = corner · drag = curve · Enter finishes · click first node closes</span>}
          {toolId === 'node' && <span className="hint">Double-click a node = smooth/corner · double-click a segment = add node · Del removes</span>}
          {(toolId === 'rect' || toolId === 'ellipse') && <Switch on={o.shapeFromCenter} onChange={(v) => set({ shapeFromCenter: v })} label="From centre" />}</>);
        break;
      case 'text': body = <TextOptions ed={ed} />; break;
      case 'hand': case 'zoom': case 'rotate-view':
        body = (<><button className="btn sm" onClick={() => ed.zoomTo(1)}>100%</button><button className="btn sm" onClick={() => ed.fitPage()}>Fit page</button><button className="btn sm" onClick={() => ed.fitWidth()}>Fit width</button><button className="btn sm" title="Back to upright (Shift+R)" onClick={() => ed.resetViewRotation()}>Upright</button><button className="btn sm" title="Turn the view a quarter turn" onClick={() => runCommand('view.rotate90')}>Rotate 90°</button>{toolId === 'rotate-view' && <span className="hint">Drag to turn the view · it sticks at upright and quarter turns · Shift = 15° steps</span>}</>);
        break;
      case 'measure': body = <span className="hint">Drag to measure distance and angle</span>; break;
      case 'image': body = <span className="hint">Click the page to choose an image</span>; break;
    }
  }
  return (
    <div className="optionsbar">
      <div className="tool-title">{m && <Icon name={m.icon} size={17} />}{m?.name ?? toolId}</div>
      {body}
      <div className="spacer" />
      {toolId !== 'move' && <ObjectContextHint ed={ed} />}
    </div>
  );
}

function ObjectContextHint({ ed }: { ed: Editor }) {
  void ed; return null;
}

function SymmetryToggle({ ed }: { ed: Editor }) {
  const sym = useEditor(ed, ['doc', 'view'], () => ed.doc.symmetry);
  return (
    <button className={`btn sm ${sym.enabled ? 'on' : ''}`} title="Symmetry drawing" onClick={() => runCommand('view.symmetry')} onContextMenu={(e) => { e.preventDefault(); runCommand('view.symmetry.settings'); }}>
      <Icon name="align" size={14} />Symmetry
    </button>
  );
}

function SelectionActions({ ed }: { ed: Editor }) {
  const has = useEditor(ed, ['selection'], () => ed.hasSelection);
  return (
    <>
      <div className="sep" />
      <button className="btn sm" disabled={!has} onClick={() => runCommand('select.none')}>Deselect</button>
      <button className="btn sm" disabled={!has} onClick={() => runCommand('select.invert')}>Invert</button>
      <button className="btn sm" disabled={!has} onClick={() => runCommand('select.feather')}>Feather…</button>
      <button className="btn sm" disabled={!has} onClick={() => runCommand('layer.viasel')}>To layer</button>
    </>
  );
}

function TextOptions({ ed }: { ed: Editor }) {
  const o = ed.opts;
  const [fonts, setFonts] = useState<string[]>(PRESET_FONTS);
  const userFonts = prefs.useSelect((p) => p.fonts);
  useEffect(() => { setFonts([...userFonts, ...PRESET_FONTS]); }, [userFonts]);
  const apply = (patch: any, fontPatch?: any) => {
    ed.setToolOpts({ ...patch, ...(fontPatch ? { font: { ...o.font, ...fontPatch } } : {}) });
    const t = ed.getTool('text') as TextTool;
    const cur: any = {};
    if (fontPatch) cur.font = { ...o.font, ...fontPatch };
    Object.assign(cur, patch);
    // live-format the text being edited, or the selected text objects
    if (!t.format?.(cur) && ed.objSel.length) import('../editor/objectOps').then(({ updateSelected }) => updateSelected(ed, (ob) => (ob.type === 'text' ? { ...ob, ...cur, font: fontPatch ? { ...ob.font, ...fontPatch } : ob.font } : ob), 'Text format'));
  };
  return (
    <>
      <select className="select" style={{ maxWidth: 170 }} value={o.font.family} onChange={(e) => apply({}, { family: e.target.value })}>
        {!fonts.includes(o.font.family) && <option>{o.font.family}</option>}
        {fonts.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
      </select>
      <NumInput value={o.font.size} min={4} max={1200} width={54} decimals={0} onChange={(v) => apply({}, { size: v })} />
      <button className={`btn sm icon ${o.font.weight >= 700 ? 'on' : ''}`} title="Bold" style={{ fontWeight: 800 }} onClick={() => apply({}, { weight: o.font.weight >= 700 ? 400 : 700 })}>B</button>
      <button className={`btn sm icon ${o.font.italic ? 'on' : ''}`} title="Italic" style={{ fontStyle: 'italic' }} onClick={() => apply({}, { italic: !o.font.italic })}>I</button>
      <button className={`btn sm icon ${o.textUnderline ? 'on' : ''}`} title="Underline" style={{ textDecoration: 'underline' }} onClick={() => apply({ textUnderline: !o.textUnderline, underline: !o.textUnderline })}>U</button>
      <button className={`btn sm icon ${o.textStrike ? 'on' : ''}`} title="Strikethrough" style={{ textDecoration: 'line-through' }} onClick={() => apply({ textStrike: !o.textStrike, strike: !o.textStrike })}>S</button>
      <Seg value={o.textAlign} onChange={(v) => apply({ textAlign: v, align: v })} options={[{ value: 'left', label: '⟸' }, { value: 'center', label: '≡' }, { value: 'right', label: '⟹' }]} />
      <Slider label="Leading" value={o.lineHeight} min={0.8} max={3} step={0.05} onChange={(v) => apply({ lineHeight: v })} />
      <Slider label="Tracking" value={o.letterSpacing} min={-5} max={40} step={0.5} onChange={(v) => apply({ letterSpacing: v })} />
      <span className="hint">Colour = foreground · Ctrl+Enter or Esc to finish</span>
    </>
  );
}
void BRUSH_CATEGORIES;
