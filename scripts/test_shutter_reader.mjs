import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseMetadata, dispose} from '../public/assets/vendor/exiftool/exiftool.js';
import {EXIF_ARGS, interpretMetadata} from '../public/assets/js/shutter-count/result.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests/fixtures/shutter-count');
const VENDOR = path.join(ROOT, 'public/assets/vendor/exiftool');
const wasmFile = path.join(VENDOR, 'zeroperl.wasm');
const manifest = JSON.parse(await readFile(path.join(VENDOR, 'manifest.json'), 'utf8'));
for (const asset of manifest.files) {
  const bytes = await readFile(path.join(VENDOR, asset.file));
  assert.equal(bytes.length, asset.bytes, asset.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file);
  assert(bytes.length <= 25 * 1024 * 1024, `${asset.file}: Cloudflare asset size`);
}

// Exercise exactly the browser-worker loader branch without network access.
// The actual module Worker is also checked separately through the browser UI.
const originalWorkerGlobalScope = globalThis.WorkerGlobalScope;
const originalFetch = globalThis.fetch;
globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
globalThis.fetch = () => { throw new Error('The shutter reader must work offline'); };
let localWasmReads = 0;
const loadWasm = async url => {
  assert.equal(fileURLToPath(url), wasmFile, 'only the bundled WASM may be loaded');
  localWasmReads += 1;
  return new Response(await readFile(wasmFile), {headers: {'Content-Type': 'application/wasm'}});
};

async function inspect(name, bytes) {
  const output = await parseMetadata(new File([bytes], name), {
    args: EXIF_ARGS, transform: JSON.parse, fetch: loadWasm
  });
  assert.equal(output.success, true, `${name}: ${output.error || 'parser failed'}`);
  return {raw: output.data[0], result: interpretMetadata(output.data)};
}

try {
  const nikon = await inspect('NikonD70.jpg', await readFile(path.join(FIXTURES, 'NikonD70.jpg')));
  assert.equal(nikon.raw['MakerNotes:Nikon:ShutterCount'], 526);
  assert.equal(nikon.result.status, 'found');
  assert.equal(nikon.result.model, 'NIKON D70');
  assert.equal(nikon.result.counters[0].value, 526);
  assert.equal(nikon.result.counters[0].source, 'MakerNotes:Nikon:ShutterCount');

  const pentax = await inspect('Pentax.jpg', await readFile(path.join(FIXTURES, 'Pentax.jpg')));
  assert.equal(pentax.raw['MakerNotes:Pentax:ShutterCount'], 1648);
  assert.equal(pentax.result.status, 'found');
  assert.equal(pentax.result.model, 'PENTAX K10D');
  assert.equal(pentax.result.counters[0].value, 1648);

  const canon = await inspect('CanonRaw.cr3', await readFile(path.join(FIXTURES, 'CanonRaw.cr3')));
  assert.equal(canon.result.fileType, 'CR3');
  assert.equal(canon.result.model, 'Canon EOS M50');
  assert.equal(canon.result.status, 'unavailable');
  assert.deepEqual(canon.result.counters, []);

  // A valid generated PNG with no camera metadata must not imply zero actuations.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=', 'base64');
  const empty = await inspect('no-metadata.png', png);
  assert.equal(empty.result.status, 'unavailable');
  assert.deepEqual(empty.result.counters, []);
  assert(localWasmReads >= 1, 'WASM was actually read');
  console.log('Shutter WASM integration passed: Nikon 526, Pentax 1648, Canon CR3 and metadata-free PNG unavailable; no network.');
} finally {
  await dispose();
  globalThis.fetch = originalFetch;
  if (originalWorkerGlobalScope === undefined) delete globalThis.WorkerGlobalScope;
  else globalThis.WorkerGlobalScope = originalWorkerGlobalScope;
}
