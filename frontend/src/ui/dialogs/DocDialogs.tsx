// New document, export, image size, canvas size dialogs.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, NumInput, Seg, Slider, Field, Switch } from '../common';
import { Icon } from '../icons';
import { ColorButton } from '../ColorPicker';
import type { Editor } from '../../editor/editor';
import { SIZE_PRESETS, NOTE_PAGE, unitFactor, Units } from '../../core/model';
import { TEMPLATES, drawTemplate, makeTemplate } from '../../core/templates';
import { createDrawing, createNotebook, createWhiteboard, openFileDialog, pickFiles, openFiles } from '../../app/actions';
import { prefs } from '../../app/store';
import { newDocument } from '../../editor/editor';
import { workspace } from '../../app/workspace';
import { exportDocument, defaultExportOptions, ExportOptions, ExportFormat, FORMAT_INFO } from '../../io/exporters';
import { downloadBlob, formatBytes, canvasToBlob } from '../../core/util';
import { toast } from '../../app/bus';
import { renderPageToCanvas } from '../../core/render';
import * as P from '../../editor/pageOps';
import type { Anchor } from '../../editor/pageOps';

// ------------------------------------------------------------------ New
function TemplateCanvas({ idx, color }: { idx: number; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const c = ref.current!, x = c.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); const k = c.width / 1240; x.save(); x.scale(k, k); drawTemplate(x, makeTemplate(TEMPLATES[idx]), 1240, 1754, k); x.restore(); }, [idx, color]);
  return <canvas ref={ref} width={120} height={170} />;
}

export function NewDocDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'drawing' | 'notebook' | 'pdf' | 'whiteboard'>(prefs.get().workspace === 'studio' ? 'drawing' : prefs.get().workspace === 'reader' ? 'pdf' : 'notebook');
  const [preset, setPreset] = useState('hd');
  const [w, setW] = useState(1920), [h, setH] = useState(1080), [dpi, setDpi] = useState(96);
  const [bg, setBg] = useState<string>('#ffffff'), [transparent, setTransparent] = useState(false);
  const [title, setTitle] = useState('Untitled');
  const [tpl, setTpl] = useState(0), [pages, setPages] = useState(1), [paper, setPaper] = useState('#fffdf8');
  const groups = useMemo(() => [...new Set(SIZE_PRESETS.map((p) => p.group))], []);
  const pick = (id: string) => { const p = SIZE_PRESETS.find((x) => x.id === id)!; setPreset(id); setW(p.w); setH(p.h); setDpi(p.dpi ?? 96); };
  const create = () => {
    if (tab === 'drawing') createDrawing({ title: title || 'Untitled', width: Math.round(w), height: Math.round(h), dpi, background: transparent ? null : bg });
    else if (tab === 'notebook') createNotebook({ title: title === 'Untitled' ? 'Notebook' : title, templateIndex: tpl, pages, color: paper });
    else if (tab === 'whiteboard') createWhiteboard(title === 'Untitled' ? 'Whiteboard' : title);
    onClose();
  };
  return (
    <Dialog title="New" icon="file-plus" size="wide" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      {tab !== 'pdf' && <button className="btn primary" onClick={create}><Icon name="check" size={15} />Create</button>}
    </>}>
      <div className="col" style={{ gap: 14 }}>
        <Seg value={tab} onChange={setTab} options={[{ value: 'drawing', label: 'Drawing', icon: 'palette' }, { value: 'notebook', label: 'Notebook', icon: 'page' }, { value: 'pdf', label: 'PDF / document', icon: 'file' }, { value: 'whiteboard', label: 'Whiteboard', icon: 'present' }]} />
        {tab !== 'pdf' && <Field label="Name"><input className="input grow" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></Field>}
        {tab === 'drawing' && (<>
          {groups.map((g) => (
            <div key={g}><div className="hint" style={{ marginBottom: 4 }}>{g}</div>
              <div className="preset-grid">{SIZE_PRESETS.filter((p) => p.group === g).map((p) => <button key={p.id} className={`preset ${preset === p.id ? 'on' : ''}`} onClick={() => pick(p.id)}><div>{p.name.split(' · ')[0].replace(/ \d+ × \d+/, '')}</div><div className="sz">{p.w} × {p.h}{p.dpi ? ` · ${p.dpi} dpi` : ''}</div></button>)}</div></div>
          ))}
          <div className="divider" style={{ margin: 0 }} />
          <div className="row wrap" style={{ gap: 14 }}>
            <Field label="Width"><NumInput value={w} onChange={(v) => { setW(v); setPreset(''); }} min={1} max={16000} width={80} decimals={0} suffix="px" /></Field>
            <Field label="Height"><NumInput value={h} onChange={(v) => { setH(v); setPreset(''); }} min={1} max={16000} width={80} decimals={0} suffix="px" /></Field>
            <Field label="Resolution"><NumInput value={dpi} onChange={setDpi} min={30} max={1200} width={70} decimals={0} suffix="dpi" /></Field>
            <Field label="Background"><ColorButton color={bg} onChange={setBg} alpha={false} /><Switch on={transparent} onChange={setTransparent} label="Transparent" /></Field>
          </div>
          <div className="hint">{(w * h / 1e6).toFixed(1)} megapixels · each pixel layer uses about {formatBytes(w * h * 4)} of memory · {(w / dpi).toFixed(1)} × {(h / dpi).toFixed(1)} in at {dpi} dpi</div>
        </>)}
        {tab === 'notebook' && (<>
          <div className="hint">Pick a paper style. Notebook pages are A4 at 150 dpi with a vector ink layer — perfect for handwriting, and you can change the paper any time.</div>
          <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            {TEMPLATES.map((t, i) => <div key={i} className={`tpl-card ${tpl === i ? 'on' : ''}`} onClick={() => setTpl(i)}><TemplateCanvas idx={i} color={paper} />{t.label}</div>)}
          </div>
          <div className="row wrap" style={{ gap: 14 }}>
            <Field label="Pages"><NumInput value={pages} onChange={setPages} min={1} max={200} width={60} decimals={0} /></Field>
            <Field label="Paper colour">{['#fffdf8', '#ffffff', '#f6f1e4', '#eaf3ff', '#2b2d33'].map((c) => <button key={c} className="swatch" style={{ background: c, outline: paper === c ? '2px solid var(--accent)' : undefined }} onClick={() => setPaper(c)} />)}<ColorButton color={paper} onChange={setPaper} alpha={false} /></Field>
            <span className="hint">{NOTE_PAGE.w} × {NOTE_PAGE.h} px</span>
          </div>
        </>)}
        {tab === 'pdf' && (
          <div className="col" style={{ alignItems: 'center', gap: 12, padding: '24px 0' }}>
            <Icon name="file" size={52} style={{ opacity: 0.4 }} />
            <div style={{ textAlign: 'center' }}>Open a PDF to read, highlight, annotate, sign and export it.<br /><span className="hint">Pages stay vector-sharp; your marks live on top and can be exported into the original PDF.</span></div>
            <button className="btn primary" onClick={async () => { const f = await pickFiles('.pdf', true); if (f.length) { onClose(); await openFiles(f); } }}><Icon name="upload" size={15} />Choose PDF…</button>
            <button className="btn" onClick={() => { onClose(); void openFileDialog(); }}>Or open any supported file…</button>
          </div>
        )}
        {tab === 'whiteboard' && <div className="hint" style={{ padding: '10px 0' }}>An open, zoomable board for sketching ideas with vector ink, shapes, sticky notes and images. Ink stays sharp at any zoom level.</div>}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Export
export function ExportDialog({ ed, onClose }: { ed: Editor; onClose: () => void }) {
  const [o, setO] = useState<ExportOptions>(() => ({ ...defaultExportOptions(), format: ed.doc.kind === 'pdf' ? 'pdf' : 'png', pdfMode: ed.doc.kind === 'pdf' ? 'annotated-original' : 'pages', scope: ed.doc.pages.length > 1 ? 'all' : 'page' }));
  const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<string>('');
  const info = FORMAT_INFO[o.format];
  const set = (p: Partial<ExportOptions>) => setO((x) => ({ ...x, ...p }));
  const pg = ed.page;
  const formats: ExportFormat[] = ['png', 'jpeg', 'webp', 'avif', 'pdf', 'svg', 'psd', 'ora', 'gif', 'bmp', 'ico', 'qdraw'];
  useEffect(() => {
    let dead = false;
    const t = setTimeout(async () => {
      if (!['png', 'jpeg', 'webp'].includes(o.format) || o.scope !== 'page') { setEst(''); return; }
      try { const c = renderPageToCanvas(ed.doc, pg, Math.min(o.scale, 1)); const b = await canvasToBlob(c, info.mime, o.quality); if (!dead) setEst(`≈ ${formatBytes(b.size * Math.max(1, o.scale * o.scale))}`); } catch { /* ignore */ }
    }, 250);
    return () => { dead = true; clearTimeout(t); };
  }, [o.format, o.quality, o.scale, o.scope, ed, pg, info.mime]);
  const run = async (mode: 'download' | 'copy' | 'share') => {
    setBusy(true);
    try {
      const r = await exportDocument(ed, o);
      if (mode === 'download') { downloadBlob(r.blob, r.name); toast(`Exported ${r.name} (${formatBytes(r.blob.size)})`, 'success'); onClose(); }
      else if (mode === 'copy') { await navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob.type === 'image/png' ? r.blob : await canvasToBlob(renderPageToCanvas(ed.doc, pg, o.scale)) })]); toast('Copied to clipboard', 'success'); }
      else { const file = new File([r.blob], r.name, { type: r.blob.type }); if ((navigator as any).canShare?.({ files: [file] })) await (navigator as any).share({ files: [file], title: ed.doc.title }); else toast('Sharing files is not supported in this browser', 'info'); }
    } catch (e: any) { console.error(e); toast(`Export failed: ${e?.message ?? e}`, 'error'); } finally { setBusy(false); }
  };
  const outW = Math.round(pg.width * o.scale), outH = Math.round(pg.height * o.scale);
  return (
    <Dialog title="Export" icon="download" size="wide" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      {['png', 'jpeg', 'webp'].includes(o.format) && <button className="btn" disabled={busy} onClick={() => run('copy')}><Icon name="copy" size={14} />Copy</button>}
      <button className="btn" disabled={busy} onClick={() => run('share')}>Share…</button>
      <button className="btn primary" disabled={busy} onClick={() => run('download')}>{busy ? 'Exporting…' : <><Icon name="download" size={15} />Export</>}</button>
    </>}>
      <div className="col" style={{ gap: 14 }}>
        <div className="preset-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
          {formats.map((f) => <button key={f} className={`preset ${o.format === f ? 'on' : ''}`} onClick={() => set({ format: f, transparent: FORMAT_INFO[f].alpha ? o.transparent : false })}><b>{FORMAT_INFO[f].label}</b><div className="sz">.{FORMAT_INFO[f].ext}</div></button>)}
        </div>
        <div className="hint">{info.desc}</div>
        <div className="grid2" style={{ gap: 14 }}>
          <div className="col">
            {o.format !== 'qdraw' && o.format !== 'pdf' && <Field label="What"><select className="select grow" value={o.scope} onChange={(e) => set({ scope: e.target.value as any })}>
              <option value="page">Current page</option>{ed.doc.pages.length > 1 && <option value="all">All pages{o.format === 'gif' ? ' (animation)' : ' (zip)'}</option>}<option value="selection" disabled={!ed.hasSelection}>Selection only</option><option value="layers">Each layer separately (zip)</option></select></Field>}
            {o.format === 'pdf' && <Field label="Pages"><Seg value={o.scope === 'all' ? 'all' : 'page'} onChange={(v) => set({ scope: v })} options={[{ value: 'all', label: 'All' }, { value: 'page', label: 'Current' }]} /></Field>}
            {o.format === 'pdf' && ed.doc.kind === 'pdf' && <Field label="Mode"><Seg value={o.pdfMode} onChange={(v) => set({ pdfMode: v })} options={[{ value: 'annotated-original', label: 'Annotate original' }, { value: 'pages', label: 'Flatten pages' }]} /></Field>}
            {!['svg', 'psd', 'ora', 'qdraw', 'ico'].includes(o.format) && <Slider label="Scale" value={o.scale} min={0.25} max={6} step={0.25} format={(v) => `${v}×`} onChange={(v) => set({ scale: v })} />}
            {info.lossy && <Slider label="Quality" value={o.quality} min={0.1} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ quality: v })} />}
            {o.format === 'gif' && o.scope === 'all' && <Slider label="Speed" value={o.fps} min={1} max={30} format={(v) => `${v} fps`} onChange={(v) => set({ fps: v })} />}
          </div>
          <div className="col">
            {info.alpha && o.format !== 'pdf' && <Field label="Transparency"><Switch on={o.transparent} onChange={(v) => set({ transparent: v })} label="Keep transparent" /></Field>}
            {(!info.alpha || !o.transparent || o.format === 'pdf') && <Field label="Background"><ColorButton color={o.background} onChange={(c) => set({ background: c })} alpha={false} /></Field>}
            <dl className="kv"><dt>Output size</dt><dd>{outW} × {outH} px</dd><dt>Pages</dt><dd>{o.scope === 'all' || o.format === 'pdf' && o.scope !== 'page' ? ed.doc.pages.length : 1}</dd>{est && <><dt>File size</dt><dd>{est}</dd></>}</dl>
            {o.format === 'pdf' && <div className="hint">Tip: “Annotate original” keeps the original PDF's text and vectors and lays your ink, highlights and notes on top.</div>}
            {o.format === 'psd' && <div className="hint">Vector and text layers are rasterised. Adjustment layers are skipped.</div>}
            {o.format === 'svg' && <div className="hint">Vector layers stay editable; pixel layers are embedded as images.</div>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Image / canvas size
export function ImageSizeDialog({ ed, onClose, canvasMode }: { ed: Editor; onClose: () => void; canvasMode?: boolean }) {
  const pg = ed.page;
  const [unit, setUnit] = useState<Units | '%'>('px');
  const [w, setW] = useState(pg.width), [h, setH] = useState(pg.height);
  const [lock, setLock] = useState(!canvasMode);
  const [smooth, setSmooth] = useState(true);
  const [anchor, setAnchor] = useState<Anchor>('mc');
  const ratio = pg.width / pg.height;
  const f = unit === '%' ? pg.width / 100 : unitFactor(unit, ed.doc.dpi);
  const fh = unit === '%' ? pg.height / 100 : f;
  const show = (px: number, ff: number) => +(px / ff).toFixed(unit === 'px' ? 0 : 2);
  const setWu = (v: number) => { const px = v * f; setW(px); if (lock) setH(px / ratio); };
  const setHu = (v: number) => { const px = v * fh; setH(px); if (lock) setW(px * ratio); };
  const apply = () => { if (canvasMode) P.resizeCanvas(ed, pg, w, h, anchor); else P.resizeImage(ed, pg, w, h, smooth); onClose(); };
  const anchors: Anchor[] = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  return (
    <Dialog title={canvasMode ? 'Canvas size' : 'Image size'} icon="fit" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={apply}>Apply</button></>}>
      <div className="col" style={{ gap: 12 }}>
        <div className="hint">Current: {pg.width} × {pg.height} px at {ed.doc.dpi} dpi</div>
        <Field label="Unit"><select className="select" value={unit} onChange={(e) => setUnit(e.target.value as any)}><option value="px">Pixels</option><option value="%">Percent</option><option value="in">Inches</option><option value="cm">Centimetres</option><option value="mm">Millimetres</option><option value="pt">Points</option></select></Field>
        <div className="row"><Field label="Width"><NumInput value={show(w, f)} onChange={setWu} min={0.01} width={90} decimals={unit === 'px' ? 0 : 2} /></Field>
          <button className={`btn icon ${lock ? 'on' : ''}`} title="Keep proportions" onClick={() => setLock(!lock)}><Icon name={lock ? 'lock' : 'unlock'} size={15} /></button>
          <Field label="Height"><NumInput value={show(h, fh)} onChange={setHu} min={0.01} width={90} decimals={unit === 'px' ? 0 : 2} /></Field></div>
        {canvasMode ? (
          <Field label="Anchor"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 28px)', gap: 3 }}>{anchors.map((a) => <button key={a} className={`btn icon ${anchor === a ? 'primary' : ''}`} style={{ width: 28, height: 28 }} onClick={() => setAnchor(a)}>{anchor === a ? '●' : '○'}</button>)}</div></Field>
        ) : <Switch on={smooth} onChange={setSmooth} label="Smooth resampling" />}
        <div className="hint">Result: {Math.round(w)} × {Math.round(h)} px · {(w / ed.doc.dpi).toFixed(2)} × {(h / ed.doc.dpi).toFixed(2)} in{canvasMode ? ' · content is kept at its current size' : ''}</div>
      </div>
    </Dialog>
  );
}
void newDocument; void workspace;
