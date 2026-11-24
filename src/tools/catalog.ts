// Static tool metadata used by the toolbar, command palette and shortcut system.

export interface ToolMeta {
  id: string;
  name: string;
  icon: string;      // key into the icon set
  key?: string;      // shortcut
  group: string;     // toolbar slot (flyout group)
  hint?: string;
  workspaces: ('studio' | 'notes' | 'reader')[];
}
const S: ToolMeta['workspaces'] = ['studio'];
const SN: ToolMeta['workspaces'] = ['studio', 'notes'];
const ALL: ToolMeta['workspaces'] = ['studio', 'notes', 'reader'];
const NR: ToolMeta['workspaces'] = ['notes', 'reader'];

export const TOOL_CATALOG: ToolMeta[] = [
  { id: 'move', name: 'Move / Select', icon: 'move', key: 'V', group: 'move', workspaces: ALL, hint: 'Select and move objects or pixels. Alt-drag duplicates.' },
  { id: 'transform', name: 'Free Transform', icon: 'transform', key: 'Ctrl+T', group: 'move', workspaces: S, hint: 'Scale, rotate and flip pixels. Enter to apply.' },
  { id: 'marquee-rect', name: 'Rectangular Marquee', icon: 'marquee', key: 'M', group: 'select', workspaces: S },
  { id: 'marquee-ellipse', name: 'Elliptical Marquee', icon: 'marquee-ellipse', key: 'M', group: 'select', workspaces: S },
  { id: 'lasso', name: 'Lasso', icon: 'lasso', key: 'L', group: 'select', workspaces: S },
  { id: 'lasso-poly', name: 'Polygonal Lasso', icon: 'lasso-poly', key: 'L', group: 'select', workspaces: S },
  { id: 'wand', name: 'Magic Wand', icon: 'wand', key: 'W', group: 'select', workspaces: S },
  { id: 'select-brush', name: 'Selection Brush', icon: 'select-brush', key: 'Shift+W', group: 'select', workspaces: S },
  { id: 'object-lasso', name: 'Lasso (select objects)', icon: 'lasso', key: 'L', group: 'lasso', workspaces: NR },
  { id: 'crop', name: 'Crop', icon: 'crop', key: 'C', group: 'crop', workspaces: S },
  { id: 'eyedropper', name: 'Eyedropper', icon: 'eyedropper', key: 'I', group: 'sample', workspaces: SN },
  { id: 'measure', name: 'Measure', icon: 'ruler', key: 'Shift+I', group: 'sample', workspaces: S },
  // raster painting
  { id: 'brush', name: 'Brush', icon: 'brush', key: 'B', group: 'paint', workspaces: S },
  { id: 'eraser', name: 'Eraser', icon: 'eraser', key: 'E', group: 'erase', workspaces: S },
  { id: 'smudge', name: 'Smudge', icon: 'smudge', key: 'S', group: 'retouch', workspaces: S },
  { id: 'blur', name: 'Blur', icon: 'blur', key: 'Shift+B', group: 'retouch', workspaces: S },
  { id: 'sharpen', name: 'Sharpen', icon: 'sharpen', key: 'Shift+S', group: 'retouch', workspaces: S },
  { id: 'dodge', name: 'Dodge', icon: 'dodge', key: 'O', group: 'retouch', workspaces: S },
  { id: 'burn', name: 'Burn', icon: 'burn', key: 'Shift+O', group: 'retouch', workspaces: S },
  { id: 'clone', name: 'Clone Stamp', icon: 'clone', key: 'K', group: 'retouch', workspaces: S },
  { id: 'bucket', name: 'Paint Bucket', icon: 'bucket', key: 'G', group: 'fill', workspaces: S },
  { id: 'gradient', name: 'Gradient', icon: 'gradient', key: 'Shift+G', group: 'fill', workspaces: S },
  // vector ink (notes)
  { id: 'ink-pen', name: 'Pen', icon: 'pen-nib', key: 'N', group: 'ink', workspaces: NR },
  { id: 'ink-fountain', name: 'Fountain Pen', icon: 'fountain', group: 'ink', workspaces: NR },
  { id: 'ink-pencil', name: 'Pencil', icon: 'pencil', group: 'ink', workspaces: NR },
  { id: 'ink-marker', name: 'Marker', icon: 'marker', group: 'ink', workspaces: NR },
  { id: 'ink-brush', name: 'Brush Pen', icon: 'brush-pen', group: 'ink', workspaces: NR },
  { id: 'highlighter', name: 'Highlighter', icon: 'highlighter', key: 'H', group: 'highlight', workspaces: NR },
  { id: 'ink-eraser', name: 'Eraser', icon: 'eraser', key: 'E', group: 'erase', workspaces: NR },
  // vector
  { id: 'pen', name: 'Pen (Bezier)', icon: 'bezier', key: 'P', group: 'vector', workspaces: S },
  { id: 'node', name: 'Node Edit', icon: 'node', key: 'A', group: 'vector', workspaces: S },
  { id: 'freeform', name: 'Freeform Path', icon: 'freeform', key: 'Shift+P', group: 'vector', workspaces: S },
  { id: 'rect', name: 'Rectangle', icon: 'rect', key: 'U', group: 'shape', workspaces: SN },
  { id: 'ellipse', name: 'Ellipse', icon: 'ellipse', key: 'U', group: 'shape', workspaces: SN },
  { id: 'polygon', name: 'Polygon', icon: 'polygon', key: 'U', group: 'shape', workspaces: SN },
  { id: 'star', name: 'Star', icon: 'star', key: 'U', group: 'shape', workspaces: SN },
  { id: 'line', name: 'Line', icon: 'line', key: 'U', group: 'shape', workspaces: ALL },
  { id: 'arrow', name: 'Arrow', icon: 'arrow', key: 'U', group: 'shape', workspaces: ALL },
  { id: 'text', name: 'Text', icon: 'text', key: 'T', group: 'text', workspaces: ALL },
  { id: 'note', name: 'Sticky Note', icon: 'note', group: 'annotate', workspaces: NR },
  { id: 'image', name: 'Insert Image', icon: 'image', group: 'annotate', workspaces: ALL },
  // markup (reader)
  { id: 'text-select', name: 'Select & Copy Text', icon: 'text-select', key: 'S', group: 'markup', workspaces: ['reader'] },
  { id: 'markup-highlight', name: 'Highlight Text', icon: 'highlighter', key: 'H', group: 'markup', workspaces: ['reader'] },
  { id: 'markup-underline', name: 'Underline Text', icon: 'underline', group: 'markup', workspaces: ['reader'] },
  { id: 'markup-strike', name: 'Strikethrough Text', icon: 'strike', group: 'markup', workspaces: ['reader'] },
  { id: 'markup-squiggle', name: 'Squiggly Underline', icon: 'squiggle', group: 'markup', workspaces: ['reader'] },
  { id: 'laser', name: 'Laser Pointer', icon: 'laser', key: 'Shift+L', group: 'present', workspaces: NR },
  // view
  { id: 'hand', name: 'Hand', icon: 'hand', key: 'H', group: 'view', workspaces: ALL },
  { id: 'zoom', name: 'Zoom', icon: 'zoom', key: 'Z', group: 'view', workspaces: S },
  { id: 'rotate-view', name: 'Rotate View', icon: 'rotate-view', key: 'R', group: 'view', workspaces: S },
];
export const toolMeta = (id: string) => TOOL_CATALOG.find((t) => t.id === id);

/** toolbar slots per workspace – ordered; each slot is a flyout group of tool ids */
export const TOOLBARS: Record<'studio' | 'notes' | 'reader', string[][]> = {
  studio: [
    ['move', 'transform'],
    ['marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-poly', 'wand', 'select-brush'],
    ['crop'],
    ['brush'], ['eraser'], ['smudge', 'blur', 'sharpen', 'dodge', 'burn', 'clone'],
    ['bucket', 'gradient'],
    ['pen', 'node', 'freeform'],
    ['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow'],
    ['text'],
    ['eyedropper', 'measure'],
    ['image'],
    ['hand', 'rotate-view', 'zoom'],
  ],
  notes: [
    ['move'],
    ['ink-pen', 'ink-fountain', 'ink-pencil', 'ink-marker', 'ink-brush'],
    ['highlighter'],
    ['ink-eraser'],
    ['object-lasso'],
    ['rect', 'ellipse', 'polygon', 'star', 'line', 'arrow'],
    ['text'], ['note'], ['image'],
    ['eyedropper'],
    ['laser'],
    ['hand'],
  ],
  reader: [
    ['move'],
    ['text-select'],
    ['markup-highlight', 'markup-underline', 'markup-strike', 'markup-squiggle'],
    ['ink-pen', 'ink-fountain', 'ink-pencil'],
    ['highlighter'],
    ['ink-eraser'],
    ['text'], ['note'], ['image'],
    ['rect', 'ellipse', 'line', 'arrow'],
    ['object-lasso'],
    ['laser'],
    ['hand'],
  ],
};
