// Cheap shallow snapshots of the document structure for undo/redo.
// Vector objects are immutable and RasterSurfaces are shared by reference, so a snapshot only
// copies the layer tree skeleton + object arrays (O(#layers + #objects) references).

import type { Layer, Page, QDocument, PageLayout, OutlineItem } from './model';

export function cloneLayer(l: Layer): Layer {
  const base = { ...l, effects: l.effects.map((e) => ({ ...e })) } as Layer;
  switch (l.type) {
    case 'group': (base as typeof l).children = l.children.map(cloneLayer); break;
    case 'vector': (base as typeof l).objects = l.objects.slice(); break;
    case 'adjustment': (base as typeof l).adj = { ...l.adj } as typeof l.adj; break;
    default: break;
  }
  return base;
}
export function clonePage(p: Page): Page {
  return {
    ...p,
    background: { ...p.background, template: p.background.template ? { ...p.background.template } : null, image: p.background.image ? { ...p.background.image } : null },
    layers: p.layers.map(cloneLayer),
    guides: p.guides.map((g) => ({ ...g })),
  };
}

export interface DocSnapshot {
  /** true → `pages` is the complete ordered page list; false → only these pages are restored (matched by id) */
  all: boolean;
  pages: Page[];
  layout: PageLayout;
  outline: OutlineItem[];
  title: string;
  cost: number;
}

function costOf(pages: Page[]): number {
  let n = 0;
  const walk = (ls: Layer[]) => { for (const l of ls) { n += 300; if (l.type === 'vector') n += l.objects.length * 8; if (l.type === 'group') walk(l.children); } };
  for (const p of pages) { n += 400; walk(p.layers); }
  return n;
}

/** `pageIds` limits the snapshot to the given pages; omit for a full snapshot (needed for add/remove/reorder). */
export function snapshotDoc(doc: QDocument, pageIds?: string[]): DocSnapshot {
  const pages = (pageIds ? doc.pages.filter((p) => pageIds.includes(p.id)) : doc.pages).map(clonePage);
  return { all: !pageIds, pages, layout: doc.layout, outline: doc.outline, title: doc.title, cost: costOf(pages) };
}
export function restoreDoc(doc: QDocument, s: DocSnapshot) {
  if (s.all) doc.pages = s.pages.map(clonePage);
  else {
    for (const sp of s.pages) {
      const i = doc.pages.findIndex((p) => p.id === sp.id);
      if (i >= 0) doc.pages[i] = clonePage(sp);
    }
  }
  doc.layout = s.layout;
  doc.outline = s.outline;
  doc.title = s.title;
  doc.modified = Date.now();
}
