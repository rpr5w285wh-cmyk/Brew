import { db, PROFILE_ID, type Event, type EventType } from './db';
import { logicalDay } from './day';

let boundary = '03:00';
export function setBoundary(b: string) { boundary = b; }
export function todayKey(now = Date.now()): string { return logicalDay(now, boundary); }

export async function log(type: EventType, opts: { key?: string; value?: number | string; meta?: Record<string, unknown>; ts?: number } = {}): Promise<number> {
  const ts = opts.ts ?? Date.now();
  const ev: Event = { profileId: PROFILE_ID, ts, day: logicalDay(ts, boundary), type, key: opts.key, value: opts.value, meta: opts.meta };
  return db.events.add(ev);
}

export async function eventsForDay(day: string): Promise<Event[]> {
  return db.events.where('[profileId+day]').equals([PROFILE_ID, day]).sortBy('ts');
}

export async function recentEvents(type: EventType, sinceTs: number): Promise<Event[]> {
  return db.events.where('[profileId+type]').equals([PROFILE_ID, type]).and((e) => e.ts >= sinceTs).toArray();
}

/** Remove the most recent event of a type/key today (one-tap undo). */
export async function undoLast(day: string, type: EventType, key?: string): Promise<void> {
  const evs = await eventsForDay(day);
  const last = [...evs].reverse().find((e) => e.type === type && (key === undefined || e.key === key));
  if (last?.id !== undefined) await db.events.delete(last.id);
}

export interface DayState {
  day: string;
  context: 'normal' | 'off';
  up?: Event;
  lightsOut?: Event;
  sessionDone?: Event;
  breather?: Event;
  water: number;
  coffee: number;
  lastCoffee?: number;
  habits: Record<string, boolean>;
  chips: Record<string, string | number>;
  weigh?: number;
}

export function deriveDay(day: string, evs: Event[]): DayState {
  const s: DayState = { day, context: 'normal', water: 0, coffee: 0, habits: {}, chips: {} };
  for (const e of evs) {
    switch (e.type) {
      case 'context': s.context = e.value === 'off' ? 'off' : 'normal'; break;
      case 'up': s.up = e; break;
      case 'lights_out': s.lightsOut = e; break;
      case 'session_done': s.sessionDone = e; break;
      case 'breather': s.breather = e; break;
      case 'water': s.water++; break;
      case 'coffee': s.coffee++; s.lastCoffee = e.ts; break;
      case 'habit_done': if (e.key) s.habits[e.key] = true; break;
      case 'habit_undo': if (e.key) s.habits[e.key] = false; break;
      case 'chip': if (e.key) s.chips[e.key] = e.value ?? ''; break;
      case 'weigh': if (typeof e.value === 'number') s.weigh = e.value; break;
    }
  }
  return s;
}
