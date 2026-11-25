// Open documents (tabs), active document, autosave.

import { useSyncExternalStore } from 'react';
import type { Editor } from '../editor/editor';
import { Emitter, debounce } from '../core/util';
import { prefs } from './store';
import { saveEditor } from './storage';
import { toast } from './bus';

class Workspace {
  editors: Editor[] = [];
  activeId: string | null = null;
  version = 0;
  events = new Emitter<{ change: void }>();
  private autosavers = new Map<string, { off: () => void; save: ReturnType<typeof debounce> }>();
  /** hook for the sync engine */
  onSaved: ((ed: Editor) => void) | null = null;

  get active(): Editor | null { return this.editors.find((e) => e.id === this.activeId) ?? null; }
  private bump() { this.version++; this.events.emit('change', undefined); }

  add(ed: Editor, activate = true) {
    // already open (same document id)? just focus it
    const existing = this.editors.find((e) => e.doc.id === ed.doc.id);
    if (existing) { this.activeId = existing.id; this.bump(); return existing; }
    this.editors.push(ed);
    const save = debounce(async () => {
      if (!prefs.get().autosave || !ed.dirty) return;
      // saving encodes layers and writes megabytes: never in the middle of drawing — look again after the next pause
      if (performance.now() - ed.lastInputAt < 1500) { save(); return; }
      try { await saveEditor(ed); this.onSaved?.(ed); } catch (e) { console.error('autosave failed', e); }
    }, 2500);
    const off = ed.history.events.on('change', () => { save(); this.bump(); });
    this.autosavers.set(ed.id, { off, save });
    if (activate) this.activeId = ed.id;
    this.bump();
    return ed;
  }
  setActive(id: string) { if (this.activeId !== id) { this.activeId = id; this.bump(); } }

  async close(ed: Editor, opts: { save?: boolean } = {}) {
    const a = this.autosavers.get(ed.id);
    if (opts.save !== false && ed.dirty) { try { a?.save.cancel(); await saveEditor(ed); this.onSaved?.(ed); } catch { toast('Could not save before closing', 'error'); } }
    a?.off(); a?.save.cancel(); this.autosavers.delete(ed.id);
    const i = this.editors.indexOf(ed);
    this.editors.splice(i, 1);
    if (this.activeId === ed.id) this.activeId = this.editors[Math.min(i, this.editors.length - 1)]?.id ?? null;
    ed.dispose();
    this.bump();
  }
  /** persist right now (Ctrl+S) */
  async saveNow(ed: Editor) {
    this.autosavers.get(ed.id)?.save.cancel();
    const m = await saveEditor(ed);
    this.onSaved?.(ed);
    return m;
  }
  async flushAll() {
    await Promise.all(this.editors.filter((e) => e.dirty).map((e) => { this.autosavers.get(e.id)?.save.cancel(); return saveEditor(e).catch(() => undefined); }));
  }
  subscribe = (fn: () => void) => this.events.on('change', fn);
}
export const workspace = new Workspace();

export function useWorkspace() {
  useSyncExternalStore(workspace.subscribe, () => workspace.version);
  return workspace;
}
