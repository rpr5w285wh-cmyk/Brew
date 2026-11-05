import { db, PROFILE_ID, type PlanDay, type Session, type Settings, type Category } from './db';
import { weekdayOf, dayRange } from './day';

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

  const played = await db.events.where('[profileId+type]').equals([PROFILE_ID, 'session_done']).toArray();
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
  };
  await db.plan_days.put(plan);
  return plan;
}

export async function swapPlan(day: string): Promise<PlanDay | undefined> {
  const plan = await db.plan_days.get([PROFILE_ID, day]);
  if (!plan || !plan.swapId) return plan;
  const next: PlanDay = { ...plan, sessionId: plan.swapId, swapId: plan.sessionId };
  await db.plan_days.put(next);
  return next;
}

export async function setPlanContext(day: string, context: 'normal' | 'off'): Promise<void> {
  const plan = await db.plan_days.get([PROFILE_ID, day]);
  if (plan) await db.plan_days.put({ ...plan, context });
}
