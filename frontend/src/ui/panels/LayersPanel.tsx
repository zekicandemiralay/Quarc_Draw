// Layers panel: stack with groups, masks, drag & drop, blend + opacity, adjustment layers, effects.

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import type { Layer } from '../../core/model';
import { BLEND_MODES, ADJUSTMENT_LABELS, AdjustmentKind, defaultAdjustment, findLayer } from '../../core/model';
import * as L from '../../editor/layerOps';
import { Icon } from '../icons';
import { Slider, PopButton, MenuList, MenuEntry } from '../common';
import { renderPageToCanvas } from '../../core/render';
import { openDialog } from '../../app/bus';
import { objectLabel } from '../../core/vector';
import { createCanvas, ctx2d } from '../../core/util';

const TAG_COLORS = ['#ff5d6c', '#ffb020', '#ffe066', '#3ddc97', '#4dabf7', '#b197fc'];

function LayerThumb({ ed, layer, mask }: { ed: Editor; layer: Layer; mask?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ver = useEditor(ed, ['layers', 'doc'], () => ed.versions.layers + ed.versions.doc);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const pg = ed.page;
    const W = 38, H = 30, k = Math.min(W / pg.width, H / pg.height);
    const w = Math.max(1, Math.round(pg.width * k)), h = Math.max(1, Math.round(pg.height * k));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    const t = window.setTimeout(() => {
      try {
        if (mask) {
          const m = layer.mask?.peek();
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
          if (m) { const tmp = createCanvas(w, h); const tc = ctx2d(tmp); tc.fillStyle = '#fff'; tc.fillRect(0, 0, w, h); tc.globalCompositeOperation = 'destination-in'; tc.drawImage(m, 0, 0, w, h); ctx.drawImage(tmp, 0, 0); }
        } else if (layer.type === 'raster') { const s = layer.surface.peek(); if (s) { ctx.imageSmoothingQuality = 'medium'; ctx.drawImage(s, 0, 0, w, h); } }
        else if (layer.type === 'vector' || layer.type === 'group') { const solo = { ...pg, layers: [{ ...layer, opacity: 1, blend: 'normal' as const, visible: true, effects: [], mask: null }] }; ctx.drawImage(renderPageToCanvas(ed.doc, solo as any, k, { skipBackground: true, transparentBackground: true }), 0, 0, w, h); }
      } catch { /* thumbnails are best-effort */ }
    }, 60);
    return () => clearTimeout(t);
    // a pixel layer's thumbnail only changes with its own pixels — redrawing every layer's after each stroke wasted a lot of time
  }, [ed, layer, mask, !mask && layer.type === 'raster' ? 0 : ver, layer.type === 'raster' ? layer.surface.version : 0, layer.mask?.version]);
  if (layer.type === 'adjustment' && !mask) return <div className="thumb"><Icon name="sliders" size={16} /></div>;
  if (layer.type === 'group' && !mask) return <div className="thumb"><Icon name="group" size={16} /></div>;
  return <div className={`thumb ${mask ? 'mask' : ''} ${mask && ed.editingMask && ed.activeLayerId === layer.id ? 'on' : ''}`}><canvas ref={ref} /></div>;
}

function LayerRow({ ed, layer, depth, dnd }: { ed: Editor; layer: Layer; depth: number; dnd: ReturnType<typeof useDnd> }) {
  const active = ed.activeLayerId === layer.id;
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const drop = dnd.state.over === layer.id ? dnd.state.where : null;
  const objs = layer.type === 'vector' ? layer.objects : [];
  return (
    <>
      <div className={`layer ${active ? 'on' : ''} ${!layer.visible ? 'hidden' : ''} ${drop ? 'drop-' + drop : ''}`} style={{ marginLeft: depth * 14 }}
        draggable={!editing}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', layer.id); dnd.start(layer.id); }}
        onDragOver={(e) => dnd.over(e, layer)}
        onDragLeave={() => dnd.leave(layer.id)}
        onDrop={(e) => dnd.drop(e, layer)}
        onDragEnd={dnd.end}
        onClick={() => ed.setActiveLayer(layer.id)}
        onContextMenu={(e) => { e.preventDefault(); ed.setActiveLayer(layer.id); }}>
        {layer.tag && <span className="tag" style={{ background: layer.tag }} />}
        <button className="ic" title={layer.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); L.toggleVisible(ed, layer.id); }}><Icon name={layer.visible ? 'eye' : 'eye-off'} size={15} /></button>
        {layer.type === 'group' && <button className="ic" onClick={(e) => { e.stopPropagation(); L.updateLayer(ed, layer.id, {}); const f = findLayer(ed.page.layers, layer.id); if (f && f.layer.type === 'group') { f.layer.expanded = !f.layer.expanded; ed.changed('layers'); } }}><Icon name={layer.expanded ? 'chevron-down' : 'chevron-right'} size={14} /></button>}
        <LayerThumb ed={ed} layer={layer} />
        {layer.mask && <span onClick={(e) => { e.stopPropagation(); ed.setActiveLayer(layer.id, true); }} title="Layer mask (click to edit)"><LayerThumb ed={ed} layer={layer} mask /></span>}
        <div className="name" onDoubleClick={() => setEditing(true)} title={layer.name}>
          {editing ? (
            <input ref={inputRef} className="input" defaultValue={layer.name} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== layer.name) L.renameLayer(ed, layer.id, e.target.value.trim()); setEditing(false); }} />
          ) : layer.name}
          {layer.clip && <span className="hint" title="Clipping mask"> ↳</span>}
        </div>
        {layer.effects.some((f) => f.enabled) && <span className="ic active" title="Has effects" onClick={(e) => { e.stopPropagation(); openDialog('effects'); }}><Icon name="fx" size={14} /></span>}
        {layer.alphaLock && <span className="ic active" title="Transparent pixels locked"><Icon name="grid" size={13} /></span>}
        {layer.type === 'vector' && <button className="ic" title="Show objects" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}><Icon name={expanded ? 'chevron-up' : 'list'} size={13} /></button>}
        <button className={`ic ${layer.locked ? 'active' : ''}`} title={layer.locked ? 'Unlock' : 'Lock'} onClick={(e) => { e.stopPropagation(); L.updateLayer(ed, layer.id, { locked: !layer.locked }, `lock:${layer.id}:${Date.now()}`); }}><Icon name={layer.locked ? 'lock' : 'unlock'} size={13} /></button>
      </div>
      {layer.type === 'group' && layer.expanded && [...layer.children].reverse().map((c) => <LayerRow key={c.id} ed={ed} layer={c} depth={depth + 1} dnd={dnd} />)}
      {layer.type === 'vector' && expanded && [...objs].reverse().slice(0, 200).map((o) => (
        <div key={o.id} className={`object-row ${ed.objSel.includes(o.id) ? 'on' : ''}`} style={{ marginLeft: depth * 14 }} onClick={() => { ed.setActiveLayer(layer.id); ed.objSel = [o.id]; ed.changed('objsel'); }}>
          <Icon name={o.type === 'text' ? 'text' : o.type === 'image' ? 'image' : o.type === 'group' ? 'group' : 'rect'} size={13} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{objectLabel(o)}</span>
        </div>
      ))}
    </>
  );
}

function useDnd(ed: Editor) {
  const [state, setState] = useState<{ drag: string | null; over: string | null; where: 'above' | 'below' | 'in' | null }>({ drag: null, over: null, where: null });
  return {
    state,
    start: (id: string) => setState({ drag: id, over: null, where: null }),
    over: (e: React.DragEvent, l: Layer) => {
      if (!state.drag || state.drag === l.id) return;
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      const where = l.type === 'group' && y > 0.3 && y < 0.7 ? 'in' : y < 0.5 ? 'above' : 'below';
      setState((s) => (s.over === l.id && s.where === where ? s : { ...s, over: l.id, where }));
    },
    leave: (id: string) => setState((s) => (s.over === id ? { ...s, over: null, where: null } : s)),
    drop: (e: React.DragEvent, l: Layer) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain') || state.drag;
      if (id && state.where) L.reorderLayer(ed, id, l.id, state.where === 'in' ? 'inside' : state.where === 'above' ? 'above' : 'below');
      setState({ drag: null, over: null, where: null });
    },
    end: () => setState({ drag: null, over: null, where: null }),
  };
}

export function LayersPanel({ ed }: { ed: Editor }) {
  useEditor(ed, ['layers', 'doc', 'page'], () => 0);
  const layer = ed.layer;
  const dnd = useDnd(ed);
  const adjMenu: MenuEntry[] = (Object.keys(ADJUSTMENT_LABELS) as AdjustmentKind[]).map((k) => ({ label: ADJUSTMENT_LABELS[k], onClick: () => L.addAdjustmentLayer(ed, defaultAdjustment(k)) }));
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row">
        <select className="select grow" style={{ flex: 1 }} disabled={!layer} value={layer?.blend ?? 'normal'} onChange={(e) => layer && L.setBlend(ed, layer.id, e.target.value as any)}>
          {BLEND_MODES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </div>
      <Slider label="Opacity" value={Math.round((layer?.opacity ?? 1) * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => layer && L.updateLayer(ed, layer.id, { opacity: v / 100 })} />
      <div className="layer-list" onDragOver={(e) => e.preventDefault()}>
        {[...ed.page.layers].reverse().map((l) => <LayerRow key={l.id} ed={ed} layer={l} depth={0} dnd={dnd} />)}
        {!ed.page.layers.length && <div className="hint" style={{ padding: 12, textAlign: 'center' }}>No layers yet — draw something or add a layer.</div>}
      </div>
      <div className="layer-actions">
        <button className="btn ghost icon" title="New pixel layer" onClick={() => L.addLayer(ed, 'raster')}><Icon name="plus" size={16} /></button>
        <button className="btn ghost icon" title="New vector layer" onClick={() => L.addLayer(ed, 'vector')}><Icon name="bezier" size={16} /></button>
        <button className="btn ghost icon" title="New group" onClick={() => L.addLayer(ed, 'group')}><Icon name="group" size={16} /></button>
        <PopButton className="btn ghost icon" title="Adjustment layer" content={(close) => <MenuList items={adjMenu} ed={ed} onDone={close} />}><Icon name="sliders" size={16} /></PopButton>
        <button className="btn ghost icon" title="Add layer mask" disabled={!layer || !!layer.mask} onClick={() => L.addMask(ed)}><Icon name="mask" size={16} /></button>
        <button className="btn ghost icon" title="Layer effects…" disabled={!layer} onClick={() => openDialog('effects')}><Icon name="fx" size={16} /></button>
        <button className="btn ghost icon" title="Duplicate" disabled={!layer} onClick={() => L.duplicateLayer(ed)}><Icon name="copy" size={16} /></button>
        <PopButton className="btn ghost icon" title="More" content={(close) => (
          <MenuList ed={ed} onDone={close} items={[
            { command: 'layer.mergedown' }, { command: 'layer.mergevisible' }, { command: 'layer.flatten' }, { separator: true },
            { command: 'layer.clip' }, { command: 'layer.alphalock' }, { command: 'layer.rasterize' }, { separator: true },
            { label: 'Colour label', children: [{ label: 'None', onClick: () => layer && L.updateLayer(ed, layer.id, { tag: undefined }) }, ...TAG_COLORS.map((c) => ({ label: c, onClick: () => layer && L.updateLayer(ed, layer.id, { tag: c }) }))] },
            { separator: true }, { command: 'layer.mask.sel' }, { command: 'layer.mask.hide' }, { command: 'layer.mask.invert' }, { command: 'layer.mask.apply' }, { command: 'layer.mask.delete' }, { separator: true },
            { command: 'layer.selectpixels' }, { command: 'layer.viasel' }, { command: 'layer.group' },
          ]} />
        )}><Icon name="more" size={16} /></PopButton>
        <button className="btn ghost icon" title="Delete layer" disabled={!layer} onClick={() => L.deleteLayer(ed)}><Icon name="trash" size={16} /></button>
      </div>
    </div>
  );
}
