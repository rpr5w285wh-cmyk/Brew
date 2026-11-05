import { useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { log, undoLast } from '../lib/events';
import { fmtTime } from '../lib/day';
import { go } from '../router';

const LABELS = ['Rough', 'Meh', 'OK', 'Good', 'Great'];

export function UpScreen({ t }: { t: Today }) {
  const { day, state, settings } = t;
  const [quality, setQuality] = useState<number | null>(typeof state.up?.value === 'number' ? state.up.value : null);
  const [wakings, setWakings] = useState<number>((state.up?.meta?.nightWakings as number) ?? 0);
  const [busy, setBusy] = useState(false);

  const now = fmtTime(Date.now());
  const onTime = (() => {
    const [h, m] = settings.wakeTarget.split(':').map(Number);
    const d = new Date(); const mins = d.getHours() * 60 + d.getMinutes();
    return mins <= h * 60 + m + 10;
  })();

  const save = async () => {
    if (quality === null || busy) return;
    setBusy(true);
    if (state.up) await undoLast(day, 'up'); // re-rate: replace rather than duplicate
    await log('up', { value: quality, meta: { nightWakings: wakings, onTime } });
    go('today');
  };

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>Up</h1>
          <p class="sub">{now} · target {settings.wakeTarget} · {onTime ? 'on time' : 'later than target — still counts'}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      <h2>How was the sleep?</h2>
      <div class="scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} class={quality === n ? 'on' : ''} onClick={() => setQuality(n)} aria-label={LABELS[n - 1]}>{n}</button>
        ))}
      </div>
      <p class="note muted small">{quality ? LABELS[quality - 1] : '1 = rough, 5 = great. Gut answer; don\'t deliberate.'}</p>

      <h2>Woke in the night</h2>
      <div class="card">
        <div class="counter">
          <div class="label">Times</div>
          <div class="stepper">
            <button onClick={() => setWakings(Math.max(0, wakings - 1))}>−</button>
            <span class="count">{wakings}</span>
            <button onClick={() => setWakings(Math.min(9, wakings + 1))}>+</button>
          </div>
        </div>
      </div>

      <button class="btn" onClick={save} disabled={quality === null || busy}>I'm up</button>
      <p class="note muted small">Next: two-minute breather, then start the coffee.</p>
    </main>
  );
}
