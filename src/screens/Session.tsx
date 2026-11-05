import { useEffect, useRef, useState } from 'preact/hooks';
import type { Today } from '../lib/store';
import { db, type Session } from '../lib/db';
import { log } from '../lib/events';
import { swapPlan } from '../lib/picker';
import { FALLBACKS, CATEGORY_LABEL } from '../lib/seed';
import { go, query } from '../router';

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

function loadYT(): Promise<any> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  return new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    if (!document.querySelector('script[data-yt]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.dataset.yt = '1';
      document.head.appendChild(s);
    }
  });
}

export function Player({ session, onDuration }: { session: Session; onDuration: (sec: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    let player: any;
    let dead = false;
    const timer = setTimeout(() => { if (!player) setFallback(true); }, 4000);
    const onOff = () => setOffline(!navigator.onLine);
    addEventListener('online', onOff); addEventListener('offline', onOff);
    loadYT().then((YT) => {
      if (dead || !ref.current) return;
      player = new YT.Player(ref.current, {
        videoId: session.ytId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: (e: any) => {
            clearTimeout(timer);
            const d = Math.round(e.target.getDuration?.() ?? 0);
            if (d > 0) onDuration(d);
          },
        },
      });
    });
    return () => { dead = true; clearTimeout(timer); removeEventListener('online', onOff); removeEventListener('offline', onOff); try { player?.destroy?.(); } catch { /* ignore */ } };
  }, [session.ytId]);
  if (offline) {
    return <div class="player offline"><div>No connection — use a written fallback below. It counts.</div></div>;
  }
  if (fallback) {
    return (
      <div class="player">
        <iframe src={`https://www.youtube-nocookie.com/embed/${session.ytId}?playsinline=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title={session.title} />
      </div>
    );
  }
  return <div class="player"><div ref={ref} /></div>;
}

const BREATH_FALLBACK = 'Lying or sitting. In through the nose for 4, hold for 4, out through the mouth for 6. Ten rounds, about two minutes. Then feet on the floor.';

export function SessionScreen({ t }: { t: Today }) {
  const { day, state, session, swap, sessions, settings, plan, daySession } = t;
  const breathMode = query().get('breath') === '1';
  const dayMode = !breathMode && query().get('slot') === 'day';
  const breath = breathMode ? sessions.find((s) => s.id === 'ywa-calming-breath') ?? null : null;
  const current = breath ?? (dayMode ? daySession : session);
  const off = state.context === 'off';
  const alreadyDone = dayMode ? !!state.daySession : !!state.sessionDone;
  const evType = dayMode ? 'day_session' : 'session_done';
  const [busy, setBusy] = useState(false);

  const saveDuration = async (sec: number) => {
    if (!current || current.measuredSeconds === sec) return;
    await db.sessions.update(current.id, { measuredSeconds: sec });
  };

  // Three distinct outcomes, kept distinct in the log:
  //  - watched the video:            key = video id
  //  - did the video's floor version: key = video id, floorOnly
  //  - did a written fallback:        key = 'fallback', meta.planned = video id (never counts as "played")
  const done = async (kind: 'video' | 'floor' | 'fallback') => {
    if (busy || alreadyDone) return; setBusy(true);
    if (kind === 'fallback') await log(evType, { key: 'fallback', meta: { planned: current?.id ?? null, off } });
    else await log(evType, { key: current?.id ?? 'fallback', meta: { floorOnly: kind === 'floor', measuredSeconds: current?.measuredSeconds ?? null, off } });
    go('today');
  };

  const canSwap = !dayMode && !!swap && !plan?.swapped && !alreadyDone && !off;
  const doSwap = async () => { if (!canSwap) return; await swapPlan(day); t.refresh(); };

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>{breathMode ? 'Breather' : dayMode ? 'Yoga break' : 'Session'}</h1>
          <p class="sub">{current ? `${CATEGORY_LABEL[current.category]} · ${current.titleMinutes} min${current.measuredSeconds ? ` (${Math.floor(current.measuredSeconds / 60)}:${String(current.measuredSeconds % 60).padStart(2, '0')})` : ''}` : 'No session planned'}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      {breathMode && current && (
        <>
          <div class="card" style="padding:0">
            <Player session={current} onDuration={saveDuration} />
            <div class="fallback"><strong>No video?</strong><p>{BREATH_FALLBACK}</p></div>
          </div>
          <button class="btn" onClick={() => go('today')}>Done — start the coffee</button>
        </>
      )}

      {!breathMode && alreadyDone && (
        <p class="note">{dayMode ? "Today's yoga break is logged." : "Today's session is logged."} Undo it from Today if that was a mistake.</p>
      )}

      {!breathMode && !alreadyDone && current && !off && (
        <>
          <div class="card" style="padding:0">
            <Player session={current} onDuration={saveDuration} />
            <div style="padding:12px 14px">
              <div class="stitle" style="font-weight:700">{current.title}</div>
              {current.notes && <div class="muted">{current.notes}</div>}
            </div>
          </div>
          <button class="btn" onClick={() => done('video')} disabled={busy}>Done</button>
          {dayMode ? (
            <button class="btn quiet" onClick={() => done('floor')} disabled={busy}>Floor only</button>
          ) : (
            <>
              <div class="split">
                <button class="btn quiet" onClick={() => done('floor')} disabled={busy}>Floor only</button>
                <button class="btn quiet" onClick={doSwap} disabled={!canSwap}>{plan?.swapped ? 'Swapped' : swap ? `Swap → ${swap.titleMinutes} min` : 'No swap'}</button>
              </div>
              {swap && !plan?.swapped && <p class="note muted">Swap once: {swap.title}</p>}
            </>
          )}
          {dayMode && <p class="note muted">Optional. A break on top of the morning session — skipping it costs nothing.</p>}
        </>
      )}

      {!breathMode && !alreadyDone && off && (
        <p class="note">Off-routine day: a written fallback is the {dayMode ? 'break' : 'session'}. Two minutes counts.</p>
      )}

      {!breathMode && (
        <>
          <h2>No video? Any one of these counts</h2>
          <div class="card">
            {FALLBACKS.map((f) => (
              <div class="fallback" key={f.key}>
                <strong>{f.title}</strong>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
          {!alreadyDone && <button class={`btn ${off ? '' : 'secondary'}`} onClick={() => done('fallback')} disabled={busy}>{off ? 'Done (fallback)' : 'Did a fallback instead'}</button>}
          <p class="note muted">Tier {settings.tier}. Longer sessions unlock after two consistent weeks — proposed at the weekly review, never by surprise.</p>
        </>
      )}
    </main>
  );
}
