// Two-device sync test against an in-memory stand-in for Supabase (auth + PostgREST), shared by both browsers.
// Usage: node scripts/sync-test.cjs http://localhost:4173/
const { chromium, devices } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173/';
const SUPA = 'https://dhetwzklyujcaiehdijo.supabase.co';
const { USER } = require('./fake-supabase.cjs');

// ---- fake server ----
const { makeServer } = require('./fake-supabase.cjs');
const { server, handle } = makeServer();
(async () => {
  const browser = await chromium.launch();
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) console.error('FAIL', name, detail ?? ''); };
  const device = async (name) => {
    const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
    const dev = { offline: false };
    await ctx.route(SUPA + '/**', (route) => (dev.offline ? route.abort('internetdisconnected') : handle(route)));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.error(name, 'pageerror', String(e)));
    await p.goto(base, { waitUntil: 'load' });
    await p.getByRole('heading', { name: 'Morning' }).waitFor();
    return { ctx, p, dev };
  };
  const counter = (p, label) => p.locator('.counter', { has: p.locator('.label', { hasText: new RegExp('^' + label + '$') }) }).locator('.count').first();
  const plus = (p, label) => p.locator('.counter', { has: p.locator('.label', { hasText: new RegExp('^' + label + '$') }) }).locator('.pill').first();
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const signIn = async (p, password) => {
    await p.getByRole('button', { name: 'Settings', exact: true }).click();
    await p.getByLabel('Email').fill(USER.email);
    await p.getByLabel('Password').fill(password);
    await p.getByRole('button', { name: 'Sign in and sync' }).click();
  };
  const sessionTitle = async (p) => (await p.locator('.row', { hasText: /while the coffee brews/ }).locator('.title').textContent())?.trim();

  // Phone: taps before signing in
  const phone = await device('phone');
  check('banner when not signed in', await phone.p.locator('.browser-warn').getByText(/Sign in to sync/).isVisible());
  await plus(phone.p, 'Water').click(); await wait(500); await plus(phone.p, 'Water').click(); await wait(500); await plus(phone.p, 'Coffee').click();
  const phoneSession = await sessionTitle(phone.p);
  await signIn(phone.p, 'wrong');
  await phone.p.getByText('Email or password is wrong.').waitFor();
  check('wrong password shows a plain message', true);
  await phone.p.getByLabel('Password').fill(USER.password);
  await phone.p.getByRole('button', { name: 'Sign in and sync' }).click();
  await phone.p.getByText('Signed in').waitFor();
  await wait(800);
  check('phone taps uploaded', server.events.filter((e) => e.type === 'water').length === 2 && server.events.some((e) => e.type === 'coffee'));
  await phone.p.getByRole('button', { name: 'Back' }).click();
  const sl = phone.p.locator('.syncline');
  await sl.filter({ hasText: /Synced/ }).waitFor({ timeout: 6000 }).catch(() => {});
  check('header shows synced', /Synced/.test(await sl.textContent()), await sl.textContent());
  await phone.p.getByRole('button', { name: 'Settings', exact: true }).click();
  check('pending is 0 after sign-in', (await phone.p.locator('.field', { hasText: 'Waiting to upload' }).locator('.muted').textContent()).trim() === '0');
  check('phone plan uploaded', [...server.state.keys()].some((k) => k.includes('|plan:')));
  check('theme never synced', ![...server.state.keys()].some((k) => k.includes('theme')));

  // Laptop: its own copy with a tisane, then signs in → merge both ways, cloud plan wins
  const laptop = await device('laptop');
  await plus(laptop.p, 'Tisane').click(); await wait(300);
  await signIn(laptop.p, USER.password);
  await laptop.p.getByText('Signed in').waitFor();
  await wait(800);
  await laptop.p.getByRole('button', { name: 'Back' }).click();
  await wait(500);
  check('laptop got phone water', (await counter(laptop.p, 'Water').textContent()).trim() === '2');
  check('laptop kept its tisane', (await counter(laptop.p, 'Tisane').textContent()).trim() === '1');
  check('laptop uses the phone\'s session pick', (await sessionTitle(laptop.p)) === phoneSession, `${await sessionTitle(laptop.p)} vs ${phoneSession}`);
  check('no banner once signed in', (await laptop.p.locator('.browser-warn').count()) === 0);

  // Laptop undoes one water → reaches the phone (undo by uid across devices)
  await laptop.p.getByRole('button', { name: 'Remove one water' }).click();
  await wait(4000); // debounced push
  await phone.p.getByRole('button', { name: 'Back' }).click();
  await phone.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await wait(1500);
  check('undo on laptop reaches phone', (await counter(phone.p, 'Water').textContent()).trim() === '1');
  check('phone sees laptop tisane', (await counter(phone.p, 'Tisane').textContent()).trim() === '1');

  // Offline on the phone: tap saves locally, uploads when back online
  await phone.ctx.setOffline(true); phone.dev.offline = true;
  await plus(phone.p, 'Tea').click();
  await wait(3800);
  check('offline tap kept locally', (await counter(phone.p, 'Tea').textContent()).trim() === '1');
  check('offline tap not uploaded yet', !server.events.some((e) => e.type === 'tea'));
  await phone.p.getByRole('button', { name: 'Settings', exact: true }).click();
  check('offline shows 1 waiting', (await phone.p.locator('.field', { hasText: 'Waiting to upload' }).locator('.muted').textContent()).trim() === '1');
  await phone.p.getByRole('button', { name: 'Back' }).click();
  await phone.ctx.setOffline(false); phone.dev.offline = false;
  await phone.p.evaluate(() => dispatchEvent(new Event('online')));
  await wait(1500);
  check('uploads when back online', server.events.some((e) => e.type === 'tea'));
  check('no duplicates on the server', new Set(server.events.map((e) => e.id)).size === server.events.length);

  console.log(JSON.stringify({ serverEvents: server.events.length, stateKinds: [...server.state.keys()].map((k) => k.split('|')[1]), checks }, null, 2));
  await browser.close();
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
