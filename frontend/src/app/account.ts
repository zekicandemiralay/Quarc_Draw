// The Quarc account: the shared login every Quarc app uses (quarc-auth). Documents sync under this account.
//
//  • the web app, served by the Quarc server, talks to /api/auth/* on the same origin;
//  • the Android and Windows apps carry their own copy of the page and call the server's address (VITE_API_URL);
//  • Quarc Store (if installed) can sign this app in: syncFromStore() applies the Store's login before every check.
//
// Drawing never needs an account — it is local-first. Signing in only turns on syncing.

import { Store } from './store';
import { API_BASE } from '../lib/apiUrl';
import { syncFromStore, watchStoreSession } from '../lib/storeSso';
import { syncEngine } from '../sync/engine';

export interface AccountUser { id: string; username: string; role: string }
export interface AccountState {
  /** unknown = not checked yet, or the server could not be reached */
  state: 'unknown' | 'out' | 'in';
  user: AccountUser | null;
  busy: boolean;
  error: string;
}

export const account = new Store<AccountState>(null, { state: 'unknown', user: null, busy: false, error: '' });

const base = () => (syncEngine.config.get().server.url || API_BASE).replace(/\/+$/, '');
const post = (path: string, body?: unknown) => fetch(base() + path, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function whoAmI(): Promise<AccountUser | null | 'unreachable'> {
  try {
    const r = await fetch(base() + '/api/auth/me', { credentials: 'include', signal: AbortSignal.timeout(6000) });
    if (r.ok) return (await r.json()) as AccountUser;
    return r.status === 401 ? null : 'unreachable';
  } catch { return 'unreachable'; }
}

/** After the sign-in state is known: turn syncing on (first sign-in) or off (signed out) to match. */
function reconcileSync() {
  const { state } = account.get();
  const cfg = syncEngine.config.get();
  if (state === 'in') {
    if (cfg.provider === 'none' && cfg.accountAuto) { syncEngine.config.set({ provider: 'server' }); void syncEngine.start(); }
    else if (cfg.provider === 'server' && !syncEngine.connected) void syncEngine.start();
  } else if (state === 'out' && cfg.provider === 'server') {
    syncEngine.stop();
    syncEngine.status.set({ state: 'auth', label: '', message: 'Sign in with your Quarc account to sync' });
  }
}

/** Applies the Store's login (if any), asks the server who is signed in, and updates the sync accordingly. */
export async function checkSession(): Promise<AccountState> {
  account.set({ busy: true });
  try {
    await syncFromStore();
    const who = await whoAmI();
    if (who === 'unreachable') account.set({ busy: false }); // offline / server down: keep what we knew
    else account.set({ busy: false, state: who ? 'in' : 'out', user: who, error: '' });
    reconcileSync();
  } finally { account.set({ busy: false }); }
  return account.get();
}

export async function signIn(username: string, password: string): Promise<boolean> {
  account.set({ busy: true, error: '' });
  try {
    const r = await post('/api/auth/login', { username: username.trim(), password });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      account.set({ busy: false, error: (j as { error?: string }).error || `Sign-in failed (${r.status})` });
      return false;
    }
    await checkSession();
    return account.get().state === 'in';
  } catch {
    account.set({ busy: false, error: 'Could not reach the Quarc server. Is Tailscale connected?' });
    return false;
  }
}

/** "Continue as …": the Store's login, applied on request. */
export async function continueWithStore(): Promise<boolean> {
  account.set({ busy: true, error: '' });
  const r = await syncFromStore({ force: true });
  await checkSession();
  const ok = account.get().state === 'in';
  if (!ok) account.set({ error: r.result === 'error' || r.result === 'timeout' ? 'Quarc Store did not answer. Try again.' : 'Quarc Store is not signed in.' });
  return ok;
}

export async function signOut() {
  account.set({ busy: true });
  try { await post('/api/auth/logout'); } catch { /* offline: the cookie is dropped below anyway */ }
  account.set({ busy: false, state: 'out', user: null });
  reconcileSync();
}

/** app start: check once, and again whenever Quarc Store's login changes (the window/app comes back to the front) */
export function initAccount() {
  watchStoreSession(() => void checkSession());
  void checkSession();
}
