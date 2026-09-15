import { equivalentExposure, ndExposure, parseShutter, formatNumber, formatShutter, formatDuration, timerDuration, createTimer, advanceTimer, startTimer, pauseTimer, resetTimer, formatTimer } from './calculations.js?v=20260915-tools';
import { trackUsage } from '../usage-events.js?v=20260915-tools';

const $ = id => document.getElementById(id);
const targetFields = { iso: $('targetIso'), aperture: $('targetAperture'), shutterSeconds: $('targetShutter') };
const targetDefaults = { iso: '100', aperture: '11', shutterSeconds: '1/125' };
let exposureSeconds = null;
let ndSeconds = null;
let timer = createTimer(30);
let ticker = null;

function numberFrom(input) {
  if (!input.value.trim()) throw new TypeError('빈 입력칸을 채워 주세요.');
  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new TypeError('유효한 숫자를 입력해 주세요.');
  return value;
}

function showError(id, error) {
  const element = $(id);
  element.textContent = error.message;
  element.hidden = false;
}

function resetError(id) { $(id).hidden = true; $(id).textContent = ''; }

function setTargetMode() {
  const selected = $('solveFor').value;
  for (const [key, input] of Object.entries(targetFields)) {
    input.disabled = key === selected;
    if (input.disabled) { input.value = ''; input.placeholder = '자동 계산'; }
    else if (!input.value.trim()) { input.value = targetDefaults[key]; input.placeholder = ''; }
  }
}

function invalidateExposure() {
  exposureSeconds = null;
  $('exposureResult').hidden = true;
  resetError('exposureError');
}

function invalidateNd() {
  ndSeconds = null;
  $('ndResult').hidden = true;
  resetError('ndError');
}

function refreshNdUnit() {
  const isStops = $('ndUnit').value === 'stops';
  $('ndStrengthLabel').textContent = isStops ? 'ND 강도 · 스톱' : 'ND 강도 · 노출 배수';
  $('ndStrength').min = isStops ? '0' : '1';
  $('ndStrength').max = isStops ? '20' : '1048576';
  $('ndUnitHint').textContent = isStops ? '0~20스톱. 1스톱 늘어나면 필요한 노출 시간이 2배가 됩니다.' : 'ND 뒤의 배수를 입력하세요. ND8 → 8, ND64 → 64. ND 0.9 같은 광학 농도는 지원하지 않습니다.';
}

function syncTransferButtons() {
  const occupied = timer.status !== 'ready';
  for (const [id, seconds, label] of [
    ['exposureToTimer', exposureSeconds, '이 셔터 시간으로 타이머 설정'],
    ['ndToTimer', ndSeconds, '이 시간으로 타이머 설정'],
  ]) {
    const tooShort = seconds !== null && seconds < 1;
    $(id).disabled = occupied || seconds === null || tooShort;
    $(id).textContent = tooShort ? '1초 이상부터 타이머 사용 가능' : occupied ? '타이머를 초기화한 뒤 설정하세요' : label;
  }
}

$('exposureForm').addEventListener('submit', event => {
  event.preventDefault();
  void trackUsage('tool_start', 'exposure');
  invalidateExposure();
  try {
    const source = { iso: numberFrom($('baseIso')), aperture: numberFrom($('baseAperture')), shutterSeconds: parseShutter($('baseShutter').value) };
    const solveFor = $('solveFor').value;
    const target = {};
    for (const [key, input] of Object.entries(targetFields)) {
      if (key !== solveFor) target[key] = key === 'shutterSeconds' ? parseShutter(input.value) : numberFrom(input);
    }
    const result = equivalentExposure(source, target, solveFor);
    $('exposureResultLabel').textContent = { iso: '동일 밝기를 위한 이론 ISO', aperture: '동일 밝기를 위한 이론 조리개', shutterSeconds: '동일 밝기를 위한 이론 셔터 시간' }[solveFor];
    $('exposureValue').textContent = solveFor === 'shutterSeconds' ? formatShutter(result.shutterSeconds) : solveFor === 'aperture' ? `f/${formatNumber(result.aperture, 5)}` : `ISO ${formatNumber(result.iso, 6)}`;
    $('exposureDetails').textContent = `목표 조합: ISO ${formatNumber(result.iso, 6)} · f/${formatNumber(result.aperture, 5)} · ${formatShutter(result.shutterSeconds)}`;
    exposureSeconds = result.shutterSeconds;
    $('exposureResult').hidden = false;
    syncTransferButtons();
    void trackUsage('tool_success', 'exposure');
  } catch (error) {
    showError('exposureError', error);
    void trackUsage('tool_failure', 'exposure');
  }
});
$('exposureForm').addEventListener('input', invalidateExposure);
$('solveFor').addEventListener('change', () => { setTargetMode(); invalidateExposure(); });

$('ndUnit').addEventListener('change', () => {
  const value = Number($('ndStrength').value);
  if ($('ndStrength').value.trim() && Number.isFinite(value)) {
    const converted = $('ndUnit').value === 'factor' ? 2 ** value : value > 0 ? Math.log2(value) : NaN;
    $('ndStrength').value = Number.isFinite(converted) ? String(Number(converted.toPrecision(12))) : '';
  }
  refreshNdUnit();
  invalidateNd();
});
document.querySelectorAll('[data-nd-factor]').forEach(button => button.addEventListener('click', () => {
  $('ndUnit').value = 'factor';
  $('ndStrength').value = button.dataset.ndFactor;
  refreshNdUnit();
  invalidateNd();
}));
$('ndForm').addEventListener('input', invalidateNd);
$('ndForm').addEventListener('submit', event => {
  event.preventDefault();
  void trackUsage('tool_start', 'exposure');
  invalidateNd();
  try {
    const result = ndExposure(parseShutter($('ndShutter').value), $('ndUnit').value, numberFrom($('ndStrength')));
    ndSeconds = result.seconds;
    $('ndValue').textContent = formatShutter(result.seconds);
    $('ndDetails').textContent = `${result.seconds >= 60 ? `${formatDuration(result.seconds)} · ` : ''}${formatNumber(result.stops, 6)}스톱 · ${formatNumber(result.factor, 7)}배. ISO와 조리개 유지.`;
    $('ndResult').hidden = false;
    syncTransferButtons();
    void trackUsage('tool_success', 'exposure');
  } catch (error) {
    showError('ndError', error);
    void trackUsage('tool_failure', 'exposure');
  }
});

function stopTicker() { if (ticker !== null) clearInterval(ticker); ticker = null; }

function renderTimer() {
  $('timerDisplay').textContent = formatTimer(timer.remainingMs);
  const busy = timer.status !== 'ready';
  $('timerMinutes').disabled = busy;
  $('timerSeconds').disabled = busy;
  $('timerStart').textContent = { ready: '시작', running: '일시정지', paused: '재개', finished: '다시 시작' }[timer.status];
  const status = { ready: `준비됨 · ${formatDuration(timer.durationMs / 1000)}`, running: '타이머 진행 중', paused: `일시정지 · ${formatDuration(timer.remainingMs / 1000)} 남음`, finished: '설정한 시간이 끝났습니다.' }[timer.status];
  if ($('timerStatus').textContent !== status) $('timerStatus').textContent = status;
  $('timerDisplay').parentElement.classList.toggle('is-finished', timer.status === 'finished');
  syncTransferButtons();
}

function tick() {
  timer = advanceTimer(timer, Date.now());
  if (timer.status !== 'running') stopTicker();
  renderTimer();
}

function runTicker() {
  stopTicker();
  ticker = setInterval(tick, 200);
}

$('timerForm').addEventListener('submit', event => {
  event.preventDefault();
  resetError('timerError');
  try {
    if (timer.status === 'running') { timer = pauseTimer(timer, Date.now()); stopTicker(); }
    else {
      if (timer.status === 'ready') timer = createTimer(timerDuration(numberFrom($('timerMinutes')), numberFrom($('timerSeconds'))));
      timer = startTimer(timer, Date.now());
      runTicker();
    }
    renderTimer();
  } catch (error) { showError('timerError', error); }
});
$('timerReset').addEventListener('click', () => {
  stopTicker();
  timer = resetTimer(timer);
  $('timerMinutes').value = String(Math.floor(timer.durationMs / 60000));
  $('timerSeconds').value = String(timer.durationMs % 60000 / 1000);
  resetError('timerError');
  renderTimer();
});
function updateReadyTime() {
  if (timer.status !== 'ready') return;
  resetError('timerError');
  try {
    timer = createTimer(timerDuration(numberFrom($('timerMinutes')), numberFrom($('timerSeconds'))));
    renderTimer();
  } catch {
    $('timerDisplay').textContent = '--:--';
    $('timerStatus').textContent = '분과 초를 입력해 주세요. 1초~24시간까지 설정할 수 있습니다.';
  }
}
$('timerMinutes').addEventListener('input', updateReadyTime);
$('timerSeconds').addEventListener('input', updateReadyTime);

function transferToTimer(seconds) {
  if (seconds === null || seconds < 1 || timer.status !== 'ready') return;
  try {
    timer = createTimer(seconds);
    $('timerMinutes').value = String(Math.floor(timer.durationMs / 60000));
    $('timerSeconds').value = String(timer.durationMs % 60000 / 1000);
    resetError('timerError');
    renderTimer();
    $('timer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('timerStart').focus({ preventScroll: true });
  } catch (error) { showError('timerError', error); }
}
$('exposureToTimer').addEventListener('click', () => transferToTimer(exposureSeconds));
$('ndToTimer').addEventListener('click', () => transferToTimer(ndSeconds));
document.addEventListener('visibilitychange', () => { if (!document.hidden && timer.status === 'running') tick(); });
window.addEventListener('pageshow', () => { if (timer.status === 'running') tick(); });
window.addEventListener('pagehide', stopTicker);
// A page restored from the back/forward cache can retain its timer state.
window.addEventListener('pageshow', () => { if (timer.status === 'running') runTicker(); });

setTargetMode();
refreshNdUnit();
renderTimer();
