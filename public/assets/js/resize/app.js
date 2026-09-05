import { createPhotoState, disposePhotoState, loadSettings, saveSettings, defaultSettings } from './state.js?v=20260905-full';
import { renderPreview, clearImageCache } from './image-utils.js?v=20260905-render-match';
import { applyMetadataPolicy } from './metadata.js?v=20260905-full';
import { parse as parseExif } from '/assets/vendor/exifr-full.esm.js';
import { loadProductIndex } from '../data.js?v=20260902-performance';

const refs = {
  fileInput: document.querySelector('[data-file-input]'),
  dropZone: document.querySelector('[data-drop-zone]'),
  fileList: document.querySelector('[data-file-list]'),
  clearAll: document.querySelector('[data-clear-all]'),
  canvas: document.querySelector('[data-preview-canvas]'),
  stage: document.querySelector('[data-preview-stage]'),
  empty: document.querySelector('[data-preview-empty]'),
  count: document.querySelector('[data-preview-count]'),
  prev: document.querySelector('[data-prev]'),
  next: document.querySelector('[data-next]'),
  rotate: document.querySelector('[data-rotate]'),
  cropEnabled: document.querySelector('[data-crop-enabled]'),
  borderEnabled: document.querySelector('[data-border-enabled]'),
  borderColorField: document.querySelector('[data-border-color-field]'),
  borderSizeField: document.querySelector('[data-border-size-field]'),
  borderSize: document.querySelector('[data-border-size]'),
  borderSizeValue: document.querySelector('[data-border-size-value]'),
  cropRatio: document.querySelector('[data-crop-ratio]'),
  gridEnabled: document.querySelector('[data-grid-enabled]'),
  watermarkEnabled: document.querySelector('[data-watermark-enabled]'),
  watermarkInput: document.querySelector('[data-watermark-input]'),
  watermarkSelect: document.querySelector('[data-watermark-select]'),
  watermarkSize: document.querySelector('[data-watermark-size]'),
  watermarkSizeValue: document.querySelector('[data-watermark-size-value]'),
  watermarkMargin: document.querySelector('[data-watermark-margin]'),
  watermarkMarginValue: document.querySelector('[data-watermark-margin-value]'),
  watermarkAll: document.querySelector('[data-watermark-all]'),
  targetSizeField: document.querySelector('[data-target-size-field]'),
  targetSize: document.querySelector('[data-target-size]'),
  removeMetadata: document.querySelector('[data-remove-metadata]'),
  process: document.querySelector('[data-process]'),
  downloadZip: document.querySelector('[data-download-zip]'),
  progressBar: document.querySelector('[data-progress-bar]'),
  progressText: document.querySelector('[data-progress-text]'),
  outputList: document.querySelector('[data-output-list]'),
  metadataModal: document.querySelector('[data-metadata-modal]'),
  openMetadata: document.querySelector('[data-open-metadata]'),
  closeMetadata: document.querySelector('[data-close-metadata]'),
  metadataOptions: document.querySelector('[data-metadata-options]'),
  resetMetadata: document.querySelector('[data-reset-metadata]'),
  saveMetadata: document.querySelector('[data-save-metadata]'),
  equipmentEnabled: document.querySelector('[data-equipment-enabled]'),
  equipmentImages: document.querySelector('[data-equipment-images]'),
  equipmentSettings: document.querySelector('[data-equipment-settings]'),
  equipmentTheme: document.querySelector('[data-equipment-theme]'),
  equipmentBody: document.querySelector('[data-equipment-body]'),
  equipmentLens: document.querySelector('[data-equipment-lens]'),
  equipmentBodyOptions: document.querySelector('[data-equipment-body-options]'),
  equipmentLensOptions: document.querySelector('[data-equipment-lens-options]'),
  equipmentDetected: document.querySelector('[data-equipment-detected]'),
  equipmentApplyAll: document.querySelector('[data-equipment-apply-all]')
};

let settings = loadSettings();
let photos = [];
let activeIndex = -1;
let watermarkFile = null;
let watermarkImage = null;
let previewGeometry = null;
let outputs = [];
let isDraggingWatermark = false;
let processing = false;
let previewRequestId = 0;
let products = [];
let bodies = [];
let lenses = [];

hydrateControls();
bindEvents();
renderAll();
initializeProducts();

function bindEvents() {
  refs.dropZone?.addEventListener('click', () => refs.fileInput?.click());
  refs.dropZone?.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') refs.fileInput?.click(); });
  refs.fileInput?.addEventListener('change', () => addFiles(refs.fileInput.files));
  ['dragenter','dragover'].forEach((name) => refs.dropZone?.addEventListener(name, (event) => { event.preventDefault(); refs.dropZone.classList.add('is-over'); }));
  ['dragleave','drop'].forEach((name) => refs.dropZone?.addEventListener(name, (event) => { event.preventDefault(); refs.dropZone.classList.remove('is-over'); }));
  refs.dropZone?.addEventListener('drop', (event) => addFiles(event.dataTransfer?.files));
  refs.clearAll?.addEventListener('click', clearAll);
  refs.prev?.addEventListener('click', () => setActive(activeIndex - 1));
  refs.next?.addEventListener('click', () => setActive(activeIndex + 1));
  refs.rotate?.addEventListener('click', () => { const photo = currentPhoto(); if (!photo) return; photo.rotation = (photo.rotation + 90) % 360; photo.cropShift = 0; renderAll(); });

  refs.cropEnabled?.addEventListener('change', () => {
    setRatioMode(refs.cropEnabled.checked ? 'crop' : 'none');
    const photo = currentPhoto(); if (photo) photo.cropShift = 0;
    syncSettings('crop');
  });
  refs.borderEnabled?.addEventListener('change', () => {
    setRatioMode(refs.borderEnabled.checked ? 'border' : 'none');
    const photo = currentPhoto(); if (photo) photo.cropShift = 0;
    syncSettings('border');
  });
  refs.cropRatio?.addEventListener('change', () => { const photo = currentPhoto(); if (photo) photo.cropShift = 0; syncSettings(); });
  document.querySelectorAll('input[name="border-color"]').forEach((input) => input.addEventListener('change', syncSettings));
  refs.borderSize?.addEventListener('input', syncSettings);
  refs.gridEnabled?.addEventListener('change', syncSettings);
  refs.watermarkEnabled?.addEventListener('change', syncSettings);
  refs.watermarkSelect?.addEventListener('click', () => refs.watermarkInput?.click());
  refs.watermarkInput?.addEventListener('change', loadWatermark);
  refs.watermarkSize?.addEventListener('input', syncSettings);
  refs.watermarkMargin?.addEventListener('input', syncSettings);
  refs.watermarkAll?.addEventListener('change', syncSettings);
  document.querySelectorAll('input[name="wm-position"]').forEach((input) => input.addEventListener('change', syncSettings));
  document.querySelectorAll('input[name="save-mode"]').forEach((input) => input.addEventListener('change', syncSettings));
  refs.targetSize?.addEventListener('change', syncSettings);
  refs.removeMetadata?.addEventListener('change', syncSettings);
  refs.equipmentEnabled?.addEventListener('change', syncSettings);
  refs.equipmentImages?.addEventListener('change', syncSettings);
  refs.equipmentSettings?.addEventListener('change', syncSettings);
  refs.equipmentTheme?.addEventListener('change', syncSettings);
  refs.equipmentBody?.addEventListener('change', () => selectEquipment('body'));
  refs.equipmentLens?.addEventListener('change', () => selectEquipment('lens'));
  refs.equipmentApplyAll?.addEventListener('click', applyEquipmentToAll);

  refs.stage?.addEventListener('wheel', handleWheel, { passive: false });
  refs.canvas?.addEventListener('pointerdown', startWatermarkDrag);
  refs.canvas?.addEventListener('pointermove', moveWatermarkDrag);
  refs.canvas?.addEventListener('pointerup', endWatermarkDrag);
  refs.canvas?.addEventListener('pointercancel', endWatermarkDrag);
  window.addEventListener('resize', debounce(renderPreviewOnly, 100));

  refs.process?.addEventListener('click', processAll);
  refs.downloadZip?.addEventListener('click', downloadZip);
  refs.openMetadata?.addEventListener('click', openMetadataModal);
  refs.closeMetadata?.addEventListener('click', closeMetadataModal);
  refs.metadataModal?.addEventListener('click', (event) => { if (event.target === refs.metadataModal) closeMetadataModal(); });
  refs.resetMetadata?.addEventListener('click', () => { settings.metadataOptions = [...defaultSettings.metadataOptions]; renderMetadataOptions(); });
  refs.saveMetadata?.addEventListener('click', () => { readMetadataOptions(); saveSettings(settings); closeMetadataModal(); });
}

function hydrateControls() {
  const initialMode = settings.cropEnabled ? 'crop' : settings.borderEnabled ? 'border' : 'none';
  setRatioMode(initialMode);
  settings.cropEnabled = initialMode === 'crop';
  settings.borderEnabled = initialMode === 'border';
  saveSettings(settings);
  refs.cropRatio.value = settings.cropRatio;
  const borderColor = document.querySelector(`input[name="border-color"][value="${settings.borderColor}"]`);
  if (borderColor) borderColor.checked = true;
  refs.borderSize.value = String(clampBorderSize(settings.borderSize));
  refs.gridEnabled.checked = settings.gridEnabled;
  refs.watermarkEnabled.checked = settings.watermarkEnabled;
  refs.watermarkSize.value = String(settings.watermarkSize);
  refs.watermarkMargin.value = String(settings.watermarkMargin);
  refs.watermarkAll.checked = settings.watermarkAll;
  const wmPosition = document.querySelector(`input[name="wm-position"][value="${settings.watermarkPosition}"]`);
  if (wmPosition) wmPosition.checked = true;
  const saveMode = document.querySelector(`input[name="save-mode"][value="${settings.saveMode}"]`);
  if (saveMode) saveMode.checked = true;
  refs.targetSize.value = String(settings.targetSizeMb);
  refs.removeMetadata.checked = settings.removeMetadata;
  refs.equipmentEnabled.checked = settings.equipmentEnabled;
  refs.equipmentImages.checked = settings.equipmentImages;
  refs.equipmentSettings.checked = settings.equipmentSettings;
  refs.equipmentTheme.value = settings.equipmentTheme;
  renderMetadataOptions();
  updateControlLabels();
}

function syncSettings(preferredMode = null) {
  enforceExclusiveRatioMode(preferredMode);
  settings = {
    ...settings,
    cropEnabled: refs.cropEnabled.checked,
    borderEnabled: refs.borderEnabled.checked,
    borderColor: document.querySelector('input[name="border-color"]:checked')?.value || 'white',
    borderSize: clampBorderSize(refs.borderSize.value),
    cropRatio: refs.cropRatio.value,
    gridEnabled: refs.gridEnabled.checked,
    watermarkEnabled: refs.watermarkEnabled.checked,
    watermarkPosition: document.querySelector('input[name="wm-position"]:checked')?.value || 'center',
    watermarkSize: Number(refs.watermarkSize.value),
    watermarkMargin: Number(refs.watermarkMargin.value),
    watermarkAll: refs.watermarkAll.checked,
    saveMode: document.querySelector('input[name="save-mode"]:checked')?.value || 'quality',
    targetSizeMb: Math.max(.5, Number(refs.targetSize.value) || 19),
    removeMetadata: refs.removeMetadata.checked,
    equipmentEnabled: refs.equipmentEnabled.checked,
    equipmentImages: refs.equipmentImages.checked,
    equipmentSettings: refs.equipmentSettings.checked,
    equipmentTheme: refs.equipmentTheme.value
  };
  saveSettings(settings);
  updateControlLabels();
  renderPreviewOnly();
}

function updateControlLabels() {
  refs.watermarkSizeValue.textContent = `${settings.watermarkSize}%`;
  refs.borderSizeValue.textContent = `${clampBorderSize(settings.borderSize)}%`;
  refs.watermarkMarginValue.textContent = `${settings.watermarkMargin}%`;
  refs.targetSize.disabled = settings.saveMode !== 'size';
  refs.targetSizeField?.classList.toggle('is-disabled', settings.saveMode !== 'size');
  const ratioModeEnabled = settings.cropEnabled || settings.borderEnabled;
  refs.cropRatio.disabled = !ratioModeEnabled;
  if (refs.borderColorField) {
    refs.borderColorField.classList.toggle('is-disabled', !settings.borderEnabled);
    refs.borderColorField.querySelectorAll('input').forEach((input) => { input.disabled = !settings.borderEnabled; });
  }
  if (refs.borderSizeField) {
    refs.borderSizeField.classList.toggle('is-disabled', !settings.borderEnabled);
    refs.borderSize.disabled = !settings.borderEnabled;
  }
}

function addFiles(fileList) {
  const accepted = [...(fileList || [])].filter((file) => /^image\/(jpeg|png|webp)$/i.test(file.type));
  if (!accepted.length) return;
  accepted.forEach((file) => {
    const photo = createPhotoState(file);
    photos.push(photo);
    readPhotoEquipment(photo);
  });
  if (activeIndex < 0) activeIndex = 0;
  outputs = [];
  renderAll();
  refs.fileInput.value = '';
}

function removePhoto(index) {
  const [removed] = photos.splice(index, 1);
  if (removed) { clearImageCache(removed.id); disposePhotoState(removed); }
  if (!photos.length) activeIndex = -1;
  else activeIndex = Math.min(activeIndex, photos.length - 1);
  outputs = [];
  renderAll();
}

function clearAll() {
  if (processing) return;
  photos.forEach((photo) => { clearImageCache(photo.id); disposePhotoState(photo); });
  photos = [];
  activeIndex = -1;
  outputs.forEach((output) => URL.revokeObjectURL(output.url));
  outputs = [];
  renderAll();
}

function setActive(index) {
  if (!photos.length) return;
  activeIndex = (index + photos.length) % photos.length;
  renderAll();
}

function setRatioMode(mode) {
  refs.cropEnabled.checked = mode === 'crop';
  refs.borderEnabled.checked = mode === 'border';
}

function enforceExclusiveRatioMode(preferredMode = null) {
  if (!refs.cropEnabled.checked || !refs.borderEnabled.checked) return;
  setRatioMode(preferredMode === 'border' ? 'border' : 'crop');
}

function clampBorderSize(value) {
  return Math.max(1, Math.min(30, Math.round(Number(value) || 5)));
}

function currentPhoto() { return activeIndex >= 0 ? photos[activeIndex] : null; }

function renderAll() {
  renderFileList();
  renderOutputList();
  refs.count.textContent = photos.length ? `${activeIndex + 1} / ${photos.length}` : '0 / 0';
  refs.prev.disabled = !photos.length;
  refs.next.disabled = !photos.length;
  refs.rotate.disabled = !photos.length;
  refs.process.disabled = !photos.length || processing;
  refs.downloadZip.disabled = !outputs.length;
  syncEquipmentControls();
  renderPreviewOnly();
}

function renderFileList() {
  refs.fileList.innerHTML = '';
  photos.forEach((photo, index) => {
    const item = document.createElement('div');
    item.className = `file-item${index === activeIndex ? ' is-active' : ''}`;
    item.innerHTML = `<img class="file-thumb" src="${photo.url}" alt=""><div><div class="file-name">${escapeHtml(photo.file.name)}</div><div class="file-size">${formatBytes(photo.file.size)}</div></div><button class="file-remove" type="button" aria-label="삭제">×</button>`;
    item.addEventListener('click', () => setActive(index));
    item.querySelector('.file-remove')?.addEventListener('click', (event) => { event.stopPropagation(); removePhoto(index); });
    refs.fileList.append(item);
  });
}

async function renderPreviewOnly() {
  const requestId = ++previewRequestId;
  const photo = currentPhoto();
  if (!photo) {
    refs.canvas.hidden = true;
    refs.empty.hidden = false;
    previewGeometry = null;
    return;
  }
  const photoId = photo.id;
  const settingsSnapshot = { ...settings };
  refs.empty.hidden = true;
  try {
    const geometry = await renderPreview({
      canvas: refs.canvas,
      stage: refs.stage,
      photo,
      settings: settingsSnapshot,
      watermarkImage,
      shouldRender: () => requestId === previewRequestId && currentPhoto()?.id === photoId
    });
    if (requestId !== previewRequestId || currentPhoto()?.id !== photoId || !geometry) return;
    previewGeometry = geometry;
  } catch (error) {
    if (requestId !== previewRequestId) return;
    refs.empty.hidden = false;
    refs.empty.textContent = `미리보기 오류: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function handleWheel(event) {
  const photo = currentPhoto();
  if (!photo || !settings.cropEnabled || settings.cropRatio === 'none') return;
  event.preventDefault();
  photo.cropShift = Math.max(-1, Math.min(1, photo.cropShift + Math.sign(event.deltaY) * .06));
  renderPreviewOnly();
}

function startWatermarkDrag(event) {
  if (!settings.watermarkEnabled || settings.watermarkPosition !== 'custom' || !previewGeometry?.watermarkRect) return;
  const point = canvasPoint(event);
  const rect = previewGeometry.watermarkRect;
  if (point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height) {
    isDraggingWatermark = true;
    refs.canvas.setPointerCapture(event.pointerId);
  }
}

function moveWatermarkDrag(event) {
  if (!isDraggingWatermark || !previewGeometry) return;
  const photo = currentPhoto();
  if (!photo) return;
  const point = canvasPoint(event);
  const target = previewGeometry.watermarkRect?.target;
  if (!target) return;
  const x = Math.max(0, Math.min(1, (point.x - target.x) / target.width));
  const y = Math.max(0, Math.min(1, (point.y - target.y) / target.height));
  if (settings.watermarkAll) photos.forEach((item) => { item.watermarkX = x; item.watermarkY = y; });
  else { photo.watermarkX = x; photo.watermarkY = y; }
  renderPreviewOnly();
}

function endWatermarkDrag(event) {
  isDraggingWatermark = false;
  if (refs.canvas.hasPointerCapture?.(event.pointerId)) refs.canvas.releasePointerCapture(event.pointerId);
}

function canvasPoint(event) {
  const rect = refs.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

async function loadWatermark() {
  const file = refs.watermarkInput.files?.[0];
  if (!file) return;
  watermarkFile = file;
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try { await image.decode(); watermarkImage = image; refs.watermarkSelect.textContent = file.name; settings.watermarkEnabled = true; refs.watermarkEnabled.checked = true; syncSettings(); }
  catch { alert('워터마크 이미지를 읽지 못했습니다.'); URL.revokeObjectURL(url); }
}

async function processAll() {
  if (processing || !photos.length) return;
  enforceExclusiveRatioMode();
  syncSettings();
  if (settings.cropEnabled && settings.borderEnabled) return alert('자르기와 테두리 만들기는 동시에 사용할 수 없습니다.');
  if (settings.watermarkEnabled && !watermarkFile) return alert('워터마크가 ON이지만 워터마크 이미지가 선택되지 않았습니다.');
  processing = true;
  outputs.forEach((output) => URL.revokeObjectURL(output.url));
  outputs = [];
  renderAll();
  lockControls(true);
  const worker = new Worker('/program/resize/workers/image-worker.js?v=20260905-render-match');

  try {
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      updateProgress(index / photos.length, `${photo.file.name} 처리 중`);
      const result = await runWorkerJob(worker, photo);
      let blob = result.blob;
      blob = await applyMetadataPolicy(photo.file, blob, settings.removeMetadata, settings.metadataOptions);
      const name = outputName(photo.file.name);
      outputs.push({ name, blob, url: URL.createObjectURL(blob), width: result.width, height: result.height });
      renderOutputList();
    }
    updateProgress(1, `완료 — ${outputs.length}개 파일`);
  } catch (error) {
    updateProgress(0, `실패: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    worker.terminate();
    processing = false;
    lockControls(false);
    renderAll();
  }
}

function runWorkerJob(worker, photo) {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID();
    const timeoutId = setTimeout(() => finish(() => reject(new Error('이미지 처리 시간이 초과되었습니다.'))), 120000);

    const onMessage = (event) => {
      if (event.data?.jobId !== jobId) return;
      finish(() => event.data.ok ? resolve(event.data) : reject(new Error(event.data.error || '이미지 처리 실패')));
    };
    const onError = (event) => finish(() => reject(new Error(event.message || '이미지 처리 Worker 오류')));
    const onMessageError = () => finish(() => reject(new Error('이미지 처리 결과를 읽지 못했습니다.')));

    function finish(callback) {
      clearTimeout(timeoutId);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      callback();
    }

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    worker.postMessage({
      jobId,
      file: photo.file,
      watermarkFile,
      options: {
        rotation: photo.rotation,
        cropEnabled: settings.cropEnabled,
        borderEnabled: settings.borderEnabled,
        borderColor: settings.borderColor,
        borderSize: clampBorderSize(settings.borderSize),
        cropRatio: settings.cropRatio,
        cropShift: photo.cropShift,
        watermarkEnabled: settings.watermarkEnabled,
        watermarkPosition: settings.watermarkPosition,
        watermarkSize: settings.watermarkSize,
        watermarkMargin: settings.watermarkMargin,
        watermarkX: photo.watermarkX,
        watermarkY: photo.watermarkY,
        saveMode: settings.saveMode,
        targetBytes: Math.round(settings.targetSizeMb * 1024 * 1024),
        equipmentEnabled: settings.equipmentEnabled,
        equipmentImages: settings.equipmentImages,
        equipmentSettings: settings.equipmentSettings,
        equipmentTheme: settings.equipmentTheme,
        bodyName: productName(photo.body) || photo.bodyRaw,
        lensName: productName(photo.lens) || photo.lensRaw,
        bodyImageSrc: photo.body?.imageSrc || '',
        lensImageSrc: photo.lens?.imageSrc || '',
        settingsText: photo.settingsText || ''
      }
    });
  });
}

function renderOutputList() {
  refs.outputList.innerHTML = '';
  outputs.forEach((output) => {
    const row = document.createElement('div');
    row.className = 'output-item';
    row.innerHTML = `<span title="${escapeHtml(output.name)}">${escapeHtml(output.name)} · ${formatBytes(output.blob.size)} · ${output.width}×${output.height}</span><button class="button" type="button">다운로드</button>`;
    row.querySelector('button')?.addEventListener('click', () => downloadBlob(output.blob, output.name));
    refs.outputList.append(row);
  });
}

async function downloadZip() {
  if (!outputs.length) return;
  refs.downloadZip.disabled = true;
  refs.downloadZip.textContent = 'ZIP 생성 중...';
  try {
    const JSZip = window.JSZip;
    if (!JSZip) throw new Error('ZIP 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
    const zip = new JSZip();
    outputs.forEach((output) => zip.file(output.name, output.blob));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => updateProgress(meta.percent / 100, `ZIP 생성 ${meta.percent.toFixed(0)}%`));
    downloadBlob(blob, `Matchcamera_Photo_${timestamp()}.zip`);
    updateProgress(1, 'ZIP 다운로드 준비 완료');
  } catch (error) { alert(error instanceof Error ? error.message : String(error)); }
  finally { refs.downloadZip.disabled = false; refs.downloadZip.textContent = 'ZIP 다운로드'; }
}

function openMetadataModal() { renderMetadataOptions(); refs.metadataModal.classList.add('is-open'); refs.metadataModal.setAttribute('aria-hidden','false'); }
function closeMetadataModal() { refs.metadataModal.classList.remove('is-open'); refs.metadataModal.setAttribute('aria-hidden','true'); }
function renderMetadataOptions() { refs.metadataOptions?.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = settings.metadataOptions.includes(input.value); }); }
function readMetadataOptions() { settings.metadataOptions = [...(refs.metadataOptions?.querySelectorAll('input:checked') || [])].map((input) => input.value); }
function updateProgress(value, text) { refs.progressBar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`; refs.progressText.textContent = text; }
function lockControls(locked) { document.querySelectorAll('input, select, button').forEach((element) => { if (element === refs.downloadZip) return; element.disabled = locked; }); }
function outputName(name) { const base = name.replace(/\.[^.]+$/, ''); return `${base}_Matchcamera.jpg`; }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function timestamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`; }
function formatBytes(value) { if (value < 1024) return `${value} B`; const units = ['KB','MB','GB']; let size = value / 1024; let index = 0; while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; } return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`; }
function escapeHtml(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }

async function initializeProducts() {
  try {
    products = await loadProductIndex();
    bodies = products.filter((product) => product.type === '바디');
    lenses = products.filter((product) => product.type === '렌즈');
    refs.equipmentBodyOptions.innerHTML = bodies.map((product) => `<option value="${escapeHtml(productName(product))}"></option>`).join('');
    refs.equipmentLensOptions.innerHTML = lenses.map((product) => `<option value="${escapeHtml(productName(product))}"></option>`).join('');
    photos.forEach((photo) => matchPhotoEquipment(photo));
    renderAll();
  } catch (error) {
    refs.equipmentDetected.textContent = '제품 DB를 불러오지 못했습니다. 장비명은 직접 입력할 수 있습니다.';
    console.warn(error);
  }
}

async function readPhotoEquipment(photo) {
  try {
    photo.exif = await parseExif(photo.file, { tiff: true, exif: true, gps: false, icc: false, iptc: false, xmp: false }) || {};
    photo.bodyRaw = photo.exif.Model || photo.exif.CameraModelName || '';
    photo.lensRaw = photo.exif.LensModel || photo.exif.Lens || '';
    photo.settingsText = formatExifSettings(photo.exif);
    matchPhotoEquipment(photo);
  } catch (error) {
    console.warn(`${photo.file.name} EXIF 판독 실패`, error);
  }
  if (currentPhoto()?.id === photo.id) renderAll();
}

function matchPhotoEquipment(photo) {
  if (!photo.body) photo.body = findProduct(photo.bodyRaw, bodies);
  if (!photo.lens) photo.lens = findProduct(photo.lensRaw, lenses);
}

function syncEquipmentControls() {
  const photo = currentPhoto();
  if (!photo) {
    refs.equipmentBody.value = '';
    refs.equipmentLens.value = '';
    refs.equipmentDetected.textContent = '사진을 선택하면 EXIF 장비 정보를 확인합니다.';
    return;
  }
  refs.equipmentBody.value = productName(photo.body) || photo.bodyRaw || '';
  refs.equipmentLens.value = productName(photo.lens) || photo.lensRaw || '';
  const detected = [photo.bodyRaw && `바디 EXIF: ${photo.bodyRaw}`, photo.lensRaw && `렌즈 EXIF: ${photo.lensRaw}`, photo.settingsText].filter(Boolean);
  refs.equipmentDetected.textContent = detected.join(' · ') || '장비 EXIF가 없습니다. 검색창에 직접 입력해 주세요.';
}

function selectEquipment(kind) {
  const photo = currentPhoto(); if (!photo) return;
  const input = kind === 'body' ? refs.equipmentBody : refs.equipmentLens;
  const list = kind === 'body' ? bodies : lenses;
  photo[kind] = findProduct(input.value, list);
  photo[`${kind}Raw`] = input.value.trim();
  outputs = [];
  renderAll();
}

function applyEquipmentToAll() {
  const photo = currentPhoto(); if (!photo) return;
  photos.forEach((item) => {
    item.body = photo.body; item.lens = photo.lens;
    item.bodyRaw = photo.bodyRaw; item.lensRaw = photo.lensRaw;
  });
  refs.equipmentDetected.textContent = '현재 바디와 렌즈를 모든 사진에 적용했습니다.';
  outputs = [];
  renderPreviewOnly();
}

function productName(product) { return product?.officialName || product?.model || product?.modelCode || ''; }
function normalize(value) { return String(value || '').toLowerCase().replaceAll('α', 'a').replace(/[^a-z0-9가-힣]+/g, ''); }
function findProduct(raw, list) {
  const target = normalize(raw); if (!target) return null;
  let winner = null; let score = 0;
  list.forEach((product) => {
    const aliases = [productName(product), product.model, product.modelCode, ...(product.exifAliases || [])].map(normalize).filter(Boolean);
    aliases.forEach((alias) => {
      const next = alias === target ? 1000 + alias.length : alias.includes(target) || target.includes(alias) ? 100 + Math.min(alias.length, target.length) : 0;
      if (next > score) { score = next; winner = product; }
    });
  });
  return score >= 100 ? winner : null;
}

function formatExifSettings(exif) {
  const values = [];
  if (Number(exif.FNumber) > 0) values.push(`F ${Number(exif.FNumber).toFixed(1)}`);
  if (Number(exif.ExposureTime) > 0) values.push(`SS ${exif.ExposureTime >= 1 ? `${Number(exif.ExposureTime.toFixed(1))}s` : `1/${Math.round(1 / exif.ExposureTime)}s`}`);
  const iso = Array.isArray(exif.ISO) ? exif.ISO[0] : exif.ISO || exif.ISOSpeedRatings; if (iso) values.push(`ISO ${iso}`);
  if (Number(exif.FocalLength) > 0) values.push(`${Number(exif.FocalLength.toFixed(1))}mm`);
  const date = exif.DateTimeOriginal || exif.CreateDate;
  if (date instanceof Date && !Number.isNaN(date.getTime())) values.push(`(${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')})`);
  return values.join(' | ');
}
