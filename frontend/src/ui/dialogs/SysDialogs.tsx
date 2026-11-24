// Preferences, shortcuts, about, sync, prompt, page setup, note, document info, signature, tour, present.

import { useEffect, useRef, useState } from 'react';
import { Dialog, Field, NumInput, Seg, Slider, Switch } from '../common';
import { Icon } from '../icons';
import { ColorButton } from '../ColorPicker';
import type { Editor } from '../../editor/editor';
import { prefs, ThemeName } from '../../app/store';
import { commands, eventToKeys, formatKeys, keysFor } from '../../app/commands';
import { syncEngine } from '../../sync/engine';
import { FolderProvider } from '../../sync/providers';
import { AccountPanel } from './AccountPanel';
import { checkSession } from '../../app/account';
import type { SyncConfig } from '../../sync/types';
import { PromptPayload, bus, toast, confirmThen } from '../../app/bus';
import { TEMPLATES, makeTemplate, drawTemplate } from '../../core/templates';
import { setPageBackground } from '../../editor/pageOps';
import { findObject, Units } from '../../core/model';
import { updateObjects } from '../../editor/objectOps';
import { formatBytes, timeAgo, createCanvas, ctx2d, canvasToBlob } from '../../core/util';
import { storageEstimate, persistStorage } from '../../app/storage';
import { createNotebook, createDrawing } from '../../app/actions';
import { placeImageBlob } from '../../editor/rasterOps';

// ---------------------------------------------------------------- generic prompt
export function PromptDialog({ p, onClose }: { p: PromptPayload; onClose: () => void }) {
  const [v, setV] = useState<Record<string, any>>(() => Object.fromEntries(p.fields.map((f) => [f.key, f.value])));
  const submit = () => { onClose(); p.ok(v); };
  return (
    <Dialog title={p.title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>{p.okLabel ?? 'OK'}</button></>}>
      <div className="col" onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}>
        {p.message && <div style={{ lineHeight: 1.45 }}>{p.message}</div>}
        {p.fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.type === 'text' ? <input autoFocus className="input grow" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} />
              : f.type === 'select' ? <select className="select grow" value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : f.type === 'bool' ? <Switch on={!!v[f.key]} onChange={(x) => setV({ ...v, [f.key]: x })} />
              : <><input className="slider" type="range" min={f.min} max={f.max} step={f.step ?? 1} value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: parseFloat(e.target.value) })} /><NumInput value={v[f.key]} min={f.min} max={f.max} onChange={(x) => setV({ ...v, [f.key]: x })} width={64} /></>}
          </Field>
        ))}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- preferences
export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const p = prefs.use();
  const [est, setEst] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { void storageEstimate().then(setEst); }, []);
  return (
    <Dialog title="Preferences" icon="settings" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Theme"><Seg<ThemeName> value={p.theme} onChange={(v) => prefs.set({ theme: v })} options={[{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'midnight', label: 'Midnight' }, { value: 'light', label: 'Light', icon: 'sun' }]} /></Field>
        <Field label="Author"><input className="input grow" placeholder="Name used in document properties" value={p.authorName} onChange={(e) => prefs.set({ authorName: e.target.value })} /></Field>
        <div className="divider" style={{ margin: 0 }} />
        <b>Pen & touch</b>
        <Switch on={p.penOnly} onChange={(v) => prefs.set({ penOnly: v })} label="Pen-only drawing — fingers pan and zoom (recommended with a stylus)" />
        <Switch on={p.palmRejection} onChange={(v) => prefs.set({ palmRejection: v })} label="Palm rejection — ignore touches while the pen is active" />
        <Slider label="Pressure curve" value={p.pressureGamma} min={0.4} max={2.5} step={0.05} format={(v) => (v < 1 ? 'Softer' : v > 1 ? 'Firmer' : 'Linear') + ` (${v.toFixed(2)})`} onChange={(v) => prefs.set({ pressureGamma: v })} width={380} />
        <div className="hint">Two-finger tap = undo · three-finger tap = redo · pinch to zoom and rotate (Studio) · pen eraser end erases.</div>
        <div className="divider" style={{ margin: 0 }} />
        <b>Documents</b>
        <Switch on={p.autosave} onChange={(v) => prefs.set({ autosave: v })} label="Autosave to the library a few seconds after every change" />
        <Switch on={p.checker} onChange={(v) => prefs.set({ checker: v })} label="Show checkerboard behind transparent areas" />
        <div className="divider" style={{ margin: 0 }} />
        <b>Storage</b>
        <div className="row"><span className="muted">{est ? `${formatBytes(est.used)} used of ${formatBytes(est.quota)} available` : 'Storage estimate unavailable'}</span><span className="spacer" />
          <button className="btn sm" onClick={async () => { await persistStorage(); toast('Requested persistent storage', 'success'); }}>Keep my data (persistent storage)</button></div>
        <div className="row"><button className="btn sm danger" onClick={() => confirmThen('Reset all preferences? Your documents are not affected.', () => prefs.reset(), 'Reset')}>Reset preferences</button></div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- shortcuts
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rebind, setRebind] = useState<string | null>(null);
  const custom = prefs.useSelect((p) => p.customShortcuts);
  useEffect(() => {
    if (!rebind) return;
    const h = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRebind(null); return; }
      const k = eventToKeys(e); if (!k) return;
      prefs.set({ customShortcuts: { ...prefs.get().customShortcuts, [rebind]: k } }); setRebind(null);
    };
    window.addEventListener('keydown', h, true); return () => window.removeEventListener('keydown', h, true);
  }, [rebind]);
  const list = commands.filter((c) => !c.hidden && (keysFor(c.id) || custom[c.id] || q) && (c.label + c.category).toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog title="Keyboard shortcuts" icon="keyboard" size="wide" onClose={onClose} footer={<><button className="btn" onClick={() => prefs.set({ customShortcuts: {} })}>Reset all</button><button className="btn primary" onClick={onClose}>Done</button></>}>
      <input className="input" style={{ width: '100%', marginBottom: 10 }} placeholder="Search commands…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className="hint" style={{ marginBottom: 8 }}>Click a shortcut to change it. Single-letter tool keys (B, E, M, …) are fixed. Hold <span className="kbd">Space</span> to pan, <span className="kbd">Alt</span>-click with a brush to pick colour.</div>
      <table className="keys"><tbody>
        {list.map((c) => (
          <tr key={c.id}><td className="muted" style={{ width: 150 }}>{c.category}</td><td>{c.label}</td>
            <td><button className="btn sm" onClick={() => setRebind(c.id)} style={{ minWidth: 90 }}>{rebind === c.id ? 'Press keys…' : (formatKeys(keysFor(c.id)) || 'none')}</button>
              {custom[c.id] && <button className="btn ghost icon sm" title="Reset" onClick={() => { const n = { ...custom }; delete n[c.id]; prefs.set({ customShortcuts: n }); }}><Icon name="undo" size={12} /></button>}</td></tr>
        ))}
      </tbody></table>
    </Dialog>
  );
}

// ---------------------------------------------------------------- about
export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="About Quarc Draw" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: '8px 0' }}>
        <img src="/logo.png" width={96} style={{ borderRadius: 24 }} alt="" />
        <h2 style={{ margin: 0 }}>Quarc <span style={{ color: 'var(--accent)' }}>Draw</span></h2>
        <div className="muted">Version 1.0 · by QuarcNet</div>
        <p className="muted" style={{ maxWidth: 440 }}>A layered raster + vector studio with notebook and PDF-reader modes. Local-first: everything works offline and syncs through your Quarc account, a folder or WebDAV.</p>
        <div className="hint">Built with open-source libraries: React, pdf.js, pdf-lib, JSZip, ag-psd, perfect-freehand, paper.js, gifenc.</div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- sync
export function SyncDialog({ onClose }: { onClose: () => void }) {
  const cfg = syncEngine.config.use();
  const st = syncEngine.status.use();
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<SyncConfig>) => syncEngine.config.set(p);
  const connect = async () => { setBusy(true); try { const ok = await syncEngine.start(); if (ok) toast('Sync connected', 'success'); } finally { setBusy(false); } };
  const providers: { id: SyncConfig['provider']; label: string; icon: string; desc: string }[] = [
    { id: 'none', label: 'Off', icon: 'cloud-off', desc: 'Keep everything on this device.' },
    { id: 'folder', label: 'Folder', icon: 'folder', desc: 'Any folder — Proton Drive, Dropbox, OneDrive, Syncthing…' },
    { id: 'server', label: 'Quarc account', icon: 'cloud', desc: 'Your Quarc server, live updates on every device.' },
    { id: 'webdav', label: 'WebDAV', icon: 'sync', desc: 'Nextcloud, ownCloud, any WebDAV share.' },
    { id: 'dropbox', label: 'Dropbox', icon: 'upload', desc: 'Using an access token.' },
  ];
  return (
    <Dialog title="Sync" icon="cloud" size="wide" onClose={onClose} footer={<>
      <span className="muted" style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}><span className={`sync-dot ${st.state}`} />{st.state === 'off' ? 'Not connected' : st.state === 'idle' ? `Connected · ${st.label}${st.lastSync ? ` · synced ${timeAgo(st.lastSync)}` : ''}` : st.state === 'syncing' ? 'Syncing…' : st.message}</span>
      <button className="btn" disabled={!syncEngine.connected} onClick={() => void syncEngine.syncAll(true)}><Icon name="sync" size={14} className={st.state === 'syncing' ? 'spin' : ''} />Sync now</button>
      <button className="btn primary" onClick={onClose}>Done</button></>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="hint">Quarc Draw is local-first: documents always save on this device. Choose where to keep a synchronised copy. Conflicts never lose work — both versions are kept.</div>
        <div className="preset-grid">{providers.map((p) => <button key={p.id} className={`preset ${cfg.provider === p.id ? 'on' : ''}`} onClick={() => { set({ provider: p.id, ...(p.id === 'none' ? { accountAuto: false } : {}) }); if (p.id === 'none') { syncEngine.stop(); syncEngine.status.set({ state: 'off', label: '', message: '' }); } else if (p.id === 'server') { void checkSession(); } }}><div className="row"><Icon name={p.icon} size={16} /><b>{p.label}</b></div><div className="sz">{p.desc}</div></button>)}</div>

        {cfg.provider === 'folder' && (
          <div className="col">
            {!FolderProvider.supported() && <div className="badge warn">Folder sync needs Chrome, Edge or another Chromium browser.</div>}
            <div className="hint">Pick a folder that your desktop sync client (Proton Drive, Dropbox, OneDrive, Google Drive, Syncthing…) already keeps in sync. Each document becomes a <span className="kbd">.qdraw</span> file there.</div>
            <div className="row"><button className="btn" disabled={!FolderProvider.supported()} onClick={async () => { try { const n = await FolderProvider.pick(); set({ folderName: n }); await connect(); } catch { /* cancelled */ } }}><Icon name="folder" size={14} />{cfg.folderName ? 'Change folder…' : 'Choose folder…'}</button>{cfg.folderName && <span className="muted">📁 {cfg.folderName}</span>}
              {cfg.folderName && <button className="btn" disabled={busy} onClick={connect}>Reconnect</button>}</div>
          </div>
        )}
        {cfg.provider === 'server' && <AccountPanel busy={busy} connect={connect} />}
        {cfg.provider === 'webdav' && (
          <div className="col">
            <Field label="WebDAV URL"><input className="input grow" value={cfg.webdav.url} onChange={(e) => set({ webdav: { ...cfg.webdav, url: e.target.value } })} placeholder="https://cloud.example.com/remote.php/dav/files/me/QuarcDraw/" /></Field>
            <Field label="Username"><input className="input grow" value={cfg.webdav.user} onChange={(e) => set({ webdav: { ...cfg.webdav, user: e.target.value } })} /></Field>
            <Field label="Password"><input className="input grow" type="password" value={cfg.webdav.pass} onChange={(e) => set({ webdav: { ...cfg.webdav, pass: e.target.value } })} /></Field>
            <div className="hint">The server must allow cross-origin requests (CORS) from this app. Use an app-password rather than your main password.</div>
            <div><button className="btn primary" disabled={busy || !cfg.webdav.url} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button></div>
          </div>
        )}
        {cfg.provider === 'dropbox' && (
          <div className="col">
            <Field label="Access token"><input className="input grow" type="password" value={cfg.dropbox.token} onChange={(e) => set({ dropbox: { ...cfg.dropbox, token: e.target.value } })} /></Field>
            <Field label="Folder"><input className="input grow" value={cfg.dropbox.folder} onChange={(e) => set({ dropbox: { ...cfg.dropbox, folder: e.target.value } })} /></Field>
            <div className="hint">Create an app at dropbox.com/developers, grant files.content.read/write, generate an access token and paste it here.</div>
            <div><button className="btn primary" disabled={busy || !cfg.dropbox.token} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button></div>
          </div>
        )}
        {cfg.provider !== 'none' && (<>
          <div className="divider" style={{ margin: 0 }} />
          <div className="row wrap" style={{ gap: 18 }}>
            <Switch on={cfg.auto} onChange={(v) => { set({ auto: v }); void connect(); }} label="Sync automatically in the background" />
            <Field label="Every"><NumInput value={cfg.intervalSec} min={15} max={3600} onChange={(v) => set({ intervalSec: v })} width={60} decimals={0} suffix="s" /></Field>
            <Field label="This device"><input className="input" value={cfg.deviceName} onChange={(e) => set({ deviceName: e.target.value })} /></Field>
          </div>
          {st.progress && <div className="progress"><div style={{ width: `${(st.progress.done / Math.max(1, st.progress.total)) * 100}%` }} /></div>}
          {st.log.length > 0 && <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 11.5, color: 'var(--text-dim)', background: 'var(--input)', borderRadius: 8, padding: 8 }}>{st.log.map((l, i) => <div key={i}><span className="hint">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}</div>)}</div>}
        </>)}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- page setup
export function PageSetupDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const pg = ed.page, bg = pg.background;
  const [all, setAll] = useState(false);
  const [tplIdx, setTplIdx] = useState(() => (bg.template ? TEMPLATES.findIndex((t) => t.kind === bg.template!.kind && t.spacing === bg.template!.spacing) : -1));
  const [color, setColor] = useState<string>(bg.color ?? '#ffffff');
  const [transparent, setTransparent] = useState(bg.color === null);
  const [spacing, setSpacing] = useState(bg.template?.spacing ?? 40);
  const [lineColor, setLineColor] = useState(bg.template?.color ?? '#9ec5e8');
  const preview = useRef<HTMLCanvasElement>(null);
  const tpl = tplIdx >= 0 ? { ...makeTemplate(TEMPLATES[tplIdx]), spacing, color: lineColor } : null;
  useEffect(() => { const c = preview.current!, x = c.getContext('2d')!; x.clearRect(0, 0, c.width, c.height); x.fillStyle = transparent ? '#cfd3d8' : color; x.fillRect(0, 0, c.width, c.height); if (tpl) { const k = c.width / pg.width; x.save(); x.scale(k, k); drawTemplate(x, tpl, pg.width, pg.height, k); x.restore(); } });
  return (
    <Dialog title="Page background & template" icon="page" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { setPageBackground(ed, { color: transparent ? null : color, template: tpl }, all); onClose(); }}>Apply</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr', gap: 18 }}>
        <canvas ref={preview} width={170} height={Math.round((170 * pg.height) / pg.width)} style={{ borderRadius: 4, boxShadow: '0 2px 10px #0006', alignSelf: 'start' }} />
        <div className="col">
          <Field label="Paper"><ColorButton color={color} alpha={false} onChange={setColor} />{['#ffffff', '#fffdf8', '#f6f1e4', '#eaf3ff', '#2b2d33', '#111111'].map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => { setColor(c); setTransparent(false); }} />)}<Switch on={transparent} onChange={setTransparent} label="Transparent" /></Field>
          <Field label="Template"><select className="select grow" value={tplIdx} onChange={(e) => { const i = parseInt(e.target.value); setTplIdx(i); if (i >= 0) { setSpacing(TEMPLATES[i].spacing); setLineColor(TEMPLATES[i].color); } }}><option value={-1}>None</option>{TEMPLATES.map((t, i) => <option key={i} value={i}>{t.label}</option>)}</select></Field>
          {tpl && <><Slider label="Spacing" value={spacing} min={8} max={140} format={(v) => `${v}px`} onChange={setSpacing} /><Field label="Line colour"><ColorButton color={lineColor} onChange={setLineColor} /></Field></>}
          {ed.doc.pages.length > 1 && <Switch on={all} onChange={setAll} label="Apply to all pages" />}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- note editor
export function NoteDialog({ ed, objId, onClose }: { ed: Editor; objId: string; onClose: () => void }) {
  const f = findObject(ed.page, objId);
  const [text, setText] = useState(f?.obj.type === 'note' ? f.obj.text : '');
  if (!f || f.obj.type !== 'note') return null;
  const save = () => { updateObjects(ed, [objId], (o) => (o.type === 'note' ? { ...o, text } : o), 'Edit note'); onClose(); };
  return (
    <Dialog title="Sticky note" icon="note" onClose={onClose} footer={<><button className="btn danger" style={{ marginRight: 'auto' }} onClick={() => { import('../../editor/objectOps').then((m) => m.deleteObjects(ed, [objId])); onClose(); }}>Delete</button><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <textarea autoFocus className="input" rows={7} style={{ width: '100%', background: f.obj.color, color: '#222' }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); }} />
    </Dialog>
  );
}

// ---------------------------------------------------------------- document info
export function DocInfoDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const d = ed.doc;
  const [title, setTitle] = useState(d.title), [dpi, setDpi] = useState(d.dpi), [units, setUnits] = useState<Units>(d.units), [author, setAuthor] = useState(d.author || prefs.get().authorName);
  const px = d.pages.reduce((s, p) => s + p.width * p.height, 0);
  return (
    <Dialog title="Document properties" icon="file" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { d.title = title || 'Untitled'; d.dpi = dpi; d.units = units; d.author = author; ed.changed('doc', 'view'); ed.history.revision++; ed.history.events.emit('change', undefined); onClose(); }}>Save</button></>}>
      <div className="col">
        <Field label="Title"><input className="input grow" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Author"><input className="input grow" value={author} onChange={(e) => setAuthor(e.target.value)} /></Field>
        <Field label="Resolution"><NumInput value={dpi} min={30} max={1200} onChange={setDpi} width={70} decimals={0} suffix="dpi" /></Field>
        <Field label="Ruler units"><select className="select" value={units} onChange={(e) => setUnits(e.target.value as Units)}><option value="px">Pixels</option><option value="in">Inches</option><option value="cm">Centimetres</option><option value="mm">Millimetres</option><option value="pt">Points</option></select></Field>
        <dl className="kv" style={{ marginTop: 8 }}><dt>Type</dt><dd>{d.kind}</dd><dt>Pages</dt><dd>{d.pages.length}</dd><dt>Total pixels</dt><dd>{(px / 1e6).toFixed(1)} MP</dd><dt>Assets</dt><dd>{d.assets.size}</dd><dt>Created</dt><dd>{new Date(d.created).toLocaleString()}</dd><dt>Modified</dt><dd>{new Date(d.modified).toLocaleString()}</dd><dt>Id</dt><dd style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.id}</dd></dl>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- signature pad
export function SignatureDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pts = useRef<{ x: number; y: number; p: number }[][]>([]);
  const [empty, setEmpty] = useState(true);
  const [ink, setInk] = useState('#10223d');
  const redraw = () => {
    const c = ref.current!, x = c.getContext('2d')!; x.clearRect(0, 0, c.width, c.height);
    x.strokeStyle = ink; x.lineCap = 'round'; x.lineJoin = 'round';
    for (const s of pts.current) for (let i = 1; i < s.length; i++) { x.lineWidth = 2 + s[i].p * 3; x.beginPath(); x.moveTo(s[i - 1].x, s[i - 1].y); x.lineTo(s[i].x, s[i].y); x.stroke(); }
  };
  useEffect(redraw, [ink]);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * 560, y: ((e.clientY - r.top) / r.height) * 200, p: e.pointerType === 'mouse' ? 0.5 : e.pressure }; };
  const save = async () => {
    const c = ref.current!; const x = c.getContext('2d')!; const d = x.getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3]) { x0 = Math.min(x0, xx); x1 = Math.max(x1, xx); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const t = createCanvas(x1 - x0 + 12, y1 - y0 + 12); ctx2d(t).drawImage(c, -x0 + 6, -y0 + 6);
    const url = t.toDataURL('image/png');
    prefs.set({ signatures: [...prefs.get().signatures, url].slice(-8) });
    toast('Signature saved — find it under Libraries ▸ More', 'success'); onClose();
    void canvasToBlob;
  };
  return (
    <Dialog title="Create signature" icon="signature" onClose={onClose} footer={<><button className="btn" onClick={() => { pts.current = []; setEmpty(true); redraw(); }}>Clear</button><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={empty} onClick={save}>Save</button></>}>
      <div className="col"><canvas ref={ref} width={560} height={200} style={{ width: '100%', background: '#fff', borderRadius: 10, touchAction: 'none', cursor: 'crosshair', border: '1px solid var(--line-hi)' }}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.push([pos(e)]); setEmpty(false); }}
        onPointerMove={(e) => { if (e.buttons && pts.current.length) { pts.current[pts.current.length - 1].push(pos(e)); redraw(); } }} />
        <div className="row"><span className="hint">Sign with your mouse, finger or pen.</span><span className="spacer" />{['#10223d', '#000000', '#1b4ed8', '#7c1d1d'].map((c) => <button key={c} className="swatch" style={{ background: c, outline: ink === c ? '2px solid var(--accent)' : undefined }} onClick={() => setInk(c)} />)}</div></div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- welcome tour
export function TourDialog({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const steps = [
    { icon: 'palette', title: 'Studio', body: 'A full painting & vector studio: layers with blend modes, masks and effects, pressure-sensitive brushes, selections, filters, adjustment layers, symmetry and perspective guides.' },
    { icon: 'page', title: 'Notes', body: 'Handwrite on lined, grid, dotted or music paper. Ink is vector, so you can erase whole strokes, lasso and move things, snap shapes by holding still, and zoom endlessly. Add pages, text, sticky notes and images.' },
    { icon: 'file', title: 'Reader', body: 'Open any PDF, search its text, highlight, underline, add notes and signatures, then export it with your marks inside the original PDF.' },
    { icon: 'cloud', title: 'Everything syncs', body: 'Documents save locally first and work offline. Sync through your Quarc account, any folder (Proton Drive, Dropbox, OneDrive…) or WebDAV — File ▸ Sync settings.' },
    { icon: 'keyboard', title: 'Pro tips', body: 'Ctrl+K opens the command palette · Space-drag pans · Alt-click with a brush picks colour · [ and ] resize the brush · two-finger tap undoes · F1 shows all shortcuts.' },
  ];
  const s = steps[i];
  return (
    <Dialog title="Welcome to Quarc Draw" onClose={onClose} footer={<><span className="hint" style={{ marginRight: 'auto' }}>{i + 1} / {steps.length}</span>{i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}{i < steps.length - 1 ? <button className="btn primary" onClick={() => setI(i + 1)}>Next</button> : <button className="btn primary" onClick={onClose}>Start creating</button>}</>}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 10, padding: '14px 0' }}>
        <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--accent-bg)', display: 'grid', placeItems: 'center', color: 'var(--accent-hi)' }}><Icon name={s.icon} size={36} /></div>
        <h2 style={{ margin: 0 }}>{s.title}</h2><p className="muted" style={{ maxWidth: 420, lineHeight: 1.55, margin: 0 }}>{s.body}</p>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- present
export function PresentDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const [from, setFrom] = useState(ed.pageIndex + 1);
  return (
    <Dialog title="Present" icon="present" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { ed.presentation = true; ed.goToPage(from - 1); ed.setTool('laser'); ed.changed('status'); onClose(); void document.documentElement.requestFullscreen?.().catch(() => undefined); bus.emit('workspace', { name: prefs.get().workspace }); }}>Start</button></>}>
      <div className="col"><div className="hint">Full-screen presentation with a laser pointer. Press Esc to exit; use ← → or Page Up/Down to change pages.</div>
        <Field label="Start at page"><NumInput value={from} min={1} max={ed.doc.pages.length} onChange={setFrom} decimals={0} width={64} /></Field></div>
    </Dialog>
  );
}
void createNotebook; void createDrawing; void placeImageBlob;
