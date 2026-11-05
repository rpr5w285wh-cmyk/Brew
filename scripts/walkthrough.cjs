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

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('Morning').waitFor();
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
  check('re-rate keeps wake ts and id', ups.length === 1 && ups[0].id === up1.id && ups[0].ts === up1.ts && ups[0].value === 3, JSON.stringify(ups));

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
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForURL(/#\/settings/);
  const notToday = (new Date().getDay() + 3) % 7;
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

  console.log(JSON.stringify({ counts, plan: d.plans[0], checks, errors }, null, 2));
  const failed = checks.filter((c) => !c.ok).length;
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
