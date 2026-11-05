import { useEffect, useState, useCallback } from 'preact/hooks';
import { liveQuery } from 'dexie';
import { db, PROFILE_ID, type Settings, type Session, type Habit, type PlanDay, type TemplateRow } from './db';
import { DEFAULT_SETTINGS, ensureSeeded } from './seed';
import { eventsForDay, deriveDay, setBoundary, todayKey, type DayState } from './events';
import { planFor } from './picker';

export interface Today {
  ready: boolean;
  day: string;
  settings: Settings;
  state: DayState;
  plan: PlanDay | null;
  session: Session | null;
  swap: Session | null;
  habits: Habit[];
  sessions: Session[];
  template: TemplateRow[];
  refresh: () => void;
}

export function useToday(): Today {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [day, setDay] = useState(todayKey());
  const [state, setState] = useState<DayState>(deriveDay(day, []));
  const [plan, setPlan] = useState<PlanDay | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [swap, setSwap] = useState<Session | null>(null);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [template, setTemplate] = useState<TemplateRow[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureSeeded();
      const s = (await db.settings.get(PROFILE_ID)) ?? DEFAULT_SETTINGS;
      setBoundary(s.dayBoundary);
      const d = todayKey();
      const [p, h, all, t] = await Promise.all([
        planFor(d, s),
        db.habits.where('profileId').equals(PROFILE_ID).sortBy('order'),
        db.sessions.toArray(),
        db.template.where('profileId').equals(PROFILE_ID).toArray(),
      ]);
      if (cancelled) return;
      setSettings(s); setDay(d); setPlan(p); setHabits(h); setSessions(all); setTemplate(t);
      setSession(p.sessionId ? all.find((x) => x.id === p.sessionId) ?? null : null);
      setSwap(p.swapId ? all.find((x) => x.id === p.swapId) ?? null : null);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [tick]);

  // live events for today
  useEffect(() => {
    if (!ready) return;
    const sub = liveQuery(() => eventsForDay(day)).subscribe({
      next: (evs) => setState(deriveDay(day, evs)),
      error: (e) => console.error(e),
    });
    return () => sub.unsubscribe();
  }, [ready, day]);

  // roll over at the day boundary while the app is open
  useEffect(() => {
    const id = setInterval(() => { if (todayKey() !== day) refresh(); }, 60_000);
    return () => clearInterval(id);
  }, [day, refresh]);

  return { ready, day, settings, state, plan, session, swap, habits, sessions, template, refresh };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = (await db.settings.get(PROFILE_ID)) ?? DEFAULT_SETTINGS;
  await db.settings.put({ ...cur, ...patch });
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}
