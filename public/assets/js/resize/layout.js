export const EQUIPMENT_PANEL_RATIO = .18;

export function getEffectiveRatio(value, width, height) {
  if (value === 'none') return null;
  if (value === 'auto') return width >= height ? 5 / 4 : 4 / 5;
  const [a, b] = String(value).split(':').map(Number);
  return a > 0 && b > 0 ? a / b : null;
}

export function calculateCrop(width, height, ratio, shift = 0) {
  if (!ratio) return { x: 0, y: 0, width, height };
  const cropWidth = Math.min(width, height * ratio);
  const cropHeight = Math.min(height, width / ratio);
  const position = (Math.max(-1, Math.min(1, Number(shift) || 0)) + 1) / 2;
  return { x: (width - cropWidth) * position, y: (height - cropHeight) * position, width: cropWidth, height: cropHeight };
}

export function calculateBorderFrame(width, height, ratio) {
  const frameWidth = ratio ? Math.max(width, height * ratio) : width;
  const frameHeight = ratio ? Math.max(height, width / ratio) : height;
  return { width: frameWidth, height: frameHeight, offsetX: (frameWidth - width) / 2, offsetY: (frameHeight - height) / 2 };
}

// An active ratio reserves the panel inside the final frame. Without a ratio,
// keep the photo area unchanged and append the panel below it.
export function calculateLayout(sourceWidth, sourceHeight, options = {}, shift = 0) {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('사진 크기를 확인할 수 없습니다.');
  const ratio = options.cropEnabled || options.borderEnabled
    ? getEffectiveRatio(options.cropRatio, sourceWidth, sourceHeight) : null;
  const isCrop = Boolean(options.cropEnabled && ratio);
  const frame = isCrop ? calculateCrop(sourceWidth, sourceHeight, ratio)
    : options.borderEnabled ? calculateBorderFrame(sourceWidth, sourceHeight, ratio)
    : { width: sourceWidth, height: sourceHeight };
  const width = Math.max(1, Math.round(frame.width));
  const frameHeight = Math.max(1, Math.round(frame.height));
  const panelHeight = !options.equipmentEnabled ? 0 : ratio
    ? Math.min(frameHeight - 1, Math.max(1, Math.round(Math.min(width * EQUIPMENT_PANEL_RATIO, frameHeight * .30))))
    : Math.max(1, Math.round(width * EQUIPMENT_PANEL_RATIO));
  const photoHeight = ratio ? frameHeight - panelHeight : frameHeight;
  const height = photoHeight + panelHeight;
  const crop = isCrop ? calculateCrop(sourceWidth, sourceHeight, width / photoHeight, shift)
    : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  let placement = { x: 0, y: 0, width, height: photoHeight };
  if (!isCrop) {
    const border = options.borderEnabled ? Math.max(.01, Math.min(.30, (Number(options.borderSize) || 5) / 100)) : 0;
    const scale = Math.min(width * (1 - border * 2) / sourceWidth, photoHeight * (1 - border * 2) / sourceHeight);
    placement = { x: (width - sourceWidth * scale) / 2, y: (photoHeight - sourceHeight * scale) / 2, width: sourceWidth * scale, height: sourceHeight * scale };
  }
  return { width, height, photoHeight, panelHeight, ratio, mode: isCrop ? 'crop' : 'contain', crop, placement };
}
