// Dialog host, toasts, command palette and canvas context menu.

import { useEffect, useMemo, useRef, useState } from 'react';
import { bus, DialogName } from '../app/bus';
import { workspace, useWorkspace } from '../app/workspace';
import { commands, formatKeys, keysFor, runCommand } from '../app/commands';
import { Icon } from './icons';
import { MenuList, MenuEntry, Popover } from './common';
import { NewDocDialog, ExportDialog, ImageSizeDialog } from './dialogs/DocDialogs';
import { FilterDialog, AdjustDialog, EffectsDialog, GradientDialog } from './dialogs/FxDialogs';
import { PromptDialog, PrefsDialog, ShortcutsDialog, AboutDialog, SyncDialog, PageSetupDialog, DocInfoDialog, TourDialog } from './dialogs/SysDialogs';
import { Dialog } from './common';
import { BrushEditor } from './panels/BrushesPanel';

interface Open { name: DialogName; payload?: any; key: number }

export function DialogHost() {
  const [stack, setStack] = useState<Open[]>([]);
  const ws = useWorkspace();
  const ed = ws.active;
  useEffect(() => bus.on('dialog', (d) => setStack((s) => [...s, { ...d, key: Date.now() + Math.random() }])), []);
  const close = (k: number) => setStack((s) => s.filter((x) => x.key !== k));
  return (
    <>
      {stack.map((d) => {
        const onClose = () => close(d.key);
        const needEd = ['export', 'image-size', 'canvas-size', 'filter', 'adjust', 'effects', 'page-setup', 'note', 'doc-info', 'gradient-editor', 'present', 'brush-editor', 'rename'];
        if (needEd.includes(d.name) && !ed) return null;
        switch (d.name) {
          case 'new': return <NewDocDialog key={d.key} onClose={onClose} />;
          case 'export': return <ExportDialog key={d.key} ed={ed!} onClose={onClose} />;
          case 'image-size': return <ImageSizeDialog key={d.key} ed={ed!} onClose={onClose} />;
          case 'canvas-size': return <ImageSizeDialog key={d.key} ed={ed!} onClose={onClose} canvasMode />;
          case 'filter': return <FilterDialog key={d.key} ed={ed!} id={d.payload.id} onClose={onClose} />;
          case 'adjust': return <AdjustDialog key={d.key} ed={ed!} kind={d.payload.kind} layerId={d.payload.layerId} onClose={onClose} />;
          case 'effects': return <EffectsDialog key={d.key} ed={ed!} onClose={onClose} />;
          case 'gradient-editor': return <GradientDialog key={d.key} ed={ed!} onClose={onClose} />;
          case 'prompt': return <PromptDialog key={d.key} p={d.payload} onClose={onClose} />;
          case 'rename': return <PromptDialog key={d.key} p={{ title: 'Rename document', fields: [{ key: 'name', label: 'Name', type: 'text', value: ed!.doc.title }], ok: (v) => { ed!.doc.title = v.name.trim() || ed!.doc.title; ed!.changed('doc', 'status'); ed!.history.events.emit('change', undefined); ed!.history.revision++; } }} onClose={onClose} />;
          case 'prefs': return <PrefsDialog key={d.key} onClose={onClose} />;
          case 'shortcuts': return <ShortcutsDialog key={d.key} onClose={onClose} />;
          case 'about': return <AboutDialog key={d.key} onClose={onClose} />;
          case 'sync': return <SyncDialog key={d.key} onClose={onClose} />;
          case 'page-setup': return <PageSetupDialog key={d.key} ed={ed!} onClose={onClose} />;
          case 'doc-info': return <DocInfoDialog key={d.key} ed={ed!} onClose={onClose} />;
          case 'tutorial': return <TourDialog key={d.key} onClose={onClose} />;
          case 'brush-editor': return <Dialog key={d.key} title="Brush settings" icon="brush" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}><BrushEditor ed={ed!} /></Dialog>;
          default: return null;
        }
      })}
    </>
  );
}

// ---------------------------------------------------------------- toasts
export function Toasts() {
  const [list, setList] = useState<{ id: number; message: string; kind: string }[]>([]);
  useEffect(() => bus.on('toast', (t) => {
    const id = Math.random();
    setList((l) => [...l.filter((x) => x.message !== t.message), { id, message: t.message, kind: t.kind ?? 'info' }].slice(-4));
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.kind === 'error' ? 6500 : 3400);
  }), []);
  return (
    <div className="toasts">
      {list.map((t) => <div key={t.id} className={`toast ${t.kind}`}><Icon name={t.kind === 'error' ? 'warning' : t.kind === 'success' ? 'check' : 'help'} size={16} /><span>{t.message}</span></div>)}
    </div>
  );
}

// ---------------------------------------------------------------- command palette
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const ed = useWorkspace().active;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => bus.on('command-palette', () => { setOpen(true); setQ(''); setSel(0); }), []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); }, [open]);
  const list = useMemo(() => {
    const s = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => !c.hidden && (!c.enabled || c.enabled({ ed })) && s.every((w) => (c.label + ' ' + c.category).toLowerCase().includes(w)))
      .sort((a, b) => Number(!!keysFor(b.id)) - Number(!!keysFor(a.id))).slice(0, 60);
  }, [q, ed, open]);
  if (!open) return null;
  const run = (i: number) => { const c = list[i]; if (c) { setOpen(false); setTimeout(() => runCommand(c.id, ed), 10); } };
  return (
    <div className="scrim" style={{ alignItems: 'start' }} onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="palette">
        <input ref={input} placeholder="Type a command…  (tools, filters, layers, pages, export…)" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(false); else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); } else if (e.key === 'Enter') run(sel); }} />
        <ul>{list.map((c, i) => <li key={c.id} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => run(i)}><span className="cat">{c.category}</span><span>{c.label}</span>{keysFor(c.id) && <span className="keys kbd">{formatKeys(keysFor(c.id))}</span>}</li>)}
          {!list.length && <li className="hint">No matching commands</li>}</ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- context menu
export function ContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ed = useWorkspace().active;
  useEffect(() => bus.on('context-menu', (p) => setPos(p)), []);
  if (!pos || !ed) return null;
  const hasObj = ed.objSel.length > 0;
  const items: MenuEntry[] = hasObj ? [
    { command: 'edit.cut' }, { command: 'edit.copy' }, { command: 'edit.paste' }, { command: 'edit.duplicate' }, { command: 'edit.delete' }, { separator: true },
    { command: 'object.group' }, { command: 'object.ungroup' }, { label: 'Arrange', children: [{ command: 'object.front' }, { command: 'object.forward' }, { command: 'object.backward' }, { command: 'object.back' }] },
    { label: 'Align', children: ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map((k) => ({ command: `object.align.${k}` })) },
    { label: 'Shape operations', children: [{ command: 'object.unite' }, { command: 'object.subtract' }, { command: 'object.intersect' }, { command: 'object.exclude' }] },
    { command: 'object.topath' }, { command: 'object.lock' },
  ] : [
    { command: 'edit.undo' }, { command: 'edit.redo' }, { separator: true }, { command: 'edit.paste' }, { command: 'edit.pasteinplace' }, { separator: true },
    { command: 'select.all' }, { command: 'select.none' }, { command: 'select.invert' }, { separator: true },
    { command: 'layer.new' }, { command: 'layer.duplicate' }, { command: 'layer.mergedown' }, { separator: true },
    { command: 'view.fit' }, { command: 'view.100' }, { command: 'page.add' },
  ];
  return <Popover anchor={{ x: pos.x, y: pos.y, w: 0, h: 0 }} onClose={() => setPos(null)}><MenuList items={items} ed={ed} onDone={() => setPos(null)} /></Popover>;
}
