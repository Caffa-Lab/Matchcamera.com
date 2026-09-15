const RATIOS = Object.freeze({ '4:5': 4 / 5, '1:1': 1, '3:4': 3 / 4 });
const TILE_WIDTHS = new Set([1080, 1440, 2160]);

function finiteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} 값이 올바르지 않습니다.`);
  return value;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) throw new RangeError(`${name} 값은 0보다 커야 합니다.`);
  return number;
}

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function computeCrop(width, height, options = {}) {
  positiveNumber(width, '사진 너비');
  positiveNumber(height, '사진 높이');
  const count = finiteNumber(options.count ?? 3, '사진 수');
  if (!Number.isInteger(count) || count < 2 || count > 10) throw new RangeError('사진 수는 2장부터 10장까지 선택해 주세요.');
  const ratio = options.ratio ?? '4:5';
  if (!Object.hasOwn(RATIOS, ratio)) throw new RangeError('지원하는 비율은 4:5, 1:1, 3:4입니다.');
  const offsetX = clamp(finiteNumber(options.offsetX ?? .5, '가로 위치'), 0, 1);
  const offsetY = clamp(finiteNumber(options.offsetY ?? .5, '세로 위치'), 0, 1);
  const tileRatio = RATIOS[ratio];
  const totalRatio = count * tileRatio;
  const cropWidth = Math.min(width, height * totalRatio);
  const cropHeight = Math.min(height, width / totalRatio);
  const x = (width - cropWidth) * offsetX;
  const y = (height - cropHeight) * offsetY;
  // Reuse the same boundaries for both neighbours; do not round each crop separately.
  const boundaries = Array.from({ length: count + 1 }, (_, index) => x + cropWidth * index / count);
  boundaries[0] = x;
  boundaries[count] = x + cropWidth;
  const tiles = Array.from({ length: count }, (_, index) => ({
    x: boundaries[index], y, width: boundaries[index + 1] - boundaries[index], height: cropHeight,
  }));
  return { x, y, width: cropWidth, height: cropHeight, count, ratio, tileRatio, tiles };
}

function imageSize(image) {
  if (!image) throw new TypeError('사진을 먼저 추가해 주세요.');
  const width = image.naturalWidth ?? image.width;
  const height = image.naturalHeight ?? image.height;
  positiveNumber(width, '사진 너비');
  positiveNumber(height, '사진 높이');
  return { width, height };
}

function outputWidth(options) {
  const width = options.tileWidth ?? 1080;
  if (!TILE_WIDTHS.has(width)) throw new RangeError('출력 너비는 1080, 1440, 2160px 중에서 선택해 주세요.');
  return width;
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('이 브라우저에서 사진을 만들 수 없습니다.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

function watermarkSettings(options) {
  const watermark = options.watermark ?? {};
  if (!watermark.enabled) return null;
  const kind = watermark.kind ?? 'text';
  const position = watermark.position ?? 'right';
  const color = watermark.color ?? 'white';
  if (!['text', 'image'].includes(kind)) throw new RangeError('워터마크 종류가 올바르지 않습니다.');
  if (!['left', 'center', 'right'].includes(position)) throw new RangeError('워터마크 위치가 올바르지 않습니다.');
  if (!['white', 'black'].includes(color)) throw new RangeError('워터마크 색상이 올바르지 않습니다.');
  return {
    kind, position, color,
    text: typeof watermark.text === 'string' ? watermark.text : '',
    size: clamp(finiteNumber(watermark.size ?? 4, '워터마크 크기'), 1, 50),
    margin: clamp(finiteNumber(watermark.margin ?? 3, '워터마크 여백'), 0, 25),
    opacity: clamp(finiteNumber(watermark.opacity ?? 1, '워터마크 불투명도'), 0, 1),
  };
}

function drawWatermark(context, watermark, image, left, width, height) {
  if (!watermark || watermark.opacity === 0) return;
  const margin = Math.min(width, height) * watermark.margin / 100;
  const availableWidth = width - margin * 2;
  const availableHeight = height - margin * 2;
  context.save();
  try {
    context.globalAlpha = watermark.opacity;
    if (watermark.kind === 'image') {
      if (!image) return;
      const dimensions = imageSize(image);
      const scale = Math.min(width * watermark.size / 100 / dimensions.width, availableWidth / dimensions.width, availableHeight / dimensions.height);
      const drawWidth = dimensions.width * scale;
      const drawHeight = dimensions.height * scale;
      const x = watermark.position === 'left' ? margin : watermark.position === 'right' ? width - margin - drawWidth : (width - drawWidth) / 2;
      context.drawImage(image, left + x, height - margin - drawHeight, drawWidth, drawHeight);
      return;
    }
    const text = watermark.text.replace(/[\r\n]+/g, ' ').trim();
    if (!text) return;
    let fontSize = width * watermark.size / 100;
    context.font = `600 ${fontSize}px Arial, sans-serif`;
    const measured = context.measureText(text).width;
    if (measured > availableWidth) fontSize *= availableWidth / measured;
    context.font = `600 ${fontSize}px Arial, sans-serif`;
    context.fillStyle = watermark.color === 'black' ? '#000000' : '#ffffff';
    context.textBaseline = 'bottom';
    context.textAlign = watermark.position;
    const x = watermark.position === 'left' ? margin : watermark.position === 'right' ? width - margin : width / 2;
    context.fillText(text, left + x, height - margin, availableWidth);
  } finally {
    context.restore();
  }
}

export function renderOverview(image, options = {}, watermarkImage = null, maxWidth = 1600) {
  const dimensions = imageSize(image);
  const crop = computeCrop(dimensions.width, dimensions.height, options);
  const tileWidth = outputWidth(options);
  const watermark = watermarkSettings(options);
  positiveNumber(maxWidth, '미리보기 너비');
  const width = Math.max(1, Math.floor(Math.min(maxWidth, tileWidth * crop.count)));
  const height = Math.max(1, Math.round(width / (crop.count * crop.tileRatio)));
  const { canvas, context } = makeCanvas(width, height);
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  for (let index = 0; index < crop.count; index += 1) {
    drawWatermark(context, watermark, watermarkImage, width * index / crop.count, width / crop.count, height);
  }
  return canvas;
}

export function renderTile(image, options = {}, index = 0, watermarkImage = null) {
  const dimensions = imageSize(image);
  const crop = computeCrop(dimensions.width, dimensions.height, options);
  if (!Number.isInteger(index) || index < 0 || index >= crop.count) throw new RangeError('사진 순서가 범위를 벗어났습니다.');
  const width = outputWidth(options);
  const height = Math.round(width / crop.tileRatio);
  const watermark = watermarkSettings(options);
  const { canvas, context } = makeCanvas(width, height);
  // Every tile uses one shared scale and an integer destination translation.
  // Export directly from the original image, never from the overview preview.
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, -index * width, 0, width * crop.count, height);
  drawWatermark(context, watermark, watermarkImage, 0, width, height);
  return canvas;
}

export function canvasToJpeg(canvas, quality = .92) {
  finiteNumber(quality, 'JPEG 화질');
  if (quality < 0 || quality > 1) throw new RangeError('JPEG 화질은 0부터 1 사이여야 합니다.');
  if (typeof canvas?.toBlob === 'function') {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('JPEG 파일을 만들지 못했습니다.')), 'image/jpeg', quality);
    });
  }
  if (typeof canvas?.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality });
  throw new TypeError('저장할 사진이 올바르지 않습니다.');
}

export function outputName(original, index, padding = 2) {
  if (!Number.isInteger(index) || index < 0) throw new RangeError('파일 순서가 올바르지 않습니다.');
  if (!Number.isInteger(padding) || padding < 1 || padding > 6) throw new RangeError('파일 번호 자릿수가 올바르지 않습니다.');
  let base = (typeof original === 'string' ? original : '').split(/[\\/]/).at(-1).replace(/\.[^.]+$/, '')
    .normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[ .]+$/, '').trim();
  if (!base) base = 'photo';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `photo_${base}`;
  base = Array.from(base).slice(0, 160).join('');
  return `${base}_${String(index + 1).padStart(padding, '0')}.jpg`;
}
