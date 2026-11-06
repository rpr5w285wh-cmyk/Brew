import { db, PROFILE_ID, type Event, type EventType } from './db';
import { logicalDay } from './day';

// The event log is append-only. Nothing is ever deleted: an undo is itself an
// event (`undo` with meta.undoOf = the id it cancels), and deriveDay() is the
// single place that decides what the log means. Phase 2 reads derived views,
// never raw rows.

let boundary = '03:00';
export function setBoundary(b: string) { boundary = b; }
export function todayKey(now = Date.now()): string { return logicalDay(now, boundary); }

/** Types that can only happen once per logical day (per key). A second tap is ignored. */
const ONE_PER_DAY = new Set<EventType>(['up', 'lights_out', 'session_done', 'session_later', 'day_session', 'breather', 'habit_done', 'habit_skip', 'weigh']);
/** Counters: a tap within this window of the previous one is treated as a bounce. */
const BOUNCE_MS = 400;
const lastCounter = new Map<string, number>();
const DRINKS = new Set<EventType>(['water', 'coffee', 'tea', 'tisane']);

export interface LogOpts { key?: string; value?: number | string; meta?: Record<string, unknown>; ts?: number; day?: string }

export async function log(type: EventType, opts: LogOpts = {}): Promise<number | null> {
  const ts = opts.ts ?? Date.now();
  const day = opts.day ?? logicalDay(ts, boundary);

  if (ONE_PER_DAY.has(type)) {
    const existing = activeEvents(await eventsForDay(day)).find((e) => e.type === type && (opts.key === undefined || e.key === opts.key));
    if (existing) return existing.id ?? null;
  }
  if (DRINKS.has(type)) {
    const prev = lastCounter.get(type) ?? 0;
    if (ts - prev < BOUNCE_MS) return null;
    lastCounter.set(type, ts);
  }
  if (type === 'context' || type === 'chip') {
    // last-wins facts: skip if the current value is already this value
    const cur = deriveDay(day, await eventsForDay(day));
    if (type === 'context' && cur.context === opts.value) return null;
    if (type === 'chip' && opts.key && cur.chips[opts.key] === opts.value) return null;
  }

  const ev: Event = { profileId: PROFILE_ID, ts, day, type, key: opts.key, value: opts.value, meta: opts.meta };
  return db.events.add(ev);
}

/** Change the value/meta of an existing event in place (used for re-rating sleep). The timestamp is never touched. */
export async function amend(id: number, patch: { value?: number | string; meta?: Record<string, unknown> }): Promise<void> {
  await db.events.update(id, patch);
}

export async function eventsForDay(day: string): Promise<Event[]> {
  return db.events.where('[profileId+day]').equals([PROFILE_ID, day]).sortBy('ts');
}

/** Ids cancelled by an `undo` event in this list. Legacy `habit_undo` rows cancel the latest prior habit_done with the same key. */
export function undoneIds(evs: Event[]): Set<number> {
  const out = new Set<number>();
  const sorted = [...evs].sort((a, b) => a.ts - b.ts || (a.id ?? 0) - (b.id ?? 0));
  for (const e of sorted) {
    if (e.type === 'undo' && typeof e.meta?.undoOf === 'number') out.add(e.meta.undoOf as number);
    if (e.type === 'habit_undo' && e.key) {
      const target = [...sorted].reverse().find((x) => x.type === 'habit_done' && x.key === e.key && x.ts <= e.ts && x.id !== undefined && !out.has(x.id));
      if (target?.id !== undefined) out.add(target.id);
    }
  }
  return out;
}

/** Events that still count: everything except undo markers and what they cancelled. */
export function activeEvents(evs: Event[]): Event[] {
  const gone = undoneIds(evs);
  return evs.filter((e) => e.type !== 'undo' && e.type !== 'habit_undo' && e.id !== undefined && !gone.has(e.id));
}

/** Undo the most recent still-active event of a type/key on a day. Appends an `undo` event; deletes nothing. */
export async function undoLast(day: string, type: EventType, key?: string): Promise<void> {
  const act = activeEvents(await eventsForDay(day));
  const last = [...act].reverse().find((e) => e.type === type && (key === undefined || e.key === key));
  if (last?.id === undefined) return;
  await db.events.add({ profileId: PROFILE_ID, ts: Date.now(), day, type: 'undo', key: type, meta: { undoOf: last.id, undoKey: last.key ?? null } });
}

export interface DayState {
  day: string;
  context: 'normal' | 'off';
  up?: Event;
  lightsOut?: Event;
  /** Lights-out time as corrected the next morning (meta.correctedTs), else the tap time. */
  inBedTs?: number;
  /** Times up in the night after lights out, each with when he got back to bed (undefined = still up). */
  awake: { up: number; back?: number }[];
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

export function deriveDay(day: string, evs: Event[]): DayState {
  const s: DayState = { day, context: 'normal', awake: [], swaps: 0, skipped: {}, water: 0, coffee: 0, tea: 0, tisane: 0, habits: {}, chips: {} };
  for (const e of [...activeEvents(evs)].sort((a, b) => a.ts - b.ts)) {
    switch (e.type) {
      case 'context': s.context = e.value === 'off' ? 'off' : 'normal'; break;
      case 'up': s.up = e; break;
      case 'lights_out': s.lightsOut = e; s.inBedTs = typeof e.meta?.correctedTs === 'number' ? (e.meta.correctedTs as number) : e.ts; break;
      case 'night_up': s.awake.push({ up: e.ts }); break;
      case 'back_to_bed': { const open = [...s.awake].reverse().find((a) => a.back === undefined); if (open) open.back = e.ts; else s.awake.push({ up: e.ts, back: e.ts }); break; }
      case 'session_done': s.sessionDone = e; break;
      case 'day_session': s.daySession = e; break;
      case 'session_later': s.sessionLater = e; break;
      case 'breather': s.breather = e; break;
      case 'swap': s.swaps++; break;
      case 'water': s.water++; break;
      case 'coffee': s.coffee++; s.lastCoffee = e.ts; s.lastCaffeine = e.ts; break;
      case 'tea': s.tea++; s.lastTea = e.ts; s.lastCaffeine = e.ts; break;
      case 'tisane': s.tisane++; break;
      case 'habit_done': if (e.key) s.habits[e.key] = true; break;
      case 'habit_skip': if (e.key) s.skipped[e.key] = true; break;
      case 'chip': if (e.key) s.chips[e.key] = e.value ?? ''; break;
      case 'weigh': if (typeof e.value === 'number') s.weigh = e.value; break;
    }
  }
  return s;
}
