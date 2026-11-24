// pdf.js wrapper: page rendering with a resolution-aware cache, text extraction, outline and search.

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Vec } from '../core/geometry';
import { hooks } from '../core/render';
import type { OutlineItem, Page, QDocument } from '../core/model';
import { Emitter, createCanvas } from '../core/util';

// pdf.js is large – load it only when a PDF is actually opened
let pdfjsP: Promise<typeof import('pdfjs-dist')> | null = null;
const loadPdfjs = () => (pdfjsP ??= import('pdfjs-dist').then((m) => { m.GlobalWorkerOptions.workerSrc = workerUrl; return m; }));

export const PDF_DPI = 150;
export const PDF_K = PDF_DPI / 72; // page units per PDF point

export const pdfEvents = new Emitter<{ ready: { docId: string; page: number } }>();

export interface TextBox {
  str: string;
  ox: number; oy: number;      // baseline origin (page units)
  ux: number; uy: number;      // unit vector along the text
  tx: number; ty: number;      // unit vector from baseline towards glyph top
  width: number; height: number;
}
export interface PageText { boxes: TextBox[] }

export class PdfSource {
  doc!: PDFDocumentProxy;
  private task: any = null;
  bytes!: Uint8Array;
  pageCount = 0;
  private textCache = new Map<number, Promise<PageText>>();
  private renders = new Map<number, { canvas: HTMLCanvasElement; scale: number; last: number }>();
  private pending = new Set<string>();
  private totalPixels = 0;
  constructor(public docId: string) {}

  static async load(docId: string, bytes: Uint8Array): Promise<PdfSource> {
    const s = new PdfSource(docId);
    s.bytes = bytes;
    const pdfjs = await loadPdfjs();
    s.task = pdfjs.getDocument({ data: bytes.slice() });
    s.doc = await s.task.promise;
    s.pageCount = s.doc.numPages;
    return s;
  }
  destroy() { void this.task?.destroy?.(); this.renders.clear(); }

  async pageSizePt(i: number): Promise<{ w: number; h: number }> {
    const p = await this.doc.getPage(i + 1);
    const v = p.getViewport({ scale: 1 });
    return { w: v.width, h: v.height };
  }

  /** synchronous cache lookup used by the renderer; schedules a (re)render if the cached bitmap is too coarse */
  bitmapFor(i: number, ptScale: number): HTMLCanvasElement | null {
    const hit = this.renders.get(i);
    const need = Math.min(Math.max(ptScale, 0.2), 6);
    if (hit) hit.last = performance.now();
    if (!hit || hit.scale < need * 0.85) {
      const target = Math.min(6, Math.max(0.5, Math.pow(1.4, Math.ceil(Math.log(need) / Math.log(1.4)))));
      void this.render(i, target);
    }
    return hit?.canvas ?? null;
  }

  private async render(i: number, scale: number) {
    const key = `${i}:${scale.toFixed(2)}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    try {
      const page = await this.doc.getPage(i + 1);
      let viewport = page.getViewport({ scale });
      const maxDim = 4600;
      if (Math.max(viewport.width, viewport.height) > maxDim) viewport = page.getViewport({ scale: scale * (maxDim / Math.max(viewport.width, viewport.height)) });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport } as any).promise;
      const prev = this.renders.get(i);
      if (prev) this.totalPixels -= prev.canvas.width * prev.canvas.height;
      this.renders.set(i, { canvas, scale: viewport.scale, last: performance.now() });
      this.totalPixels += canvas.width * canvas.height;
      this.evict(i);
      pdfEvents.emit('ready', { docId: this.docId, page: i });
    } catch (e) {
      console.warn('PDF render failed', e);
    } finally { this.pending.delete(key); }
  }
  private evict(keep: number) {
    const MAX = 90_000_000; // ~360MB of RGBA
    while (this.totalPixels > MAX && this.renders.size > 3) {
      let oldest = -1, t = Infinity;
      for (const [k, v] of this.renders) if (k !== keep && v.last < t) { t = v.last; oldest = k; }
      if (oldest < 0) break;
      const v = this.renders.get(oldest)!;
      this.totalPixels -= v.canvas.width * v.canvas.height;
      this.renders.delete(oldest);
    }
  }

  /** Text boxes of a page in page units (k = page units per point). */
  getText(i: number, k = PDF_K): Promise<PageText> {
    let p = this.textCache.get(i);
    if (!p) {
      p = (async () => {
        const page = await this.doc.getPage(i + 1);
        const viewport = page.getViewport({ scale: k });
        const tc = await page.getTextContent();
        const boxes: TextBox[] = [];
        const M = viewport.transform; // [a b c d e f]
        for (const it of tc.items as any[]) {
          if (!it.str || !it.str.trim()) continue;
          const t = it.transform as number[];
          // text space → viewport
          const a = M[0] * t[0] + M[2] * t[1], b = M[1] * t[0] + M[3] * t[1];
          const c = M[0] * t[2] + M[2] * t[3], d = M[1] * t[2] + M[3] * t[3];
          const e = M[0] * t[4] + M[2] * t[5] + M[4], f = M[1] * t[4] + M[3] * t[5] + M[5];
          const la = Math.hypot(a, b) || 1, lc = Math.hypot(c, d) || 1;
          boxes.push({
            str: it.str, ox: e, oy: f, ux: a / la, uy: b / la,
            // glyph "up" in viewport space: (c,d) points toward glyph top
            tx: c / lc, ty: d / lc, width: (it.width as number) * k, height: lc,
          });
        }
        return { boxes };
      })();
      this.textCache.set(i, p);
    }
    return p;
  }

  async getOutline(): Promise<OutlineItem[]> {
    const raw = await this.doc.getOutline();
    if (!raw) return [];
    const conv = async (items: any[]): Promise<OutlineItem[]> => {
      const out: OutlineItem[] = [];
      for (const it of items) {
        let page = 0;
        try {
          let dest = it.dest;
          if (typeof dest === 'string') dest = await this.doc.getDestination(dest);
          if (Array.isArray(dest) && dest[0]) page = typeof dest[0] === 'object' ? await this.doc.getPageIndex(dest[0]) : (dest[0] as number);
        } catch { /* unresolved */ }
        out.push({ title: it.title || 'Untitled', page, children: it.items?.length ? await conv(it.items) : [] });
      }
      return out;
    };
    return conv(raw);
  }

  /** find `query` on every page; returns hits with page-space quads */
  async search(query: string, k = PDF_K, onProgress?: (page: number) => void): Promise<{ page: number; quads: Vec[][]; snippet: string }[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const res: { page: number; quads: Vec[][]; snippet: string }[] = [];
    for (let i = 0; i < this.pageCount; i++) {
      const pt = await this.getText(i, k);
      for (const box of pt.boxes) {
        const hay = box.str.toLowerCase();
        let idx = hay.indexOf(q);
        while (idx >= 0) {
          res.push({ page: i, quads: [quadFor(box, idx, idx + q.length)], snippet: box.str.slice(Math.max(0, idx - 24), idx + q.length + 40) });
          idx = hay.indexOf(q, idx + q.length);
        }
      }
      onProgress?.(i);
    }
    return res;
  }
}

/** quad (4 points, page units) covering characters [c0,c1) of a text box */
export function quadFor(b: TextBox, c0: number, c1: number): Vec[] {
  const n = Math.max(1, b.str.length);
  const s = (c0 / n) * b.width, e = (c1 / n) * b.width;
  // (ux,uy) runs along the baseline, (tx,ty) points from the baseline toward the glyph tops (both in page units)
  const P = (along: number, up: number): Vec => ({ x: b.ox + b.ux * along + b.tx * up, y: b.oy + b.uy * along + b.ty * up });
  return [P(s, 0.92 * b.height), P(e, 0.92 * b.height), P(e, -0.24 * b.height), P(s, -0.24 * b.height)];
}

// ---------------- registry ----------------
const sources = new Map<string, PdfSource>();
export const getPdfSource = (docId: string) => sources.get(docId);
export function setPdfSource(docId: string, s: PdfSource) { sources.set(docId, s); }
export function dropPdfSource(docId: string) { sources.get(docId)?.destroy(); sources.delete(docId); }

hooks.pdfPage = (doc: QDocument, page: Page, scale: number) => {
  const src = sources.get(doc.id);
  if (!src || page.background.pdfPage === null) return null;
  // device px per page unit → device px per pdf point
  return src.bitmapFor(page.background.pdfPage, scale * PDF_K);
};
export type { Vec };
