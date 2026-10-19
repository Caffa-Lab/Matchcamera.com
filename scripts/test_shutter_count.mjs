import assert from 'node:assert/strict';
import { interpretMetadata } from '../public/assets/js/shutter-count/result.js';

// Pure normalization tests complement test_shutter_reader.mjs (upstream image
// fixtures through WASM) and test_shutter_ui.mjs (queue, rendering and lifecycle).
const inspect = fields => interpretMetadata(fields);
const counter = (key, value) => inspect({ [key]: value });
const unavailable = result => {
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.counters, []);
  assert.match(result.message, /0회를 의미하지 않습니다/);
};

// Camera identity comes from camera/file metadata, never XMP or a user comment.
{
  const result = inspect({
    'XMP:XMP-tiff:Make': 'UNTRUSTED MAKE',
    'XMP:XMP-tiff:Model': 'UNTRUSTED MODEL',
    'EXIF:IFD0:Make': 'NIKON CORPORATION',
    'EXIF:IFD0:Model': 'NIKON D70',
    'EXIF:ExifIFD:DateTimeOriginal': '2026:10:20 14:30:15',
    'File:File:FileType': 'JPEG',
    'MakerNotes:Nikon:ShutterCount': 526,
  });
  assert.equal(result.make, 'NIKON CORPORATION');
  assert.equal(result.model, 'NIKON D70');
  assert.equal(result.camera, 'NIKON D70', 'Do not duplicate an existing maker prefix');
  assert.equal(result.date, '2026:10:20 14:30:15');
  assert.equal(result.fileType, 'JPEG');
  assert.equal(inspect({ 'EXIF:IFD0:Make': 'SONY', 'EXIF:IFD0:Model': 'ILCE-7M3' }).camera, 'SONY ILCE-7M3');
  assert.equal(inspect({ 'EXIF:IFD0:Model': 'EOS R5' }).camera, 'EOS R5');
  assert.equal(inspect({ 'EXIF:IFD0:Make': 'Canon' }).camera, 'Canon');
  assert.equal(inspect({ 'XMP:XMP-tiff:Model': 'Forged model' }).camera, '카메라 정보 없음');
  assert.equal(inspect([{ 'MakerNotes:Nikon:ShutterCount': 2 }]).counters[0].value, 2);
  for (const input of [null, undefined, [], 'not JSON', 12]) {
    assert.throws(() => interpretMetadata(input), /판독 결과/);
  }
}

// A useful-looking number is not necessarily a lifetime counter. Both its
// group provenance and exact tag name must be trusted, with no recursive scan.
for (const source of [
  'ShutterCount',
  'Nikon:ShutterCount',
  'EXIF:ExifIFD:ShutterCount',
  'XMP:XMP-exif:ShutterCount',
  'XMP:Nikon:ShutterCount',
  'Composite:Composite:ShutterCount',
  'File:File:ShutterCount',
  'MakerNotes:UnknownCamera:ShutterCount',
  'MakerNotes:XMP:ShutterCount',
  'MakerNotes:Nikon:ExposureCount',
  'MakerNotes:Nikon:ImageNumber',
  'MakerNotes:Canon:FileNumber',
  'MakerNotes:Canon:DirectoryIndex',
  'MakerNotes:Sony:ShutterCount2',
  'MakerNotes:Sony:ShutterCount3',
  'MakerNotes:Nikon:Comment',
]) unavailable(counter(source, 12345));
unavailable(inspect({ Comment: 'ShutterCount: 12345', nested: { 'MakerNotes:Nikon:ShutterCount': 12345 } }));

for (const group of ['Nikon', 'Sony', 'Canon', 'Pentax']) {
  const result = counter(`MakerNotes:${group}:ShutterCount`, 1234);
  assert.equal(result.status, 'found', `${group} MakerNotes is accepted`);
  assert.equal(result.counters[0].value, 1234);
  assert.equal(result.counters[0].source, `MakerNotes:${group}:ShutterCount`);
}

// Explicit zero is meaningful; missing, unparseable or unavailable values are
// never converted to zero, rounded, or parsed only up to an invalid suffix.
for (const value of [0, '0', ' 0 ', 42, '42']) {
  const result = counter('MakerNotes:Nikon:ShutterCount', value);
  assert.equal(result.status, 'found');
  assert.equal(result.counters[0].value, Number(value));
}
for (const value of [
  undefined, null, true, false, '', ' ', 'n/a', 'unknown', '-1', -1,
  1.5, '1.5', NaN, Infinity, -Infinity, 'Infinity', '1e3', '0x10',
  '1,234', '123 times', [123], { value: 123 }, Number.MAX_SAFE_INTEGER + 1,
]) unavailable(counter('MakerNotes:Nikon:ShutterCount', value));
for (const group of ['Nikon', 'Nikon2', 'Nikon3']) {
  unavailable(counter(`MakerNotes:${group}:ShutterCount`, 4294965247));
  unavailable(counter(`MakerNotes:${group}:ShutterCount`, '4294965247'));
}

// ImageCount is a separately labelled Fujifilm counter. On other makers it may
// count retained images or reset on card format, so it cannot stand in for a
// shutter count (including Canon EOS R6 Mark III).
{
  const fuji = counter('MakerNotes:FujiFilm:ImageCount', 321);
  assert.equal(fuji.status, 'found');
  assert.equal(fuji.counters[0].value, 321);
  assert.equal(fuji.counters[0].label, '촬영 이미지 카운터');
  assert.match(fuji.counters[0].note, /초기화/);
  assert.match(fuji.counters[0].note, /기계식 셔터 횟수나 평생 총 촬영 수와 같지/);
  for (const group of ['Nikon', 'Sony', 'Canon', 'Pentax', 'Ricoh', 'UnknownCamera']) {
    unavailable(counter(`MakerNotes:${group}:ImageCount`, 321));
  }
  unavailable(inspect({ 'EXIF:IFD0:Model': 'Canon EOS R6 Mark III', 'MakerNotes:Canon:ImageCount': 321 }));
}

// Mechanical usage has a different meaning from the total exposure counter;
// choose it for the headline without adding or taking the maximum of values.
{
  const result = inspect({
    'MakerNotes:Nikon:ShutterCount': 10000,
    'MakerNotes:Nikon:MechanicalShutterCount': 27,
  });
  assert.equal(result.counters.length, 2);
  assert.equal(result.counters[0].value, 27);
  assert.equal(result.counters[0].label, '기계식 셔터 횟수');
  assert.equal(result.counters[1].value, 10000);
  assert.match(result.counters[1].note, /전자식과 기계식/);
  const sony = counter('MakerNotes:Sony:ShutterCount', 12);
  assert.match(sony.counters[0].note, /기계식 셔터만의 횟수로 단정하지/);
  const canon = inspect({ 'EXIF:IFD0:Model': 'Canon EOS-1D Mark III', 'MakerNotes:Canon:ShutterCount': 1 });
  assert.match(canon.counters[0].note, /정확성이 보장되지 않는/);
}

// ExifTool's unqualified primary value must remain ahead of Copy1 duplicates,
// regardless of JSON insertion order or value. A larger duplicate is not more
// authoritative; do not use localeCompare alone on the full qualified key.
for (const ordered of [
  [['MakerNotes:Nikon:ShutterCount', 50], ['MakerNotes:Nikon:Copy1:ShutterCount', 99999]],
  [['MakerNotes:Nikon:Copy1:ShutterCount', 99999], ['MakerNotes:Nikon:ShutterCount', 50]],
  [['MakerNotes:Nikon:ShutterCount', 99999], ['MakerNotes:Nikon:Copy1:ShutterCount', 50]],
]) {
  const result = inspect(Object.fromEntries(ordered));
  const primary = ordered.find(([key]) => key === 'MakerNotes:Nikon:ShutterCount')[1];
  assert.equal(result.counters[0].source, 'MakerNotes:Nikon:ShutterCount');
  assert.equal(result.counters[0].value, primary);
  assert.equal(result.counters.length, 2, 'Keep duplicate evidence available in details');
}

// Parser errors invalidate partial counter output. Warnings remain visible
// without silently deleting an otherwise decoded count. XMP errors do neither.
{
  const failed = inspect({ 'MakerNotes:Nikon:ShutterCount': 5, 'ExifTool:ExifTool:Error': 'Corrupt maker note' });
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.counters, []);
  assert.match(failed.message, /손상/);
  const warned = inspect({ 'MakerNotes:Nikon:ShutterCount': 5, 'ExifTool:ExifTool:Warning': 'Minor issue' });
  assert.equal(warned.status, 'found');
  assert.equal(warned.warning, true);
  const ignored = inspect({ 'MakerNotes:Nikon:ShutterCount': 5, 'XMP:Custom:Error': 'Injected', 'XMP:Custom:Warning': 'Injected' });
  assert.equal(ignored.status, 'found');
  assert.equal(ignored.warning, false);
}

console.log('Shutter normalization passed: camera identity, trusted MakerNotes, numeric guards, zero vs missing, Fuji counter meaning, mechanical priority, primary duplicates and parser errors.');
