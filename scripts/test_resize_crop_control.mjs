import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../public/assets/js/resize/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function handleWheel(event) {');
const end = source.indexOf('function startWatermarkDrag(event) {', start);
assert(start >= 0 && end > start);
const photos = [{cropShift: 0}, {cropShift: -.45}];
let active = 0;
let previews = 0;
const range = {value: '', disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }};
const label = {textContent: ''};
const context = vm.createContext({
  refs: {cropShift: range, cropShiftValue: label},
  settings: {cropEnabled: true, cropRatio: '4:5'}, processing: false,
  currentPhoto: () => photos[active] || null,
  renderPreviewOnly: () => { previews++; },
});
vm.runInContext(source.slice(start, end), context);
context.syncCropShiftControl();
assert.equal(range.disabled, false);
assert.equal(label.textContent, '중앙');
context.handleCropShiftInput({target: {value: '.37'}});
assert.equal(photos[0].cropShift, .37);
assert.equal(photos[1].cropShift, -.45, 'slider changes only the current photo');
assert.equal(range.value, '0.37');
assert.equal(label.textContent, '37%');
assert.equal(range.attributes['aria-valuetext'], '37%');
assert.equal(previews, 1);

active = 1;
context.syncCropShiftControl();
assert.equal(range.value, '-0.45', 'switching photos restores its own crop position');
context.handleCropShiftInput({target: {value: '99'}});
assert.equal(photos[1].cropShift, 1);
context.handleCropShiftInput({target: {value: '-99'}});
assert.equal(photos[1].cropShift, -1);
context.handleCropShiftInput({target: {value: 'not a number'}});
assert.equal(photos[1].cropShift, -1);

let prevented = false;
context.handleWheel({deltaY: 10, preventDefault() { prevented = true; }});
assert.equal(prevented, true);
assert.equal(photos[1].cropShift, -.94);
assert.equal(range.value, '-0.94', 'existing wheel input and slider stay synchronized');

for (const guard of ['cropOff', 'noRatio', 'processing', 'noPhoto']) {
  context.settings.cropEnabled = guard !== 'cropOff';
  context.settings.cropRatio = guard === 'noRatio' ? 'none' : '4:5';
  context.processing = guard === 'processing';
  active = guard === 'noPhoto' ? -1 : 1;
  context.syncCropShiftControl();
  assert.equal(range.disabled, true, guard);
  const previous = photos[1].cropShift;
  const previousPreviews = previews;
  context.handleCropShiftInput({target: {value: '.8'}});
  context.handleWheel({deltaY: 10, preventDefault() { throw new Error(`wheel must not capture while ${guard}`); }});
  assert.equal(photos[1].cropShift, previous, guard);
  assert.equal(previews, previousPreviews, guard);
}

const html = await fs.readFile(new URL('../public/program/resize/index.html', import.meta.url), 'utf8');
assert.match(html, /type="range" min="-1" max="1" step="0\.01" value="0" disabled data-crop-shift/);
assert.match(source, /refs\.cropShift\?\.addEventListener\('input', handleCropShiftInput\)/);
assert.match(source, /function updateControlLabels\(\) \{\s*syncCropShiftControl\(\)/);
assert.match(source, /function renderAll\(\) \{\s*syncCropShiftControl\(\)/);
console.log('Resize crop control passed: touch range, per-photo state, bounded input, wheel synchronization and inactive/processing guards.');
