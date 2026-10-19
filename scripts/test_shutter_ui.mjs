import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { ShutterReader } from '../public/assets/js/shutter-count/client.js';
import { MAX_BATCH_FILES, MAX_FILE_BYTES, fileProblem, interpretMetadata } from '../public/assets/js/shutter-count/result.js';

const fixture = (name = 'photo.jpg', size = 2048) => ({ name, size, type: 'image/jpeg' });
const found = value => interpretMetadata({ 'EXIF:IFD0:Make': 'Nikon', 'EXIF:IFD0:Model': 'Nikon Z 6', 'MakerNotes:Nikon:ShutterCount': value });
const missing = () => interpretMetadata({ 'EXIF:IFD0:Model': 'Canon EOS R5', 'File:File:FileType': 'JPEG' });
const flush = () => new Promise(resolve => setImmediate(resolve));

class FakeWorker {
  constructor() { this.messages = []; this.terminations = 0; }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminations++; }
  send(type, extra = {}, id = this.messages.at(-1).id) { this.onmessage({ data: { id, type, ...extra } }); }
  fail() { let prevented = false; this.onerror({ preventDefault() { prevented = true; } }); return prevented; }
}

// A reader owns one in-flight request. Cancelling releases it immediately, and
// callbacks already queued by a terminated worker cannot affect the next file.
{
  const workers = [];
  const reader = new ShutterReader(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const progress = [];
  const first = reader.read(fixture(), message => progress.push(message));
  const firstRejected = assert.rejects(first, /취소/);
  await assert.rejects(reader.read(fixture('parallel.jpg')), /이전 사진/);
  workers[0].send('progress', { message: 'reading' });
  assert.deepEqual(progress, ['reading']);
  const oldMessage = workers[0].onmessage;
  const oldError = workers[0].onerror;
  const firstId = workers[0].messages[0].id;
  reader.cancel();
  await firstRejected;
  assert.equal(workers[0].terminations, 1);
  assert.equal(reader.pending, null);
  assert.equal(reader.worker, null);

  const second = reader.read(fixture('second.jpg'), message => progress.push(message));
  // Attach a rejection observer now, so a failed isolation assertion does not
  // obscure the useful assertion with an unhandled rejection from this promise.
  second.catch(() => {});
  try {
    const current = reader.pending;
    oldMessage({ data: { id: firstId, type: 'progress', message: 'stale progress' } });
    oldMessage({ data: { id: firstId, type: 'result', result: found(999) } });
    oldMessage({ data: { id: firstId, type: 'error', message: 'stale error message' } });
    oldError({ preventDefault() {} });
    assert.equal(reader.pending, current, 'A stale Worker error must not cancel the new file');
    assert.deepEqual(progress, ['reading'], 'Stale progress is ignored');
    assert.equal(workers[1].terminations, 0, 'Stale callbacks leave the new Worker alive');
    workers[1].send('result', { result: found(42) });
    assert.equal((await second).counters[0].value, 42);
    assert.equal(reader.pending, null);
  } finally { reader.cancel(); }
}

// Worker construction, communication, parsing and execution failures all settle
// the promise. A fresh Worker can be used after an actual runtime failure.
{
  const constructorFailure = new ShutterReader(() => { throw new Error('Worker blocked'); });
  await assert.rejects(constructorFailure.read(fixture()), /Worker blocked/);
  assert.equal(constructorFailure.pending, null);
  const broken = new FakeWorker();
  broken.postMessage = () => { throw new Error('Cannot clone file'); };
  const communicationFailure = new ShutterReader(() => broken);
  await assert.rejects(communicationFailure.read(fixture()), /Cannot clone/);
  assert.equal(communicationFailure.pending, null);
  assert.equal(broken.terminations, 1);

  const workers = [];
  const reader = new ShutterReader(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const parse = reader.read(fixture());
  const parseRejected = assert.rejects(parse, /unsupported metadata/);
  workers[0].send('error', { message: 'unsupported metadata' });
  await parseRejected;
  assert.equal(workers[0].terminations, 1);
  assert.equal(reader.pending, null);
  const runtime = reader.read(fixture());
  const runtimeRejected = assert.rejects(runtime, /실행하지 못했습니다/);
  assert.equal(workers[1].fail(), true);
  await runtimeRejected;
  assert.equal(workers[1].terminations, 1);
  assert.equal(reader.worker, null);
  const recovery = reader.read(fixture());
  workers[2].send('result', { result: found(12) });
  assert.equal((await recovery).counters[0].value, 12);
  reader.disposeWorker();
}

// Exercise the real timeout path without a two-minute wall-clock wait.
{
  const source = await fs.readFile(new URL('../public/assets/js/shutter-count/client.js', import.meta.url), 'utf8');
  let timeout, delay, cleared = 0;
  const context = vm.createContext({
    URL, setTimeout(callback, ms) { timeout = callback; delay = ms; return 71; },
    clearTimeout(id) { assert.equal(id, 71); cleared++; },
  });
  vm.runInContext(source.replace('export class ShutterReader', 'class ShutterReader').replaceAll('import.meta.url', JSON.stringify(import.meta.url)) + '\nglobalThis.Reader = ShutterReader;', context);
  const worker = new FakeWorker();
  const reader = new context.Reader(() => worker);
  const result = reader.read(fixture());
  const rejected = assert.rejects(result, /시간이 초과/);
  assert.equal(delay, 120_000);
  timeout();
  await rejected;
  assert.equal(cleared, 1);
  assert.equal(worker.terminations, 1);
  assert.equal(reader.pending, null);
}

function element(tagName = 'div') {
  const listeners = new Map();
  let content = '';
  const item = {
    tagName, children: [], attributes: {}, className: '', hidden: false, disabled: false, value: '', files: [], clicks: 0,
    get textContent() { return content + this.children.map(child => child.textContent).join(''); },
    set textContent(text) { content = String(text); this.children = []; },
    get lastElementChild() { return this.children.at(-1) || null; },
    // The UI handles untrusted filenames and metadata. Any attempt to interpret
    // them as HTML in this path should fail the test, not pass a permissive mock.
    set innerHTML(_html) { throw new Error('Untrusted result rendering must use textContent'); },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { content = ''; this.children = [...nodes]; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, callback) { listeners.set(type, [...(listeners.get(type) || []), callback]); },
    fire(type, extra = {}) {
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...extra };
      return Promise.all((listeners.get(type) || []).map(callback => callback(event)));
    },
    click() { this.clicks++; return this.fire('click'); },
  };
  item.classList = {
    add(name) { item.className = [...new Set([...item.className.split(' ').filter(Boolean), name])].join(' '); },
    remove(name) { item.className = item.className.split(' ').filter(value => value !== name).join(' '); },
    contains(name) { return item.className.split(' ').includes(name); },
  };
  return item;
}
const descendants = item => [item, ...item.children.flatMap(descendants)];
const byClass = (item, className) => descendants(item).filter(child => child.classList.contains(className));
const appSource = await fs.readFile(new URL('../public/assets/js/shutter-count/app.js', import.meta.url), 'utf8');
function app() {
  const ids = ['fileInput', 'dropzone', 'list', 'status', 'clearResults', 'resultCount', 'emptyResults'];
  const elements = new Map(ids.map(id => [id, element()]));
  const workers = [], window = element('window');
  class Reader extends ShutterReader {
    constructor() { super(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }); }
  }
  const context = vm.createContext({
    document: { getElementById: id => elements.get(id), createElement: element }, window,
    ShutterReader: Reader, MAX_BATCH_FILES, fileProblem, Intl, console,
  });
  vm.runInContext(appSource.replace(/^import .*;\r?\n/gm, ''), context);
  const run = code => vm.runInContext(code, context);
  const start = files => { context.testFiles = files; return run('handleFiles(testFiles)'); };
  return { get: id => elements.get(id), workers, window, run, start, cleanup: () => run('generation++; reader.cancel();') };
}

// Actual app markup contracts and accessible selection work without custom
// keyboard handlers on the native button (which would cause double activation).
const html = await fs.readFile(new URL('../public/program/shutter-count/index.html', import.meta.url), 'utf8');
assert.match(html, /<button[^>]*id="dropzone"[^>]*type="button"/);
assert.match(html, /id="status"[^>]*aria-live="polite"/);
assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)="https?:\/\/(?!matchcamera\.com\/program\/shutter-count\/)/);
for (const id of ['fileInput', 'dropzone', 'list', 'status', 'clearResults', 'resultCount', 'emptyResults']) {
  assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} exists exactly once`);
}

{
  const ui = app();
  try {
    assert.equal(ui.get('resultCount').textContent, '0개');
    assert.equal(ui.get('emptyResults').hidden, false);
    assert.equal(ui.get('clearResults').hidden, true);
    await ui.get('dropzone').click();
    assert.equal(ui.get('fileInput').clicks, 1);
    await ui.start([]);
    assert.equal(ui.workers.length, 0);
    await ui.start(Array.from({ length: MAX_BATCH_FILES + 1 }, (_, index) => fixture(`${index}.jpg`)));
    assert.equal(ui.get('list').children.length, 0, 'An oversized batch is rejected before adding cards');
    assert.match(ui.get('status').textContent, /20개/);

    const malicious = '<img src=x onerror=alert(1)>.jpg';
    const batch = ui.start([fixture('bad.txt'), fixture(malicious), fixture('empty.jpg', 0), fixture('huge.jpg', MAX_FILE_BYTES + 1), fixture('no-counter.jpg')]);
    assert.equal(ui.get('dropzone').disabled, true);
    assert.equal(ui.get('fileInput').disabled, true);
    assert.equal(ui.get('list').attributes['aria-busy'], 'true');
    assert.equal(ui.get('resultCount').textContent, '5개');
    assert.equal(ui.get('emptyResults').hidden, true);
    assert.match(ui.get('clearResults').textContent, /취소/);
    await ui.get('dropzone').click();
    assert.equal(ui.get('fileInput').clicks, 1, 'Selection is gated while busy');
    await ui.start([fixture('ignored-while-busy.jpg')]);
    assert.equal(ui.get('list').children.length, 5);
    const cards = ui.get('list').children;
    assert.match(cards[0].textContent, /지원하는 사진 형식이 아닙니다/);
    assert.equal(ui.workers.length, 1, 'Invalid files never create a Worker job');
    assert.equal(ui.workers[0].messages[0].file.name, malicious);
    ui.workers[0].send('progress', { message: 'testing progress' });
    assert.match(cards[1].textContent, /testing progress/);
    ui.workers[0].send('result', { result: found(0) });
    await flush();
    assert.equal(byClass(cards[1], 'shutter-filename')[0].textContent, malicious, 'Filename markup remains literal text');
    assert.equal(byClass(cards[1], 'shutter-value')[0].textContent, '0회', 'An explicit MakerNotes zero remains a real zero');
    assert.match(cards[2].textContent, /비어 있는 파일/);
    assert.match(cards[3].textContent, /200MB/);
    assert.equal(ui.workers[0].messages.length, 2, 'Only two valid files are sent for reading');
    ui.workers[0].send('result', { result: missing() });
    await batch;
    assert.equal(byClass(cards[4], 'shutter-value').length, 0, 'Missing metadata must not be rendered as a numeric zero');
    assert.match(cards[4].textContent, /확인 불가/);
    assert.match(cards[4].textContent, /0회를 의미하지 않습니다/);
    assert.equal(ui.get('dropzone').disabled, false);
    assert.equal(ui.get('fileInput').disabled, false);
    assert.equal(ui.get('list').attributes['aria-busy'], 'false');
    assert.equal(ui.workers[0].terminations, 1, 'A finished batch releases the WASM Worker');
    assert.equal(ui.get('clearResults').textContent, '결과 지우기');
  } finally { ui.cleanup(); }
}

// Clearing midway through a batch invalidates all delayed callbacks. A new batch
// can start immediately and is not overwritten by the cancelled batch finishing.
{
  const ui = app();
  try {
    const first = ui.start([fixture('cancelled.jpg'), fixture('never-started.jpg')]);
    const oldCard = ui.get('list').children[0];
    const oldWorker = ui.workers[0];
    await ui.get('clearResults').click();
    assert.equal(ui.get('list').children.length, 0);
    assert.equal(ui.get('resultCount').textContent, '0개');
    assert.equal(ui.get('emptyResults').hidden, false);
    assert.equal(ui.get('dropzone').disabled, false);
    assert.equal(oldWorker.terminations, 1);
    const replacement = ui.start([fixture('replacement.jpg')]);
    oldWorker.send('progress', { message: 'CANCELLED PROGRESS' });
    oldWorker.send('result', { result: found(99999) });
    await first;
    assert.equal(ui.get('list').children.length, 1);
    assert.equal(ui.get('dropzone').disabled, true, 'The old batch must not unlock a replacement batch');
    assert.doesNotMatch(oldCard.textContent, /CANCELLED PROGRESS|99,999/);
    assert.equal(oldWorker.messages.length, 1, 'The cancelled queue never starts its second file');
    ui.workers[1].send('result', { result: found(17) });
    await replacement;
    assert.equal(byClass(ui.get('list').children[0], 'shutter-value')[0].textContent, '17회');
    assert.match(ui.get('list').textContent, /replacement\.jpg/);
    assert.equal(ui.get('dropzone').disabled, false);
  } finally { ui.cleanup(); }
}

// A per-file reader failure is visible and does not abandon the remaining batch.
// File input is cleared after every selection so the same filename can be tried.
{
  const ui = app();
  try {
    ui.get('fileInput').value = 'C:\\fakepath\\broken.jpg';
    ui.get('fileInput').files = [fixture('broken.jpg'), fixture('retry.jpg')];
    await ui.get('fileInput').fire('change');
    assert.equal(ui.get('fileInput').value, '');
    ui.workers[0].send('error', { message: '<script>cannot read this file</script>' });
    await flush();
    assert.match(ui.get('list').children[0].textContent, /<script>cannot read this file<\/script>/);
    assert.equal(ui.get('list').children[0].className, 'shutter-card is-error');
    assert.equal(ui.workers.length, 2);
    ui.workers[1].send('result', { result: found(20) });
    await flush();
    assert.equal(byClass(ui.get('list').children[1], 'shutter-value')[0].textContent, '20회');
    assert.equal(ui.get('dropzone').disabled, false);
  } finally { ui.cleanup(); }
}

// Browsers may retain this document in the back/forward cache. Cancelling on
// pagehide must also unlock the retained interface before it is shown again.
{
  const ui = app();
  try {
    const pending = ui.start([fixture('leaving.jpg')]);
    await ui.window.fire('pagehide', { persisted: true });
    await pending;
    assert.equal(ui.workers[0].terminations, 1);
    assert.equal(ui.get('dropzone').disabled, false, 'A bfcache-restored page must accept a new photo');
    assert.equal(ui.get('fileInput').disabled, false);
    assert.equal(ui.get('list').attributes['aria-busy'], 'false');
  } finally { ui.cleanup(); }
}

console.log('Shutter UI/client passed: batch validation, literal text rendering, zero vs missing, cancellation, stale Worker isolation, errors, timeout, and page lifecycle.');
