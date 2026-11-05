// Runs the Phase 1 acceptance walk: Up → breather → session → teeth → shower → water/coffee → outside → wind-down → lights out.
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, fullPage: true });

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByText('Morning').waitFor();
  await shot('01-today-fresh');

  // Up
  await page.getByRole('button', { name: /^Up/ }).click();
  await page.waitForURL(/#\/up/);
  await page.getByRole('button', { name: 'Good' }).click();
  await page.locator('.stepper button').nth(1).click(); // +1 waking
  await shot('02-up');
  await page.getByRole('button', { name: "I'm up" }).click();
  await page.waitForURL((u) => !u.hash.includes('up'));
  await page.getByText(/Up at/).waitFor();

  // Breather: skip (external link would leave the app)
  await page.getByRole('button', { name: 'skip' }).click();
  await page.getByText(/Done \(skipped\)/).waitFor();

  // Session
  const sessionRow = page.locator('.row', { hasText: /while the coffee brews/ });
  const sessionTitle = (await sessionRow.locator('.title').textContent()).trim();
  await sessionRow.click();
  await page.waitForURL(/#\/session/);
  await page.waitForTimeout(1500);
  await shot('03-session');
  // Swap, then done
  const swapBtn = page.getByRole('button', { name: /^Swap/ });
  const swapped = await swapBtn.isEnabled();
  if (swapped) { await swapBtn.click(); await page.waitForTimeout(500); }
  const swappedTitle = (await page.locator('.stitle').first().textContent()).trim();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForURL((u) => !u.hash.includes('session'));
  await page.getByText(/Done at/).waitFor();

  // Teeth, shower
  await page.locator('.row', { hasText: 'Teeth' }).first().click();
  await page.locator('.row', { hasText: 'Shower' }).click();

  // Water ×3, coffee ×2
  const plus = page.locator('.counter .pill');
  await plus.nth(0).click(); await plus.nth(0).click(); await plus.nth(0).click();
  await plus.nth(1).click(); await plus.nth(1).click();
  await page.getByText(/last at/).waitFor();

  // Outside
  await page.locator('.row', { hasText: 'Outside' }).click();
  await shot('04-today-midday');

  // Settings
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForURL(/#\/settings/);
  await shot('05-settings');
  await page.getByRole('button', { name: 'Back' }).click();

  // Wind-down
  await page.locator('.row', { hasText: 'Wind-down' }).click();
  await page.waitForURL(/#\/winddown/);
  await page.getByRole('button', { name: 'None' }).first().click();
  await page.getByRole('button', { name: 'Short' }).click();
  await page.getByRole('button', { name: 'No', exact: true }).click();
  await page.locator('.row', { hasText: 'Teeth' }).click();
  await shot('06-winddown');
  await page.getByRole('button', { name: 'Lights out' }).click();
  await page.waitForURL((u) => !u.hash.includes('winddown'));
  await page.getByText('Good night.').waitFor();
  await shot('07-today-night');

  // Verify the event log and export via IndexedDB directly
  const summary = await page.evaluate(async () => {
    const req = indexedDB.open('brew');
    const dbx = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
    const tx = dbx.transaction(['events', 'plan_days', 'sessions'], 'readonly');
    const all = (store) => new Promise((res) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
    const events = await all('events');
    const plans = await all('plan_days');
    const sessions = await all('sessions');
    const counts = {};
    for (const e of events) counts[e.type + (e.key ? ':' + e.key : '')] = (counts[e.type + (e.key ? ':' + e.key : '')] || 0) + 1;
    return { n: events.length, counts, plan: plans[0], measured: sessions.filter((s) => s.measuredSeconds).map((s) => [s.title, s.measuredSeconds]), days: [...new Set(events.map((e) => e.day))] };
  });

  console.log(JSON.stringify({ sessionTitle, swapped, swappedTitle, ...summary, errors }, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
