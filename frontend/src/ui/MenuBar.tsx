// Application menus (all items are commands so shortcuts / palette stay in sync).

import { useRef, useState } from 'react';
import type { Editor } from '../editor/editor';
import { MenuEntry, MenuList, useOutsideClose } from './common';
import { FILTERS, FILTER_CATEGORIES } from '../filters/registry';
import { ADJUSTMENT_LABELS, AdjustmentKind } from '../core/model';

const sep: MenuEntry = { separator: true };
const c = (command: string): MenuEntry => ({ command });
const sub = (label: string, children: MenuEntry[]): MenuEntry => ({ label, children });

export function buildMenus(): Record<string, MenuEntry[]> {
  const adj = (k: AdjustmentKind) => c(`adjust.${k}`);
  return {
    File: [
      c('file.new'), c('file.open'), c('file.library'), sep,
      c('file.save'), c('file.saveas'), c('file.export'), c('file.export.quick'), sep,
      c('file.place'), c('file.print'), sep, c('file.rename'), c('file.info'), sep,
      sub('Sync', [c('file.sync'), c('file.sync.settings')]), sep, c('file.close'),
    ],
    Edit: [
      c('edit.undo'), c('edit.redo'), sep, c('edit.cut'), c('edit.copy'), c('edit.paste'), c('edit.pasteinplace'), sep,
      c('edit.delete'), c('edit.fill.fg'), c('edit.fill.bg'), c('edit.fill.pattern'), c('edit.stroke'), sep,
      c('edit.duplicate'), c('edit.transform'), sep, c('edit.palette'), c('edit.prefs'),
    ],
    Image: [
      c('image.size'), c('image.canvas'), sub('Rotate canvas', [c('image.rotate90'), c('image.rotate270'), c('image.rotate180'), sep, c('image.flipH'), c('image.flipV')]),
      c('image.crop'), c('image.trim'), sep,
      sub('Adjustments', [adj('brightness-contrast'), adj('hue-saturation'), adj('levels'), adj('curves'), adj('exposure'), adj('vibrance'), adj('color-balance'), adj('photo-filter'), adj('gradient-map'), sep, c('adjust.invert'), c('adjust.grayscale'), c('adjust.sepia'), adj('threshold'), adj('posterize')]),
      sep, c('image.bg'),
    ],
    Layer: [
      c('layer.new'), c('layer.newvector'), c('layer.newgroup'),
      sub('New adjustment layer', (Object.keys(ADJUSTMENT_LABELS) as AdjustmentKind[]).map((k) => c(`layer.adj.${k}`))), sep,
      c('layer.duplicate'), c('layer.delete'), sep, c('layer.group'), c('layer.ungroup'), c('layer.mergedown'), c('layer.mergevisible'), c('layer.flatten'), c('layer.rasterize'), sep,
      sub('Mask', [c('layer.mask.add'), c('layer.mask.hide'), c('layer.mask.sel'), c('layer.mask.invert'), c('layer.mask.toggle'), c('layer.mask.apply'), c('layer.mask.delete')]),
      c('layer.clip'), c('layer.lock'), c('layer.alphalock'), c('layer.effects'), sep,
      sub('Arrange', [c('layer.top'), c('layer.up'), c('layer.down'), c('layer.bottom')]), sep, c('layer.viasel'), c('layer.viacut'), c('layer.selectpixels'),
    ],
    Select: [
      c('select.all'), c('select.none'), c('select.invert'), sep,
      c('select.feather'), c('select.grow'), c('select.shrink'), c('select.smooth'), c('select.border'), sep, c('select.fromlayer'), c('select.objects'),
    ],
    Filter: FILTER_CATEGORIES.filter((cat) => FILTERS.some((f) => f.category === cat)).map((cat) => sub(cat, FILTERS.filter((f) => f.category === cat).map((f) => c(`filter.${f.id}`)))),
    Object: [
      c('object.group'), c('object.ungroup'), sep,
      sub('Arrange', [c('object.front'), c('object.forward'), c('object.backward'), c('object.back')]),
      sub('Align', ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'].map((k) => c(`object.align.${k}`)).concat([sep, c('object.dist.h'), c('object.dist.v')])),
      sub('Shape operations', [c('object.unite'), c('object.subtract'), c('object.intersect'), c('object.exclude')]), sep,
      c('object.flipH'), c('object.flipV'), c('object.topath'), sep, c('object.lock'), c('object.hide'),
    ],
    Page: [
      c('page.add'), c('page.duplicate'), c('page.delete'), sep, c('page.prev'), c('page.next'), c('page.goto'), sep,
      sub('Layout', ['single', 'vertical', 'horizontal', 'spread', 'grid', 'free'].map((m) => c(`view.layout.${m}`))), c('page.setup'),
    ],
    View: [
      c('view.zoomin'), c('view.zoomout'), c('view.fit'), c('view.fitwidth'), c('view.fitall'), c('view.100'), c('view.200'), sep,
      c('view.rotate90'), c('view.rotatereset'), c('view.flip'), sep,
      c('view.rulers'), c('view.grid'), c('view.snapgrid'), c('view.gridsettings'), c('view.snapguides'), c('view.clearguides'), sep,
      c('view.symmetry'), c('view.symmetry.settings'), c('view.perspective'), c('view.perspective.settings'), c('view.checker'), sep, c('view.focus'), c('view.fullscreen'),
    ],
    Window: [
      sub('Theme', [c('theme.dark'), c('theme.midnight'), c('theme.light')]), c('penonly'), sep,
      c('panel.layers'), c('panel.color'), c('panel.brushes'), c('panel.history'), c('panel.navigator'), c('panel.pages'), c('panel.assets'),
    ],
    Help: [c('help.shortcuts'), c('help.tutorial'), sep, c('help.about')],
  };
}

export function MenuBar({ ed }: { ed: Editor | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(ref, () => setOpen(null), open !== null);
  const menus = buildMenus();
  return (
    <div className="menubar" ref={ref}>
      {Object.keys(menus).map((name) => (
        <div key={name} style={{ position: 'relative' }}>
          <button className={`menu-btn ${open === name ? 'open' : ''}`} onClick={() => setOpen(open === name ? null : name)} onMouseEnter={() => open && setOpen(name)}>{name}</button>
          {open === name && <div className="popover" style={{ position: 'absolute', top: '100%', left: 0, minWidth: 260 }}><MenuList items={menus[name]} ed={ed} onDone={() => setOpen(null)} /></div>}
        </div>
      ))}
    </div>
  );
}
