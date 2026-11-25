// Preferences, shortcuts, about, sync, prompt, page setup, document info, tour.

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
import { setPageBackground } from '../../editor/pageOps';
import { Units } from '../../core/model';
import { formatBytes, timeAgo, createCanvas, ctx2d, canvasToBlob } from '../../core/util';
import { storageEstimate, persistStorage } from '../../app/storage';
import { useCurrentPainting } from '../paintings';
import { PaintingViewer } from '../PaintingViewer';

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
        <div className="hint">Two-finger tap = undo · three-finger tap = redo · pinch to zoom and rotate · pen eraser end erases.</div>
        <div className="divider" style={{ margin: 0 }} />
        <b>Documents</b>
        <Switch on={p.autosave} onChange={(v) => prefs.set({ autosave: v })} label="Autosave to the library a few seconds after every change" />
        <Switch on={p.checker} onChange={(v) => prefs.set({ checker: v })} label="Show checkerboard behind transparent areas" />
        <Switch on={!p.hideHero} onChange={(v) => prefs.set({ hideHero: !v })} label="Show a painting on the home screen" />
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
  const [index, painting, pick] = useCurrentPainting();
  const [viewing, setViewing] = useState(false);
  return (
    <Dialog title="About Quarc Draw" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <div className="col" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: '0 0 8px' }}>
        <div className="about-art" title={`“${painting.title}” — oil, painted in Quarc Draw · tap to see it whole`} onClick={() => setViewing(true)}><img src={painting.src} style={{ objectPosition: painting.pos }} alt="" draggable={false} onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} /></div>
        <img src="/logo.png" width={72} style={{ borderRadius: 20, marginTop: -44, border: '4px solid var(--bg-2)', background: 'var(--bg-2)', position: 'relative' }} alt="" />
        <h2 style={{ margin: 0 }}>Quarc <span style={{ color: 'var(--accent)' }}>Draw</span></h2>
        <div className="muted">Version {__APP_VERSION__} · by QuarcNet</div>
        <p className="muted" style={{ maxWidth: 440 }}>A professional layered raster + vector drawing studio. Local-first: everything works offline and syncs through your Quarc account, a folder or WebDAV.</p>
        <div className="hint">Built with open-source libraries: React, pdf-lib, JSZip, ag-psd, paper.js, gifenc.</div>
      </div>
      {viewing && <PaintingViewer index={index} onIndex={pick} onClose={() => setViewing(false)} />}
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
  const [color, setColor] = useState<string>(bg.color ?? '#ffffff');
  const [transparent, setTransparent] = useState(bg.color === null);
  return (
    <Dialog title="Page background" icon="page" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { setPageBackground(ed, { color: transparent ? null : color }, all); onClose(); }}>Apply</button></>}>
      <div className="col">
        <Field label="Paper"><ColorButton color={color} alpha={false} onChange={setColor} />{['#ffffff', '#fffdf8', '#f6f1e4', '#eaf3ff', '#2b2d33', '#111111'].map((c) => <button key={c} className="swatch" style={{ background: c }} onClick={() => { setColor(c); setTransparent(false); }} />)}<Switch on={transparent} onChange={setTransparent} label="Transparent" /></Field>
        {ed.doc.pages.length > 1 && <Switch on={all} onChange={setAll} label="Apply to all pages" />}
      </div>
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
        <dl className="kv" style={{ marginTop: 8 }}><dt>Pages</dt><dd>{d.pages.length}</dd><dt>Total pixels</dt><dd>{(px / 1e6).toFixed(1)} MP</dd><dt>Assets</dt><dd>{d.assets.size}</dd><dt>Created</dt><dd>{new Date(d.created).toLocaleString()}</dd><dt>Modified</dt><dd>{new Date(d.modified).toLocaleString()}</dd><dt>Id</dt><dd style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{d.id}</dd></dl>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- welcome tour
export function TourDialog({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const steps = [
    { icon: 'palette', title: 'Paint', body: 'Pressure-sensitive brushes with grain, wet mixing and symmetry; smudge, blur, dodge, burn and clone tools; layers with blend modes, masks and clipping.' },
    { icon: 'layers', title: 'Layers, selections & effects', body: 'Pixel, vector, group and adjustment layers. Marquee, lasso and magic-wand selections, live filters, drop shadows, glows and strokes — all non-destructive where it matters.' },
    { icon: 'pen-nib', title: 'Vector shapes & text', body: 'Bezier pen, shapes, text and node editing on vector layers, plus perspective and symmetry guides to keep your drawing on track.' },
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

void toast; void bus; void confirmThen; void formatBytes; void timeAgo; void createCanvas; void ctx2d; void canvasToBlob; void useRef; void useEffect;
