// Libraries: shapes, gradients, patterns, paper templates, signatures, fonts.

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../../editor/editor';
import { Seg } from '../common';
import { GRADIENTS, SHAPES, ShapeDef } from '../../assets/libraries';
import { PATTERNS, patternTile } from '../../core/patterns';
import { TEMPLATES, drawTemplate, makeTemplate } from '../../core/templates';
import { parsePathData } from '../../io/svg';
import { baseObject, solid } from '../../core/model';
import type { VPath } from '../../core/model';
import { addObject } from '../../editor/objectOps';
import { IDENTITY, mMul, mScale, mTranslate } from '../../core/geometry';
import { uid, createCanvas, ctx2d, blobToImage } from '../../core/util';
import { prefs } from '../../app/store';
import { Icon } from '../icons';
import { openDialog, toast } from '../../app/bus';
import { pickFiles } from '../../app/actions';
import { loadFontFile } from '../../io/importers';
import { setPageBackground, addPage } from '../../editor/pageOps';
import { placeImageBlob } from '../../editor/rasterOps';
import { loadSystemFonts } from '../fonts';

export function insertShape(ed: Editor, s: ShapeDef, size = 180) {
  const paths = parsePathData(s.d);
  const vis = ed.view.visibleWorldRect(), wr = ed.worldRectOf(ed.page);
  const cx = Math.min(Math.max(vis.x + vis.w / 2, wr.x), wr.x + wr.w) - wr.x, cy = Math.min(Math.max(vis.y + vis.h / 2, wr.y), wr.y + wr.h) - wr.y;
  const k = size / 100;
  const o: VPath = { ...baseObject(), id: uid('ob'), type: 'path', paths, fillRule: s.evenodd ? 'evenodd' : 'nonzero', name: s.name, fill: ed.opts.shapeFill ?? solid(ed.fg), stroke: ed.opts.shapeStroke, tf: mMul(mTranslate(cx - size / 2, cy - size / 2), mScale(k, k)) };
  // scale stroke so it doesn't thicken with the transform
  if (o.stroke) o.stroke = { ...o.stroke };
  addObject(ed, o, `Insert ${s.name}`);
  ed.setTool('move');
}

function ShapeThumb({ s }: { s: ShapeDef }) {
  return <svg viewBox="0 0 100 100" width="100%" height="100%"><path d={s.d} fill="currentColor" fillRule={s.evenodd ? 'evenodd' : 'nonzero'} /></svg>;
}
function PatternThumb({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current!; const x = c.getContext('2d')!; const t = patternTile(id, getComputedStyle(c).color); if (t) { x.fillStyle = x.createPattern(t, 'repeat')!; x.fillRect(0, 0, c.width, c.height); } }, [id]);
  return <canvas ref={ref} width={56} height={56} style={{ width: 56, height: 56, borderRadius: 6, border: '1px solid var(--line)', color: 'var(--text-dim)' }} />;
}
function TemplateThumb({ idx }: { idx: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current!; const x = c.getContext('2d')!; x.fillStyle = '#fffdf8'; x.fillRect(0, 0, c.width, c.height); const k = c.width / 1240; x.save(); x.scale(k, k); drawTemplate(x, makeTemplate(TEMPLATES[idx]), 1240, 1754, k); x.restore(); }, [idx]);
  return <canvas ref={ref} width={110} height={156} />;
}

export function AssetsPanel({ ed }: { ed: Editor }) {
  const [tab, setTab] = useState<'shapes' | 'gradients' | 'patterns' | 'templates' | 'more'>('shapes');
  const sigs = prefs.useSelect((p) => p.signatures);
  const [sysFonts, setSysFonts] = useState<string[] | null>(null);
  const groups = [...new Set(SHAPES.map((s) => s.group))];
  return (
    <div className="col">
      <Seg value={tab} onChange={setTab} options={[{ value: 'shapes', label: 'Shapes' }, { value: 'gradients', label: 'Gradients' }, { value: 'patterns', label: 'Patterns' }, { value: 'templates', label: 'Paper' }, { value: 'more', label: 'More' }]} />
      {tab === 'shapes' && groups.map((g) => (
        <div key={g}><div className="hint" style={{ marginBottom: 4 }}>{g}</div>
          <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {SHAPES.filter((s) => s.group === g).map((s) => <button key={s.id} className="preset" style={{ padding: 8, aspectRatio: '1', color: 'var(--text-dim)' }} title={`${s.name} — click to insert`} onClick={() => insertShape(ed, s)}><ShapeThumb s={s} /></button>)}
          </div></div>
      ))}
      {tab === 'shapes' && <div className="hint">Shapes insert as editable vector paths using your fill and stroke colours.</div>}
      {tab === 'gradients' && (<>
        <div className="hint">Click to use with the Gradient tool, right-click to apply to selected objects.</div>
        <div className="col" style={{ gap: 6 }}>
          {GRADIENTS.map((g) => (
            <button key={g.id} className="brush-card" onClick={() => { ed.setToolOpts({ gradientStops: g.stops, gradientUseFgBg: false }); ed.setTool('gradient'); }}
              onContextMenu={(e) => { e.preventDefault(); import('../../editor/objectOps').then(({ updateSelected }) => updateSelected(ed, (o) => ({ ...o, fill: { kind: 'linear', stops: g.stops, x1: 0, y1: 0, x2: 1, y2: 1 } }), 'Gradient fill')); }}>
              <div style={{ height: 26, borderRadius: 5, background: `linear-gradient(90deg, ${g.stops.map((s) => `${s.color} ${s.pos * 100}%`).join(',')})` }} /><div className="n">{g.name}</div>
            </button>
          ))}
        </div>
      </>)}
      {tab === 'patterns' && (<>
        <div className="hint">Click to fill with the Paint Bucket / Fill command; right-click to fill selected objects.</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {PATTERNS.map((p) => <button key={p.id} className="preset" style={{ padding: 4 }} title={p.label} onClick={() => { ed.setToolOpts({ fillMode: 'pattern', fillPattern: p.id }); ed.setTool('bucket'); toast(`Pattern “${p.label}” selected for the paint bucket`); }}
            onContextMenu={(e) => { e.preventDefault(); import('../../editor/objectOps').then(({ updateSelected }) => updateSelected(ed, (o) => ({ ...o, fill: { kind: 'pattern', pattern: p.id, scale: 1.5, color: ed.fg } }), 'Pattern fill')); }}><PatternThumb id={p.id} /></button>)}
        </div>
      </>)}
      {tab === 'templates' && (<>
        <div className="hint">Paper templates are drawn as vectors, so they stay sharp at any zoom and in exports.</div>
        <div className="grid2" style={{ gap: 10 }}>
          {TEMPLATES.map((t, i) => (
            <div key={i} className="tpl-card">
              <TemplateThumb idx={i} />
              <div>{t.label}</div>
              <div className="row" style={{ justifyContent: 'center', gap: 4, marginTop: 4 }}>
                <button className="btn sm" onClick={() => setPageBackground(ed, { template: makeTemplate(t) })}>This page</button>
                <button className="btn sm" onClick={() => addPage(ed, { template: makeTemplate(t) })}>New page</button>
              </div>
            </div>
          ))}
          <div className="tpl-card" style={{ display: 'grid', placeItems: 'center', cursor: 'pointer' }} onClick={() => setPageBackground(ed, { template: null })}>No template</div>
        </div>
      </>)}
      {tab === 'more' && (<>
        <div className="hint">Signatures</div>
        <div className="row wrap">
          {sigs.map((s, i) => <button key={i} className="preset" style={{ padding: 4, background: '#fff' }} title="Click to place" onClick={async () => { const b = await (await fetch(s)).blob(); await placeImageBlob(ed, b, 'Signature', { asObject: true }); }} onContextMenu={(e) => { e.preventDefault(); prefs.set({ signatures: sigs.filter((_, k) => k !== i) }); }}><img src={s} style={{ height: 40, display: 'block' }} /></button>)}
          <button className="btn sm" onClick={() => openDialog('signature')}><Icon name="signature" size={14} />Create…</button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>Fonts</div>
        <div className="row wrap">
          <button className="btn sm" onClick={async () => { const fs = await pickFiles('.ttf,.otf,.woff,.woff2', true); for (const f of fs) { try { const fam = await loadFontFile(f); prefs.set({ fonts: [...new Set([fam, ...prefs.get().fonts])] }); toast(`Font “${fam}” added`, 'success'); } catch { toast(`Could not load ${f.name}`, 'error'); } } }}><Icon name="text" size={14} />Add font file…</button>
          <button className="btn sm" onClick={async () => { const f = await loadSystemFonts(); setSysFonts(f); if (!f.length) toast('Your browser does not expose installed fonts', 'info'); else prefs.set({ fonts: [...new Set([...f.slice(0, 400), ...prefs.get().fonts])] }); }}>Load system fonts</button>
        </div>
        {sysFonts && <div className="hint">{sysFonts.length} system fonts available in the text tool.</div>}
        <div className="hint" style={{ marginTop: 6 }}>Images</div>
        <button className="btn sm" onClick={async () => { const fs = await pickFiles('image/*', true); for (const f of fs) await placeImageBlob(ed, f, f.name, { asObject: ed.doc.kind !== 'drawing' }); }}><Icon name="image" size={14} />Place image…</button>
      </>)}
    </div>
  );
}
void IDENTITY; void createCanvas; void ctx2d; void blobToImage;
