// Two-device sync test against an in-memory stand-in for Supabase (auth + PostgREST), shared by both browsers.
// Usage: node scripts/sync-test.cjs http://localhost:4173/
const { chromium, devices } = require('playwright');
const base = process.argv[2] || 'http://localhost:4173/';
const SUPA = 'https://dhetwzklyujcaiehdijo.supabase.co';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'mdf@example.com', password: 'correct horse' };

// ---- fake server ----
const server = { events: [], state: new Map(), clock: Date.now() };
const nowIso = () => new Date(++server.clock).toISOString();
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
const userOf = (req) => ((req.headers()['authorization'] || '') === 'Bearer tok-' + USER.id ? USER : null);
const gt = (u, col) => { const v = u.searchParams.get(col); return v && v.startsWith('gt.') ? v.slice(3) : null; };
const authUser = { id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };

async function handle(route) {
  const req = route.request(); const u = new URL(req.url()); const m = req.method();
  if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (u.pathname === '/auth/v1/token') {
    const b = JSON.parse(req.postData() || '{}');
    if (b.email !== USER.email || b.password !== USER.password) return json(route, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    return json(route, 200, { access_token: 'tok-' + USER.id, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'refresh', user: authUser });
  }
  if (u.pathname === '/auth/v1/user') return userOf(req) ? json(route, 200, authUser) : json(route, 401, { msg: 'no' });
  if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
  const who = userOf(req);
  if (!who) return json(route, 401, { message: 'JWT required' });
  if (u.pathname === '/rest/v1/events' && m === 'POST') {
    for (const r of JSON.parse(req.postData())) if (!server.events.some((e) => e.id === r.id)) server.events.push({ ...r, user_id: who.id, created_at: nowIso() });
    return json(route, 201);
  }
  if (u.pathname === '/rest/v1/events' && m === 'GET') {
    const since = gt(u, 'created_at') || '';
    return json(route, 200, server.events.filter((e) => e.user_id === who.id && e.created_at > since).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, Number(u.searchParams.get('limit') || 1000)));
  }
  if (u.pathname === '/rest/v1/state' && m === 'POST') {
    for (const r of JSON.parse(req.postData())) server.state.set(who.id + '|' + r.kind, { ...r, user_id: who.id });
    return json(route, 201);
  }
  if (u.pathname === '/rest/v1/state' && m === 'GET') {
    const since = gt(u, 'updated_at') || '';
    return json(route, 200, [...server.state.values()].filter((r) => r.user_id === who.id && r.updated_at > since).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map(({ kind, body, updated_at }) => ({ kind, body, updated_at })));
  }
  return json(route, 404, { message: 'not faked: ' + m + ' ' + u.pathname });
}

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
  check('banner when not signed in', await phone.p.getByText('Not syncing yet.').or(phone.p.getByText("You're in a browser")).first().isVisible());
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
  check('pending is 0 after sign-in', (await phone.p.locator('.field', { hasText: 'Waiting to upload' }).locator('.muted').textContent()).trim() === '0');
  check('phone plan uploaded', [...server.state.keys()].some((k) => k.includes('|plan:')));

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
