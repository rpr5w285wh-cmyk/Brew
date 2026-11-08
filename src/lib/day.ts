// Logical days run from the day boundary (default 03:00) to the next one,
// so "lights out" at 00:30 still belongs to the evening that preceded it.
// All arithmetic is in local wall-clock time so DST changeover nights don't slip.

export function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

export function pad(n: number): string { return n < 10 ? `0${n}` : String(n); }

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The logical day key for a timestamp, given the boundary "HH:MM". */
export function logicalDay(ts: number, boundary = '03:00'): string {
  const { h, m } = parseHM(boundary);
  const d = new Date(ts);
  if (d.getHours() * 60 + d.getMinutes() < h * 60 + m) d.setDate(d.getDate() - 1);
  return dateKey(d);
}

/** The day key before a given key. */
export function prevDay(key: string): string {
  const [y, mo, d] = key.split('-').map(Number);
  return dateKey(new Date(y, mo - 1, d - 1));
}

/** Timestamp for "HH:MM" on the night that follows logical day `key`: evening times stay on that date, morning times (before noon) fall after midnight. */
export function nightTs(key: string, hm: string, _boundary = '03:00'): number {
  const [y, mo, d] = key.split('-').map(Number);
  const { h, m } = parseHM(hm);
  const after = h < 12;
  return new Date(y, mo - 1, d + (after ? 1 : 0), h, m, 0, 0).getTime();
}

/** The day key after a given key. */
export function nextDay(key: string): string {
  const [y, mo, d] = key.split('-').map(Number);
  return dateKey(new Date(y, mo - 1, d + 1));
}

/** [start, end) timestamps of a logical day key. */
export function dayRange(key: string, boundary = '03:00'): { start: number; end: number } {
  const { h, m } = parseHM(boundary);
  const [y, mo, d] = key.split('-').map(Number);
  const start = new Date(y, mo - 1, d, h, m, 0, 0).getTime();
  const end = new Date(y, mo - 1, d + 1, h, m, 0, 0).getTime();
  return { start, end };
}

/** Calendar weekday (0 = Sunday) of a logical day key. */
export function weekdayOf(key: string): number {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d).getDay();
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Minutes since midnight of a timestamp, local. */
export function minutesOfDay(ts: number): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

export function hmToMinutes(hm: string): number {
  const { h, m } = parseHM(hm);
  return h * 60 + m;
}

/** "HH:MM" minus N minutes, wrapping at midnight. */
export function minusMinutes(hm: string, mins: number): string {
  let total = hmToMinutes(hm) - mins;
  while (total < 0) total += 24 * 60;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function prettyDay(key: string): string {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Weekend nights are Friday and Saturday: the bedtime on those evenings and the wake time on the mornings after (Sat, Sun). */
export function isWeekendEvening(key: string): boolean { const w = weekdayOf(key); return w === 5 || w === 6; }
export function isWeekendMorning(key: string): boolean { const w = weekdayOf(key); return w === 6 || w === 0; }
export function bedtimeFor(key: string, s: { bedtimeHypothesis: string; weekendBedtime?: string }): string {
  return isWeekendEvening(key) && s.weekendBedtime ? s.weekendBedtime : s.bedtimeHypothesis;
}
export function wakeFor(key: string, s: { wakeTarget: string; weekendWake?: string }): string {
  return isWeekendMorning(key) && s.weekendWake ? s.weekendWake : s.wakeTarget;
}

/** Whole days from a to b (b later → positive). */
export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number); const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Timestamp for "HH:MM" on the calendar date of logical day `key` (a morning time). */
export function morningTs(key: string, hm: string): number {
  const [y, mo, d] = key.split('-').map(Number);
  const { h, m } = parseHM(hm);
  return new Date(y, mo - 1, d, h, m, 0, 0).getTime();
}
