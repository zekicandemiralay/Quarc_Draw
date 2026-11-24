// Sync engine: reconciles the local library with a remote provider.
//
//  • local-first – the app always works offline; sync happens in the background
//  • per-document revisions – each library record remembers the remote revision it last saw (syncRev)
//    and whether it changed locally since (syncDirty)
//  • conflicts never lose data – the older side is preserved as a "conflict copy" document
//  • deletions propagate; remote deletions move the local copy to the library trash

import { Store } from '../app/store';
import { AuthError, ConflictError, SyncConfig, SyncProvider, defaultSyncConfig, RemoteEntry } from './types';
import { FolderProvider, WebDAVProvider, QuarcServerProvider, DropboxProvider } from './providers';
import { LibraryMeta, deleteRecord, getBlob, getMeta, kvGet, kvSet, listLibrary, patchMeta, putRecord } from '../app/storage';
import { parseDoc, peekMeta, serializeDoc } from '../io/qdraw';
import { workspace } from '../app/workspace';
import { toast } from '../app/bus';
import { uid } from '../core/util';

export type SyncState = 'off' | 'connecting' | 'idle' | 'syncing' | 'error' | 'auth';
export interface SyncStatus {
  state: SyncState;
  label: string;
  lastSync: number;
  message: string;
  progress: { done: number; total: number } | null;
  log: { t: number; msg: string }[];
  conflicts: number;
}

class SyncEngine {
  config = new Store<SyncConfig>('quarcdraw.sync.v1', defaultSyncConfig());
  status = new Store<SyncStatus>(null, { state: 'off', label: '', lastSync: 0, message: '', progress: null, log: [], conflicts: 0 });
  private provider: SyncProvider | null = null;
  private unsub: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private running: Promise<void> | null = null;
  private again = false;

  private log(msg: string) {
    const s = this.status.get();
    this.status.set({ log: [{ t: Date.now(), msg }, ...s.log].slice(0, 80) });
  }
  private set(patch: Partial<SyncStatus>) { this.status.set(patch); }

  makeProvider(): SyncProvider | null {
    const c = this.config.get();
    switch (c.provider) {
      case 'folder': return new FolderProvider();
      case 'webdav': return new WebDAVProvider(c.webdav);
      case 'server': return new QuarcServerProvider(c.server);
      case 'dropbox': return new DropboxProvider(c.dropbox);
      default: return null;
    }
  }

  /** (re)connect using the current configuration */
  async start(): Promise<boolean> {
    this.stop();
    const p = this.makeProvider();
    if (!p) { this.set({ state: 'off', label: '', message: '' }); return false; }
    this.set({ state: 'connecting', message: 'Connecting…' });
    try {
      await p.connect();
      this.provider = p;
      this.set({ state: 'idle', label: p.label, message: '' });
      this.log(`Connected to ${p.label}`);
      this.unsub = p.subscribe?.(() => void this.syncAll(false)) ?? null;
      const { auto, intervalSec } = this.config.get();
      if (auto) this.timer = setInterval(() => void this.syncAll(false), Math.max(15, intervalSec) * 1000);
      window.addEventListener('online', this.onOnline);
      window.addEventListener('focus', this.onFocus);
      void this.syncAll(false);
      return true;
    } catch (e: any) {
      const auth = e instanceof AuthError || e?.name === 'AuthError';
      this.set({ state: auth ? 'auth' : 'error', message: e?.message ?? String(e) });
      this.log(`Connection failed: ${e?.message ?? e}`);
      return false;
    }
  }
  private onOnline = () => { void this.syncAll(false); };
  private onFocus = () => { if (this.config.get().auto) void this.syncAll(false); };
  stop() {
    this.unsub?.(); this.unsub = null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    window.removeEventListener('online', this.onOnline); window.removeEventListener('focus', this.onFocus);
    for (const t of this.pushTimers.values()) clearTimeout(t);
    this.pushTimers.clear();
    this.provider = null;
  }
  get connected() { return !!this.provider; }

  /** called by the workspace after a document was saved locally */
  schedulePush(docId: string) {
    if (!this.provider || !this.config.get().auto) return;
    const old = this.pushTimers.get(docId); if (old) clearTimeout(old);
    this.pushTimers.set(docId, setTimeout(() => { this.pushTimers.delete(docId); void this.syncAll(false); }, 3500));
  }

  async syncAll(manual: boolean): Promise<void> {
    if (!this.provider) { if (manual) toast('Sync is not set up yet — open File ▸ Sync settings', 'info'); return; }
    if (!navigator.onLine) { this.set({ state: 'error', message: 'You are offline — changes will sync when you reconnect' }); return; }
    if (this.running) { this.again = true; return this.running; }
    this.running = (async () => {
      try { do { this.again = false; await this.runOnce(manual); } while (this.again); }
      finally { this.running = null; }
    })();
    return this.running;
  }

  private async runOnce(manual: boolean) {
    const p = this.provider!;
    this.set({ state: 'syncing', message: '', progress: null });
    try {
      await workspace.flushAll();
      const remote = await p.list();
      const rmap = new Map(remote.map((r) => [r.id, r]));
      const locals = await listLibrary();
      const tomb = (await kvGet<Record<string, number>>('sync.tombstones')) ?? {};
      const work: (() => Promise<void>)[] = [];
      const lmap = new Map(locals.map((l) => [l.id, l]));

      for (const L of locals) {
        if (L.trashed) continue;
        const R = rmap.get(L.id);
        if (!R) {
          if (L.syncRev && !L.syncDirty) work.push(() => this.remoteDeleted(L));
          else work.push(() => this.upload(L));
        } else {
          const remoteChanged = R.rev !== L.syncRev, localChanged = !!L.syncDirty;
          if (remoteChanged && localChanged) work.push(() => this.resolveConflict(L, R));
          else if (localChanged) work.push(() => this.upload(L, R.rev));
          else if (remoteChanged) work.push(() => this.download(R, L));
        }
      }
      for (const R of remote) {
        if (lmap.has(R.id)) continue;
        if (tomb[R.id]) { work.push(async () => { await p.remove(R.id); delete tomb[R.id]; await kvSet('sync.tombstones', tomb); this.log(`Deleted “${R.title}” on the remote`); }); continue; }
        work.push(() => this.download(R, null));
      }
      for (const [id] of Object.entries(tomb)) if (!rmap.has(id)) delete tomb[id];
      await kvSet('sync.tombstones', tomb);

      let done = 0, skipped = 0;
      for (const w of work) {
        this.set({ progress: { done, total: work.length } });
        try { await w(); }
        catch (e: any) {
          // A document that cannot be read (a damaged file on the remote, say) must not stop every other document from
          // syncing. Problems that affect every document still end the round, as before: signing in, the network (fetch
          // fails with a TypeError) and an error answer from the server ("... failed (500)").
          const systematic = e instanceof TypeError || /[(][0-9]{3}[)]|Server answered/.test(String(e?.message));
          if (e instanceof AuthError || e?.name === 'AuthError' || systematic) throw e;
          skipped++;
          this.log(`Skipped one document: ${e?.message ?? e}`);
        }
        done++;
      }
      if (this.provider !== p) return; // stopped meanwhile (sign-out, another provider): do not overwrite that status
      this.set({ state: 'idle', lastSync: Date.now(), progress: null, message: skipped ? `Synced ${work.length - skipped}, ${skipped} document${skipped > 1 ? 's' : ''} could not be synced (see the log)` : work.length ? `Synced ${work.length} change${work.length > 1 ? 's' : ''}` : 'Up to date' });
      if (work.length) this.log(`Synced ${work.length - skipped} change(s)${skipped ? `, skipped ${skipped}` : ''}`);
      if (manual) toast(work.length ? `Sync complete — ${work.length} change${work.length > 1 ? 's' : ''}` : 'Everything is up to date', 'success');
    } catch (e: any) {
      if (this.provider !== p) return; // see above
      const auth = e instanceof AuthError || e?.name === 'AuthError';
      this.set({ state: auth ? 'auth' : 'error', progress: null, message: e?.message ?? String(e) });
      this.log(`Sync failed: ${e?.message ?? e}`);
      if (manual) toast(`Sync failed: ${e?.message ?? e}`, 'error');
    }
  }

  // ---------------------------------------------------------------- operations
  private async upload(L: LibraryMeta, baseRev?: string) {
    const p = this.provider!;
    const blob = await getBlob(L.id);
    if (!blob) return;
    try {
      const { rev } = await p.put(L.id, blob, { title: L.title, modified: L.modified, baseRev: baseRev ?? L.syncRev });
      await patchMeta(L.id, { syncRev: rev, syncDirty: false, syncedAt: Date.now() });
      this.log(`Uploaded “${L.title}”`);
    } catch (e) {
      if (e instanceof ConflictError) {
        const remote = (await p.list()).find((r) => r.id === L.id);
        if (remote) return this.resolveConflict(L, remote);
      }
      throw e;
    }
  }

  private async download(R: RemoteEntry, L: LibraryMeta | null) {
    const p = this.provider!;
    const f = await p.get(R.id);
    const m = await peekMeta(f.blob);
    const meta: LibraryMeta = {
      id: R.id, title: m.title, kind: m.kind, created: m.created, modified: m.modified, pages: m.pages, bytes: f.blob.size, thumb: m.thumb,
      folder: m.folder, tags: m.tags, starred: m.starred, trashed: 0, syncRev: f.rev, syncDirty: false, syncedAt: Date.now(),
    };
    await putRecord(meta, f.blob);
    this.log(`${L ? 'Updated' : 'Downloaded'} “${m.title}”`);
    await this.refreshOpenEditor(R.id, f.blob);
  }

  private async resolveConflict(L: LibraryMeta, R: RemoteEntry) {
    const p = this.provider!;
    const f = await p.get(R.id);
    const localBlob = await getBlob(L.id);
    if (!localBlob) return this.download(R, L);
    const remoteMeta = await peekMeta(f.blob);
    const localNewer = L.modified >= remoteMeta.modified;
    const device = this.config.get().deviceName;
    const stamp = new Date().toLocaleString();
    // keep the loser as a separate "conflict copy" so no edits are ever lost
    const loserBlob = localNewer ? f.blob : localBlob;
    const copyDoc = await parseDoc(loserBlob);
    copyDoc.id = uid('doc');
    copyDoc.title = `${copyDoc.title} (conflict – ${localNewer ? 'other device' : device}, ${stamp})`;
    const copyBlob = await serializeDoc(copyDoc);
    const cm = await peekMeta(copyBlob);
    await putRecord({ id: copyDoc.id, title: copyDoc.title, kind: cm.kind, created: cm.created, modified: Date.now(), pages: cm.pages, bytes: copyBlob.size, thumb: cm.thumb, folder: cm.folder, tags: cm.tags, starred: false, trashed: 0, syncDirty: true }, copyBlob);
    const st = this.status.get(); this.set({ conflicts: st.conflicts + 1 });
    this.again = true; // the conflict copy is a new document – upload it in the next round
    this.log(`Conflict on “${L.title}” — kept both versions`);
    toast(`Sync conflict on “${L.title}”: both versions were kept`, 'info');
    if (localNewer) {
      // local wins: overwrite the remote using the revision we just saw
      const { rev } = await p.put(L.id, localBlob, { title: L.title, modified: L.modified, baseRev: f.rev });
      await patchMeta(L.id, { syncRev: rev, syncDirty: false, syncedAt: Date.now() });
    } else {
      await this.download({ ...R, rev: f.rev }, L);
    }
  }

  private async remoteDeleted(L: LibraryMeta) {
    await patchMeta(L.id, { trashed: Date.now(), syncRev: undefined });
    this.log(`“${L.title}” was deleted on another device — moved to trash`);
  }

  private async refreshOpenEditor(docId: string, blob: Blob) {
    const ed = workspace.editors.find((e) => e.doc.id === docId);
    if (!ed) return;
    if (ed.dirty) return; // edits not yet saved locally; they will conflict on the next round
    try {
      const doc = await parseDoc(blob);
      const { ensurePdfSource } = await import('../pdf/pdfIO');
      await ensurePdfSource(doc);
      ed.replaceDocument(doc);
      toast(`“${doc.title}” was updated from sync`, 'info');
    } catch (e) { console.warn('could not refresh open document', e); }
  }

  /** delete a document locally and (eventually) everywhere */
  async deleteEverywhere(id: string) {
    await deleteRecord(id);
    if (this.provider) { try { await this.provider.remove(id); } catch { /* retry via tombstone */ await this.addTombstone(id); } }
    else if (this.config.get().provider !== 'none') await this.addTombstone(id);
  }
  private async addTombstone(id: string) {
    const t = (await kvGet<Record<string, number>>('sync.tombstones')) ?? {};
    t[id] = Date.now(); await kvSet('sync.tombstones', t);
  }
  async metaOf(id: string) { return getMeta(id); }
}
export const syncEngine = new SyncEngine();

/** wire up with the workspace + boot-time auto-connect */
export function initSync() {
  workspace.onSaved = (ed) => syncEngine.schedulePush(ed.doc.id);
  if (syncEngine.config.get().provider !== 'none') void syncEngine.start();
}
