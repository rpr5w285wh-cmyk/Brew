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

function Player({ session, onDuration }: { session: Session; onDuration: (sec: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    let player: any;
    let dead = false;
    const timer = setTimeout(() => { if (!player) setFallback(true); }, 4000);
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
    return () => { dead = true; clearTimeout(timer); try { player?.destroy?.(); } catch { /* ignore */ } };
  }, [session.ytId]);
  if (fallback) {
    return (
      <div class="player">
        <iframe src={`https://www.youtube-nocookie.com/embed/${session.ytId}?playsinline=1&rel=0`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen title={session.title} />
      </div>
    );
  }
  return <div class="player"><div ref={ref} /></div>;
}

export function SessionScreen({ t }: { t: Today }) {
  const { day, state, session, swap, sessions, settings } = t;
  const breathMode = query().get('breath') === '1';
  const breath = breathMode ? sessions.find((s) => s.id === 'ywa-calming-breath') ?? null : null;
  const current = breath ?? session;
  const off = state.context === 'off';
  const [busy, setBusy] = useState(false);

  const saveDuration = async (sec: number) => {
    if (!current || current.measuredSeconds === sec) return;
    await db.sessions.update(current.id, { measuredSeconds: sec });
  };

  const done = async (floorOnly: boolean) => {
    if (busy) return; setBusy(true);
    if (breathMode) { go('today'); return; }
    await log('session_done', { key: current?.id ?? 'fallback', meta: { floorOnly, measuredSeconds: current?.measuredSeconds ?? null, off } });
    go('today');
  };

  const doSwap = async () => { await swapPlan(day); t.refresh(); };

  return (
    <main class="screen">
      <div class="topbar">
        <div>
          <h1>{breathMode ? 'Breather' : 'Session'}</h1>
          <p class="sub">{current ? `${CATEGORY_LABEL[current.category]} · ${current.titleMinutes} min${current.measuredSeconds ? ` (${Math.round(current.measuredSeconds / 60)}:${String(current.measuredSeconds % 60).padStart(2, '0')})` : ''}` : 'No session planned'}</p>
        </div>
        <button class="iconbtn" onClick={() => go('today')}>Back</button>
      </div>

      {current && !off ? (
        <>
          <div class="card" style="padding:0">
            <Player session={current} onDuration={saveDuration} />
            <div style="padding:12px 14px">
              <div class="stitle" style="font-weight:700">{current.title}</div>
              {current.notes && <div class="muted small">{current.notes}</div>}
            </div>
          </div>
          {!breathMode && (
            <>
              <button class="btn" onClick={() => done(false)} disabled={busy}>Done</button>
              <div class="split">
                <button class="btn quiet" onClick={() => done(true)} disabled={busy}>Floor only</button>
                <button class="btn quiet" onClick={doSwap} disabled={!swap}>{swap ? `Swap → ${swap.titleMinutes} min` : 'No swap'}</button>
              </div>
              {swap && <p class="note muted small">Swap: {swap.title}</p>}
            </>
          )}
          {breathMode && <button class="btn" onClick={() => go('today')}>Back to Today</button>}
        </>
      ) : null}

      {off && !breathMode && (
        <>
          <p class="note">Off-routine day: the written fallback is the session. Two minutes counts.</p>
          <button class="btn" onClick={() => done(true)} disabled={busy}>Done (fallback)</button>
        </>
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
          {!off && current && <button class="btn secondary" onClick={() => done(true)} disabled={busy}>Did a fallback instead</button>}
          <p class="note muted small">Tier {settings.tier}. Longer sessions unlock after two consistent weeks — proposed at the weekly review, never by surprise.</p>
        </>
      )}
    </main>
  );
}
