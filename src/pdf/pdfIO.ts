// PDF import: turns a PDF into a multi-page annotatable document.

import { Editor } from '../editor/editor';
import { createDocument, createPage, createVectorLayer } from '../core/model';
import { registerAssetBlob } from '../core/assets';
import { uid } from '../core/util';
import { PDF_DPI, PDF_K, PdfSource, getPdfSource, setPdfSource } from './pdfSource';
import type { QDocument } from '../core/model';

export async function importPdf(bytes: Uint8Array, name: string, onProgress?: (done: number, total: number) => void): Promise<Editor> {
  const doc = createDocument(name.replace(/\.pdf$/i, ''), 'pdf');
  doc.dpi = PDF_DPI;
  doc.layout = 'vertical';
  const src = await PdfSource.load(doc.id, bytes);
  setPdfSource(doc.id, src);
  // page sizes (batched so huge documents stay responsive)
  const sizes: { w: number; h: number }[] = new Array(src.pageCount);
  const BATCH = 24;
  for (let i = 0; i < src.pageCount; i += BATCH) {
    await Promise.all(Array.from({ length: Math.min(BATCH, src.pageCount - i) }, async (_, k) => { sizes[i + k] = await src.pageSizePt(i + k); }));
    onProgress?.(Math.min(src.pageCount, i + BATCH), src.pageCount);
  }
  for (let i = 0; i < src.pageCount; i++) {
    const p = createPage(Math.round(sizes[i].w * PDF_K), Math.round(sizes[i].h * PDF_K), `Page ${i + 1}`, { color: '#ffffff', pdfPage: i });
    p.layers.push(createVectorLayer('Annotations'));
    doc.pages.push(p);
  }
  const id = uid('as');
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  doc.assets.set(id, { id, name: name, mime: 'application/pdf', kind: 'pdf', blob });
  doc.pdfAssetId = id;
  registerAssetBlob(id, blob);
  try { doc.outline = await src.getOutline(); } catch { doc.outline = []; }
  const ed = new Editor(doc);
  ed.isNew = true;
  return ed;
}

/** After loading a saved document that embeds a PDF, re-create its pdf.js source. */
export async function ensurePdfSource(doc: QDocument): Promise<void> {
  if (!doc.pdfAssetId || getPdfSource(doc.id)) return;
  const a = doc.assets.get(doc.pdfAssetId);
  if (!a) return;
  const src = await PdfSource.load(doc.id, new Uint8Array(await a.blob.arrayBuffer()));
  setPdfSource(doc.id, src);
}
