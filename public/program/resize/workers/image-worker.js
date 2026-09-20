import { calculateLayout } from '../../../assets/js/resize/layout.js?v=20260920-ratio';

self.onmessage = async (event) => {
  const { jobId, file, options, watermarkFile } = event.data;
  try {
    const source = await createImageBitmap(file);
    const watermark = watermarkFile ? await createImageBitmap(watermarkFile) : null;
    const rotation = ((options.rotation % 360) + 360) % 360;
    const rotated = rotation === 90 || rotation === 270;
    const rotatedWidth = rotated ? source.height : source.width;
    const rotatedHeight = rotated ? source.width : source.height;
    const layout = calculateLayout(rotatedWidth, rotatedHeight, options, options.cropShift);

    const fullCanvas = new OffscreenCanvas(rotatedWidth, rotatedHeight);
    const fullCtx = fullCanvas.getContext('2d', { alpha: false });
    fullCtx.fillStyle = '#fff';
    fullCtx.fillRect(0, 0, rotatedWidth, rotatedHeight);
    fullCtx.save();
    fullCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
    fullCtx.rotate(rotation * Math.PI / 180);
    fullCtx.drawImage(source, -source.width / 2, -source.height / 2);
    fullCtx.restore();

    let editedCanvas = new OffscreenCanvas(layout.width, layout.photoHeight);
    const editedCtx = editedCanvas.getContext('2d', { alpha: false });
    editedCtx.imageSmoothingEnabled = true;
    editedCtx.imageSmoothingQuality = 'high';
    editedCtx.fillStyle = options.borderEnabled
      ? options.borderColor === 'black' ? '#000' : '#fff'
      : options.equipmentEnabled && options.equipmentTheme === 'dark' ? '#0b0d10' : '#fff';
    editedCtx.fillRect(0, 0, editedCanvas.width, editedCanvas.height);
    const { crop, placement } = layout;
    editedCtx.drawImage(fullCanvas, crop.x, crop.y, crop.width, crop.height, placement.x, placement.y, placement.width, placement.height);

    if (options.watermarkEnabled && watermark) drawWatermark(editedCtx, watermark, editedCanvas.width, editedCanvas.height, options);
    if (layout.panelHeight) editedCanvas = await appendEquipmentPanel(editedCanvas, options, layout);

    const encoded = options.saveMode === 'size'
      ? await encodeTargetSize(editedCanvas, options.targetBytes)
      : { blob: await editedCanvas.convertToBlob({ type: 'image/jpeg', quality: 1 }), width: editedCanvas.width, height: editedCanvas.height };

    source.close();
    watermark?.close();
    self.postMessage({ jobId, ok: true, ...encoded });
  } catch (error) {
    self.postMessage({ jobId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

function drawWatermark(ctx, watermark, width, height, options) {
  const wmWidth = width * options.watermarkSize / 100;
  const wmHeight = wmWidth * watermark.height / watermark.width;
  const margin = Math.min(width, height) * options.watermarkMargin / 100;
  let centerX = width / 2;
  let centerY = height / 2;
  if (options.watermarkPosition === 'left') { centerX = margin + wmWidth / 2; centerY = height - margin - wmHeight / 2; }
  if (options.watermarkPosition === 'right') { centerX = width - margin - wmWidth / 2; centerY = height - margin - wmHeight / 2; }
  if (options.watermarkPosition === 'custom') { centerX = width * options.watermarkX; centerY = height * options.watermarkY; }
  const x = Math.max(0, Math.min(width - wmWidth, centerX - wmWidth / 2));
  const y = Math.max(0, Math.min(height - wmHeight, centerY - wmHeight / 2));
  ctx.save();
  ctx.globalAlpha = .9;
  ctx.drawImage(watermark, x, y, wmWidth, wmHeight);
  ctx.restore();
}

async function encodeTargetSize(canvas, targetBytes) {
  const quality = .98;
  const first = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  if (first.size <= targetBytes) return { blob: first, width: canvas.width, height: canvas.height };

  let low = .18;
  let high = 1;
  let best = null;
  for (let i = 0; i < 8; i += 1) {
    const scale = (low + high) / 2;
    const test = await encodeScaled(canvas, scale, quality);
    if (test.blob.size <= targetBytes) { best = test; low = scale; }
    else high = scale;
  }
  if (best) return best;

  const minimum = await createScaledCanvas(canvas, low);
  let qLow = .35;
  let qHigh = quality;
  let qualityBlob = await minimum.convertToBlob({ type: 'image/jpeg', quality: qLow });
  for (let i = 0; i < 8; i += 1) {
    const q = (qLow + qHigh) / 2;
    const test = await minimum.convertToBlob({ type: 'image/jpeg', quality: q });
    if (test.size <= targetBytes) { qualityBlob = test; qLow = q; }
    else qHigh = q;
  }
  return { blob: qualityBlob, width: minimum.width, height: minimum.height };
}

async function encodeScaled(canvas, scale, quality) {
  const scaled = await createScaledCanvas(canvas, scale);
  return { blob: await scaled.convertToBlob({ type: 'image/jpeg', quality }), width: scaled.width, height: scaled.height };
}

async function createScaledCanvas(canvas, scale) {
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  const output = new OffscreenCanvas(width, height);
  const ctx = output.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, width, height);
  return output;
}

async function appendEquipmentPanel(sourceCanvas, options, layout) {
  const width = sourceCanvas.width;
  const height = layout.panelHeight;
  const output = new OffscreenCanvas(layout.width, layout.height);
  const ctx = output.getContext('2d', { alpha: false });
  const dark = options.equipmentTheme === 'dark';
  ctx.fillStyle = dark ? '#0b0d10' : '#fff';
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.drawImage(sourceCanvas, 0, 0);
  const top = sourceCanvas.height;
  const pad = width * .035;
  const imageArea = options.equipmentImages ? width * .34 : 0;
  const textWidth = width - pad * 2 - imageArea;
  const bodyName = options.bodyName || '카메라 정보 없음';
  const lensName = options.lensName || '렌즈 정보 없음';
  const equipment = `${bodyName} & ${lensName}`;
  ctx.fillStyle = dark ? '#fff' : '#090c10';
  ctx.font = `700 ${height * .16}px Arial,sans-serif`;
  ctx.fillText('Shot on', pad, top + height * .27);
  const equipmentSize = fitFont(ctx, equipment, textWidth, height * .21);
  ctx.font = `900 ${equipmentSize}px Arial,sans-serif`;
  ctx.fillText(equipment, pad, top + height * .57);
  if (options.equipmentSettings) {
    ctx.fillStyle = dark ? '#b9c1cc' : '#52606d';
    ctx.font = `500 ${height * .095}px Arial,sans-serif`;
    ctx.fillText(options.settingsText || 'EXIF 촬영 설정 없음', pad, top + height * .80);
  }
  if (options.equipmentImages) {
    const [bodyImage, lensImage] = await Promise.all([fetchBitmap(options.bodyImageSrc), fetchBitmap(options.lensImageSrc)]);
    const each = imageArea / 2;
    const inset = height * .032;
    if (bodyImage) drawContain(ctx, bodyImage, width - imageArea, top + inset, each, height - inset * 2);
    if (lensImage) drawContain(ctx, lensImage, width - each, top + inset, each, height - inset * 2);
    bodyImage?.close(); lensImage?.close();
  }
  return output;
}

async function fetchBitmap(src) {
  if (!src) return null;
  try { const response = await fetch(src); if (!response.ok) return null; return await createImageBitmap(await response.blob()); }
  catch { return null; }
}

function fitFont(ctx, text, maxWidth, initial) {
  ctx.font = '900 100px Arial,sans-serif';
  const measured = ctx.measureText(text).width || 1;
  return Math.min(initial, maxWidth * 100 / measured);
}

function drawContain(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}
