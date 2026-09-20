import { calculateLayout } from './layout.js?v=20260920-ratio';
export { getEffectiveRatio, calculateCrop, calculateBorderFrame } from './layout.js?v=20260920-ratio';

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

export async function renderPreview({ canvas, stage, photo, settings, watermarkImage, shouldRender = () => true }) {
  const image = await loadHtmlImage(photo);
  if (!shouldRender()) return null;
  const equipmentImages = settings.equipmentEnabled && settings.equipmentImages
    ? await Promise.all([loadProductImage(photo.body?.imageSrc), loadProductImage(photo.lens?.imageSrc)])
    : [];
  // Finish asynchronous loading before touching the shared preview canvas.
  if (!shouldRender()) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const availableWidth = Math.max(1, stage.clientWidth - 32);
  const availableHeight = Math.max(1, stage.clientHeight - 32);

  const rotated = photo.rotation % 180 !== 0;
  const sourceWidth = rotated ? image.naturalHeight : image.naturalWidth;
  const sourceHeight = rotated ? image.naturalWidth : image.naturalHeight;
  const layout = calculateLayout(sourceWidth, sourceHeight, settings, photo.cropShift);
  const { crop, placement } = layout;
  const scale = Math.min(availableWidth / layout.width, availableHeight / layout.height);
  const displayWidth = layout.width * scale;
  const displayHeight = layout.photoHeight * scale;
  const equipmentHeight = layout.panelHeight * scale;
  const totalHeight = layout.height * scale;

  canvas.width = Math.max(1, Math.round(displayWidth * dpr));
  canvas.height = Math.max(1, Math.round(totalHeight * dpr));
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${totalHeight}px`;

  const ctx = canvas.getContext('2d', { alpha: true });
  ctx.setTransform(canvas.width / displayWidth, 0, 0, canvas.height / totalHeight, 0, 0);
  ctx.clearRect(0, 0, displayWidth, totalHeight);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = settings.borderEnabled
    ? settings.borderColor === 'black' ? '#000' : '#fff'
    : settings.equipmentEnabled && settings.equipmentTheme === 'dark' ? '#0b0d10' : '#fff';
  ctx.fillRect(0, 0, displayWidth, displayHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, displayWidth, displayHeight);
  ctx.clip();
  ctx.scale(scale, scale);
  ctx.translate(placement.x, placement.y);
  ctx.scale(placement.width / crop.width, placement.height / crop.height);
  ctx.translate(-crop.x, -crop.y);
  ctx.translate(sourceWidth / 2, sourceHeight / 2);
  ctx.rotate(photo.rotation * Math.PI / 180);
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  ctx.restore();
  const imageRect = {
    x: (placement.x - crop.x * placement.width / crop.width) * scale,
    y: (placement.y - crop.y * placement.height / crop.height) * scale,
    width: sourceWidth * placement.width / crop.width * scale,
    height: sourceHeight * placement.height / crop.height * scale
  };

  const outputRect = { x: 0, y: 0, width: displayWidth, height: displayHeight };
  if (layout.mode === 'crop') {
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
  if (layout.panelHeight) drawEquipmentPanel(ctx, photo, settings, displayWidth, displayHeight, equipmentHeight, equipmentImages);

  canvas.hidden = false;
  return {
    sourceWidth,
    sourceHeight,
    crop,
    borderFrame: { width: layout.width, height: layout.height },
    layout,
    outputRect,
    equipmentHeight,
    imageRect,
    watermarkRect
  };
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

function drawEquipmentPanel(ctx, photo, settings, width, top, height, equipmentImages) {
  const dark = settings.equipmentTheme === 'dark';
  const bodyName = photo.body?.officialName || photo.body?.model || photo.bodyRaw || '카메라 정보 없음';
  const lensName = photo.lens?.officialName || photo.lens?.model || photo.lensRaw || '렌즈 정보 없음';
  const pad = width * .035;
  const imageArea = settings.equipmentImages ? width * .34 : 0;
  const textWidth = width - pad * 2 - imageArea;
  ctx.save();
  ctx.fillStyle = dark ? '#0b0d10' : '#fff';
  ctx.fillRect(0, top, width, height);
  ctx.fillStyle = dark ? '#fff' : '#090c10';
  ctx.font = `700 ${height * .16}px Arial,sans-serif`;
  ctx.fillText('Shot on', pad, top + height * .27);
  ctx.font = `900 ${fitFont(ctx, `${bodyName} & ${lensName}`, textWidth, height * .21)}px Arial,sans-serif`;
  ctx.fillText(`${bodyName} & ${lensName}`, pad, top + height * .57);
  if (settings.equipmentSettings) {
    ctx.fillStyle = dark ? '#b9c1cc' : '#52606d';
    ctx.font = `500 ${height * .095}px Arial,sans-serif`;
    ctx.fillText(photo.settingsText || 'EXIF 촬영 설정 없음', pad, top + height * .80);
  }
  if (settings.equipmentImages) {
    const [bodyImage, lensImage] = equipmentImages;
    const each = imageArea / 2;
    const inset = height * .032;
    if (bodyImage) drawContain(ctx, bodyImage, width - imageArea, top + inset, each, height - inset * 2);
    if (lensImage) drawContain(ctx, lensImage, width - each, top + inset, each, height - inset * 2);
  }
  ctx.restore();
}

function fitFont(ctx, text, maxWidth, initial) {
  ctx.font = '900 100px Arial,sans-serif';
  const measured = ctx.measureText(text).width || 1;
  return Math.min(initial, maxWidth * 100 / measured);
}

function drawContain(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}
