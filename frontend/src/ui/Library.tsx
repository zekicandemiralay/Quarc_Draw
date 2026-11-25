// Documents library (home screen): folders, favourites, tags, search, trash.

import { useEffect, useMemo, useState } from 'react';
import { LibraryMeta, getBlob, getFolders, libraryEvents, listLibrary, patchMeta, putRecord, setFolders, saveEditor } from '../app/storage';
import { workspace } from '../app/workspace';
import { openFileDialog, openFiles, openFromLibrary } from '../app/actions';
import { parseDoc, peekMeta, serializeDoc } from '../io/qdraw';
import { Icon } from './icons';
import { PopButton, MenuList } from './common';
import { openDialog, toast, confirmThen } from '../app/bus';
import { downloadBlob, formatBytes, sanitizeFilename, timeAgo, uid } from '../core/util';
import { syncEngine } from '../sync/engine';
import { prefs } from '../app/store';

type Filter = { kind: 'all' } | { kind: 'recent' } | { kind: 'star' } | { kind: 'folder'; name: string } | { kind: 'tag'; tag: string } | { kind: 'trash' };

/** change library-level properties (title, folder, tags, star) – rewrites the stored document so sync stays consistent */
export async function updateDocProps(id: string, patch: Partial<Pick<LibraryMeta, 'title' | 'folder' | 'tags' | 'starred'>>) {
  const open = workspace.editors.find((e) => e.doc.id === id);
  if (open) {
    Object.assign(open.doc, patch);
    open.changed('doc', 'status');
    await saveEditor(open);
    return;
  }
  const blob = await getBlob(id);
  if (!blob) return;
  const doc = await parseDoc(blob);
  Object.assign(doc, patch);
  const nb = await serializeDoc(doc);
  const m = await peekMeta(nb);
  const old = (await listLibrary()).find((x) => x.id === id);
  await putRecord({ ...(old as LibraryMeta), title: doc.title, folder: doc.folder, tags: doc.tags, starred: doc.starred, bytes: nb.size, thumb: m.thumb ?? old?.thumb ?? null, modified: Date.now(), syncDirty: true }, nb);
}

export async function duplicateDoc(id: string) {
  const blob = await getBlob(id); if (!blob) return;
  const doc = await parseDoc(blob);
  doc.id = uid('doc'); doc.title += ' copy'; doc.created = Date.now();
  const nb = await serializeDoc(doc); const m = await peekMeta(nb);
  await putRecord({ id: doc.id, title: doc.title, created: doc.created, modified: Date.now(), pages: m.pages, bytes: nb.size, thumb: m.thumb, folder: doc.folder, tags: doc.tags, starred: false, trashed: 0, syncDirty: true }, nb);
  toast('Duplicated', 'success');
}

/** The opening picture: an oil painting made in Quarc Draw itself (see scripts/paint-artwork.mjs). Shown on the home screen only. */
export const HERO_SRC = '/art/harbour-at-dusk.webp';
function Hero() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="hero">
      <img src={HERO_SRC} alt="" draggable={false} onError={() => setOk(false)} />
      <div className="txt"><h1>Quarc <b>Draw</b></h1><p>Layers, oil brushes and vector shapes — draw anywhere, in sync everywhere.</p></div>
      <div className="credit">“Harbour at Dusk” — oil, painted in Quarc Draw</div>
      <button className="btn ghost icon sm x" title="Hide this picture (Preferences brings it back)" onClick={() => prefs.set({ hideHero: true })}><Icon name="close" size={14} /></button>
    </div>
  );
}

function Cover({ m }: { m: LibraryMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { if (!m.thumb) return; const u = URL.createObjectURL(m.thumb); setUrl(u); return () => URL.revokeObjectURL(u); }, [m.thumb, m.modified]);
  return <div className="cover">{url ? <img src={url} alt="" /> : <Icon name="palette" size={44} style={{ opacity: 0.3 }} />}</div>;
}

export function Library({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<LibraryMeta[]>([]);
  const [folders, setFolderList] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'modified' | 'title' | 'created' | 'size'>('modified');
  const hideHero = prefs.useSelect((p) => p.hideHero);
  const reload = async () => { setItems(await listLibrary()); setFolderList(await getFolders()); };
  useEffect(() => { void reload(); return libraryEvents.on('change', () => void reload()); }, []);

  const tags = useMemo(() => [...new Set(items.filter((i) => !i.trashed).flatMap((i) => i.tags))].sort(), [items]);
  const shown = useMemo(() => {
    let l = items.filter((i) => (filter.kind === 'trash' ? i.trashed : !i.trashed));
    switch (filter.kind) {
      case 'star': l = l.filter((i) => i.starred); break;
      case 'folder': l = l.filter((i) => i.folder === filter.name); break;
      case 'tag': l = l.filter((i) => i.tags.includes(filter.tag)); break;
      case 'recent': l = l.slice(0, 12); break;
    }
    if (q.trim()) { const s = q.toLowerCase(); l = l.filter((i) => i.title.toLowerCase().includes(s) || i.tags.some((t) => t.toLowerCase().includes(s))); }
    return [...l].sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'size' ? b.bytes - a.bytes : sort === 'created' ? b.created - a.created : b.modified - a.modified);
  }, [items, filter, q, sort]);

  const open = async (m: LibraryMeta) => { await openFromLibrary(m.id); onClose(); };
  const isOn = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  const Side = ({ f, icon, label, count }: { f: Filter; icon: string; label: string; count?: number }) => <button className={`item ${isOn(f) ? 'on' : ''}`} onClick={() => setFilter(f)}><Icon name={icon} size={16} />{label}{count !== undefined && <span className="hint" style={{ marginLeft: 'auto' }}>{count}</span>}</button>;
  const live = items.filter((i) => !i.trashed);
  const trashed = items.filter((i) => i.trashed);

  const menuFor = (m: LibraryMeta) => m.trashed ? [
    { label: 'Restore', onClick: () => void patchMeta(m.id, { trashed: 0, syncDirty: true }) },
    { label: 'Delete permanently', onClick: () => confirmThen(`Permanently delete “${m.title}”? This also deletes it from your synced storage.`, () => void syncEngine.deleteEverywhere(m.id), 'Delete permanently') },
  ] : [
    { label: 'Open', onClick: () => void open(m) },
    { label: 'Rename…', onClick: () => openDialog('prompt', { title: 'Rename document', fields: [{ key: 'name', label: 'Name', type: 'text', value: m.title }], ok: (v: any) => v.name.trim() && updateDocProps(m.id, { title: v.name.trim() }) }) },
    { label: m.starred ? 'Remove from favourites' : 'Add to favourites', onClick: () => void updateDocProps(m.id, { starred: !m.starred }) },
    { label: 'Duplicate', onClick: () => void duplicateDoc(m.id) },
    { label: 'Move to folder', children: [{ label: 'No folder', onClick: () => void updateDocProps(m.id, { folder: null }) }, ...folders.map((f) => ({ label: f, onClick: () => void updateDocProps(m.id, { folder: f }) }))] },
    { label: 'Edit tags…', onClick: () => openDialog('prompt', { title: 'Tags', fields: [{ key: 'tags', label: 'Comma separated', type: 'text', value: m.tags.join(', ') }], ok: (v: any) => updateDocProps(m.id, { tags: String(v.tags).split(',').map((t: string) => t.trim()).filter(Boolean) }) }) },
    { label: 'Download .qdraw', onClick: async () => { const b = await getBlob(m.id); if (b) downloadBlob(b, `${sanitizeFilename(m.title)}.qdraw`); } },
    { separator: true },
    { label: 'Move to trash', onClick: () => void patchMeta(m.id, { trashed: Date.now(), syncDirty: true }) },
  ];

  return (
    <div className="library"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); if (fs.length) { void openFiles(fs); onClose(); } }}>
      <div className="lib-side">
        <div className="brand" style={{ padding: '2px 10px 12px' }}><img src="/logo.png" alt="" /><span>Quarc <b>Draw</b></span></div>
        <Side f={{ kind: 'all' }} icon="library" label="All documents" count={live.length} />
        <Side f={{ kind: 'recent' }} icon="history" label="Recent" />
        <Side f={{ kind: 'star' }} icon="star2" label="Favourites" count={live.filter((i) => i.starred).length} />
        <h4>Folders <button className="btn ghost icon sm" style={{ float: 'right', marginTop: -4 }} title="New folder" onClick={() => openDialog('prompt', { title: 'New folder', fields: [{ key: 'name', label: 'Name', type: 'text', value: '' }], ok: (v: any) => v.name.trim() && setFolders([...new Set([...folders, v.name.trim()])]) })}><Icon name="plus" size={13} /></button></h4>
        {folders.map((f) => <Side key={f} f={{ kind: 'folder', name: f }} icon="folder" label={f} count={live.filter((i) => i.folder === f).length} />)}
        {tags.length > 0 && <h4>Tags</h4>}
        {tags.map((t) => <Side key={t} f={{ kind: 'tag', tag: t }} icon="tag" label={t} />)}
        <div style={{ flex: 1 }} />
        <Side f={{ kind: 'trash' }} icon="trash" label="Trash" count={trashed.length} />
      </div>
      <div className="lib-main">
        <div className="lib-top">
          <h2>{filter.kind === 'all' ? 'All documents' : filter.kind === 'recent' ? 'Recent' : filter.kind === 'star' ? 'Favourites' : filter.kind === 'trash' ? 'Trash' : filter.kind === 'folder' ? filter.name : `#${filter.tag}`}</h2>
          <div className="spacer" />
          <div style={{ position: 'relative' }}><input className="input" style={{ paddingLeft: 28, width: 220 }} placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /><span style={{ position: 'absolute', left: 8, top: 7, color: 'var(--text-faint)' }}><Icon name="search" size={14} /></span></div>
          <select className="select" value={sort} onChange={(e) => setSort(e.target.value as any)}><option value="modified">Last modified</option><option value="created">Created</option><option value="title">Name</option><option value="size">Size</option></select>
          {filter.kind === 'trash' && trashed.length > 0 && <button className="btn danger" onClick={() => confirmThen('Permanently delete everything in the trash? This also deletes it from your synced storage.', () => trashed.forEach((m) => void syncEngine.deleteEverywhere(m.id)), 'Empty trash')}>Empty trash</button>}
          <button className="btn" onClick={() => void openFileDialog().then(onClose)}><Icon name="upload" size={15} />Import</button>
          <button className="btn primary" onClick={() => openDialog('new')}><Icon name="plus" size={15} />New</button>
          {workspace.editors.length > 0 && <button className="btn ghost icon" title="Back to canvas" onClick={onClose}><Icon name="close" size={16} /></button>}
        </div>
        {filter.kind === 'all' && !q.trim() && !hideHero && <Hero />}
        <div className="lib-grid">
          {filter.kind !== 'trash' && <div className="new-tile" onClick={() => openDialog('new')}><div className="col" style={{ alignItems: 'center', gap: 6 }}><Icon name="file-plus" size={34} />Create new</div></div>}
          {shown.map((m) => (
            <div key={m.id} className="doc-card" onClick={() => !m.trashed && void open(m)} onContextMenu={(e) => e.preventDefault()}>
              <Cover m={m} />
              <button className={`star ${m.starred ? 'on' : ''}`} title="Favourite" onClick={(e) => { e.stopPropagation(); void updateDocProps(m.id, { starred: !m.starred }); }}><Icon name="star2" size={15} /></button>
              <div className="info">
                <div className="row"><div className="t" style={{ flex: 1 }} title={m.title}>{m.title}</div>
                  <span onClick={(e) => e.stopPropagation()}><PopButton className="btn ghost icon sm" title="More" align="end" content={(close) => <MenuList ed={null} onDone={close} items={menuFor(m)} />}><Icon name="more" size={15} /></PopButton></span></div>
                <div className="m"><span>{timeAgo(m.modified)}</span><span>·</span><span>{m.pages} page{m.pages === 1 ? '' : 's'}</span><span>·</span><span>{formatBytes(m.bytes)}</span>{m.syncDirty && <span title="Waiting to sync" style={{ color: 'var(--warn)' }}>●</span>}</div>
              </div>
            </div>
          ))}
          {!shown.length && filter.kind !== 'all' && <div className="empty">Nothing here yet.</div>}
        </div>
      </div>
    </div>
  );
}
