// Global asset registry: decoded images for image objects / PDF backgrounds, keyed by asset id.
// Documents own the Blobs (AssetRecord); this module caches decoded bitmaps and notifies on load.

import { Emitter, blobToImage } from './util';

type Decoded = HTMLImageElement;
const images = new Map<string, Decoded>();
const pending = new Map<string, Promise<Decoded | null>>();
const blobs = new Map<string, Blob>();
export const assetEvents = new Emitter<{ ready: string }>();

export function registerAssetBlob(id: string, blob: Blob) {
  blobs.set(id, blob);
}
export function dropAsset(id: string) {
  blobs.delete(id); images.delete(id); pending.delete(id);
}
export function getAssetBlob(id: string): Blob | undefined { return blobs.get(id); }

/** Synchronous accessor – returns null while the image is still decoding (a redraw is requested on ready). */
export function getImageSync(id: string): Decoded | null {
  const hit = images.get(id);
  if (hit) return hit;
  void loadImage(id);
  return null;
}
export function loadImage(id: string): Promise<Decoded | null> {
  const hit = images.get(id);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(id);
  if (p) return p;
  const blob = blobs.get(id);
  if (!blob) return Promise.resolve(null);
  p = blobToImage(blob)
    .then((img) => { images.set(id, img); pending.delete(id); assetEvents.emit('ready', id); return img; })
    .catch(() => { pending.delete(id); return null; });
  pending.set(id, p);
  return p;
}
