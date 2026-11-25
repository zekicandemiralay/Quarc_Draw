// High-level document actions shared by menus, shortcuts, drag-drop and the library.

import { workspace } from './workspace';
import { getBlob, getMeta, saveEditor } from './storage';
import { openFile, OPEN_ACCEPT, isDocFile } from '../io/importers';
import { parseDoc, serializeDoc } from '../io/qdraw';
import { Editor, newDocument } from '../editor/editor';
import { toast } from './bus';
import { downloadBlob, sanitizeFilename } from '../core/util';
import { placeImageBlob } from '../editor/rasterOps';

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.style.display = 'none';
    input.onchange = () => { resolve(Array.from(input.files ?? [])); input.remove(); };
    input.oncancel = () => { resolve([]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

export async function openFiles(files: File[]) {
  for (const f of files) {
    try {
      if (!isDocFile(f.name) && !f.type.startsWith('image/')) { toast(`“${f.name}” is not a supported file type`, 'error'); continue; }
      toast(`Opening ${f.name}…`);
      const ed = await openFile(f);
      const added = workspace.add(ed);
      if (added === ed) ed.fitPage();
    } catch (e: any) { console.error(e); toast(`Could not open ${f.name}: ${e?.message ?? e}`, 'error'); }
  }
}
export async function openFileDialog() { await openFiles(await pickFiles(OPEN_ACCEPT, true)); }

export async function openFromLibrary(id: string) {
  const open = workspace.editors.find((e) => e.doc.id === id);
  if (open) { workspace.setActive(open.id); return; }
  const blob = await getBlob(id);
  if (!blob) { toast('That document is no longer in the library', 'error'); return; }
  try {
    const doc = await parseDoc(blob);
    const ed = new Editor(doc);
    ed.isNew = false;
    workspace.add(ed);
    ed.fitPage();
    ed.history.markSaved();
    const m = await getMeta(id); if (m) ed.lastSavedAt = m.modified;
  } catch (e: any) { console.error(e); toast(`Could not open document: ${e?.message ?? e}`, 'error'); }
}

export function createDrawing(o: { title?: string; width: number; height: number; dpi?: number; background?: string | null }) {
  const ed = newDocument(o);
  workspace.add(ed);
  ed.fitPage();
  return ed;
}
/** Download the document as a .qdraw file (File System Access picker when available). */
export async function saveAsFile(ed: Editor) {
  const blob = await serializeDoc(ed.doc);
  const name = `${sanitizeFilename(ed.doc.title)}.qdraw`;
  const w = window as any;
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const h = await w.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Quarc Draw project', accept: { 'application/vnd.quarc.draw+zip': ['.qdraw'] } }] });
      const wr = await h.createWritable(); await wr.write(blob); await wr.close();
      toast(`Saved ${h.name}`, 'success');
      return;
    } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  downloadBlob(blob, name);
  toast(`Downloaded ${name}`, 'success');
}

export async function saveToLibrary(ed: Editor) {
  try { await workspace.saveNow(ed); toast('Saved to library', 'success'); } catch (e: any) { toast(`Save failed: ${e?.message ?? e}`, 'error'); }
}

/** insert images as layers / objects into the current document */
export async function placeImages(ed: Editor, files: File[], at?: { x: number; y: number }) {
  for (const f of files) {
    try { await placeImageBlob(ed, f, f.name.replace(/\.[^.]+$/, ''), { at }); }
    catch (e: any) { toast(`Could not place ${f.name}: ${e?.message ?? e}`, 'error'); }
  }
}
export { saveEditor };
