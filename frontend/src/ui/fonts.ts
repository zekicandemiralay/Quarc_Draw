// Font lists: built-in web-safe stack + system fonts discovered through the Local Font Access API (Chromium).

export const PRESET_FONTS = [
  'Segoe UI', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Garamond', 'Palatino Linotype', 'Courier New', 'Consolas', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Impact', 'Comic Sans MS', 'Brush Script MT', 'Lucida Handwriting', 'Segoe Script', 'Ink Free', 'Cambria', 'Calibri', 'Candara', 'Century Gothic', 'Franklin Gothic Medium',
  'system-ui', 'serif', 'sans-serif', 'monospace', 'cursive',
];

export async function loadSystemFonts(): Promise<string[]> {
  try {
    const q = (window as any).queryLocalFonts;
    if (typeof q !== 'function') return [];
    const fonts: { family: string }[] = await q.call(window);
    return [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}
