import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './ui/App';
import { initSync, syncEngine } from './sync/engine';
import { persistStorage } from './app/storage';

createRoot(document.getElementById('root')!).render(<App />);
initSync();
void persistStorage();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
void StrictMode;

// Test / debugging hook (used by the end-to-end suite and handy in the dev console).
import { workspace } from './app/workspace';
import { runCommand } from './app/commands';
(window as any).__quarc = { workspace, run: runCommand, get ed() { return workspace.active; } };
import { searchState } from './pdf/search';
(window as any).__quarc.search = searchState;
(window as any).__quarc.syncEngine = syncEngine;
