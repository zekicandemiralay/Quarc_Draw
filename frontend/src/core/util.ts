// Small shared utilities: ids, events, debounce, canvas helpers.

let _idc = 0;
export const uid = (prefix = 'id'): string =>
  `${prefix}_${Date.now().toString(36)}${(_idc++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export type Listener<T = void> = (payload: T) => void;

/** Minimal typed event emitter. */
export class Emitter<Events extends object> {
  private map = new Map<keyof Events, Set<Listener<any>>>();
  on<K extends keyof Events>(ev: K, fn: Listener<Events[K]>): () => void {
    let set = this.map.get(ev);
    if (!set) this.map.set(ev, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit<K extends keyof Events>(ev: K, payload: Events[K]): void {
    const set = this.map.get(ev);
    if (set) for (const fn of [...set]) fn(payload);
  }
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => { if (t) clearTimeout(t); t = setTimeout(() => { t = undefined; fn(...a); }, ms); };
  d.flush = (...a: A) => { if (t) { clearTimeout(t); t = undefined; } fn(...a); };
  d.cancel = () => { if (t) clearTimeout(t); t = undefined; };
  return d;
}

export function throttleRaf(fn: () => void) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

export type AnyCanvas = HTMLCanvasElement;
export const createCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};
export const ctx2d = (c: HTMLCanvasElement, readback = false): CanvasRenderingContext2D =>
  c.getContext('2d', readback ? { willReadFrequently: true } : undefined)!;

export function canvasToBlob(c: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality));
}
export async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // revoke after the image has been decoded; decoded bitmap remains valid.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const img = await blobToImage(blob);
  const c = createCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
  ctx2d(c).drawImage(img, 0, 0);
  return c;
}
export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = createCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function anchorDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/**
 * Gets a generated file out of the app the way each platform does it:
 *   Android app (Capacitor)  written to the app's cache, then the system share sheet ("Save to Files", Drive, mail…):
 *                            a WebView cannot download a blob
 *   Windows / Mac / Linux app (Tauri)  a native "Save as" dialog
 *   Browser                  an ordinary download
 * Resolves to 'saved' | 'shared' | 'downloaded' | 'cancelled'.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<'saved' | 'shared' | 'downloaded' | 'cancelled'> {
  const w = window as any;
  const plugins = w.Capacitor?.Plugins;
  try {
    if (w.Capacitor?.isNativePlatform?.() && plugins?.Filesystem && plugins?.Share) {
      const data = await blobToBase64(blob);
      const { uri } = await plugins.Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
      try { await plugins.Share.share({ title: filename, url: uri, dialogTitle: filename }); }
      catch (err: any) { if (/cancel/i.test(String(err?.message))) return 'cancelled'; throw err; }
      return 'shared';
    }
    const tauri = w.__TAURI__;
    if (tauri?.dialog?.save && tauri?.fs?.writeFile) {
      const ext = filename.includes('.') ? filename.split('.').pop()! : '';
      const path = await tauri.dialog.save({ defaultPath: filename, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
      if (!path) return 'cancelled';
      await tauri.fs.writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      return 'saved';
    }
  } catch (e) { console.warn('native save failed, falling back to a download', e); }
  anchorDownload(blob, filename);
  return 'downloaded';
}
export function downloadBlob(blob: Blob, filename: string) { void saveBlob(blob, filename); }
export const sanitizeFilename = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled';

export const deepClone = <T,>(x: T): T => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** seeded PRNG (mulberry32) so procedural brush grain is reproducible */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
