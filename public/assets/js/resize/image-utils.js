const imageCache = new Map();
const productImageCache = new Map();

export async function loadHtmlImage(photo) {
  if (imageCache.has(photo.id)) return imageCache.get(photo.id);
  const image = new Image();
  image.decoding = 'async';
  image.src = photo.url;
  await image.decode();
  imageCache.set(photo.id, image);
  return image;
}

export function clearImageCache(photoId) { imageCache.delete(photoId); }

export function getEffectiveRatio(value, width, height) {
  if (value === 'none') return null;
  if (value === 'auto') return width >= height ? 5 / 4 : 4 / 5;
  const [a, b] = String(value).split(':').map(Number);
  return a > 0 && b > 0 ? a / b : null;
}

export function calculateCrop(width, height, ratio, shift = 0) {
  if (!ratio) return { x: 0, y: 0, width, height };
  let cropWidth = width;
  let cropHeight = width / ratio;
  if (cropHeight > height) {
    cropHeight = height;
    cropWidth = height * ratio;
  }
  const maxX = width - cropWidth;
  const maxY = height - cropHeight;
  const normalized = Math.max(-1, Math.min(1, Number(shift) || 0));
  const x = maxX > 0 ? ((normalized + 1) / 2) * maxX : 0;
  const y = maxY > 0 ? ((normalized + 1) / 2) * maxY : 0;
  return { x, y, width: cropWidth, height: cropHeight };
}

export function calculateBorderFrame(width, height, ratio) {
  if (!ratio) return { width, height, offsetX: 0, offsetY: 0 };
  const sourceRatio = width / height;
  let frameWidth = width;
  let frameHeight = height;
  if (sourceRatio > ratio) frameHeight = width / ratio;
  else if (sourceRatio < ratio) frameWidth = height * ratio;
  return {
    width: frameWidth,
    height: frameHeight,
    offsetX: (frameWidth - width) / 2,
    offsetY: (frameHeight - height) / 2
  };
}

export async function renderPreview({ canvas, stage, photo, settings, watermarkImage, shouldRender = () => true }) {
  const image = await loadHtmlImage(photo);
  if (!shouldRender()) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const availableWidth = Math.max(280, stage.clientWidth - 28);
  const availableHeight = Math.max(280, stage.clientHeight - 28);

  const rotated = photo.rotation % 180 !== 0;
  const sourceWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const sourceHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const ratioMode = settings.cropEnabled || settings.borderEnabled;
  const ratio = ratioMode ? getEffectiveRatio(settings.cropRatio, sourceWidth, sourceHeight) : null;

  const crop = settings.cropEnabled
    ? calculateCrop(sourceWidth, sourceHeight, ratio, photo.cropShift)
    : { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  const borderFrame = settings.borderEnabled
    ? calculateBorderFrame(sourceWidth, sourceHeight, ratio)
    : { width: sourceWidth, height: sourceHeight, offsetX: 0, offsetY: 0 };

  const frameWidth = settings.cropEnabled ? crop.width : borderFrame.width;
  const frameHeight = settings.cropEnabled ? crop.height : borderFrame.height;
  const panelEstimate = settings.equipmentEnabled ? Math.min(190, Math.max(90, availableWidth * .18)) : 0;
  const scale = Math.min(availableWidth / frameWidth, Math.max(120, availableHeight - panelEstimate) / frameHeight);
  const displayWidth = Math.max(1, Math.round(frameWidth * scale));
  const displayHeight = Math.max(1, Math.round(frameHeight * scale));
  const equipmentHeight = settings.equipmentEnabled ? Math.min(190, Math.max(90, Math.round(displayWidth * .18))) : 0;

  canvas.width = Math.max(1, Math.round(displayWidth * dpr));
  canvas.height = Math.max(1, Math.round((displayHeight + equipmentHeight) * dpr));
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight + equipmentHeight}px`;

  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (settings.borderEnabled) {
    ctx.fillStyle = settings.borderColor === 'black' ? '#000' : '#fff';
    ctx.fillRect(0, 0, displayWidth, displayHeight);
  }

  let imageRect;
  ctx.save();
  ctx.scale(scale, scale);
  if (settings.borderEnabled) {
    const borderFraction = clampBorderFraction(settings.borderSize);
    const innerWidth = borderFrame.width * (1 - borderFraction * 2);
    const innerHeight = borderFrame.height * (1 - borderFraction * 2);
    const imageScale = Math.min(innerWidth / sourceWidth, innerHeight / sourceHeight);
    const drawWidth = sourceWidth * imageScale;
    const drawHeight = sourceHeight * imageScale;
    const drawX = (borderFrame.width - drawWidth) / 2;
    const drawY = (borderFrame.height - drawHeight) / 2;

    ctx.translate(drawX + drawWidth / 2, drawY + drawHeight / 2);
    ctx.scale(imageScale, imageScale);
    ctx.rotate(photo.rotation * Math.PI / 180);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    imageRect = { x: drawX * scale, y: drawY * scale, width: drawWidth * scale, height: drawHeight * scale };
  } else {
    const originX = settings.cropEnabled ? crop.x : 0;
    const originY = settings.cropEnabled ? crop.y : 0;
    ctx.translate(-originX, -originY);
    ctx.translate(sourceWidth / 2, sourceHeight / 2);
    ctx.rotate(photo.rotation * Math.PI / 180);
    ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
    imageRect = { x: -originX * scale, y: -originY * scale, width: sourceWidth * scale, height: sourceHeight * scale };
  }
  ctx.restore();

  const outputRect = { x: 0, y: 0, width: displayWidth, height: displayHeight };
  if (settings.cropEnabled && ratio) {
    ctx.save();
    ctx.strokeStyle = '#ff4242';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, displayWidth - 2, displayHeight - 2);
    ctx.restore();
  }
  if (settings.gridEnabled) drawGrid(ctx, outputRect);

  let watermarkRect = null;
  if (settings.watermarkEnabled && watermarkImage) {
    watermarkRect = drawWatermark(ctx, watermarkImage, outputRect, photo, settings);
  }
  if (settings.equipmentEnabled) await drawEquipmentPanel(ctx, photo, settings, displayWidth, displayHeight, equipmentHeight);

  canvas.hidden = false;
  return {
    sourceWidth,
    sourceHeight,
    crop,
    borderFrame,
    outputRect,
    equipmentHeight,
    imageRect,
    watermarkRect
  };
}

function clampBorderFraction(value) {
  return Math.max(.01, Math.min(.30, (Number(value) || 5) / 100));
}

function drawGrid(ctx, rect) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.78)';
  ctx.lineWidth = 1;
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 2;
  for (let i = 1; i <= 2; i += 1) {
    const x = rect.x + rect.width * i / 3;
    const y = rect.y + rect.height * i / 3;
    ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.width, y); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(rect.x, rect.y); ctx.lineTo(rect.x + rect.width, rect.y + rect.height); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rect.x + rect.width, rect.y); ctx.lineTo(rect.x, rect.y + rect.height); ctx.stroke();
  ctx.restore();
}

function drawWatermark(ctx, watermark, target, photo, settings) {
  const width = target.width * settings.watermarkSize / 100;
  const height = width * watermark.naturalHeight / watermark.naturalWidth;
  const margin = Math.min(target.width, target.height) * settings.watermarkMargin / 100;
  let centerX = target.x + target.width / 2;
  let centerY = target.y + target.height / 2;
  if (settings.watermarkPosition === 'left') centerX = target.x + margin + width / 2;
  if (settings.watermarkPosition === 'right') centerX = target.x + target.width - margin - width / 2;
  if (settings.watermarkPosition === 'left' || settings.watermarkPosition === 'right') centerY = target.y + target.height - margin - height / 2;
  if (settings.watermarkPosition === 'custom') {
    centerX = target.x + target.width * photo.watermarkX;
    centerY = target.y + target.height * photo.watermarkY;
  }
  const x = Math.max(target.x, Math.min(target.x + target.width - width, centerX - width / 2));
  const y = Math.max(target.y, Math.min(target.y + target.height - height, centerY - height / 2));
  ctx.save();
  ctx.globalAlpha = .9;
  ctx.drawImage(watermark, x, y, width, height);
  ctx.restore();
  return { x, y, width, height, target };
}

async function loadProductImage(src) {
  if (!src) return null;
  if (productImageCache.has(src)) return productImageCache.get(src);
  const promise = new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  productImageCache.set(src, promise);
  return promise;
}

async function drawEquipmentPanel(ctx, photo, settings, width, top, height) {
  const dark = settings.equipmentTheme === 'dark';
  const bodyName = photo.body?.officialName || photo.body?.model || photo.bodyRaw || '카메라 정보 없음';
  const lensName = photo.lens?.officialName || photo.lens?.model || photo.lensRaw || '렌즈 정보 없음';
  const pad = Math.max(18, width * .035);
  const imageArea = settings.equipmentImages ? width * .34 : 0;
  const textWidth = width - pad * 2 - imageArea;
  ctx.save();
  ctx.fillStyle = dark ? '#0b0d10' : '#fff';
  ctx.fillRect(0, top, width, height);
  ctx.fillStyle = dark ? '#fff' : '#090c10';
  ctx.font = `700 ${Math.max(15, height * .16)}px Inter,Arial,sans-serif`;
  ctx.fillText('Shot on', pad, top + height * .27);
  ctx.font = `900 ${fitFont(ctx, `${bodyName} & ${lensName}`, textWidth, Math.max(18, height * .21), 11)}px Inter,Arial,sans-serif`;
  ctx.fillText(`${bodyName} & ${lensName}`, pad, top + height * .57);
  if (settings.equipmentSettings) {
    ctx.fillStyle = dark ? '#b9c1cc' : '#52606d';
    ctx.font = `500 ${Math.max(10, height * .095)}px Inter,Arial,sans-serif`;
    ctx.fillText(photo.settingsText || 'EXIF 촬영 설정 없음', pad, top + height * .80);
  }
  if (settings.equipmentImages) {
    const [bodyImage, lensImage] = await Promise.all([loadProductImage(photo.body?.imageSrc), loadProductImage(photo.lens?.imageSrc)]);
    const each = imageArea / 2;
    if (bodyImage) drawContain(ctx, bodyImage, width - imageArea, top + 6, each, height - 12);
    if (lensImage) drawContain(ctx, lensImage, width - each, top + 6, each, height - 12);
  }
  ctx.restore();
}

function fitFont(ctx, text, maxWidth, initial, minimum) {
  let size = initial;
  while (size > minimum) { ctx.font = `900 ${size}px Inter,Arial,sans-serif`; if (ctx.measureText(text).width <= maxWidth) break; size -= 1; }
  return size;
}

function drawContain(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}
