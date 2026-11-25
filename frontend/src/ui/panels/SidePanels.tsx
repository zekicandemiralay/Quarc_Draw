// Pages panel: thumbnails of the document's pages (artboards) with add / duplicate / delete / reorder.

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import { renderPageToCanvas } from '../../core/render';
import * as P from '../../editor/pageOps';
import { Icon } from '../icons';
import { PopButton, MenuList } from '../common';
import { openDialog } from '../../app/bus';

function PageThumb({ ed, index, w }: { ed: Editor; index: number; w: number }) {
  const page = ed.doc.pages[index];
  const ref = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  const tick = useEditor(ed, ['doc', 'layers'], () => ed.versions.doc + ed.versions.layers);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVis(e.isIntersecting), { rootMargin: '300px' });
    if (holder.current) io.observe(holder.current);
    return () => io.disconnect();
  }, []);
  const h = Math.round((w * page.height) / page.width);
  useEffect(() => {
    if (!vis) return;
    const t = setTimeout(() => {
      const c = ref.current; if (!c) return;
      const k = (w * (window.devicePixelRatio || 1)) / page.width;
      const r = renderPageToCanvas(ed.doc, page, k);
      c.width = r.width; c.height = r.height; c.getContext('2d')!.drawImage(r, 0, 0);
    }, 80);
    return () => clearTimeout(t);
  }, [vis, tick, page, w, ed]);
  return <div ref={holder} style={{ width: w, height: h }}><canvas ref={ref} style={{ width: w, height: h }} /></div>;
}

export function PagesPanel({ ed, wide }: { ed: Editor; wide?: boolean }) {
  const pages = useEditor(ed, ['doc', 'page'], () => ed.doc.pages.length + ':' + ed.activePageId);
  void pages;
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const w = wide ? 150 : 110;
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => { wrap.current?.querySelector('.thumb-page.on')?.scrollIntoView({ block: 'nearest' }); }, [ed.activePageId]);
  return (
    <>
      <div className="thumbs" ref={wrap}>
        {ed.doc.pages.map((p, i) => (
          <div key={p.id} className={`thumb-page ${p.id === ed.activePageId ? 'on' : ''} ${over === i && drag !== null && drag !== i ? 'drop' : ''}`}
            draggable onDragStart={() => setDrag(i)} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragEnd={() => { setDrag(null); setOver(null); }}
            onDrop={() => { if (drag !== null && drag !== i) P.movePage(ed, drag, i); setDrag(null); setOver(null); }}
            onClick={() => ed.goToPage(i)}
            onContextMenu={(e) => { e.preventDefault(); ed.goToPage(i); }}>
            <PageThumb ed={ed} index={i} w={w} />
            <div className="num">{p.name === `Page ${i + 1}` || !p.name ? i + 1 : `${i + 1} · ${p.name}`}</div>
          </div>
        ))}
      </div>
      <div className="row" style={{ padding: 6, borderTop: '1px solid var(--line)', justifyContent: 'space-between' }}>
        <button className="btn ghost icon sm" title="Add page" onClick={() => P.addPage(ed)}><Icon name="plus" size={15} /></button>
        <button className="btn ghost icon sm" title="Duplicate page" onClick={() => P.duplicatePage(ed)}><Icon name="copy" size={15} /></button>
        <PopButton className="btn ghost icon sm" title="More" content={(close) => <MenuList ed={ed} onDone={close} items={[{ command: 'page.setup' }, { command: 'page.goto' }, { separator: true }, { label: 'Move up', onClick: () => P.movePage(ed, ed.pageIndex, ed.pageIndex - 1) }, { label: 'Move down', onClick: () => P.movePage(ed, ed.pageIndex, ed.pageIndex + 1) }, { separator: true }, { label: 'Rename page…', onClick: () => openDialog('prompt', { title: 'Rename page', fields: [{ key: 'name', label: 'Name', type: 'text', value: ed.page.name }], ok: (v: any) => P.renamePage(ed, ed.pageIndex, v.name) }) }]} />}><Icon name="more" size={15} /></PopButton>
        <button className="btn ghost icon sm" title="Delete page" onClick={() => P.deletePage(ed)}><Icon name="trash" size={15} /></button>
      </div>
    </>
  );
}
