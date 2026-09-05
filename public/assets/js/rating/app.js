import { buildFileIndex, ensureReadWritePermission, siblingPath, yieldToUi } from './scanner.js';
import { updateXmpSidecar } from './xmp.js';

const SETTINGS_KEY = 'matchcamera-raw-rating-settings-v2';
const LABEL_VALUES = {
  ko: { red: '빨강', yellow: '노랑', green: '초록', blue: '파랑', purple: '보라' },
  en: { red: 'Red', yellow: 'Yellow', green: 'Green', blue: 'Blue', purple: 'Purple' }
};
const refs = {
  folderStatus: document.querySelector('[data-folder-status]'),
  folderName: document.querySelector('[data-folder-name]'),
  selectFolder: document.querySelector('[data-select-folder]'),
  prefix: document.querySelector('[data-prefix]'),
  extension: document.querySelector('[data-extension]'),
  numberInput: document.querySelector('[data-number-input]'),
  numberCount: document.querySelector('[data-number-count]'),
  rating: document.querySelector('[data-rating]'),
  ratingUnchanged: document.querySelector('[data-rating-unchanged]'),
  labelColor: document.querySelector('[data-label-color]'),
  labelLanguage: document.querySelector('[data-label-language]'),
  labelCustom: document.querySelector('[data-label-custom]'),
  labelPreview: document.querySelector('[data-label-preview]'),
  labelWarning: document.querySelector('[data-label-warning]'),
  backup: document.querySelector('[data-backup]'),
  run: document.querySelector('[data-run]'),
  stop: document.querySelector('[data-stop]'),
  reset: document.querySelector('[data-reset]'),
  clearLog: document.querySelector('[data-clear-log]'),
  progressBar: document.querySelector('[data-progress-bar]'),
  progressText: document.querySelector('[data-progress-text]'),
  currentFile: document.querySelector('[data-current-file]'),
  elapsed: document.querySelector('[data-elapsed]'),
  log: document.querySelector('[data-log]'),
  summary: document.querySelector('[data-summary]'),
  completeNote: document.querySelector('[data-complete-note]'),
  modal: document.querySelector('[data-confirm-modal]'),
  confirmBody: document.querySelector('[data-confirm-body]'),
  confirmRun: document.querySelector('[data-confirm-run]')
};

let rootHandle = null;
let parsedNumbers = [];
let invalidTokens = [];
let running = false;
let abortController = null;
let pendingPlan = null;
let startedAt = 0;
let elapsedTimer = null;

loadSettings();
bindEvents();
parseNumbers();
updateLabelControls();
renderSummary(emptySummary());
log('프로그램 준비 완료');

function bindEvents() {
  refs.selectFolder.addEventListener('click', chooseFolder);
  refs.numberInput.addEventListener('input', parseNumbers);
  [refs.prefix, refs.extension, refs.rating, refs.labelColor, refs.labelLanguage, refs.labelCustom, refs.ratingUnchanged, refs.backup]
    .forEach((element) => element.addEventListener('change', handleSettingChange));
  refs.labelCustom.addEventListener('input', () => { updateLabelControls(); saveCurrentSettings(); });
  refs.ratingUnchanged.addEventListener('change', () => { refs.rating.disabled = refs.ratingUnchanged.checked; });
  refs.run.addEventListener('click', prepareRun);
  refs.stop.addEventListener('click', stopRun);
  refs.reset.addEventListener('click', resetApp);
  refs.clearLog.addEventListener('click', () => { refs.log.innerHTML = ''; });
  document.querySelectorAll('[data-confirm-cancel], [data-confirm-cancel-2]').forEach((button) => button.addEventListener('click', closeConfirm));
  refs.confirmRun.addEventListener('click', executeRun);
  refs.modal.addEventListener('click', (event) => { if (event.target === refs.modal) closeConfirm(); });
}

function handleSettingChange() {
  updateLabelControls();
  saveCurrentSettings();
}

function resolveLabelMode() {
  const color = refs.labelColor.value;
  if (color === 'unchanged' || color === 'clear') return color;
  if (refs.labelLanguage.value === 'custom') return refs.labelCustom.value.trim();
  return LABEL_VALUES[refs.labelLanguage.value]?.[color] || '';
}

function updateLabelControls() {
  const custom = refs.labelLanguage.value === 'custom';
  const colorNeedsValue = !['unchanged', 'clear'].includes(refs.labelColor.value);
  refs.labelCustom.disabled = !custom || !colorNeedsValue;
  const value = resolveLabelMode();
  refs.labelWarning.classList.remove('warning');
  if (value === 'unchanged') {
    refs.labelPreview.textContent = '변경 안 함';
    refs.labelWarning.textContent = '기존 xmp:Label 값을 그대로 유지합니다.';
  } else if (value === 'clear') {
    refs.labelPreview.textContent = '레이블 제거';
    refs.labelWarning.textContent = '기존 xmp:Label 속성을 삭제합니다.';
  } else if (!value) {
    refs.labelPreview.textContent = '값을 입력하세요';
    refs.labelWarning.textContent = 'Lightroom 레이블 세트에 등록된 정확한 문자열이 필요합니다.';
    refs.labelWarning.classList.add('warning');
  } else {
    refs.labelPreview.textContent = `xmp:Label="${value}"`;
    refs.labelWarning.textContent = custom
      ? '사용 중인 Lightroom 사용자 지정 레이블과 철자·띄어쓰기가 정확히 같아야 합니다.'
      : `${refs.labelLanguage.value === 'ko' ? '한국어' : '영어'}판 Lightroom 기본 레이블 세트 기준입니다.`;
  }
}

async function chooseFolder() {
  if (!('showDirectoryPicker' in window)) return alert('이 브라우저는 폴더 쓰기를 지원하지 않습니다. Windows용 Chrome 또는 Edge를 사용하세요.');
  try {
    rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    refs.folderName.textContent = rootHandle.name;
    refs.folderStatus.textContent = '선택 완료';
    log(`상위 폴더 선택: ${rootHandle.name}`, 'success');
  } catch (error) {
    if (error?.name !== 'AbortError') log(`폴더 선택 실패: ${error.message || error}`, 'error');
  }
}

function parseNumbers() {
  const tokens = refs.numberInput.value.split(/[\s,]+/).filter(Boolean);
  const valid = [];
  invalidTokens = [];
  for (const token of tokens) {
    if (/^\d+$/.test(token)) valid.push(token);
    else invalidTokens.push(token);
  }
  parsedNumbers = [...new Set(valid)];
  refs.numberCount.textContent = `${parsedNumbers.length}개`;
}

function prepareRun() {
  parseNumbers();
  if (!rootHandle) return alert('상위 폴더를 먼저 선택하세요.');
  if (!parsedNumbers.length) return alert('처리할 촬영 번호를 입력하세요.');
  const ratingMode = refs.ratingUnchanged.checked ? 'unchanged' : 'change';
  const labelMode = resolveLabelMode();
  if (refs.labelLanguage.value === 'custom' && !['unchanged', 'clear'].includes(refs.labelColor.value) && !labelMode) {
    return alert('사용자 지정 레이블 문자열을 입력하세요.');
  }
  if (ratingMode === 'unchanged' && labelMode === 'unchanged') return alert('별점과 색상 레이블이 모두 변경 안 함입니다.');

  pendingPlan = {
    prefix: refs.prefix.value.trim(),
    extension: normalizeExtension(refs.extension.value),
    ratingMode,
    rating: Number(refs.rating.value),
    labelMode,
    labelColor: refs.labelColor.value,
    labelLanguage: refs.labelLanguage.value,
    backup: refs.backup.checked,
    numbers: [...parsedNumbers]
  };
  const ratingText = ratingMode === 'unchanged' ? '변경 안 함' : String(pendingPlan.rating);
  const labelText = labelMode === 'unchanged' ? '변경 안 함' : labelMode === 'clear' ? '레이블 제거' : `xmp:Label=&quot;${escapeHtml(labelMode)}&quot;`;
  refs.confirmBody.innerHTML = `<p><strong>상위 폴더:</strong> ${escapeHtml(rootHandle.name)}</p><p><strong>대상 번호:</strong> ${pendingPlan.numbers.length}개</p><p><strong>파일 규칙:</strong> <code>${escapeHtml(pendingPlan.prefix)}[번호]${escapeHtml(pendingPlan.extension)}</code></p><p><strong>별점:</strong> ${ratingText}<br><strong>색상 레이블:</strong> ${labelText}<br><strong>기존 XMP 백업:</strong> ${pendingPlan.backup ? '생성' : '생성 안 함'}</p><p class="confirm-warning">RAW 원본은 수정하지 않고 XMP 사이드카만 변경합니다.</p>`;
  openConfirm();
}

async function executeRun() {
  closeConfirm();
  if (!pendingPlan) return;
  running = true;
  abortController = new AbortController();
  startedAt = performance.now();
  elapsedTimer = setInterval(updateElapsed, 100);
  lockInputs(true);
  refs.stop.disabled = false;
  refs.completeNote.hidden = true;
  const summary = emptySummary();
  summary.inputNumbers = pendingPlan.numbers.length;
  renderSummary(summary);
  refs.log.innerHTML = '';
  invalidTokens.forEach((token) => log(`잘못된 값 무시: ${token}`, 'warning'));
  log('검색 시작');

  try {
    const allowed = await ensureReadWritePermission(rootHandle);
    if (!allowed) throw new Error('폴더 읽기/쓰기 권한이 허용되지 않았습니다.');
    refs.currentFile.textContent = '하위 폴더 검색 중';
    const index = await buildFileIndex(rootHandle, {
      signal: abortController.signal,
      onFolder: ({ directoryPath, folderCount }) => { if (folderCount % 25 === 0) log(`하위 폴더 검색 중: ${directoryPath || rootHandle.name}`); },
      onFile: ({ fileCount }) => { if (fileCount % 250 === 0) updateProgress(0, `파일 인덱스 생성: ${fileCount}개`); }
    });
    summary.scannedFolders = index.folderCount;
    summary.scannedFiles = index.fileCount;
    log(`파일 인덱스 완료: 폴더 ${index.folderCount}개, 파일 ${index.fileCount}개`, 'success');

    const tasks = [];
    for (const number of pendingPlan.numbers) {
      const expectedName = `${pendingPlan.prefix}${number}${pendingPlan.extension}`;
      const matches = index.byName.get(expectedName.toLowerCase()) || [];
      if (!matches.length) {
        summary.missingNumbers += 1;
        log(`${expectedName} 없음`, 'warning');
        continue;
      }
      if (matches.length > 1) {
        summary.duplicates += matches.length - 1;
        log(`중복 파일 발견: ${expectedName} ${matches.length}개`, 'warning');
      }
      matches.forEach((rawRecord) => tasks.push({ expectedName, rawRecord }));
    }
    summary.foundRaw = tasks.length;
    if (!tasks.length) throw new Error('입력 번호와 일치하는 RAW 파일을 찾지 못했습니다.');

    const backupTimestamp = timestamp();
    for (let i = 0; i < tasks.length; i += 1) {
      if (abortController.signal.aborted) throw new DOMException('작업이 중지되었습니다.', 'AbortError');
      const task = tasks[i];
      refs.currentFile.textContent = task.rawRecord.name;
      updateProgress(i / tasks.length, `${i + 1} / ${tasks.length}`);
      const stem = task.rawRecord.name.replace(/\.[^.]+$/, '');
      const existingXmpRecord = index.byPath.get(siblingPath(task.rawRecord, `${stem}.xmp`));
      try {
        const result = await updateXmpSidecar({
          rawRecord: task.rawRecord,
          existingXmpRecord,
          ratingMode: pendingPlan.ratingMode,
          rating: pendingPlan.rating,
          labelMode: pendingPlan.labelMode,
          backup: pendingPlan.backup,
          timestamp: backupTimestamp
        });
        if (result.previousLabel && !['unchanged', 'clear'].includes(result.appliedLabel) && result.previousLabel !== result.appliedLabel) {
          log(`${result.fileName}: 기존 레이블 "${result.previousLabel}" → "${result.appliedLabel}"`, 'warning');
        }
        if (result.created) { summary.createdXmp += 1; log(`${result.fileName} 새로 생성 완료`, 'success'); }
        else { summary.modifiedXmp += 1; log(`${result.fileName} 수정 완료`, 'success'); }
      } catch (error) {
        summary.failures += 1;
        log(`${task.rawRecord.path} 처리 실패: ${error.message || error}`, 'error');
      }
      await yieldToUi();
    }
    updateProgress(1, `${tasks.length} / ${tasks.length}`);
    log('처리 완료', 'success');
    refs.completeNote.hidden = false;
  } catch (error) {
    if (error?.name === 'AbortError') log('사용자 요청으로 작업 중지', 'warning');
    else { summary.failures += 1; log(error.message || String(error), 'error'); }
  } finally {
    summary.elapsedSeconds = (performance.now() - startedAt) / 1000;
    renderSummary(summary);
    refs.currentFile.textContent = '대기 중';
    clearInterval(elapsedTimer);
    updateElapsed();
    running = false;
    lockInputs(false);
    refs.stop.disabled = true;
    abortController = null;
  }
}

function stopRun() {
  if (!running || !abortController) return;
  abortController.abort();
  refs.stop.disabled = true;
  log('안전 중지를 요청했습니다.', 'warning');
}

function resetApp() {
  if (running) return;
  refs.prefix.value = 'DSC0';
  refs.extension.value = '.ARW';
  refs.numberInput.value = '';
  refs.rating.value = '5';
  refs.ratingUnchanged.checked = false;
  refs.rating.disabled = false;
  refs.labelColor.value = 'unchanged';
  refs.labelLanguage.value = 'ko';
  refs.labelCustom.value = '';
  refs.backup.checked = true;
  rootHandle = null;
  refs.folderName.textContent = '폴더를 선택하세요.';
  refs.folderStatus.textContent = '선택 안 됨';
  parsedNumbers = [];
  invalidTokens = [];
  refs.numberCount.textContent = '0개';
  refs.log.innerHTML = '';
  renderSummary(emptySummary());
  refs.completeNote.hidden = true;
  updateProgress(0, '0 / 0');
  refs.elapsed.textContent = '0.0초';
  updateLabelControls();
  saveCurrentSettings();
  log('초기화 완료');
}

function lockInputs(locked) {
  [refs.selectFolder, refs.prefix, refs.extension, refs.numberInput, refs.rating, refs.labelColor, refs.labelLanguage, refs.labelCustom, refs.ratingUnchanged, refs.backup, refs.run, refs.reset]
    .forEach((element) => { element.disabled = locked; });
  if (!locked) {
    refs.rating.disabled = refs.ratingUnchanged.checked;
    updateLabelControls();
  }
}

function log(message, type = '') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.innerHTML = `<time>${new Date().toLocaleTimeString('ko-KR', { hour12: false })}</time><span>${escapeHtml(message)}</span>`;
  refs.log.append(line);
  refs.log.scrollTop = refs.log.scrollHeight;
}

function updateProgress(value, text) {
  refs.progressBar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  refs.progressText.textContent = text;
}

function updateElapsed() {
  const seconds = startedAt ? (performance.now() - startedAt) / 1000 : 0;
  refs.elapsed.textContent = `${seconds.toFixed(1)}초`;
}

function emptySummary() {
  return { inputNumbers: 0, scannedFolders: 0, scannedFiles: 0, foundRaw: 0, modifiedXmp: 0, createdXmp: 0, duplicates: 0, missingNumbers: 0, failures: 0, elapsedSeconds: 0 };
}

function renderSummary(data) {
  const items = [['입력 번호 수', data.inputNumbers], ['검색한 폴더 수', data.scannedFolders], ['검색한 파일 수', data.scannedFiles], ['발견한 RAW 수', data.foundRaw], ['수정한 XMP 수', data.modifiedXmp], ['새로 생성한 XMP 수', data.createdXmp], ['중복 발견 수', data.duplicates], ['누락 번호 수', data.missingNumbers], ['실패 수', data.failures], ['처리 시간', `${data.elapsedSeconds.toFixed(1)}초`]];
  refs.summary.innerHTML = items.map(([label, value]) => `<div class="summary-item"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function normalizeExtension(value) {
  const trimmed = value.trim() || '.ARW';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function openConfirm() { refs.modal.classList.add('is-open'); refs.modal.setAttribute('aria-hidden', 'false'); }
function closeConfirm() { refs.modal.classList.remove('is-open'); refs.modal.setAttribute('aria-hidden', 'true'); }
function timestamp() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`; }

function saveCurrentSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    prefix: refs.prefix.value,
    extension: refs.extension.value,
    rating: refs.rating.value,
    ratingUnchanged: refs.ratingUnchanged.checked,
    labelColor: refs.labelColor.value,
    labelLanguage: refs.labelLanguage.value,
    labelCustom: refs.labelCustom.value,
    backup: refs.backup.checked
  }));
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (saved.prefix) refs.prefix.value = saved.prefix;
    if (saved.extension) refs.extension.value = saved.extension;
    if (saved.rating) refs.rating.value = saved.rating;
    refs.ratingUnchanged.checked = Boolean(saved.ratingUnchanged);
    refs.rating.disabled = refs.ratingUnchanged.checked;
    if (saved.labelColor) refs.labelColor.value = saved.labelColor;
    if (['ko', 'en', 'custom'].includes(saved.labelLanguage)) refs.labelLanguage.value = saved.labelLanguage;
    if (saved.labelCustom) refs.labelCustom.value = saved.labelCustom;
    refs.backup.checked = saved.backup !== false;
  } catch {}
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
