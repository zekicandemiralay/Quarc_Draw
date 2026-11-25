// Tiny reactive persisted store + React hook (no external state library).

import { useSyncExternalStore } from 'react';

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<() => void>();
  constructor(private key: string | null, private defaults: T) {
    let saved: Partial<T> = {};
    if (key) { try { saved = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { /* ignore */ } }
    this.state = { ...defaults, ...saved };
  }
  get = (): T => this.state;
  set(patch: Partial<T> | ((s: T) => Partial<T>)) {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    if (this.key) { try { localStorage.setItem(this.key, JSON.stringify(this.state)); } catch { /* quota */ } }
    for (const l of [...this.listeners]) l();
  }
  reset() { this.set(this.defaults); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  use(): T { return useSyncExternalStore(this.subscribe, this.get); }
  useSelect<S>(sel: (s: T) => S): S {
    return useSyncExternalStore(this.subscribe, () => sel(this.state));
  }
}

// ------------ Preferences ------------
export type ThemeName = 'dark' | 'light' | 'midnight';

export interface Prefs {
  theme: ThemeName;
  penOnly: boolean;         // only pen input draws; touch pans/zooms (like Procreate/GoodNotes "apple pencil only")
  palmRejection: boolean;
  pressureGamma: number;    // pen pressure response curve
  autosave: boolean;
  showRulers: boolean;
  showStatusBar: boolean;
  checker: boolean;
  recentColors: string[];
  swatches: { id: string; name: string; colors: string[] }[];
  userGradients: { id: string; name: string; stops: { pos: number; color: string }[] }[];
  userBrushes: any[];
  customShortcuts: Record<string, string>;
  panelWidth: number;
  leftSidebar: boolean;
  rightDock: boolean;
  openPanels: string[];
  authorName: string;
  tutorialSeen: boolean;
  /** hide the painting on the home screen */
  hideHero: boolean;
  fonts: string[];      // user-loaded font family names
  canvasBg: string;
  language: string;
}
export const prefs = new Store<Prefs>('quarcdraw.prefs.v1', {
  theme: 'dark', penOnly: false, palmRejection: true, pressureGamma: 1, autosave: true,
  showRulers: true, showStatusBar: true, checker: true, recentColors: [], swatches: [], userGradients: [], userBrushes: [],
  customShortcuts: {}, panelWidth: 300, leftSidebar: true, rightDock: true, openPanels: ['color', 'layers'],
  authorName: '', tutorialSeen: false, hideHero: false, fonts: [], canvasBg: '', language: 'en',
});
