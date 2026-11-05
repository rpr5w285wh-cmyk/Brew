// Logical days run from the day boundary (default 03:00) to the next one,
// so "lights out" at 00:30 still belongs to the evening that preceded it.

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
  const d = new Date(ts - (h * 60 + m) * 60_000);
  return dateKey(d);
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

/** "HH:MM" minus N minutes, wrapping at midnight. */
export function minusMinutes(hm: string, mins: number): string {
  const { h, m } = parseHM(hm);
  let total = h * 60 + m - mins;
  while (total < 0) total += 24 * 60;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export function prettyDay(key: string): string {
  const [y, mo, d] = key.split('-').map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
