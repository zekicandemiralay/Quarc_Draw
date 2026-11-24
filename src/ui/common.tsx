// Shared UI primitives.

import { ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { formatKeys, keysFor, runCommand, getCommand } from '../app/commands';
import type { Editor } from '../editor/editor';

// ---------- Slider / number ----------
export function Slider({ label, value, min, max, step = 1, onChange, format, width, onCommit }: {
  label?: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; width?: number; onCommit?: () => void;
}) {
  return (
    <div className="slider-row" style={width ? { minWidth: width } : undefined}>
      {label && <label>{label}</label>}
      <input className="slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} onPointerUp={onCommit} />
      <span className="val">{format ? format(value) : Math.round(value * 100) / 100}</span>
    </div>
  );
}

export function NumInput({ value, onChange, min, max, step = 1, width = 64, suffix, decimals = 2 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; width?: number; suffix?: string; decimals?: number }) {
  const [text, setText] = useState(String(+value.toFixed(decimals)));
  const focus = useRef(false);
  useEffect(() => { if (!focus.current) setText(String(+value.toFixed(decimals))); }, [value, decimals]);
  const commit = (s: string) => {
    let v = parseFloat(s);
    if (isNaN(v)) { setText(String(+value.toFixed(decimals))); return; }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v); setText(String(+v.toFixed(decimals)));
  };
  return (
    <span className="row" style={{ gap: 3 }}>
      <input className="input num" style={{ width }} value={text} inputMode="decimal"
        onFocus={(e) => { focus.current = true; e.target.select(); }}
        onBlur={(e) => { focus.current = false; commit(e.target.value); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1); const v = (parseFloat(text) || 0) + d; commit(String(v)); }
          e.stopPropagation();
        }} />
      {suffix && <span className="hint">{suffix}</span>}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label?: ReactNode; title?: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="check" style={{ gap: 8 }}>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />
      {label && <span>{label}</span>}
    </label>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="field"><label>{label}</label><div className="grow row">{children}</div></div>;
}

// ---------- Popover ----------
export function Popover({ anchor, onClose, children, align = 'start', width, className = '' }: {
  anchor: { x: number; y: number; w?: number; h?: number }; onClose: () => void; children: ReactNode; align?: 'start' | 'end'; width?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y + (anchor.h ?? 0) + 4, ready: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    let x = align === 'end' ? anchor.x + (anchor.w ?? 0) - r.width : anchor.x;
    let y = anchor.y + (anchor.h ?? 0) + 4;
    if (x + r.width > window.innerWidth - 8) x = window.innerWidth - r.width - 8;
    if (y + r.height > window.innerHeight - 8) y = Math.max(8, anchor.y - r.height - 4);
    setPos({ x: Math.max(8, x), y: Math.max(8, y), ready: true });
  }, [anchor.x, anchor.y, anchor.w, anchor.h, align]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => window.addEventListener('pointerdown', down, true), 0);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={`popover ${className}`} style={{ left: pos.x, top: pos.y, width, visibility: pos.ready ? 'visible' : 'hidden' }} onContextMenu={(e) => e.preventDefault()}>{children}</div>,
    document.body,
  );
}

/** Button that opens a popover anchored below it */
export function PopButton({ children, content, className = 'btn', title, align }: { children: ReactNode; content: (close: () => void) => ReactNode; className?: string; title?: string; align?: 'start' | 'end' }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const close = useCallback(() => setRect(null), []);
  return (
    <>
      <button className={`${className} ${rect ? 'on' : ''}`} title={title} onClick={(e) => setRect(rect ? null : e.currentTarget.getBoundingClientRect())}>{children}</button>
      {rect && <Popover anchor={{ x: rect.left, y: rect.top, w: rect.width, h: rect.height }} onClose={close} align={align}>{content(close)}</Popover>}
    </>
  );
}

// ---------- menus ----------
export interface MenuEntry {
  label?: string;
  command?: string;
  onClick?: () => void;
  keys?: string;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  group?: string;
  children?: MenuEntry[];
  icon?: string;
}

export function MenuList({ items, ed, onDone }: { items: MenuEntry[]; ed: Editor | null; onDone: () => void }) {
  return (
    <>
      {items.map((it, i) => <MenuRow key={i} it={it} ed={ed} onDone={onDone} />)}
    </>
  );
}
function MenuRow({ it, ed, onDone }: { it: MenuEntry; ed: Editor | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  if (it.separator) return <div className="menu-sep" />;
  if (it.group) return <div className="menu-group">{it.group}</div>;
  const cmd = it.command ? getCommand(it.command) : undefined;
  const label = it.label ?? cmd?.label ?? '';
  const disabled = it.disabled ?? (cmd?.enabled ? !cmd.enabled({ ed }) : false);
  const checked = it.checked ?? (cmd?.checked ? cmd.checked({ ed }) : undefined);
  const keys = it.keys ?? (it.command ? keysFor(it.command) : undefined);
  if (it.children) {
    return (
      <div className="submenu" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
        <button className="menu-item" onClick={() => setOpen(!open)}>
          <span className="check-slot" />{it.icon && <Icon name={it.icon} size={15} />}{label}<span className="arrow"><Icon name="chevron-right" size={13} /></span>
        </button>
        {open && <div className="popover" style={{ minWidth: 240 }}><MenuList items={it.children} ed={ed} onDone={onDone} /></div>}
      </div>
    );
  }
  return (
    <button className={`menu-item ${disabled ? 'disabled' : ''}`} disabled={disabled}
      onClick={() => { onDone(); if (it.onClick) it.onClick(); else if (it.command) runCommand(it.command, ed); }}>
      <span className="check-slot">{checked ? <Icon name="check" size={13} /> : null}</span>
      {it.icon && <Icon name={it.icon} size={15} />}
      <span>{label}</span>
      {keys && <span className="keys">{formatKeys(keys)}</span>}
    </button>
  );
}

export function useOutsideClose(ref: React.RefObject<HTMLElement | null>, onClose: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', h, true);
    return () => window.removeEventListener('pointerdown', h, true);
  }, [ref, onClose, active]);
}

// ---------- dialog shell ----------
export function Dialog({ title, onClose, children, footer, size = '', icon }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: '' | 'wide' | 'xl'; icon?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return createPortal(
    <div className="scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${size}`} role="dialog" aria-label={title} onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog-h">{icon && <Icon name={icon} size={20} />}<span style={{ flex: 1 }}>{title}</span><button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button></div>
        <div className="dialog-b">{children}</div>
        {footer && <div className="dialog-f">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
