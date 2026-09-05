self.onmessage = async (event) => {
  const { jobId, file, options, watermarkFile } = event.data;
  try {
    const source = await createImageBitmap(file);
    const watermark = watermarkFile ? await createImageBitmap(watermarkFile) : null;
    const rotation = ((options.rotation % 360) + 360) % 360;
    const rotated = rotation === 90 || rotation === 270;
    const rotatedWidth = rotated ? source.height : source.width;
    const rotatedHeight = rotated ? source.width : source.height;
    const ratioMode = options.cropEnabled || options.borderEnabled;
    const ratio = ratioMode ? effectiveRatio(options.cropRatio, rotatedWidth, rotatedHeight) : null;

    const fullCanvas = new OffscreenCanvas(rotatedWidth, rotatedHeight);
    const fullCtx = fullCanvas.getContext('2d', { alpha: false });
    fullCtx.fillStyle = '#fff';
    fullCtx.fillRect(0, 0, rotatedWidth, rotatedHeight);
    fullCtx.save();
    fullCtx.translate(rotatedWidth / 2, rotatedHeight / 2);
    fullCtx.rotate(rotation * Math.PI / 180);
    fullCtx.drawImage(source, -source.width / 2, -source.height / 2);
    fullCtx.restore();

    let editedCanvas;
    let editedCtx;

    if (options.cropEnabled && ratio) {
      const crop = calculateCrop(rotatedWidth, rotatedHeight, ratio, options.cropShift);
      editedCanvas = new OffscreenCanvas(Math.max(1, Math.round(crop.width)), Math.max(1, Math.round(crop.height)));
      editedCtx = editedCanvas.getContext('2d', { alpha: false });
      editedCtx.drawImage(fullCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, editedCanvas.width, editedCanvas.height);
    } else if (options.borderEnabled) {
      const frame = calculateBorderFrame(rotatedWidth, rotatedHeight, ratio);
      const placement = calculateBorderPlacement(frame.width, frame.height, rotatedWidth, rotatedHeight, options.borderSize);
      const visibleHeight = options.equipmentEnabled ? placement.y + placement.height : frame.height;
      editedCanvas = new OffscreenCanvas(Math.max(1, Math.round(frame.width)), Math.max(1, Math.round(visibleHeight)));
      editedCtx = editedCanvas.getContext('2d', { alpha: false });
      editedCtx.imageSmoothingEnabled = true;
      editedCtx.imageSmoothingQuality = 'high';
      editedCtx.fillStyle = options.borderColor === 'black' ? '#000' : '#fff';
      editedCtx.fillRect(0, 0, editedCanvas.width, editedCanvas.height);

      editedCtx.drawImage(fullCanvas, placement.x, placement.y, placement.width, placement.height);
    } else {
      editedCanvas = new OffscreenCanvas(rotatedWidth, rotatedHeight);
      editedCtx = editedCanvas.getContext('2d', { alpha: false });
      editedCtx.drawImage(fullCanvas, 0, 0);
    }

    if (options.watermarkEnabled && watermark) drawWatermark(editedCtx, watermark, editedCanvas.width, editedCanvas.height, options);
    if (options.equipmentEnabled) editedCanvas = await appendEquipmentPanel(editedCanvas, options);

    let blob;
    if (options.saveMode === 'size') blob = await encodeTargetSize(editedCanvas, options.targetBytes);
    else blob = await editedCanvas.convertToBlob({ type: 'image/jpeg', quality: 1 });

    source.close();
    watermark?.close();
    self.postMessage({ jobId, ok: true, blob, width: editedCanvas.width, height: editedCanvas.height });
  } catch (error) {
    self.postMessage({ jobId, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};

function effectiveRatio(value, width, height) {
  if (value === 'none') return null;
  if (value === 'auto') return width >= height ? 5 / 4 : 4 / 5;
  const [a, b] = String(value).split(':').map(Number);
  return a > 0 && b > 0 ? a / b : null;
}

function calculateCrop(width, height, ratio, shift) {
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
  return {
    x: maxX > 0 ? ((normalized + 1) / 2) * maxX : 0,
    y: maxY > 0 ? ((normalized + 1) / 2) * maxY : 0,
    width: cropWidth,
    height: cropHeight
  };
}

function calculateBorderFrame(width, height, ratio) {
  if (!ratio) return { width, height };
  const sourceRatio = width / height;
  if (sourceRatio > ratio) return { width, height: width / ratio };
  if (sourceRatio < ratio) return { width: height * ratio, height };
  return { width, height };
}

function calculateBorderPlacement(frameWidth, frameHeight, sourceWidth, sourceHeight, borderSize) {
  const borderFraction = clampBorderFraction(borderSize);
  const innerWidth = frameWidth * (1 - borderFraction * 2);
  const innerHeight = frameHeight * (1 - borderFraction * 2);
  const imageScale = Math.min(innerWidth / sourceWidth, innerHeight / sourceHeight);
  const width = sourceWidth * imageScale;
  const height = sourceHeight * imageScale;
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height
  };
}

function clampBorderFraction(value) {
  return Math.max(.01, Math.min(.30, (Number(value) || 5) / 100));
}

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
  if (first.size <= targetBytes) return first;

  let low = .18;
  let high = 1;
  let bestBlob = null;
  let bestScale = low;
  for (let i = 0; i < 8; i += 1) {
    const scale = (low + high) / 2;
    const test = await encodeScaled(canvas, scale, quality);
    if (test.size <= targetBytes) { bestBlob = test; bestScale = scale; low = scale; }
    else high = scale;
  }
  if (bestBlob) return bestBlob;

  const minimum = await createScaledCanvas(canvas, bestScale);
  let qLow = .35;
  let qHigh = quality;
  let qualityBlob = await minimum.convertToBlob({ type: 'image/jpeg', quality: qLow });
  for (let i = 0; i < 8; i += 1) {
    const q = (qLow + qHigh) / 2;
    const test = await minimum.convertToBlob({ type: 'image/jpeg', quality: q });
    if (test.size <= targetBytes) { qualityBlob = test; qLow = q; }
    else qHigh = q;
  }
  return qualityBlob;
}

async function encodeScaled(canvas, scale, quality) {
  const scaled = await createScaledCanvas(canvas, scale);
  return scaled.convertToBlob({ type: 'image/jpeg', quality });
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

async function appendEquipmentPanel(sourceCanvas, options) {
  const width = sourceCanvas.width;
  const height = Math.max(1, Math.round(width * .18));
  const output = new OffscreenCanvas(width, sourceCanvas.height + height);
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
