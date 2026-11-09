// In-memory stand-in for the parts of Supabase Brew uses (auth password grant + PostgREST),
// behaving like Postgres where it matters:
//  - every row of one events POST shares created_at (now() is the transaction time)
//  - events GET supports the (created_at, id) keyset `or` filter and two-column ordering
//  - put_state(kind, body, client_at) RPC: insert, or update only if client_at is newer; server stamps updated_at = now()
//  - legacy mode (opts.legacy): no put_state, no client_at column — plain upsert storing the client's updated_at
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'mdf@example.com', password: 'correct horse' };

function makeServer(opts = {}) {
  const server = { events: [], state: new Map(), clock: Date.now(), log: [], legacy: !!opts.legacy, down: false };
  const tick = () => new Date(++server.clock).toISOString();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) });
  const authUser = { id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
  const token = () => ({ access_token: 'tok-' + USER.id, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh', user: authUser });
  const userOf = (req) => ((req.headers()['authorization'] || '') === 'Bearer tok-' + USER.id ? USER : null);
  const param = (u, col) => { const v = u.searchParams.get(col); return v && v.startsWith('gt.') ? v.slice(3) : null; };

  async function handle(route) {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (server.down) return route.abort('connectionrefused');
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}');
      if (u.searchParams.get('grant_type') === 'refresh_token') return json(route, 200, token());
      if (b.email !== USER.email || b.password !== USER.password) return json(route, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(route, 200, token());
    }
    if (u.pathname === '/auth/v1/user') return userOf(req) ? json(route, 200, authUser) : json(route, 401, { msg: 'no' });
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: cors });
    const who = userOf(req);
    if (!who) return json(route, 401, { message: 'JWT required' });

    if (u.pathname === '/rest/v1/events' && m === 'POST') {
      const at = tick(); // one transaction → one created_at
      for (const r of JSON.parse(req.postData())) if (!server.events.some((e) => e.id === r.id)) server.events.push({ ...r, user_id: who.id, created_at: at });
      server.log.push(['events-post']);
      return json(route, 201);
    }
    if (u.pathname === '/rest/v1/events' && m === 'GET') {
      server.log.push(['events-get', u.search]);
      let rows = server.events.filter((e) => e.user_id === who.id);
      const or = u.searchParams.get('or');
      if (or) {
        const mm = /created_at\.gt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.gt\.([^)]+)\)/.exec(or);
        if (!mm) return json(route, 400, { message: 'bad or: ' + or });
        rows = rows.filter((e) => e.created_at > mm[1] || (e.created_at === mm[2] && e.id > mm[3]));
      } else {
        const since = param(u, 'created_at');
        if (since) rows = rows.filter((e) => e.created_at > since);
      }
      rows.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      return json(route, 200, rows.slice(0, Number(u.searchParams.get('limit') || 1000)));
    }
    if (u.pathname === '/rest/v1/rpc/put_state' && m === 'POST') {
      if (server.legacy) return json(route, 404, { code: 'PGRST202', message: 'Could not find the function public.put_state' });
      const b = JSON.parse(req.postData());
      const key = who.id + '|' + b.p_kind;
      const cur = server.state.get(key);
      let wrote = false;
      if (!cur || !cur.client_at || cur.client_at < b.p_client_at) {
        server.state.set(key, { user_id: who.id, kind: b.p_kind, body: b.p_body, client_at: b.p_client_at, updated_at: tick() });
        wrote = true;
      }
      server.log.push(['put_state', b.p_kind, b.p_client_at, wrote]);
      return json(route, 200, wrote);
    }
    if (u.pathname === '/rest/v1/state' && m === 'POST') {
      for (const r of JSON.parse(req.postData())) server.state.set(who.id + '|' + r.kind, { ...r, user_id: who.id });
      server.log.push(['state-post']);
      return json(route, 201);
    }
    if (u.pathname === '/rest/v1/state' && m === 'GET') {
      const select = u.searchParams.get('select') || '';
      if (server.legacy && select.includes('client_at')) return json(route, 400, { code: '42703', message: 'column state.client_at does not exist' });
      const since = param(u, 'updated_at') || '';
      return json(route, 200, [...server.state.values()].filter((r) => r.user_id === who.id && r.updated_at > since)
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .map(({ kind, body, updated_at, client_at }) => (select.includes('client_at') ? { kind, body, updated_at, client_at } : { kind, body, updated_at })));
    }
    return json(route, 404, { message: 'not faked: ' + m + ' ' + u.pathname });
  }
  return { server, handle, USER };
}

module.exports = { makeServer, USER, SUPA: 'https://dhetwzklyujcaiehdijo.supabase.co' };
