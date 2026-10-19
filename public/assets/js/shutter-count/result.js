// Only camera MakerNotes counters are accepted. File numbering, XMP and the
// exposures used for one composite image are not lifetime counters.
const MAKERS = new Set(['Nikon', 'Nikon2', 'Nikon3', 'Sony', 'Sony1', 'Sony2', 'Canon', 'FujiFilm', 'Pentax', 'Ricoh', 'Olympus', 'Panasonic', 'Samsung', 'Minolta']);
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MAX_BATCH_FILES = 20;
const EXTENSIONS = /\.(jpe?g|jpe|tiff?|arw|nef|nrw|cr2|cr3|crw|raf|pef|dng|orf|rw2|srw|sr2|srf|rwl|3fr|fff|heic|heif|png|webp)$/i;
export const EXIF_ARGS = ['-json', '-n', '-G0:1:4', '-a', '-Make', '-Model', '-DateTimeOriginal', '-FileType', '-ShutterCount', '-MechanicalShutterCount', '-ImageCount', '-Warning', '-Error'];

export function fileProblem(file) {
  if (!EXTENSIONS.test(file.name || '')) return '지원하는 사진 형식이 아닙니다. 카메라에서 저장한 원본 JPG 또는 RAW 파일을 선택해 주세요.';
  if (!file.size) return '비어 있는 파일입니다.';
  if (file.size > MAX_FILE_BYTES) return '파일당 최대 200MB까지 확인할 수 있습니다.';
  return '';
}

function integer(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}
const clean = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 200) : '';

export function interpretMetadata(input) {
  const record = Array.isArray(input) ? input[0] : input;
  if (!record || typeof record !== 'object') throw new Error('판독 결과를 읽을 수 없습니다.');
  const entries = Object.entries(record).map(([key, value]) => {
    const parts = key.split(':');
    return { key, family: parts[0], group: parts[1], tag: parts.at(-1), value };
  });
  const info = tag => clean(entries.find(entry => entry.tag === tag && ['EXIF', 'QuickTime', 'File', 'MakerNotes'].includes(entry.family))?.value);
  const make = info('Make');
  const model = info('Model');
  const makerName = make.replace(/\s+(?:CORPORATION|CORP\.?|CO\.?\s*,?\s*LTD\.?)$/i, '').trim();
  const camera = model && makerName && !model.toLowerCase().startsWith(makerName.toLowerCase()) ? `${makerName} ${model}` : model || make || '카메라 정보 없음';
  const counters = [];
  for (const entry of entries) {
    if (entry.family !== 'MakerNotes' || !MAKERS.has(entry.group)) continue;
    const value = integer(entry.value);
    if (value === null || (/^Nikon/.test(entry.group) && value === 4294965247)) continue;
    let label, note, priority;
    if (entry.tag === 'MechanicalShutterCount') {
      label = '기계식 셔터 횟수'; priority = 0;
      note = '카메라가 별도로 기록한 기계식 셔터 카운터입니다.';
    } else if (entry.tag === 'ShutterCount') {
      priority = 1;
      label = /^(Nikon|Canon)/.test(entry.group) ? '셔터 횟수 · 전자식 포함 가능' : '셔터 횟수';
      note = entry.group === 'Canon' && /EOS-?1Ds? Mark III/i.test(model)
        ? '이 기종은 같은 펌웨어라도 카운터의 정확성이 보장되지 않는 사례가 있습니다. 중고 거래 등의 판단에는 제조사 점검을 함께 이용해 주세요.'
        : /^(Nikon|Canon)/.test(entry.group)
        ? '기종에 따라 전자식과 기계식 촬영이 함께 집계됩니다. 기계식 셔터 사용량과 같다고 볼 수 없습니다.'
        : entry.group === 'Pentax' ? '라이브뷰·동영상이 포함되지 않을 수 있고, 수리 과정에서 초기화될 수 있습니다.'
        : '집계 방식은 기종·펌웨어에 따라 다릅니다. 기계식 셔터만의 횟수로 단정하지 않습니다.';
    } else if (entry.tag === 'ImageCount' && entry.group === 'FujiFilm') {
      label = '촬영 이미지 카운터'; priority = 2;
      note = '후지필름이 파일에 기록한 이미지 수입니다. 펌웨어 업데이트 등으로 초기화될 수 있으며, 기계식 셔터 횟수나 평생 총 촬영 수와 같지 않을 수 있습니다.';
    } else continue;
    counters.push({ source: entry.key, value, label, note, priority });
  }
  const copyIndex = source => Number(source.match(/:Copy(\d+):/)?.[1] || 0);
  // ExifTool's primary tag wins over duplicate records; never choose by value.
  counters.sort((a, b) => a.priority - b.priority || copyIndex(a.source) - copyIndex(b.source) || a.source.localeCompare(b.source));
  const errors = entries.filter(entry => entry.tag === 'Error' && entry.family === 'ExifTool').map(entry => clean(entry.value));
  const warnings = entries.filter(entry => entry.tag === 'Warning' && entry.family === 'ExifTool').map(entry => clean(entry.value));
  const status = errors.length ? 'error' : counters.length ? 'found' : 'unavailable';
  return {
    status, camera, make, model, date: info('DateTimeOriginal'), fileType: info('FileType'),
    counters: status === 'error' ? [] : counters, warning: warnings.length > 0,
    message: status === 'error' ? '파일이 손상되었거나 이 형식의 메타데이터를 읽을 수 없습니다. 다른 원본 사진으로 확인해 주세요.'
      : status === 'unavailable' ? '이 파일에서 지원하는 셔터 카운터를 찾지 못했습니다. 미지원 기종이거나, 보정·전송 과정에서 촬영 정보가 삭제되었을 수 있습니다. 0회를 의미하지 않습니다.' : '',
  };
}
