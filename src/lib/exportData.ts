import { db, PROFILE_ID } from './db';
import { log } from './events';

export async function exportJSON(): Promise<string> {
  const dump = {
    app: 'brew',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: await db.profiles.toArray(),
    settings: await db.settings.toArray(),
    habits: await db.habits.toArray(),
    sessions: await db.sessions.toArray(),
    template: await db.template.toArray(),
    plan_days: await db.plan_days.toArray(),
    events: await db.events.toArray(),
  };
  return JSON.stringify(dump, null, 2);
}

/** Record that an export actually left the phone. */
export async function markExported(kind: 'json' | 'csv'): Promise<void> { await log('export', { key: kind }); }

export async function exportEventsCSV(): Promise<string> {
  const evs = await db.events.where('profileId').equals(PROFILE_ID).sortBy('ts');
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['id', 'ts', 'iso', 'day', 'type', 'key', 'value', 'meta'].join(',')];
  for (const e of evs) {
    const cells: unknown[] = [e.id, e.ts, new Date(e.ts).toISOString(), e.day, e.type, e.key, e.value, JSON.stringify(e.meta ?? {})];
    rows.push(cells.map(esc).join(','));
  }
  return rows.join('\n');
}

export async function importJSON(text: string): Promise<{ events: number }> {
  const dump = JSON.parse(text);
  if (dump?.app !== 'brew' || dump.version !== 1) throw new Error('Not a Brew export');
  if (!Array.isArray(dump.events) || !Array.isArray(dump.settings)) throw new Error('Backup is incomplete');
  await db.transaction('rw', [db.profiles, db.settings, db.habits, db.sessions, db.template, db.plan_days, db.events], async () => {
    await db.events.clear();
    await db.plan_days.clear();
    if (dump.profiles) await db.profiles.bulkPut(dump.profiles);
    if (dump.settings) await db.settings.bulkPut(dump.settings);
    if (dump.habits) await db.habits.bulkPut(dump.habits);
    if (dump.sessions) await db.sessions.bulkPut(dump.sessions);
    if (dump.template) await db.template.bulkPut(dump.template);
    if (dump.plan_days) await db.plan_days.bulkPut(dump.plan_days);
    if (dump.events) await db.events.bulkAdd(dump.events.map((e: Record<string, unknown>) => { const { id: _id, ...rest } = e; return rest; }));
  });
  return { events: dump.events?.length ?? 0 };
}

/** Returns true if the file left the phone (shared or downloaded), false if the user cancelled. */
export async function shareOrDownload(filename: string, text: string, mime: string): Promise<boolean> {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], filename, { type: mime });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: filename }); return true; }
    catch (e) { if ((e as { name?: string })?.name === 'AbortError') return false; /* otherwise fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
