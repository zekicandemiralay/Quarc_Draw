// Application shell: titlebar, tabs, workspaces, panels, global input handling.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace, workspace } from '../app/workspace';
import { prefs, Workspace } from '../app/store';
import { bus, openDialog, toast } from '../app/bus';
import { commandForKeys, eventToKeys, runCommand } from '../app/commands';
import { TOOL_CATALOG, TOOLBARS, toolMeta } from '../tools/catalog';
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
import { PagesPanel, OutlinePanel, SearchPanel, AnnotationsPanel } from './panels/SidePanels';
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
const DOCKS: Record<Workspace, { top: PanelId[]; bottom?: PanelId }> = {
  studio: { top: ['color', 'brushes', 'properties', 'assets', 'navigator', 'history'], bottom: 'layers' },
  notes: { top: ['properties', 'color', 'layers', 'assets', 'history'] },
  reader: { top: ['properties', 'color', 'layers', 'assets'] },
};
const DEFAULT_TOOL: Record<Workspace, string> = { studio: 'brush', notes: 'ink-pen', reader: 'markup-highlight' };

// tool shortcut map per workspace: key → tool ids
function toolKeyMap(ws: Workspace): Map<string, string[]> {
  const ids = new Set(TOOLBARS[ws].flat());
  const m = new Map<string, string[]>();
  for (const t of TOOL_CATALOG) { if (!t.key || t.key.startsWith('Ctrl') || !ids.has(t.id)) continue; m.set(t.key.toLowerCase(), [...(m.get(t.key.toLowerCase()) ?? []), t.id]); }
  return m;
}

export function App() {
  const ws = useWorkspace();
  const ed = ws.active;
  const wsName = prefs.useSelect((p) => p.workspace);
  const theme = prefs.useSelect((p) => p.theme);
  const leftSidebar = prefs.useSelect((p) => p.leftSidebar);
  const rightDock = prefs.useSelect((p) => p.rightDock);
  const tutorialSeen = prefs.useSelect((p) => p.tutorialSeen);
  const [showLibrary, setShowLibrary] = useState(true);
  const [dockTab, setDockTab] = useState<Record<string, PanelId>>({ studio: 'color', notes: 'properties', reader: 'properties' });
  const [sideTab, setSideTab] = useState<'pages' | 'outline' | 'search' | 'annotations'>('pages');
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

  // workspace change → valid tool
  useEffect(() => {
    const e = workspace.active;
    if (!e) return;
    const valid = new Set(TOOLBARS[wsName].flat());
    if (!valid.has(e.toolId)) e.setTool(DEFAULT_TOOL[wsName]);
  }, [wsName, ws.activeId]);

  // bus: panels / file picker
  useEffect(() => {
    const offs = [
      bus.on('toggle-panel', ({ id }) => {
        if (id === 'library') { setShowLibrary((v) => !v); return; }
        if (['pages', 'outline', 'search', 'annotations'].includes(id)) { prefs.set({ leftSidebar: true }); if (prefs.get().workspace === 'studio') { /* sidebar is available in all workspaces for search */ } setSideTab(id as any); return; }
        prefs.set({ rightDock: true });
        const cur = prefs.get().workspace;
        const dock = DOCKS[cur];
        if (dock.bottom === id) return;
        if (dock.top.includes(id as PanelId)) setDockTab((t) => ({ ...t, [cur]: id as PanelId }));
      }),
      bus.on('pick-image', async (o) => { const files = await pickFiles('image/*', true); const e = workspace.active; if (e && files.length) await placeImages(e, files); void o; }),
      bus.on('workspace', () => { /* handled via prefs */ }),
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
      if (cur?.presentation) {
        if (e.key === 'Escape') { cur.presentation = false; cur.changed('status'); if (document.fullscreenElement) void document.exitFullscreen(); return; }
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { cur.goToPage(cur.pageIndex + 1); e.preventDefault(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { cur.goToPage(cur.pageIndex - 1); e.preventDefault(); return; }
      }
      if (cur && cur.tool.keyDown(e)) { e.preventDefault(); return; }
      const spec = eventToKeys(e);
      if (!spec) return;
      if (spec === 'Ctrl+V') return; // let the browser fire a paste event (gives access to the clipboard without a permission prompt)
      const cmd = commandForKeys(spec);
      if (cmd) { e.preventDefault(); runCommand(cmd.id, cur); return; }
      if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
      // tool shortcuts (cycle through tools sharing a key)
      const tk = toolKeyMap(prefs.get().workspace).get(spec.toLowerCase());
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
      if (img) { const f = img.getAsFile(); if (f) { await placeImageBlob(cur, f, 'Pasted image', { asObject: cur.doc.kind !== 'drawing' }); return; } }
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

  const setWs = (w: Workspace) => { prefs.set({ workspace: w }); };
  const presentation = !!ed?.presentation;
  useEditor(ed, ['status'], () => ed?.presentation);

  const dock = DOCKS[wsName];
  const activeTop = dock.top.includes(dockTab[wsName]) ? dockTab[wsName] : dock.top[0];
  const showSidebar = leftSidebar && ed && !showLibrary && (wsName !== 'studio' || ed.doc.pages.length > 1 || sideTab === 'search') && !presentation;
  const sideTabs: { id: typeof sideTab; icon: string; title: string }[] = [{ id: 'pages', icon: 'pages', title: 'Pages' }, { id: 'outline', icon: 'list', title: 'Outline & bookmarks' }, { id: 'search', icon: 'search', title: 'Find' }, { id: 'annotations', icon: 'note', title: 'Annotations' }];

  return (
    <div className="app">
      {!presentation && (
        <div className="titlebar">
          <div className="brand" onClick={() => setShowLibrary(true)} title="Documents library"><img src="/logo.png" alt="" /><span>Quarc <b>Draw</b></span></div>
          <MenuBar ed={ed} />
          <div className="spacer" />
          <div className="ws-switch" role="tablist" aria-label="Workspace">
            {([['studio', 'Studio', 'palette'], ['notes', 'Notes', 'pen-nib'], ['reader', 'Reader', 'file']] as const).map(([id, label, icon]) => (
              <button key={id} className={wsName === id ? 'on' : ''} onClick={() => setWs(id)} title={`${label} workspace`}><Icon name={icon} size={14} />{label}</button>
            ))}
          </div>
          <div className="spacer" />
          <button className="btn ghost icon" title="Undo (Ctrl+Z)" disabled={!ed?.history.canUndo} onClick={() => ed?.undo()}><Icon name="undo" size={16} /></button>
          <button className="btn ghost icon" title="Redo (Ctrl+Shift+Z)" disabled={!ed?.history.canRedo} onClick={() => ed?.redo()}><Icon name="redo" size={16} /></button>
          <button className="btn ghost icon" title="Command palette (Ctrl+K)" onClick={() => bus.emit('command-palette', undefined)}><Icon name="search" size={16} /></button>
          <button className="btn ghost icon" title="Library" onClick={() => setShowLibrary(!showLibrary)}><Icon name="library" size={16} /></button>
          <button className="btn ghost icon" title="Toggle panels (Tab)" onClick={() => runCommand('view.focus')}><Icon name="sliders" size={16} /></button>
          <button className="btn ghost icon" title="Preferences" onClick={() => openDialog('prefs')}><Icon name="settings" size={16} /></button>
        </div>
      )}
      {!presentation && (
        <div className="tabs">
          {ws.editors.map((e) => (
            <div key={e.id} className={`tab ${e.id === ws.activeId && !showLibrary ? 'on' : ''}`} onClick={() => { workspace.setActive(e.id); setShowLibrary(false); }} onAuxClick={() => workspace.close(e)}>
              <Icon name={e.doc.kind === 'pdf' ? 'file' : e.doc.kind === 'notebook' ? 'page' : e.doc.kind === 'whiteboard' ? 'present' : 'palette'} size={14} />
              <span className="name">{e.doc.title}</span>{e.dirty && <span className="dirty" title="Unsaved changes" />}
              <button className="x" aria-label="Close" onClick={(ev) => { ev.stopPropagation(); void workspace.close(e); }}><Icon name="close" size={12} /></button>
            </div>
          ))}
          <button className="btn ghost icon sm tab-add" title="New (Ctrl+N)" onClick={() => openDialog('new')}><Icon name="plus" size={15} /></button>
        </div>
      )}
      {ed && !showLibrary && !presentation ? <OptionsBar ed={ed} /> : <div />}
      <div className="main" style={{ position: 'relative' }}>
        {ed && !presentation && <Toolbar ed={ed} />}
        {showSidebar && (
          <div className={`sidebar ${sideTab === 'pages' ? '' : 'wide'}`}>
            <div className="side-tabs">{sideTabs.map((t) => <button key={t.id} className={sideTab === t.id ? 'on' : ''} title={t.title} onClick={() => setSideTab(t.id)}><Icon name={t.icon} size={16} /></button>)}</div>
            {sideTab === 'pages' && <PagesPanel ed={ed!} />}
            {sideTab === 'outline' && <OutlinePanel ed={ed!} />}
            {sideTab === 'search' && <SearchPanel ed={ed!} />}
            {sideTab === 'annotations' && <AnnotationsPanel ed={ed!} />}
          </div>
        )}
        {ed ? <CanvasView key={ed.id} ed={ed} /> : <div className="welcome" />}
        {ed && rightDock && !presentation && (
          <div className="dock">
            <div className="dock-tabs">
              {dock.top.map((id) => <button key={id} className={`dock-tab ${activeTop === id ? 'on' : ''}`} onClick={() => setDockTab((t) => ({ ...t, [wsName]: id }))} title={PANELS[id].title}><Icon name={PANELS[id].icon} size={14} />{dock.top.length <= 5 || activeTop === id ? PANELS[id].title : ''}</button>)}
            </div>
            <div className="panel" style={{ flex: dock.bottom ? '0 0 auto' : 1, overflowY: 'auto', maxHeight: dock.bottom ? '48%' : undefined }}><div className="panel-b" style={{ paddingTop: 10 }}>{PANELS[activeTop].render(ed)}</div></div>
            {dock.bottom && <div className="panel fill"><div className="panel-h"><Icon name={PANELS[dock.bottom].icon} size={14} /><span className="grow">{PANELS[dock.bottom].title}</span></div><div className="panel-b">{PANELS[dock.bottom].render(ed)}</div></div>}
          </div>
        )}
        {showLibrary && <Library onClose={() => { if (ws.editors.length) setShowLibrary(false); }} />}
        {presentation && ed && <PresentationBar ed={ed} />}
      </div>
      {!presentation && <StatusBar ed={ed} />}
      <DialogHost /><Toasts /><CommandPalette /><ContextMenu />
      {drag && <div className="drop-overlay">Drop to open — or onto the canvas to place images</div>}
      <input ref={fileRef} type="file" style={{ display: 'none' }} />
    </div>
  );
}

function PresentationBar({ ed }: { ed: Editor }) {
  const n = useEditor(ed, ['page'], () => ed.pageIndex);
  return (
    <div className="page-nav pill" style={{ zIndex: 50, bottom: 18 }}>
      <button onClick={() => ed.goToPage(n - 1)}><Icon name="chevron-left" size={16} /></button>
      <span>{n + 1} / {ed.doc.pages.length}</span>
      <button onClick={() => ed.goToPage(n + 1)}><Icon name="chevron-right" size={16} /></button>
      <button title="Exit (Esc)" onClick={() => { ed.presentation = false; ed.changed('status'); if (document.fullscreenElement) void document.exitFullscreen(); }}><Icon name="close" size={15} /></button>
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
