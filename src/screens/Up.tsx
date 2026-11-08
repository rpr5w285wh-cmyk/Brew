import { useRef, useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { log, amend, todayKey, activeEvents, eventsForDay, undoEvent } from '../lib/events';
import { fmtTime, minutesOfDay, hmToMinutes, nextDay, nightTs, wakeFor, morningTs, prettyDay } from '../lib/day';
import { go } from '../router';

const LABELS = ['Rough', 'Meh', 'OK', 'Good', 'Great'];

export function UpScreen({ t }: { t: Today }) {
  const { day, state, settings, prev } = t;
  const existing = state.up;
  const rerate = !!existing;
  // The wake timestamp is when this screen was opened, not when "I'm up" is pressed.
  const openedAt = useRef(Date.now());
  const [quality, setQuality] = useState<number | null>(typeof existing?.value === 'number' ? existing.value : null);
  const [wakings, setWakings] = useState<number>((existing?.meta?.nightWakings as number) ?? 0);
  const [busy, setBusy] = useState(false);
  // Which morning this is: the day being filled in, or today.
  const morning = t.viewing ? day : todayKey(openedAt.current);
  // Wake time defaults to when the screen opened (or what's logged); editable if he forgot to tap straight away.
  const loggedWake = state.wakeTs ?? existing?.ts;
  const [wakeAt, setWakeAt] = useState(fmtTime(loggedWake ?? (t.viewing ? morningTs(day, wakeFor(day, settings)) : openedAt.current)));

  // Last night, editable. The night is yesterday's logical day unless it's still before the boundary.
  const night = !t.viewing && state.lightsOut && !state.up ? state : prev;
  const lo = night.lightsOut;
  const hm = (ts?: number) => (ts ? fmtTime(ts) : '');
  const [inBed, setInBed] = useState(hm(night.inBedTs));
  const firstAwake = night.awake[0];
  const [gotUp, setGotUp] = useState<boolean>(!!firstAwake);
  const [upAt, setUpAt] = useState(hm(firstAwake?.up));
  const [backAt, setBackAt] = useState(hm(firstAwake?.back));
  const [chips, setChips] = useState<Record<string, string>>({
    alcohol: String(night.chips['alcohol'] ?? ''), nap: String(night.chips['nap'] ?? ''), ate_late: String(night.chips['ate_late'] ?? ''),
  });

  const saveNight = async () => {
    const nd = night.day;
    const b = settings.dayBoundary;
    if (lo && inBed && inBed !== hm(night.inBedTs)) {
      await amend(lo, { meta: { correctedTs: nightTs(nd, inBed, b) } });
    }
    if (!lo && inBed) {
      await log('lights_out', { day: nd, ts: nightTs(nd, inBed, b), meta: { backfilled: true } });
    }
    // One retro "up in the night" window; only written if it isn't already what the log says.
    if (gotUp && upAt && (!firstAwake || upAt !== hm(firstAwake.up) || (backAt && backAt !== hm(firstAwake.back)))) {
      if (firstAwake) {
        const act = activeEvents(await eventsForDay(nd));
        for (const type of ['night_up', 'back_to_bed'] as const) {
          const e = act.filter((x) => x.type === type).sort((a, c) => a.ts - c.ts)[0];
          if (e) await undoEvent(e, 'corrected');
        }
      }
      await log('night_up', { day: nd, ts: nightTs(nd, upAt, b), meta: { backfilled: true } });
      if (backAt) await log('back_to_bed', { day: nd, ts: nightTs(nd, backAt, b), meta: { backfilled: true } });
    }
    for (const k of Object.keys(chips)) {
      if (chips[k] && chips[k] !== String(night.chips[k] ?? '')) await log('chip', { key: k, value: chips[k], day: nd });
    }
  };

  const wakeTs = wakeAt ? morningTs(morning, wakeAt) : (loggedWake ?? openedAt.current);
  const wakeTarget = wakeFor(morning, settings);
  const onTime = minutesOfDay(wakeTs) <= hmToMinutes(wakeTarget) + 10;

  const save = async () => {
    if (quality === null || busy) return;
    setBusy(true);
    await saveNight();
    const meta = { nightWakings: wakings, wakeTarget, onTime };
    const entered = wakeAt !== fmtTime(openedAt.current);
    if (rerate && existing) {
      // Pre-boundary wake (e.g. 02:50 before a flight): the day hasn't rolled, but this is a new morning,
      // so file it on the next day rather than overwrite yesterday's keystone.
      const earlyNewMorning = !t.viewing && !!state.lightsOut && existing.ts < state.lightsOut.ts && minutesOfDay(openedAt.current) < 3 * 60;
      if (earlyNewMorning) await log('up', { ts: openedAt.current, day: nextDay(day), value: quality, meta: { ...meta, earlyWake: true } });
      else {
        const timeChanged = !!loggedWake && wakeAt !== fmtTime(loggedWake);
        await amend(existing, { value: quality, meta: timeChanged ? { ...meta, correctedTs: wakeTs } : meta });
      }
    } else {
      // The event's time is the wake time itself (entered, or when the screen opened).
      await log('up', { ts: wakeTs, day: morning, value: quality, meta: { ...meta, ...(entered || t.viewing ? { entered: true, loggedAt: Date.now() } : {}) } });
      if (morning !== day) t.refresh();
    }
    go('today');
  };

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>{rerate ? 'Re-rate' : 'Up'}</h1>
          <p class="sub">{t.viewing ? `${prettyDay(day)} · ` : ''}target {wakeTarget} · {onTime ? 'on time' : 'later than target — still counts'}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      <div class="card">
        <div class="field"><label for="wake-at">Woke up at</label><input id="wake-at" type="time" value={wakeAt} onChange={(e) => setWakeAt((e.target as HTMLInputElement).value)} /></div>
      </div>
      <p class="note muted">{t.viewing ? 'Set when you got up that morning.' : 'Already set to now. Change it if you got up earlier and are logging late.'}</p>

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

      <h2>Last night</h2>
      <div class="card">
        <div class="field"><label>Lights out</label><input type="time" value={inBed} onChange={(e) => setInBed((e.target as HTMLInputElement).value)} aria-label="Lights out time" /></div>
        <div class="field"><label>Got up and couldn't sleep</label><button class={`switch ${gotUp ? 'on' : ''}`} role="switch" aria-checked={gotUp} onClick={() => setGotUp(!gotUp)}><span /></button></div>
        {gotUp && (
          <>
            <div class="field"><label>Up at</label><input type="time" value={upAt} onChange={(e) => setUpAt((e.target as HTMLInputElement).value)} aria-label="Got up at" /></div>
            <div class="field"><label>Back to bed at</label><input type="time" value={backAt} onChange={(e) => setBackAt((e.target as HTMLInputElement).value)} aria-label="Back to bed at" /></div>
          </>
        )}
        {([
          ['ate_late', 'Ate after 20:00', [['no', 'No'], ['yes', 'Yes']]],
          ['alcohol', 'Alcohol', [['none', 'None'], ['1', '1'], ['2+', '2+']]],
          ['nap', 'Nap', [['none', 'None'], ['short', 'Short'], ['long', 'Long']]],
        ] as [string, string, [string, string][]][]).map(([k, label, opts]) => (
          <div key={k}>
            <div class="chiprow">{label}</div>
            <div class="chips" role="group" aria-label={label}>
              {opts.map(([v, l]) => <button key={v} class={`chip ${chips[k] === v ? 'on' : ''}`} aria-pressed={chips[k] === v} onClick={() => setChips({ ...chips, [k]: v })}>{l}</button>)}
            </div>
          </div>
        ))}
      </div>
      <p class="note muted">Change anything that didn't go to plan. Morning times count as after midnight.</p>

      <button class="btn" onClick={save} disabled={quality === null || busy}>{rerate ? 'Save' : "I'm up"}</button>
      {!rerate && <p class="note muted">Next: two-minute breather, then start the coffee.</p>}
    </main>
  );
}
