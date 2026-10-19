/**
 * Rebuild the self-hosted shutter-reader runtime from pinned npm packages.
 * First install without lifecycle scripts (the directory is gitignored):
 * npm install --prefix tmp/shutter-build --ignore-scripts --no-audit --no-fund --save-exact @uswriting/exiftool@1.0.9 @6over3/zeroperl-ts@1.0.10
 * Then: node scripts/build_shutter_vendor.mjs
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(ROOT, 'tmp/shutter-build/node_modules');
const OUTPUT = path.join(ROOT, 'public/assets/vendor/exiftool');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const records = [];

async function packageFile(packageName, version, relative) {
  const folder = path.join(INPUT, packageName);
  const metadata = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  assert.equal(metadata.version, version, `${packageName} version must remain pinned`);
  return readFile(path.join(folder, relative));
}

function replaceOnce(text, from, to) {
  assert.equal(text.split(from).length, 2, `Expected one upstream fragment: ${from}`);
  return text.replace(from, to);
}

async function save(name, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  assert(buffer.length <= 25 * 1024 * 1024, `${name} exceeds Cloudflare's per-asset limit`);
  await writeFile(path.join(OUTPUT, name), buffer);
  records.push({file: name, bytes: buffer.length, sha256: sha256(buffer)});
}

async function license(name, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot retrieve ${name}: HTTP ${response.status}`);
  await save(name, Buffer.from(await response.arrayBuffer()));
}

await mkdir(OUTPUT, {recursive: true});
let exiftool = (await packageFile('@uswriting/exiftool', '1.0.9', 'dist/esm/index.js')).toString('utf8');
exiftool = replaceOnce(exiftool, 'from"@6over3/zeroperl-ts"', 'from"./zeroperl.js"');
await save('exiftool.js', '// Matchcamera modification: resolve the pinned runtime locally; see NOTICE.txt.\n' + exiftool);

let zeroperl = (await packageFile('@6over3/zeroperl-ts', '1.0.10', 'dist/esm/index.js')).toString('utf8');
zeroperl = replaceOnce(zeroperl, 'var q="./zeroperl.wasm";', 'var q=new URL("./zeroperl.wasm",import.meta.url).href;');
zeroperl = replaceOnce(zeroperl, 'return typeof window<"u"&&typeof document<"u"', 'return(typeof window<"u"&&typeof document<"u")||typeof WorkerGlobalScope<"u"');
await save('zeroperl.js', '// Matchcamera modifications: module-relative local WASM URL and Web Worker detection; see NOTICE.txt.\n' + zeroperl);
await save('zeroperl.wasm', await packageFile('@6over3/zeroperl-ts', '1.0.10', 'dist/esm/zeroperl.wasm'));
await save('LICENSE-Apache-2.0.txt', await packageFile('@uswriting/exiftool', '1.0.9', 'LICENSE'));

// Pin upstream license/source references so rebuilding cannot silently change them.
await license('LICENSE-zeroperl-MIT.txt', 'https://raw.githubusercontent.com/6over3/zeroperl/c28db5dd4fc9660e67117dfdb9f18a43623f5f3d/LICENSE');
await license('LICENSE-Perl-Artistic.txt', 'https://raw.githubusercontent.com/Perl/perl5/5551b97c3be30b899397b99d57993a39d13294f1/Artistic');
await license('LICENSE-Perl-Copying.txt', 'https://raw.githubusercontent.com/Perl/perl5/5551b97c3be30b899397b99d57993a39d13294f1/Copying');
await license('README-Perl.txt', 'https://raw.githubusercontent.com/Perl/perl5/5551b97c3be30b899397b99d57993a39d13294f1/README');
await license('README-ExifTool.txt', 'https://raw.githubusercontent.com/exiftool/exiftool/a162a723be10dac03b3037f7cc64c1f9c480448e/README');
await license('LICENSE-zlib.txt', 'https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE');
await license('LICENSE-bzip2.txt', 'https://raw.githubusercontent.com/libarchive/bzip2/bzip2-1.0.8/LICENSE');

await save('NOTICE.txt', `Self-hosted metadata reader for Matchcamera

@uswriting/exiftool 1.0.9 and @6over3/zeroperl-ts 1.0.10
Author: 6over3; Apache License 2.0 (LICENSE-Apache-2.0.txt).
Sources: https://github.com/6over3/exiftool
         https://github.com/6over3/zeroperl-ts

The packaged WASM includes Perl 5.42.0 and ExifTool 13.42.
ExifTool copyright 2003-2025 Phil Harvey; same terms as Perl
(Artistic License or GPL). See README-ExifTool.txt and LICENSE-Perl-*.
Sources: https://github.com/exiftool/exiftool/tree/13.42
         https://github.com/Perl/perl5/tree/v5.42.0
The zeroperl runtime glue is copyright (c) 2025 United States Writing
Corportation, MIT License (original spelling retained).
Source: https://github.com/6over3/zeroperl
The runtime also links zlib 1.3.1 and bzip2 1.0.8. Their copyright and
license notices are preserved in LICENSE-zlib.txt and LICENSE-bzip2.txt.

Matchcamera modifications to the JavaScript distribution:
- exiftool.js imports the pinned local zeroperl.js, without a package CDN.
- zeroperl.js resolves zeroperl.wasm relative to its own module URL.
- zeroperl.js recognizes Web Workers as browser contexts.
The WASM bytes are copied unchanged from the pinned npm package.
Rebuild instructions: scripts/build_shutter_vendor.mjs in the source repository.

Only this local WASM asset is fetched by the reader. Selected photos are
read through the File API and never uploaded by the metadata reader.
Do not call parseMetadata concurrently: upstream shares runtime/output state.
`);
await writeFile(path.join(OUTPUT, 'manifest.json'), JSON.stringify({
  exiftoolVersion: '13.42',
  packages: {'@uswriting/exiftool': '1.0.9', '@6over3/zeroperl-ts': '1.0.10'},
  files: records
}, null, 2) + '\n');
console.log(`Vendored ${records.length} assets; WASM ${records.find(item => item.file === 'zeroperl.wasm').bytes} bytes.`);
