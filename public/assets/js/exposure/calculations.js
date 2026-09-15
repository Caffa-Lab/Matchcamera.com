export const EXPOSURE_LIMITS = Object.freeze({
  iso: [1, 10240000],
  aperture: [0.1, 256],
  shutterSeconds: [0.000001, 86400],
});
export const MAX_TIMER_SECONDS = 86400;
const LABELS = { iso: 'ISO', aperture: '조리개', shutterSeconds: '셔터 시간(초)' };

function inRange(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    const display = number => number.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
    throw new RangeError(`${label} 값은 ${display(min)} 이상 ${display(max)} 이하로 입력해 주세요.`);
  }
  return value;
}

export function exposureValue(value, key) {
  if (!Object.hasOwn(EXPOSURE_LIMITS, key)) throw new TypeError('지원하지 않는 노출 항목입니다.');
  return inRange(value, ...EXPOSURE_LIMITS[key], LABELS[key]);
}

export function parseShutter(value) {
  if (typeof value === 'number') return exposureValue(value, 'shutterSeconds');
  if (typeof value !== 'string') throw new TypeError('셔터 시간은 1/125 또는 초 단위 숫자로 입력해 주세요.');
  const text = value.trim().replace(/\s*(?:초|sec|s)$/i, '').trim();
  const decimal = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const fraction = text.match(new RegExp(`^(${decimal})\\s*/\\s*(${decimal})$`));
  let seconds;
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) throw new RangeError('셔터 시간의 분자와 분모는 0보다 커야 합니다.');
    seconds = numerator / denominator;
  } else if (new RegExp(`^${decimal}$`).test(text)) {
    seconds = Number(text);
  } else {
    throw new TypeError('셔터 시간은 1/125 또는 초 단위 숫자로 입력해 주세요.');
  }
  return exposureValue(seconds, 'shutterSeconds');
}

// Equal image brightness for the same scene: time * ISO / aperture^2 is constant.
export function equivalentExposure(base, target, solveFor) {
  if (!Object.hasOwn(EXPOSURE_LIMITS, solveFor)) throw new TypeError('계산할 항목을 선택해 주세요.');
  const source = {};
  const result = {};
  for (const key of Object.keys(EXPOSURE_LIMITS)) {
    source[key] = exposureValue(base?.[key], key);
    if (key !== solveFor) result[key] = exposureValue(target?.[key], key);
  }
  if (solveFor === 'shutterSeconds') result.shutterSeconds = source.shutterSeconds * (source.iso / result.iso) * (result.aperture / source.aperture) ** 2;
  if (solveFor === 'aperture') result.aperture = source.aperture * Math.sqrt((result.shutterSeconds / source.shutterSeconds) * (result.iso / source.iso));
  if (solveFor === 'iso') result.iso = source.iso * (source.shutterSeconds / result.shutterSeconds) * (result.aperture / source.aperture) ** 2;
  exposureValue(result[solveFor], solveFor);
  return result;
}

export function ndExposure(shutterSeconds, unit, strength) {
  exposureValue(shutterSeconds, 'shutterSeconds');
  if (!['stops', 'factor'].includes(unit)) throw new TypeError('ND 스톱 또는 배수를 선택해 주세요.');
  const factor = unit === 'stops'
    ? 2 ** inRange(strength, 0, 20, 'ND 스톱')
    : inRange(strength, 1, 2 ** 20, 'ND 배수');
  const seconds = shutterSeconds * factor;
  if (!Number.isFinite(seconds) || seconds > EXPOSURE_LIMITS.shutterSeconds[1]) throw new RangeError('계산된 노출 시간이 24시간을 초과합니다. 기준 시간 또는 ND 강도를 낮춰 주세요.');
  return { seconds, factor, stops: Math.log2(factor) };
}

export function formatNumber(value, digits = 4) {
  if (!Number.isFinite(value)) throw new TypeError('표시할 숫자가 올바르지 않습니다.');
  return Number(value.toPrecision(digits)).toLocaleString('ko-KR', { maximumFractionDigits: 8 });
}

export function formatShutter(seconds) {
  exposureValue(seconds, 'shutterSeconds');
  return seconds < 1 ? `1/${formatNumber(1 / seconds, 5)}초` : `${formatNumber(seconds, 6)}초`;
}

export function formatDuration(seconds) {
  inRange(seconds, 0, MAX_TIMER_SECONDS, '시간(초)');
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor(milliseconds % 3600000 / 60000);
  const remainder = Number((milliseconds % 60000 / 1000).toFixed(3));
  return [hours ? `${hours}시간` : '', minutes ? `${minutes}분` : '', remainder || (!hours && !minutes) ? `${remainder}초` : ''].filter(Boolean).join(' ');
}

export function timerDuration(minutes, seconds) {
  inRange(minutes, 0, 1440, '분');
  if (!Number.isInteger(minutes)) throw new RangeError('분은 정수로 입력해 주세요.');
  inRange(seconds, 0, 59.999, '초');
  const total = Math.round((minutes * 60 + seconds) * 1000) / 1000;
  return inRange(total, 1, MAX_TIMER_SECONDS, '타이머 시간(초)');
}

export function createTimer(seconds) {
  inRange(seconds, 1, MAX_TIMER_SECONDS, '타이머 시간(초)');
  const durationMs = Math.round(seconds * 1000);
  return { status: 'ready', durationMs, remainingMs: durationMs, deadline: null };
}

function timestamp(now) {
  return inRange(now, 0, Number.MAX_SAFE_INTEGER - MAX_TIMER_SECONDS * 1000, '현재 시각');
}

export function advanceTimer(timer, now) {
  timestamp(now);
  if (timer.status !== 'running') return { ...timer };
  const remainingMs = Math.max(0, Math.min(timer.durationMs, timer.deadline - now));
  return { ...timer, remainingMs, status: remainingMs === 0 ? 'finished' : 'running', deadline: remainingMs === 0 ? null : timer.deadline };
}

export function startTimer(timer, now) {
  timestamp(now);
  if (timer.status === 'running') return advanceTimer(timer, now);
  const remainingMs = timer.status === 'finished' ? timer.durationMs : timer.remainingMs;
  return { ...timer, remainingMs, status: 'running', deadline: now + remainingMs };
}

export function pauseTimer(timer, now) {
  const current = advanceTimer(timer, now);
  return current.status === 'running' ? { ...current, status: 'paused', deadline: null } : current;
}

export function resetTimer(timer) {
  return createTimer(timer.durationMs / 1000);
}

export function formatTimer(milliseconds) {
  inRange(milliseconds, 0, MAX_TIMER_SECONDS * 1000, '남은 시간');
  const seconds = Math.ceil(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const pad = value => String(value).padStart(2, '0');
  return `${hours ? `${pad(hours)}:` : ''}${pad(minutes)}:${pad(seconds % 60)}`;
}
