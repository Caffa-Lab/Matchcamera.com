import assert from 'node:assert/strict';
import { computeCrop, renderOverview, renderTile, canvasToJpeg, outputName } from '../public/assets/js/carousel/renderer.js';

const close = (actual, expected, message) => assert(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${message}: ${actual} vs ${expected}`);
const ratios = { '4:5': .8, '1:1': 1, '3:4': .75 };

for (const [width, height] of [[6000, 4000], [4000, 6000], [12000, 1000], [1, 1], [4033, 3025]]) {
  for (const count of [2, 3, 7, 10]) {
    for (const [ratio, numericRatio] of Object.entries(ratios)) {
      for (const offset of [0, .25, .5, 1]) {
        const crop = computeCrop(width, height, { count, ratio, offsetX: offset, offsetY: offset });
        assert.equal(crop.tiles.length, count);
        assert(crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0);
        assert(crop.x + crop.width <= width + 1e-9 && crop.y + crop.height <= height + 1e-9);
        close(crop.width / crop.height, count * numericRatio, 'The shared crop must match the complete carousel ratio');
        assert(crop.width === width || crop.height === height, 'Cover cropping must fill at least one source dimension');
        close(crop.x, (width - crop.width) * offset, 'Horizontal crop position');
        close(crop.y, (height - crop.height) * offset, 'Vertical crop position');
        close(crop.tiles[0].x, crop.x, 'First boundary');
        const last = crop.tiles.at(-1);
        close(last.x + last.width, crop.x + crop.width, 'Last boundary');
        for (let index = 0; index < count; index += 1) {
          const tile = crop.tiles[index];
          close(tile.width / tile.height, numericRatio, 'Each tile has the requested ratio');
          assert.equal(tile.y, crop.y);
          assert.equal(tile.height, crop.height);
          if (index > 0) close(crop.tiles[index - 1].x + crop.tiles[index - 1].width, tile.x, 'Adjacent source boundaries cannot leave a gap or overlap');
        }
      }
    }
  }
}
assert.deepEqual(computeCrop(6000, 4000, { offsetY: -3 }), computeCrop(6000, 4000, { offsetY: 0 }));
assert.deepEqual(computeCrop(12000, 1000, { offsetX: 8 }), computeCrop(12000, 1000, { offsetX: 1 }));
for (const dimensions of [[0, 1], [-1, 1], [1, NaN], [Infinity, 1], ['6000', 4000]]) assert.throws(() => computeCrop(...dimensions));
for (const count of [1, 11, 2.5, NaN, '3']) assert.throws(() => computeCrop(6000, 4000, { count }));
assert.throws(() => computeCrop(6000, 4000, { ratio: '16:9' }));
assert.throws(() => computeCrop(6000, 4000, { offsetX: NaN }));

class FakeCanvas {
  width = 0;
  height = 0;
  calls = [];
  states = [];
  context = {
    fillStyle: '', font: '', globalAlpha: 1, textAlign: '', textBaseline: '',
    save: () => { this.states.push({ ...this.context }); },
    restore: () => { Object.assign(this.context, this.states.pop()); },
    fillRect: (...args) => { this.calls.push({ kind: 'background', args, color: this.context.fillStyle }); },
    drawImage: (...args) => { this.calls.push({ kind: 'image', args, opacity: this.context.globalAlpha }); },
    fillText: (...args) => { this.calls.push({ kind: 'text', args, font: this.context.font, color: this.context.fillStyle, align: this.context.textAlign, opacity: this.context.globalAlpha }); },
    measureText: text => ({ width: text.length * Number(this.context.font.match(/([\d.]+)px/)[1]) * .6 }),
  };
  getContext(type, options) { assert.equal(type, '2d'); assert.equal(options.alpha, false); return this.context; }
  toBlob(callback, type, quality) { this.jpegOptions = { type, quality }; callback(new Blob(['JPEG'], { type })); }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
globalThis.document = { createElement: tag => { assert.equal(tag, 'canvas'); return new FakeCanvas(); } };
try {
  const image = { naturalWidth: 6031, naturalHeight: 4021 };
  for (const ratio of Object.keys(ratios)) {
    for (const tileWidth of [1080, 1440, 2160]) {
      const options = { count: 7, ratio, tileWidth, offsetX: .2, offsetY: .7 };
      const crop = computeCrop(image.naturalWidth, image.naturalHeight, options);
      const frames = Array.from({ length: options.count }, (_, index) => renderTile(image, options, index));
      for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        assert.equal(frame.width, tileWidth);
        assert.equal(frame.height, Math.round(tileWidth / ratios[ratio]));
        assert.deepEqual(frame.calls[0], { kind: 'background', args: [0, 0, frame.width, frame.height], color: '#ffffff' });
        assert.equal(frame.calls.filter(call => call.kind === 'image').length, 1, 'Only the original source is drawn when watermarking is disabled');
        const drawing = frame.calls.find(call => call.kind === 'image');
        assert.equal(drawing.args[0], image, 'Export uses the original source directly');
        assert.deepEqual(drawing.args.slice(1, 5), [crop.x, crop.y, crop.width, crop.height]);
        assert.deepEqual(drawing.args.slice(5), [-index * tileWidth, 0, tileWidth * options.count, frame.height], 'Panels share one exact source scale and integer translations');
        assert.equal(drawing.opacity, 1, 'Source image opacity is unchanged');
        if (index > 0) {
          const previous = frames[index - 1].calls.find(call => call.kind === 'image').args;
          const current = drawing.args;
          const boundaryFromPrevious = crop.x + (tileWidth - previous[5]) * crop.width / previous[7];
          const boundaryFromCurrent = crop.x - current[5] * crop.width / current[7];
          assert.equal(boundaryFromPrevious, boundaryFromCurrent, 'Neighbouring output pixels must use the same source boundary');
        }
      }
    }
  }

  const textOptions = { count: 4, ratio: '4:5', tileWidth: 1440, watermark: { enabled: true, kind: 'text', text: 'Caffa', position: 'right', color: 'black', size: 5, margin: 4, opacity: .6 } };
  const overview = renderOverview(image, textOptions);
  assert.equal(overview.width, 1600);
  assert.equal(overview.height, 500);
  const overviewText = overview.calls.filter(call => call.kind === 'text');
  assert.equal(overviewText.length, 4, 'Every preview panel must include its own watermark');
  const tile = renderTile(image, textOptions, 2);
  const tileText = tile.calls.find(call => call.kind === 'text');
  for (let index = 0; index < overviewText.length; index += 1) {
    const text = overviewText[index];
    assert.equal(text.color, '#000000'); assert.equal(text.opacity, .6); assert.equal(text.align, 'right');
    close((text.args[1] - index * 400) / 400, tileText.args[1] / tile.width, 'Preview and exported text use the same relative horizontal position');
    close(text.args[2] / overview.height, tileText.args[2] / tile.height, 'Preview and exported text use the same relative vertical position');
  }
  const logo = { width: 1200, height: 800 };
  for (const position of ['left', 'center', 'right']) {
    const logoOptions = { count: 3, watermark: { enabled: true, kind: 'image', position, size: 20, margin: 3, opacity: .8 } };
    const frame = renderTile(image, logoOptions, 1, logo);
    const stamp = frame.calls.find(call => call.kind === 'image' && call.args[0] === logo);
    assert(stamp, 'The supplied local image is used as a watermark');
    assert.equal(stamp.opacity, .8);
    const [, x, y, width, height] = stamp.args;
    assert(x >= 0 && y >= 0 && x + width <= frame.width && y + height <= frame.height);
    close(width / height, logo.width / logo.height, 'Image watermark aspect ratio is preserved');
    if (position === 'left') close(x, frame.width * .03, 'Left margin');
    if (position === 'center') close(x + width / 2, frame.width / 2, 'Centered logo');
    if (position === 'right') close(x + width, frame.width * .97, 'Right margin');
  }
  const logoOverview = renderOverview(image, { count: 10, watermark: { enabled: true, kind: 'image', size: 20 } }, logo);
  assert.equal(logoOverview.calls.filter(call => call.kind === 'image' && call.args[0] === logo).length, 10, 'All preview panels must include the uploaded logo');
  const hiddenWatermark = renderTile(image, { watermark: { enabled: true, text: 'Hidden', opacity: 0 } });
  assert(!hiddenWatermark.calls.some(call => call.kind === 'text'), 'Zero opacity must leave the source unchanged');
  assert.throws(() => renderTile(image, { watermark: { enabled: true, opacity: NaN } }));
  assert.throws(() => renderTile(image, { watermark: { enabled: true, position: 'outside' } }));
  assert.equal(renderOverview(logo, { count: 10 }, null, 1200).width, 1200, 'ImageBitmap-style dimensions are supported');
  for (const index of [-1, 3, .5, NaN]) assert.throws(() => renderTile(image, { count: 3 }, index));
  assert.throws(() => renderTile(image, { tileWidth: 4000 }));
  assert.throws(() => renderOverview(image, {}, null, 0));
  assert.throws(() => renderTile({ naturalWidth: 0, naturalHeight: 0 }, {}));
  const blob = await canvasToJpeg(tile);
  assert.equal(blob.type, 'image/jpeg');
  assert.deepEqual(tile.jpegOptions, { type: 'image/jpeg', quality: .92 });
  await assert.rejects(canvasToJpeg({ toBlob: callback => callback(null) }));
  assert.throws(() => canvasToJpeg(tile, 1.5));
} finally {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
}

assert.equal(outputName('여행 사진.JPEG', 0), '여행 사진_01.jpg');
assert.equal(outputName('photo.v2.webp', 9), 'photo.v2_10.jpg');
assert.equal(outputName('C:\\photos\\sample.png', 1, 3), 'sample_002.jpg');
assert.equal(outputName('../CON.jpg', 0), 'photo_CON_01.jpg');
assert.equal(outputName('unsafe:?*.jpg', 1), 'unsafe____02.jpg');
assert.equal(outputName('', 0), 'photo_01.jpg');
assert.throws(() => outputName('photo.jpg', -1));
assert.throws(() => outputName('photo.jpg', 0, 0));
console.log('Carousel tests passed: cover crop, shared boundaries, original-resolution export, per-panel watermarks, JPEG and safe filenames.');
