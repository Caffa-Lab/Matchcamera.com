import { ShutterReader } from './client.js?v=20261020-shutter';
import { MAX_BATCH_FILES, fileProblem } from './result.js?v=20261020-shutter';

const $ = id => document.getElementById(id);
const fileInput = $('fileInput'), dropzone = $('dropzone'), list = $('list');
const status = $('status'), clearButton = $('clearResults');
const reader = new ShutterReader();
let busy = false, generation = 0;
const number = new Intl.NumberFormat('ko-KR');
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
function refresh() {
  $('resultCount').textContent = `${list.children.length}개`;
  $('emptyResults').hidden = list.children.length > 0;
  clearButton.hidden = list.children.length === 0;
  clearButton.textContent = busy ? '분석 취소 · 결과 지우기' : '결과 지우기';
  fileInput.disabled = busy;
  dropzone.disabled = busy;
  dropzone.setAttribute('aria-disabled', String(busy));
  list.setAttribute('aria-busy', String(busy));
}
function card(file) {
  const item = node('article', 'shutter-card');
  const head = node('div', 'shutter-filehead');
  const icon = node('div', 'shutter-thumb', file.name.split('.').at(-1).toUpperCase().slice(0, 6));
  icon.setAttribute('aria-hidden', 'true');
  const info = node('div', 'shutter-file-info');
  info.append(node('h3', 'shutter-filename', file.name), node('p', 'shutter-file-meta', `${(file.size / (1024 * 1024)).toFixed(1)} MB`));
  head.append(icon, info);
  const body = node('div', 'shutter-result');
  body.append(node('p', 'shutter-note', '분석 대기 중…'));
  item.append(head, body); list.append(item);
  return { item, body };
}
function showError(view, message) {
  view.item.className = 'shutter-card is-error';
  view.body.replaceChildren(node('span', 'shutter-badge', '확인 불가'), node('p', 'shutter-note', message));
}
function render(view, result) {
  view.item.className = `shutter-card is-${result.status === 'found' ? 'success' : result.status}`;
  view.body.replaceChildren();
  const found = result.status === 'found';
  view.body.append(node('span', 'shutter-badge', found ? '카운터 확인' : '확인 불가'), node('p', 'shutter-camera', result.camera));
  if (!found) { view.body.append(node('p', 'shutter-note', result.message)); return; }
  const main = result.counters[0];
  view.body.append(node('p', 'shutter-result-label', main.label));
  const value = node('div', 'shutter-value', number.format(main.value));
  value.append(node('span', 'shutter-unit', main.source.endsWith(':ImageCount') ? '장' : '회'));
  view.body.append(value, node('p', 'shutter-note', main.note));
  if (result.warning) view.body.append(node('p', 'shutter-note', '일부 메타데이터를 읽는 중 경고가 발생했습니다. 다른 원본 사진으로도 확인해 주세요.'));
  const details = node('details', 'shutter-details');
  details.append(node('summary', '', '확인한 기록 보기'));
  const fields = node('dl', 'shutter-fields');
  for (const counter of result.counters) {
    fields.append(node('dt', '', `${counter.label} (${counter.source})`), node('dd', '', number.format(counter.value)));
  }
  if (result.date) fields.append(node('dt', '', '사진에 기록된 촬영 시각'), node('dd', '', result.date));
  if (result.fileType) fields.append(node('dt', '', '파일 형식'), node('dd', '', result.fileType));
  details.append(fields, node('p', 'shutter-note', '파일에 기록된 시점의 값입니다. 카메라의 현재 값이나 남은 셔터 수명을 보장하지 않습니다.'));
  view.body.append(details);
}
async function handleFiles(selected) {
  if (busy || !selected.length) return;
  const files = [...selected];
  if (files.length > MAX_BATCH_FILES) { status.textContent = '한 번에 최대 20개 파일을 선택해 주세요.'; return; }
  busy = true;
  const batch = ++generation;
  const views = files.map(file => ({ file, view: card(file) }));
  refresh();
  for (const [index, { file, view }] of views.entries()) {
    if (batch !== generation) return;
    const problem = fileProblem(file);
    if (problem) { showError(view, problem); continue; }
    try {
      status.textContent = `${index + 1} / ${files.length} 사진 분석 중…`;
      view.body.replaceChildren(node('p', 'shutter-note', '카메라 기록을 확인하고 있습니다…'));
      const result = await reader.read(file, message => {
        if (batch === generation) view.body.replaceChildren(node('p', 'shutter-note', message));
      });
      if (batch === generation) render(view, result);
    } catch (error) {
      if (batch === generation) showError(view, error.message);
    }
  }
  if (batch === generation) { busy = false; status.textContent = '확인이 끝났습니다.'; reader.disposeWorker(); refresh(); }
}
dropzone.addEventListener('click', () => { if (!busy) fileInput.click(); });
for (const name of ['dragenter', 'dragover', 'dragleave', 'drop']) {
  dropzone.addEventListener(name, event => { event.preventDefault(); event.stopPropagation(); });
}
dropzone.addEventListener('dragover', () => { if (!busy) dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', event => { dropzone.classList.remove('dragover'); void handleFiles(event.dataTransfer.files); });
fileInput.addEventListener('change', () => { void handleFiles(fileInput.files); fileInput.value = ''; });
clearButton.addEventListener('click', () => {
  generation++; reader.cancel(); busy = false; list.replaceChildren();
  status.textContent = '준비됨'; refresh();
});
window.addEventListener('pagehide', () => {
  generation++; reader.cancel();
  if (busy) {
    busy = false;
    status.textContent = '페이지 이동으로 분석이 중단되었습니다. 사진을 다시 선택해 주세요.';
    for (const item of list.children) {
      if (item.className === 'shutter-card') showError({ item, body: item.lastElementChild }, '페이지 이동으로 분석이 중단되었습니다.');
    }
  }
  refresh();
});
refresh();
