import { addDays, weekdayOf } from './day';
import type { DayState, HabitHistory } from './events';

// Shower: every other day. Hidden the day after a shower; any day after a day without one, it's back.
export function showerDue(state: DayState, prev: DayState): boolean {
  return !!state.habits['shower'] || !!state.skipped['shower'] || !prev.habits['shower'];
}

// Beard: weekly, due Friday. Stays on the list from Friday until it's done; a trim resets it to next Friday.
export const BEARD_DAY = 5; // Friday
const BEARD_START = '2026-11-20';
export function beardDue(day: string, hist: HabitHistory): boolean {
  const back = (weekdayOf(day) - BEARD_DAY + 7) % 7;
  const lastFri = addDays(day, -back);
  if (lastFri < BEARD_START) return false;
  const done = hist.done['beard'] ?? [];
  if (done.includes(day)) return true;
  return !done.some((d) => d >= lastFri && d < day);
}

// Haircut: every six weeks from the last one. Each snooze pushes it a week, at most two per cycle.
export const HAIRCUT_EVERY_DAYS = 42;
export const HAIRCUT_MAX_SNOOZES = 2;
const HAIRCUT_FIRST_DUE = '2026-12-07'; // second week of December 2026
export interface HaircutState { show: boolean; dueOn: string; snoozes: number; canSnooze: boolean }
export function haircutState(day: string, hist: HabitHistory): HaircutState {
  const done = hist.done['haircut'] ?? [];
  const last = [...done].reverse().find((d) => d < day);
  const base = last ? addDays(last, HAIRCUT_EVERY_DAYS) : HAIRCUT_FIRST_DUE;
  const snoozes = (hist.skipped['haircut'] ?? []).filter((d) => (!last || d > last) && d <= day).length;
  const dueOn = addDays(base, 7 * snoozes);
  const doneToday = done.includes(day);
  return { show: doneToday || day >= dueOn, dueOn, snoozes, canSnooze: snoozes < HAIRCUT_MAX_SNOOZES };
}
