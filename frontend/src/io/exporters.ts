// Exporters: PNG / JPEG / WebP / AVIF / BMP / ICO / GIF / SVG / PDF / PSD / ORA / QDRAW (+ zip bundles).

import JSZip from 'jszip';
import type { Editor } from '../editor/editor';
import type { BlendMode, Layer, Page, QDocument } from '../core/model';
import { walkLayers } from '../core/model';
import { renderPageToCanvas } from '../core/render';
import { canvasToBlob, createCanvas, ctx2d, sanitizeFilename } from '../core/util';
import { serializeDoc } from './qdraw';
import { pageToSvg } from './svg';
import { getPdfSource, PDF_DPI } from '../pdf/pdfSource';
import { getAssetBlob } from '../core/assets';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp' | 'ico' | 'gif' | 'svg' | 'pdf' | 'psd' | 'ora' | 'qdraw';
export interface ExportOptions {
  format: ExportFormat;
  scope: 'page' | 'all' | 'selection' | 'layers';
  scale: number;
  quality: number;          // 0..1 for lossy formats
  transparent: boolean;
  background: string;       // used for JPEG / BMP / non-transparent export
  fps: number;              // animated GIF
  pdfMode: 'pages' | 'annotated-original';
  bundle: 'auto' | 'zip';
}
export const defaultExportOptions = (): ExportOptions => ({ format: 'png', scope: 'page', scale: 1, quality: 0.92, transparent: true, background: '#ffffff', fps: 4, pdfMode: 'pages', bundle: 'auto' });

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; mime: string; lossy?: boolean; alpha?: boolean; layered?: boolean; vector?: boolean; desc: string }> = {
  png: { label: 'PNG', ext: 'png', mime: 'image/png', alpha: true, desc: 'Lossless with transparency — best for art and web.' },
  jpeg: { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', lossy: true, desc: 'Small photos. No transparency.' },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', lossy: true, alpha: true, desc: 'Modern web format with transparency.' },
  avif: { label: 'AVIF', ext: 'avif', mime: 'image/avif', lossy: true, alpha: true, desc: 'Very small files (browser support required).' },
  bmp: { label: 'BMP', ext: 'bmp', mime: 'image/bmp', alpha: true, desc: 'Uncompressed bitmap.' },
  ico: { label: 'ICO', ext: 'ico', mime: 'image/x-icon', alpha: true, desc: 'Multi-size Windows icon (16–256 px).' },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif', alpha: true, desc: 'Single image, or an animation with one frame per page.' },
  svg: { label: 'SVG', ext: 'svg', mime: 'image/svg+xml', alpha: true, vector: true, desc: 'Scalable vector graphics (pixel layers are embedded).' },
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', vector: false, desc: 'Multi-page document; annotate-and-export for PDFs.' },
  psd: { label: 'PSD', ext: 'psd', mime: 'image/vnd.adobe.photoshop', layered: true, alpha: true, desc: 'Photoshop file with layers.' },
  ora: { label: 'OpenRaster', ext: 'ora', mime: 'image/openraster', layered: true, alpha: true, desc: 'Open layered format (Krita, GIMP, MyPaint).' },
  qdraw: { label: 'Quarc Draw', ext: 'qdraw', mime: 'application/vnd.quarc.draw+zip', layered: true, alpha: true, desc: 'Native project with everything editable.' },
};

export interface ExportedFile { name: string; blob: Blob }

// ------------------------------------------------------------ encoders
export function encodeBMP(c: HTMLCanvasElement, background?: string): Blob {
  const w = c.width, h = c.height;
  const src = ctx2d(c, true).getImageData(0, 0, w, h).data;
  const rowSize = w * 4, size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size), dv = new DataView(buf), u8 = new Uint8Array(buf);
  u8[0] = 0x42; u8[1] = 0x4d; dv.setUint32(2, size, true); dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 32, true);
  dv.setUint32(34, rowSize * h, true); dv.setInt32(38, 2835, true); dv.setInt32(42, 2835, true);
  void background;
  let o = 54;
  for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; u8[o++] = src[i + 2]; u8[o++] = src[i + 1]; u8[o++] = src[i]; u8[o++] = src[i + 3]; }
  return new Blob([buf], { type: 'image/bmp' });
}

export async function encodeICO(c: HTMLCanvasElement): Promise<Blob> {
  const sizes = [16, 24, 32, 48, 64, 128, 256].filter((s) => s <= Math.max(c.width, c.height) || s === 16);
  const pngs: Uint8Array[] = [];
  for (const s of sizes) {
    const t = createCanvas(s, s), ctx = ctx2d(t);
    ctx.imageSmoothingQuality = 'high';
    const k = Math.min(s / c.width, s / c.height);
    ctx.drawImage(c, (s - c.width * k) / 2, (s - c.height * k) / 2, c.width * k, c.height * k);
    pngs.push(new Uint8Array(await (await canvasToBlob(t)).arrayBuffer()));
  }
  const headerSize = 6 + 16 * sizes.length;
  const total = headerSize + pngs.reduce((s, p) => s + p.length, 0);
  const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
  dv.setUint16(2, 1, true); dv.setUint16(4, sizes.length, true);
  let off = headerSize;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    u8[e] = s >= 256 ? 0 : s; u8[e + 1] = s >= 256 ? 0 : s; dv.setUint16(e + 4, 1, true); dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, pngs[i].length, true); dv.setUint32(e + 12, off, true);
    u8.set(pngs[i], off); off += pngs[i].length;
  });
  return new Blob([buf], { type: 'image/x-icon' });
}

async function encodeGIF(frames: HTMLCanvasElement[], fps: number): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder();
  const delay = Math.round(1000 / Math.max(0.1, fps));
  for (const c of frames) {
    const { data, width, height } = ctx2d(c, true).getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256, { format: 'rgba4444', oneBitAlpha: true });
    const index = applyPalette(data, palette, 'rgba4444');
    const ti = palette.findIndex((p: number[]) => p[3] === 0);
    gif.writeFrame(index, width, height, { palette, delay, transparent: ti >= 0, transparentIndex: ti >= 0 ? ti : 0, repeat: frames.length > 1 ? 0 : undefined });
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

// ------------------------------------------------------------ page rendering for export
function renderForExport(ed: Editor, page: Page, o: ExportOptions, region?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const wantAlpha = o.transparent && FORMAT_INFO[o.format].alpha;
  const c = renderPageToCanvas(ed.doc, page, o.scale, { transparentBackground: !!wantAlpha && !page.background.color ? true : false, region });
  if (!wantAlpha || !o.transparent) {
    const out = createCanvas(c.width, c.height), ctx = ctx2d(out);
    ctx.fillStyle = o.background; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0);
    return out;
  }
  // transparent export: drop the plain page colour if it is just the default paper colour
  if (page.background.color) {
    const t = renderPageToCanvas(ed.doc, page, o.scale, { skipBackground: true, region });
    if (!page.background.template && page.background.pdfPage === null && !page.background.image) return t;
  }
  return c;
}

async function canvasToFormat(c: HTMLCanvasElement, o: ExportOptions): Promise<Blob> {
  switch (o.format) {
    case 'jpeg': return canvasToBlob(c, 'image/jpeg', o.quality);
    case 'webp': return canvasToBlob(c, 'image/webp', o.quality);
    case 'avif': {
      const b = await canvasToBlob(c, 'image/avif', o.quality);
      if (b.type !== 'image/avif') throw new Error('This browser cannot encode AVIF — use WebP or PNG.');
      return b;
    }
    case 'bmp': return encodeBMP(c, o.background);
    case 'ico': return encodeICO(c);
    case 'gif': return await encodeGIF([c], 1);
    default: return canvasToBlob(c, 'image/png');
  }
}

const BLEND_PSD: Record<BlendMode, string> = {
  normal: 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color dodge',
  'color-burn': 'color burn', 'hard-light': 'hard light', 'soft-light': 'soft light', difference: 'difference', exclusion: 'exclusion', hue: 'hue',
  saturation: 'saturation', color: 'color', luminosity: 'luminosity', add: 'linear dodge',
};
const BLEND_ORA: Record<BlendMode, string> = {
  normal: 'svg:src-over', multiply: 'svg:multiply', screen: 'svg:screen', overlay: 'svg:overlay', darken: 'svg:darken', lighten: 'svg:lighten', 'color-dodge': 'svg:color-dodge',
  'color-burn': 'svg:color-burn', 'hard-light': 'svg:hard-light', 'soft-light': 'svg:soft-light', difference: 'svg:difference', exclusion: 'svg:exclusion', hue: 'svg:hue',
  saturation: 'svg:saturation', color: 'svg:color', luminosity: 'svg:luminosity', add: 'svg:plus',
};
export const ORA_TO_BLEND: Record<string, BlendMode> = Object.fromEntries(Object.entries(BLEND_ORA).map(([k, v]) => [v, k as BlendMode]));
export const PSD_TO_BLEND: Record<string, BlendMode> = Object.fromEntries(Object.entries(BLEND_PSD).map(([k, v]) => [v, k as BlendMode]));

/** rasterise a single layer (including masks / effects) to a page-sized canvas */
function layerCanvas(doc: QDocument, page: Page, layer: Layer): HTMLCanvasElement {
  const solo: Page = { ...page, layers: [{ ...layer, opacity: 1, blend: 'normal', visible: true, clip: false }] };
  return renderPageToCanvas(doc, solo, 1, { skipBackground: true, transparentBackground: true });
}

async function exportPSD(ed: Editor, page: Page): Promise<Blob> {
  const { writePsd } = await import('ag-psd');
  const conv = (layers: Layer[]): any[] => layers.filter((l) => l.type !== 'adjustment').map((l) => {
    if (l.type === 'group') return { name: l.name, opened: l.expanded, hidden: !l.visible, opacity: l.opacity, blendMode: l.blend === 'normal' ? 'pass through' : BLEND_PSD[l.blend], children: conv(l.children) };
    return { name: l.name, left: 0, top: 0, hidden: !l.visible, opacity: l.opacity, blendMode: BLEND_PSD[l.blend], clipping: l.clip, canvas: layerCanvas(ed.doc, page, l) };
  }).reverse().reverse();
  const psd = { width: page.width, height: page.height, children: conv(page.layers), canvas: renderPageToCanvas(ed.doc, page, 1) };
  const buf = writePsd(psd as any, { generateThumbnail: true, trimImageData: true });
  return new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
}

async function exportORA(ed: Editor, page: Page): Promise<Blob> {
  const zip = new JSZip();
  zip.file('mimetype', 'image/openraster', { compression: 'STORE' });
  let n = 0;
  const stackXml = async (layers: Layer[]): Promise<string> => {
    let xml = '';
    for (const l of [...layers].reverse()) {
      if (l.type === 'adjustment') continue;
      if (l.type === 'group') { xml += `<stack name="${esc(l.name)}" opacity="${l.opacity}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="${BLEND_ORA[l.blend]}">${await stackXml(l.children)}</stack>`; continue; }
      const src = `data/layer${n++}.png`;
      zip.file(src, await (await canvasToBlob(layerCanvas(ed.doc, page, l))).arrayBuffer(), { compression: 'STORE' });
      xml += `<layer name="${esc(l.name)}" src="${src}" x="0" y="0" opacity="${l.opacity}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="${BLEND_ORA[l.blend]}"/>`;
    }
    return xml;
  };
  const stack = await stackXml(page.layers);
  zip.file('stack.xml', `<?xml version="1.0" encoding="UTF-8"?><image version="0.0.3" w="${page.width}" h="${page.height}" xres="${ed.doc.dpi}" yres="${ed.doc.dpi}"><stack>${stack}</stack></image>`);
  const merged = renderPageToCanvas(ed.doc, page, 1);
  zip.file('mergedimage.png', await (await canvasToBlob(merged)).arrayBuffer(), { compression: 'STORE' });
  const s = Math.min(1, 256 / Math.max(page.width, page.height));
  zip.file('Thumbnails/thumbnail.png', await (await canvasToBlob(renderPageToCanvas(ed.doc, page, s))).arrayBuffer(), { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'image/openraster', compression: 'DEFLATE' });
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------ PDF
export async function exportPDF(ed: Editor, pages: Page[], o: ExportOptions): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = ed.doc;
  const src = getPdfSource(doc.id);
  const out = await PDFDocument.create();
  const ptPerUnit = 72 / doc.dpi;
  for (const page of pages) {
    const wPt = page.width * ptPerUnit, hPt = page.height * ptPerUnit;
    if (o.pdfMode === 'annotated-original' && src && page.background.pdfPage !== null) {
      // original PDF page + our annotation layers as a transparent overlay
      const srcDoc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
      const [copied] = await out.copyPages(srcDoc, [page.background.pdfPage]);
      out.addPage(copied);
      const overlay = renderPageToCanvas(doc, page, Math.max(1, o.scale) * 2, { skipBackground: true, transparentBackground: true });
      if (isBlank(overlay)) continue;
      const png = await out.embedPng(await (await canvasToBlob(overlay)).arrayBuffer());
      const pg = out.getPage(out.getPageCount() - 1);
      const { width, height } = pg.getSize();
      pg.drawImage(png, { x: 0, y: 0, width, height });
    } else {
      const p = out.addPage([wPt, hPt]);
      const c = renderForExport(ed, page, { ...o, transparent: false }, undefined);
      const useJpeg = o.format === 'pdf' && o.quality < 1 && !page.layers.some((l) => l.visible && l.type === 'raster' && false);
      const bytes = await (await canvasToBlob(c, useJpeg ? 'image/jpeg' : 'image/png', o.quality)).arrayBuffer();
      const img = useJpeg ? await out.embedJpg(bytes) : await out.embedPng(bytes);
      p.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
    }
  }
  out.setTitle(doc.title); out.setProducer('Quarc Draw'); out.setCreator('Quarc Draw');
  return new Blob([(await out.save()) as BlobPart], { type: 'application/pdf' });
}
function isBlank(c: HTMLCanvasElement): boolean {
  const d = ctx2d(c, true).getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 16) if (d[i]) return false;
  // finer check on the remaining pixels
  for (let i = 3; i < d.length; i += 4) if (d[i]) return false;
  return true;
}

// ------------------------------------------------------------ main entry
export async function exportDocument(ed: Editor, o: ExportOptions): Promise<ExportedFile> {
  const doc = ed.doc;
  const base = sanitizeFilename(doc.title);
  const info = FORMAT_INFO[o.format];
  const files: ExportedFile[] = [];
  const pages = o.scope === 'all' ? doc.pages : [ed.page];

  if (o.format === 'qdraw') return { name: `${base}.qdraw`, blob: await serializeDoc(doc) };
  if (o.format === 'pdf') return { name: `${base}.pdf`, blob: await exportPDF(ed, pages, o) };
  if (o.format === 'gif' && pages.length > 1) {
    const frames = pages.map((p) => renderForExport(ed, p, o));
    const w = Math.max(...frames.map((f) => f.width)), h = Math.max(...frames.map((f) => f.height));
    const norm = frames.map((f) => { if (f.width === w && f.height === h) return f; const c = createCanvas(w, h); ctx2d(c).drawImage(f, 0, 0); return c; });
    return { name: `${base}.gif`, blob: await encodeGIF(norm, o.fps) };
  }

  const multi = pages.length > 1;
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const suffix = multi ? `-${String(doc.pages.indexOf(page) + 1).padStart(2, '0')}` : '';
    if (o.format === 'psd') { files.push({ name: `${base}${suffix}.psd`, blob: await exportPSD(ed, page) }); continue; }
    if (o.format === 'ora') { files.push({ name: `${base}${suffix}.ora`, blob: await exportORA(ed, page) }); continue; }
    if (o.format === 'svg') {
      const svg = pageToSvg(doc, page, {
        rasterLayers: 'embed',
        layerImage: (l) => { if (l.type !== 'raster' || !l.surface.peek()) return null; return layerCanvas(doc, page, l).toDataURL('image/png'); },
        assetUrl: (id) => { const b = getAssetBlob(id); return b ? blobUrlSync(id, b) : null; },
      });
      files.push({ name: `${base}${suffix}.svg`, blob: new Blob([await resolveAssetUrls(svg)], { type: 'image/svg+xml' }) });
      continue;
    }
    if (o.scope === 'layers') {
      const used = new Set<string>();
      let idx = 0;
      const emit = async (layers: Layer[]) => {
        for (const l of layers) {
          if (l.type === 'adjustment') continue;
          const c = renderPageToCanvas(doc, page, o.scale, { onlyLayer: l.id, transparentBackground: true, skipBackground: true });
          let nm = sanitizeFilename(l.name); if (used.has(nm)) nm += `-${++idx}`; used.add(nm);
          files.push({ name: `${base}/${nm}.${info.ext}`, blob: await canvasToFormat(c, o) });
          if (l.type === 'group') await emit(l.children);
        }
      };
      await emit(page.layers);
      continue;
    }
    let region: { x: number; y: number; w: number; h: number } | undefined;
    if (o.scope === 'selection' && ed.hasSelection) { const b = ed.selectionFor(page).bounds!; region = { x: b.x, y: b.y, w: b.w, h: b.h }; }
    const c = renderForExport(ed, page, o, region);
    files.push({ name: `${base}${suffix}.${info.ext}`, blob: await canvasToFormat(c, o) });
  }
  if (files.length === 1 && o.bundle !== 'zip') return files[0];
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  return { name: `${base}.zip`, blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }) };
}

// SVG image assets need to be inlined as data URLs (async) – we stash placeholders and resolve afterwards
const placeholder = new Map<string, Blob>();
function blobUrlSync(id: string, b: Blob): string { placeholder.set(id, b); return `__asset__${id}__`; }
async function resolveAssetUrls(svg: string): Promise<string> {
  let out = svg;
  for (const [id, b] of placeholder) {
    const key = `__asset__${id}__`;
    if (!out.includes(key)) continue;
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });
    out = out.split(key).join(url);
  }
  placeholder.clear();
  return out;
}
void walkLayers; void PDF_DPI;
