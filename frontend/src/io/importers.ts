// Importers and the "open anything" router.

import JSZip from 'jszip';
import { Editor } from '../editor/editor';
import type { BlendMode, Layer, QDocument } from '../core/model';
import { createDocument, createGroupLayer, createPage, createRasterLayer, createVectorLayer } from '../core/model';
import { RasterSurface } from '../core/raster';
import { blobToCanvas, createCanvas, ctx2d, uid } from '../core/util';
import { parseDoc } from './qdraw';
import { parseSvg } from './svg';
import { ORA_TO_BLEND, PSD_TO_BLEND } from './exporters';
import { registerAssetBlob } from '../core/assets';
import { toast } from '../app/bus';

export const MAX_DIM = 8192;

const ext = (n: string) => (n.split('.').pop() ?? '').toLowerCase();
export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico', 'jfif', 'tif', 'tiff'];
export const OPEN_ACCEPT = '.qdraw,.psd,.ora,.svg,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.ico';

function fitCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const m = Math.max(c.width, c.height);
  if (m <= MAX_DIM) return c;
  const k = MAX_DIM / m, out = createCanvas(Math.round(c.width * k), Math.round(c.height * k));
  const ctx = ctx2d(out); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, out.width, out.height);
  toast(`Image was larger than ${MAX_DIM}px and has been scaled down`, 'info');
  return out;
}

export async function imageToEditor(blob: Blob, name: string): Promise<Editor> {
  const c = fitCanvas(await blobToCanvas(blob));
  const doc = createDocument(name.replace(/\.[^.]+$/, ''));
  const pg = createPage(c.width, c.height, 'Page 1', { color: null });
  const layer = createRasterLayer(name.replace(/\.[^.]+$/, '') || 'Image', c.width, c.height);
  layer.surface.setFromCanvas(c);
  pg.layers.push(layer);
  doc.pages.push(pg);
  const ed = new Editor(doc);
  ed.setActiveLayer(layer.id);
  ed.fitPage();
  return ed;
}

export async function svgToEditor(text: string, name: string): Promise<Editor> {
  const r = parseSvg(text);
  const doc = createDocument(name.replace(/\.[^.]+$/, ''));
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const pg = createPage(w, h, 'Page 1', { color: null });
  const vl = createVectorLayer('Vector');
  vl.objects = r.objects;
  pg.layers.push(vl);
  doc.pages.push(pg);
  if (r.warnings.length) toast(r.warnings.join(' · '), 'info');
  return new Editor(doc);
}

// ------------------------------------------------------------ OpenRaster
export async function oraToEditor(blob: Blob, name: string): Promise<Editor> {
  const zip = await JSZip.loadAsync(blob);
  const xml = await zip.file('stack.xml')?.async('string');
  if (!xml) throw new Error('Invalid OpenRaster file (stack.xml missing)');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  const img = dom.documentElement;
  const W = parseInt(img.getAttribute('w') ?? '0'), H = parseInt(img.getAttribute('h') ?? '0');
  const doc = createDocument(name.replace(/\.[^.]+$/, ''));
  const pg = createPage(W, H, 'Page 1', { color: null });
  const build = async (stack: Element): Promise<Layer[]> => {
    const out: Layer[] = [];
    for (const el of Array.from(stack.children).reverse()) { // XML is top-first; model is bottom-first
      const common = { name: el.getAttribute('name') ?? 'Layer', opacity: parseFloat(el.getAttribute('opacity') ?? '1'), visible: el.getAttribute('visibility') !== 'hidden', blend: (ORA_TO_BLEND[el.getAttribute('composite-op') ?? ''] ?? 'normal') as BlendMode };
      if (el.tagName === 'stack') { const g = createGroupLayer(common.name, await build(el)); Object.assign(g, common); out.push(g); }
      else if (el.tagName === 'layer') {
        const f = zip.file(el.getAttribute('src') ?? '');
        const l = createRasterLayer(common.name, W, H); Object.assign(l, common);
        if (f) {
          const c = await blobToCanvas(new Blob([await f.async('arraybuffer')], { type: 'image/png' }));
          l.surface.canvas; l.surface.ctx.drawImage(c, parseInt(el.getAttribute('x') ?? '0'), parseInt(el.getAttribute('y') ?? '0'));
        }
        out.push(l);
      }
    }
    return out;
  };
  const root = img.querySelector(':scope > stack');
  pg.layers = root ? await build(root) : [];
  if (!pg.layers.length) pg.layers.push(createRasterLayer('Layer 1', W, H));
  doc.pages.push(pg);
  const dpi = parseFloat(img.getAttribute('xres') ?? '96'); if (dpi > 0) doc.dpi = dpi;
  return new Editor(doc);
}

// ------------------------------------------------------------ PSD
export async function psdToEditor(buf: ArrayBuffer, name: string): Promise<Editor> {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buf, { skipThumbnail: true, skipLayerImageData: false, useImageData: false } as any);
  const W = psd.width, H = psd.height;
  const doc = createDocument(name.replace(/\.[^.]+$/, ''));
  const pg = createPage(W, H, 'Page 1', { color: null });
  const conv = (kids: any[] | undefined): Layer[] => {
    const out: Layer[] = [];
    for (const k of kids ?? []) {
      const blend = (PSD_TO_BLEND[k.blendMode as string] ?? 'normal') as BlendMode;
      if (k.children) { const g = createGroupLayer(k.name ?? 'Group', conv(k.children)); Object.assign(g, { visible: !k.hidden, opacity: k.opacity ?? 1, blend, expanded: !!k.opened }); out.push(g); continue; }
      const l = createRasterLayer(k.name ?? 'Layer', W, H);
      Object.assign(l, { visible: !k.hidden, opacity: k.opacity ?? 1, blend, clip: !!k.clipping });
      if (k.canvas) { l.surface.canvas; l.surface.ctx.drawImage(k.canvas as HTMLCanvasElement, k.left ?? 0, k.top ?? 0); }
      out.push(l);
    }
    return out;
  };
  pg.layers = conv(psd.children);
  if (!pg.layers.length && psd.canvas) { const l = createRasterLayer('Background', W, H); l.surface.setFromCanvas(psd.canvas as HTMLCanvasElement); pg.layers.push(l); }
  doc.pages.push(pg);
  return new Editor(doc);
}

// ------------------------------------------------------------ router
export interface OpenResult { editor: Editor; message?: string }

export async function openFile(file: File | { name: string; blob: Blob }): Promise<Editor> {
  const name = file.name;
  const blob: Blob = 'blob' in file ? file.blob : file;
  const e = ext(name);
  if (e === 'qdraw') { const doc = await parseDoc(blob); const ed = new Editor(doc); ed.isNew = false; ed.fitPage(); return ed; }
  if (e === 'ora') return oraToEditor(blob, name);
  if (e === 'psd') return psdToEditor(await blob.arrayBuffer(), name);
  if (e === 'svg') return svgToEditor(await blob.text(), name);
  if (IMAGE_EXT.includes(e) || blob.type.startsWith('image/')) return imageToEditor(blob, name);
  throw new Error(`Unsupported file type “.${e}”`);
}

export const isDocFile = (name: string) => ['qdraw', 'ora', 'psd', 'svg', ...IMAGE_EXT].includes(ext(name));

/** register a font file with the browser so text tools can use it */
export async function loadFontFile(file: File): Promise<string> {
  const family = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  const face = new FontFace(family, await file.arrayBuffer());
  await face.load();
  (document as any).fonts.add(face);
  return family;
}
export type { QDocument };
void uid; void registerAssetBlob; void RasterSurface;
