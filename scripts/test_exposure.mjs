import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as calculations from '../public/assets/js/exposure/calculations.js';

const { equivalentExposure, ndExposure, parseShutter, exposureValue, formatShutter, formatDuration, timerDuration, createTimer, advanceTimer, startTimer, pauseTimer, resetTimer, formatTimer } = calculations;
const close = (actual, expected) => assert(Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * 1e-10), `${actual} should equal ${expected}`);

for (const [input, seconds] of [['1/125', 0.008], [' 1 / 4 ', 0.25], ['0.5초', 0.5], ['30 sec', 30], ['1/60s', 1 / 60], ['.125', 0.125], [2, 2], ['1/1000000', 0.000001]]) close(parseShutter(input), seconds);
for (const input of ['', ' ', '1/0', '0/1', '-1', '1/2/3', '1,000', '1;alert(1)', 'NaN', 'Infinity', '1e309', '1/1000001', '86401', null, true, {}, Infinity]) assert.throws(() => parseShutter(input), undefined, `reject shutter ${String(input)}`);
for (const bad of [0, -1, NaN, Infinity, '100', null]) assert.throws(() => exposureValue(bad, 'iso'));
assert.throws(() => exposureValue(1, 'not-a-setting'));
assert.throws(() => exposureValue(0.09, 'aperture'));
assert.throws(() => exposureValue(257, 'aperture'));

const base = { iso: 100, aperture: 8, shutterSeconds: 1 / 125 };
close(equivalentExposure(base, { iso: 200, aperture: 8 }, 'shutterSeconds').shutterSeconds, 1 / 250);
close(equivalentExposure(base, { iso: 100, aperture: 16 }, 'shutterSeconds').shutterSeconds, 4 / 125);
close(equivalentExposure(base, { iso: 100, shutterSeconds: 4 / 125 }, 'aperture').aperture, 16);
close(equivalentExposure(base, { aperture: 8, shutterSeconds: 1 / 250 }, 'iso').iso, 200);
close(equivalentExposure(base, { iso: 400, shutterSeconds: 1 / 250 }, 'aperture').aperture, 8 * Math.SQRT2);
assert.deepEqual(base, { iso: 100, aperture: 8, shutterSeconds: 1 / 125 }, 'inputs stay unchanged');
assert.throws(() => equivalentExposure(base, { iso: 0, aperture: 8 }, 'shutterSeconds'));
assert.throws(() => equivalentExposure(null, {}, 'shutterSeconds'));
assert.throws(() => equivalentExposure(base, {}, 'invalid'));
assert.throws(() => equivalentExposure({ iso: 10240000, aperture: 0.1, shutterSeconds: 86400 }, { iso: 1, aperture: 256 }, 'shutterSeconds'));
// Independently verify image-brightness invariance across all three solved values.
for (const iso of [100, 250, 800, 3200]) {
  for (const aperture of [1.8, 4, 11, 22]) {
    const target = equivalentExposure(base, { iso, aperture }, 'shutterSeconds');
    close(target.shutterSeconds * target.iso / target.aperture ** 2, base.shutterSeconds * base.iso / base.aperture ** 2);
    close(equivalentExposure(base, { aperture, shutterSeconds: target.shutterSeconds }, 'iso').iso, iso);
    close(equivalentExposure(base, { iso, shutterSeconds: target.shutterSeconds }, 'aperture').aperture, aperture);
  }
}

close(ndExposure(1 / 125, 'stops', 3).seconds, 8 / 125);
close(ndExposure(1, 'factor', 8).stops, 3);
close(ndExposure(1, 'factor', 64).stops, 6);
close(ndExposure(1 / 125, 'stops', 10).seconds, 8.192);
close(ndExposure(1 / 125, 'factor', 1000).seconds, 8);
close(ndExposure(1, 'stops', 0).seconds, 1);
close(ndExposure(1, 'factor', 1).seconds, 1);
close(ndExposure(0.01, 'stops', 1.5).factor, 2 ** 1.5);
for (const [unit, strength] of [['stops', -1], ['stops', 21], ['stops', NaN], ['factor', 0.9], ['factor', 1048577], ['density', 1.8]]) assert.throws(() => ndExposure(1, unit, strength));
assert.throws(() => ndExposure(86400, 'stops', 1));
assert.equal(formatShutter(1 / 125), '1/125초');
assert.equal(formatShutter(8.192), '8.192초');
assert.equal(formatDuration(125.5), '2분 5.5초');
assert.equal(formatDuration(86400), '24시간');
assert.equal(formatDuration(59.9999), '1분', 'rounding carries into the next minute');

assert.equal(timerDuration(1, 2.5), 62.5);
assert.equal(timerDuration(1440, 0), 86400);
for (const pair of [[0, 0], [0, 0.5], [0.5, 0], [-1, 10], [0, 60], [1440, 1], [NaN, 1]]) assert.throws(() => timerDuration(...pair));
const initial = createTimer(30);
let timer = startTimer(initial, 1000);
assert.equal(timer.deadline, 31000);
assert.equal(initial.status, 'ready', 'timer transitions do not mutate prior states');
timer = advanceTimer(timer, 10200);
assert.equal(timer.remainingMs, 20800);
timer = pauseTimer(timer, 12250);
assert.equal(timer.status, 'paused');
assert.equal(timer.remainingMs, 18750);
assert.equal(advanceTimer(timer, 999999).remainingMs, 18750, 'paused time does not count down');
timer = startTimer(timer, 1000000);
assert.equal(timer.deadline, 1018750);
timer = advanceTimer(timer, 1018749);
assert.equal(timer.remainingMs, 1);
assert.equal(formatTimer(timer.remainingMs), '00:01', 'do not display zero before the deadline');
timer = advanceTimer(timer, 1030000);
assert.equal(timer.status, 'finished', 'a delayed callback immediately catches up with wall-clock time');
assert.equal(timer.remainingMs, 0);
assert.equal(formatTimer(0), '00:00');
assert.equal(formatTimer(3601000), '01:00:01');
assert.equal(formatTimer(86400000), '24:00:00');
assert.deepEqual(resetTimer(timer), initial);
assert.equal(startTimer(timer, 2000000).deadline, 2030000, 'restart uses the original duration');
assert.equal(pauseTimer(startTimer(createTimer(1), 0), 1001).status, 'finished', 'pause after expiration must not revive the timer');
assert.throws(() => startTimer(initial, NaN));

// Run the actual UI handlers against a small DOM boundary: all computations and
// timer state transitions above remain the real implementation.
const html = await readFile(new URL('../public/program/exposure/index.html', import.meta.url), 'utf8');
class Element {
  constructor(value = '') { this.value = value; this.handlers = {}; this.textContent = ''; this.hidden = false; this.disabled = false; this.dataset = {}; this.parentElement = { classList: { toggle() {} } }; }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  fire(name) { for (const handler of this.handlers[name] || []) handler({ preventDefault() {} }); }
  focus() {}
  scrollIntoView() {}
}
const elements = new Map();
for (const match of html.matchAll(/<[a-z][a-z0-9]*\b([^>]*)>/gi)) {
  const id = match[1].match(/\bid="([^"]+)"/);
  if (id) elements.set(id[1], new Element(match[1].match(/\bvalue="([^"]*)"/)?.[1] || ''));
}
elements.get('solveFor').value = 'shutterSeconds';
elements.get('ndUnit').value = 'stops';
const presets = ['8', '64', '1000'].map(factor => { const element = new Element(); element.dataset.ndFactor = factor; return element; });
const document = { getElementById: id => { assert(elements.has(id), `HTML must contain ${id}`); return elements.get(id); }, querySelectorAll: selector => { assert.equal(selector, '[data-nd-factor]'); return presets; }, addEventListener() {}, hidden: false };
let now = 100000;
let intervalCallback = null;
const metrics = [];
const context = vm.createContext({ ...calculations, document, window: { addEventListener() {} }, Date: { now: () => now }, trackUsage: (...args) => { metrics.push(args); }, setInterval: fn => { intervalCallback = fn; return 1; }, clearInterval: () => { intervalCallback = null; } });
const app = await readFile(new URL('../public/assets/js/exposure/app.js', import.meta.url), 'utf8');
vm.runInContext(app.replace(/^import .*\r?\n/gm, ''), context);
const element = id => elements.get(id);
assert.equal(element('targetShutter').disabled, true);
element('exposureForm').fire('submit');
assert.equal(element('exposureResult').hidden, false);
assert.match(element('exposureDetails').textContent, /ISO 100/);
assert.equal(element('exposureToTimer').disabled, true, 'subsecond settings cannot start a long-exposure timer');
element('solveFor').value = 'iso'; element('solveFor').fire('change');
assert.equal(element('targetIso').disabled, true);
assert.equal(element('targetShutter').disabled, false);
assert.equal(element('exposureResult').hidden, true, 'changing the solved variable invalidates stale output');
element('baseIso').value = '0'; element('exposureForm').fire('submit');
assert.equal(element('exposureError').hidden, false);
assert.equal(element('exposureResult').hidden, true);

element('ndForm').fire('submit');
assert.equal(element('ndValue').textContent, '8.192초');
presets[2].fire('click');
assert.equal(element('ndUnit').value, 'factor');
assert.equal(element('ndResult').hidden, true);
element('ndForm').fire('submit');
assert.equal(element('ndValue').textContent, '8초');
element('ndToTimer').fire('click');
assert.equal(element('timerSeconds').value, '8');
element('timerForm').fire('submit');
assert.equal(element('timerStart').textContent, '일시정지');
assert.equal(element('timerSeconds').disabled, true);
assert.equal(element('ndToTimer').disabled, true, 'do not replace a timer during an exposure');
now += 3000; element('timerForm').fire('submit');
assert.equal(element('timerStart').textContent, '재개');
assert.equal(element('timerDisplay').textContent, '00:05');
now += 50000; element('timerForm').fire('submit');
assert.equal(typeof intervalCallback, 'function');
now += 6000; intervalCallback();
assert.equal(element('timerDisplay').textContent, '00:00');
assert.equal(element('timerStatus').textContent, '설정한 시간이 끝났습니다.');
assert.equal(intervalCallback, null);
element('timerReset').fire('click');
assert.equal(element('timerSeconds').disabled, false);
assert.equal(element('timerDisplay').textContent, '00:08');
assert(metrics.every(([event, surface]) => ['tool_start', 'tool_success', 'tool_failure'].includes(event) && surface === 'exposure'));
assert.equal(metrics.length, 8, 'only four explicit calculation submissions emit start and outcome');
console.log('Exposure checks passed: three-way equal exposure, ND notation, parsing/ranges, drift-free pause/resume and connected UI handlers.');
