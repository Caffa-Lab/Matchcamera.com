export const LIMITS = {files:10, fileBytes:50_000_000, batchBytes:200_000_000, pixels:100_000_000};
const TYPES = new Set(['image/jpeg','image/png','image/webp']);
export function validateFiles(files) {
  const list = Array.from(files);
  if (!list.length) throw new Error('사진을 선택해 주세요.');
  if (list.length > LIMITS.files) throw new Error('한 번에 최대 10장까지 처리할 수 있습니다.');
  let total = 0;
  for (const file of list) {
    if (!TYPES.has(file.type)) throw new Error('JPEG·PNG·WebP 정지 사진을 선택해 주세요. RAW·HEIC는 지원하지 않습니다.');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > LIMITS.fileBytes) throw new Error('사진 한 장은 50MB 이하인 파일이어야 합니다.');
    total += file.size;
  }
  if (total > LIMITS.batchBytes) throw new Error('선택한 사진의 합계는 200MB 이하여야 합니다.');
  return list;
}

export function outputDimensions(width, height, edge = 0) {
  if (![width,height].every(n => Number.isInteger(n) && n > 0) || width*height > LIMITS.pixels) throw new Error('사진 크기가 지원 범위를 벗어납니다. 최대 1억 화소까지 지원합니다.');
  if (![0,1920,2400,4000].includes(edge)) throw new Error('긴 변 크기를 다시 선택해 주세요.');
  const scale = edge ? Math.min(1, edge/Math.max(width,height)) : 1;
  return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};
}

// Inspect container headers only, never pixel bytes, to reject an encoder that
// unexpectedly included EXIF, IPTC, XMP or text/comment metadata.
export function hasPrivateMetadata(buffer, type) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const ascii = (at,length) => String.fromCharCode(...bytes.subarray(at,at+length));
  if (type === 'image/jpeg') {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error('JPEG 출력 형식을 확인하지 못했습니다.');
    let offset = 2;
    while (offset+1 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error('JPEG 구조를 확인하지 못했습니다.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) return false;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset+2 > bytes.length) throw new Error('JPEG 구조를 확인하지 못했습니다.');
      const length = view.getUint16(offset);
      if (length < 2 || offset+length > bytes.length) throw new Error('JPEG 구조를 확인하지 못했습니다.');
      if ([225,237,254].includes(marker)) return true;
      offset += length;
      if (marker === 218) {
        // Scan entropy data without decoding it. FF00 is a stuffed pixel byte;
        // restart markers also belong to the scan. Other markers start a new
        // segment, including metadata between progressive JPEG scans.
        while (offset < bytes.length) {
          if (bytes[offset] !== 255) {offset++;continue;}
          const start = offset;
          while (bytes[offset] === 255) offset++;
          const next = bytes[offset];
          if (next === 0 || next >= 208 && next <= 215) {offset++;continue;}
          offset = start;break;
        }
      }
    }
    throw new Error('JPEG 이미지 정보를 확인하지 못했습니다.');
  }
  if (type === 'image/png') {
    if (ascii(1,3) !== 'PNG' || bytes[0] !== 137 || bytes[4] !== 13 || bytes[5] !== 10 || bytes[6] !== 26 || bytes[7] !== 10) throw new Error('PNG 출력 형식을 확인하지 못했습니다.');
    let offset = 8;
    while (offset+12 <= bytes.length) {
      const length = view.getUint32(offset), name = ascii(offset+4,4);
      if (offset+12+length > bytes.length) throw new Error('PNG 구조를 확인하지 못했습니다.');
      if (['eXIf','tEXt','iTXt','zTXt'].includes(name)) return true;
      if (name === 'IEND') return false;
      offset += length+12;
    }
    throw new Error('PNG 이미지 정보를 확인하지 못했습니다.');
  }
  if (type === 'image/webp') {
    if (ascii(0,4) !== 'RIFF' || ascii(8,4) !== 'WEBP' || bytes.length < 12 || view.getUint32(4,true)+8 !== bytes.length) throw new Error('WebP 출력 형식을 확인하지 못했습니다.');
    let offset = 12;
    while (offset+8 <= bytes.length) {
      const name = ascii(offset,4), length = view.getUint32(offset+4,true);
      if (offset+8+length > bytes.length) throw new Error('WebP 구조를 확인하지 못했습니다.');
      if (['EXIF','XMP '].includes(name)) return true;
      offset += 8+length+(length%2);
    }
    if (offset !== bytes.length) throw new Error('WebP 구조를 확인하지 못했습니다.');
    return false;
  }
  throw new Error('출력 형식을 확인하지 못했습니다.');
}

export async function cleanPhoto(file, {type='image/jpeg',quality=.94,edge=0}={}, platform=globalThis) {
  validateFiles([file]);
  if (!TYPES.has(type) || !Number.isFinite(quality) || quality < .8 || quality > 1) throw new Error('출력 설정을 확인해 주세요.');
  let image, sourceUrl, canvas;
  try {
    if (typeof platform.createImageBitmap === 'function') image = await platform.createImageBitmap(file,{imageOrientation:'from-image'});
    else {
      sourceUrl = platform.URL.createObjectURL(file);
      image = new platform.Image(); image.src = sourceUrl; await image.decode();
    }
    const size = outputDimensions(image.naturalWidth || image.width,image.naturalHeight || image.height,edge);
    canvas = platform.document.createElement('canvas'); canvas.width=size.width; canvas.height=size.height;
    const context=canvas.getContext('2d');
    if (!context) throw new Error('브라우저에서 이미지 작업 공간을 만들지 못했습니다.');
    if (type === 'image/jpeg') {context.fillStyle='#fff';context.fillRect(0,0,size.width,size.height);}
    context.drawImage(image,0,0,size.width,size.height);
    const blob = await new Promise((resolve,reject)=>canvas.toBlob(result=>result ? resolve(result) : reject(new Error('사진을 내보내지 못했습니다.')) ,type,quality));
    if (blob.type !== type) throw new Error('이 브라우저는 선택한 저장 형식을 지원하지 않습니다. PNG 또는 JPEG로 다시 시도해 주세요.');
    if (await hasPrivateMetadata(await blob.arrayBuffer(),type)) throw new Error('출력에 메타데이터가 남아 저장을 중단했습니다. 다른 형식으로 시도해 주세요.');
    return {blob,...size};
  } finally {
    image?.close?.();
    if (sourceUrl) platform.URL.revokeObjectURL(sourceUrl);
    if (canvas) canvas.width=canvas.height=1;
  }
}

export const outputName = (index,type) => `matchcamera-clean-${String(index+1).padStart(3,'0')}.${({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[type] || 'jpg'}`;
