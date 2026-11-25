// Left tool strip with flyout groups.

import { useEffect, useRef, useState } from 'react';
import type { Editor } from '../editor/editor';
import { useEditor } from '../editor/editor';
import { TOOLBAR, toolMeta } from '../tools/catalog';
import { Icon } from './icons';
import { Popover } from './common';
import { ColorPicker } from './ColorPicker';
import { formatKeys } from '../app/commands';

export function Toolbar({ ed }: { ed: Editor }) {
  const toolId = useEditor(ed, ['tool'], () => ed.toolId);
  const slots = TOOLBAR;
  const [last, setLast] = useState<Record<string, string>>({});
  const [fly, setFly] = useState<{ idx: number; rect: DOMRect } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // the slot shows the most recently used tool of its group (also when switched by keyboard shortcut)
  useEffect(() => {
    const s = slots.find((sl) => sl.includes(toolId));
    if (s) setLast((l) => (l[s.join()] === toolId ? l : { ...l, [s.join()]: toolId }));
  }, [toolId]);
  const shown = (slot: string[]) => last[slot.join()] ?? slot[0];

  return (
    <div className="toolbar" onContextMenu={(e) => e.preventDefault()}>
      {slots.map((slot, i) => {
        const id = shown(slot);
        const m = toolMeta(id)!;
        const active = slot.includes(toolId);
        return (
          <div className="tool-slot" key={slot.join()}>
            <button className={`tool-btn ${active ? 'on' : ''}`} title={`${m.name}${m.key ? `  (${formatKeys(m.key)})` : ''}${m.hint ? '\n' + m.hint : ''}`}
              onClick={() => { ed.setTool(id); setFly(null); }}
              onContextMenu={(e) => { if (slot.length > 1) setFly({ idx: i, rect: e.currentTarget.getBoundingClientRect() }); }}
              onPointerDown={(e) => { if (slot.length > 1 && e.pointerType !== 'mouse') { const r = e.currentTarget.getBoundingClientRect(); holdTimer.current = setTimeout(() => setFly({ idx: i, rect: r }), 450); } }}
              onPointerUp={() => holdTimer.current && clearTimeout(holdTimer.current)}>
              <Icon name={m.icon} size={20} />
              {slot.length > 1 && <span className="corner" onClick={(e) => { e.stopPropagation(); setFly({ idx: i, rect: (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect() }); }} />}
            </button>
          </div>
        );
      })}
      <div className="tool-sep" />
      <ColorChips ed={ed} />
      {fly && (
        <Popover anchor={{ x: fly.rect.right + 4, y: fly.rect.top - 4, w: 0, h: -4 }} onClose={() => setFly(null)}>
          {slots[fly.idx].map((id) => {
            const m = toolMeta(id)!;
            return (
              <button key={id} className={`menu-item ${id === toolId ? '' : ''}`} style={id === toolId ? { color: 'var(--accent)' } : undefined} onClick={() => { ed.setTool(id); setFly(null); }}>
                <Icon name={m.icon} size={18} /><span>{m.name}</span>{m.key && <span className="keys">{formatKeys(m.key)}</span>}
              </button>
            );
          })}
        </Popover>
      )}
    </div>
  );
}

function ColorChips({ ed }: { ed: Editor }) {
  const { fg, bg } = useEditor(ed, ['colors'], () => ({ fg: ed.fg, bg: ed.bg }));
  const [pick, setPick] = useState<{ which: 'fg' | 'bg'; rect: DOMRect } | null>(null);
  return (
    <>
      <div className="color-chip" title="Foreground / background colour (X swaps, D resets)">
        <div className="bg swatch alpha" style={{ background: bg }} onClick={(e) => setPick({ which: 'bg', rect: e.currentTarget.getBoundingClientRect() })} />
        <div className="fg swatch alpha" style={{ background: fg }} onClick={(e) => setPick({ which: 'fg', rect: e.currentTarget.getBoundingClientRect() })} />
      </div>
      <button className="tool-btn" style={{ width: 28, height: 24 }} title="Swap colours (X)" onClick={() => ed.swapColors()}><Icon name="swap" size={15} /></button>
      {pick && (
        <Popover anchor={{ x: pick.rect.right + 6, y: pick.rect.top - 200, w: 0, h: 0 }} onClose={() => { ed.pushRecentColor(pick.which === 'fg' ? ed.fg : ed.bg); setPick(null); }}>
          <div style={{ padding: 8 }}>
            <ColorPicker compact color={pick.which === 'fg' ? fg : bg} onChange={(c) => (pick.which === 'fg' ? ed.setFg(c) : ed.setBg(c))} />
          </div>
        </Popover>
      )}
    </>
  );
}
