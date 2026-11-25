// Static tool metadata used by the toolbar, command palette and shortcut system.

export interface ToolMeta {
  id: string;
  name: string;
  icon: string;      // key into the icon set
  key?: string;      // shortcut
  group: string;     // toolbar slot (flyout group)
  hint?: string;
}

export const TOOL_CATALOG: ToolMeta[] = [
  { id: 'move', name: 'Move / Select', icon: 'move', key: 'V', group: 'move', hint: 'Select and move objects or pixels. Alt-drag duplicates.' },
  { id: 'transform', name: 'Free Transform', icon: 'transform', key: 'Ctrl+T', group: 'move', hint: 'Scale, rotate and flip pixels. Enter to apply.' },
  { id: 'marquee-rect', name: 'Rectangular Marquee', icon: 'marquee', key: 'M', group: 'select' },
  { id: 'marquee-ellipse', name: 'Elliptical Marquee', icon: 'marquee-ellipse', key: 'M', group: 'select' },
  { id: 'lasso', name: 'Lasso', icon: 'lasso', key: 'L', group: 'select' },
  { id: 'lasso-poly', name: 'Polygonal Lasso', icon: 'lasso-poly', key: 'L', group: 'select' },
  { id: 'wand', name: 'Magic Wand', icon: 'wand', key: 'W', group: 'select' },
  { id: 'select-brush', name: 'Selection Brush', icon: 'select-brush', key: 'Shift+W', group: 'select' },
  { id: 'crop', name: 'Crop', icon: 'crop', key: 'C', group: 'crop' },
  { id: 'eyedropper', name: 'Eyedropper', icon: 'eyedropper', key: 'I', group: 'sample' },
  { id: 'measure', name: 'Measure', icon: 'ruler', key: 'Shift+I', group: 'sample' },
  // raster painting
  { id: 'brush', name: 'Brush', icon: 'brush', key: 'B', group: 'paint' },
  { id: 'eraser', name: 'Eraser', icon: 'eraser', key: 'E', group: 'erase' },
  { id: 'smudge', name: 'Smudge', icon: 'smudge', key: 'S', group: 'retouch' },
  { id: 'blur', name: 'Blur', icon: 'blur', key: 'Shift+B', group: 'retouch' },
  { id: 'sharpen', name: 'Sharpen', icon: 'sharpen', key: 'Shift+S', group: 'retouch' },
  { id: 'dodge', name: 'Dodge', icon: 'dodge', key: 'O', group: 'retouch' },
  { id: 'burn', name: 'Burn', icon: 'burn', key: 'Shift+O', group: 'retouch' },
  { id: 'clone', name: 'Clone Stamp', icon: 'clone', key: 'K', group: 'retouch' },
  { id: 'bucket', name: 'Paint Bucket', icon: 'bucket', key: 'G', group: 'fill' },
  { id: 'gradient', name: 'Gradient', icon: 'gradient', key: 'Shift+G', group: 'fill' },
  // vector
  { id: 'pen', name: 'Pen (Bezier)', icon: 'bezier', key: 'P', group: 'vector' },
  { id: 'node', name: 'Node Edit', icon: 'node', key: 'A', group: 'vector' },
  { id: 'freeform', name: 'Freeform Path', icon: 'freeform', key: 'Shift+P', group: 'vector' },
  { id: 'rect', name: 'Rectangle', icon: 'rect', key: 'U', group: 'shape' },
  { id: 'ellipse', name: 'Ellipse', icon: 'ellipse', key: 'U', group: 'shape' },
  { id: 'polygon', name: 'Polygon', icon: 'polygon', key: 'U', group: 'shape' },
  { id: 'star', name: 'Star', icon: 'star', key: 'U', group: 'shape' },
  { id: 'line', name: 'Line', icon: 'line', key: 'U', group: 'shape' },
  { id: 'arrow', name: 'Arrow', icon: 'arrow', key: 'U', group: 'shape' },
  { id: 'text', name: 'Text', icon: 'text', key: 'T', group: 'text' },
  { id: 'image', name: 'Insert Image', icon: 'image', group: 'annotate' },
  // view
  { id: 'hand', name: 'Hand', icon: 'hand', key: 'H', group: 'view' },
  { id: 'zoom', name: 'Zoom', icon: 'zoom', key: 'Z', group: 'view' },
  { id: 'rotate-view', name: 'Rotate View', icon: 'rotate-view', key: 'R', group: 'view' },
];
export const toolMeta = (id: string) => TOOL_CATALOG.find((t) => t.id === id);

/** toolbar slots – ordered; each slot is a flyout group of tool ids */
export const TOOLBAR: string[][] = [
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
];
