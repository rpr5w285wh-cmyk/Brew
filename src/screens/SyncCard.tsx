import { useEffect, useState } from 'preact/hooks';
import { onStatus, signIn, signOut, syncNow, type SyncStatus } from '../lib/sync';
import { fmtTime } from '../lib/day';

export function useSyncStatus(): SyncStatus {
  const [s, set] = useState<SyncStatus>({ signedIn: false, pending: 0, syncing: false });
  useEffect(() => onStatus(set), []);
  return s;
}

function ago(ts?: number): string {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `at ${fmtTime(ts)}`;
}

export function SyncCard() {
  const s = useSyncStatus();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    const msg = await signIn(email.trim(), password);
    setBusy(false);
    if (msg) setErr(msg); else setPassword('');
  };

  if (!s.signedIn) {
    return (
      <>
        <form class="card" onSubmit={submit}>
          <div class="field"><label for="sync-email">Email</label><input id="sync-email" type="email" autocomplete="username" inputMode="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} required /></div>
          <div class="field"><label for="sync-pw">Password</label><input id="sync-pw" type="password" autocomplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} required /></div>
          <div style="padding:0 14px 14px"><button class="btn" type="submit" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in and sync'}</button></div>
        </form>
        {err && <p class="note" style="color:var(--warn)">{err}</p>}
        <p class="note muted">Signing in merges this copy's taps with your other devices. Sign in once in each browser or app you use.</p>
      </>
    );
  }

  return (
    <>
      <div class="card">
        <div class="field"><label>Signed in</label><span class="muted" style="overflow:hidden;text-overflow:ellipsis;max-width:60%">{s.email}</span></div>
        <div class="field"><label>Last synced</label><span class="muted">{s.syncing ? 'syncing…' : ago(s.lastSync)}</span></div>
        <div class="field"><label>Waiting to upload</label><span class="muted">{s.pending}</span></div>
        <div class="field"><label>Sync now</label><button class="pill ghost" onClick={() => syncNow()} disabled={s.syncing}>Sync</button></div>
        <div class="field"><label>Sign out</label><button class="pill ghost" onClick={() => { if (confirm('Sign out? Taps stay on this phone; they just stop syncing.')) signOut(); }}>Sign out</button></div>
      </div>
      {s.error && <p class="note" style="color:var(--warn)">{s.error}</p>}
    </>
  );
}
