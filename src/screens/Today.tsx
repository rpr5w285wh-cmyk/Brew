import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Today } from '../lib/store';
import { log, undoLast, todayKey, beforeBoundary } from '../lib/events';
import { fmtTime, minusMinutes, prettyDay, weekdayOf, minutesOfDay, hmToMinutes, bedtimeFor, wakeFor, isWeekendEvening, isWeekendMorning, prevDay, nextDay, daysBetween } from '../lib/day';
import { go } from '../router';
import { isInstalled } from '../lib/store';
import { useSyncStatus } from './SyncCard';
import { syncNow } from '../lib/sync';

interface StepProps {
  done: boolean;
  active: boolean;
  title: string;
  hint?: string;
  onTap?: () => void;
  onUndo?: () => void;
  undoLabel?: string;
  children?: JSX.Element | JSX.Element[] | false | null;
}

function Step({ done, active, title, hint, onTap, onUndo, undoLabel, children }: StepProps) {
  const cls = `row ${done ? 'done' : active ? 'active' : ''}`;
  return (
    <div class={cls}>
      <button class="rowmain" onClick={onTap} disabled={!onTap} aria-label={done && onTap ? `${title}, done. Tap to change` : title}>
        <span class="mark" aria-hidden="true">{done ? '✓' : ''}</span>
        <span class="body">
          <div class="title">{title}</div>
          {hint && <div class="hint">{hint}</div>}
        </span>
      </button>
      {done && onUndo && <button class="undo" onClick={onUndo} aria-label={undoLabel ?? `Undo ${title}`}>undo</button>}
      {children}
    </div>
  );
}

export function TodayScreen({ t }: { t: Today }) {
  const { day, state, prev, settings, session, habits, sessions, daySession, viewing } = t;
  const nav = { day, today: t.today, viewing, go: t.viewDay };
  const off = state.context === 'off';
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1400); };
  const busy = useRef(false);
  const once = async (f: () => Promise<unknown>) => { if (busy.current) return; busy.current = true; try { await f(); } finally { busy.current = false; } };

  const h = (key: string) => !!state.habits[key];
  const doHabit = (key: string) => once(() => log('habit_done', { key }));
  const undoHabit = (key: string) => once(() => undoLast(day, 'habit_done', key));

  const toggleOff = () => once(async () => {
    const next = off ? 'normal' : 'off';
    await log('context', { value: next });
    flash(next === 'off' ? 'Off-routine day' : 'Back to routine');
  });

  const fluids = state.water + (settings.tisaneCountsAsWater ? state.tisane : 0);
  const fluidsSub = `${fluids}/${settings.waterTarget}`
    + (settings.tisaneCountsAsWater && state.tisane > 0 ? ` · ${state.tisane} tisane` : '');

  const isWeighDay = weekdayOf(day) === settings.weighDay && !off;
  const [weight, setWeight] = useState('');
  const kitchen = habits.find((x) => x.key === 'kitchen_closed');
  const bedtime = bedtimeFor(day, settings);
  const wakeTarget = wakeFor(day, settings);
  const windDownAt = minusMinutes(bedtime, settings.windDownLeadMin);
  const nowMin = minutesOfDay(Date.now());
  // Evening = from the wind-down time until the boundary, while the app is still on that evening's day. (C26)
  const stillThatEvening = todayKey(Date.now()) === day && beforeBoundary();
  const isEvening = nowMin >= hmToMinutes(windDownAt) || stillThatEvening;

  const doneSession = state.sessionDone
    ? (state.sessionDone.key === 'fallback' ? null : sessions.find((s) => s.id === state.sessionDone!.key) ?? null)
    : null;
  const sessionTitle = state.sessionDone
    ? (doneSession ? doneSession.title : 'Written fallback')
    : off ? 'Session (written fallback)' : session ? session.title : 'Session';
  const caughtUp = state.sessionDone?.meta?.slot === 'day';
  const movedLater = !!state.sessionLater && !state.sessionDone;
  const breakDone = state.daySession ?? (caughtUp ? state.sessionDone : undefined);
  const sessionHint = caughtUp
    ? `Done at ${fmtTime(state.sessionDone!.ts)} as a yoga break — counts`
    : state.sessionDone
    ? (state.sessionDone.key === 'fallback' ? `Fallback at ${fmtTime(state.sessionDone.ts)} — counts` : state.sessionDone.meta?.floorOnly ? 'Floor only — counts' : `Done at ${fmtTime(state.sessionDone.ts)}`)
    : off ? '2 minutes, no video' : session ? `${session.titleMinutes} min · while the coffee brews` : 'No session planned — fallback counts';

  // The morning chain, in order. `done` drives the "next" highlight.
  type Item = { key: string; label: string; done: boolean; go: () => void; el: (active: boolean) => JSX.Element };
  const morning: Item[] = [
    {
      key: 'up', label: 'Up', done: !!state.up, go: () => go('up'),
      el: (active) => <Step done={!!state.up} active={active} title="Up"
        hint={stillThatEvening && !viewing ? 'Up early? Tap to start the new day' : state.up ? `Up at ${fmtTime(state.wakeTs ?? state.up.ts)} · slept ${state.up.value}/5 · tap to change` : viewing ? 'No wake time · tap to add one' : `Target ${wakeTarget}${isWeekendMorning(day) ? ' · weekend' : ''}`}
        onTap={() => go('up')} />,
    },
    ...(isWeighDay ? [{
      key: 'weigh', label: 'Weigh in', done: state.weigh !== undefined || !!state.skipped['weigh'], go: () => document.getElementById('weigh-input')?.focus(),
      el: (active: boolean) => (
        state.skipped['weigh'] && state.weigh === undefined ? (
          <Step done active={false} title="Weigh-in" hint="Skipped this week" onUndo={() => once(() => undoLast(day, 'habit_skip', 'weigh'))} undoLabel="Undo skipping the weigh-in" />
        ) : (
        <Step done={state.weigh !== undefined} active={active} title={state.weigh !== undefined ? `Weigh-in: ${state.weigh} kg` : 'Weigh-in'}
          hint={state.weigh !== undefined ? undefined : 'Before coffee. Skip if no scale.'} onUndo={() => once(() => undoLast(day, 'weigh'))} undoLabel="Undo weigh-in">
          {state.weigh === undefined && (
            <span class="inline-form">
              <input id="weigh-input" type="number" inputMode="decimal" step="0.1" placeholder="kg" value={weight} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} />
              <button class="pill" disabled={!weight} onClick={() => once(async () => { await log('weigh', { value: Number(weight) }); setWeight(''); })}>Log</button>
              <button class="undo later" onClick={() => once(() => log('habit_skip', { key: 'weigh' }))} aria-label="Skip the weigh-in this week">skip</button>
            </span>
          )}
        </Step>
        )
      ),
    } as Item] : []),
    {
      key: 'breather', label: 'Breather', done: !!state.breather, go: () => document.getElementById('breather-row')?.scrollIntoView({ block: 'center' }),
      el: (active) => (
        <Step done={!!state.breather} active={active} title="Breather"
          hint={state.breather ? (state.breather.key === 'skipped' ? 'Skipped today' : `Done (${state.breather.key === 'zazen' ? 'Zazen' : 'Adriene'})`) : 'Two minutes to get out of bed'}
          onUndo={() => once(() => undoLast(day, 'breather'))}>
          {!state.breather && (active || viewing) && (
            <span class="inline-actions" id="breather-row">
              <a class="pill ghost" href={settings.breathingUrl} target="_blank" rel="noopener" onClick={() => once(() => log('breather', { key: 'zazen' }))}>Zazen</a>
              <button class="pill ghost" onClick={() => once(async () => { await log('breather', { key: 'adriene' }); go('session', { breath: '1' }); })}>Adriene 5 min</button>
              <button class="undo" onClick={() => once(() => log('breather', { key: 'skipped' }))} aria-label="Skip the breather today">skip</button>
            </span>
          )}
        </Step>
      ),
    },
    {
      key: 'teeth_am', label: 'Teeth', done: h('teeth_am'), go: () => doHabit('teeth_am'),
      el: (active) => <Step done={h('teeth_am')} active={active} title="Teeth" onTap={h('teeth_am') ? undefined : () => doHabit('teeth_am')} onUndo={() => undoHabit('teeth_am')} />,
    },
    {
      key: 'session', label: off ? 'Session (fallback)' : session ? `Session · ${session.titleMinutes} min` : 'Session', done: !!state.sessionDone || movedLater, go: () => go('session'),
      el: (active) => movedLater ? (
        <Step done active={false} title={sessionTitle} hint="Moved to the day — Yoga break" onTap={() => go('session', { slot: 'day' })}
          onUndo={() => once(() => undoLast(day, 'session_later'))} undoLabel="Bring the session back to the morning" />
      ) : (
        <Step done={!!state.sessionDone} active={active} title={sessionTitle} hint={sessionHint}
          onTap={state.sessionDone ? undefined : () => go('session')} onUndo={() => once(() => undoLast(day, 'session_done'))} undoLabel="Undo session">
          {!state.sessionDone && !viewing && <button class="undo later" onClick={() => once(() => log('session_later'))} aria-label="Do the session later today">Later</button>}
        </Step>
      ),
    },
    {
      key: 'shower', label: 'Shower', done: h('shower') || !!state.skipped['shower'], go: () => doHabit('shower'),
      el: (active) => state.skipped['shower'] && !h('shower') ? (
        <Step done active={false} title="Shower" hint="Skipped today" onUndo={() => once(() => undoLast(day, 'habit_skip', 'shower'))} undoLabel="Undo skipping the shower" />
      ) : (
        <Step done={h('shower')} active={active} title="Shower" hint={off ? 'Any time today counts' : undefined} onTap={h('shower') ? undefined : () => doHabit('shower')} onUndo={() => undoHabit('shower')}>
          {!h('shower') && <button class="undo later" onClick={() => once(() => log('habit_skip', { key: 'shower' }))} aria-label="Skip the shower today">skip</button>}
        </Step>
      ),
    },
  ];
  const breakItem: Item = { key: 'daybreak', label: 'Yoga break', done: false, go: () => go('session', { slot: 'day' }), el: () => <></> };
  const outsideItem: Item = { key: 'outside', label: 'Outside', done: h('outside'), go: () => doHabit('outside'), el: () => <></> };
  const windItem: Item = { key: 'wind', label: 'Wind-down', done: !!state.lightsOut, go: () => go('winddown'), el: () => <></> };

  // What's next: the first open morning step; after the wind-down time, the wind-down itself.
  let next: Item | null = null;
  if (!state.lightsOut && !viewing) {
    if (isEvening) next = windItem;
    else next = morning.find((m) => !m.done) ?? (!outsideItem.done ? outsideItem : null) ?? (movedLater ? breakItem : null) ?? windItem;
  }
  const activeKey = next?.key ?? null;

  // Night view: tonight's lights out, or last night still open after the 03:00 rollover (got up and not back yet).
  // Night card: from lights-out until Up is logged, or until an hour before the wake target —
  // whichever comes first. It never traps: "Up for the day" is always on it. (C2, C10)
  const morningCutoff = Math.min(hmToMinutes(wakeTarget) - 60, 12 * 60);
  const nightAfterBoundary = !state.lightsOut && !state.up && !!prev.lightsOut && nowMin < morningCutoff;
  const night = viewing ? null : state.lightsOut ? state : nightAfterBoundary ? prev : null;
  // "Up for the day" only makes sense once it's past midnight (before that it's just "undo lights out").
  const canGetUp = !!night && (night === prev || beforeBoundary());
  const awakeNow = night ? night.awake.find((a) => a.back === undefined) : undefined;

  if (night) {
    const nd = night.day;
    const ateLate = night.chips['ate_late'] === 'yes';
    return (
      <main class="screen">
        <Header nav={nav} off={off} toggleOff={toggleOff} />
        {awakeNow ? (
          <div class="card goodnight">
            <div class="muted">Up since {fmtTime(awakeNow.up)} · lights out was {fmtTime(night.inBedTs!)}</div>
            <div class="big">Can't sleep.</div>
            <div class="muted">That's logged. Tap when you're back in bed.</div>
            <div class="chips" style="justify-content:center;padding-top:14px">
              <button class={`chip ${ateLate ? 'on' : ''}`} aria-pressed={ateLate} onClick={() => once(() => log('chip', { key: 'ate_late', value: ateLate ? 'no' : 'yes', day: nd }))}>Ate something</button>
            </div>
            <button class="btn soft" onClick={() => once(() => log('back_to_bed', { day: nd }))}>Back to bed</button>
            {canGetUp && <button class="btn quiet" onClick={() => go('up')}>Up for the day</button>}
          </div>
        ) : (
          <div class="card goodnight">
            <div class="muted">Lights out at {fmtTime(night.inBedTs!)}{night.awake.length ? ` · up ${night.awake.length}× since` : ''}</div>
            <div class="big">Good night.</div>
            <div class="muted">{canGetUp ? 'Awake for good? Tap Up for the day.' : 'Tap Up in the morning.'}</div>
            {canGetUp && <button class="btn soft" onClick={() => go('up')}>Up for the day</button>}
            <button class="btn quiet" onClick={() => once(() => log('night_up', { day: nd }))}>Can't sleep — got up</button>
            {!night.awake.length && <button class="undo" style="margin-top:8px" onClick={() => once(() => undoLast(nd, 'lights_out'))}>Not yet — undo lights out</button>}
          </div>
        )}
        <div class="card" style="margin-top:12px">
          <Counter label="Water" sub={night === state ? fluidsSub : 'night'} count={night.water} onMinus={() => once(() => undoLast(nd, 'water'))} onPlus={() => log('water', { day: nd })} />
          <Counter label="Tisane" sub="no caffeine" count={night.tisane} onMinus={() => once(() => undoLast(nd, 'tisane'))} onPlus={() => log('tisane', { day: nd })} />
        </div>
        {toast && <div class="toast">{toast}</div>}
      </main>
    );
  }

  return (
    <main class="screen">
      <Header nav={nav} off={off} toggleOff={toggleOff} />

      {viewing && (
        <div class="past-banner">
          <span>Filling in <strong>{prettyDay(day)}</strong>. Taps are added to that day.</span>
          <button class="pill ghost" onClick={() => t.viewDay(null)}>Today</button>
        </div>
      )}

      {next && (
        <button class="next" onClick={next.go}>
          <span class="next-label">Next</span>
          <span class="next-title">{next.label}</span>
        </button>
      )}

      <h2>Morning</h2>
      <div class="card">
        {morning.map((m) => m.el(m.key === activeKey))}
      </div>

      <h2>Drinks</h2>
      <div class="card">
        <Counter label="Water" sub={fluids < settings.waterFloor ? `${fluidsSub} · floor ${settings.waterFloor}` : fluidsSub} count={state.water} onMinus={() => once(() => undoLast(day, 'water'))} onPlus={() => log('water')} />
        <Counter label="Coffee" sub={state.lastCoffee ? `last ${fmtTime(state.lastCoffee)}` : 'none yet'} count={state.coffee} onMinus={() => once(() => undoLast(day, 'coffee'))} onPlus={() => log('coffee')} />
        <Counter label="Tea" sub={state.lastTea ? `last ${fmtTime(state.lastTea)}` : 'caffeinated'} count={state.tea} onMinus={() => once(() => undoLast(day, 'tea'))} onPlus={() => log('tea')} />
        <Counter label="Tisane" sub={settings.tisaneCountsAsWater ? 'counts as water' : 'no caffeine'} count={state.tisane} onMinus={() => once(() => undoLast(day, 'tisane'))} onPlus={() => log('tisane')} />
        {state.lastCaffeine && <div class="counter-note">Last caffeine {fmtTime(state.lastCaffeine)}</div>}
      </div>

      <h2>Day</h2>
      <div class="card">
        <Step done={h('outside')} active={activeKey === 'outside'} title="Outside"
          hint={h('outside') ? undefined : off ? 'Floor: two minutes on the step' : 'Drop-off, lunch, or pickup · 15 min; 2 min counts'}
          onTap={h('outside') ? undefined : () => doHabit('outside')} onUndo={() => undoHabit('outside')} />
        <Step done={!!breakDone} active={activeKey === 'daybreak'} title="Yoga break"
          hint={breakDone
            ? (breakDone.key === 'fallback' ? `Fallback at ${fmtTime(breakDone.ts)} — counts` : `${sessions.find((x) => x.id === breakDone.key)?.title ?? 'Done'} · ${fmtTime(breakDone.ts)}`) + (caughtUp && !state.daySession ? " · counted as today's session" : '')
            : movedLater
              ? "Today's session" + (off || !session ? ' · written fallback, 2 min' : ` · ${session.title} · ${session.titleMinutes} min`)
              : (state.sessionDone ? 'Optional' : "Optional · counts if the morning session didn't happen")
                + (off || !daySession ? ' · 2-min fallback' : ` · ${daySession.titleMinutes} min`)}
          onTap={breakDone ? undefined : () => go('session', { slot: 'day' })}
          onUndo={() => once(() => (state.daySession ? undoLast(day, 'day_session') : undoLast(day, 'session_done')))} undoLabel="Undo yoga break" />
      </div>

      <h2>Evening</h2>
      <div class="card">
        {kitchen?.active && (
          <Step done={h('kitchen_closed')} active={false} title="Kitchen closed" hint="No eating after 20:00" onTap={h('kitchen_closed') ? undefined : () => doHabit('kitchen_closed')} onUndo={() => undoHabit('kitchen_closed')} />
        )}
        {viewing ? (
          <Step done={!!state.lightsOut} active={false} title="Wind-down" hint={state.lightsOut ? `Lights out ${fmtTime(state.inBedTs ?? state.lightsOut.ts)} · tap to change` : 'No lights-out time · tap to add one'} onTap={() => go('winddown')} />
        ) : (
          <Step done={false} active={activeKey === 'wind'} title="Wind-down" hint={`From ${windDownAt} · in bed by ${bedtime}${isWeekendEvening(day) ? ' · weekend' : ''}`} onTap={() => go('winddown')} />
        )}
      </div>

      <p class="note muted">One screen, one answer. Taps are timestamped and saved on this phone first.</p>
      {toast && <div class="toast">{toast}</div>}
    </main>
  );
}

type Nav = { day: string; today: string; viewing: boolean; go: (k: string | null) => void };
const MAX_BACK = 14;
const BANNER_KEY = 'brew-signin-banner-hidden-until';
const shortDay = (key: string) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); };

function syncLine(s: ReturnType<typeof useSyncStatus>): { text: string; warn: boolean } | null {
  if (!s.signedIn) return null;
  if (s.syncing) return { text: 'Syncing…', warn: false };
  if (s.error) {
    if (s.error.startsWith('Offline')) return { text: `Offline · ${s.pending} waiting · safe on this phone`, warn: false };
    if (s.error.startsWith("Can't reach")) return { text: "Can't reach sync · taps are safe here · tap to retry", warn: true };
    if (s.error.startsWith('Signed out')) return { text: 'Sign in again to sync', warn: true };
    return { text: 'Sync paused · tap to retry', warn: true };
  }
  if (s.pending > 0 && s.pendingSince && Date.now() - s.pendingSince > 60_000) return { text: `${s.pending} waiting to sync · tap to retry`, warn: false };
  if (!s.lastSync) return { text: 'Not synced yet · tap to sync', warn: false };
  const mins = Math.round((Date.now() - s.lastSync) / 60000);
  return { text: `Synced ${mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `at ${fmtTime(s.lastSync)}`}`, warn: false };
}

function Header({ nav, off, toggleOff }: { nav: Nav; off: boolean; toggleOff: () => void }) {
  const sync = useSyncStatus();
  const line = syncLine(sync);
  const [bannerHidden, setBannerHidden] = useState(() => { try { return Date.now() < Number(localStorage.getItem(BANNER_KEY) || 0); } catch { return false; } });
  const hideBanner = () => { try { localStorage.setItem(BANNER_KEY, String(Date.now() + 7 * 86400000)); } catch { /* private mode */ } setBannerHidden(true); };
  const back = prevDay(nav.day);
  const canBack = daysBetween(back, nav.today) <= MAX_BACK;
  return (
    <>
    {!sync.signedIn && !bannerHidden && (
      <div class="browser-warn">
        <button class="bw-main" onClick={() => go('settings')}>{isInstalled() ? 'Saved on this phone only · Sign in to sync' : 'In a browser, not the app · Sign in to sync'}</button>
        <button class="bw-x" onClick={hideBanner} aria-label="Hide for a week">✕</button>
      </div>
    )}
    <div class="topbar">
      <div>
        <h1>Brew</h1>
        <div class="daynav">
          <button class="navbtn" onClick={() => nav.go(back)} disabled={!canBack} aria-label="Previous day">‹</button>
          <span class="sub">{nav.viewing ? prettyDay(nav.day) : `Today · ${shortDay(nav.day)}`}{off ? ' · off-routine' : ''}</span>
          <button class="navbtn" onClick={() => nav.go(nextDay(nav.day))} disabled={!nav.viewing} aria-label="Next day">›</button>
        </div>
        {line && <button class={`syncline ${line.warn ? 'warn' : ''}`} onClick={() => syncNow()}>{line.text}</button>}
      </div>
      <div style="display:flex;gap:6px">
        <button class={`iconbtn ${off ? 'on' : ''}`} onClick={toggleOff} aria-pressed={off}>{off ? 'Back to routine' : 'Off day?'}</button>
        <button class="iconbtn" onClick={() => go('settings')} aria-label="Settings">⚙︎</button>
      </div>
    </div>
    </>
  );
}

function Counter({ label, sub, count, onMinus, onPlus }: { label: string; sub: string; count: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div class="counter">
      <div>
        <div class="label">{label}</div>
        <div class="sub">{sub}</div>
      </div>
      <div class="stepper">
        <button class="minus" onClick={onMinus} disabled={count === 0} aria-label={`Remove one ${label.toLowerCase()}`}>−</button>
        <span class="count" aria-live="polite">{count}</span>
        <button class="pill" onClick={onPlus} aria-label={`Add one ${label.toLowerCase()}`}>+1</button>
      </div>
    </div>
  );
}
