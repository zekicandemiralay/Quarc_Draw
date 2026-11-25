import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './ui/App';
import { initSync, syncEngine } from './sync/engine';
import { persistStorage } from './app/storage';
import { initAccount } from './app/account';

createRoot(document.getElementById('root')!).render(<App />);
initSync();
initAccount();
void persistStorage();

// The Windows and Android apps carry their own copy of the page (served from tauri.localhost / https://localhost), which is always
// the current version and opens offline by itself. A service worker there only ever served the previous version's page after an
// update (the Quarc Weather app was left blank by exactly that), so it is registered for the web app only.
const isNativeApp = ['tauri.localhost', 'localhost'].includes(location.hostname) || !!(window as any).__TAURI__ || !!(window as any).Capacitor?.isNativePlatform?.();
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
void StrictMode;

// Test / debugging hook (used by the end-to-end suite and handy in the dev console).
import { workspace } from './app/workspace';
import { runCommand } from './app/commands';
(window as any).__quarc = { workspace, run: runCommand, get ed() { return workspace.active; } };
(window as any).__quarc.syncEngine = syncEngine;
