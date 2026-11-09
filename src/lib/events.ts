import { db, PROFILE_ID, newUid, type Event, type EventType } from './db';
import { logicalDay, nextDay, hmToMinutes, minutesOfDay } from './day';

function noonOf(key: string): number { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d, 12, 0, 0, 0).getTime(); }

// The event log is append-only. Nothing is ever deleted or edited: an undo is
// itself an event (`undo`, meta.undoOf = the uid it cancels), a correction is an
// event (`amend`, meta.target = the uid it corrects), and activeEvents()/deriveDay()
// are the single place that decides what the log means. Every event has a
// permanent uid so the log can be merged across devices.

let boundary = '03:00';
/** When the user is filling in an earlier day, new taps default to that day (stamped noon, marked backfilled). */
let viewDay: string | null = null;
export function setViewDay(d: string | null) { viewDay = d; }
export function setBoundary(b: string) { boundary = b; }
/**
 * todayKey(ts): the logical day of a timestamp (03:00 boundary).
 * todayKey(): the day the app is on now — which is the NEXT day if he already logged an early Up
 * before the boundary (e.g. 02:45 for a flight). (C9)
 */
let earlyWake: string | null = null;
export function setEarlyWake(d: string | null) { earlyWake = d; }
export function todayKey(now?: number): string {
  const k = logicalDay(now ?? Date.now(), boundary);
  if (now === undefined && earlyWake && earlyWake === nextDay(k)) return earlyWake;
  return k;
}
/** True between midnight and the day boundary (still "last night" by the calendar of the app). */
export function beforeBoundary(now = Date.now()): boolean { return minutesOfDay(now) < hmToMinutes(boundary); }
export function getBoundary(): string { return boundary; }

/** Types that can only happen once per logical day (per key). A second tap is ignored. */
const ONE_PER_DAY = new Set<EventType>(['up', 'lights_out', 'session_done', 'session_later', 'day_session', 'breather', 'habit_done', 'habit_skip', 'weigh']);
/** Counters: a tap within this window of the previous one is treated as a bounce. */
const BOUNCE_MS = 400;
const lastCounter = new Map<string, number>();
const DRINKS = new Set<EventType>(['water', 'coffee', 'tea', 'tisane']);

export interface LogOpts { key?: string; value?: number | string; meta?: Record<string, unknown>; ts?: number; day?: string }

let onAppend: (() => void) | null = null;
/** Sync registers here to hear about new local events. */
export function setOnAppend(f: () => void): void { onAppend = f; }

/** Append one event. The only write path into the log. */
export async function append(ev: Omit<Event, 'uid' | 'synced' | 'id' | 'profileId'>): Promise<string> {
  const uid = newUid();
  await db.events.add({ ...ev, profileId: PROFILE_ID, uid, synced: 0 });
  onAppend?.();
  return uid;
}

// Writes are serialized: the one-per-day check and the add happen with no other log() in between (C27).
let chain: Promise<unknown> = Promise.resolve();
export function log(type: EventType, opts: LogOpts = {}): Promise<string | null> {
  const run = chain.then(() => logNow(type, opts));
  chain = run.catch(() => undefined);
  return run;
}

async function logNow(type: EventType, opts: LogOpts): Promise<string | null> {
  const backfill = !!viewDay && opts.day === undefined && opts.ts === undefined;
  const ts = opts.ts ?? (backfill ? noonOf(viewDay!) : Date.now());
  const day = opts.day ?? (backfill ? viewDay! : logicalDay(ts, boundary));
  if (backfill) opts = { ...opts, meta: { ...(opts.meta ?? {}), backfilled: true } };

  if (ONE_PER_DAY.has(type)) {
    const existing = activeEvents(await eventsForDay(day)).find((e) => e.type === type && (opts.key === undefined || e.key === opts.key));
    if (existing) return existing.uid ?? null;
  }
  if (DRINKS.has(type)) {
    // Bounce on the wall clock, per day — never on the event's timestamp (backfilled taps all share noon). (C1)
    const k = `${type}|${day}`;
    const now = Date.now();
    if (now - (lastCounter.get(k) ?? 0) < BOUNCE_MS) return null;
    lastCounter.set(k, now);
  }
  if (type === 'context' || type === 'chip') {
    // last-wins facts: skip if the current value is already this value
    const cur = deriveDay(day, await eventsForDay(day));
    if (type === 'context' && cur.context === opts.value) return null;
    if (type === 'chip' && opts.key && cur.chips[opts.key] === opts.value) return null;
  }

  return append({ ts, day, type, key: opts.key, value: opts.value, meta: opts.meta });
}

/** Correct an earlier event (re-rating sleep, fixing lights-out time). Appends an `amend`; the original row is never touched. */
export async function amend(target: Event, patch: { value?: number | string; meta?: Record<string, unknown> }): Promise<void> {
  if (!target.uid) return;
  await append({ ts: Date.now(), day: target.day, type: 'amend', key: target.type, value: patch.value, meta: { target: target.uid, patch: patch.meta ?? null, hasValue: patch.value !== undefined } });
}

/** Cancel one specific event. */
export async function undoEvent(target: Event, reason?: string): Promise<void> {
  if (!target.uid) return;
  await append({ ts: Date.now(), day: target.day, type: 'undo', key: target.type, meta: { undoOf: target.uid, undoKey: target.key ?? null, ...(reason ? { reason } : {}) } });
}

export async function eventsForDay(day: string): Promise<Event[]> {
  return db.events.where('[profileId+day]').equals([PROFILE_ID, day]).sortBy('ts');
}

/** Uids cancelled by an `undo` event in this list. Legacy `habit_undo` rows cancel the latest prior habit_done with the same key. */
export function undoneUids(evs: Event[]): Set<string> {
  const out = new Set<string>();
  const byLocalId = new Map<number, string>();
  for (const e of evs) if (e.id !== undefined && e.uid) byLocalId.set(e.id, e.uid);
  const sorted = [...evs].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0));
  for (const e of sorted) {
    if (e.type === 'undo') {
      const t = e.meta?.undoOf;
      if (typeof t === 'string') out.add(t);
      else if (typeof t === 'number' && byLocalId.has(t)) out.add(byLocalId.get(t)!);
    }
    if (e.type === 'habit_undo' && e.key) {
      const target = [...sorted].reverse().find((x) => x.type === 'habit_done' && x.key === e.key && x.ts <= e.ts && x.uid && !out.has(x.uid));
      if (target?.uid) out.add(target.uid);
    }
  }
  return out;
}

const MARKERS = new Set<EventType>(['undo', 'habit_undo', 'amend']);

/** Events that still count, with corrections applied: undo/amend markers removed, cancelled events removed, amends folded in (last one wins). */
export function activeEvents(evs: Event[]): Event[] {
  const gone = undoneUids(evs);
  const live = evs.filter((e) => !MARKERS.has(e.type) && e.uid && !gone.has(e.uid)).map((e) => ({ ...e }));
  const byUid = new Map(live.map((e) => [e.uid!, e]));
  const amends = evs.filter((e) => e.type === 'amend' && e.uid && !gone.has(e.uid)).sort((a, b) => a.ts - b.ts);
  for (const a of amends) {
    const t = byUid.get(a.meta?.target as string);
    if (!t) continue;
    if (a.meta?.hasValue) t.value = a.value;
    if (a.meta?.patch) t.meta = { ...(t.meta ?? {}), ...(a.meta.patch as Record<string, unknown>) };
  }
  return live;
}

/** Undo the most recent still-active event of a type/key on a day. Appends an `undo` event; deletes nothing. */
export async function undoLast(day: string, type: EventType, key?: string): Promise<void> {
  const act = activeEvents(await eventsForDay(day));
  const last = [...act].reverse().find((e) => e.type === type && (key === undefined || e.key === key));
  if (last) await undoEvent(last);
}

export interface DayState {
  day: string;
  context: 'normal' | 'off';
  up?: Event;
  lightsOut?: Event;
  /** Wake time as entered or corrected (meta.correctedTs), else the logged time. */
  wakeTs?: number;
  /** Lights-out time as corrected the next morning (meta.correctedTs), else the tap time. */
  inBedTs?: number;
  /** Times up in the night after lights out, each with when he got back to bed (undefined = still up). */
  awake: { up: number; back?: number; upEv?: Event; backEv?: Event }[];
  sessionDone?: Event;
  daySession?: Event;
  /** Morning session moved to the day on purpose (not missed). */
  sessionLater?: Event;
  breather?: Event;
  swaps: number;
  water: number;
  coffee: number;
  tea: number;
  tisane: number;
  lastCoffee?: number;
  lastTea?: number;
  /** Last coffee or caffeinated tea — the caffeine factor for the sleep experiment. */
  lastCaffeine?: number;
  habits: Record<string, boolean>;
  /** Habits deliberately skipped today (kept apart from done for the weekly review). */
  skipped: Record<string, boolean>;
  chips: Record<string, string | number>;
  weigh?: number;
}

/** The time an event stands for: a corrected time if one was amended in, else when it was logged. */
export function effTs(e: Event): number {
  return typeof e.meta?.correctedTs === 'number' ? (e.meta.correctedTs as number) : e.ts;
}

/**
 * The single interpreter of a day's log. Rules Phase 2/3 rely on:
 * - Once-a-day facts (up, lights_out, session_done, day_session, session_later, breather, weigh):
 *   the FIRST live event wins. A duplicate from another device is ignored, never summed. (C12)
 * - Times are effective times (correctedTs if amended).
 * - Backfilled drinks count, but never set "last caffeine" — their noon stamp isn't a real time. (C15)
 * - Wakings pair night_up with the next back_to_bed; an unpaired night_up is "back time unknown".
 */
export function deriveDay(day: string, evs: Event[]): DayState {
  const s: DayState = { day, context: 'normal', awake: [], swaps: 0, skipped: {}, water: 0, coffee: 0, tea: 0, tisane: 0, habits: {}, chips: {} };
  const first = <K extends 'up' | 'lightsOut' | 'sessionDone' | 'daySession' | 'sessionLater' | 'breather'>(k: K, e: Event) => { if (!s[k]) (s as unknown as Record<string, Event>)[k] = e; };
  for (const e of [...activeEvents(evs)].sort((a, b) => effTs(a) - effTs(b))) {
    const t = effTs(e);
    const real = !e.meta?.backfilled;
    switch (e.type) {
      case 'context': s.context = e.value === 'off' ? 'off' : 'normal'; break;
      case 'up': if (!s.up) { s.up = e; s.wakeTs = t; } break;
      case 'lights_out': if (!s.lightsOut) { s.lightsOut = e; s.inBedTs = t; } break;
      case 'night_up': s.awake.push({ up: t, upEv: e }); break;
      case 'back_to_bed': {
        const open = [...s.awake].reverse().find((a) => a.back === undefined);
        if (open) { open.back = t; open.backEv = e; } else s.awake.push({ up: t, back: t, backEv: e });
        break;
      }
      case 'session_done': first('sessionDone', e); break;
      case 'day_session': first('daySession', e); break;
      case 'session_later': first('sessionLater', e); break;
      case 'breather': first('breather', e); break;
      case 'swap': s.swaps++; break;
      case 'water': s.water++; break;
      case 'coffee': s.coffee++; if (real) { s.lastCoffee = t; s.lastCaffeine = Math.max(s.lastCaffeine ?? 0, t); } break;
      case 'tea': s.tea++; if (real) { s.lastTea = t; s.lastCaffeine = Math.max(s.lastCaffeine ?? 0, t); } break;
      case 'tisane': s.tisane++; break;
      case 'habit_done': if (e.key) s.habits[e.key] = true; break;
      case 'habit_skip': if (e.key) s.skipped[e.key] = true; break;
      case 'chip': if (e.key) s.chips[e.key] = e.value ?? ''; break;
      case 'weigh': if (typeof e.value === 'number' && s.weigh === undefined) s.weigh = e.value; break;
    }
  }
  return s;
}
