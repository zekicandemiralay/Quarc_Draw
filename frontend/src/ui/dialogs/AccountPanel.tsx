// The "Quarc account" part of the Sync dialog: sign in with the shared Quarc account (or via Quarc Store), sign out.

import { useEffect, useState } from 'react';
import { Field } from '../common';
import { Icon } from '../icons';
import { account, continueWithStore, signIn, signOut, checkSession } from '../../app/account';
import { syncEngine } from '../../sync/engine';
import { openStore, peekStore } from '../../lib/storeSso';

type StoreInfo = Awaited<ReturnType<typeof peekStore>>;

export function AccountPanel({ busy, connect }: { busy: boolean; connect: () => void }) {
  const acc = account.use();
  const st = syncEngine.status.use();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [store, setStore] = useState<StoreInfo>({ installed: false, available: false });

  // Is Quarc Store here (Android / Windows app), and who is signed in to it?
  useEffect(() => {
    let alive = true;
    void peekStore().then((s) => { if (alive) setStore(s); });
    return () => { alive = false; };
  }, [acc.state]);

  if (acc.state === 'in' && acc.user) {
    return (
      <div className="col" data-testid="account-in">
        <div className="row" style={{ gap: 10 }}>
          <Icon name="check" size={16} />
          <span>Signed in as <b>{acc.user.username}</b></span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} disabled={acc.busy} onClick={() => void signOut()}>Sign out</button>
        </div>
        <div className="hint">Your documents sync under this Quarc account: the same drawings on every device you sign in on, with live updates. Conflicts never lose work.</div>
        {st.state === 'error' || st.state === 'auth' ? <div><button className="btn primary" disabled={busy} onClick={connect}>{busy ? 'Connecting…' : 'Connect'}</button></div> : null}
      </div>
    );
  }

  const storeUser = store.available && store.state === 'signed_in' ? store.user?.username : undefined;
  const submit = () => { if (username.trim() && password) void signIn(username, password); };
  return (
    <div className="col" data-testid="account-out">
      <div className="hint">Sign in with the account you use for Quarc Music, Notes and the other Quarc apps. Drawing never needs it: it only turns on syncing.</div>
      {storeUser && (
        <div><button className="btn primary" disabled={acc.busy} onClick={() => void continueWithStore()}><Icon name="check" size={14} />Continue as {storeUser}</button>
          <div className="hint" style={{ marginTop: 4 }}>You are signed in to Quarc Store on this device.</div></div>
      )}
      {!storeUser && store.installed && (
        <div><button className="btn" disabled={acc.busy} onClick={() => void openStore('login').then(() => undefined)}>Sign in with Quarc Store</button>
          <div className="hint" style={{ marginTop: 4 }}>Opens Quarc Store; sign in there and switch back to Quarc Draw.</div></div>
      )}
      <Field label="Username"><input className="input grow" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} /></Field>
      <Field label="Password"><input className="input grow" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} /></Field>
      {acc.error && <div className="badge warn" role="alert" style={{ alignSelf: 'flex-start' }}>{acc.error}</div>}
      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" disabled={acc.busy || !username.trim() || !password} onClick={submit}>{acc.busy ? 'Signing in…' : 'Sign in'}</button>
        <button className="btn ghost" disabled={acc.busy} onClick={() => void checkSession()} title="Check again, for example after signing in elsewhere"><Icon name="sync" size={14} />Check again</button>
      </div>
    </div>
  );
}
