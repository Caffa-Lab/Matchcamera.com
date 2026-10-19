# Shutter reader integration fixtures

These are small, metadata-focused test files from ExifTool 13.42. They are
redistributed under ExifTool's Perl Artistic/GPL terms; see LICENSE.txt.
They are not user photographs. The test never contacts a network service.

Upstream revision: `a162a723be10dac03b3037f7cc64c1f9c480448e`.
Source directory: https://github.com/exiftool/exiftool/tree/13.42/t/images

| File | Expected metadata | SHA-256 |
| --- | --- | --- |
| NikonD70.jpg | Nikon D70, ShutterCount 526 | 62aafe7295848d10c88f5d97849a21e9bb60470a31e3e896ff38d26136e50304 |
| Pentax.jpg | Pentax K10D, ShutterCount 1648 (encrypted MakerNote counter) | 554756d3cbbebad49d8ab67ecb8add51740a022015f97d6bd97acce87551a3c6 |
| CanonRaw.cr3 | Canon EOS M50, CR3, no supported shutter counter | dc02aa55e277935b690879584e97c2d013f54d854afaec6f9d3274c99a918fd6 |

The generated 1-pixel PNG used directly in `scripts/test_shutter_reader.mjs`
contains no camera metadata and is expected to return unavailable, not zero.

The test executes the bundled ExifTool WASM against these files and passes its
actual grouped JSON output to the production result interpreter. It verifies
runtime asset checksums, the Cloudflare per-asset size limit, and that only a
local WASM file is loaded. Browser UI verification covers a real Web Worker.
