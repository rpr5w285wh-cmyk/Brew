import { useRef, useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { log, amend, todayKey } from '../lib/events';
import { fmtTime, minutesOfDay, hmToMinutes, nextDay } from '../lib/day';
import { go } from '../router';

const LABELS = ['Rough', 'Meh', 'OK', 'Good', 'Great'];

export function UpScreen({ t }: { t: Today }) {
  const { day, state, settings } = t;
  const existing = state.up;
  const rerate = !!existing;
  // The wake timestamp is when this screen was opened, not when "I'm up" is pressed.
  const openedAt = useRef(Date.now());
  const [quality, setQuality] = useState<number | null>(typeof existing?.value === 'number' ? existing.value : null);
  const [wakings, setWakings] = useState<number>((existing?.meta?.nightWakings as number) ?? 0);
  const [busy, setBusy] = useState(false);

  const wakeTs = existing?.ts ?? openedAt.current;
  const onTime = minutesOfDay(wakeTs) <= hmToMinutes(settings.wakeTarget) + 10;

  const save = async () => {
    if (quality === null || busy) return;
    setBusy(true);
    const meta = { nightWakings: wakings, wakeTarget: settings.wakeTarget, onTime };
    if (rerate && existing?.id !== undefined) {
      // Pre-boundary wake (e.g. 02:50 before a flight): the day hasn't rolled, but this is a new morning,
      // so file it on the next day rather than overwrite yesterday's keystone.
      const earlyNewMorning = !!state.lightsOut && existing.ts < state.lightsOut.ts && minutesOfDay(openedAt.current) < 3 * 60;
      if (earlyNewMorning) await log('up', { ts: openedAt.current, day: nextDay(day), value: quality, meta: { ...meta, earlyWake: true } });
      else await amend(existing.id, { value: quality, meta });
    } else {
      const nowDay = todayKey(openedAt.current);
      await log('up', { ts: openedAt.current, day: nowDay, value: quality, meta });
      if (nowDay !== day) t.refresh();
    }
    go('today');
  };

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>{rerate ? 'Re-rate' : 'Up'}</h1>
          <p class="sub">{rerate ? `Up at ${fmtTime(wakeTs)} · time stays as logged` : `${fmtTime(wakeTs)} · target ${settings.wakeTarget} · ${onTime ? 'on time' : 'later than target — still counts'}`}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      <h2>How was the sleep?</h2>
      <div class="scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} class={quality === n ? 'on' : ''} onClick={() => setQuality(n)} aria-label={LABELS[n - 1]} aria-pressed={quality === n}>{n}</button>
        ))}
      </div>
      <p class="note muted">{quality ? LABELS[quality - 1] : '1 = rough, 5 = great. Gut answer; don\'t deliberate.'}</p>

      <h2>Woke in the night</h2>
      <div class="card">
        <div class="counter">
          <div class="label">Times</div>
          <div class="stepper">
            <button class="minus" onClick={() => setWakings(Math.max(0, wakings - 1))} aria-label="Fewer">−</button>
            <span class="count">{wakings}</span>
            <button class="minus" onClick={() => setWakings(Math.min(9, wakings + 1))} aria-label="More">+</button>
          </div>
        </div>
      </div>

      <button class="btn" onClick={save} disabled={quality === null || busy}>{rerate ? 'Save' : "I'm up"}</button>
      {!rerate && <p class="note muted">Next: two-minute breather, then start the coffee.</p>}
    </main>
  );
}
