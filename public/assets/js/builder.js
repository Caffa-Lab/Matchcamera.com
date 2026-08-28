import {loadProducts, money, productLabel, productKey} from './data.js';
import {checkCompatibility} from './compatibility.js';

const $ = (s) => document.querySelector(s);
const MAX_RENDER = 120;
const state = {
  products: [], body: null, lenses: [], mode: 'body', query: '',
  manufacturer: 'all', mount: 'all', format: 'all', sale: 'all', compatOnly: true
};

const escapeHtml = (value='') => String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const isSale = p => p.currentSale === '예' || p.saleStatus === '현재 판매';
const keyOf = p => p?.id || productKey(p);

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 1500);
}

function optionList(values, label) {
  return `<option value="all">${label}</option>` + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
}

function productIcon(type) {
  return `<span class="catalog-thumb ${type === '바디' ? 'camera-thumb' : 'lens-thumb'}" aria-hidden="true"><i></i></span>`;
}

function compatBadge(c) {
  const cls = c.level === 'compatible' ? 'good' : c.level === 'conditional' ? 'conditional' : c.level === 'incompatible' ? 'bad' : 'neutral';
  return `<span class="mini-compat ${cls}">${escapeHtml(c.label)}</span>`;
}

function hydrate() {
  const q = new URLSearchParams(location.search);
  const mode = q.get('mode');
  if (mode === 'lens' || mode === 'body') state.mode = mode;
  const bodyKey = q.get('body');
  const lensKeys = (q.get('lenses') || '').split(',').filter(Boolean);
  if (bodyKey) state.body = state.products.find(p => p.id === bodyKey || productKey(p) === bodyKey) || null;
  state.lenses = lensKeys.map(k => state.products.find(p => p.id === k || productKey(p) === k)).filter(Boolean);
  if (state.body && !mode) state.mode = 'lens';
}

function syncUrl() {
  const q = new URLSearchParams();
  q.set('mode', state.mode);
  if (state.body) q.set('body', keyOf(state.body));
  if (state.lenses.length) q.set('lenses', state.lenses.map(keyOf).join(','));
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

function refreshFilters() {
  const source = state.products.filter(p => p.type === (state.mode === 'body' ? '바디' : '렌즈'));
  const brands = [...new Set(source.map(p => p.manufacturer).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'ko'));
  $('#manufacturerFilter').innerHTML = optionList(brands, '모든 제조사');
  if (!brands.includes(state.manufacturer)) state.manufacturer = 'all';
  $('#manufacturerFilter').value = state.manufacturer;

  let mountSource = source.filter(p => state.manufacturer === 'all' || p.manufacturer === state.manufacturer);
  if (state.mode === 'lens' && state.body && state.compatOnly) mountSource = source.filter(p => p.mount === state.body.mount);
  const mounts = [...new Set(mountSource.map(p => p.mount).filter(Boolean))].sort();
  $('#mountFilter').innerHTML = optionList(mounts, state.mode === 'body' ? '모든 바디 마운트' : '모든 렌즈 마운트');
  if (!mounts.includes(state.mount)) state.mount = 'all';
  $('#mountFilter').value = state.mount;

  let formatSource = mountSource.filter(p => state.mount === 'all' || p.mount === state.mount);
  const formats = [...new Set(formatSource.map(p => state.mode === 'body' ? p.sensorFormat : p.lensFormat).filter(Boolean))].sort();
  $('#formatFilter').innerHTML = optionList(formats, state.mode === 'body' ? '모든 센서 포맷' : '모든 렌즈 포맷');
  if (!formats.includes(state.format)) state.format = 'all';
  $('#formatFilter').value = state.format;

  $('#catalogMode').value = state.mode;
  $('#catalogTitle').textContent = state.mode === 'body' ? '카메라 바디' : (state.body ? `${state.body.mount} 호환 렌즈` : '카메라 렌즈');
  $('#compatOnlyWrap').classList.toggle('hidden', state.mode !== 'lens' || !state.body);
  $('#compatOnly').checked = state.compatOnly;
}

function filteredCatalog() {
  let xs = state.products.filter(p => p.type === (state.mode === 'body' ? '바디' : '렌즈'));
  if (state.mode === 'lens' && state.body && state.compatOnly) xs = xs.filter(p => p.mount === state.body.mount && checkCompatibility(state.body, p).level !== 'incompatible');
  if (state.manufacturer !== 'all') xs = xs.filter(p => p.manufacturer === state.manufacturer);
  if (state.mount !== 'all') xs = xs.filter(p => p.mount === state.mount);
  if (state.format !== 'all') xs = xs.filter(p => state.mode === 'body' ? p.sensorFormat === state.format : p.lensFormat === state.format);
  if (state.sale === 'yes') xs = xs.filter(isSale);
  if (state.query) {
    const q = state.query.toLowerCase();
    xs = xs.filter(p => `${productLabel(p)} ${p.modelCode || ''} ${p.series || ''} ${p.manufacturer || ''} ${p.mount || ''}`.toLowerCase().includes(q));
  }
  const rank = p => state.mode === 'lens' && state.body ? ({compatible:0, conditional:1, unknown:2, incompatible:3}[checkCompatibility(state.body,p).level] ?? 4) : 0;
  return xs.sort((a,b) => rank(a)-rank(b) || Number(isSale(b))-Number(isSale(a)) || (b.releaseYear||0)-(a.releaseYear||0) || productLabel(a).localeCompare(productLabel(b), 'ko'));
}

function renderCatalog() {
  const xs = filteredCatalog();
  $('#resultCount').textContent = xs.length.toLocaleString();
  const shown = xs.slice(0, MAX_RENDER);
  $('#catalogList').innerHTML = shown.map(p => {
    const selected = state.mode === 'body' ? state.body?.id === p.id : state.lenses.some(x => x.id === p.id);
    const c = state.mode === 'lens' && state.body ? checkCompatibility(state.body, p) : null;
    const sub = state.mode === 'body'
      ? `${p.sensorFormat || '-'} · ${p.mount || '-'} · ${p.releaseYear || '-'}`
      : `${p.mount || '-'} · ${p.lensFormat || '-'} · ${p.focalLength || '-'} ${p.maxAperture ? `· ${p.maxAperture}` : ''}`;
    return `<article class="catalog-item ${selected ? 'selected' : ''}">
      ${productIcon(p.type)}
      <div class="catalog-product">
        <div class="catalog-product-top"><b>${escapeHtml(productLabel(p))}</b>${isSale(p) ? '<span class="sale-dot">판매</span>' : ''}</div>
        <div class="catalog-sub">${escapeHtml(sub)}</div>
        <div class="catalog-meta"><span>${escapeHtml(p.modelCode || p.series || '')}</span>${c ? compatBadge(c) : ''}</div>
        <div class="catalog-price">${money(p.currentPriceUsd)} <small>공식 확인가</small></div>
      </div>
      <button class="catalog-add ${selected ? 'remove' : ''}" data-${state.mode === 'body' ? 'body' : 'lens'}="${escapeHtml(p.id)}" type="button">${selected ? '선택됨' : state.mode === 'body' ? '선택' : '+ 추가'}</button>
    </article>`;
  }).join('') || `<div class="catalog-empty"><b>검색 결과가 없습니다.</b><span>필터를 줄이거나 검색어를 바꿔보세요.</span></div>`;
  if (xs.length > MAX_RENDER) $('#catalogList').insertAdjacentHTML('beforeend', `<div class="catalog-more">성능을 위해 상위 ${MAX_RENDER}개만 표시 중 · 검색/필터로 좁혀보세요.</div>`);
}

function renderBodySlot() {
  const el = $('#bodySlot');
  if (!state.body) {
    el.innerHTML = `<button class="empty-slot" data-slot-mode="body" type="button"><b>미선택</b><span>왼쪽 목록에서 바디를 선택하세요.</span></button>`;
    return;
  }
  el.innerHTML = `<div class="selected-slot"><b>${escapeHtml(productLabel(state.body))}</b><span>${escapeHtml(state.body.manufacturer)} · ${escapeHtml(state.body.sensorFormat || '-')} · ${escapeHtml(state.body.mount || '-')}</span></div><button class="slot-remove" data-remove-body type="button" aria-label="바디 제거">×</button>`;
}

function renderLensSlots() {
  const el = $('#lensSlots');
  const chosen = state.lenses.map((p, i) => {
    const c = state.body ? checkCompatibility(state.body, p) : null;
    return `<div class="build-row lens-row">
      <div class="slot-icon lens-icon" aria-hidden="true"></div>
      <div class="slot-label"><strong>렌즈 ${i + 1}</strong><span>${c ? escapeHtml(c.label) : '렌즈 구성'}</span></div>
      <div class="slot-content"><div class="selected-slot"><b>${escapeHtml(productLabel(p))}</b><span>${escapeHtml(p.manufacturer)} · ${escapeHtml(p.lensFormat || '-')} · ${escapeHtml(p.focalLength || '-')} ${c ? compatBadge(c) : ''}</span></div><button class="slot-remove" data-remove-lens="${escapeHtml(p.id)}" type="button" aria-label="렌즈 제거">×</button></div>
      <button class="slot-select" data-slot-mode="lens" type="button">렌즈 변경</button>
    </div>`;
  }).join('');
  const emptyIndex = state.lenses.length + 1;
  el.innerHTML = chosen + `<div class="build-row lens-row add-lens-row" data-slot-mode="lens">
    <div class="slot-icon lens-icon" aria-hidden="true"></div>
    <div class="slot-label"><strong>렌즈 ${emptyIndex}</strong><span>복수 렌즈 추가 가능</span></div>
    <div class="slot-content"><button class="empty-slot" data-slot-mode="lens" type="button"><b>미선택</b><span>${state.body ? `${escapeHtml(state.body.mount)} 렌즈를 추가하세요.` : '바디 선택 후 렌즈를 추가하세요.'}</span></button></div>
    <button class="slot-select" data-slot-mode="lens" type="button">+ 렌즈 추가</button>
  </div>`;
}

function renderSummary() {
  const items = [state.body, ...state.lenses].filter(Boolean);
  const priced = items.filter(p => Number.isFinite(Number(p.currentPriceUsd)));
  const total = priced.reduce((s,p) => s + Number(p.currentPriceUsd), 0);
  const weighted = items.filter(p => Number.isFinite(Number(p.weightG)));
  const weight = weighted.reduce((s,p) => s + Number(p.weightG), 0);
  $('#totalPrice').textContent = priced.length ? money(total) : '-';
  $('#pricedCount').textContent = `${priced.length} / ${items.length}`;
  $('#priceNote').textContent = items.length && priced.length !== items.length ? '가격 미확인 제품은 합계에서 제외했습니다.' : '공식 가격이 확인된 제품만 합산합니다.';
  $('#itemCount').textContent = `${items.length}개`;
  $('#totalWeight').textContent = weighted.length ? `${weight.toLocaleString()} g${weighted.length !== items.length ? ' +' : ''}` : '-';
  $('#summaryMount').textContent = state.body?.mount || '-';
  $('#summarySensor').textContent = state.body?.sensorFormat || '-';

  if (!state.body || !state.lenses.length) {
    $('#compatOverall').className = 'compat-pill neutral';
    $('#compatOverall').textContent = '선택 필요';
    $('#compatDetails').innerHTML = '<p class="empty-summary">바디와 렌즈를 선택하면 조합별 호환성을 확인합니다.</p>';
    return;
  }
  const results = state.lenses.map(p => ({p, c: checkCompatibility(state.body, p)}));
  const worst = results.find(x => x.c.level === 'incompatible') || results.find(x => x.c.level === 'conditional') || results[0];
  const overallClass = worst.c.level === 'compatible' ? 'good' : worst.c.level === 'conditional' ? 'conditional' : 'bad';
  $('#compatOverall').className = `compat-pill ${overallClass}`;
  $('#compatOverall').textContent = worst.c.level === 'compatible' ? '호환 정상' : worst.c.label;
  $('#compatDetails').innerHTML = results.map(({p,c}) => `<div class="compat-detail-row"><div><b>${escapeHtml(productLabel(p))}</b><span>${escapeHtml(c.reason)}</span></div>${compatBadge(c)}</div>`).join('');
}

function render() {
  refreshFilters();
  renderCatalog();
  renderBodySlot();
  renderLensSlots();
  renderSummary();
  syncUrl();
}

function switchMode(mode) {
  state.mode = mode;
  state.manufacturer = 'all';
  state.mount = 'all';
  state.format = 'all';
  state.query = '';
  $('#search').value = '';
  render();
}

function selectBody(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  state.body = p;
  state.lenses = state.lenses.filter(l => checkCompatibility(p, l).level !== 'incompatible');
  state.mode = 'lens';
  state.manufacturer = 'all'; state.mount = 'all'; state.format = 'all'; state.query = '';
  $('#search').value = '';
  render();
  toast(`${productLabel(p)} 기준으로 호환 렌즈를 표시합니다.`);
}

function toggleLens(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  if (state.lenses.some(x => x.id === p.id)) state.lenses = state.lenses.filter(x => x.id !== p.id);
  else state.lenses = [...state.lenses, p];
  render();
}

state.products = await loadProducts();
hydrate();
render();

$('#catalogMode').addEventListener('change', e => switchMode(e.target.value));
$('#search').addEventListener('input', e => { state.query = e.target.value.trim(); renderCatalog(); });
$('#clearSearch').addEventListener('click', () => { state.query = ''; $('#search').value = ''; renderCatalog(); });
$('#manufacturerFilter').addEventListener('change', e => { state.manufacturer = e.target.value; state.mount = 'all'; state.format = 'all'; render(); });
$('#mountFilter').addEventListener('change', e => { state.mount = e.target.value; state.format = 'all'; render(); });
$('#formatFilter').addEventListener('change', e => { state.format = e.target.value; render(); });
$('#saleFilter').addEventListener('change', e => { state.sale = e.target.value; renderCatalog(); });
$('#compatOnly').addEventListener('change', e => { state.compatOnly = e.target.checked; state.mount = 'all'; state.format = 'all'; render(); });

document.addEventListener('click', e => {
  const body = e.target.closest('[data-body]');
  if (body) { selectBody(body.dataset.body); return; }
  const lens = e.target.closest('[data-lens]');
  if (lens) { toggleLens(lens.dataset.lens); return; }
  if (e.target.closest('[data-remove-body]')) { state.body = null; state.lenses = []; state.mode = 'body'; render(); return; }
  const removeLens = e.target.closest('[data-remove-lens]');
  if (removeLens) { state.lenses = state.lenses.filter(x => x.id !== removeLens.dataset.removeLens); render(); return; }
  const slot = e.target.closest('[data-slot-mode]');
  if (slot) { switchMode(slot.dataset.slotMode); document.querySelector('.catalog-pane')?.scrollIntoView({behavior:'smooth', block:'start'}); }
});

$('#resetBtn').addEventListener('click', () => {
  state.body = null; state.lenses = []; state.mode = 'body'; state.query = ''; state.manufacturer = 'all'; state.mount = 'all'; state.format = 'all'; state.sale = 'all';
  $('#search').value = '';
  render(); toast('구성을 초기화했습니다.');
});

$('#saveBtn').addEventListener('click', () => {
  localStorage.setItem('matchcamera:lastBuild', JSON.stringify({body: state.body?.id || null, lenses: state.lenses.map(x => x.id)}));
  toast('현재 구성을 저장했습니다.');
});

$('#loadBtn').addEventListener('click', () => {
  try {
    const saved = JSON.parse(localStorage.getItem('matchcamera:lastBuild') || 'null');
    if (!saved) return toast('저장된 구성이 없습니다.');
    state.body = state.products.find(p => p.id === saved.body) || null;
    state.lenses = (saved.lenses || []).map(id => state.products.find(p => p.id === id)).filter(Boolean);
    state.mode = state.body ? 'lens' : 'body';
    render(); toast('마지막 구성을 불러왔습니다.');
  } catch { toast('저장된 구성을 불러오지 못했습니다.'); }
});

$('#shareBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); toast('공유 링크를 복사했습니다.'); }
  catch { toast('주소창의 URL을 복사해 주세요.'); }
});
