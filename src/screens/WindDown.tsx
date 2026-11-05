import { useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { log, undoLast } from '../lib/events';
import { minusMinutes } from '../lib/day';
import { go } from '../router';
import { Player } from './Session';

type Chip = { key: string; label: string; options: { v: string; label: string }[] };
const CHIPS: Chip[] = [
  { key: 'alcohol', label: 'Alcohol', options: [{ v: 'none', label: 'None' }, { v: '1', label: '1' }, { v: '2+', label: '2+' }] },
  { key: 'nap', label: 'Nap today', options: [{ v: 'none', label: 'None' }, { v: 'short', label: 'Short' }, { v: 'long', label: 'Long' }] },
];

export function WindDownScreen({ t }: { t: Today }) {
  const { day, state, settings, habits, sessions } = t;
  const [busy, setBusy] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const kitchen = habits.find((h) => h.key === 'kitchen_closed');
  const bedtime = sessions.find((s) => s.category === 'bedtime');
  const windDownAt = minusMinutes(settings.bedtimeHypothesis, settings.windDownLeadMin);

  const setChip = (key: string, v: string) => log('chip', { key, value: v });
  const teeth = !!state.habits['teeth_pm'];
  const ateLate = state.chips['ate_late'];

  // "Ate after 20:00" and the optional kitchen-closed habit are the same fact; ask it once.
  const setAteLate = async (yes: boolean) => {
    await setChip('ate_late', yes ? 'yes' : 'no');
    if (kitchen?.active) {
      if (yes) await undoLast(day, 'habit_done', 'kitchen_closed');
      else await log('habit_done', { key: 'kitchen_closed' });
    }
  };

  const lightsOut = async () => {
    if (busy) return; setBusy(true);
    await log('lights_out');
    go('today');
  };

  return (
    <main class="screen dim">
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
            <div class="chips" role="group" aria-label={c.label}>
              {c.options.map((o) => (
                <button key={o.v} class={`chip ${state.chips[c.key] === o.v ? 'on' : ''}`} aria-pressed={state.chips[c.key] === o.v} onClick={() => setChip(c.key, o.v)}>{o.label}</button>
              ))}
            </div>
          </div>
        ))}
        <div>
          <div class="chiprow">{kitchen?.active ? 'Kitchen stayed closed after 20:00' : 'Ate after 20:00'}</div>
          <div class="chips" role="group">
            {kitchen?.active ? (
              <>
                <button class={`chip ${ateLate === 'no' ? 'on' : ''}`} aria-pressed={ateLate === 'no'} onClick={() => setAteLate(false)}>Yes, closed</button>
                <button class={`chip ${ateLate === 'yes' ? 'on' : ''}`} aria-pressed={ateLate === 'yes'} onClick={() => setAteLate(true)}>No, I ate</button>
              </>
            ) : (
              <>
                <button class={`chip ${ateLate === 'no' ? 'on' : ''}`} aria-pressed={ateLate === 'no'} onClick={() => setAteLate(false)}>No</button>
                <button class={`chip ${ateLate === 'yes' ? 'on' : ''}`} aria-pressed={ateLate === 'yes'} onClick={() => setAteLate(true)}>Yes</button>
              </>
            )}
          </div>
        </div>
      </div>

      <h2>Then</h2>
      <div class="card">
        <div class={`row ${teeth ? 'done' : 'active'}`}>
          <button class="rowmain" onClick={() => (teeth ? undoLast(day, 'habit_done', 'teeth_pm') : log('habit_done', { key: 'teeth_pm' }))} aria-pressed={teeth}>
            <span class="mark" aria-hidden="true">{teeth ? '✓' : ''}</span>
            <span class="body"><div class="title">Teeth</div>{teeth && <div class="hint">Tap again to undo</div>}</span>
          </button>
        </div>
        {bedtime && !showVideo && (
          <div class="row">
            <button class="rowmain" onClick={() => setShowVideo(true)}>
              <span class="mark" aria-hidden="true">▶</span>
              <span class="body">
                <div class="title">{bedtime.title}</div>
                <div class="hint">Optional · floor-based · {bedtime.titleMinutes} min · plays here</div>
              </span>
            </button>
          </div>
        )}
        {bedtime && showVideo && (
          <div style="padding:0 0 8px"><Player session={bedtime} onDuration={() => undefined} /></div>
        )}
      </div>

      <button class="btn soft" onClick={lightsOut} disabled={busy}>Lights out</button>
      <p class="note muted">Chips are optional tonight; they feed the sleep experiment. Lights out records the in-bed time. Phone away after this.</p>
    </main>
  );
}
