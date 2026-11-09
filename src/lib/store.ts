import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { liveQuery } from 'dexie';
import { db, PROFILE_ID, type Settings, type Session, type Habit, type PlanDay, type TemplateRow } from './db';
import { DEFAULT_SETTINGS, ensureSeeded } from './seed';
import { prevDay, nextDay } from './day';
import { setViewDay, setEarlyWake, beforeBoundary, activeEvents, log } from './events';
import { eventsForDay, deriveDay, setBoundary, todayKey, type DayState } from './events';
import { planFor } from './picker';
import { initSync, pullBeforePlanning, markSettingsDirty } from './sync';

let syncStarted: Promise<void> | null = null;

export interface Today {
  ready: boolean;
  day: string;
  settings: Settings;
  state: DayState;
  /** Yesterday's logical day — last night's lights out, chips and wakings. */
  prev: DayState;
  plan: PlanDay | null;
  session: Session | null;
  swap: Session | null;
  daySession: Session | null;
  habits: Habit[];
  sessions: Session[];
  template: TemplateRow[];
  refresh: () => void;
  /** The real today, and whether an earlier day is being filled in. */
  today: string;
  viewing: boolean;
  viewDay: (key: string | null) => void;
}

export function useToday(): Today {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [day, setDay] = useState(todayKey());
  const [viewing, setViewing] = useState<string | null>(null);
  const lastToday = useRef(todayKey());
  useEffect(() => { lastToday.current = todayKey(); }, [viewing]);
  const [state, setState] = useState<DayState>(deriveDay(day, []));
  const [prev, setPrev] = useState<DayState>(deriveDay(prevDay(day), []));
  const [plan, setPlan] = useState<PlanDay | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [swap, setSwap] = useState<Session | null>(null);
  const [daySession, setDaySession] = useState<Session | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [template, setTemplate] = useState<TemplateRow[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureSeeded();
      syncStarted ??= initSync().catch(() => undefined);
      await syncStarted;
      let s: Settings = { ...DEFAULT_SETTINGS, ...((await db.settings.get(PROFILE_ID)) ?? {}) };
      setBoundary(s.dayBoundary);
      // Already up early (before the boundary)? Then the app is on the new day.
      {
        const logical = todayKey(Date.now());
        const ev = beforeBoundary() ? activeEvents(await eventsForDay(nextDay(logical))).find((e) => e.type === 'up') : undefined;
        setEarlyWake(ev ? nextDay(logical) : null);
      }
      const d = viewing ?? todayKey();
      setViewDay(viewing);
      // New day and no plan yet on this device: give another device's plan a moment to arrive.
      if (!viewing && !(await db.plan_days.get([PROFILE_ID, d]))) {
        await pullBeforePlanning();
        s = { ...DEFAULT_SETTINGS, ...((await db.settings.get(PROFILE_ID)) ?? {}) };
      }
      const [p, h, all, t] = await Promise.all([
        viewing ? db.plan_days.get([PROFILE_ID, d]).then((x) => x ?? { profileId: PROFILE_ID, date: d, context: 'normal' as const, sessionId: null, swapId: null, tier: s.tier, daySessionId: null }) : planFor(d, s),
        db.habits.where('profileId').equals(PROFILE_ID).sortBy('order'),
        db.sessions.toArray(),
        db.template.where('profileId').equals(PROFILE_ID).toArray(),
      ]);
      if (cancelled) return;
      const [evD, evP] = await Promise.all([eventsForDay(d), eventsForDay(prevDay(d))]);
      if (cancelled) return;
      setState(deriveDay(d, evD)); setPrev(deriveDay(prevDay(d), evP));
      setSettings(s); setDay(d); setPlan(p); setHabits(h); setSessions(all); setTemplate(t);
      setSession(p.sessionId ? all.find((x) => x.id === p.sessionId) ?? null : null);
      setSwap(p.swapId ? all.find((x) => x.id === p.swapId) ?? null : null);
      setDaySession(p.daySessionId ? all.find((x) => x.id === p.daySessionId) ?? null : null);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [tick, viewing]);

  // live events for today
  useEffect(() => {
    if (!ready) return;
    const pd = prevDay(day);
    const sub2 = liveQuery(() => eventsForDay(pd)).subscribe({ next: (evs) => setPrev(deriveDay(pd, evs)), error: (e) => console.error(e) });
    const sub = liveQuery(() => eventsForDay(day)).subscribe({
      next: (evs) => setState(deriveDay(day, evs)),
      error: (e) => console.error(e),
    });
    return () => { sub.unsubscribe(); sub2.unsubscribe(); };
  }, [ready, day]);

  // pulled changes from another device: re-read settings, template and plan
  useEffect(() => {
    const on = () => refresh();
    addEventListener('brew-synced', on);
    return () => removeEventListener('brew-synced', on);
  }, [refresh]);

  // Roll over at the day boundary; re-render every minute so time-based hints ("Next") stay current (C25).
  // A past-day view never survives a day change or a long trip to the background (C3).
  const [, setClock] = useState(0);
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const check = () => {
      setClock(Date.now());
      const stale = hiddenAt.current !== null && Date.now() - hiddenAt.current > 5 * 60_000;
      if (viewing && (stale || todayKey() !== lastToday.current)) { setViewing(null); hiddenAt.current = null; return; }
      if (!viewing && todayKey() !== day) refresh();
    };
    const id = setInterval(check, 60_000);
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt.current = Date.now(); return; }
      check();
      hiddenAt.current = null;
    };
    document.addEventListener('visibilitychange', onVis);
    addEventListener('pageshow', check);
    addEventListener('focus', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); removeEventListener('pageshow', check); removeEventListener('focus', check); };
  }, [day, refresh, viewing]);

  return { ready, day, settings, state, prev, plan, session, swap, daySession, habits, sessions, template, refresh, today: todayKey(), viewing: day !== todayKey(), viewDay: (k) => setViewing(k && k !== todayKey() ? k : null) };
}

// Sleep-hypothesis fields get a settings_change event, so the experiment keeps a history of targets. (C14)
const LOGGED_SETTINGS = ['wakeTarget', 'bedtimeHypothesis', 'weekendBedtime', 'weekendWake', 'windDownLeadMin', 'dayBoundary'];

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = { ...DEFAULT_SETTINGS, ...((await db.settings.get(PROFILE_ID)) ?? {}) };
  await db.settings.put({ ...cur, ...patch });
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(patch[k]));
  markSettingsDirty(changed as string[]);
  for (const k of changed) {
    if (LOGGED_SETTINGS.includes(k)) await log('settings_change', { key: k, value: patch[k] as string | number, meta: { from: cur[k] }, ts: Date.now(), day: todayKey() });
  }
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

/** True when running as the installed home-screen app (its own storage, separate from Safari's). */
export function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
