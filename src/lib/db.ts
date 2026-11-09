import Dexie, { type Table } from 'dexie';

export type Category = 'wakeup' | 'stretch' | 'basics' | 'restorative' | 'energy' | 'breath' | 'bedtime';
export type Tier = 0 | 1 | 2 | 3;
export type Context = 'normal' | 'off';
export type HabitSlot = 'evening' | 'morning' | 'day' | 'weekly';

export interface Profile { id: string; name: string; createdAt: number }

export interface Settings {
  profileId: string;
  wakeTarget: string;        // "06:30"
  bedtimeHypothesis: string; // "22:45"
  windDownLeadMin: number;   // 45
  waterTarget: number;
  waterFloor: number;
  tier: Tier;
  noRepeatDays: number;
  kitchenClosedEnabled: boolean;
  dayBoundary: string;       // "03:00"
  breathingUrl: string;
  weighDay: number;          // 0 = Sunday
  theme: 'dark' | 'light' | 'system';
  tisaneCountsAsWater: boolean;
  /** Fri & Sat nights: bedtime that evening, wake the next morning (Sat & Sun). */
  weekendBedtime: string;
  weekendWake: string;
}

export interface Habit {
  id: string;
  profileId: string;
  key: string;
  name: string;
  floorText: string;
  slot: HabitSlot;
  order: number;
  active: boolean;
  offRoutine: 'same' | 'floor' | 'skip' | 'auto';
}

export interface Session {
  id: string;
  title: string;
  ytId: string;
  titleMinutes: number;
  measuredSeconds?: number;
  tier: Tier;
  category: Category;
  quiet: boolean;
  year: number;
  startPosition?: string;
  notes?: string;
}

export interface TemplateRow { profileId: string; weekday: number; category: Category }

export interface PlanDay {
  profileId: string;
  date: string; // logical day key YYYY-MM-DD
  context: Context;
  sessionId: string | null;
  swapId: string | null;
  tier: Tier;
  swapped?: boolean;
  /** Optional daytime yoga break; never the morning pick or its swap. */
  daySessionId?: string | null;
}

export type EventType =
  | 'up' | 'lights_out' | 'habit_done' | 'habit_undo' | 'session_done'
  | 'water' | 'coffee' | 'tea' | 'tisane' | 'weigh' | 'chip' | 'context' | 'tier_change' | 'export' | 'breather'
  | 'undo' | 'swap' | 'day_session' | 'night_up' | 'back_to_bed' | 'session_later' | 'habit_skip' | 'amend' | 'settings_change';

export interface Event {
  /** Local auto-increment key (this device only). */
  id?: number;
  /** Permanent id, minted on the device; the same on every device and in the cloud. */
  uid?: string;
  /** 0 = not yet uploaded. */
  synced?: 0 | 1;
  profileId: string;
  ts: number;
  day: string; // logical day key at time of logging
  type: EventType;
  key?: string;
  value?: number | string;
  meta?: Record<string, unknown>;
}

export class BrewDB extends Dexie {
  profiles!: Table<Profile, string>;
  settings!: Table<Settings, string>;
  habits!: Table<Habit, string>;
  sessions!: Table<Session, string>;
  template!: Table<TemplateRow, [string, number]>;
  plan_days!: Table<PlanDay, [string, string]>;
  events!: Table<Event, number>;

  constructor() {
    super('brew');
    this.version(1).stores({
      profiles: 'id',
      settings: 'profileId',
      habits: 'id, profileId, [profileId+slot], order',
      sessions: 'id, category, tier',
      template: '[profileId+weekday]',
      plan_days: '[profileId+date], date',
      events: '++id, profileId, ts, day, type, [profileId+day], [profileId+type]',
    });
    // v2: permanent ids. Every event gets a UUID; undo markers point at UUIDs instead of local ids.
    this.version(2).stores({
      events: '++id, &uid, profileId, ts, day, type, synced, [profileId+day], [profileId+type]',
    }).upgrade(async (tx) => {
      const table = tx.table('events');
      const all: Event[] = await table.toArray();
      const uidOf = new Map<number, string>();
      for (const e of all) { if (!e.uid) e.uid = newUid(); if (e.id !== undefined) uidOf.set(e.id, e.uid); }
      for (const e of all) {
        if (e.type === 'undo' && typeof e.meta?.undoOf === 'number') {
          const u = uidOf.get(e.meta.undoOf as number);
          e.meta = { ...e.meta, undoOf: u ?? null, legacyUndoOf: e.meta.undoOf };
        }
        e.synced = 0;
        await table.put(e);
      }
    });
  }
}

export function newUid(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const db = new BrewDB();
export const PROFILE_ID = 'mdf';
