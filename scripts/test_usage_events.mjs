import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { handleUsage } from '../worker/usage-events.js';
import worker from '../worker/index.js';

const writes = [];
const env = { USAGE_ANALYTICS: { writeDataPoint(point) { writes.push(point); } } };
const valid = { event: 'tool_success', surface: 'resize' };
const request = (body = valid, options = {}) => new Request(options.url || 'https://matchcamera.com/api/usage', {
  method: options.method || 'POST',
  headers: { Origin: 'https://matchcamera.com', 'Content-Type': 'application/json', ...options.headers },
  ...((options.method || 'POST') === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});

assert.equal((await handleUsage(request(), env)).status, 202);
assert.deepEqual(writes.pop(), { blobs: ['v1', 'tool_success', 'resize'], doubles: [1], indexes: ['resize'] });
assert.equal((await worker.fetch(request(), env)).status, 202, 'actual Worker routes usage requests before static assets');
assert.equal(writes.length, 1);
writes.length = 0;
for (const event of ['tool_copy', 'tool_cancelled']) {
  assert.equal((await handleUsage(request({ event, surface: 'metadata' }), env)).status, 202);
  assert.equal(writes.pop().blobs[1], event);
}
for (const surface of ['carousel', 'exposure']) {
  for (const event of ['page_view', 'tool_start', 'tool_success', 'tool_failure', ...(surface === 'carousel' ? ['tool_download'] : [])]) {
    assert.equal((await handleUsage(request({ event, surface }), env)).status, 202);
    assert.deepEqual(writes.pop(), { blobs: ['v1', event, surface], doubles: [1], indexes: [surface] });
  }
}
assert.equal((await handleUsage(request(valid, { method: 'GET' }), env)).status, 405);
assert.equal((await handleUsage(request(valid, { method: 'OPTIONS' }), env)).status, 405);
assert.equal((await handleUsage(request(valid, { headers: { Origin: '' } }), env)).status, 403);
for (const origin of ['null', 'https://evil.test', 'https://www.matchcamera.com']) {
  assert.equal((await handleUsage(request(valid, { headers: { Origin: origin } }), env)).status, 403);
}
assert.equal((await handleUsage(request(valid, { url: 'https://evil.test/api/usage', headers: { Origin: 'https://evil.test' } }), env)).status, 403);
assert.equal((await handleUsage(request(valid, { url: 'http://localhost:8787/api/usage', headers: { Origin: 'http://localhost:8787' } }), env)).status, 202);
writes.length = 0;
assert.equal((await handleUsage(request(valid, { headers: { 'Content-Type': 'text/plain' } }), env)).status, 415);
assert.equal((await handleUsage(request('x'.repeat(257)), env)).status, 413, 'the actual body is capped without trusting Content-Length');
assert.equal((await handleUsage(request(valid, { headers: { 'Content-Length': '5000000' } }), env)).status, 413);
for (const payload of [
  null, [], 'broken JSON', { ...valid, filename: 'private.jpg' }, { ...valid, exif: 'GPS' },
  { ...valid, url: 'https://matchcamera.com/?q=private' }, { ...valid, userId: 'visitor' },
  { event: valid.event }, { ...valid, event: 'private.jpg' }, { ...valid, surface: '/program/resize/?q=private' },
  { ...valid, event: ['tool_success'] }, { ...valid, surface: { name: 'resize' } },
  { event: 'tool_success', surface: 'carousel', filename: 'private.jpg' },
  { event: 'tool_success', surface: 'carousel', settings: { watermark: 'private', position: .5 } },
  { event: 'tool_success', surface: 'exposure', input: { iso: 400, aperture: 2.8 } },
  { event: 'tool_success', surface: 'exposure', result: 8 },
]) {
  assert.equal((await handleUsage(request(payload), env)).status, 400, `reject non-schema data: ${JSON.stringify(payload)}`);
}
assert.equal(writes.length, 0, 'invalid payloads must not become analytics rows');
for (const header of ['DNT', 'Sec-GPC']) {
  assert.equal((await handleUsage(request(valid, { headers: { [header]: '1' } }), env)).status, 204);
}
assert.equal(writes.length, 0, 'server-side privacy signals suppress data');
assert.equal((await handleUsage(request(), {})).status, 503, 'unconfigured storage must not report success');
assert.equal((await handleUsage(request(), { USAGE_ANALYTICS: { writeDataPoint() { throw new Error('private diagnostics'); } } })).status, 503);
for (let i = 0; i < 180; i++) {
  assert.equal((await handleUsage(request(valid, { headers: { 'CF-Connecting-IP': '198.51.100.88' } }), env)).status, 202);
}
const limited = await handleUsage(request(valid, { headers: { 'CF-Connecting-IP': '198.51.100.88' } }), env);
assert.equal(limited.status, 429);
assert.equal(limited.headers.get('Retry-After'), '60');
assert(!JSON.stringify(writes).includes('198.51.100.88'), 'IP must never be stored in the analytics dataset');
assert(writes.every(point => Object.keys(point).sort().join(',') === 'blobs,doubles,indexes'));

const browserSource = await fs.readFile(new URL('../public/assets/js/usage-events.js', import.meta.url), 'utf8');
const fetches = [];
let optOut = null;
const context = vm.createContext({
  navigator: {}, window: {},
  localStorage: { getItem(key) { assert.equal(key, 'matchcamera.metricsOptOut'); return optOut; } },
  fetch: async (...args) => { fetches.push(args); return { ok: true }; },
});
vm.runInContext(browserSource.replace(/export /g, ''), context);
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), true);
assert.equal(fetches.length, 1);
const [endpoint, options] = fetches.pop();
assert.equal(endpoint, '/api/usage');
assert.deepEqual(JSON.parse(options.body), valid);
assert.equal(options.credentials, 'omit');
assert.equal(options.referrerPolicy, 'no-referrer');
assert.equal(options.mode, 'cors', 'no-referrer POST needs cors mode to preserve its Origin header');
assert.equal(options.redirect, 'error');
assert.equal(options.keepalive, true);
assert.deepEqual(Object.keys(options.headers), ['Content-Type']);
for (const surface of ['carousel', 'exposure']) {
  context.newSurface = surface;
  assert.equal(await vm.runInContext("trackUsage('tool_success', newSurface)", context), true);
  const [target, sent] = fetches.pop();
  assert.equal(target, '/api/usage');
  assert.deepEqual(JSON.parse(sent.body), { event: 'tool_success', surface });
  assert.equal(sent.referrerPolicy, 'no-referrer');
}
for (const choice of ['1', 'true']) {
  optOut = choice;
  assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);
}
optOut = null;
context.navigator.doNotTrack = '1';
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);
delete context.navigator.doNotTrack;
context.navigator.globalPrivacyControl = true;
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);
delete context.navigator.globalPrivacyControl;
context.window.doNotTrack = '1';
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);
delete context.window.doNotTrack;
for (const [event, surface] of [['private.jpg', 'resize'], ['tool_success', '/private'], [null, 'resize']]) {
  context.testArgs = [event, surface];
  assert.equal(await vm.runInContext('trackUsage(...testArgs)', context), false);
}
assert.equal(fetches.length, 0, 'invalid labels and privacy choices must prevent any request');
context.localStorage.getItem = () => { throw new Error('storage blocked'); };
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);
context.localStorage.getItem = () => null;
context.fetch = async () => { throw new Error('offline'); };
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);
context.fetch = async () => ({ ok: false });
assert.equal(await vm.runInContext("trackUsage('tool_success', 'resize')", context), false);

const config = JSON.parse(await fs.readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
assert.deepEqual(config.analytics_engine_datasets, [{ binding: 'USAGE_ANALYTICS', dataset: 'matchcamera_usage_v1' }]);
console.log('Usage events: narrow dataset, origins, size, privacy controls, burst limit and browser failure isolation passed.');
