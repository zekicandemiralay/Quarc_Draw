// Sync provider contract. Providers are dumb blob stores; the engine does all the merging.

export interface RemoteEntry {
  id: string;          // document id
  title: string;
  modified: number;    // ms epoch (best effort)
  rev: string;         // opaque revision token – changes whenever the remote file changes
  size: number;
}
export interface RemoteFile { blob: Blob; rev: string; modified: number }

export class ConflictError extends Error {
  constructor(public currentRev: string) { super('The remote copy changed since it was last synced'); this.name = 'ConflictError'; }
}
export class AuthError extends Error { constructor(msg = 'Authentication failed') { super(msg); this.name = 'AuthError'; } }

export interface SyncProvider {
  readonly kind: 'folder' | 'webdav' | 'server' | 'dropbox';
  readonly label: string;
  /** verify credentials / permissions; throws on failure */
  connect(): Promise<void>;
  list(): Promise<RemoteEntry[]>;
  get(id: string): Promise<RemoteFile>;
  /** `baseRev` is the revision this upload was based on (for optimistic concurrency) */
  put(id: string, blob: Blob, meta: { title: string; modified: number; baseRev?: string }): Promise<{ rev: string }>;
  remove(id: string): Promise<void>;
  /** optional push notifications – returns an unsubscribe function */
  subscribe?(onChange: () => void): () => void;
}

export interface SyncConfig {
  provider: 'none' | 'folder' | 'webdav' | 'server' | 'dropbox';
  auto: boolean;
  intervalSec: number;
  deviceName: string;
  webdav: { url: string; user: string; pass: string };
  server: { url: string; token: string };
  dropbox: { token: string; folder: string };
  folderName: string;
}
export const defaultSyncConfig = (): SyncConfig => ({
  provider: 'none', auto: true, intervalSec: 60, deviceName: (typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent) ? 'Windows' : 'Device') + ' browser',
  webdav: { url: '', user: '', pass: '' }, server: { url: 'http://localhost:8787', token: '' }, dropbox: { token: '', folder: '/QuarcDraw' }, folderName: '',
});
