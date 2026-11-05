import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Today } from '../lib/store';
import { log, undoLast } from '../lib/events';
import { setPlanContext } from '../lib/picker';
import { fmtTime, minusMinutes, prettyDay, weekdayOf } from '../lib/day';
import { go } from '../router';

interface StepProps {
  done: boolean;
  active: boolean;
  title: string;
  hint?: string;
  right?: string;
  onTap?: () => void;
  onUndo?: () => void;
}

function Step({ done, active, title, hint, right, onTap, onUndo }: StepProps) {
  const cls = `row ${done ? 'done' : active ? 'active' : ''}`;
  return (
    <button class={cls} onClick={done ? undefined : onTap} disabled={done && !onUndo}>
      <span class="mark">{done ? '✓' : ''}</span>
      <span class="body">
        <div class="title">{title}</div>
        {hint && <div class="hint">{hint}</div>}
      </span>
      {done && onUndo ? <span class="undo" onClick={(e) => { e.stopPropagation(); onUndo(); }}>undo</span> : right ? <span class="right">{right}</span> : null}
    </button>
  );
}

export function TodayScreen({ t }: { t: Today }) {
  const { day, state, settings, session, habits } = t;
  const off = state.context === 'off';
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1400); };

  const habit = (key: string) => habits.find((h) => h.key === key);
  const h = (key: string) => !!state.habits[key];
  const doHabit = async (key: string) => { await log('habit_done', { key }); };
  const undoHabit = async (key: string) => { await log('habit_undo', { key }); };

  const toggleOff = async () => {
    const next = off ? 'normal' : 'off';
    await log('context', { value: next });
    await setPlanContext(day, next);
    flash(next === 'off' ? 'Off-routine day' : 'Back to routine');
  };

  // morning chain order
  const morning: { key: string; done: boolean; el: (active: boolean) => JSX.Element }[] = [
    {
      key: 'up', done: !!state.up,
      el: (active) => <Step done={!!state.up} active={active} title="Up" hint={state.up ? `Up at ${fmtTime(state.up.ts)} · slept ${state.up.value}/5` : `Target ${settings.wakeTarget}`} onTap={() => go('up')} onUndo={() => undoLast(day, 'up')} />,
    },
    {
      key: 'breather', done: !!state.breather,
      el: (active) => (
        <div class={`row ${state.breather ? 'done' : active ? 'active' : ''}`} style="flex-wrap:wrap">
          <span class="mark">{state.breather ? '✓' : ''}</span>
          <span class="body">
            <div class="title">Breather</div>
            <div class="hint">{state.breather ? `Done (${state.breather.key})` : 'Two minutes to get out of bed'}</div>
          </span>
          {!state.breather ? (
            <span style="display:flex;gap:8px;width:100%;padding:8px 0 2px 40px">
              <a class="pill ghost" style="display:grid;place-items:center;text-decoration:none;font-size:15px;padding:0 14px" href={settings.breathingUrl} target="_blank" rel="noopener" onClick={() => log('breather', { key: 'zazen' })}>Zazen</a>
              <button class="pill ghost" style="font-size:15px;padding:0 14px" onClick={() => { log('breather', { key: 'adriene' }); go('session', { breath: '1' }); }}>Adriene 5 min</button>
              <button class="undo" onClick={() => log('breather', { key: 'skipped' })}>skip</button>
            </span>
          ) : <span class="undo" onClick={() => undoLast(day, 'breather')}>undo</span>}
        </div>
      ),
    },
    {
      key: 'session', done: !!state.sessionDone,
      el: (active) => <Step done={!!state.sessionDone} active={active}
        title={off ? 'Session (written fallback)' : session ? session.title : 'Session'}
        hint={state.sessionDone ? (state.sessionDone.meta?.floorOnly ? 'Floor only — counts' : `Done at ${fmtTime(state.sessionDone.ts)}`) : off ? '2 minutes, no video' : session ? `${session.titleMinutes} min · while the coffee brews` : 'No session planned'}
        onTap={() => go('session')} onUndo={() => undoLast(day, 'session_done')} />,
    },
    {
      key: 'teeth_am', done: h('teeth_am'),
      el: (active) => <Step done={h('teeth_am')} active={active} title="Teeth" onTap={() => doHabit('teeth_am')} onUndo={() => undoHabit('teeth_am')} />,
    },
    {
      key: 'shower', done: h('shower'),
      el: (active) => <Step done={h('shower')} active={active} title="Shower" hint={off ? habit('shower')?.floorText : undefined} onTap={() => doHabit('shower')} onUndo={() => undoHabit('shower')} />,
    },
  ];
  const firstOpen = morning.findIndex((m) => !m.done);

  const isWeighDay = weekdayOf(day) === settings.weighDay && !off;
  const [weight, setWeight] = useState('');
  const kitchen = habits.find((x) => x.key === 'kitchen_closed');
  const windDownAt = minusMinutes(settings.bedtimeHypothesis, settings.windDownLeadMin);

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>Brew</h1>
          <p class="sub">{prettyDay(day)}</p>
        </div>
        <div style="display:flex;gap:6px">
          <button class={`iconbtn ${off ? 'on' : ''}`} onClick={toggleOff}>{off ? 'Off-routine' : 'Routine'}</button>
          <button class="iconbtn" onClick={() => go('settings')} aria-label="Settings">⚙︎</button>
        </div>
      </div>

      {state.lightsOut ? (
        <div class="card goodnight">
          <div class="muted">Lights out at {fmtTime(state.lightsOut.ts)}</div>
          <div class="big">Good night.</div>
          <div class="muted small">Tap Up in the morning.</div>
          <button class="undo" onClick={() => undoLast(day, 'lights_out')}>undo</button>
        </div>
      ) : null}

      <h2>Morning</h2>
      <div class="card">
        {morning.map((m, i) => m.el(i === firstOpen))}
      </div>

      <h2>Day</h2>
      <div class="card">
        <div class="counter">
          <div>
            <div class="label">Water</div>
            <div class="sub">{state.water}/{settings.waterTarget} · floor {settings.waterFloor}</div>
          </div>
          <div class="stepper">
            <button class="undo" onClick={() => undoLast(day, 'water')} disabled={state.water === 0}>−</button>
            <span class="count">{state.water}</span>
            <button class="pill" onClick={() => log('water')}>+1</button>
          </div>
        </div>
        <div class="counter">
          <div>
            <div class="label">Coffee</div>
            <div class="sub">{state.lastCoffee ? `last at ${fmtTime(state.lastCoffee)}` : 'none yet'}</div>
          </div>
          <div class="stepper">
            <button class="undo" onClick={() => undoLast(day, 'coffee')} disabled={state.coffee === 0}>−</button>
            <span class="count">{state.coffee}</span>
            <button class="pill" onClick={() => log('coffee')}>+1</button>
          </div>
        </div>
        <Step done={h('outside')} active={!h('outside') && firstOpen === -1} title="Outside"
          hint={h('outside') ? undefined : off ? 'Floor: two minutes on the step' : 'Drop-off, lunch, or pickup · 15 min; 2 min counts'}
          onTap={() => doHabit('outside')} onUndo={() => undoHabit('outside')} />
      </div>

      {isWeighDay && (
        <>
          <h2>Weekly</h2>
          <div class="card">
            {state.weigh !== undefined ? (
              <Step done active={false} title={`Weigh-in: ${state.weigh} kg`} onUndo={() => undoLast(day, 'weigh')} />
            ) : (
              <div class="counter">
                <div>
                  <div class="label">Weigh-in</div>
                  <div class="sub">After Up, before coffee</div>
                </div>
                <div class="stepper">
                  <input type="number" inputMode="decimal" step="0.1" placeholder="kg" value={weight} onInput={(e) => setWeight((e.target as HTMLInputElement).value)} style="width:84px;font:inherit;padding:8px;border:1px solid var(--line);border-radius:10px" />
                  <button class="pill" disabled={!weight} onClick={async () => { await log('weigh', { value: Number(weight) }); setWeight(''); }}>Log</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <h2>Evening</h2>
      <div class="card">
        {kitchen?.active && (
          <Step done={h('kitchen_closed')} active={false} title="Kitchen closed" hint="No eating after 20:00" onTap={() => doHabit('kitchen_closed')} onUndo={() => undoHabit('kitchen_closed')} />
        )}
        <Step done={!!state.lightsOut} active={firstOpen === -1 && h('outside')} title="Wind-down"
          hint={state.lightsOut ? `Lights out ${fmtTime(state.lightsOut.ts)}` : `From ${windDownAt} · in bed by ${settings.bedtimeHypothesis}`}
          onTap={() => go('winddown')} />
      </div>

      <p class="note muted small">One screen, one answer. Taps are timestamped; nothing leaves the phone.</p>
      {toast && <div class="toast">{toast}</div>}
    </main>
  );
}
