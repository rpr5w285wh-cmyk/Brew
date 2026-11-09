import { createClient, type SupabaseClient, type Session as AuthSession } from '@supabase/supabase-js';
import { db, PROFILE_ID, type Event, type Settings, type TemplateRow, type PlanDay } from './db';
import { setOnAppend, activeEvents, eventsForDay, effTs, undoEvent } from './events';

// Cloud sync. The phone stays the source of truth for the UI; Supabase is the shared copy.
// Events: append-only, merged by uid (insert-if-missing both ways), paged with a (created_at, id) keyset.
// State: one row per setting field, the weekly template, and each day's plan.
//   Last write wins by the CLIENT time of the change (client_at), enforced on the server by put_state();
//   the server stamps updated_at = now() so a late push is still seen by other devices.
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
const K = {
  eventCursor: 'brew-sync-events-cursor', stateCursor: 'brew-sync-state-cursor', lastSync: 'brew-sync-last',
  stateStamps: 'brew-sync-state-stamps', dirty: 'brew-sync-dirty', pendingSince: 'brew-sync-pending-since', migrated: 'brew-sync-fields-v2',
};

export type SyncStatus = {
  signedIn: boolean; email?: string; lastSync?: number; pending: number; pendingSince?: number;
  syncing: boolean; error?: string; needsDbUpdate?: boolean;
};
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

async function refreshPending(): Promise<void> {
  const n = await db.events.where('synced').equals(0).count();
  let since = Number(LS.get(K.pendingSince)) || undefined;
  if (n === 0) { since = undefined; LS.del(K.pendingSince); }
  else if (!since) { since = Date.now(); LS.set(K.pendingSince, String(since)); }
  emit({ pending: n, pendingSince: since });
}

// ---------- which settings sync ----------
// Theme is a per-device preference and never syncs. (C7)
export const SYNCED_SETTINGS: (keyof Settings)[] = [
  'wakeTarget', 'bedtimeHypothesis', 'weekendBedtime', 'weekendWake', 'windDownLeadMin', 'waterTarget', 'waterFloor',
  'tier', 'noRepeatDays', 'kitchenClosedEnabled', 'dayBoundary', 'breathingUrl', 'weighDay', 'tisaneCountsAsWater',
];
type Kind = `setting:${string}` | 'template' | `plan:${string}`;

// ---------- auth ----------
export async function initSync(): Promise<void> {
  const { data } = await supa().auth.getSession();
  setSession(data.session);
  supa().auth.onAuthStateChange((_e, s) => setSession(s));
  migrateStamps();
  emit({ lastSync: Number(LS.get(K.lastSync)) || undefined });
  await refreshPending();
  setOnAppend(() => schedule());
  addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(0); });
  if (status.signedIn) schedule(0);
}
function setSession(s: AuthSession | null) { emit({ signedIn: !!s, email: s?.user.email ?? undefined }); }

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supa().auth.signInWithPassword({ email, password });
  if (error) return error.message === 'Invalid login credentials' ? 'Email or password is wrong.' : friendly(error);
  await syncNow();
  return null;
}
export async function signOut(): Promise<void> {
  // 'local' always clears this device's session, even offline. (C16)
  await supa().auth.signOut({ scope: 'local' }).catch(() => undefined);
  resetCursors();
  LS.del(K.stateStamps); LS.del(K.dirty);
  emit({ signedIn: false, email: undefined, error: undefined });
}

/** Forget sync position so the next sync re-reads everything from the cloud (merge by uid makes this safe). (C13) */
export function resetCursors(): void { LS.del(K.eventCursor); LS.del(K.stateCursor); }

// ---------- scheduling ----------
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<void> | null = null;
let again = false;
export function schedule(delayMs = 3000): void {
  void refreshPending();
  if (!status.signedIn) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void syncNow(); }, delayMs);
}

function friendly(e: unknown): string {
  const msg = String((e as { message?: string })?.message ?? e);
  const code = (e as { code?: string; status?: number })?.code;
  if (!navigator.onLine) return 'Offline — taps are safe on this phone and will sync later.';
  if (/Failed to fetch|NetworkError|Load failed|fetch/i.test(msg)) return "Can't reach the sync server — taps are safe on this phone. If this lasts a day, the Supabase project may be paused.";
  if (/JWT|401|not authenticated|refresh token/i.test(msg) || code === 'PGRST301') return 'Signed out on the server — sign in again under Settings → Sync.';
  return `Sync problem: ${msg}`;
}

export async function syncNow(): Promise<void> {
  if (!status.signedIn) return;
  if (running) { again = true; return running; }
  running = (async () => {
    emit({ syncing: true }); // keep the last error on screen until a sync actually succeeds (C21)
    try {
      await pushEvents();
      // State: read what's newer in the cloud first, then send our newer changes.
      let changed = await pullState();
      await pushState();
      changed += await pullEvents();
      const now = Date.now();
      LS.set(K.lastSync, String(now));
      emit({ lastSync: now, error: undefined });
      await refreshPending();
      if (changed) dispatchEvent(new CustomEvent('brew-synced', { detail: { changed } }));
    } catch (e) {
      emit({ error: friendly(e) });
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
  for (let guard = 0; guard < 200; guard++) {
    const batch = await db.events.where('synced').equals(0).limit(500).toArray();
    if (!batch.length) return;
    const rows: EventRow[] = batch.filter((e) => e.uid).map((e) => ({
      id: e.uid!, ts: new Date(e.ts).toISOString(), day: e.day, type: e.type,
      key: e.key ?? null, value: e.value ?? null, meta: e.meta ?? null, device: device(),
    }));
    // ON CONFLICT DO NOTHING: needs only the insert grant, so the cloud log stays append-only.
    const { error } = await supa().from('events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    await db.events.bulkUpdate(batch.map((e) => ({ key: e.id!, changes: { synced: 1 as const } })));
  }
}

const OVERLAP_MS = 120_000; // re-read a little behind the cursor once per sync; merging by uid makes repeats harmless
const PAGE = 1000;

async function pullEvents(): Promise<number> {
  let added = 0;
  const cursor = LS.get(K.eventCursor) ?? '1970-01-01T00:00:00.000Z';
  // First page starts 2 min behind the cursor; after that, page with a strict (created_at, id) keyset
  // so a page full of rows sharing one created_at can't loop forever. (C4)
  let at = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
  let id = '';
  let newest = cursor;
  for (let page = 0; page < 100; page++) {
    let q = supa().from('events').select('*');
    q = id ? q.or(`created_at.gt.${at},and(created_at.eq.${at},id.gt.${id})`) : q.gt('created_at', at);
    const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true }).limit(PAGE);
    if (error) throw error;
    const rows = (data ?? []) as EventRow[];
    if (!rows.length) break;
    const known = new Set((await db.events.where('uid').anyOf(rows.map((r) => r.id)).toArray()).map((e) => e.uid));
    const fresh: Event[] = rows.filter((r) => !known.has(r.id)).map((r) => ({
      uid: r.id, profileId: PROFILE_ID, ts: Date.parse(r.ts), day: r.day, type: r.type as Event['type'],
      key: r.key ?? undefined, value: (r.value ?? undefined) as Event['value'], meta: (r.meta ?? undefined) as Event['meta'], synced: 1,
    }));
    if (fresh.length) { await db.events.bulkAdd(fresh); added += fresh.length; await markDuplicates([...new Set(fresh.map((e) => e.day))]); }
    const last = rows[rows.length - 1];
    at = last.created_at!; id = last.id;
    if (at > newest) newest = at;
    if (rows.length < PAGE) break;
  }
  LS.set(K.eventCursor, newest);
  return added;
}

// ---------- state ----------
type StateRow = { kind: string; body: unknown; updated_at: string; client_at?: string | null };
/** Plans created automatically are "weak": any plan already in the cloud for that day wins over them. */
const WEAK = 1;
function stamps(): Record<string, number> { try { return JSON.parse(LS.get(K.stateStamps) ?? '{}'); } catch { return {}; } }
function stamp(kind: string, at: number) { const s = stamps(); s[kind] = at; LS.set(K.stateStamps, JSON.stringify(s)); }
// Unpushed changes survive an app restart. (C6)
function dirtySet(): Set<string> { try { return new Set(JSON.parse(LS.get(K.dirty) ?? '[]')); } catch { return new Set(); } }
function saveDirty(d: Set<string>) { LS.set(K.dirty, JSON.stringify([...d])); }

/** Call after a local change. `weak` = an automatic plan that should yield to one already in the cloud. */
export function markStateDirty(kind: Kind, opts: { weak?: boolean } = {}): void {
  stamp(kind, opts.weak ? WEAK : Date.now());
  const d = dirtySet(); d.add(kind); saveDirty(d);
  schedule(1500);
}
export function markSettingsDirty(keys: string[]): void {
  for (const k of keys) if ((SYNCED_SETTINGS as string[]).includes(k)) markStateDirty(`setting:${k}`);
}

/** One-time: the old single 'settings' stamp becomes a stamp on each field that differs from the defaults. */
function migrateStamps(): void {
  if (LS.get(K.migrated)) return;
  const s = stamps();
  const old = s['settings'];
  if (old) {
    void db.settings.get(PROFILE_ID).then(async (cur) => {
      const { DEFAULT_SETTINGS } = await import('./seed');
      if (!cur) return;
      for (const k of SYNCED_SETTINGS) if (JSON.stringify(cur[k]) !== JSON.stringify(DEFAULT_SETTINGS[k])) stamp(`setting:${k}`, old);
    });
    delete s['settings'];
    LS.set(K.stateStamps, JSON.stringify(s));
  }
  const d = dirtySet();
  if (d.delete('settings')) { for (const k of SYNCED_SETTINGS) d.add(`setting:${k}`); saveDirty(d); }
  LS.set(K.migrated, '1');
}

async function localBody(kind: string): Promise<unknown> {
  if (kind.startsWith('setting:')) { const s = await db.settings.get(PROFILE_ID); return s ? { v: s[kind.slice(8) as keyof Settings] } : undefined; }
  if (kind === 'template') return db.template.where('profileId').equals(PROFILE_ID).toArray();
  if (kind.startsWith('plan:')) return db.plan_days.get([PROFILE_ID, kind.slice(5)]);
  return undefined;
}

let rpcMissing = false;
async function pushState(): Promise<void> {
  const d = dirtySet();
  if (!d.size) return;
  const st = stamps();
  for (const kind of [...d]) {
    const body = await localBody(kind);
    if (body === undefined) { d.delete(kind); continue; }
    const clientAt = new Date(st[kind] ?? Date.now()).toISOString();
    if (!rpcMissing) {
      const { error } = await supa().rpc('put_state', { p_kind: kind, p_body: body, p_client_at: clientAt });
      if (error && (error.code === 'PGRST202' || /put_state/.test(error.message))) { rpcMissing = true; emit({ needsDbUpdate: true }); }
      else if (error) throw error;
    }
    if (rpcMissing) {
      // Older database without put_state(): plain upsert (no server-side last-write-wins).
      const { error } = await supa().from('state').upsert([{ kind, body, updated_at: new Date().toISOString() }], { onConflict: 'user_id,kind' });
      if (error) throw error;
    }
    d.delete(kind);
  }
  saveDirty(d);
}

async function pullState(): Promise<number> {
  const cursor = LS.get(K.stateCursor) ?? '1970-01-01T00:00:00.000Z';
  const since = new Date(Date.parse(cursor) - OVERLAP_MS).toISOString();
  const read = async (cols: string) => {
    const r = await supa().from('state').select(cols).gt('updated_at', since).order('updated_at', { ascending: true });
    return { rows: (r.data ?? []) as unknown as StateRow[], error: r.error };
  };
  let { rows, error } = await read(rpcMissing ? 'kind,body,updated_at' : 'kind,body,updated_at,client_at');
  if (error && /client_at/.test(error.message)) {
    rpcMissing = true; emit({ needsDbUpdate: true });
    ({ rows, error } = await read('kind,body,updated_at'));
  }
  if (error) throw error;
  const local = stamps();
  const dirty = dirtySet();
  let applied = 0;
  const settingsPatch: Partial<Settings> = {};

  const consider = (kind: string, remoteAt: number): boolean => {
    const mine = local[kind] ?? 0;
    // Weak automatic plans always yield to a plan already in the cloud.
    if (kind.startsWith('plan:') && mine <= WEAK) return true;
    return remoteAt > mine;
  };

  for (const r of rows) {
    const remoteAt = Date.parse(r.client_at ?? r.updated_at);
    if (r.kind === 'settings') {
      // Legacy whole-settings row from before per-field sync: apply field by field.
      const body = (r.body ?? {}) as Partial<Settings>;
      for (const k of SYNCED_SETTINGS) {
        if (!(k in body)) continue;
        const kind = `setting:${k}`;
        if (consider(kind, remoteAt) && !dirty.has(kind)) { (settingsPatch as Record<string, unknown>)[k] = body[k]; stamp(kind, remoteAt); }
      }
      continue;
    }
    if (!consider(r.kind, remoteAt)) continue;
    if (dirty.has(r.kind) && !(r.kind.startsWith('plan:') && (local[r.kind] ?? 0) <= WEAK)) continue;
    if (r.kind.startsWith('setting:')) {
      const k = r.kind.slice(8);
      if (!(SYNCED_SETTINGS as string[]).includes(k)) continue;
      (settingsPatch as Record<string, unknown>)[k] = (r.body as { v: unknown })?.v;
    } else if (r.kind === 'template') {
      await db.transaction('rw', db.template, async () => {
        await db.template.where('profileId').equals(PROFILE_ID).delete();
        await db.template.bulkPut((r.body as TemplateRow[]).map((t) => ({ ...t, profileId: PROFILE_ID })));
      });
    } else if (r.kind.startsWith('plan:')) {
      await db.plan_days.put({ ...(r.body as PlanDay), profileId: PROFILE_ID });
    } else continue;
    stamp(r.kind, remoteAt);
    dirty.delete(r.kind);
    applied++;
  }
  if (Object.keys(settingsPatch).length) {
    const cur = await db.settings.get(PROFILE_ID);
    if (cur) await db.settings.put({ ...cur, ...settingsPatch });
    applied++;
  }
  saveDirty(dirty);
  if (rows.length) {
    const newest = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), cursor);
    LS.set(K.stateCursor, newest);
  }
  return applied;
}

/** First thing on a new day: if another device already planned today, use its plan. Bounded so a slow network never blocks the morning. */
export async function pullBeforePlanning(timeoutMs = 2500): Promise<void> {
  if (!status.signedIn) return;
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, timeoutMs))]);
}

// Once-a-day facts logged on two devices: the first (by time, then uid) stands; the others get an explicit
// `undo` with reason 'duplicate', so the log itself says what was decided. Deterministic, so every device
// marks the same one; a second undo of the same row is harmless. (C12)
const ONCE = new Set(['up', 'lights_out', 'session_done', 'day_session', 'session_later', 'breather', 'weigh', 'habit_done', 'habit_skip']);
async function markDuplicates(days: string[]): Promise<void> {
  for (const day of days) {
    const act = activeEvents(await eventsForDay(day)).filter((e) => ONCE.has(e.type));
    const groups = new Map<string, Event[]>();
    for (const e of act) { const k = `${e.type}|${e.key ?? ''}`; groups.set(k, [...(groups.get(k) ?? []), e]); }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => effTs(a) - effTs(b) || (a.uid ?? '').localeCompare(b.uid ?? ''));
      for (const dup of g.slice(1)) await undoEvent(dup, 'duplicate');
    }
  }
}
