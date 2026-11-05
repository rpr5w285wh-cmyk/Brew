# Brew

One screen, one answer. A personal habit app built around the morning coffee: wake, breathe, do a short Yoga With Adriene session while the coffee brews, then the day's few habits, then a wind-down that feeds a sleep experiment. Everything is logged as timestamped events on the phone; nothing leaves it.

Phase 1 (this build): the daily loop. Phase 2 adds the weekly review and progression; Phase 3 adds the sleep factor splits. See the planning docs in the Claude "Exercise" project.

## Run it

```bash
npm install
npm run dev        # http://<your-mac-ip>:5173 on the phone (same Wi-Fi)
npm run build      # production build in dist/
npm run preview    # serve dist/ on the LAN
```

`npm run dev` binds to all interfaces, so open the printed Network URL on the iPhone.

## Install on the iPhone (PWA)

Service workers and home-screen install need HTTPS (or `localhost`). For Phase 1 testing on the LAN, either:

1. **Tunnel** — `npx cloudflared tunnel --url http://localhost:4173` after `npm run preview`, open the https URL in Safari, Share → *Add to Home Screen*. Zero-setup, temporary URL.
2. **Host** — push `dist/` to GitHub Pages or Cloudflare Pages (decision deferred to after Phase 1), open it in Safari, Share → *Add to Home Screen*.

Open the installed app once so storage persistence is requested.

## Morning and evening cues (no server, no code)

iOS web push needs a server; Phase 1 uses the phone instead:

- Keep the 06:30 alarm.
- Shortcuts → Automation → *Time of Day* 06:31 → *Open URL* → the Brew URL. Turn off *Ask Before Running*.
- Same for the wind-down time shown in Settings (default 22:00).
- Optional: a daily 16:00 Reminder titled "Outside?" — dismiss if already done.

## What's in the box

```
src/lib/db.ts          Dexie schema (profiles, settings, habits, sessions, template, plan_days, events)
src/lib/seed.ts        Curated Yoga With Adriene library, habit chain, default template, fallbacks
src/lib/events.ts      Event log helpers + per-day derived state
src/lib/day.ts         Logical-day boundary (03:00) and time helpers
src/lib/picker.ts      Session picker: template → tier → quiet → no-repeat → least-recently-played
src/lib/exportData.ts  JSON backup, CSV of events, restore
src/screens/           Today, Session, Up, WindDown, Settings
scripts/walkthrough.cjs  Playwright acceptance walk in iPhone emulation (needs a served build)
```

Every tap writes one row to `events` (`up`, `lights_out`, `session_done`, `water`, `coffee`, `habit_done`, `chip`, …). Days, nights and streaks are derived — never stored.

## Acceptance walk

```bash
npm run build && npx vite preview --port 4173 &
node scripts/walkthrough.cjs http://localhost:4173/ shots/
```

Prints the event counts and plan for the day, and drops screenshots in `shots/`.

## Notes

- Runtimes in the library are the ones in Adriene's titles; the player records the real duration on first play (`measuredSeconds`), visible in Settings → Library.
- YouTube embeds need connectivity; the three written fallbacks are always on the Session screen and count as done.
- Export at the weekly review. A lost phone means lost logs otherwise.
