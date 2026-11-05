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
}

export type EventType =
  | 'up' | 'lights_out' | 'habit_done' | 'habit_undo' | 'session_done'
  | 'water' | 'coffee' | 'weigh' | 'chip' | 'context' | 'tier_change' | 'export' | 'breather';

export interface Event {
  id?: number;
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
  }
}

export const db = new BrewDB();
export const PROFILE_ID = 'mdf';
