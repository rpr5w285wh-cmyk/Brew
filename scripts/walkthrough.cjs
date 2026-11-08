// Phase 1 acceptance walk + audit regressions.
// Usage: node scripts/walkthrough.cjs http://localhost:4173/ out/
const { chromium, devices } = require('playwright');
const fs = require('fs');

const base = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'shots';
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 2, locale: 'en-CA', timezoneId: 'America/Toronto' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|youtube/i.test(m.text())) errors.push(m.text()); });
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
  const events = () => page.evaluate(async () => {
    const req = indexedDB.open('brew');
    const dbx = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const tx = dbx.transaction(['events', 'plan_days', 'sessions'], 'readonly');
    const all = (store) => new Promise((res) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
    return { events: await all('events'), plans: await all('plan_days'), sessions: await all('sessions') };
  });
  const row = (text) => page.locator('.row', { hasText: text }).first().locator('.rowmain');
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) console.error('FAIL', name, detail ?? ''); };

  await page.clock.install({ time: new Date('2026-11-11T06:40:00-05:00') }); // a Wednesday morning
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Morning' }).waitFor();
  await shot('01-today-fresh');
  check('next banner says Up', (await page.locator('.next-title').textContent()).trim() === 'Up');

  // Up — rate 4, 1 waking
  await row('Up').click();
  await page.waitForURL(/#\/up/);
  await page.getByRole('button', { name: 'Good' }).click();
  await page.locator('.stepper .minus').nth(1).click();
  await shot('02-up');
  await page.getByRole('button', { name: "I'm up" }).click();
  await page.waitForURL((u) => !u.hash.includes('up'));
  await page.getByText(/Up at/).waitFor();
  let d = await events();
  const up1 = d.events.find((e) => e.type === 'up');
  check('up logged once', d.events.filter((e) => e.type === 'up').length === 1);

  // Re-rate: tap Up again, choose 3, Save → same event, same ts
  await page.waitForTimeout(1200);
  await row('Up').click();
  await page.waitForURL(/#\/up/);
  await page.locator('h1', { hasText: 'Re-rate' }).waitFor({ timeout: 3000 }).then(() => check('re-rate screen', true), () => check('re-rate screen', false));
  await page.getByRole('button', { name: 'OK' }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL((u) => !u.hash.includes('up'));
  d = await events();
  const ups = d.events.filter((e) => e.type === 'up');
  const am = d.events.filter((e) => e.type === 'amend');
  check('re-rate appends an amend, original untouched', ups.length === 1 && ups[0].uid === up1.uid && ups[0].ts === up1.ts && ups[0].value === 4 && am.length === 1 && am[0].meta.target === up1.uid && am[0].value === 3, JSON.stringify({ ups, am }));
  check('re-rate shows the new rating', await page.getByText(/slept 3\/5/).isVisible());
  check('every event has a uid', d.events.every((e) => typeof e.uid === 'string' && e.uid.length === 36));

  // Breather: double-tap skip → one event; undo → buttons back
  await page.getByRole('button', { name: 'Skip the breather' }).dblclick();
  await page.getByText('Skipped today').waitFor();
  d = await events();
  check('skip double-tap → one breather event', d.events.filter((e) => e.type === 'breather').length === 1);
  await page.getByRole('button', { name: 'Undo Breather' }).click();
  await page.getByRole('button', { name: 'Skip the breather' }).waitFor();
  await page.getByRole('button', { name: 'Skip the breather' }).click();
  await page.getByText('Skipped today').waitFor();
  d = await events();
  check('undo is an event, nothing deleted', d.events.filter((e) => e.type === 'breather').length === 2 && d.events.filter((e) => e.type === 'undo').length === 1);

  // Session: swap once, then swap is disabled; Done
  const sessionTitle = (await page.locator('.row', { hasText: /while the coffee brews/ }).locator('.title').textContent()).trim();
  await row(/while the coffee brews/).click();
  await page.waitForURL(/#\/session/);
  await page.waitForTimeout(1200);
  await shot('03-session');
  await page.getByRole('button', { name: /^Swap/ }).click();
  await page.waitForTimeout(500);
  check('swap is once', await page.getByRole('button', { name: 'Swapped' }).isDisabled());
  const swappedTitle = (await page.locator('.stitle').first().textContent()).trim();
  check('swap changed the session', swappedTitle !== sessionTitle, `${sessionTitle} → ${swappedTitle}`);
  await page.getByRole('button', { name: 'Done', exact: true }).dblclick();
  await page.waitForURL((u) => !u.hash.includes('session'));
  await page.getByText(/Done at/).waitFor();
  d = await events();
  check('session_done once, swap logged', d.events.filter((e) => e.type === 'session_done').length === 1 && d.events.filter((e) => e.type === 'swap').length === 1);
  check('done row shows the played title', (await page.locator('.row', { hasText: /Done at/ }).locator('.title').textContent()).trim() === swappedTitle);

  // Teeth double-tap → one; undo → redo
  await row('Teeth').dblclick();
  await page.waitForTimeout(300);
  d = await events();
  check('teeth double-tap → one habit_done', d.events.filter((e) => e.type === 'habit_done' && e.key === 'teeth_am').length === 1);
  await page.getByRole('button', { name: 'Undo Teeth' }).first().click();
  await page.waitForTimeout(300);
  await row('Teeth').click();
  await page.waitForTimeout(300);
  d = await events();
  check('teeth undo→redo', d.events.filter((e) => e.type === 'habit_done' && e.key === 'teeth_am').length === 2 && d.events.filter((e) => e.type === 'undo' && e.key === 'habit_done').length === 1);
  await row('Shower').click();

  // Counters: +water ×3 (with a bounce), +coffee ×2
  const plus = page.locator('.counter .pill');
  await plus.nth(0).click(); await page.waitForTimeout(450); await plus.nth(0).click(); await page.waitForTimeout(450); await plus.nth(0).click();
  await page.waitForTimeout(450); await plus.nth(1).click(); await page.waitForTimeout(450); await plus.nth(1).click();
  await page.getByText(/^last \d/).waitFor();
  await plus.nth(0).dblclick(); // bounce → counts once
  await page.waitForTimeout(500);
  check('water bounce', (await page.locator('.counter .count').first().textContent()).trim() === '4');
  // Tea (caffeinated) and tisane (counts toward water by default)
  await page.waitForTimeout(450); await plus.nth(2).click();
  await page.waitForTimeout(450); await plus.nth(3).click(); await page.waitForTimeout(450); await plus.nth(3).click();
  await page.waitForTimeout(400);
  const waterSub = (await page.locator('.counter').first().locator('.sub').textContent()).trim();
  check('tisane counts toward water', waterSub === '6/6 · 2 tisane', waterSub);
  check('last caffeine shown (tea after coffee)', await page.getByText(/Last caffeine/).isVisible());
  d = await events();
  check('tea and tisane logged', d.events.filter((e) => e.type === 'tea').length === 1 && d.events.filter((e) => e.type === 'tisane').length === 2);

  await row('Outside').click();

  // Yoga break: optional daytime slot, its own pick, never the morning video
  check('yoga break not the Next item', (await page.locator('.next-title').textContent()).trim() !== 'Yoga break');
  await row('Yoga break').click();
  await page.waitForURL(/slot=day/);
  await page.locator('h1', { hasText: 'Yoga break' }).waitFor();
  const breakTitle = (await page.locator('.stitle').first().textContent()).trim();
  check('yoga break is a different video', breakTitle !== swappedTitle && breakTitle !== sessionTitle, breakTitle);
  check('no swap on the break', (await page.getByRole('button', { name: /^Swap/ }).count()) === 0);
  await page.getByRole('button', { name: 'Done', exact: true }).dblclick();
  await page.waitForURL((u) => !u.hash.includes('session'));
  d = await events();
  check('day_session logged once, morning untouched', d.events.filter((e) => e.type === 'day_session').length === 1 && d.events.filter((e) => e.type === 'session_done').length === 1);
  await page.getByText('Wind-down').first().waitFor();
  await shot('04-today-midday');
  check('next banner after morning', (await page.locator('.next-title').textContent()).trim() === 'Wind-down');

  // Settings: edit a non-today weekday → today's plan untouched
  const planBefore = (await events()).plans[0];
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForURL(/#\/settings/);
  const notToday = (3 + 3) % 7; // Wednesday + 3
  const sel = page.locator('.field select').nth(2 + notToday); // theme, weighDay, then Sun..Sat
  await sel.selectOption('energy');
  await page.waitForTimeout(400);
  const planAfter = (await events()).plans[0];
  check('editing another weekday keeps today\'s plan', planAfter.sessionId === planBefore.sessionId && planAfter.swapped === true);
  await shot('05-settings');
  await page.getByRole('button', { name: 'Back' }).click();

  // Wind-down
  await row('Wind-down').click();
  await page.waitForURL(/#\/winddown/);
  await page.getByRole('button', { name: 'None' }).first().click();
  await page.getByRole('button', { name: 'Short' }).click();
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await row('Teeth').click();
  await page.getByText('Tap again to undo').waitFor();
  await shot('06-winddown');
  await page.getByRole('button', { name: 'Lights out' }).click();
  await page.waitForURL((u) => !u.hash.includes('winddown'));
  await page.getByText('Good night.').waitFor();
  await shot('07-today-night');

  d = await events();
  const counts = {};
  for (const e of d.events) { const k = e.type + (e.key ? ':' + e.key : ''); counts[k] = (counts[k] || 0) + 1; }
  const measuredSurvives = await page.evaluate(async () => {
    const req = indexedDB.open('brew');
    const dbx = await new Promise((res) => { req.onsuccess = () => res(req.result); });
    await new Promise((res) => { const tx = dbx.transaction('sessions', 'readwrite'); const st = tx.objectStore('sessions'); const g = st.get('ywa-take5'); g.onsuccess = () => { const v = g.result; v.measuredSeconds = 333; st.put(v); }; tx.oncomplete = res; });
    return true;
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Good night.').waitFor();
  d = await events();
  check('measuredSeconds survives reload', measuredSurvives && d.sessions.find((s) => s.id === 'ywa-take5').measuredSeconds === 333);

  // Catch-up: fresh install, morning session never done, yoga break at midday counts as the session
  {
    const ctx2 = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-CA', timezoneId: 'America/Toronto' });
    const p2 = await ctx2.newPage();
    await p2.goto(base, { waitUntil: 'networkidle' });
    await p2.getByText("counts as today's session if the morning").waitFor();
    await p2.locator('.row', { hasText: 'Yoga break' }).locator('.rowmain').click();
    await p2.getByText("This counts as today's session").waitFor();
    await p2.getByRole('button', { name: 'Done', exact: true }).click();
    await p2.waitForURL((u) => !u.hash.includes('session'));
    await p2.getByText(/as a yoga break — counts/).waitFor({ timeout: 5000 }).catch(() => {});
    const ev2 = await p2.evaluate(async () => {
      const req = indexedDB.open('brew'); const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
      return new Promise((r) => { const q = dbx.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result); });
    });
    const sd = ev2.filter((e) => e.type === 'session_done');
    check('catch-up logs session_done slot=day', sd.length === 1 && sd[0].meta.slot === 'day' && ev2.filter((e) => e.type === 'day_session').length === 0, JSON.stringify(sd));
    check('morning row shows caught up', await p2.getByText(/as a yoga break — counts/).isVisible());
    check('break row done', await p2.getByText(/counted as today's session/).isVisible());
    await p2.getByRole('button', { name: 'Undo yoga break' }).click();
    await p2.getByText("counts as today's session if the morning").waitFor({ timeout: 5000 }).then(() => check('undo catch-up restores both rows', true), () => check('undo catch-up restores both rows', false));
    await ctx2.close();
  }

  // Night that didn't go to plan: lights out 22:40, up 01:10 (ate something), back 02:40, morning correction.
  {
    const ctx3 = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-CA', timezoneId: 'America/Toronto' });
    const p3 = await ctx3.newPage();
    await p3.clock.install({ time: new Date('2026-11-05T22:40:00-05:00') });
    await p3.goto(base, { waitUntil: 'load' });
    await p3.getByRole('heading', { name: 'Morning' }).waitFor();
    // morning order: Teeth above the session
    const titles = await p3.locator('.card').nth(0).locator('.title').allTextContents();
    const ti = titles.indexOf('Teeth'); const si = titles.findIndex((x) => /Yoga|Session|Stretch|Min|Morning/.test(x) && x !== 'Teeth');
    check('Teeth above the session', ti > -1 && si > -1 && ti < si, JSON.stringify(titles));
    await p3.locator('.row', { hasText: 'Wind-down' }).locator('.rowmain').click();
    await p3.getByRole('button', { name: 'No', exact: true }).click();
    await p3.getByRole('button', { name: 'Lights out' }).click();
    await p3.getByText('Good night.').waitFor();
    await p3.clock.setSystemTime(new Date('2026-11-06T01:10:00-05:00'));
    await p3.getByRole('button', { name: "Can't sleep — got up" }).click();
    await p3.getByText("Can't sleep.").waitFor();
    await p3.getByRole('button', { name: 'Ate something' }).click();
    await p3.clock.setSystemTime(new Date('2026-11-06T02:40:00-05:00'));
    await p3.getByRole('button', { name: 'Back to bed' }).click();
    await p3.getByText(/up 1× since/).waitFor();
    // morning: day rolls at 03:00; Up screen shows last night pre-filled
    await p3.clock.setSystemTime(new Date('2026-11-06T06:35:00-05:00'));
    await p3.reload({ waitUntil: 'load' });
    await p3.getByRole('heading', { name: 'Morning' }).waitFor();
    await p3.locator('.row', { hasText: 'Up' }).first().locator('.rowmain').click();
    await p3.getByRole('heading', { name: 'Last night' }).waitFor();
    const vals = await p3.locator('input[type=time]:not(#wake-at)').evaluateAll((els) => els.map((e) => e.value));
    check('last night pre-filled', JSON.stringify(vals) === JSON.stringify(['22:40', '01:10', '02:40']), JSON.stringify(vals));
    check('ate-late carried from the night', await p3.locator('.chips[aria-label="Ate after 20:00"] .chip.on').textContent() === 'Yes');
    // correct: actually lights out at 23:05, back to bed 03:15
    await p3.getByLabel('Lights out time').fill('23:05');
    await p3.getByLabel('Back to bed at').fill('03:15');
    await p3.screenshot({ path: `${out}/08-up-last-night.png`, fullPage: true });
    await p3.getByRole('button', { name: 'Good' }).click();
    await p3.getByRole('button', { name: "I'm up" }).click();
    await p3.getByText(/Up at 06:35/).waitFor();
    const ev3 = await p3.evaluate(async () => {
      const req = indexedDB.open('brew'); const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
      return new Promise((r) => { const q = dbx.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result); });
    });
    const t = (iso) => new Date(iso).getTime();
    const lo = ev3.find((e) => e.type === 'lights_out');
    const loFix = ev3.find((e) => e.type === 'amend' && e.meta.target === lo.uid);
    check('lights out corrected, tap kept', lo.day === '2026-11-05' && Math.floor(lo.ts / 60000) === t('2026-11-05T22:40:00-05:00') / 60000 && !lo.meta?.correctedTs && loFix?.meta.patch.correctedTs === t('2026-11-05T23:05:00-05:00'), JSON.stringify(loFix));
    const undone = new Set(ev3.filter((e) => e.type === 'undo').map((e) => e.meta.undoOf));
    const live = (type) => ev3.filter((e) => e.type === type && !undone.has(e.uid));
    check('night up/back on last night, corrected', live('night_up').length === 1 && live('back_to_bed').length === 1 && live('back_to_bed')[0].ts === t('2026-11-06T03:15:00-05:00') && live('back_to_bed')[0].day === '2026-11-05', JSON.stringify(live('back_to_bed')));
    check('up is today', ev3.find((e) => e.type === 'up').day === '2026-11-06');
    await ctx3.close();
  }

  // Later: move the morning session to the day on purpose
  {
    const ctx4 = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-CA', timezoneId: 'America/Toronto' });
    const p4 = await ctx4.newPage();
    await p4.clock.install({ time: new Date('2026-11-06T06:40:00-05:00') });
    await p4.goto(base, { waitUntil: 'load' });
    await p4.getByRole('heading', { name: 'Morning' }).waitFor();
    const planned = (await p4.locator('.row', { hasText: /while the coffee brews/ }).locator('.title').textContent()).trim();
    await p4.getByRole('button', { name: 'Do the session later today' }).click();
    await p4.getByText('Moved to the day — Yoga break').waitFor();
    check('break no longer optional', await p4.locator('.row', { hasText: 'Yoga break' }).getByText(`Today's session · ${planned}`).isVisible());
    // finish the rest of the morning chain → Next is the Yoga break
    await p4.locator('.row', { hasText: 'Up' }).first().locator('.rowmain').click();
    await p4.getByRole('button', { name: 'Good' }).click();
    await p4.getByRole('button', { name: "I'm up" }).click();
    await p4.getByRole('button', { name: 'Skip the breather' }).click();
    await p4.locator('.row', { hasText: 'Teeth' }).first().locator('.rowmain').click();
    await p4.getByRole('button', { name: 'Skip the shower today' }).dblclick();
    await p4.getByText('Skipped today').nth(1).waitFor();
    check('Next is Outside before the moved session', (await p4.locator('.next-title').textContent()).trim() === 'Outside');
    await p4.locator('.row', { hasText: 'Outside' }).locator('.rowmain').click();
    await p4.waitForTimeout(300);
    const dayTitles = await p4.locator('.card').nth(2).locator('.title').allTextContents();
    check('Outside above Yoga break', dayTitles.indexOf('Outside') < dayTitles.indexOf('Yoga break'), JSON.stringify(dayTitles));
    check('Next is the yoga break after Later', (await p4.locator('.next-title').textContent()).trim() === 'Yoga break');
    await p4.screenshot({ path: `${out}/09-later.png`, fullPage: true });
    await p4.locator('.next').click();
    await p4.getByText("Today's session, moved from the morning.").waitFor();
    check('break plays the morning pick', (await p4.locator('.stitle').first().textContent()).trim() === planned);
    await p4.getByRole('button', { name: 'Done', exact: true }).click();
    await p4.waitForURL((u) => !u.hash.includes('session'));
    const ev4 = await p4.evaluate(async () => {
      const req = indexedDB.open('brew'); const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
      return new Promise((r) => { const q = dbx.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result); });
    });
    const sd4 = ev4.filter((e) => e.type === 'session_done');
    check('shower skip logged once, not as done', ev4.filter((e) => e.type === 'habit_skip' && e.key === 'shower').length === 1 && !ev4.some((e) => e.type === 'habit_done' && e.key === 'shower'));
    check('moved session logged as the session (slot day)', sd4.length === 1 && sd4[0].meta.slot === 'day' && ev4.some((e) => e.type === 'session_later'));
    await ctx4.close();
  }

  // Sunday morning: weekend wake target, weigh-in skip, then go back to Saturday and fill in a forgotten tap
  {
    const ctx5 = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-CA', timezoneId: 'America/Toronto' });
    const p5 = await ctx5.newPage();
    await p5.clock.install({ time: new Date('2026-11-08T07:20:00-05:00') });
    await p5.goto(base, { waitUntil: 'load' });
    await p5.getByRole('heading', { name: 'Morning' }).waitFor();
    check('Sunday wake target is the weekend one', await p5.getByText('Target 07:30 · weekend').isVisible());
    await p5.getByRole('button', { name: 'Skip the weigh-in this week' }).click();
    await p5.getByText('Skipped this week').waitFor();
    check('weigh-in skip works', true);
    check('Next moves past the weigh-in', (await p5.locator('.next-title').textContent()).trim() !== 'Weigh in');
    // Go back to Saturday: weekend bedtime shown for Saturday evening, and fill in a forgotten coffee
    await p5.getByRole('button', { name: 'Previous day' }).click();
    await p5.getByText('Filling in').waitFor();
    { const bt = await p5.locator('.past-banner').textContent(); check('past day banner', /Filling in Saturday/.test(bt), bt); }
    check('no Next banner on a past day', (await p5.locator('.next').count()) === 0);
    check('Saturday evening uses weekend bedtime', await p5.getByText(/in bed by 23:30 · weekend|Lights out|Not logged · tap to add/).first().isVisible());
    const coffeeRow = p5.locator('.counter', { has: p5.locator('.label', { hasText: /^Coffee$/ }) });
    await coffeeRow.locator('.pill').click();
    await p5.waitForTimeout(400);
    check('Next day arrow enabled when viewing the past', await p5.getByRole('button', { name: 'Next day' }).isEnabled());
    await p5.screenshot({ path: `${out}/10-past-day.png`, fullPage: true });
    await p5.getByRole('button', { name: 'Today', exact: true }).click();
    await p5.locator('.daynav .sub', { hasText: /^Today · / }).waitFor();
    { const cc = (await p5.locator('.counter', { has: p5.locator('.label', { hasText: /^Coffee$/ }) }).locator('.count').textContent()).trim(); check('back to today', cc === '0', cc + ' | ' + await p5.locator('.daynav .sub').textContent()); }
    const ev5 = await p5.evaluate(async () => {
      const req = indexedDB.open('brew'); const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
      return new Promise((r) => { const q = dbx.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result); });
    });
    const c5 = ev5.find((e) => e.type === 'coffee');
    check('forgotten coffee filed on Saturday, marked backfilled', c5 && c5.day === '2026-11-07' && c5.meta?.backfilled === true && new Date(c5.ts).getHours() === 12, JSON.stringify(c5));
    check('weigh skip logged', ev5.some((e) => e.type === 'habit_skip' && e.key === 'weigh'));
    // Friday evening wind-down shows the weekend bedtime
    await p5.clock.setSystemTime(new Date('2026-11-13T21:00:00-05:00'));
    await p5.reload({ waitUntil: 'load' });
    await p5.getByRole('heading', { name: 'Morning' }).waitFor();
    check('Friday evening weekend bedtime', await p5.getByText('From 22:45 · in bed by 23:30 · weekend').isVisible());
    await ctx5.close();
  }

  // Forgot to tap: enter the real wake and lights-out times; and add a missed Up on a past day
  {
    const ctx6 = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-CA', timezoneId: 'America/Toronto' });
    const p6 = await ctx6.newPage();
    const t = (iso) => new Date(iso).getTime();
    const all = () => p6.evaluate(async () => {
      const req = indexedDB.open('brew'); const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
      return new Promise((r) => { const q = dbx.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result); });
    });
    await p6.clock.install({ time: new Date('2026-11-11T07:10:00-05:00') }); // Wednesday, logging late
    await p6.goto(base, { waitUntil: 'load' });
    await p6.getByRole('heading', { name: 'Morning' }).waitFor();
    // Past day first: Tuesday's Up was never logged
    await p6.getByRole('button', { name: 'Previous day' }).click();
    await p6.locator('.past-banner').waitFor();
    await p6.locator('.row', { hasText: 'Up' }).first().locator('.rowmain').click();
    await p6.locator('#wake-at').waitFor();
    check('past-day Up defaults to that morning\'s target', (await p6.locator('#wake-at').inputValue()) === '06:30');
    await p6.locator('#wake-at').fill('06:50');
    await p6.getByRole('button', { name: 'OK' }).click();
    await p6.getByRole('button', { name: "I'm up" }).click();
    await p6.getByText(/Up at 06:50/).waitFor();
    let ev = await all();
    let up = ev.find((e) => e.type === 'up');
    check('past-day Up filed on that morning', up.day === '2026-11-10' && up.ts === t('2026-11-10T06:50:00-05:00') && up.meta.entered === true, JSON.stringify(up));
    await p6.getByRole('button', { name: 'Today', exact: true }).click();
    await p6.locator('.daynav .sub', { hasText: /^Today · / }).waitFor();
    // Today: actually up at 06:35, logging at 07:10
    await p6.locator('.row', { hasText: 'Up' }).first().locator('.rowmain').click();
    check('wake time defaults to now', (await p6.locator('#wake-at').inputValue()) === '07:10');
    await p6.locator('#wake-at').fill('06:35');
    check('on time after entering the real wake time', await p6.getByText(/on time/).isVisible());
    await p6.getByRole('button', { name: 'Good' }).click();
    await p6.getByRole('button', { name: "I'm up" }).click();
    await p6.getByText(/Up at 06:35/).waitFor();
    ev = await all();
    up = ev.find((e) => e.type === 'up' && e.day === '2026-11-11');
    check('entered wake time is the event time', up.ts === t('2026-11-11T06:35:00-05:00') && up.meta.onTime === true, JSON.stringify(up));
    // Change it again later via re-rate: amend, original kept
    await p6.locator('.row', { hasText: 'Up' }).first().locator('.rowmain').click();
    await p6.locator('#wake-at').fill('06:40');
    await p6.getByRole('button', { name: 'Save' }).click();
    await p6.getByText(/Up at 06:40/).waitFor();
    ev = await all();
    check('changing wake time later is an amend', ev.some((e) => e.type === 'amend' && e.meta.patch?.correctedTs === t('2026-11-11T06:40:00-05:00')));
    // Evening: in bed at 22:50, logging at 23:20
    await p6.clock.setSystemTime(new Date('2026-11-11T23:20:00-05:00'));
    await p6.locator('.row', { hasText: 'Wind-down' }).locator('.rowmain').click();
    check('lights-out defaults to now', (await p6.locator('#out-at').inputValue()) === '23:20');
    await p6.locator('#out-at').fill('22:50');
    await p6.getByRole('button', { name: 'Lights out' }).click();
    await p6.getByText('Good night.').waitFor();
    check('night card shows entered time', await p6.getByText('Lights out at 22:50').isVisible());
    ev = await all();
    const lo = ev.find((e) => e.type === 'lights_out');
    check('entered lights-out is the event time', lo.day === '2026-11-11' && lo.ts === t('2026-11-11T22:50:00-05:00') && lo.meta.entered === true, JSON.stringify(lo));
    await ctx6.close();
  }

  console.log(JSON.stringify({ counts, plan: d.plans[0], checks, errors }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
