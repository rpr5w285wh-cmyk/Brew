import { createClient, type SupabaseClient, type Session as AuthSession } from '@supabase/supabase-js';
import { db, PROFILE_ID, type Event, type Settings, type TemplateRow, type PlanDay } from './db';
import { setOnAppend } from './events';

// Cloud sync. The phone stays the source of truth for the UI; Supabase is the shared copy.
// Events: append-only, merged by uid (insert-if-missing both ways).
// State (settings, template, each day's plan): last write wins by updated_at.
// The publishable key is meant to be public; row-level security + grants protect the data.

export const SUPABASE_URL = 'https://dhetwzklyujcaiehdijo.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_7ZAB12GnEy_iJU0m2whiYQ_ElKl1GW4';

let client: SupabaseClient | null = null;
export function supa(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'brew-auth' },
    });
  }
  return client;
}

const LS = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const K = { eventCursor: 'brew-sync-events-cursor', stateCursor: 'brew-sync-state-cursor', lastSync: 'brew-sync-last', stateStamps: 'brew-sync-state-stamps' };

export type SyncStatus = { signedIn: boolean; email?: string; lastSync?: number; pending: number; syncing: boolean; error?: string };
let status: SyncStatus = { signedIn: false, pending: 0, syncing: false };
const listeners = new Set<(s: SyncStatus) => void>();
function emit(patch: Partial<SyncStatus>) { status = { ...status, ...patch }; listeners.forEach((f) => f(status)); }
export function onStatus(f: (s: SyncStatus) => void): () => void { listeners.add(f); f(status); return () => listeners.delete(f); }
export function getStatus(): SyncStatus { return status; }

function device(): string {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  return `${ios ? 'iphone' : 'web'}-${standalone ? 'app' : 'browser'}`;
}

async function pendingCount(): Promise<number> { return db.events.where('synced').equals(0).count(); }

// ---------- auth ----------
export async function initSync(): Promise<void> {
  const { data } = await supa().auth.getSession();
  setSession(data.session);
  supa().auth.onAuthStateChange((_e, s) => setSession(s));
  emit({ pending: await pendingCount(), lastSync: Number(LS.get(K.lastSync)) || undefined });
  setOnAppend(() => schedule());
  addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  if (status.signedIn) schedule(0);
}
function setSession(s: AuthSession | null) { emit({ signedIn: !!s, email: s?.user.email ?? undefined }); }

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithPassword({ email, password });
  if (error) return error.message === 'Invalid login credentials' ? 'Email or password is wrong.' : error.message;
  await syncNow();
  return null;
}
export async function signOut(): Promise<void> {
  await supa().auth.signOut();
  LS.del(K.eventCursor); LS.del(K.stateCursor); LS.del(K.stateStamps);
  emit({ signedIn: false, email: undefined });
}

// ---------- scheduling ----------
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
export function schedule(delayMs = 3000): void {
  pendingCount().then((n) => emit({ pending: n }));
  if (!status.signedIn) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, delayMs);
}

export async function syncNow(): Promise<void> {
  if (!status.signedIn) return;
  if (running) { again = true; return running; }
  running = (async () => {
    emit({ syncing: true, error: undefined });
    try {
      await pushEvents();
      // First sync after signing in on this device: the cloud's settings/template/plans win, so pull before pushing.
      const firstState = !LS.get(K.stateCursor);
      let changed = 0;
      if (firstState) changed += await pullState(true);
      await pushState();
      changed += (await pullEvents()) + (firstState ? 0 : await pullState());
      const now = Date.now();
      LS.set(K.lastSync, String(now));
      emit({ lastSync: now, pending: await pendingCount() });
      if (changed) dispatchEvent(new CustomEvent('brew-synced', { detail: { changed } }));
    } catch (e) {
      emit({ error: navigator.onLine ? String((e as Error)?.message ?? e) : 'Offline — will sync when back online' });
    } finally {
      emit({ syncing: false });
      running = null;
      if (again) { again = false; schedule(0); }
    }
  })();
  return running;
}

// ---------- events ----------
type EventRow = { id: string; ts: string; day: string; type: string; key: string | null; value: unknown; meta: unknown; device: string; created_at?: string };

async function pushEvents(): Promise<void> {
  for (;;) {
    const batch = await db.events.where('synced').equals(0).limit(500).toArray();
    if (!batch.length) return;
    const rows: EventRow[] = batch.filter((e) => e.uid).map((e) => ({
      id: e.uid!, ts: new Date(e.ts).toISOString(), day: e.day, type: e.type,
      key: e.key ?? null, value: e.value ?? null, meta: e.meta ?? null, device: device(),
    }));
    // ON CONFLICT DO NOTHING: needs only the insert grant, so the cloud log stays append-only.
    const { error } = await supa().from('events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    await db.events.bulkUpdate(batch.map((e) => ({ key: e.id!, changes: { synced: 1 as const } })));
  }
}

const OVERLAP_MS = 120_000; // re-read a little behind the cursor; merging by uid makes repeats harmless

async function pullEvents(): Promise<number> {
  let added = 0;
  let cursor = LS.get(K.eventCursor) ?? '1970-01-01T00:00:00Z';
  for (;;) {
    const since = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
    const { data, error } = await supa().from('events').select('*').gt('created_at', since).order('created_at', { ascending: true }).limit(1000);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as EventRow[];
    if (!rows.length) break;
    const known = new Set((await db.events.where('uid').anyOf(rows.map((r) => r.id)).toArray()).map((e) => e.uid));
    const fresh: Event[] = rows.filter((r) => !known.has(r.id)).map((r) => ({
      uid: r.id, profileId: PROFILE_ID, ts: Date.parse(r.ts), day: r.day, type: r.type as Event['type'],
      key: r.key ?? undefined, value: (r.value ?? undefined) as Event['value'], meta: (r.meta ?? undefined) as Event['meta'], synced: 1,
    }));
    if (fresh.length) { await db.events.bulkAdd(fresh); added += fresh.length; }
    const last = rows[rows.length - 1].created_at!;
    if (last === cursor && rows.length < 1000) break;
    cursor = last;
    LS.set(K.eventCursor, cursor);
    if (rows.length < 1000) break;
  }
  return added;
}

// ---------- state ----------
type StateRow = { kind: string; body: unknown; updated_at: string };
function stamps(): Record<string, number> { try { return JSON.parse(LS.get(K.stateStamps) ?? '{}'); } catch { return {}; } }
function stamp(kind: string, at: number) { const s = stamps(); s[kind] = at; LS.set(K.stateStamps, JSON.stringify(s)); }
const dirty = new Set<string>();

/** Call after any local change to settings, the template, or a day's plan. */
export function markStateDirty(kind: 'settings' | 'template' | `plan:${string}`): void {
  stamp(kind, Date.now());
  dirty.add(kind);
  schedule(1500);
}

async function localBody(kind: string): Promise<unknown> {
  if (kind === 'settings') return db.settings.get(PROFILE_ID);
  if (kind === 'template') return db.template.where('profileId').equals(PROFILE_ID).toArray();
  if (kind.startsWith('plan:')) return db.plan_days.get([PROFILE_ID, kind.slice(5)]);
  return undefined;
}

async function pushState(): Promise<void> {
  if (!dirty.size) return;
  const kinds = [...dirty];
  const rows: StateRow[] = [];
  for (const kind of kinds) {
    const body = await localBody(kind);
    if (body) rows.push({ kind, body, updated_at: new Date(stamps()[kind] ?? Date.now()).toISOString() });
  }
  if (rows.length) {
    const { error } = await supa().from('state').upsert(rows, { onConflict: 'user_id,kind' });
    if (error) throw new Error(error.message);
  }
  kinds.forEach((k) => dirty.delete(k));
}

async function pullState(cloudWins = false): Promise<number> {
  const cursor = LS.get(K.stateCursor) ?? '1970-01-01T00:00:00Z';
  const { data, error } = await supa().from('state').select('kind, body, updated_at').gt('updated_at', cursor).order('updated_at', { ascending: true });
  if (error) throw new Error(error.message);
  let applied = 0;
  const local = stamps();
  for (const r of (data ?? []) as StateRow[]) {
    const remoteAt = Date.parse(r.updated_at);
    if (!cloudWins && ((local[r.kind] ?? 0) >= remoteAt || dirty.has(r.kind))) continue; // ours is newer
    dirty.delete(r.kind);
    if (r.kind === 'settings') await db.settings.put({ ...(r.body as Settings), profileId: PROFILE_ID });
    else if (r.kind === 'template') await db.transaction('rw', db.template, async () => {
      await db.template.where('profileId').equals(PROFILE_ID).delete();
      await db.template.bulkPut((r.body as TemplateRow[]).map((t) => ({ ...t, profileId: PROFILE_ID })));
    });
    else if (r.kind.startsWith('plan:')) await db.plan_days.put({ ...(r.body as PlanDay), profileId: PROFILE_ID });
    else continue;
    stamp(r.kind, remoteAt);
    applied++;
  }
  const rows = (data ?? []) as StateRow[];
  LS.set(K.stateCursor, rows.length ? rows[rows.length - 1].updated_at : (LS.get(K.stateCursor) ?? '1970-01-01T00:00:00Z'));
  return applied;
}

/** First thing on a new day: if another device already planned today, use its plan. Bounded so a slow network never blocks the morning. */
export async function pullBeforePlanning(timeoutMs = 2500): Promise<void> {
  if (!status.signedIn) return;
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, timeoutMs))]);
}
