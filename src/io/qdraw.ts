// Native project format: .qdraw  (a zip: manifest.json + per-layer PNGs + assets + thumbnail)

import JSZip from 'jszip';
import type { Layer, Page, QDocument, AssetRecord } from '../core/model';
import { createDocument } from '../core/model';
import { RasterSurface } from '../core/raster';
import { renderPageToCanvas } from '../core/render';
import { registerAssetBlob } from '../core/assets';
import { blobToCanvas, canvasToBlob, createCanvas, ctx2d } from '../core/util';

export const QDRAW_VERSION = 1;
export const QDRAW_MIME = 'application/vnd.quarc.draw+zip';

const pngCache = new WeakMap<RasterSurface, { version: number; data: Uint8Array | null }>();

async function encodeSurface(s: RasterSurface): Promise<Uint8Array | null> {
  const hit = pngCache.get(s);
  if (hit && hit.version === s.version) return hit.data;
  const c = s.peek();
  let data: Uint8Array | null = null;
  if (c && s.contentBounds() !== null) data = new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
  pngCache.set(s, { version: s.version, data });
  return data;
}

interface LayerJSON { [k: string]: any }

async function layerToJSON(l: Layer, zip: JSZip, pid: string): Promise<LayerJSON> {
  const { mask, ...rest } = l as any;
  const j: LayerJSON = { ...rest };
  delete j.surface; delete j.children;
  if (l.type === 'raster') {
    const png = await encodeSurface(l.surface);
    if (png) { const path = `pages/${pid}/${l.id}.png`; zip.file(path, png, { compression: 'STORE' }); j.png = path; } else j.png = null;
    j.size = [l.surface.width, l.surface.height];
  }
  if (mask) {
    const png = await encodeSurface(mask);
    j.mask = { png: null as string | null, size: [mask.width, mask.height], blank: !png };
    if (png) { const path = `pages/${pid}/${l.id}.mask.png`; zip.file(path, png, { compression: 'STORE' }); j.mask.png = path; }
  } else j.mask = null;
  if (l.type === 'group') j.children = await Promise.all(l.children.map((c) => layerToJSON(c, zip, pid)));
  return j;
}

export async function serializeDoc(doc: QDocument, opts: { thumbnail?: boolean } = {}): Promise<Blob> {
  const zip = new JSZip();
  zip.file('mimetype', QDRAW_MIME, { compression: 'STORE' });
  const pages: any[] = [];
  for (const p of doc.pages) {
    const { layers, ...pageRest } = p;
    pages.push({ ...pageRest, layers: await Promise.all(layers.map((l) => layerToJSON(l, zip, p.id))) });
  }
  const assets: any[] = [];
  for (const a of doc.assets.values()) {
    const path = `assets/${a.id}`;
    zip.file(path, a.blob, { compression: a.kind === 'pdf' ? 'DEFLATE' : 'STORE' });
    assets.push({ id: a.id, name: a.name, mime: a.mime, kind: a.kind, path });
  }
  const { pages: _p, assets: _a, ...docRest } = doc as any;
  zip.file('manifest.json', JSON.stringify({ app: 'Quarc Draw', version: QDRAW_VERSION, saved: Date.now(), doc: docRest, pages, assets }));
  if (opts.thumbnail !== false && doc.pages[0]) {
    try {
      const p = doc.pages[0];
      const s = Math.min(1, 320 / Math.max(p.width, p.height));
      const c = renderPageToCanvas(doc, p, s);
      zip.file('thumbnail.png', await (await canvasToBlob(c, 'image/png')).arrayBuffer(), { compression: 'STORE' });
    } catch { /* thumbnail is optional */ }
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 }, mimeType: QDRAW_MIME });
}

async function layerFromJSON(j: LayerJSON, zip: JSZip): Promise<Layer> {
  const { png, size, mask, children, ...rest } = j;
  const l: any = { ...rest, mask: null };
  if (j.type === 'raster') {
    const s = new RasterSurface(size?.[0] ?? 1, size?.[1] ?? 1);
    if (png) { const f = zip.file(png); if (f) s.setFromCanvas(await blobToCanvas(new Blob([await f.async('arraybuffer')], { type: 'image/png' }))); }
    l.surface = s;
  }
  if (mask) {
    const m = new RasterSurface(mask.size?.[0] ?? 1, mask.size?.[1] ?? 1);
    if (mask.png) { const f = zip.file(mask.png); if (f) m.setFromCanvas(await blobToCanvas(new Blob([await f.async('arraybuffer')], { type: 'image/png' }))); }
    else if (!mask.blank) { m.canvas; }
    l.mask = m;
  }
  if (j.type === 'group') l.children = await Promise.all((children ?? []).map((c: LayerJSON) => layerFromJSON(c, zip)));
  return l as Layer;
}

export async function parseDoc(input: Blob | ArrayBuffer | Uint8Array): Promise<QDocument> {
  const zip = await JSZip.loadAsync(input as any);
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('Not a Quarc Draw file (manifest.json missing)');
  const m = JSON.parse(await mf.async('string'));
  const doc = createDocument(m.doc.title, m.doc.kind);
  Object.assign(doc, m.doc);
  doc.assets = new Map();
  for (const a of m.assets ?? []) {
    const f = zip.file(a.path);
    if (!f) continue;
    const blob = new Blob([await f.async('arraybuffer')], { type: a.mime });
    const rec: AssetRecord = { id: a.id, name: a.name, mime: a.mime, kind: a.kind, blob };
    doc.assets.set(a.id, rec);
    registerAssetBlob(a.id, blob);
  }
  doc.pages = [];
  for (const pj of m.pages) {
    const { layers, ...pr } = pj;
    const page: Page = { ...pr, layers: [] };
    page.layers = await Promise.all((layers ?? []).map((l: LayerJSON) => layerFromJSON(l, zip)));
    doc.pages.push(page);
  }
  return doc;
}

/** Read document metadata (title, kind, page count, thumbnail) without decoding any layer pixels. */
export async function peekMeta(blob: Blob): Promise<{ id: string; title: string; kind: QDocument['kind']; created: number; modified: number; pages: number; folder: string | null; tags: string[]; starred: boolean; thumb: Blob | null }> {
  const zip = await JSZip.loadAsync(blob);
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('Not a Quarc Draw file');
  const m = JSON.parse(await mf.async('string'));
  const th = zip.file('thumbnail.png');
  return {
    id: m.doc.id, title: m.doc.title, kind: m.doc.kind, created: m.doc.created, modified: m.doc.modified, pages: m.pages?.length ?? 1,
    folder: m.doc.folder ?? null, tags: m.doc.tags ?? [], starred: !!m.doc.starred,
    thumb: th ? new Blob([await th.async('arraybuffer')], { type: 'image/png' }) : null,
  };
}

/** read just the thumbnail of a .qdraw blob */
export async function readThumbnail(blob: Blob): Promise<Blob | null> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const f = zip.file('thumbnail.png');
    return f ? new Blob([await f.async('arraybuffer')], { type: 'image/png' }) : null;
  } catch { return null; }
}
void createCanvas; void ctx2d;
