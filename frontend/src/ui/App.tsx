// Application shell: titlebar, document tabs, tool strip, panels, global input handling.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace, workspace } from '../app/workspace';
import { prefs } from '../app/store';
import { bus, openDialog, toast } from '../app/bus';
import { commandForKeys, eventToKeys, runCommand } from '../app/commands';
import { TOOL_CATALOG, TOOLBAR, toolMeta } from '../tools/catalog';
import { Icon } from './icons';
import { MenuBar } from './MenuBar';
import { Toolbar } from './Toolbar';
import { OptionsBar } from './OptionsBar';
import { CanvasView } from './CanvasView';
import { Library } from './Library';
import { DialogHost, Toasts, CommandPalette, ContextMenu } from './Overlays';
import { LayersPanel } from './panels/LayersPanel';
import { ColorPanel } from './panels/ColorPanel';
import { BrushesPanel } from './panels/BrushesPanel';
import { HistoryPanel, NavigatorPanel } from './panels/HistoryNavPanels';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { AssetsPanel } from './panels/AssetsPanel';
import { PagesPanel } from './panels/SidePanels';
import type { Editor } from '../editor/editor';
import { useEditor } from '../editor/editor';
import { openFiles, placeImages, pickFiles } from '../app/actions';
import { isDocFile } from '../io/importers';
import { syncEngine } from '../sync/engine';
import { formatBytes } from '../core/util';
import { createTextObject } from '../editor/textUtil';
import { placeImageBlob, pasteInternal } from '../editor/rasterOps';
import { updateObjects } from '../editor/objectOps';

type PanelId = 'color' | 'brushes' | 'layers' | 'history' | 'navigator' | 'properties' | 'assets';
const PANELS: Record<PanelId, { title: string; icon: string; render: (ed: Editor) => React.ReactNode }> = {
  color: { title: 'Color', icon: 'palette', render: (ed) => <ColorPanel ed={ed} /> },
  brushes: { title: 'Brushes', icon: 'brush', render: (ed) => <BrushesPanel ed={ed} /> },
  layers: { title: 'Layers', icon: 'layers', render: (ed) => <LayersPanel ed={ed} /> },
  history: { title: 'History', icon: 'history', render: (ed) => <HistoryPanel ed={ed} /> },
  navigator: { title: 'Navigator', icon: 'navigator', render: (ed) => <NavigatorPanel ed={ed} /> },
  properties: { title: 'Properties', icon: 'sliders', render: (ed) => <PropertiesPanel ed={ed} /> },
  assets: { title: 'Libraries', icon: 'library', render: (ed) => <AssetsPanel ed={ed} /> },
};
const DOCK: { top: PanelId[]; bottom: PanelId } = { top: ['color', 'brushes', 'properties', 'assets', 'navigator', 'history'], bottom: 'layers' };

// tool shortcut map: key → tool ids
function toolKeyMap(): Map<string, string[]> {
  const ids = new Set(TOOLBAR.flat());
  const m = new Map<string, string[]>();
  for (const t of TOOL_CATALOG) { if (!t.key || t.key.startsWith('Ctrl') || !ids.has(t.id)) continue; m.set(t.key.toLowerCase(), [...(m.get(t.key.toLowerCase()) ?? []), t.id]); }
  return m;
}

export function App() {
  const ws = useWorkspace();
  const ed = ws.active;
  const theme = prefs.useSelect((p) => p.theme);
  const leftSidebar = prefs.useSelect((p) => p.leftSidebar);
  const rightDock = prefs.useSelect((p) => p.rightDock);
  const tutorialSeen = prefs.useSelect((p) => p.tutorialSeen);
  const [showLibrary, setShowLibrary] = useState(true);
  const [dockTab, setDockTab] = useState<PanelId>('color');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingImage = useRef<{ asObject?: boolean } | null>(null);

  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  useEffect(() => { if (!tutorialSeen && ws.editors.length === 0) { /* tour offered after first doc */ } }, [tutorialSeen, ws.editors.length]);
  useEffect(() => { if (ws.editors.length > 0 && showLibrary && ws.version) { /* keep library open until user picks */ } }, []);
  // newly added document → leave the library
  const lastCount = useRef(0);
  useEffect(() => { if (ws.editors.length > lastCount.current) setShowLibrary(false); if (ws.editors.length === 0) setShowLibrary(true); lastCount.current = ws.editors.length; }, [ws.editors.length]);
  useEffect(() => { if (ws.activeId) setShowLibrary(false); }, [ws.activeId]);

  // first-run tour
  useEffect(() => { if (!tutorialSeen && ws.editors.length === 1) { openDialog('tutorial'); prefs.set({ tutorialSeen: true }); } }, [ws.editors.length, tutorialSeen]);

  // bus: panels / file picker
  useEffect(() => {
    const offs = [
      bus.on('toggle-panel', ({ id }) => {
        if (id === 'library') { setShowLibrary((v) => !v); return; }
        if (id === 'pages') { prefs.set({ leftSidebar: true }); return; }
        prefs.set({ rightDock: true });
        if (DOCK.bottom === id) return;
        if (DOCK.top.includes(id as PanelId)) setDockTab(id as PanelId);
      }),
      bus.on('pick-image', async (o) => { const files = await pickFiles('image/*', true); const e = workspace.active; if (e && files.length) await placeImages(e, files); void o; }),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  // ---------------------------------------------------------------- global keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.dataset?.textEditor)) return;
      if (document.querySelector('.scrim')) return; // a dialog is open
      const cur = workspace.active;
      if (e.key === ' ' && !e.repeat && cur) { cur.spaceDown = true; e.preventDefault(); return; }
      if (cur && cur.tool.keyDown(e)) { e.preventDefault(); return; }
      const spec = eventToKeys(e);
      if (!spec) return;
      if (spec === 'Ctrl+V') return; // let the browser fire a paste event (gives access to the clipboard without a permission prompt)
      const cmd = commandForKeys(spec);
      if (cmd) { e.preventDefault(); runCommand(cmd.id, cur); return; }
      if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
      // tool shortcuts (cycle through tools sharing a key)
      const tk = toolKeyMap().get(spec.toLowerCase());
      if (tk) { const i = tk.indexOf(cur.toolId); cur.setTool(tk[(i + 1) % tk.length]); e.preventDefault(); return; }
      // number keys: opacity
      if (/^[0-9]$/.test(e.key) && !e.shiftKey) { const v = e.key === '0' ? 1 : parseInt(e.key) / 10; if (['brush', 'eraser'].includes(cur.toolId)) cur.setBrush({ opacity: v }); e.preventDefault(); }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') { const cur = workspace.active; if (cur) cur.spaceDown = false; } };
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { const cur = workspace.active; if (cur) cur.spaceDown = false; });
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
  }, []);

  // ---------------------------------------------------------------- paste + drag-drop
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && t.closest('input, textarea, [contenteditable="true"]')) return;
      const cur = workspace.active; if (!cur) return;
      e.preventDefault();
      const items = Array.from(e.clipboardData?.items ?? []);
      const img = items.find((i) => i.type.startsWith('image/'));
      if (img) { const f = img.getAsFile(); if (f) { await placeImageBlob(cur, f, 'Pasted image'); return; } }
      const text = e.clipboardData?.getData('text/plain');
      if (pasteInternal(cur)) return;
      if (text?.trim()) createTextObject(cur, text);
    };
    const onDragOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDrag(true); } };
    const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) setDrag(false); };
    const onDrop = async (e: DragEvent) => {
      setDrag(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      const cur = workspace.active;
      const onCanvas = (e.target as HTMLElement)?.closest?.('.viewport');
      const imgs = files.filter((f) => f.type.startsWith('image/') && !f.name.endsWith('.svg') && !f.name.endsWith('.ico'));
      if (cur && onCanvas && imgs.length === files.length && !e.altKey) {
        const r = (onCanvas as HTMLElement).getBoundingClientRect();
        const w = cur.view.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
        const hit = cur.view.pageAt(cur.doc, w, cur.page);
        if (hit) { if (hit.page.id !== cur.page.id) cur.setActivePage(hit.page.id); await placeImages(cur, imgs, hit.local); return; }
      }
      await openFiles(files.filter((f) => isDocFile(f.name) || f.type.startsWith('image/')));
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver); window.addEventListener('dragleave', onDragLeave); window.addEventListener('drop', onDrop);
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragleave', onDragLeave); window.removeEventListener('drop', onDrop); };
  }, []);

  // warn before leaving with unsaved work (autosave normally prevents this)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (workspace.editors.some((x) => x.dirty) ) { void workspace.flushAll(); if (!prefs.get().autosave) { e.preventDefault(); e.returnValue = ''; } } };
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h);
  }, []);

  const activeTop = dockTab;
  const showSidebar = leftSidebar && ed && !showLibrary && ed.doc.pages.length > 1;

  return (
    <div className="app">
      {(
        <div className="titlebar">
          <div className="brand" onClick={() => setShowLibrary(true)} title="Documents library"><img src="/logo.png" alt="" /><span>Quarc <b>Draw</b></span></div>
          <MenuBar ed={ed} />
          <div className="spacer" />
          <button className="btn ghost icon" title="Undo (Ctrl+Z)" disabled={!ed?.history.canUndo} onClick={() => ed?.undo()}><Icon name="undo" size={16} /></button>
          <button className="btn ghost icon" title="Redo (Ctrl+Shift+Z)" disabled={!ed?.history.canRedo} onClick={() => ed?.redo()}><Icon name="redo" size={16} /></button>
          <button className="btn ghost icon" title="Command palette (Ctrl+K)" onClick={() => bus.emit('command-palette', undefined)}><Icon name="search" size={16} /></button>
          <button className="btn ghost icon" title="Library" onClick={() => setShowLibrary(!showLibrary)}><Icon name="library" size={16} /></button>
          <button className="btn ghost icon" title="Toggle panels (Tab)" onClick={() => runCommand('view.focus')}><Icon name="sliders" size={16} /></button>
          <button className="btn ghost icon" title="Preferences" onClick={() => openDialog('prefs')}><Icon name="settings" size={16} /></button>
        </div>
      )}
      {(
        <div className="tabs">
          {ws.editors.map((e) => (
            <div key={e.id} className={`tab ${e.id === ws.activeId && !showLibrary ? 'on' : ''}`} onClick={() => { workspace.setActive(e.id); setShowLibrary(false); }} onAuxClick={() => workspace.close(e)}>
              <Icon name="palette" size={14} />
              <span className="name">{e.doc.title}</span>{e.dirty && <span className="dirty" title="Unsaved changes" />}
              <button className="x" aria-label="Close" onClick={(ev) => { ev.stopPropagation(); void workspace.close(e); }}><Icon name="close" size={12} /></button>
            </div>
          ))}
          <button className="btn ghost icon sm tab-add" title="New (Ctrl+N)" onClick={() => openDialog('new')}><Icon name="plus" size={15} /></button>
        </div>
      )}
      {ed && !showLibrary ? <OptionsBar ed={ed} /> : <div />}
      <div className="main" style={{ position: 'relative' }}>
        {ed && <Toolbar ed={ed} />}
        {showSidebar && (
          <div className="sidebar">
            <PagesPanel ed={ed!} />
          </div>
        )}
        {ed ? <CanvasView key={ed.id} ed={ed} /> : <div className="welcome" />}
        {ed && rightDock && (
          <div className="dock">
            <div className="dock-tabs">
              {DOCK.top.map((id) => <button key={id} className={`dock-tab ${activeTop === id ? 'on' : ''}`} onClick={() => setDockTab(id)} title={PANELS[id].title}><Icon name={PANELS[id].icon} size={14} />{activeTop === id ? PANELS[id].title : ''}</button>)}
            </div>
            <div className="panel" style={{ flex: '0 0 auto', overflowY: 'auto', maxHeight: '48%' }}><div className="panel-b" style={{ paddingTop: 10 }}>{PANELS[activeTop].render(ed)}</div></div>
            <div className="panel fill"><div className="panel-h"><Icon name={PANELS[DOCK.bottom].icon} size={14} /><span className="grow">{PANELS[DOCK.bottom].title}</span></div><div className="panel-b">{PANELS[DOCK.bottom].render(ed)}</div></div>
          </div>
        )}
        {showLibrary && <Library onClose={() => { if (ws.editors.length) setShowLibrary(false); }} />}
      </div>
      <StatusBar ed={ed} />
      <DialogHost /><Toasts /><CommandPalette /><ContextMenu />
      {drag && <div className="drop-overlay">Drop to open — or onto the canvas to place images</div>}
      <input ref={fileRef} type="file" style={{ display: 'none' }} />
    </div>
  );
}

function StatusBar({ ed }: { ed: Editor | null }) {
  const st = syncEngine.status.use();
  const cfg = syncEngine.config.use();
  useEditor(ed, ['status', 'view', 'history', 'selection', 'doc', 'tool'], () => ed?.versions.status);
  const tool = ed ? toolMeta(ed.toolId) : null;
  const pl = ed?.pointerLocal;
  const sel = ed?.selection.bounds;
  return (
    <div className="statusbar">
      {ed?.statusMessage ? <span className="msg">{ed.statusMessage}</span> : <span>{tool?.hint ?? tool?.name ?? 'Ready'}</span>}
      <div className="spacer" />
      {ed && pl && <span title="Pointer position">{Math.round(pl.x)}, {Math.round(pl.y)} px</span>}
      {ed && sel && <span title="Selection size">▭ {sel.w} × {sel.h}</span>}
      {ed && <span>{ed.page.width} × {ed.page.height} px{ed.doc.pages.length > 1 ? ` · page ${ed.pageIndex + 1}/${ed.doc.pages.length}` : ''}</span>}
      {ed && <span>{Math.round(ed.view.zoom * 100)}%</span>}
      {ed && <span title={ed.dirty ? 'Unsaved changes — autosave pending' : 'All changes saved'} style={{ color: ed.dirty ? 'var(--warn)' : 'var(--ok)' }}>{ed.dirty ? '● Editing' : '✓ Saved'}</span>}
      <span className="chip" onClick={() => openDialog('sync')} title={cfg.provider === 'none' ? 'Sync is off — click to set up' : st.message || st.label}>
        <span className={`sync-dot ${cfg.provider === 'none' ? '' : st.state}`} />{cfg.provider === 'none' ? 'Local only' : st.state === 'syncing' ? 'Syncing…' : st.state === 'error' || st.state === 'auth' ? 'Sync problem' : 'Synced'}
      </span>
    </div>
  );
}
void formatBytes; void toast; void useCallback; void updateObjects;
