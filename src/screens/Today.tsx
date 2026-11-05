import { useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Today } from '../lib/store';
import { log, undoLast } from '../lib/events';
import { fmtTime, minusMinutes, prettyDay, weekdayOf, minutesOfDay, hmToMinutes } from '../lib/day';
import { go } from '../router';

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
  const { day, state, settings, session, habits, sessions, daySession } = t;
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
  const windDownAt = minusMinutes(settings.bedtimeHypothesis, settings.windDownLeadMin);
  const nowMin = minutesOfDay(Date.now());
  const isEvening = nowMin >= hmToMinutes(windDownAt) || nowMin < 3 * 60;

  const doneSession = state.sessionDone
    ? (state.sessionDone.key === 'fallback' ? null : sessions.find((s) => s.id === state.sessionDone!.key) ?? null)
    : null;
  const sessionTitle = state.sessionDone
    ? (doneSession ? doneSession.title : 'Written fallback')
    : off ? 'Session (written fallback)' : session ? session.title : 'Session';
  const sessionHint = state.sessionDone
    ? (state.sessionDone.key === 'fallback' ? `Fallback at ${fmtTime(state.sessionDone.ts)} — counts` : state.sessionDone.meta?.floorOnly ? 'Floor only — counts' : `Done at ${fmtTime(state.sessionDone.ts)}`)
    : off ? '2 minutes, no video' : session ? `${session.titleMinutes} min · while the coffee brews` : 'No session planned — fallback counts';

  // The morning chain, in order. `done` drives the "next" highlight.
  type Item = { key: string; label: string; done: boolean; go: () => void; el: (active: boolean) => JSX.Element };
  const morning: Item[] = [
    {
      key: 'up', label: 'Up', done: !!state.up, go: () => go('up'),
      el: (active) => <Step done={!!state.up} active={active} title="Up"
        hint={state.up ? `Up at ${fmtTime(state.up.ts)} · slept ${state.up.value}/5 · tap to re-rate` : `Target ${settings.wakeTarget}`}
        onTap={() => go('up')} />,
    },
    ...(isWeighDay ? [{
      key: 'weigh', label: 'Weigh in', done: state.weigh !== undefined, go: () => document.getElementById('weigh-input')?.focus(),
      el: (active: boolean) => (
        <Step done={state.weigh !== undefined} active={active} title={state.weigh !== undefined ? `Weigh-in: ${state.weigh} kg` : 'Weigh-in'}
          hint={state.weigh !== undefined ? undefined : 'Before coffee. Skip if no scale.'} onUndo={() => once(() => undoLast(day, 'weigh'))} undoLabel="Undo weigh-in">
          {state.weigh === undefined && (
            <span class="inline-form">
              <input id="weigh-input" type="number" inputMode="decimal" step="0.1" placeholder="kg" value={weight} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} />
              <button class="pill" disabled={!weight} onClick={() => once(async () => { await log('weigh', { value: Number(weight) }); setWeight(''); })}>Log</button>
            </span>
          )}
        </Step>
      ),
    } as Item] : []),
    {
      key: 'breather', label: 'Breather', done: !!state.breather, go: () => document.getElementById('breather-row')?.scrollIntoView({ block: 'center' }),
      el: (active) => (
        <Step done={!!state.breather} active={active} title="Breather"
          hint={state.breather ? (state.breather.key === 'skipped' ? 'Skipped today' : `Done (${state.breather.key === 'zazen' ? 'Zazen' : 'Adriene'})`) : 'Two minutes to get out of bed'}
          onUndo={() => once(() => undoLast(day, 'breather'))}>
          {!state.breather && active && (
            <span class="inline-actions" id="breather-row">
              <a class="pill ghost" href={settings.breathingUrl} target="_blank" rel="noopener" onClick={() => log('breather', { key: 'zazen' })}>Zazen</a>
              <button class="pill ghost" onClick={() => once(async () => { await log('breather', { key: 'adriene' }); go('session', { breath: '1' }); })}>Adriene 5 min</button>
              <button class="undo" onClick={() => once(() => log('breather', { key: 'skipped' }))} aria-label="Skip the breather today">skip</button>
            </span>
          )}
        </Step>
      ),
    },
    {
      key: 'session', label: off ? 'Session (fallback)' : session ? `Session · ${session.titleMinutes} min` : 'Session', done: !!state.sessionDone, go: () => go('session'),
      el: (active) => <Step done={!!state.sessionDone} active={active} title={sessionTitle} hint={sessionHint}
        onTap={state.sessionDone ? undefined : () => go('session')} onUndo={() => once(() => undoLast(day, 'session_done'))} undoLabel="Undo session" />,
    },
    {
      key: 'teeth_am', label: 'Teeth', done: h('teeth_am'), go: () => doHabit('teeth_am'),
      el: (active) => <Step done={h('teeth_am')} active={active} title="Teeth" onTap={h('teeth_am') ? undefined : () => doHabit('teeth_am')} onUndo={() => undoHabit('teeth_am')} />,
    },
    {
      key: 'shower', label: 'Shower', done: h('shower'), go: () => doHabit('shower'),
      el: (active) => <Step done={h('shower')} active={active} title="Shower" hint={off ? 'Any time today counts' : undefined} onTap={h('shower') ? undefined : () => doHabit('shower')} onUndo={() => undoHabit('shower')} />,
    },
  ];
  const outsideItem: Item = { key: 'outside', label: 'Outside', done: h('outside'), go: () => doHabit('outside'), el: () => <></> };
  const windItem: Item = { key: 'wind', label: 'Wind-down', done: !!state.lightsOut, go: () => go('winddown'), el: () => <></> };

  // What's next: the first open morning step; after the wind-down time, the wind-down itself.
  let next: Item | null = null;
  if (!state.lightsOut) {
    if (isEvening) next = windItem;
    else next = morning.find((m) => !m.done) ?? (!outsideItem.done ? outsideItem : null) ?? windItem;
  }
  const activeKey = next?.key ?? null;

  if (state.lightsOut) {
    return (
      <main class="screen">
        <Header day={day} off={off} toggleOff={toggleOff} />
        <div class="card goodnight">
          <div class="muted">Lights out at {fmtTime(state.lightsOut.ts)}</div>
          <div class="big">Good night.</div>
          <div class="muted">Tap Up in the morning.</div>
          <button class="btn quiet" onClick={() => once(() => undoLast(day, 'lights_out'))}>Not yet — undo lights out</button>
        </div>
        <div class="card" style="margin-top:12px">
          <Counter label="Water" sub={fluidsSub} count={state.water} onMinus={() => once(() => undoLast(day, 'water'))} onPlus={() => log('water')} />
          <Counter label="Tisane" sub="no caffeine" count={state.tisane} onMinus={() => once(() => undoLast(day, 'tisane'))} onPlus={() => log('tisane')} />
        </div>
        {toast && <div class="toast">{toast}</div>}
      </main>
    );
  }

  return (
    <main class="screen">
      <Header day={day} off={off} toggleOff={toggleOff} />

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
        <Step done={!!state.daySession} active={false} title="Yoga break"
          hint={state.daySession
            ? (state.daySession.key === 'fallback' ? `Fallback at ${fmtTime(state.daySession.ts)} — counts` : `${sessions.find((x) => x.id === state.daySession!.key)?.title ?? 'Done'} · ${fmtTime(state.daySession.ts)}`)
            : off || !daySession ? 'Optional · a written fallback, 2 min' : `Optional · ${daySession.title} · ${daySession.titleMinutes} min, or a fallback`}
          onTap={state.daySession ? undefined : () => go('session', { slot: 'day' })} onUndo={() => once(() => undoLast(day, 'day_session'))} undoLabel="Undo yoga break" />
        <Step done={h('outside')} active={activeKey === 'outside'} title="Outside"
          hint={h('outside') ? undefined : off ? 'Floor: two minutes on the step' : 'Drop-off, lunch, or pickup · 15 min; 2 min counts'}
          onTap={h('outside') ? undefined : () => doHabit('outside')} onUndo={() => undoHabit('outside')} />
      </div>

      <h2>Evening</h2>
      <div class="card">
        {kitchen?.active && (
          <Step done={h('kitchen_closed')} active={false} title="Kitchen closed" hint="No eating after 20:00" onTap={h('kitchen_closed') ? undefined : () => doHabit('kitchen_closed')} onUndo={() => undoHabit('kitchen_closed')} />
        )}
        <Step done={false} active={activeKey === 'wind'} title="Wind-down" hint={`From ${windDownAt} · in bed by ${settings.bedtimeHypothesis}`} onTap={() => go('winddown')} />
      </div>

      <p class="note muted">One screen, one answer. Taps are timestamped; nothing leaves the phone.</p>
      {toast && <div class="toast">{toast}</div>}
    </main>
  );
}

function Header({ day, off, toggleOff }: { day: string; off: boolean; toggleOff: () => void }) {
  return (
    <div class="topbar">
      <div>
        <h1>Brew</h1>
        <p class="sub">{prettyDay(day)}{off ? ' · off-routine' : ''}</p>
      </div>
      <div style="display:flex;gap:6px">
        <button class={`iconbtn ${off ? 'on' : ''}`} onClick={toggleOff} aria-pressed={off}>{off ? 'Back to routine' : 'Off day?'}</button>
        <button class="iconbtn" onClick={() => go('settings')} aria-label="Settings">⚙︎</button>
      </div>
    </div>
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
