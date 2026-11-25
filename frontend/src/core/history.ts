// Undo/redo history. Two kinds of entries:
//  • patch entries  – raster pixel changes (before/after ImageData of a dirty rect)
//  • snapshot entries – structural changes (cheap shallow snapshots of the page tree)

import { Emitter } from './util';

export interface HistoryEntry {
  label: string;
  undo(): void;
  redo(): void;
  bytes: number;
  time: number;
  /** consecutive entries with the same key within a short window are merged (slider drags etc.) */
  key?: string;
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  readonly events = new Emitter<{ change: void }>();
  maxEntries = 300;
  maxBytes = 300 * 1024 * 1024; // a tablet's browser is killed long before 600 MB of undo data pays off
  /** monotonically increases on every committed change (used for dirty tracking) */
  revision = 0;
  /** revision at last save */
  savedRevision = 0;
  private applying = false;

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get undoLabel() { return this.undoStack[this.undoStack.length - 1]?.label ?? ''; }
  get redoLabel() { return this.redoStack[this.redoStack.length - 1]?.label ?? ''; }
  get isDirty() { return this.revision !== this.savedRevision; }
  get items(): { label: string; time: number; state: 'done' | 'undone' }[] {
    return [
      ...this.undoStack.map((e) => ({ label: e.label, time: e.time, state: 'done' as const })),
      ...[...this.redoStack].reverse().map((e) => ({ label: e.label, time: e.time, state: 'undone' as const })),
    ];
  }
  get currentIndex() { return this.undoStack.length; }

  /** If the newest entry has the same key and is recent, replace its redo (keeping its original undo). */
  coalesce(key: string, redo: () => void, windowMs = 1200): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    if (!top || top.key !== key || this.redoStack.length || Date.now() - top.time > windowMs) return false;
    top.redo = redo; top.time = Date.now();
    this.revision++;
    this.events.emit('change', undefined);
    return true;
  }

  private groups: HistoryEntry[][] = [];
  /** Collect all entries pushed until endGroup into ONE undo step. */
  beginGroup() { this.groups.push([]); }
  endGroup(label: string) {
    const g = this.groups.pop();
    if (!g || !g.length) return;
    if (g.length === 1) { this.groups.length ? this.groups[this.groups.length - 1].push(g[0]) : this.push(g[0]); return; }
    this.push({
      label, bytes: g.reduce((s, e) => s + e.bytes, 0),
      undo: () => { for (let i = g.length - 1; i >= 0; i--) g[i].undo(); },
      redo: () => { for (const e of g) e.redo(); },
    });
  }

  push(entry: Omit<HistoryEntry, 'time'>) {
    if (this.applying) return;
    if (this.groups.length) { this.groups[this.groups.length - 1].push({ ...entry, time: Date.now() }); return; }
    this.undoStack.push({ ...entry, time: Date.now() });
    this.redoStack.length = 0;
    this.revision++;
    this.trim();
    this.events.emit('change', undefined);
  }

  private trim() {
    let total = this.undoStack.reduce((s, e) => s + e.bytes, 0);
    while (this.undoStack.length > this.maxEntries || (total > this.maxBytes && this.undoStack.length > 1)) {
      const e = this.undoStack.shift()!;
      total -= e.bytes;
    }
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.applying = true;
    try { e.undo(); } finally { this.applying = false; }
    this.redoStack.push(e);
    this.revision++;
    this.events.emit('change', undefined);
    return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.applying = true;
    try { e.redo(); } finally { this.applying = false; }
    this.undoStack.push(e);
    this.revision++;
    this.events.emit('change', undefined);
    return true;
  }
  /** jump so that exactly `index` entries are applied */
  jumpTo(index: number) {
    while (this.undoStack.length > index && this.undo());
    while (this.undoStack.length < index && this.redo());
  }
  clear() {
    this.undoStack.length = 0; this.redoStack.length = 0;
    this.events.emit('change', undefined);
  }
  markSaved() { this.savedRevision = this.revision; this.events.emit('change', undefined); }
}
