// Full-screen drawing: only the canvas and a few basic tools. Easy in (F, the full-screen buttons) and easy out (the Exit button,
// Esc, F again, the Android Back button / browser Back, or leaving the browser's full screen).

import { Store } from './store';
import { workspace } from './workspace';
import { toast } from './bus';

export const drawMode = new Store<{ full: boolean }>(null, { full: false });

const MARK = 'quarcFullDraw';
/** what we turned on to fill the screen, so leaving the mode undoes exactly that */
let screen: 'dom' | 'tauri' | 'android' | null = null;
let enteredAt = 0;

/** Android: our own QuarcScreen plugin (Capacitor ends the web Fullscreen API the moment it starts) */
const androidScreen = (): any => { const w = window as any; return w.Capacitor?.isNativePlatform?.() ? w.Capacitor.Plugins?.QuarcScreen ?? null : null; };
const isCapacitor = () => !!(window as any).Capacitor?.isNativePlatform?.();

const tauriWindow = (): any => {
  try { return (window as any).__TAURI__?.window?.getCurrentWindow?.() ?? null; } catch { return null; }
};

/** Looking at the whole page? Then show the whole page again once the canvas has its new size (the window may take a moment). */
function keepWholePage() {
  const ed = workspace.active, el = document.querySelector('.viewport');
  if (!ed || !el) return;
  const vis = ed.view.visibleWorldRect(), pg = ed.worldRectOf(ed.page);
  if (pg.x < vis.x - 1 || pg.y < vis.y - 1 || pg.x + pg.w > vis.x + vis.w + 1 || pg.y + pg.h > vis.y + vis.h + 1) return; // zoomed in: leave the view alone
  const ro = new ResizeObserver(() => { if (workspace.active === ed) ed.fitPage(); });
  ro.observe(el);
  setTimeout(() => ro.disconnect(), 1000);
}

export function enterFullDraw() {
  const ed = workspace.active;
  if (drawMode.get().full || !ed) return;
  if (!['brush', 'eraser'].includes(ed.toolId)) ed.setTool('brush');
  keepWholePage();
  drawMode.set({ full: true });
  // a history entry, so Back (Android button, browser, mouse) leaves the mode instead of the app
  try { if (history.state?.[MARK] !== true) history.pushState({ ...(history.state ?? {}), [MARK]: true }, ''); } catch { /* sandboxed */ }
  const tw = tauriWindow(), android = androidScreen();
  enteredAt = performance.now();
  // noted at once, so leaving straight away still undoes it; a refusal (some webviews) just keeps a full-window canvas
  if (android) {
    screen = 'android';
    Promise.resolve(android.setImmersive({ on: true })).catch(() => { if (screen === 'android') screen = null; });
  } else if (isCapacitor()) {
    /* an older app without the plugin: the canvas still fills the window */
  } else if (tw?.setFullscreen) {
    screen = 'tauri';
    Promise.resolve(tw.setFullscreen(true)).then(() => { if (screen !== 'tauri') void tw.setFullscreen(false); }, () => { if (screen === 'tauri') screen = null; });
  } else if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    screen = 'dom';
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(
      () => { if (screen !== 'dom' && document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, // already left again
      () => { if (screen === 'dom') screen = null; });
  }
  toast(matchMedia('(pointer: coarse)').matches ? 'Full screen — tap Exit or go Back to return' : 'Full screen — Esc, F or Exit to return');
}

export function exitFullDraw() {
  if (!drawMode.get().full) return;
  keepWholePage();
  drawMode.set({ full: false });
  if (history.state?.[MARK] === true) { try { history.back(); } catch { /* ignore */ } }
  const was = screen; screen = null;
  if (was === 'android') Promise.resolve(androidScreen()?.setImmersive?.({ on: false })).catch(() => {});
  else if (was === 'tauri') Promise.resolve(tauriWindow()?.setFullscreen?.(false)).catch(() => {});
  else if (was === 'dom' && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
}

export const toggleFullDraw = () => (drawMode.get().full ? exitFullDraw() : enterFullDraw());

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { if (drawMode.get().full && history.state?.[MARK] !== true) exitFullDraw(); });
  // the browser's own way out of full screen (Esc, swipe down, F11) also leaves the mode
  // (a full screen that ends by itself at once was refused by the webview: then only the browser part is dropped)
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement || screen !== 'dom') return;
    screen = null;
    if (performance.now() - enteredAt > 600) exitFullDraw();
  });
}
