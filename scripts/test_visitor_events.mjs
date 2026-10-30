import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const usageSource = await fs.readFile(new URL('../public/assets/js/usage-events.js', import.meta.url), 'utf8');
const visitorSource = await fs.readFile(new URL('../public/assets/js/visitor-events.js', import.meta.url), 'utf8');
const KEY = 'matchcamera.visitor';
const TTL = 30 * 24 * 60 * 60 * 1000;
const initialNow = Date.parse('2026-10-30T10:00:00Z');

function harness() {
  const stored = new Map();
  const fetches = [];
  let now = initialNow;
  let randomCalls = 0;
  const context = vm.createContext({
    navigator: {}, window: {},
    Date: class extends Date { static now() { return now; } },
    localStorage: {
      getItem(key) { return stored.get(key) ?? null; },
      setItem(key, value) { stored.set(key, value); },
      removeItem(key) { stored.delete(key); },
    },
    crypto: { getRandomValues(bytes) { randomCalls++; bytes.fill(randomCalls); return bytes; } },
    fetch: async (...args) => { fetches.push(args); return { ok: true }; },
  });
  vm.runInContext(usageSource.replace(/export /g, ''), context);
  vm.runInContext(visitorSource.replace(/^import .*;\r?\n/m, '').replace(/export /g, ''), context);
  return {
    context, stored, fetches,
    visit: (surface) => { context.testSurface = surface; return vm.runInContext('trackVisit(testSurface)', context); },
    setNow: (value) => { now = value; },
    get randomCalls() { return randomCalls; },
  };
}

const h = harness();
assert.equal(await h.visit('programs'), true);
const record = JSON.parse(h.stored.get(KEY));
assert.match(record.id, /^[a-f0-9]{32}$/);
assert.equal(record.createdAt, initialNow);
assert.equal(h.randomCalls, 1);
const [url, options] = h.fetches[0];
assert.equal(url, '/api/visits');
assert.deepEqual(JSON.parse(options.body), { visitorId: record.id, surface: 'programs' });
assert.equal(options.method, 'POST');
assert.equal(options.credentials, 'omit');
assert.equal(options.referrerPolicy, 'no-referrer');
assert.equal(options.mode, 'cors');
assert.equal(options.redirect, 'error');
assert.equal(options.keepalive, true);
assert.deepEqual(Object.keys(options.headers), ['Content-Type']);
assert(!JSON.stringify(options).includes('cookie'));

for (const surface of ['home', 'body', 'lens', 'database', 'accessories', 'compare', 'builder', 'resize', 'filename', 'metadata', 'rating', 'carousel', 'exposure', 'shutter', 'care', 'betatest', 'contact', 'trust', 'privacy', 'terms']) {
  assert.equal(await h.visit(surface), true);
  assert.deepEqual(JSON.parse(h.fetches.at(-1)[1].body), { visitorId: record.id, surface });
}
assert.equal(h.randomCalls, 1, 'public pages in the same browser reuse one identifier');
h.setNow(initialNow + TTL - 1);
assert.equal(await h.visit('resize'), true);
assert.deepEqual(JSON.parse(h.stored.get(KEY)), record, 'expiry must not slide after each page view');
h.setNow(initialNow + TTL);
assert.equal(await h.visit('home'), true);
const replacement = JSON.parse(h.stored.get(KEY));
assert.notEqual(replacement.id, record.id);
assert.equal(replacement.createdAt, initialNow + TTL);
assert.equal(h.randomCalls, 2);

for (const value of [null, '', '/home/', 'admin', 'private-photo.jpg', {}, 3]) {
  const rejected = harness();
  assert.equal(await rejected.visit(value), false);
  assert.equal(rejected.fetches.length, 0);
  assert.equal(rejected.stored.size, 0, 'invalid labels must not create identifiers');
}

for (const choice of ['1', 'true']) {
  const opted = harness();
  opted.stored.set('matchcamera.metricsOptOut', choice);
  assert.equal(await opted.visit('home'), false);
  assert.equal(opted.stored.has(KEY), false);
  assert.equal(opted.fetches.length, 0);
}
for (const [object, key, value] of [['navigator', 'doNotTrack', '1'], ['navigator', 'globalPrivacyControl', true], ['window', 'doNotTrack', '1']]) {
  const opted = harness();
  opted.context[object][key] = value;
  assert.equal(await opted.visit('home'), false);
  assert.equal(opted.stored.has(KEY), false);
  assert.equal(opted.fetches.length, 0);
}

for (const raw of ['not json', 'null', '{}', JSON.stringify({ id: 'bad', createdAt: initialNow }), JSON.stringify({ id: 'a'.repeat(32), createdAt: initialNow + 1 })]) {
  const invalid = harness();
  invalid.stored.set(KEY, raw);
  assert.equal(await invalid.visit('home'), true);
  assert.equal(invalid.randomCalls, 1, 'malformed or future records must be replaced');
}

const blockedRead = harness();
blockedRead.context.localStorage.getItem = () => { throw new Error('blocked'); };
assert.equal(await blockedRead.visit('home'), false);
assert.equal(blockedRead.fetches.length, 0);
const blockedWrite = harness();
blockedWrite.context.localStorage.setItem = () => { throw new Error('blocked'); };
assert.equal(await blockedWrite.visit('home'), false);
assert.equal(blockedWrite.fetches.length, 0);
const ignoredWrite = harness();
ignoredWrite.context.localStorage.setItem = () => {};
assert.equal(await ignoredWrite.visit('home'), false, 'do not count a fresh identifier if it cannot be retained');
assert.equal(ignoredWrite.fetches.length, 0);
const absentStorage = harness();
delete absentStorage.context.localStorage;
assert.equal(await absentStorage.visit('home'), false);
assert.equal(absentStorage.fetches.length, 0);
const absentCrypto = harness();
delete absentCrypto.context.crypto;
assert.equal(await absentCrypto.visit('home'), false);
assert.equal(absentCrypto.fetches.length, 0);

const race = harness();
const winner = { id: 'f'.repeat(32), createdAt: initialNow };
race.context.localStorage.setItem = (key) => race.stored.set(key, JSON.stringify(winner));
assert.equal(await race.visit('home'), true);
assert.equal(JSON.parse(race.fetches[0][1].body).visitorId, winner.id, 're-read the stored value when another tab wins');

const network = harness();
network.context.fetch = async () => { throw new Error('offline'); };
assert.equal(await network.visit('home'), false);
network.context.fetch = async () => ({ ok: false });
assert.equal(await network.visit('home'), false);
vm.runInContext('forgetVisitor()', network.context);
assert.equal(network.stored.has(KEY), false);
network.context.localStorage.removeItem = () => { throw new Error('blocked'); };
assert.doesNotThrow(() => vm.runInContext('forgetVisitor()', network.context));

console.log('Visitor events: random browser IDs, fixed expiry, narrow payload, privacy choices, storage and network failure isolation passed.');
