// PDF / document text search state (shared between the search panel and the canvas overlay).

import { Store } from '../app/store';
import type { Vec } from '../core/geometry';
import type { Editor } from '../editor/editor';
import { getPdfSource } from './pdfSource';
import { walkObjects } from '../core/model';
import { objectBounds } from '../core/vector';

export interface SearchHit { page: number; quads: Vec[][]; snippet: string }
export interface SearchState { query: string; hits: SearchHit[]; current: number; busy: boolean }
export const searchState = new Store<SearchState>(null, { query: '', hits: [], current: 0, busy: false });

let token = 0;
export async function runSearch(ed: Editor, query: string) {
  const t = ++token;
  searchState.set({ query, hits: [], current: 0, busy: !!query.trim() });
  if (!query.trim()) return;
  const hits: SearchHit[] = [];
  const src = getPdfSource(ed.doc.id);
  if (src) {
    const found = await src.search(query, undefined, () => { /* progress */ });
    if (t !== token) return;
    // map pdf page index → document page index
    for (const f of found) {
      const di = ed.doc.pages.findIndex((p) => p.background.pdfPage === f.page);
      if (di >= 0) hits.push({ page: di, quads: f.quads, snippet: f.snippet });
    }
  }
  // text objects / notes in the document
  const q = query.toLowerCase();
  ed.doc.pages.forEach((p, pi) => walkObjects(p, (o) => {
    const txt = o.type === 'text' ? o.text : o.type === 'note' ? o.text : o.type === 'markup' ? o.quote + ' ' + o.comment : '';
    if (txt && txt.toLowerCase().includes(q)) {
      const b = objectBounds(o, false);
      hits.push({ page: pi, quads: [[{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]], snippet: txt.slice(0, 80) });
    }
  }));
  hits.sort((a, b) => a.page - b.page);
  if (t !== token) return;
  searchState.set({ query, hits, current: 0, busy: false });
  if (hits.length) goToHit(ed, 0);
}
export function goToHit(ed: Editor, i: number) {
  const st = searchState.get();
  if (!st.hits.length) return;
  const n = (i + st.hits.length) % st.hits.length;
  searchState.set({ current: n });
  const h = st.hits[n];
  ed.goToPage(h.page);
  // centre on the hit
  const q = h.quads[0], r = ed.worldRectOf(ed.doc.pages[h.page]);
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length, cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  ed.view.cx = r.x + cx; ed.view.cy = r.y + cy;
  ed.changed('view');
}
export function clearSearch() { token++; searchState.set({ query: '', hits: [], current: 0, busy: false }); }
