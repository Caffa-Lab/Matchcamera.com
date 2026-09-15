import assert from 'node:assert/strict';
import { renderPreview } from '../public/assets/js/resize/image-utils.js';

const pendingImages = new Map();
const imageRequests = new Map();
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

class FakeImage {
  naturalWidth = 1200;
  naturalHeight = 800;

  set src(value) {
    this.url = value;
    if (value.startsWith('/test-products/')) {
      pendingImages.set(value, this);
      imageRequests.get(value)?.resolve();
    }
  }

  get src() { return this.url; }
  async decode() {}
}

function createCanvas() {
  const calls = [];
  const context = new Proxy({}, {
    get(_target, method) {
      if (method === 'measureText') return text => ({ width: String(text).length * 50 });
      return (...args) => {
        calls.push([method, ...args.map(value => value instanceof FakeImage ? value.src : value)]);
      };
    },
    set(target, name, value) {
      target[name] = value;
      calls.push(['context property', name, value]);
      return true;
    },
  });
  const canvas = { style: {}, getContext: () => context };
  for (const name of ['width', 'height', 'hidden']) {
    Object.defineProperty(canvas, name, {
      set(value) { calls.push(['canvas property', name, value]); },
    });
  }
  return { canvas, calls };
}

const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
globalThis.Image = FakeImage;
globalThis.window = { devicePixelRatio: 1 };

try {
  const { canvas, calls } = createCanvas();
  const stage = { clientWidth: 800, clientHeight: 600 };
  const settings = {
    cropEnabled: false,
    borderEnabled: false,
    gridEnabled: false,
    watermarkEnabled: false,
    equipmentEnabled: true,
    equipmentImages: true,
    equipmentSettings: true,
    equipmentTheme: 'light',
  };
  const lensSrc = '/test-products/sony-lens.png';
  const requested = deferred();
  imageRequests.set(lensSrc, requested);
  const photoA = {
    id: 'preview-race-sony', url: 'blob:photo-a', rotation: 0, cropShift: 0,
    bodyRaw: 'Sony camera', lensRaw: 'FE 24-70mm F2.8 GM II', body: null,
    lens: { officialName: 'Sony FE 24-70mm F2.8 GM II', imageSrc: lensSrc },
  };
  const photoB = {
    id: 'preview-race-missing-lens', url: 'blob:photo-b', rotation: 0, cropShift: 0,
    bodyRaw: 'Canon EOS R50', lensRaw: '', body: null, lens: null,
  };
  let activeId = photoA.id;
  const options = photo => ({
    canvas, stage, photo, settings, watermarkImage: null,
    shouldRender: () => activeId === photo.id,
  });

  // A is waiting for its product image when the user moves to a photo without lens metadata.
  const renderA = renderPreview(options(photoA));
  let timeout;
  try {
    await Promise.race([
      requested.promise,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('The lens image was never requested.')), 1000); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  activeId = photoB.id;
  const geometryB = await renderPreview(options(photoB));
  assert.ok(geometryB, 'The current photo must render while a previous product image is still loading.');
  assert.ok(calls.some(call => call[0] === 'drawImage' && call[1] === photoB.url));
  const completedB = structuredClone(calls);

  pendingImages.get(lensSrc).onload();
  await renderA;
  assert.deepEqual(calls, completedB, 'A stale product-image request must not draw, resize or reveal the canvas after another photo has finished rendering.');
  assert.ok(!calls.some(call => call[0] === 'drawImage' && call[1] === lensSrc), 'The photo without lens metadata must not receive the previous Sony lens image.');

  // The race guard must still allow the same verified image when A becomes current again.
  activeId = photoA.id;
  const geometryA = await renderPreview(options(photoA));
  assert.ok(geometryA);
  assert.ok(calls.some(call => call[0] === 'drawImage' && call[1] === lensSrc), 'A current photo must retain its correctly matched product image.');
  console.log('equipment preview tests passed (stale image request rejected; current image preserved)');
} finally {
  if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage);
  else delete globalThis.Image;
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else delete globalThis.window;
}
