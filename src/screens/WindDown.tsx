import { useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { log } from '../lib/events';
import { minusMinutes } from '../lib/day';
import { go } from '../router';

type Chip = { key: string; label: string; options: { v: string; label: string }[] };
const CHIPS: Chip[] = [
  { key: 'alcohol', label: 'Alcohol', options: [{ v: 'none', label: 'None' }, { v: '1', label: '1' }, { v: '2+', label: '2+' }] },
  { key: 'nap', label: 'Nap today', options: [{ v: 'none', label: 'None' }, { v: 'short', label: 'Short' }, { v: 'long', label: 'Long' }] },
  { key: 'ate_late', label: 'Ate after 20:00', options: [{ v: 'no', label: 'No' }, { v: 'yes', label: 'Yes' }] },
];

export function WindDownScreen({ t }: { t: Today }) {
  const { state, settings, habits, sessions } = t;
  const [busy, setBusy] = useState(false);
  const kitchen = habits.find((h) => h.key === 'kitchen_closed');
  const bedtime = sessions.find((s) => s.category === 'bedtime');
  const windDownAt = minusMinutes(settings.bedtimeHypothesis, settings.windDownLeadMin);

  const setChip = (key: string, v: string) => log('chip', { key, value: v });
  const allChipped = CHIPS.every((c) => state.chips[c.key] !== undefined);
  const teeth = !!state.habits['teeth_pm'];

  const lightsOut = async () => {
    if (busy) return; setBusy(true);
    await log('lights_out');
    go('today');
  };

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>Wind-down</h1>
          <p class="sub">From {windDownAt} · in bed by {settings.bedtimeHypothesis}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      <h2>Today, for the sleep log</h2>
      <div class="card">
        {CHIPS.map((c) => (
          <div key={c.key}>
            <div class="chiprow">{c.label}</div>
            <div class="chips">
              {c.options.map((o) => (
                <button key={o.v} class={`chip ${state.chips[c.key] === o.v ? 'on' : ''}`} onClick={() => setChip(c.key, o.v)}>{o.label}</button>
              ))}
            </div>
          </div>
        ))}
        {kitchen?.active && (
          <div>
            <div class="chiprow">Kitchen stayed closed</div>
            <div class="chips">
              <button class={`chip ${state.habits['kitchen_closed'] ? 'on' : ''}`} onClick={() => log('habit_done', { key: 'kitchen_closed' })}>Yes</button>
            </div>
          </div>
        )}
      </div>

      <h2>Then</h2>
      <div class="card">
        <button class={`row ${teeth ? 'done' : 'active'}`} onClick={() => !teeth && log('habit_done', { key: 'teeth_pm' })}>
          <span class="mark">{teeth ? '✓' : ''}</span>
          <span class="body"><div class="title">Teeth</div></span>
        </button>
        {bedtime && (
          <a class="row" href={`https://www.youtube.com/watch?v=${bedtime.ytId}`} target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
            <span class="mark">▶</span>
            <span class="body">
              <div class="title">{bedtime.title}</div>
              <div class="hint">Optional. Floor-based, {bedtime.titleMinutes} min.</div>
            </span>
          </a>
        )}
      </div>

      <button class="btn" onClick={lightsOut} disabled={busy}>Lights out</button>
      <p class="note muted small">{allChipped ? 'Chips logged.' : 'Chips are optional tonight; they feed the sleep experiment.'} Lights out records the in-bed time. Phone away after this.</p>
    </main>
  );
}
