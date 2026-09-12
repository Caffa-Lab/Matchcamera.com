import assert from 'node:assert/strict';
import { buildMetadataCaptions } from '../public/assets/js/metadata-captions.js';

const tags = value => value.instagram.match(/#[\p{L}\p{N}_]+/gu) || [];
const caption = exif => buildMetadataCaptions(exif);
for (const exif of [undefined, null, {}, { Make: 'unknown', Model: '—', Lens: 123 }, { ISO: 0, FNumber: 0, ExposureTime: 0, FocalLength: 0, DateTimeOriginal: '2026:02:30' }]) {
  assert.deepEqual(caption(exif), { instagram: '', blog: '', hasMetadata: false });
}
assert.deepEqual(caption({ LensMake: 'SIGMA' }), { instagram: '', blog: '', hasMetadata: false }, 'A lens manufacturer alone is not a lens model.');

const canon = caption({ Make: 'Canon', Model: 'Canon EOS R50', LensModel: 'RF-S18-45mm F4.5-6.3 IS STM', FNumber: 5.6, ExposureTime: { numerator: 1, denominator: 1250 }, ISO: 100, FocalLength: 31, DateTimeOriginal: '2026:06:29 12:34:56' });
assert.deepEqual(tags(canon), ['#canon', '#캐논', '#eosr50', '#rf1845']);
assert.equal(canon.blog, 'Canon EOS R50 + RF-S18-45mm F4.5-6.3 IS STM\nF 5.6 | SS 1/1250s | ISO 100 | 31mm (2026.06.29)');
assert.match(canon.instagram, /^📷𝗲𝗼𝘀𝗿𝟱𝟬 \+ 𝙧𝙛𝟭𝟴𝟰𝟱\n\n/);
assert.deepEqual(tags(caption({ Make: 'NIKON CORPORATION', Model: 'NIKON Z 8', LensModel: 'NIKKOR Z 24-70mm f/2.8 S' })), ['#nikon', '#니콘', '#nikonz8', '#nikkorz2470f28s']);
assert.deepEqual(tags(caption({ Make: 'FUJIFILM', Model: 'X-T5', LensModel: 'XF16-55mmF2.8 R LM WR II' })), ['#fujifilm', '#후지필름', '#fujifilmxt5', '#xf1655f28rlmwrii']);
assert.deepEqual(tags(caption({ Make: 'HASSELBLAD', Model: 'H6D-100c', LensModel: 'HC 80mm F2.8' })), ['#hasselblad', '#핫셀블라드', '#hasselbladh6d100c', '#hc80f28']);
assert.ok(!tags(caption({ Make: 'HASSELBLAD', Model: 'H6D-100c' })).some(tag => /xsystem/.test(tag)));
for (const [make, model, expected] of [
  ['Leica Camera AG', 'LEICA Q3', ['#leica', '#leicacamera', '#leicaq3']],
  ['Panasonic', 'DC-S5M2', ['#lumix', '#panasonic', '#lumixdcs5m2']],
  ['OM Digital Solutions', 'OM-1', ['#omsystem', '#오엠시스템', '#omsystemom1']],
  ['OLYMPUS IMAGING CORP.', 'E-M1MarkIII', ['#olympus', '#올림푸스', '#olympusem1markiii']],
  ['RICOH IMAGING COMPANY, LTD.', 'PENTAX K-1 Mark II', ['#pentax', '#펜탁스', '#pentaxk1markii']],
  ['RICOH IMAGING COMPANY, LTD.', 'RICOH GR III', ['#ricohgr', '#grsnaps', '#ricohgriii']],
  ['RICOH IMAGING COMPANY, LTD.', 'RICOH GR IIIx', ['#ricohgr', '#grsnaps', '#ricohgriiix']],
]) assert.deepEqual(tags(caption({ Make: make, Model: model })), expected);
assert.ok(!tags(caption({ Make: 'RICOH', Model: 'WG-6' })).includes('#grsnaps'), 'GR tags require a confirmed GR model.');

const sony = caption({ Make: 'SONY', Model: 'ILCE-7M4', LensModel: 'FE 24-70mm F2.8 GM II' });
assert.deepEqual(tags(sony), ['#sony', '#sonyalpha', '#sonykorea', '#a7m4', '#fe2470f28gmii']);
assert.match(sony.instagram, /^📷𝗮𝟳𝗺𝟰 \+ 𝙛𝙚𝟮𝟰𝟳𝟬𝙛𝟮𝟴𝙜𝙢𝙞𝙞/);
assert.deepEqual(tags(caption({ Make: 'SONY', Model: 'ILCE-7RM5', LensModel: 'SEL2470GM2' })), ['#sony', '#sonyalpha', '#sonykorea', '#a7r5', '#sel2470gm2']);
assert.deepEqual(tags(caption({ Make: 'SONY', Model: 'ILCE-7M4', LensMake: 'SIGMA', LensModel: '24-70mm F2.8 DG DN | Art' })), ['#sony', '#sonyalpha', '#sonykorea', '#a7m4', '#sigma2470f28dgdnart']);
const tamron = caption({ Make: 'SONY', Model: 'ILCE-7M4', LensMake: 'TAMRON', LensModel: '28-75mm F/2.8 Di III VXD G2' });
assert.equal(tags(tamron).at(-1), '#tamron2875f28diiiivxdg2');
assert.ok(!tags(tamron).some(tag => /^#sel/.test(tag)));
assert.notEqual(tags(caption({ Make: 'SONY', Model: 'A7R IV' })).at(-1), '#a7r5');
assert.notEqual(tags(caption({ Make: 'SONY', Model: 'ILCE-1M2' })).at(-1), '#a1');
for (const [model, result] of [['Canon EOS 5D Mark IV', '#eos5dm4'], ['Canon EOS 5D Mark V', '#eos5dm5'], ['Canon EOS R5 Mark II', '#eosr5m2']]) {
  assert.equal(tags(caption({ Make: 'Canon', Model: model })).at(-1), result);
}
assert.deepEqual(tags(caption({ Make: 'Nikon', Model: 'NIKON Z 8', LensMake: 'Nikon' })), ['#nikon', '#니콘', '#nikonz8']);
assert.deepEqual(tags(caption({ Make: 'Canon', Model: 'Canon' })), ['#canon', '#캐논'], 'Duplicate tags are emitted only once.');
assert.deepEqual(tags(caption({ Make: 'Canon', Model: '', LensModel: 'unknown lens' })), ['#canon', '#캐논']);

for (const [make, model, expected] of [
  ['Apple', 'iPhone 15 Pro', ['#apple', '#iphone15pro']],
  ['Google', 'Pixel 9 Pro', ['#google', '#pixel9pro']],
  ['samsung', 'SM-S928B', ['#samsung', '#galaxys24ultra']],
]) {
  const result = caption({ Make: make, Model: model, LensModel: 'built-in 6.86mm f/1.78' });
  assert.deepEqual(tags(result), expected);
  assert.ok(!result.blog.includes('built-in'), 'Phone captions do not pretend the integrated lens is a separate accessory.');
}
const samsungCamera = caption({ Make: 'SAMSUNG', Model: 'NX1', LensModel: '16-50mm F2.8' });
assert.ok(samsungCamera.blog.includes('16-50mm F2.8'), 'A Samsung camera must not be mistaken for a phone.');

const apex = caption({ Model: 'Test body', ApertureValue: { numerator: 6, denominator: 1 }, ShutterSpeedValue: 10, ISO: 100 });
assert.match(apex.blog, /F 8 \| SS 1\/1024s \| ISO 100/);
assert.match(caption({ ApertureValue: 0, ShutterSpeedValue: 0 }).blog, /F 1 \| SS 1s/);
assert.match(caption({ FNumber: '28/10', ExposureTime: '1/250', ISO: '400', FocalLength: { numerator: 85, denominator: 1 } }).blog, /^F 2\.8 \| SS 1\/250s \| ISO 400 \| 85mm/);
assert.match(caption({ Make: 'Canon', FNumber: 0, ExposureTime: 0, ISO: 0, FocalLength: 0 }).blog, /F — \| SS — \| ISO — \| —/);
assert.match(caption({ ExposureTime: 0.8 }).blog, /SS 0\.8s/);
assert.equal(caption({ ISO: 100 }).instagram, '', 'Numeric settings cannot invent equipment hashtags.');
assert.ok(caption({ ISO: 100 }).hasMetadata);
assert.ok(!caption({ ExposureTime: { numerator: 1, denominator: 0 } }).hasMetadata);
assert.ok(!caption({ FNumber: false, ISO: [], Make: {} }).hasMetadata);
assert.match(caption({ Make: 'Canon', DateTimeOriginal: 'invalid', CreateDate: '2024:02:29 10:00:00' }).blog, /\(2024\.02\.29\)$/);
assert.ok(!caption({ DateTimeOriginal: '2025:02:29' }).hasMetadata);
for (const example of [canon, sony, tamron, apex, samsungCamera]) {
  assert.ok(tags(example).length <= 5);
  assert.equal(new Set(tags(example)).size, tags(example).length);
  assert.ok(!tags(example).some(value => ['#camera', '#lens', '#풍경사진', '#여행', '#캐논이미지스토밍'].includes(value)));
}
console.log('metadata caption tests passed');
