import { db, PROFILE_ID, type PlanDay, type Session, type Settings, type Category } from './db';
import { weekdayOf, dayRange } from './day';
import { activeEvents, log } from './events';

/**
 * Session picker. Runs once per logical day and is memoised in plan_days.
 * category = template[weekday]; candidates = category match, tier <= current, quiet;
 * exclude anything played in the last noRepeatDays; pick least-recently-played; swap = next.
 * If the pool is empty, relax the no-repeat window — never the tier.
 */
export async function planFor(day: string, settings: Settings): Promise<PlanDay> {
  const existing = await db.plan_days.get([PROFILE_ID, day]);
  if (existing) return existing;

  const wd = weekdayOf(day);
  const row = await db.template.get([PROFILE_ID, wd]);
  const category: Category = row?.category ?? 'stretch';
  const { start } = dayRange(day, settings.dayBoundary);
  const since = start - settings.noRepeatDays * 86_400_000;

  // Only sessions that were actually watched count as played: undone rows and written fallbacks don't.
  const raw = await db.events.where('profileId').equals(PROFILE_ID).and((e) => e.type === 'session_done' || e.type === 'undo').toArray();
  const played = activeEvents(raw).filter((e) => e.type === 'session_done' && e.key && e.key !== 'fallback');
  const lastPlayed = new Map<string, number>();
  for (const e of played) if (e.key) lastPlayed.set(e.key, Math.max(lastPlayed.get(e.key) ?? 0, e.ts));

  const all = await db.sessions.where('category').equals(category).toArray();
  const eligible = all.filter((s) => s.tier <= settings.tier && s.quiet);
  const byRecency = (a: Session, b: Session) => (lastPlayed.get(a.id) ?? 0) - (lastPlayed.get(b.id) ?? 0) || a.titleMinutes - b.titleMinutes;

  let pool = eligible.filter((s) => (lastPlayed.get(s.id) ?? 0) < since).sort(byRecency);
  if (pool.length === 0) pool = [...eligible].sort(byRecency); // relax the window, keep the tier

  const plan: PlanDay = {
    profileId: PROFILE_ID,
    date: day,
    context: 'normal',
    sessionId: pool[0]?.id ?? null,
    swapId: pool[1]?.id ?? null,
    tier: settings.tier,
    swapped: false,
  };
  await db.plan_days.put(plan);
  return plan;
}

/** One swap per day, logged as an event. Returns the plan unchanged if already swapped or nothing to swap to. */
export async function swapPlan(day: string): Promise<PlanDay | undefined> {
  const plan = await db.plan_days.get([PROFILE_ID, day]);
  if (!plan || !plan.swapId || plan.swapped) return plan;
  const next: PlanDay = { ...plan, sessionId: plan.swapId, swapId: plan.sessionId, swapped: true };
  await db.plan_days.put(next);
  await log('swap', { key: next.sessionId ?? undefined, meta: { from: plan.sessionId, to: next.sessionId } });
  return next;
}

/** Drop today's memoised plan so the picker re-runs. Caller guards against doing this after the session is done. */
export async function replan(day: string): Promise<void> {
  await db.plan_days.delete([PROFILE_ID, day]);
}
