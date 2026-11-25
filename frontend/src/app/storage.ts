// IndexedDB-backed document library (local-first storage). Files are stored as .qdraw blobs plus a small metadata record.

import type { Editor } from '../editor/editor';
import { serializeDoc, readThumbnail } from '../io/qdraw';
import { Emitter } from '../core/util';

export interface LibraryMeta {
  id: string;
  title: string;
  created: number;
  modified: number;
  pages: number;
  bytes: number;
  thumb: Blob | null;
  folder: string | null;
  tags: string[];
  starred: boolean;
  trashed: number; // 0 = not trashed, else deletion timestamp
  /** sync bookkeeping */
  syncDirty?: boolean;
  syncedAt?: number;
  syncRev?: string;
}

const DB_NAME = 'quarcdraw', DB_VER = 1;
let dbp: Promise<IDBDatabase> | null = null;
export const libraryEvents = new Emitter<{ change: void }>();

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function tx<T>(stores: string | string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const r = fn(t);
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const kvGet = <T,>(key: string) => tx<T>('kv', 'readonly', (t) => t.objectStore('kv').get(key));
export const kvSet = (key: string, val: unknown) => tx('kv', 'readwrite', (t) => { t.objectStore('kv').put(val, key); });

export async function listLibrary(): Promise<LibraryMeta[]> {
  const all = (await tx<LibraryMeta[]>('meta', 'readonly', (t) => t.objectStore('meta').getAll())) ?? [];
  return all.sort((a, b) => b.modified - a.modified);
}
export const getMeta = (id: string) => tx<LibraryMeta>('meta', 'readonly', (t) => t.objectStore('meta').get(id));
export async function getBlob(id: string): Promise<Blob | null> {
  const r = await tx<{ id: string; blob: Blob }>('blobs', 'readonly', (t) => t.objectStore('blobs').get(id));
  return r?.blob ?? null;
}
export async function putRecord(meta: LibraryMeta, blob: Blob) {
  await tx(['meta', 'blobs'], 'readwrite', (t) => { t.objectStore('meta').put(meta); t.objectStore('blobs').put({ id: meta.id, blob }); });
  libraryEvents.emit('change', undefined);
}
export async function patchMeta(id: string, patch: Partial<LibraryMeta>) {
  const m = await getMeta(id);
  if (!m) return;
  await tx('meta', 'readwrite', (t) => { t.objectStore('meta').put({ ...m, ...patch }); });
  libraryEvents.emit('change', undefined);
}
export async function deleteRecord(id: string) {
  await tx(['meta', 'blobs'], 'readwrite', (t) => { t.objectStore('meta').delete(id); t.objectStore('blobs').delete(id); });
  libraryEvents.emit('change', undefined);
}
export async function getFolders(): Promise<string[]> { return (await kvGet<string[]>('folders')) ?? []; }
export async function setFolders(f: string[]) { await kvSet('folders', f); libraryEvents.emit('change', undefined); }

/** serialise the editor's document and store it. Returns the stored meta. */
export async function saveEditor(ed: Editor, opts: { markSyncDirty?: boolean } = {}): Promise<LibraryMeta> {
  const doc = ed.doc;
  const blob = await serializeDoc(doc);
  const prev = await getMeta(doc.id);
  const thumb = await readThumbnail(blob);
  const meta: LibraryMeta = {
    id: doc.id, title: doc.title, created: doc.created, modified: Date.now(), pages: doc.pages.length, bytes: blob.size, thumb,
    folder: doc.folder, tags: doc.tags, starred: doc.starred, trashed: prev?.trashed ?? 0,
    syncDirty: opts.markSyncDirty === false ? prev?.syncDirty : true, syncedAt: prev?.syncedAt, syncRev: prev?.syncRev,
  };
  doc.modified = meta.modified;
  await putRecord(meta, blob);
  ed.markSaved();
  return meta;
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage.estimate(); return { used: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { return null; }
}
export async function persistStorage() { try { await navigator.storage?.persist?.(); } catch { /* ignore */ } }
