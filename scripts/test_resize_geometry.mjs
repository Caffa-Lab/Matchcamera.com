import assert from 'node:assert/strict';
import { calculateLayout } from '../public/assets/js/resize/layout.js';
import { renderPreview } from '../public/assets/js/resize/image-utils.js';

const near = (actual, expected, message, tolerance = 1e-7) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} versus ${expected}`);
const cases = [
  { name: 'original', width: 4000, height: 3000, options: {}, output: [4000, 3000] },
  { name: 'crop portrait', width: 4000, height: 3000, options: { cropEnabled: true, cropRatio: '4:5' }, output: [2400, 3000] },
  { name: 'border portrait', width: 4000, height: 3000, options: { borderEnabled: true, cropRatio: '4:5' }, output: [4000, 5000] },
  { name: 'crop auto landscape', width: 4000, height: 3000, options: { cropEnabled: true, cropRatio: 'auto' }, output: [3750, 3000] },
  { name: 'border auto portrait', width: 3000, height: 4000, options: { borderEnabled: true, cropRatio: 'auto' }, output: [3200, 4000] },
  { name: 'crop no ratio', width: 4000, height: 3000, options: { cropEnabled: true, cropRatio: 'none' }, output: [4000, 3000] },
  { name: 'border no ratio', width: 4000, height: 3000, options: { borderEnabled: true, cropRatio: 'none' }, output: [4000, 3000] },
  { name: 'inactive ratio', width: 4000, height: 3000, options: { cropRatio: '9:16' }, output: [4000, 3000] },
  { name: 'panorama original', width: 8000, height: 400, options: { cropRatio: 'none' }, output: [8000, 400] },
  { name: 'tall original', width: 400, height: 8000, options: { cropRatio: 'none' }, output: [400, 8000] },
];

for (const test of cases) {
  const off = calculateLayout(test.width, test.height, { ...test.options, equipmentEnabled: false, borderSize: 5 });
  assert.deepEqual([off.width, off.height], test.output, `${test.name}: established output dimensions`);
  assert.equal(off.panelHeight, 0);
  const on = calculateLayout(test.width, test.height, { ...test.options, equipmentEnabled: true, borderSize: 5 });
  assert.deepEqual([on.width, on.height], test.output, `${test.name}: a panel must not grow or reshape the final image`);
  assert.equal(on.photoHeight + on.panelHeight, on.height, `${test.name}: the panel is inside the final canvas`);
  assert.ok(on.panelHeight > 0 && on.photoHeight > 0, `${test.name}: both regions remain usable`);
  assert.ok(on.panelHeight <= Math.ceil(on.height * .30), `${test.name}: panorama panel height is bounded by total height`);
  const { crop, placement } = on;
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x + crop.width <= test.width + 1e-7 && crop.y + crop.height <= test.height + 1e-7);
  near(placement.width / placement.height, crop.width / crop.height, `${test.name}: photograph is never stretched`);
  if (on.mode === 'contain') {
    assert.deepEqual(crop, { x: 0, y: 0, width: test.width, height: test.height }, `${test.name}: uncropped photo is retained in full`);
    assert.ok(placement.x >= 0 && placement.y >= 0);
    assert.ok(placement.x + placement.width <= on.width + 1e-7);
    assert.ok(placement.y + placement.height <= on.photoHeight + 1e-7, `${test.name}: photo cannot overlap the equipment panel`);
  } else {
    near(placement.x, 0, `${test.name}: cover begins at photo left`);
    near(placement.y, 0, `${test.name}: cover begins at photo top`);
    near(placement.width, on.width, `${test.name}: cover fills photo width`);
    near(placement.height, on.photoHeight, `${test.name}: cover fills photo height`);
  }
}

for (const [width, height, cropRatio] of [[4000, 3000, '4:5'], [3000, 4000, '16:9']]) {
  const options = { cropEnabled: true, cropRatio, equipmentEnabled: true };
  const first = calculateLayout(width, height, options, -1);
  const last = calculateLayout(width, height, options, 1);
  near(first.crop.x, 0, 'crop shift starts at left edge');
  near(first.crop.y, 0, 'crop shift starts at upper edge');
  near(last.crop.x + last.crop.width, width, 'crop shift can reach right edge');
  near(last.crop.y + last.crop.height, height, 'crop shift can reach bottom edge');
  assert.ok(last.crop.x > first.crop.x || last.crop.y > first.crop.y, 'crop position remains adjustable after reserving the panel');
}

// Run the actual preview and worker entry points with deterministic image and canvas
// objects. Dimensions attached to each encoded blob describe its real canvas,
// independently of whatever dimensions the worker reports in its message.
const savedGlobals = new Map(['Image', 'window', 'self', 'OffscreenCanvas', 'createImageBitmap'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
function fakeContext() {
  return new Proxy({}, {
    get(target, key) {
      if (key === 'measureText') return text => ({ width: String(text).length * 8 });
      return key in target ? target[key] : () => {};
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}
class FakeImage {
  set src(value) {
    this.url = value;
    const [, width, height] = value.match(/^fixture:(\d+)x(\d+)$/) || [];
    this.naturalWidth = Number(width);
    this.naturalHeight = Number(height);
  }
  async decode() {}
}
class FakeCanvas {
  constructor(width = 1, height = 1) { this.width = width; this.height = height; this.style = {}; this.context = fakeContext(); }
  getContext() { return this.context; }
  async convertToBlob({ quality = 1 } = {}) {
    return { size: Math.ceil(this.width * this.height * quality / 4), encodedWidth: this.width, encodedHeight: this.height };
  }
}
const messages = [];
let jobNumber = 0;
const baseOptions = {
  rotation: 0, cropRatio: 'none', cropShift: 0, borderSize: 5,
  cropEnabled: false, borderEnabled: false, borderColor: 'white',
  equipmentEnabled: true, equipmentImages: false, equipmentSettings: true,
  equipmentTheme: 'light', gridEnabled: false, watermarkEnabled: false,
  saveMode: 'quality', targetBytes: 100_000,
};

try {
  globalThis.Image = FakeImage;
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.OffscreenCanvas = FakeCanvas;
  globalThis.createImageBitmap = async file => ({ width: file.width, height: file.height, close() {} });
  globalThis.self = { postMessage: message => messages.push(message) };
  await import('../public/program/resize/workers/image-worker.js');

  async function runWorker(width, height, options) {
    messages.length = 0;
    await self.onmessage({ data: { jobId: ++jobNumber, file: { width, height }, options, watermarkFile: null } });
    assert.equal(messages.length, 1, 'one worker result is emitted');
    const result = messages[0];
    assert.equal(result.ok, true, result.error);
    assert.equal(result.width, result.blob.encodedWidth, 'reported output width must be the encoded width');
    assert.equal(result.height, result.blob.encodedHeight, 'reported output height must be the encoded height');
    return result;
  }

  for (const test of cases) {
    const options = { ...baseOptions, ...test.options };
    const result = await runWorker(test.width, test.height, options);
    assert.deepEqual([result.width, result.height], test.output, `${test.name}: actual worker output keeps the requested final ratio`);
    const canvas = new FakeCanvas();
    await renderPreview({
      canvas, stage: { clientWidth: 832, clientHeight: 632 }, settings: options, watermarkImage: null,
      photo: { id: `geometry-${test.name}`, url: `fixture:${test.width}x${test.height}`, rotation: 0, cropShift: 0 },
    });
    near(canvas.width, canvas.height * result.width / result.height, `${test.name}: preview and output have the same final aspect ratio`, Math.max(1, result.width / result.height));
    assert.ok(canvas.width <= 801 && canvas.height <= 601, `${test.name}: full output including panel fits preview stage`);
  }

  const rotated = await runWorker(4000, 3000, { ...baseOptions, rotation: 90 });
  assert.deepEqual([rotated.width, rotated.height], [3000, 4000], 'no-ratio output preserves the rotated photograph aspect ratio');
  const alreadySmall = await runWorker(4000, 3000, { ...baseOptions, saveMode: 'size', targetBytes: 10_000_000 });
  assert.deepEqual([alreadySmall.width, alreadySmall.height], [4000, 3000], 'size mode retains dimensions when the first encoding already fits');
  const reduced = await runWorker(4000, 3000, { ...baseOptions, cropEnabled: true, cropRatio: '4:5', saveMode: 'size' });
  assert.ok(reduced.width < 2400 && reduced.height < 3000, 'size mode must actually exercise a smaller encoded canvas');
  assert.ok(reduced.blob.size <= baseOptions.targetBytes, 'the requested target is met for the deterministic fixture');
  near(reduced.width, reduced.height * 4 / 5, 'size-limited encoding retains the selected final ratio', 1);
  const qualityFallback = await runWorker(4000, 3000, { ...baseOptions, cropEnabled: true, cropRatio: '4:5', saveMode: 'size', targetBytes: 30_000 });
  assert.deepEqual([qualityFallback.width, qualityFallback.height], [432, 540], 'quality fallback reports the minimum-scale canvas dimensions');
  assert.ok(qualityFallback.blob.size <= 30_000, 'fallback quality encoding fits the deterministic fixture target');
  console.log('Resize geometry passed: final ratios, panel containment, uncropped image preservation, crop positioning, preview/output agreement and actual encoded dimensions.');
} finally {
  for (const [key, descriptor] of savedGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
}
