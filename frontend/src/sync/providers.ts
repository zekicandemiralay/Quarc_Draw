// Sync providers: local folder (File System Access API), WebDAV, Quarc sync server, Dropbox.

import { AuthError, ConflictError, RemoteEntry, RemoteFile, SyncProvider } from './types';
import { kvGet, kvSet } from '../app/storage';
import { peekMeta } from '../io/qdraw';
import { sanitizeFilename } from '../core/util';
import { API_BASE } from '../lib/apiUrl';

const EXT = '.qdraw';

// ------------------------------------------------------------------ local folder
// Works with any folder synced by a desktop client (Proton Drive, Dropbox, OneDrive, Google Drive, Syncthing…).
export class FolderProvider implements SyncProvider {
  readonly kind = 'folder' as const;
  label = 'Local folder';
  private dir: any = null;
  private names = new Map<string, string>(); // doc id → file name

  static supported() { return typeof (window as any).showDirectoryPicker === 'function'; }

  /** show the folder picker and remember the handle */
  static async pick(): Promise<string> {
    const h = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'quarc-sync' });
    await kvSet('sync.folderHandle', h);
    return h.name as string;
  }
  async connect() {
    const h = await kvGet<any>('sync.folderHandle');
    if (!h) throw new Error('No sync folder selected');
    let perm = await h.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await h.requestPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') throw new AuthError('Permission to the sync folder was not granted');
    this.dir = h; this.label = `Folder “${h.name}”`;
  }
  private idOf(name: string): string | null {
    const m = name.match(/__([A-Za-z0-9_]+)\.qdraw$/);
    return m ? m[1] : null;
  }
  async list(): Promise<RemoteEntry[]> {
    const out: RemoteEntry[] = [];
    this.names.clear();
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith(EXT)) continue;
      const f: File = await handle.getFile();
      let id = this.idOf(name);
      let title = name.replace(/__[A-Za-z0-9_]+\.qdraw$/, '').replace(/\.qdraw$/, '');
      if (!id) { // foreign file dropped into the folder: read its id
        try { const m = await peekMeta(f); id = m.id; title = m.title; } catch { continue; }
      }
      this.names.set(id, name);
      out.push({ id, title, modified: f.lastModified, rev: `${f.lastModified}-${f.size}`, size: f.size });
    }
    return out;
  }
  async get(id: string): Promise<RemoteFile> {
    const name = this.names.get(id);
    if (!name) throw new Error('File not found in sync folder');
    const f: File = await (await this.dir.getFileHandle(name)).getFile();
    return { blob: f, rev: `${f.lastModified}-${f.size}`, modified: f.lastModified };
  }
  async put(id: string, blob: Blob, meta: { title: string; modified: number; baseRev?: string }) {
    const name = this.names.get(id) ?? `${sanitizeFilename(meta.title)}__${id}${EXT}`;
    if (meta.baseRev && this.names.has(id)) {
      const cur: File = await (await this.dir.getFileHandle(name)).getFile();
      const rev = `${cur.lastModified}-${cur.size}`;
      if (rev !== meta.baseRev) throw new ConflictError(rev);
    }
    // keep the file name in sync with renames
    const wanted = `${sanitizeFilename(meta.title)}__${id}${EXT}`;
    const h = await this.dir.getFileHandle(name === wanted || !this.names.has(id) ? wanted : wanted, { create: true });
    const w = await h.createWritable(); await w.write(blob); await w.close();
    if (name !== wanted && this.names.has(id)) { try { await this.dir.removeEntry(name); } catch { /* ignore */ } }
    this.names.set(id, wanted);
    const f: File = await h.getFile();
    return { rev: `${f.lastModified}-${f.size}` };
  }
  async remove(id: string) {
    const name = this.names.get(id);
    if (name) { try { await this.dir.removeEntry(name); } catch { /* already gone */ } this.names.delete(id); }
  }
}

// ------------------------------------------------------------------ WebDAV
export class WebDAVProvider implements SyncProvider {
  readonly kind = 'webdav' as const;
  label = 'WebDAV';
  constructor(private cfg: { url: string; user: string; pass: string }) {}
  private base() { return this.cfg.url.replace(/\/+$/, '') + '/'; }
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.cfg.user) h.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${this.cfg.user}:${this.cfg.pass}`)));
    return h;
  }
  private url(id: string) { return this.base() + encodeURIComponent(id) + EXT; }
  async connect() {
    if (!this.cfg.url) throw new Error('WebDAV URL is empty');
    const r = await fetch(this.base(), { method: 'PROPFIND', headers: this.headers({ Depth: '0' }) });
    if (r.status === 401 || r.status === 403) throw new AuthError('WebDAV rejected the credentials');
    if (!r.ok && r.status !== 207) throw new Error(`WebDAV server answered ${r.status}`);
    this.label = `WebDAV ${new URL(this.cfg.url).host}`;
  }
  async list(): Promise<RemoteEntry[]> {
    const r = await fetch(this.base(), { method: 'PROPFIND', headers: this.headers({ Depth: '1', 'Content-Type': 'application/xml' }), body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/></d:prop></d:propfind>' });
    if (r.status === 401) throw new AuthError();
    if (r.status === 404) { await fetch(this.base(), { method: 'MKCOL', headers: this.headers() }); return []; }
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const out: RemoteEntry[] = [];
    for (const resp of Array.from(xml.getElementsByTagNameNS('DAV:', 'response'))) {
      const href = decodeURIComponent(resp.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '');
      const name = href.split('/').filter(Boolean).pop() ?? '';
      if (!name.endsWith(EXT)) continue;
      const id = name.slice(0, -EXT.length);
      const lm = resp.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent;
      const etag = resp.getElementsByTagNameNS('DAV:', 'getetag')[0]?.textContent ?? lm ?? '';
      const size = parseInt(resp.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? '0');
      out.push({ id, title: id, modified: lm ? Date.parse(lm) : 0, rev: etag, size });
    }
    return out;
  }
  async get(id: string): Promise<RemoteFile> {
    const r = await fetch(this.url(id), { headers: this.headers() });
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    return { blob: await r.blob(), rev: r.headers.get('ETag') ?? r.headers.get('Last-Modified') ?? '', modified: Date.parse(r.headers.get('Last-Modified') ?? '') || Date.now() };
  }
  async put(id: string, blob: Blob, meta: { title: string; modified: number; baseRev?: string }) {
    const h = this.headers({ 'Content-Type': 'application/octet-stream' });
    if (meta.baseRev) h['If-Match'] = meta.baseRev;
    const r = await fetch(this.url(id), { method: 'PUT', headers: h, body: blob });
    if (r.status === 412) throw new ConflictError(r.headers.get('ETag') ?? '');
    if (r.status === 401) throw new AuthError();
    if (!r.ok) throw new Error(`Upload failed (${r.status})`);
    const head = await fetch(this.url(id), { method: 'HEAD', headers: this.headers() });
    return { rev: r.headers.get('ETag') ?? head.headers.get('ETag') ?? head.headers.get('Last-Modified') ?? String(Date.now()) };
  }
  async remove(id: string) { await fetch(this.url(id), { method: 'DELETE', headers: this.headers() }); }
}

// ------------------------------------------------------------------ Quarc account sync (see /backend)
// Signed in with the shared Quarc login: the "token" cookie, which the browser sends by itself (same origin) or because
// every call says credentials: 'include' (the Android / Windows apps, whose page is not served by the server).
export class QuarcServerProvider implements SyncProvider {
  readonly kind = 'server' as const;
  label = 'Quarc account';
  constructor(private cfg: { url: string }) {}
  private u(p: string) { return (this.cfg.url || API_BASE).replace(/\/+$/, '') + p; }
  private f(path: string, init: RequestInit = {}) { return fetch(this.u(path), { credentials: 'include', ...init }); }
  private signIn() { return new AuthError('Sign in with your Quarc account to sync'); }
  async connect() {
    const r = await this.f('/api/ping');
    if (r.status === 401) throw this.signIn();
    if (!r.ok) throw new Error(`Server answered ${r.status}`);
    const j = await r.json(); this.label = `Quarc account · ${j.user ?? 'signed in'}`;
  }
  async list(): Promise<RemoteEntry[]> {
    const r = await this.f('/api/docs');
    if (r.status === 401) throw this.signIn();
    if (!r.ok) throw new Error(`List failed (${r.status})`);
    return (await r.json()).docs as RemoteEntry[];
  }
  async get(id: string): Promise<RemoteFile> {
    const r = await this.f(`/api/docs/${encodeURIComponent(id)}`);
    if (r.status === 401) throw this.signIn();
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    return { blob: await r.blob(), rev: r.headers.get('X-Rev') ?? '', modified: Number(r.headers.get('X-Modified')) || Date.now() };
  }
  async put(id: string, blob: Blob, meta: { title: string; modified: number; baseRev?: string }) {
    const r = await this.f(`/api/docs/${encodeURIComponent(id)}`, {
      method: 'PUT', body: blob,
      headers: { 'Content-Type': 'application/octet-stream', 'X-Title': encodeURIComponent(meta.title), 'X-Modified': String(meta.modified), ...(meta.baseRev ? { 'X-Base-Rev': meta.baseRev } : {}) },
    });
    if (r.status === 409) throw new ConflictError((await r.json()).rev);
    if (r.status === 401) throw this.signIn();
    if (r.status === 413) throw new Error((await r.json().catch(() => ({}))).error || 'The document is too large for the server');
    if (!r.ok) throw new Error(`Upload failed (${r.status})`);
    return { rev: (await r.json()).rev as string };
  }
  async remove(id: string) { await this.f(`/api/docs/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  subscribe(onChange: () => void) {
    // the login cookie travels with the event stream (withCredentials), so there is no token in the URL
    const es = new EventSource(this.u('/api/events'), { withCredentials: true });
    es.addEventListener('change', onChange);
    return () => es.close();
  }
}

// ------------------------------------------------------------------ Dropbox (access token from the App Console)
export class DropboxProvider implements SyncProvider {
  readonly kind = 'dropbox' as const;
  label = 'Dropbox';
  constructor(private cfg: { token: string; folder: string }) {}
  private path(id: string) { return `${this.cfg.folder.replace(/\/+$/, '')}/${id}${EXT}`; }
  private async rpc(endpoint: string, body: unknown) {
    const r = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (r.status === 401) throw new AuthError('Dropbox rejected the access token');
    return r;
  }
  async connect() { const r = await this.rpc('users/get_current_account', null); if (!r.ok) throw new Error(`Dropbox answered ${r.status}`); const j = await r.json(); this.label = `Dropbox · ${j.name?.display_name ?? ''}`; }
  async list(): Promise<RemoteEntry[]> {
    const r = await this.rpc('files/list_folder', { path: this.cfg.folder === '/' ? '' : this.cfg.folder });
    if (r.status === 409) { await this.rpc('files/create_folder_v2', { path: this.cfg.folder }); return []; }
    const j = await r.json();
    return (j.entries as any[]).filter((e) => e['.tag'] === 'file' && e.name.endsWith(EXT)).map((e) => ({ id: e.name.slice(0, -EXT.length), title: e.name, modified: Date.parse(e.server_modified), rev: e.rev, size: e.size }));
  }
  async get(id: string): Promise<RemoteFile> {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Dropbox-API-Arg': JSON.stringify({ path: this.path(id) }) } });
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    const meta = JSON.parse(r.headers.get('dropbox-api-result') ?? '{}');
    return { blob: await r.blob(), rev: meta.rev ?? '', modified: Date.parse(meta.server_modified) || Date.now() };
  }
  async put(id: string, blob: Blob, meta: { title: string; modified: number; baseRev?: string }) {
    const arg = { path: this.path(id), mode: meta.baseRev ? { '.tag': 'update', update: meta.baseRev } : 'overwrite', mute: true };
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify(arg) }, body: blob });
    if (r.status === 409) throw new ConflictError('');
    if (r.status === 401) throw new AuthError();
    if (!r.ok) throw new Error(`Upload failed (${r.status})`);
    return { rev: (await r.json()).rev as string };
  }
  async remove(id: string) { await this.rpc('files/delete_v2', { path: this.path(id) }); }
}
