// The drawing surface: main canvas + overlay canvas + rulers + in-place editor host.

import { useEffect, useRef } from 'react';
import type { Editor } from '../editor/editor';
import { useEditor } from '../editor/editor';
import { ViewRenderer } from './canvas/viewRenderer';
import { CanvasController } from './canvas/controller';
import { assetEvents } from '../core/assets';
import { prefs } from '../app/store';
import { unitFactor } from '../core/model';
import { uid } from '../core/util';
import { Icon } from './icons';

export function CanvasView({ ed }: { ed: Editor }) {
  const wrap = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const showRulers = prefs.useSelect((p) => p.showRulers);
  const theme = prefs.useSelect((p) => p.theme);
  const checker = prefs.useSelect((p) => p.checker);
  const rendererRef = useRef<ViewRenderer | null>(null);

  useEffect(() => {
    const r = new ViewRenderer(ed, main.current!, over.current!);
    rendererRef.current = r;
    (window as any).__quarc && ((window as any).__quarc.renderer = r); // debugging / performance probes
    const ctl = new CanvasController(ed, over.current!);
    ctl.attach();
    ed.renderHook = () => r.schedule();
    ed.renderRectHook = (page, rect) => r.scheduleRect(page, rect);
    ed.overlayHook = () => r.scheduleOverlay();
    ed.overlayHost = host.current;
    const measure = () => {
      const b = wrap.current!.getBoundingClientRect();
      r.resize(b.width, b.height, window.devicePixelRatio || 1);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current!);
    measure();
    const offs = [
      ed.events.on('view', () => r.schedule()), ed.events.on('doc', () => r.schedule()), ed.events.on('selection', () => r.scheduleOverlay()),
      ed.events.on('objsel', () => r.scheduleOverlay()), ed.events.on('page', () => r.schedule()), ed.events.on('layers', () => r.schedule()),
      assetEvents.on('ready', () => r.schedule()),
    ];
    const unsub = [prefs.subscribe(() => { r.readTheme(); r.schedule(); })];
    // animate marching ants / laser
    const timer = setInterval(() => {
      const t = ed.tool;
      if (ed.doc.pages.some((p) => !ed.selectionFor(p).isEmpty) || t.animated) r.scheduleOverlay();
    }, 100);
    if (ed.doc.pages.length) ed.fitPage();
    r.schedule();
    return () => {
      clearInterval(timer); ro.disconnect(); ctl.detach(); offs.forEach((o) => o()); unsub.forEach((u) => u());
      if (ed.renderHook) ed.renderHook = null; ed.renderRectHook = null; ed.overlayHook = null; ed.overlayHost = null;
    };
  }, [ed]);

  useEffect(() => { requestAnimationFrame(() => { rendererRef.current?.readTheme(); rendererRef.current?.schedule(); }); }, [theme, checker]);

  const cursor = useEditor(ed, ['tool'], () => ed.tool.cursor);
  useEffect(() => { if (over.current) over.current.style.cursor = cursor; }, [cursor]);

  return (
    <div className={`stage ${showRulers ? '' : 'no-rulers'}`}>
      {showRulers && <div className="corner-box" />}
      {showRulers && <Ruler ed={ed} horizontal />}
      {showRulers && <Ruler ed={ed} horizontal={false} />}
      <div className="viewport" ref={wrap} style={{ gridColumn: showRulers ? undefined : '1', gridRow: showRulers ? undefined : '1' }}>
        <canvas ref={main} />
        <canvas ref={over} className="overlay" tabIndex={0} />
        <div className="overlay-host" ref={host} />
        <ZoomChip ed={ed} />
      </div>
    </div>
  );
}

function ZoomChip({ ed }: { ed: Editor }) {
  const z = useEditor(ed, ['view'], () => ed.view.zoom);
  const rot = useEditor(ed, ['view'], () => Math.round(ed.view.rotationDeg()));
  return (
    <div className="viewport-chip">
      <div className="pill">
        <button title="Zoom out" onClick={() => ed.zoomBy(1 / 1.25)}><Icon name="minus" size={14} /></button>
        <span style={{ minWidth: 44, textAlign: 'center', fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }} title="Click for 100%" onClick={() => ed.zoomTo(1)}>{Math.round(z * 100)}%</span>
        <button title="Zoom in" onClick={() => ed.zoomBy(1.25)}><Icon name="plus" size={14} /></button>
        <button title="Fit page" onClick={() => ed.fitPage()}><Icon name="fit" size={14} /></button>
        {rot !== 0 && <button title="Reset rotation" onClick={() => { ed.view.resetRotation(); ed.changed('view'); }}><Icon name="rotate-view" size={14} /><span style={{ fontSize: 11 }}>{rot}°</span></button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- rulers
function niceStep(minPx: number, pxPerUnit: number): number {
  const raw = minPx / pxPerUnit;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

function Ruler({ ed, horizontal }: { ed: Editor; horizontal: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tick = useEditor(ed, ['view', 'page', 'doc'], () => ed.versions.view + ed.versions.page + ed.versions.doc);
  useEffect(() => {
    const c = ref.current!;
    const parent = c.parentElement!;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth, h = parent.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(parent);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = style.color; ctx.strokeStyle = style.color; ctx.font = '10px system-ui';
    const view = ed.view, page = ed.page;
    if (Math.abs(view.rotation) > 1e-3 || view.flipX) { ctx.globalAlpha = 0.5; ctx.fillText('rotated', 4, 13); return; }
    const pm = view.pageMatrix(page);
    const unit = ed.doc.units, f = unitFactor(unit, ed.doc.dpi);
    const pxPerUnit = view.zoom * f;
    const step = niceStep(horizontal ? 60 : 50, pxPerUnit);
    const origin = horizontal ? pm.e : pm.f;
    const len = horizontal ? w : h;
    const startU = Math.floor((0 - origin) / pxPerUnit / step) * step;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let u = startU; u * pxPerUnit + origin < len + 40; u += step) {
      const pos = Math.round(u * pxPerUnit + origin) + 0.5;
      const major = true;
      if (horizontal) { ctx.moveTo(pos, 20); ctx.lineTo(pos, major ? 8 : 14); } else { ctx.moveTo(20, pos); ctx.lineTo(major ? 8 : 14, pos); }
      for (let k = 1; k < 5; k++) { const p2 = Math.round((u + (step * k) / 5) * pxPerUnit + origin) + 0.5; if (step * pxPerUnit / 5 < 6) break; if (horizontal) { ctx.moveTo(p2, 20); ctx.lineTo(p2, k === 0 ? 8 : 15); } else { ctx.moveTo(20, p2); ctx.lineTo(k === 0 ? 8 : 15, p2); } }
      const label = String(+u.toFixed(2));
      if (horizontal) ctx.fillText(label, pos + 3, 11); else { ctx.save(); ctx.translate(11, pos - 3); ctx.rotate(-Math.PI / 2); ctx.fillText(label, 0, 0); ctx.restore(); }
    }
    ctx.globalAlpha = 0.6; ctx.stroke();
    // pointer marker
    const pl = ed.pointerLocal;
    if (pl) { const p = view.pageMatrix(page); const x = p.a * pl.x + p.c * pl.y + p.e, y = p.b * pl.x + p.d * pl.y + p.f; ctx.globalAlpha = 1; ctx.strokeStyle = '#1fc8ac'; ctx.beginPath(); if (horizontal) { ctx.moveTo(x, 0); ctx.lineTo(x, 20); } else { ctx.moveTo(0, y); ctx.lineTo(20, y); } ctx.stroke(); }
  }, [ed, horizontal, tick]);
  useEffect(() => ed.events.on('status', () => { /* pointer marker handled lazily on next view tick */ }), [ed]);

  const onDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const axis: 'h' | 'v' = horizontal ? 'h' : 'v';
    const toPage = (ev: { clientX: number; clientY: number }) => {
      const vp = el.closest('.stage')!.querySelector('.viewport')!.getBoundingClientRect();
      const w = ed.view.toWorld({ x: ev.clientX - vp.left, y: ev.clientY - vp.top });
      const l = ed.view.worldToLocal(ed.page, w);
      return axis === 'h' ? l.y : l.x;
    };
    ed.tempGuide = { axis, pos: toPage(e) };
    const move = (ev: PointerEvent) => { ed.tempGuide = { axis, pos: toPage(ev) }; ed.requestOverlay(); };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      const pos = toPage(ev); ed.tempGuide = null;
      const pg = ed.page, max = axis === 'h' ? pg.height : pg.width;
      if (pos > 0 && pos < max) ed.transact('Add guide', () => { pg.guides.push({ id: uid('gd'), axis: axis === 'h' ? 'h' : 'v', pos: Math.round(pos * 10) / 10 }); });
      ed.requestOverlay();
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
  };
  return <div className={`ruler ${horizontal ? 'h' : 'v'}`} style={{ gridColumn: horizontal ? 2 : 1, gridRow: horizontal ? 1 : 2 }} onPointerDown={onDown} title="Drag to create a guide"><canvas ref={ref} /></div>;
}
