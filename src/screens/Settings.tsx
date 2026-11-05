import { useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { saveSettings } from '../lib/store';
import { db, PROFILE_ID, type Category, type Tier, type Settings } from '../lib/db';
import { CATEGORY_LABEL } from '../lib/seed';
import { log } from '../lib/events';
import { exportJSON, exportEventsCSV, importJSON, shareOrDownload, markExported } from '../lib/exportData';
import { replan } from '../lib/picker';
import { weekdayOf } from '../lib/day';
import { minusMinutes } from '../lib/day';
import { go } from '../router';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CATS: Category[] = ['wakeup', 'stretch', 'basics', 'restorative', 'energy', 'breath'];

export function SettingsScreen({ t }: { t: Today }) {
  const { settings, template, habits, sessions } = t;
  const [msg, setMsg] = useState<string | null>(null);
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 1800); };

  const set = async (patch: Parameters<typeof saveSettings>[0]) => { await saveSettings(patch); t.refresh(); };

  // Re-plan today only if the change affects today and the session isn't already done.
  const maybeReplanToday = async (affectsToday: boolean) => {
    if (affectsToday && !t.state.sessionDone) await replan(t.day);
  };

  const setTemplate = async (weekday: number, category: Category) => {
    await db.template.put({ profileId: PROFILE_ID, weekday, category });
    await maybeReplanToday(weekday === weekdayOf(t.day));
    t.refresh();
  };

  const setTier = async (tier: Tier) => {
    await log('tier_change', { value: tier, meta: { from: settings.tier } });
    await maybeReplanToday(true);
    await set({ tier });
    flash(`Tier ${tier}`);
  };

  const toggleHabit = async (id: string, active: boolean) => {
    await db.habits.update(id, { active });
    t.refresh();
  };

  const doExport = async () => { if (await shareOrDownload(`brew-${t.day}.json`, await exportJSON(), 'application/json')) { await markExported('json'); flash('Exported'); } };
  const doCSV = async () => { if (await shareOrDownload(`brew-events-${t.day}.csv`, await exportEventsCSV(), 'text/csv')) { await markExported('csv'); flash('Exported'); } };
  const doImport = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (!confirm('Replace everything on this phone with the backup?')) return;
    try { const r = await importJSON(await f.text()); flash(`Imported ${r.events} events`); t.refresh(); }
    catch (err) { alert(String(err)); }
  };

  const kitchen = habits.find((h) => h.key === 'kitchen_closed');
  const windDownAt = minusMinutes(settings.bedtimeHypothesis, settings.windDownLeadMin);

  return (
    <main class="screen">
      <div class="topbar">
        <div><h1>Settings</h1><p class="sub">Brew v0.1 · Phase 1</p></div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      <h2>Appearance</h2>
      <div class="card">
        <div class="field"><label>Theme</label><select value={settings.theme} onChange={(e) => set({ theme: (e.target as HTMLSelectElement).value as Settings['theme'] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Match phone</option></select></div>
      </div>

      <h2>Sleep hypothesis</h2>
      <div class="card">
        <div class="field"><label>Wake target</label><input type="time" value={settings.wakeTarget} onChange={(e) => set({ wakeTarget: (e.target as HTMLInputElement).value })} /></div>
        <div class="field"><label>In bed by</label><input type="time" value={settings.bedtimeHypothesis} onChange={(e) => set({ bedtimeHypothesis: (e.target as HTMLInputElement).value })} /></div>
        <div class="field"><label>Wind-down lead</label><span class="stepper"><button class="minus" onClick={() => set({ windDownLeadMin: Math.max(15, settings.windDownLeadMin - 15) })}>−</button><span class="count">{settings.windDownLeadMin}m</span><button class="minus" onClick={() => set({ windDownLeadMin: Math.min(120, settings.windDownLeadMin + 15) })}>+</button></span></div>
        <div class="field"><label class="muted small">Wind-down cue</label><span class="muted small">{windDownAt} — set this as an iOS Shortcuts automation that opens Brew</span></div>
      </div>

      <h2>Day</h2>
      <div class="card">
        <div class="field"><label>Water target</label><span class="stepper"><button class="minus" onClick={() => { const nt = Math.max(1, settings.waterTarget - 1); set({ waterTarget: nt, waterFloor: Math.min(settings.waterFloor, nt) }); }}>−</button><span class="count">{settings.waterTarget}</span><button class="minus" onClick={() => set({ waterTarget: settings.waterTarget + 1 })}>+</button></span></div>
        <div class="field"><label>Water floor</label><span class="stepper"><button class="minus" onClick={() => set({ waterFloor: Math.max(0, settings.waterFloor - 1) })}>−</button><span class="count">{settings.waterFloor}</span><button class="minus" onClick={() => set({ waterFloor: Math.min(settings.waterTarget, settings.waterFloor + 1) })}>+</button></span></div>
        <div class="field"><label>Tisane counts toward water</label><button class={`switch ${settings.tisaneCountsAsWater ? 'on' : ''}`} role="switch" aria-checked={settings.tisaneCountsAsWater} onClick={() => set({ tisaneCountsAsWater: !settings.tisaneCountsAsWater })}><span /></button></div>
        <div class="field"><label>Weigh-in day</label><select value={settings.weighDay} onChange={(e) => set({ weighDay: Number((e.target as HTMLSelectElement).value) })}>{DAYS.map((d, i) => <option value={i} key={d}>{d}</option>)}</select></div>
        <div class="field"><label>Kitchen closed after 20:00</label><button class={`switch ${kitchen?.active ? 'on' : ''}`} role="switch" aria-checked={!!kitchen?.active} onClick={() => kitchen && toggleHabit(kitchen.id, !kitchen.active)}><span /></button></div>
        <div class="field"><label>Breathing app URL</label><input type="url" value={settings.breathingUrl} onChange={(e) => set({ breathingUrl: (e.target as HTMLInputElement).value })} /></div>
      </div>

      <h2>Sessions</h2>
      <div class="card">
        <div class="field">
          <label>Tier</label>
          <span class="stepper">
            <button class="minus" onClick={() => settings.tier > 0 && setTier((settings.tier - 1) as Tier)} disabled={settings.tier === 0} aria-label="Step down a tier">−</button>
            <span class="count">{settings.tier}</span>
          </span>
        </div>
        <div class="field"><label>No-repeat window</label><span class="stepper"><button class="minus" onClick={() => set({ noRepeatDays: Math.max(0, settings.noRepeatDays - 1) })}>−</button><span class="count">{settings.noRepeatDays}d</span><button class="minus" onClick={() => set({ noRepeatDays: settings.noRepeatDays + 1 })}>+</button></span></div>
        {DAYS.map((d, i) => {
          const row = template.find((r) => r.weekday === i);
          return (
            <div class="field" key={d}>
              <label>{d}</label>
              <select value={row?.category ?? 'stretch'} onChange={(e) => setTemplate(i, (e.target as HTMLSelectElement).value as Category)}>
                {CATS.map((c) => <option value={c} key={c}>{CATEGORY_LABEL[c]}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <p class="note muted">Step-down is always one tap. Step-up is never set here — it's proposed at the weekly review after two consistent weeks.</p>

      <h2>Data</h2>
      <div class="card">
        <div class="field"><label>Export backup (JSON)</label><button class="pill ghost" onClick={doExport}>Export</button></div>
        <div class="field"><label>Export events (CSV)</label><button class="pill ghost" onClick={doCSV}>Export</button></div>
        <div class="field"><label>Restore from backup</label><input type="file" accept="application/json,.json" onChange={doImport} style="max-width:170px" /></div>
      </div>
      <p class="note muted">Everything lives on this phone. Export at the weekly review; a lost phone means lost logs otherwise.</p>

      <h2>Library</h2>
      <div class="card library">
        <details>
          <summary>{sessions.length} sessions · Yoga With Adriene</summary>
          {sessions.map((s) => (
            <a class="row" key={s.id} href={`https://www.youtube-nocookie.com/embed/${s.ytId}?playsinline=1`} target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
              <span class="body">
                <div class="title">{s.title}</div>
                <div class="hint">{CATEGORY_LABEL[s.category]} · {s.titleMinutes} min · tier {s.tier}{s.measuredSeconds ? ` · measured ${Math.round(s.measuredSeconds / 60)} min` : ''} · opens in browser</div>
              </span>
            </a>
          ))}
        </details>
      </div>

      {msg && <div class="toast">{msg}</div>}
    </main>
  );
}
