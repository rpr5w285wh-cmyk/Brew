// Migration test: log taps (incl. an undo) with the previous build, then open the new build in the same browser profile.
// Usage: node scripts/migration.cjs <oldDistDir> <newDistDir>
const { chromium, devices } = require('playwright');
const { spawn } = require('child_process');
const serve = (dir) => { const c = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', '4174', '--strictPort'], { stdio: 'ignore', detached: true }); return { kill: () => { try { process.kill(-c.pid); } catch {} } }; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = (p) => p.evaluate(async () => {
  const req = indexedDB.open('brew'); const dbx = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  return new Promise((r) => { const q = dbx.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result); });
});
(async () => {
  const [oldDir, newDir] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'], serviceWorkers: 'block' });
  const p = await ctx.newPage();
  let srv = serve(oldDir); await wait(2500);
  await p.goto('http://localhost:4174/', { waitUntil: 'load' });
  await p.getByRole('heading', { name: 'Morning' }).waitFor();
  const plus = p.locator('.counter .pill');
  await plus.nth(0).click(); await wait(500); await plus.nth(0).click(); await wait(500);
  await p.locator('.row', { hasText: 'Teeth' }).first().locator('.rowmain').click(); await wait(300);
  await p.getByRole('button', { name: 'Undo Teeth' }).first().click(); await wait(300);
  const before = await dump(p);
  srv.kill(); await wait(800);
  srv = serve(newDir); await wait(2500);
  await p.reload({ waitUntil: 'load' });
  await p.getByRole('heading', { name: 'Morning' }).waitFor();
  const after = await dump(p);
  const waterShown = (await p.locator('.counter .count').first().textContent()).trim();
  const teethDone = await p.locator('.row.done', { hasText: 'Teeth' }).count();
  const undo = after.find((e) => e.type === 'undo');
  const target = after.find((e) => e.uid === undo?.meta?.undoOf);
  const checks = {
    sameCount: before.length === after.length,
    allHaveUids: after.every((e) => typeof e.uid === 'string'),
    undoPointsAtUid: !!target && target.type === 'habit_done',
    waterStill2: waterShown === '2',
    teethStillUndone: teethDone === 0,
  };
  console.log(JSON.stringify({ before: before.length, after: after.length, checks }, null, 2));
  srv.kill(); await browser.close();
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
