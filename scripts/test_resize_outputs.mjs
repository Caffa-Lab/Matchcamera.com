import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { defaultSettings } from '../public/assets/js/resize/state.js';
import { equipmentText, productName, findProduct } from '../public/assets/js/resize/equipment-match.js';

const source = await fs.readFile(new URL('../public/assets/js/resize/app.js', import.meta.url), 'utf8');
const elements = new Map();
const created = [];
const radios = new Map();
function element() {
  const classes = new Set();
  const listeners = new Map();
  let html = '';
  return {
    value: '', checked: false, disabled: false, textContent: '', children: [], style: {}, attributes: {}, files: [],
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; this.children = []; },
    append(child) { this.children.push(child); }, remove() {}, click() { return this.fire('click'); },
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    fire(type, extra = {}) { return Promise.all((listeners.get(type) || []).map(callback => callback({ target: this, preventDefault() {}, stopPropagation() {}, ...extra }))); },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return element(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0 }; },
    setPointerCapture() {}, hasPointerCapture() { return false; },
  };
}
const get = name => {
  if (!elements.has(name)) elements.set(name, element());
  return elements.get(name);
};
for (const [name, values] of [['border-color', ['white', 'black']], ['wm-position', ['center', 'left', 'right', 'custom']], ['save-mode', ['quality', 'size']]]) {
  radios.set(name, values.map((value, index) => Object.assign(element(), { value, checked: index === 0 })));
}
const radio = (name, value) => radios.get(name).forEach(input => { input.checked = input.value === value; });
const metadata = defaultSettings.metadataOptions.map(value => Object.assign(element(), { value, checked: true }));
get('metadata-options').querySelectorAll = selector => selector === 'input:checked' ? metadata.filter(input => input.checked) : metadata;
get('border-color-field').querySelectorAll = () => radios.get('border-color');
const document = {
  querySelector(selector) {
    const data = selector.match(/^\[data-(.+)\]$/);
    if (data) return get(data[1]);
    const name = selector.match(/name="([^"]+)"/)?.[1];
    const value = selector.match(/value="([^"]+)"/)?.[1];
    return (radios.get(name) || []).find(input => value ? input.value === value : input.checked) || null;
  },
  querySelectorAll(selector) {
    const name = selector.match(/name="([^"]+)"/)?.[1];
    return name ? radios.get(name) || [] : [...elements.values(), ...radios.values()].flat().concat(created);
  },
  createElement() { const item = element(); created.push(item); return item; }, body: element(),
};
const revoked = [];
const downloads = [];
const workerOptions = [];
let nextUrl = 0;
let failImage = false;
let imageReady = null;
const context = vm.createContext({
  document, window: { addEventListener() {} }, defaultSettings,
  loadSettings: () => structuredClone(defaultSettings), saveSettings() {},
  equipmentText, productName, findProduct, loadWatermarkEquipment: async () => [],
  createPhotoState: file => ({ id: file.name, file, url: `photo:${file.name}`, rotation: 0, cropShift: 0, watermarkX: .5, watermarkY: .5 }),
  disposePhotoState() {}, clearImageCache() {}, parseExif: async () => ({}),
  renderPreview: async () => null, applyMetadataPolicy: async (_file, blob) => blob,
  trackUsage() {}, alert() {}, console, setTimeout, clearTimeout,
  URL: { createObjectURL: () => `blob:new-${++nextUrl}`, revokeObjectURL: url => revoked.push(url) },
  Worker: class { constructor(url, options) { workerOptions.push({ url, options }); } terminate() {} },
  Image: class { async decode() { if (imageReady) await imageReady; if (failImage) throw new Error('Invalid image'); } },
});
const bootless = source.replace(/^import .*;\r?\n/gm, '').replace(
  /hydrateControls\(\);\s*bindEvents\(\);\s*renderAll\(\);\s*const productsReady = initializeProducts\(\);/,
  'const productsReady = Promise.resolve();',
);
assert.notEqual(bootless, source);
vm.runInContext(bootless, context);
const run = code => vm.runInContext(code, context);
context.downloadBlob = (blob, name) => downloads.push({ blob, name });
context.runWorkerJob = async () => ({ blob: new Blob(['result']), width: 100, height: 125 });
run('bindEvents()');

function reset() {
  run(`invalidateOutputs(false); settings = loadSettings(); processing = false; zipping = false;
    photos = [0, 1].map(index => ({id: 'photo-' + index, file: {name: 'photo-' + index + '.jpg'}, url: 'photo:' + index,
      rotation: 0, cropShift: 0, watermarkX: .5, watermarkY: .5, bodyRaw: '', lensRaw: '', body: null, lens: null}));
    activeIndex = 0; bodies = [{id:'canon', officialName:'Canon EOS R50', model:'EOS R50', type:'바디'}];
    hydrateControls(); renderAll();`);
  radio('border-color', 'white'); radio('wm-position', 'center'); radio('save-mode', 'quality');
  revoked.length = 0;
}
function seed() {
  run(`invalidateOutputs(false); outputs = [
    {name:'old-a.jpg',url:'blob:old-a',blob:{size:100},width:2400,height:3000},
    {name:'old-b.jpg',url:'blob:old-b',blob:{size:100},width:2400,height:3000}];
    renderOutputList(); refs.downloadZip.disabled = false; updateProgress(1, '완료');`);
  revoked.length = 0;
}
function discarded(message) {
  assert.equal(run('outputs.length'), 0, message);
  assert(revoked.includes('blob:old-a') && revoked.includes('blob:old-b'), `${message}: both URLs released`);
  assert.equal(get('output-list').children.length, 0, `${message}: old download buttons removed`);
  assert.equal(get('download-zip').disabled, true, `${message}: ZIP unavailable`);
  assert.equal(get('progress-text').textContent, '설정이 바뀌었습니다. 처리 시작을 눌러 결과를 다시 만들어 주세요.');
}
function cropMode() {
  get('crop-enabled').checked = true;
  get('crop-ratio').value = '4:5';
  run('syncSettings()');
}

reset(); cropMode(); seed();
get('crop-ratio').value = '5:4'; await get('crop-ratio').fire('change');
discarded('Changing ratio invalidates previously encoded JPEGs');

reset(); seed(); get('crop-enabled').checked = true; await get('crop-enabled').fire('change');
discarded('Enabling cropping invalidates previous output');

reset(); seed(); get('grid-enabled').checked = true; await get('grid-enabled').fire('change');
get('watermark-all').checked = false; await get('watermark-all').fire('change');
run('setActive(1)');
assert.equal(run('outputs.length'), 2, 'Grid, future drag scope and selecting another photo do not alter encoded pixels');
assert.deepEqual(revoked, []);

reset(); cropMode(); seed(); get('crop-shift').value = '.42'; await get('crop-shift').fire('input');
discarded('Changing crop position invalidates previous output');
seed(); run('photo = currentPhoto(); photo.cropShift = 1; handleWheel({deltaY:10,preventDefault(){}})');
assert.equal(run('outputs.length'), 2, 'A wheel event beyond the existing crop bound changes nothing');
run('handleWheel({deltaY:-10,preventDefault(){}})'); discarded('Wheel crop change');

reset(); seed(); await get('rotate').fire('click'); discarded('Rotation');
assert.equal(run('photos[0].rotation'), 90);

reset(); seed();
run(`settings.watermarkEnabled = true; settings.watermarkPosition = 'custom'; settings.watermarkAll = false;
  isDraggingWatermark = true; previewGeometry = {watermarkRect:{target:{x:0,y:0,width:100,height:100}}};
  moveWatermarkDrag({clientX:70,clientY:40});`);
discarded('Moving a watermark');
assert.equal(run('photos[0].watermarkX'), .7);
assert.equal(run('photos[1].watermarkX'), .5);

reset(); seed(); get('equipment-body').value = 'EOS R50'; await get('equipment-body').fire('change');
discarded('Manual equipment selection');
assert.equal(run('photos[0].body.id'), 'canon');
seed(); await get('equipment-apply-all').fire('click'); discarded('Applying equipment to all photos');
assert.equal(run('photos[1].body.id'), 'canon');

reset(); seed(); metadata[0].checked = false; await get('save-metadata').fire('click');
discarded('Metadata selection');
seed(); await get('reset-metadata').fire('click'); discarded('Metadata reset');
seed(); get('remove-metadata').checked = false; await get('remove-metadata').fire('change');
discarded('Metadata removal switch');

reset(); seed(); run('addFiles([{name:"third.jpg",type:"image/jpeg"}])'); discarded('Adding a photo');
await run('photos.at(-1).equipmentReady');
seed(); run('removePhoto(1)'); discarded('Removing a photo');
seed(); run('clearAll()');
assert.equal(run('outputs.length'), 0); assert.equal(run('photos.length'), 0);
assert.deepEqual(revoked, ['blob:old-a', 'blob:old-b']);
assert.equal(get('download-zip').disabled, true);

reset(); seed();
let finishImage;
imageReady = new Promise(resolve => { finishImage = resolve; });
get('watermark-input').files = [{name:'logo.png'}];
const loading = run('loadWatermark()');
assert.equal(get('process').disabled, true, 'Do not export with an older watermark while replacement is decoding');
const workerCount = workerOptions.length;
await run('processAll()'); assert.equal(workerOptions.length, workerCount);
finishImage(); await loading; imageReady = null;
discarded('Replacing watermark image');
const firstWatermarkUrl = run('watermarkUrl');
seed(); get('watermark-input').files = [{name:'second.png'}]; await run('loadWatermark()');
assert(revoked.includes(firstWatermarkUrl), 'The previous decoded watermark URL is released after replacement');
discarded('Replacing an already enabled watermark');
const currentWatermark = run('watermarkFile');
failImage = true; get('watermark-input').files = [{name:'invalid.png'}]; await run('loadWatermark()'); failImage = false;
assert.equal(run('watermarkFile'), currentWatermark, 'A failed replacement preserves the previous working watermark');

reset(); seed(); await run('processAll()');
assert.equal(get('crop-ratio').disabled, true, 'Ratio remains unavailable when both modes are off after export');
assert.equal(get('target-size').disabled, true, 'Quality mode keeps the target-size input disabled');
assert.equal(get('border-size').disabled, true);
assert.equal(get('crop-shift').disabled, true);
assert.equal(get('download-zip').disabled, false);
assert.equal(run('outputs.length'), 2);
assert(revoked.includes('blob:old-a') && revoked.includes('blob:old-b'));
assert.equal(workerOptions.at(-1).url, '/program/resize/workers/image-worker.js?v=20260920-ratio');
assert.equal(workerOptions.at(-1).options.type, 'module');

reset(); cropMode(); radio('save-mode', 'size'); run('syncSettings()');
context.runWorkerJob = async () => {
  run('renderAll()');
  assert.equal(get('crop-ratio').disabled, true, 'A late EXIF redraw cannot unlock controls during processing');
  assert.equal(get('rotate').disabled, true);
  assert.equal(get('process').disabled, true);
  return {blob:new Blob(['result']),width:100,height:125};
};
await run('processAll()');
assert.equal(get('crop-ratio').disabled, false, 'Active crop mode restores the ratio selector');
assert.equal(get('target-size').disabled, false, 'Size mode restores the target-size input');
assert.equal(get('crop-shift').disabled, false);

reset(); seed();
context.Worker = class { constructor() { throw new Error('Worker unsupported'); } };
await run('processAll()');
assert.equal(run('processing'), false);
assert.equal(get('crop-ratio').disabled, true, 'Failure recovery also restores conditional controls');
assert.equal(get('process').disabled, false);

reset(); cropMode(); seed();
let finishZip, zipProgress;
context.window.JSZip = class {
  file() {}
  generateAsync(_options, onProgress) { zipProgress = onProgress; return new Promise(resolve => { finishZip = resolve; }); }
};
const zip = run('downloadZip()');
assert.equal(get('download-zip').disabled, true);
get('crop-ratio').value = '5:4'; await get('crop-ratio').fire('change');
discarded('Changing settings during ZIP creation');
zipProgress({percent:60});
assert.match(get('progress-text').textContent, /설정이 바뀌었습니다/);
finishZip(new Blob(['zip'])); await zip;
assert.equal(downloads.length, 0, 'An outdated ZIP must not download after settings change');
assert.equal(get('download-zip').disabled, true);

seed(); const gridZip = run('downloadZip()');
get('grid-enabled').checked = true; await get('grid-enabled').fire('change');
finishZip(new Blob(['zip'])); await gridZip;
assert.equal(downloads.length, 1, 'A preview-only grid change does not cancel a valid ZIP');
assert.equal(get('download-zip').disabled, false);

console.log('Resize output tests passed: stale JPEG/ZIP removal, URL cleanup, output-affecting handlers, preview-only changes and conditional control recovery.');
