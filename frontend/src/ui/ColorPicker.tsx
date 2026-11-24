// HSV colour picker used in the Color panel and in popovers.

import { useEffect, useRef, useState } from 'react';
import { HSV, hexToRgba, hsvToRgba, parseColor, rgbaToCss, rgbaToHex, rgbaToHsv } from '../core/color';
import { PopButton, NumInput } from './common';
import { Icon } from './icons';
import { prefs } from '../app/store';

function useDrag(onMove: (x: number, y: number, el: HTMLElement) => void) {
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      const r = () => el.getBoundingClientRect();
      const go = (ev: PointerEvent | React.PointerEvent) => { const b = r(); onMove(Math.min(1, Math.max(0, (ev.clientX - b.left) / b.width)), Math.min(1, Math.max(0, (ev.clientY - b.top) / b.height)), el); };
      go(e);
      const move = (ev: PointerEvent) => go(ev);
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up);
    },
  };
}

export function ColorPicker({ color, onChange, alpha = true, compact = false }: { color: string; onChange: (c: string) => void; alpha?: boolean; compact?: boolean }) {
  const [hsv, setHsv] = useState<HSV>(() => rgbaToHsv(parseColor(color)));
  const [hex, setHex] = useState(rgbaToHex(parseColor(color)));
  const lastEmitted = useRef(color);
  useEffect(() => {
    if (color !== lastEmitted.current) {
      const c = parseColor(color), h = rgbaToHsv(c);
      setHsv((prev) => ({ h: h.s === 0 || h.v === 0 ? prev.h : h.h, s: h.s, v: h.v, a: c.a }));
      setHex(rgbaToHex(c));
      lastEmitted.current = color;
    }
  }, [color]);
  const emit = (n: HSV) => {
    setHsv(n);
    const rgba = hsvToRgba(n);
    const out = rgbaToHex(rgba, true);
    lastEmitted.current = out; setHex(rgbaToHex(rgba));
    onChange(out);
  };
  const rgba = hsvToRgba(hsv);
  const hueCss = rgbaToCss(hsvToRgba({ h: hsv.h, s: 1, v: 1, a: 1 }));
  const box = useDrag((x, y) => emit({ ...hsv, s: x, v: 1 - y }));
  const hueDrag = useDrag((x) => emit({ ...hsv, h: x * 360 }));
  const alphaDrag = useDrag((x) => emit({ ...hsv, a: Math.round(x * 100) / 100 }));
  const recent = prefs.useSelect((p) => p.recentColors);
  const eyedrop = async () => {
    const ED = (window as any).EyeDropper;
    if (!ED) return;
    try { const r = await new ED().open(); const c = parseColor(r.sRGBHex); const h = rgbaToHsv(c); emit({ ...h, a: hsv.a }); } catch { /* cancelled */ }
  };
  return (
    <div className="col" style={{ gap: 6, width: compact ? 232 : '100%' }}>
      <div className="hsv-box" style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${hueCss})` }} {...box}>
        <div className="knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: rgbaToCss({ ...rgba, a: 1 }) }} />
      </div>
      <div className="hue-bar" {...hueDrag}><div className="knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueCss }} /></div>
      {alpha && (
        <div className="hue-bar alpha" style={{ ['--c' as any]: rgbaToHex(rgba) }} {...alphaDrag}><div className="knob" style={{ left: `${hsv.a * 100}%`, background: rgbaToCss(rgba) }} /></div>
      )}
      <div className="row">
        <input className="input" style={{ width: 84, fontFamily: 'var(--mono)' }} value={hex} spellCheck={false}
          onChange={(e) => { setHex(e.target.value); if (/^#?[0-9a-f]{6}$/i.test(e.target.value)) { const c = hexToRgba(e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value); emit({ ...rgbaToHsv(c), a: hsv.a }); } }}
          onKeyDown={(e) => e.stopPropagation()} />
        {(['r', 'g', 'b'] as const).map((k) => (
          <NumInput key={k} width={44} min={0} max={255} decimals={0} value={Math.round(rgba[k])} onChange={(v) => { const c = { ...rgba, [k]: v }; emit({ ...rgbaToHsv(c), a: hsv.a, h: rgbaToHsv(c).s === 0 ? hsv.h : rgbaToHsv(c).h }); }} />
        ))}
        {(window as any).EyeDropper && <button className="btn icon" title="Pick colour from screen" onClick={eyedrop}><Icon name="eyedropper" size={15} /></button>}
      </div>
      {!compact && recent.length > 0 && (
        <div className="swatch-grid">{recent.slice(0, 16).map((c, i) => <button key={c + i} className="swatch" style={{ background: c }} title={c} onClick={() => { const p = parseColor(c); emit({ ...rgbaToHsv(p), a: p.a }); }} />)}</div>
      )}
    </div>
  );
}

/** A swatch button that opens a colour-picker popover. */
export function ColorButton({ color, onChange, alpha = true, title, size = 22 }: { color: string; onChange: (c: string) => void; alpha?: boolean; title?: string; size?: number }) {
  return (
    <PopButton className="swatch alpha" title={title ?? 'Colour'} content={() => <div style={{ padding: 8 }}><ColorPicker color={color} onChange={onChange} alpha={alpha} compact /></div>}>
      <span style={{ position: 'absolute', inset: 0, borderRadius: 4, background: color, width: size - 2, height: size - 2 }} />
    </PopButton>
  );
}
