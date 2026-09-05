const EXIF_RELATED = new Set(['gps','datetime','camera','lens','serial','copyright','exif','thumbnail']);
const XMP_RELATED = new Set(['xmp','rating','label','lightroom']);
const IPTC_RELATED = new Set(['iptc','keywords','photoshop']);

export async function applyMetadataPolicy(originalFile, encodedBlob, removeMetadata, selectedOptions) {
  if (!/jpe?g/i.test(originalFile.type) && !/\.jpe?g$/i.test(originalFile.name)) return encodedBlob;

  const removeSet = new Set(removeMetadata ? (selectedOptions || []) : []);
  const preserveExif = ![...EXIF_RELATED].some((key) => removeSet.has(key));
  const preserveXmp = ![...XMP_RELATED].some((key) => removeSet.has(key));
  const preserveIptc = ![...IPTC_RELATED].some((key) => removeSet.has(key));
  const preserveIcc = !removeSet.has('icc');

  const [source, output] = await Promise.all([originalFile.arrayBuffer(), encodedBlob.arrayBuffer()]);
  const segments = extractMetadataSegments(new Uint8Array(source)).filter((segment) => {
    if (segment.kind === 'exif') return preserveExif;
    if (segment.kind === 'xmp') return preserveXmp;
    if (segment.kind === 'iptc') return preserveIptc;
    if (segment.kind === 'icc') return preserveIcc;
    return false;
  });
  if (!segments.length) return encodedBlob;

  const encoded = new Uint8Array(output);
  if (encoded[0] !== 0xff || encoded[1] !== 0xd8) return encodedBlob;
  const total = 2 + segments.reduce((sum, segment) => sum + segment.bytes.length, 0) + encoded.length - 2;
  const merged = new Uint8Array(total);
  let offset = 0;
  merged.set(encoded.slice(0, 2), offset); offset += 2;
  for (const segment of segments) {
    const bytes = segment.kind === 'exif' ? resetExifOrientation(segment.bytes) : segment.bytes;
    merged.set(bytes, offset); offset += bytes.length;
  }
  merged.set(encoded.slice(2), offset);
  return new Blob([merged], { type: 'image/jpeg' });
}

function extractMetadataSegments(bytes) {
  const result = [];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return result;
  let offset = 2;
  while (offset + 4 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) break;
    const segment = bytes.slice(offset, offset + 2 + length);
    const payload = segment.slice(4, Math.min(segment.length, 80));
    let kind = null;
    if (marker === 0xe1) {
      const text = ascii(payload);
      kind = text.startsWith('Exif\0\0') ? 'exif' : text.startsWith('http://ns.adobe.com/xap/1.0/') ? 'xmp' : null;
    } else if (marker === 0xe2 && ascii(payload).startsWith('ICC_PROFILE')) kind = 'icc';
    else if (marker === 0xed) kind = 'iptc';
    if (kind) result.push({ kind, bytes: segment });
    offset += 2 + length;
  }
  return result;
}

function ascii(bytes) { return String.fromCharCode(...bytes).replace(/\0+$/g, ''); }


function resetExifOrientation(segmentBytes) {
  try {
    const bytes = new Uint8Array(segmentBytes);
    if (bytes.length < 22 || ascii(bytes.slice(4, 10)) !== 'Exif') return bytes;
    const tiff = 10;
    const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
    const big = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
    if (!little && !big) return bytes;
    const read16 = (offset) => little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1];
    const read32 = (offset) => little
      ? (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
      : ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const ifdOffset = read32(tiff + 4);
    const ifd = tiff + ifdOffset;
    if (ifd + 2 > bytes.length) return bytes;
    const count = read16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > bytes.length) break;
      const tag = read16(entry);
      if (tag !== 0x0112) continue;
      if (little) { bytes[entry + 8] = 1; bytes[entry + 9] = 0; }
      else { bytes[entry + 8] = 0; bytes[entry + 9] = 1; }
      break;
    }
    return bytes;
  } catch {
    return segmentBytes;
  }
}
