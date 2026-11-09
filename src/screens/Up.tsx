import { useRef, useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { log, amend, undoEvent, setEarlyWake, beforeBoundary } from '../lib/events';
import type { Event } from '../lib/db';
import { fmtTime, minutesOfDay, hmToMinutes, nextDay, nightTs, wakeFor, morningTs, prettyDay, bedtimeFor } from '../lib/day';
import { go } from '../router';

const LABELS = ['Rough', 'Meh', 'OK', 'Good', 'Great'];

type Waking = { upEv?: Event; backEv?: Event; up: string; back: string; origUp: string; origBack: string; removed: boolean };

export function UpScreen({ t }: { t: Today }) {
  const { day, state, settings, prev } = t;
  const openedAt = useRef(Date.now());
  const hm = (ts?: number) => (ts ? fmtTime(ts) : '');

  // Which morning is this, and which night came before it?
  //  - Between midnight and the boundary (e.g. 02:45 for a flight) the app is still on yesterday's day:
  //    this Up starts the NEXT day, and last night is today's evening. (C9)
  //  - Otherwise it's this day's morning and last night is the previous day.
  const early = !t.viewing && beforeBoundary(openedAt.current);
  const morning = early ? nextDay(day) : day;
  const night = early ? state : prev;
  const existing = early ? undefined : state.up;
  const rerate = !!existing;

  const [quality, setQuality] = useState<number | null>(typeof existing?.value === 'number' ? existing.value : null);
  const [stayedIn, setStayedIn] = useState<number>((existing?.meta?.nightWakings as number) ?? 0);
  const [busy, setBusy] = useState(false);
  const loggedWake = early ? undefined : (state.wakeTs ?? existing?.ts);
  const [wakeAt, setWakeAt] = useState(hm(loggedWake ?? (t.viewing ? morningTs(day, wakeFor(day, settings)) : openedAt.current)));

  // ---- last night ----
  const lo = night.lightsOut;
  const [inBed, setInBed] = useState(hm(night.inBedTs));
  const [wakings, setWakings] = useState<Waking[]>(() => night.awake.map((a) => ({
    upEv: a.upEv, backEv: a.backEv, up: a.upEv ? hm(a.up) : '', back: hm(a.back), origUp: a.upEv ? hm(a.up) : '', origBack: hm(a.back), removed: false,
  })));
  const [chips, setChips] = useState<Record<string, string>>({
    alcohol: String(night.chips['alcohol'] ?? ''), nap: String(night.chips['nap'] ?? ''), ate_late: String(night.chips['ate_late'] ?? ''),
  });
  const openWaking = night.awake.some((a) => a.back === undefined);
  const needsAttention = !lo || openWaking || t.viewing;
  const setW = (i: number, patch: Partial<Waking>) => setWakings(wakings.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const saveNight = async () => {
    const nd = night.day;
    const at = (v: string) => nightTs(nd, v);
    if (lo && inBed && inBed !== hm(night.inBedTs)) await amend(lo, { meta: { correctedTs: at(inBed) } });
    if (!lo && inBed) await log('lights_out', { day: nd, ts: at(inBed), meta: { entered: true, backfilled: true, bedtimeTarget: bedtimeFor(nd, settings) } });
    // Wakings: removed → undo; changed → amend (a live tap stays a live tap); new → log. (C11)
    for (const w of wakings) {
      if (w.removed) {
        if (w.upEv) await undoEvent(w.upEv, 'removed');
        if (w.backEv) await undoEvent(w.backEv, 'removed');
        continue;
      }
      if (w.upEv) { if (w.up && w.up !== w.origUp) await amend(w.upEv, { meta: { correctedTs: at(w.up) } }); }
      else if (w.up) await log('night_up', { day: nd, ts: at(w.up), meta: { entered: true } });
      if (w.backEv) {
        if (!w.back) await undoEvent(w.backEv, 'cleared');
        else if (w.back !== w.origBack) await amend(w.backEv, { meta: { correctedTs: at(w.back) } });
      } else if (w.back && (w.up || w.upEv)) await log('back_to_bed', { day: nd, ts: at(w.back), meta: { entered: true } });
    }
    for (const k of Object.keys(chips)) {
      if (chips[k] && chips[k] !== String(night.chips[k] ?? '')) await log('chip', { key: k, value: chips[k], day: nd });
    }
  };

  // ---- wake ----
  const wakeTs = wakeAt ? (early ? nightTs(day, wakeAt) : morningTs(morning, wakeAt)) : openedAt.current;
  const wakeTarget = wakeFor(morning, settings);
  const onTime = minutesOfDay(wakeTs) <= hmToMinutes(wakeTarget) + 10;

  const save = async () => {
    if (quality === null || busy) return;
    setBusy(true);
    await saveNight();
    const meta = { nightWakings: stayedIn, wakeTarget, onTime };
    if (rerate && existing) {
      const timeChanged = !!loggedWake && wakeAt !== hm(loggedWake);
      await amend(existing, { value: quality, meta: timeChanged ? { ...meta, correctedTs: wakeTs } : meta });
    } else {
      const entered = t.viewing || wakeAt !== hm(openedAt.current);
      await log('up', { ts: wakeTs, day: morning, value: quality, meta: { ...meta, ...(entered ? { entered: true, loggedAt: Date.now() } : {}), ...(early ? { earlyWake: true } : {}) } });
      if (early) { setEarlyWake(morning); t.refresh(); }
    }
    go('today');
  };

  return (
    <main class="screen has-sticky">
      <div class="topbar">
        <div>
          <h1>{rerate ? 'Change' : early ? 'Up early' : 'Up'}</h1>
          <p class="sub">{t.viewing ? `${prettyDay(day)} · ` : ''}target {wakeTarget} · {onTime ? 'on time' : 'later than target — still counts'}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      <div class="card">
        <div class="field"><label for="wake-at">Woke up at</label><input id="wake-at" class="edit" type="time" value={wakeAt} onChange={(e) => setWakeAt((e.target as HTMLInputElement).value)} /></div>
      </div>
      <p class="note muted">{t.viewing ? 'When you got up that morning.' : rerate ? 'Change it if it was different.' : 'Set to now — change it if you got up earlier.'}</p>

      <h2>How was the sleep?</h2>
      <div class="scale">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} class={quality === n ? 'on' : ''} onClick={() => setQuality(n)} aria-label={LABELS[n - 1]} aria-pressed={quality === n}>{n}</button>
        ))}
      </div>
      <p class="note muted">{quality ? LABELS[quality - 1] : '1 = rough, 5 = great. Gut answer.'}</p>

      <details class="card disclosure" open={needsAttention}>
        <summary><span class="disc-title">Last night</span><span class="muted">{lo ? `lights out ${hm(night.inBedTs)}` : 'lights out not logged'}{night.awake.length ? ` · up ${night.awake.length}×` : ''}</span></summary>
        <div class="field"><label>Lights out</label><input class="edit" type="time" value={inBed} onChange={(e) => setInBed((e.target as HTMLInputElement).value)} aria-label="Lights out time" /></div>
        {wakings.map((w, i) => !w.removed && (
          <div class="waking" key={i}>
            <div class="field"><label>Got up at</label><input class="edit" type="time" value={w.up} onChange={(e) => setW(i, { up: (e.target as HTMLInputElement).value })} aria-label="Got up at" /></div>
            <div class="field"><label>Back to bed at</label><input class="edit" type="time" value={w.back} placeholder="unknown" onChange={(e) => setW(i, { back: (e.target as HTMLInputElement).value })} aria-label="Back to bed at" /></div>
            <div class="field"><span class="muted small">{w.back ? '' : 'Back time unknown — leave blank if you don\'t remember'}</span><button class="undo" onClick={() => setW(i, { removed: true })} aria-label="Remove this waking">remove</button></div>
          </div>
        ))}
        <div class="field"><label>Got up in the night</label><button class="pill ghost" onClick={() => setWakings([...wakings, { up: '', back: '', origUp: '', origBack: '', removed: false }])}>Add</button></div>
        <div class="counter">
          <div><div class="label">Woke but stayed in bed</div><div class="sub">times</div></div>
          <div class="stepper">
            <button class="minus" onClick={() => setStayedIn(Math.max(0, stayedIn - 1))} aria-label="Fewer">−</button>
            <span class="count">{stayedIn}</span>
            <button class="minus" onClick={() => setStayedIn(Math.min(9, stayedIn + 1))} aria-label="More">+</button>
          </div>
        </div>
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
      </details>

      <div class="sticky-bar">
        <button class="btn" onClick={save} disabled={quality === null || busy}>{rerate ? 'Save' : "I'm up"}</button>
        {quality === null && <p class="note muted center">Rate the sleep to continue</p>}
      </div>
    </main>
  );
}
