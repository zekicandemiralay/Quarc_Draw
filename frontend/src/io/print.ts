// Print the document (all pages or current) through the browser print dialog.

import type { Editor } from '../editor/editor';
import { renderPageToCanvas } from '../core/render';
import { canvasToBlob } from '../core/util';

export async function printDocument(ed: Editor, allPages = true) {
  const pages = allPages ? ed.doc.pages : [ed.page];
  const urls: { url: string; w: number; h: number }[] = [];
  for (const p of pages) {
    const s = Math.min(1.5, 2400 / Math.max(p.width, p.height));
    const c = renderPageToCanvas(ed.doc, p, s);
    urls.push({ url: URL.createObjectURL(await canvasToBlob(c)), w: p.width, h: p.height });
  }
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><title>${ed.doc.title.replace(/</g, '&lt;')}</title><style>
    @page { margin: 0 } html,body{margin:0;padding:0}
    img{display:block;width:100%;height:auto;page-break-after:always;break-after:page}
  </style>${urls.map((u) => `<img src="${u.url}">`).join('')}`);
  doc.close();
  await new Promise((r) => setTimeout(r, 400));
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
  setTimeout(() => { frame.remove(); urls.forEach((u) => URL.revokeObjectURL(u.url)); }, 60000);
}
