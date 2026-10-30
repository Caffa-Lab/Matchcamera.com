import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import { VisitorStats, handleVisit, readVisitorStats } from '../worker/visitor-stats.js';
import worker from '../worker/index.js';

// Run every SQL statement against SQLite, rather than teaching a mock the result
// the implementation is expected to return.
function makeStore() {
  const database = new DatabaseSync(':memory:');
  let alarmAt = null;
  const ctx = { storage: {
    sql: { exec(query, ...values) { return database.prepare(query).all(...values); } },
    transactionSync(callback) {
      database.exec('BEGIN IMMEDIATE');
      try { const value = callback(); database.exec('COMMIT'); return value; }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    async getAlarm() { return alarmAt; },
    async setAlarm(value) { alarmAt = value; },
  } };
  const object = new VisitorStats(ctx);
  const forwarded = [];
  const binding = {
    idFromName(name) { assert.equal(name, 'matchcamera-visitors-v1'); return name; },
    get(name) {
      assert.equal(name, 'matchcamera-visitors-v1');
      return { async fetch(request) {
        forwarded.push({ url: request.url, headers: [...request.headers], body: request.method === 'POST' ? await request.clone().text() : null });
        return object.fetch(request);
      } };
    },
  };
  return { database, object, binding, forwarded, get alarmAt() { return alarmAt; }, clearAlarm() { alarmAt = null; } };
}

const originalNow = Date.now;
const originalFetch = globalThis.fetch;
let clock = Date.parse('2026-10-01T14:59:59.000Z');
Date.now = () => clock;
const a = 'a'.repeat(32), b = 'b'.repeat(32), c = 'c'.repeat(32);
const request = (body = { visitorId: a, surface: 'programs' }, options = {}) => new Request(options.url || 'https://matchcamera.com/api/visits', {
  method: options.method || 'POST',
  headers: { Origin: 'https://matchcamera.com', 'Content-Type': 'application/json', ...options.headers },
  ...((options.method || 'POST') === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const store = makeStore();
const env = { VISITOR_STATS: store.binding };
const total = (visitors, pageViews) => ({ visitors, pageViews });

try {
  const empty = await readVisitorStats(env);
  assert.equal(empty.status, 'ready');
  assert.equal(empty.collectedSince, null);
  assert.equal(empty.updatedAt, null);
  assert.deepEqual(empty.daily, [], 'dates before collection are not invented as zero-traffic history');
  assert.deepEqual(empty.today, total(0, 0));
  assert.equal(empty.windows.last30Days.observedDays, 0);
  assert.equal(empty.windows.last30Days.complete, false);
  assert.equal(store.alarmAt, null, 'an unused object should not schedule perpetual alarms');

  let response = await worker.fetch(request(), env);
  assert.equal(response.status, 202, 'public Worker must route to the visitor collector');
  assert.equal(await response.text(), '', 'public collection never returns counts or identifiers');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const firstAlarm = store.alarmAt;
  assert.equal(firstAlarm, Date.parse('2026-10-01T15:01:00Z'), 'cleanup alarm uses the next KST day boundary');
  assert.equal((await handleVisit(request(), env)).status, 202);
  assert.equal(store.alarmAt, firstAlarm, 'visits must not defer an already scheduled cleanup');
  let stats = await readVisitorStats(env);
  assert.deepEqual(stats.today, total(1, 2), 'repeat views count once as a visitor');
  assert.equal(stats.collectedSince, '2026-10-01T14:59:59.000Z');
  assert.deepEqual(stats.daily, [{ date: '2026-10-01', visitors: 1, pageViews: 2 }]);

  clock = Date.parse('2026-10-01T15:00:00.000Z');
  await handleVisit(request(), env);
  await handleVisit(request({ visitorId: b, surface: 'body' }), env);
  stats = await readVisitorStats(env);
  assert.deepEqual(stats.today, total(2, 2));
  assert.deepEqual(stats.last7Days, total(2, 4), 'multi-day visitor total is COUNT DISTINCT, not a sum of daily visitors');
  assert.equal(stats.windows.last7Days.startDate, '2026-09-26');
  assert.equal(stats.windows.last7Days.endDate, '2026-10-02');
  assert.equal(stats.windows.last7Days.observedDays, 2);
  assert.equal(stats.windows.last7Days.complete, false);

  clock = Date.parse('2026-10-07T15:00:00.000Z'); // KST October 8, midnight
  await handleVisit(request({ visitorId: c, surface: 'shutter' }), env);
  stats = await readVisitorStats(env);
  assert.deepEqual(stats.today, total(1, 1));
  assert.deepEqual(stats.last7Days, total(3, 3));
  assert.deepEqual(stats.last30Days, total(3, 5));
  assert.equal(stats.daily.length, 8);
  assert.deepEqual(stats.daily[2], { date: '2026-10-03', visitors: 0, pageViews: 0 }, 'observed empty days should remain visible in the chart');
  assert.equal(stats.windows.last7Days.complete, true);
  assert.equal(stats.windows.last30Days.observedDays, 8);
  assert.equal(stats.updatedAt, '2026-10-07T15:00:00.000Z');

  const rawRows = store.database.prepare('SELECT * FROM visitor_days ORDER BY day, visitor_hash').all();
  assert(rawRows.every(row => /^[a-f0-9]{64}$/.test(row.visitor_hash)));
  assert.deepEqual(Object.keys(rawRows[0]).sort(), ['day', 'page_views', 'visitor_hash']);
  assert(!JSON.stringify(rawRows).includes(a));
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a))).toString('hex');
  assert.equal(rawRows[0].visitor_hash, hash);
  assert(!JSON.stringify(store.forwarded).includes(a), 'raw IDs never cross the Durable Object bridge');
  assert(store.forwarded.every(call => !call.headers.some(([name]) => ['cf-connecting-ip', 'user-agent', 'referer', 'cookie'].includes(name))));

  clock = Date.parse('2026-10-30T15:00:00.000Z'); // KST October 31: retain October 2 onward
  stats = await readVisitorStats(env);
  assert.deepEqual(stats.last30Days, total(3, 3));
  assert.equal(stats.daily.length, 30);
  assert.equal(stats.daily[0].date, '2026-10-02');
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM visitor_days WHERE day < ?').get('2026-10-02').count, 0, 'old visitor hashes are deleted, not only filtered from summaries');
  assert.equal(stats.windows.last30Days.complete, true);
  store.clearAlarm();
  await store.object.alarm();
  assert.equal(store.alarmAt, Date.parse('2026-10-31T15:01:00.000Z'), 'cleanup continues daily while unexpired identifiers remain');

  clock = Date.parse('2026-11-08T15:02:00.000Z');
  store.clearAlarm(); // alarms are removed by the runtime before invoking alarm()
  await store.object.alarm();
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM visitor_days').get().count, 0, 'scheduled cleanup expires identifiers even without visits');
  assert.equal(store.alarmAt, null, 'stop daily alarms once no identifiers remain');
  assert.equal((await readVisitorStats(env)).collectedSince, '2026-10-01T14:59:59.000Z', 'collection start is metadata, independent from identifier retention');
  assert.equal(store.alarmAt, null, 'reading old aggregate metadata must not restart alarms after all identifiers expire');

  const writesBefore = store.forwarded.filter(call => call.body).length;
  for (const header of ['DNT', 'Sec-GPC']) {
    assert.equal((await handleVisit(request(undefined, { headers: { [header]: '1' } }), env)).status, 204);
  }
  assert.equal(store.forwarded.filter(call => call.body).length, writesBefore);
  assert.equal((await handleVisit(request(undefined, { method: 'GET' }), env)).status, 405);
  assert.equal((await handleVisit(request(undefined, { method: 'OPTIONS' }), env)).status, 405);
  for (const origin of ['', 'null', 'https://evil.test', 'https://www.matchcamera.com']) {
    assert.equal((await handleVisit(request(undefined, { headers: { Origin: origin } }), env)).status, 403);
  }
  assert.equal((await handleVisit(request(undefined, { url: 'https://evil.test/api/visits', headers: { Origin: 'https://evil.test' } }), env)).status, 403);
  assert.equal((await handleVisit(request(undefined, { headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
  assert.equal((await handleVisit(request('x'.repeat(257)), env)).status, 413);
  assert.equal((await handleVisit(request(undefined, { headers: { 'Content-Length': '257' } }), env)).status, 413);
  for (const payload of [null, [], 'invalid JSON', {}, { visitorId: a }, { visitorId: 'A'.repeat(32), surface: 'home' }, { visitorId: 'a'.repeat(31), surface: 'home' }, { visitorId: a, surface: '/?q=private' }, { visitorId: a, surface: ['home'] }, { visitorId: a, surface: 'home', filename: 'private.jpg' }, { visitorId: a, surface: 'home', url: '/private' }]) {
    assert.equal((await handleVisit(request(payload), env)).status, 400, `reject non-schema payload: ${JSON.stringify(payload)}`);
  }
  assert.equal((await handleVisit(request(undefined, { url: 'http://localhost:8787/api/visits', headers: { Origin: 'http://localhost:8787' } }), env)).status, 202);
  for (const surface of ['programs', 'care', 'betatest', 'privacy', 'terms']) {
    assert.equal((await handleVisit(request({ visitorId: a, surface }), env)).status, 202);
  }
  assert.equal((await handleVisit(request(), {})).status, 503);
  assert.deepEqual(await readVisitorStats({}), { ok: true, status: 'unavailable', reason: 'not_configured', timeZone: 'Asia/Seoul' });
  const brokenEnv = { VISITOR_STATS: { idFromName() { return 'x'; }, get() { return { fetch() { throw new Error('private token or network diagnostics'); } }; } } };
  assert.equal((await handleVisit(request(), brokenEnv)).status, 503);
  assert.equal((await readVisitorStats(brokenEnv)).status, 'error');
  assert(!JSON.stringify(await readVisitorStats(brokenEnv)).includes('private'));
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => { assert.equal(delay, 5_000); return originalSetTimeout(callback, 1); };
  try {
    const stalledEnv = { VISITOR_STATS: { idFromName() { return 'x'; }, get() { return { fetch() { return new Promise(() => {}); } }; } } };
    assert.equal((await readVisitorStats(stalledEnv)).status, 'error', 'a stalled upstream must have a bounded wait');
  } finally { globalThis.setTimeout = originalSetTimeout; }

  for (let i = 0; i < 180; i++) {
    assert.equal((await handleVisit(request(undefined, { headers: { 'CF-Connecting-IP': '198.51.100.125' } }), env)).status, 202);
  }
  response = await handleVisit(request(undefined, { headers: { 'CF-Connecting-IP': '198.51.100.125' } }), env);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert(!JSON.stringify(store.forwarded).includes('198.51.100.125'));
  clock += 60_000;
  assert.equal((await handleVisit(request(undefined, { headers: { 'CF-Connecting-IP': '198.51.100.125' } }), env)).status, 202);

  response = await worker.fetch(new Request('https://matchcamera.com/admin/api/visitors'), env);
  assert.equal(response.status, 401, 'visitor statistics remain behind existing Cloudflare Access authentication');
  response = await worker.fetch(new Request('https://matchcamera.com/admin/api/visitors'), { ...env, ADMIN_DEV_BYPASS: 'true' });
  assert.equal(response.status, 401, 'localhost bypass must never authorize the production domain');
  response = await worker.fetch(new Request('http://localhost/admin/api/visitors'), { ...env, ADMIN_DEV_BYPASS: 'true' });
  assert.equal(response.status, 200);
  assert((await response.json()).today.visitors > 0);
  assert(response.headers.get('Cache-Control').includes('no-store'));
  assert(response.headers.get('Content-Security-Policy').includes("connect-src 'self'"));
  response = await worker.fetch(new Request('http://localhost/admin/api/visitors'), { ADMIN_DEV_BYPASS: 'true' });
  assert.equal((await response.json()).status, 'unavailable', 'unconfigured storage must never masquerade as zero visitors');

  // Exercise the production authenticated route, including signature verification.
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  publicJwk.kid = 'visitor-test-key';
  const base64url = value => Buffer.from(value).toString('base64url');
  const team = 'visitor-stats-test.cloudflareaccess.com';
  const jwtHeader = base64url(JSON.stringify({ alg: 'RS256', kid: publicJwk.kid }));
  const jwtBody = base64url(JSON.stringify({ iss: `https://${team}`, aud: 'visitor-admin', exp: Math.floor(clock / 1000) + 300, email: 'test-admin@example.com', sub: 'test-admin' }));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${jwtHeader}.${jwtBody}`));
  const jwt = `${jwtHeader}.${jwtBody}.${base64url(signature)}`;
  globalThis.fetch = async (url, init) => String(url) === `https://${team}/cdn-cgi/access/certs` ? Response.json({ keys: [publicJwk] }) : originalFetch(url, init);
  response = await worker.fetch(new Request('https://matchcamera.com/admin/api/visitors', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }), { ...env, CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: 'visitor-admin' });
  assert.equal(response.status, 200);
  const authenticated = await response.json();
  assert.equal(authenticated.status, 'ready');
  assert(!JSON.stringify(authenticated).includes('visitor_hash'), 'admin summary exposes aggregate counts only');

  const config = JSON.parse(await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.deepEqual(config.durable_objects.bindings, [{ name: 'VISITOR_STATS', class_name: 'VisitorStats' }]);
  assert(config.migrations.some(migration => migration.new_sqlite_classes?.includes('VisitorStats')));
  assert.equal((await store.object.fetch(new Request('https://visitor-stats.internal/summary', { method: 'POST' }))).status, 404);
  assert.equal((await store.object.fetch(new Request('https://visitor-stats.internal/record', { method: 'POST', body: JSON.stringify({ visitorHash: a }) }))).status, 400);
  console.log('Visitor statistics: real SQLite deduplication, KST windows, retention, hashed IDs, privacy controls, bounded collector, authentication and unavailable states passed.');
} finally {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  store.database.close();
}
