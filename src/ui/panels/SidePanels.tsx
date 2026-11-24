// Pages / outline / search / annotations panels (notes + reader workflows).

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../../editor/editor';
import { useEditor } from '../../editor/editor';
import { renderPageToCanvas } from '../../core/render';
import type { OutlineItem } from '../../core/model';
import { walkObjects } from '../../core/model';
import * as P from '../../editor/pageOps';
import { Icon } from '../icons';
import { searchState, runSearch, goToHit, clearSearch } from '../../pdf/search';
import { objectBounds } from '../../core/vector';
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
  // PDF page bitmaps arrive asynchronously → refresh a moment later
  useEffect(() => { if (vis && page.background.pdfPage !== null) { const t = setTimeout(() => { const c = ref.current; if (c) { const k = (w * (window.devicePixelRatio || 1)) / page.width; const r = renderPageToCanvas(ed.doc, page, k); c.width = r.width; c.height = r.height; c.getContext('2d')!.drawImage(r, 0, 0); } }, 700); return () => clearTimeout(t); } }, [vis, page, w, ed]);
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
            {p.bookmark && <span className="bm"><Icon name="bookmark" size={14} /></span>}
            <div className="num">{p.name === `Page ${i + 1}` || !p.name ? i + 1 : `${i + 1} · ${p.name}`}</div>
          </div>
        ))}
      </div>
      <div className="row" style={{ padding: 6, borderTop: '1px solid var(--line)', justifyContent: 'space-between' }}>
        <button className="btn ghost icon sm" title="Add page" onClick={() => P.addPage(ed)}><Icon name="plus" size={15} /></button>
        <button className="btn ghost icon sm" title="Duplicate page" onClick={() => P.duplicatePage(ed)}><Icon name="copy" size={15} /></button>
        <button className="btn ghost icon sm" title="Bookmark page" onClick={() => P.toggleBookmark(ed)}><Icon name="bookmark" size={15} /></button>
        <PopButton className="btn ghost icon sm" title="More" content={(close) => <MenuList ed={ed} onDone={close} items={[{ command: 'page.setup' }, { command: 'page.goto' }, { separator: true }, { label: 'Move up', onClick: () => P.movePage(ed, ed.pageIndex, ed.pageIndex - 1) }, { label: 'Move down', onClick: () => P.movePage(ed, ed.pageIndex, ed.pageIndex + 1) }, { separator: true }, { label: 'Rename page…', onClick: () => openDialog('prompt', { title: 'Rename page', fields: [{ key: 'name', label: 'Name', type: 'text', value: ed.page.name }], ok: (v: any) => P.renamePage(ed, ed.pageIndex, v.name) }) }]} />}><Icon name="more" size={15} /></PopButton>
        <button className="btn ghost icon sm" title="Delete page" onClick={() => P.deletePage(ed)}><Icon name="trash" size={15} /></button>
      </div>
    </>
  );
}

function OutlineNode({ ed, item, depth }: { ed: Editor; item: OutlineItem; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const go = () => { const di = ed.doc.pages.findIndex((p) => p.background.pdfPage === item.page); ed.goToPage(di >= 0 ? di : item.page); };
  return (
    <>
      <div className="outline-item" style={{ paddingLeft: 6 + depth * 14 }} onClick={go}>
        {item.children.length ? <span onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} /></span> : <span style={{ width: 13 }} />}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span><span className="pg">{item.page + 1}</span>
      </div>
      {open && item.children.map((c, i) => <OutlineNode key={i} ed={ed} item={c} depth={depth + 1} />)}
    </>
  );
}
export function OutlinePanel({ ed }: { ed: Editor }) {
  useEditor(ed, ['doc'], () => ed.versions.doc);
  const marks = ed.doc.pages.map((p, i) => ({ p, i })).filter((x) => x.p.bookmark);
  return (
    <div className="thumbs" style={{ alignItems: 'stretch', gap: 2 }}>
      <div className="hint" style={{ padding: '2px 6px' }}>Bookmarks</div>
      {marks.length ? marks.map(({ p, i }) => <div key={p.id} className="outline-item" onClick={() => ed.goToPage(i)}><Icon name="bookmark" size={13} />{p.name || `Page ${i + 1}`}<span className="pg">{i + 1}</span></div>) : <div className="hint" style={{ padding: '2px 6px 10px' }}>None yet — press Ctrl+B on a page.</div>}
      <div className="hint" style={{ padding: '10px 6px 2px' }}>Contents</div>
      {ed.doc.outline.length ? ed.doc.outline.map((o, i) => <OutlineNode key={i} ed={ed} item={o} depth={0} />) : <div className="hint" style={{ padding: '2px 6px' }}>This document has no table of contents.</div>}
    </div>
  );
}

export function SearchPanel({ ed }: { ed: Editor }) {
  const st = searchState.use();
  const [q, setQ] = useState(st.query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const mark = (s: string) => { const i = s.toLowerCase().indexOf(st.query.toLowerCase()); return i < 0 || !st.query ? s : <>{s.slice(0, i)}<mark>{s.slice(i, i + st.query.length)}</mark>{s.slice(i + st.query.length)}</>; };
  return (
    <div className="col" style={{ padding: 8, minHeight: 0, flex: 1 }}>
      <div className="row">
        <input ref={input} className="input grow" style={{ flex: 1 }} placeholder="Find in document…" value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { if (e.shiftKey) goToHit(ed, st.current - 1); else if (q === st.query && st.hits.length) goToHit(ed, st.current + 1); else void runSearch(ed, q); } if (e.key === 'Escape') { clearSearch(); setQ(''); } }} />
        <button className="btn ghost icon sm" onClick={() => runSearch(ed, q)}><Icon name="search" size={15} /></button>
      </div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="hint">{st.busy ? 'Searching…' : st.query ? `${st.hits.length} result${st.hits.length === 1 ? '' : 's'}` : 'Searches PDF text, text boxes, notes and comments'}</span>
        <span><button className="btn ghost icon sm" disabled={!st.hits.length} onClick={() => goToHit(ed, st.current - 1)}><Icon name="chevron-up" size={14} /></button><button className="btn ghost icon sm" disabled={!st.hits.length} onClick={() => goToHit(ed, st.current + 1)}><Icon name="chevron-down" size={14} /></button></span>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {st.hits.slice(0, 500).map((h, i) => (
          <div key={i} className={`hit ${i === st.current ? 'on' : ''}`} onClick={() => goToHit(ed, i)}>
            <div className="hint">Page {h.page + 1}</div><div className="snip">{mark(h.snippet)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AnnotationsPanel({ ed }: { ed: Editor }) {
  useEditor(ed, ['doc'], () => ed.versions.doc);
  const items: { pi: number; id: string; kind: string; text: string; color?: string; comment?: string }[] = [];
  ed.doc.pages.forEach((p, pi) => walkObjects(p, (o) => {
    if (o.type === 'markup') items.push({ pi, id: o.id, kind: o.kind, text: o.quote, color: o.color, comment: o.comment });
    else if (o.type === 'note') items.push({ pi, id: o.id, kind: 'note', text: o.text || '(empty note)', color: o.color });
    else if (o.type === 'text') items.push({ pi, id: o.id, kind: 'text', text: o.text });
  }));
  return (
    <div className="thumbs" style={{ alignItems: 'stretch', gap: 4 }}>
      {!items.length && <div className="hint" style={{ padding: 8 }}>No annotations yet. Highlight text, add notes or text boxes and they will be listed here.</div>}
      {items.map((it) => (
        <div key={it.id} className="hit" onClick={() => { ed.goToPage(it.pi); ed.objSel = [it.id]; ed.changed('objsel'); const f = ed.doc.pages[it.pi]; walkObjects(f, (o) => { if (o.id === it.id) { const b = objectBounds(o); const r = ed.worldRectOf(f); ed.view.cx = r.x + b.x + b.w / 2; ed.view.cy = r.y + b.y + b.h / 2; ed.changed('view'); } }); }}>
          <div className="row"><span style={{ width: 10, height: 10, borderRadius: 3, background: it.color ?? 'var(--text-faint)' }} /><b style={{ textTransform: 'capitalize' }}>{it.kind}</b><span className="hint" style={{ marginLeft: 'auto' }}>p. {it.pi + 1}</span></div>
          <div className="snip">{it.text.slice(0, 140)}</div>
          {it.comment && <div className="snip" style={{ color: 'var(--accent-hi)' }}>💬 {it.comment}</div>}
        </div>
      ))}
    </div>
  );
}
