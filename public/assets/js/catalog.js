import {loadProducts, money, productLabel, productKey} from './data.js';

const $ = (s) => document.querySelector(s);
const type = document.body.dataset.catalogType === 'lens' ? '렌즈' : '바디';
const typeKey = type === '렌즈' ? 'lens' : 'body';
const PAGE_SIZE = 24;
const state = {
  all: [],
  query: '',
  sale: 'all',
  sort: 'recommend',
  visible: PAGE_SIZE,
  filters: {}
};

const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unique = (arr) => [...new Set(arr.filter(v => v !== null && v !== undefined && String(v).trim() !== ''))];
const isCurrent = (p) => p.currentSale === '예' || p.saleStatus === '현재 판매';
const keyOf = (p) => p.id || productKey(p);

function spec(p, ...names) {
  for (const name of names) {
    const v = p.specs?.[name];
    if (v !== null && v !== undefined && String(v).trim() !== '') return v;
  }
  return null;
}

function bodyRows(source) {
  return [
    {key:'manufacturer', label:'제조사', values:unique(source.map(p=>p.manufacturer)).sort((a,b)=>a.localeCompare(b,'ko')), max:8},
    {key:'mount', label:'마운트', values:unique(source.map(p=>p.mount)).sort(), max:8},
    {key:'sensorFormat', label:'센서', values:unique(source.map(p=>p.sensorFormat)).sort(), max:8},
    {key:'cameraSystem', label:'방식', values:unique(source.map(p=>p.cameraSystem)).sort(), max:8},
    {key:'ibis', label:'손떨림 보정', values:unique(source.map(p=>p.ibis)).sort(), max:6},
    {key:'releaseGroup', label:'출시 시기', values:['2024~현재','2020~2023','2015~2019','2014 이전'], max:6}
  ];
}

function lensRows(source) {
  const lensTypes = unique(source.map(p=>p.lensType || p.category)).sort();
  return [
    {key:'manufacturer', label:'제조사', values:unique(source.map(p=>p.manufacturer)).sort((a,b)=>a.localeCompare(b,'ko')), max:8},
    {key:'mount', label:'마운트', values:unique(source.map(p=>p.mount)).sort(), max:8},
    {key:'lensFormat', label:'렌즈 포맷', values:unique(source.map(p=>p.lensFormat)).sort(), max:8},
    {key:'lensType', label:'렌즈 유형', values:lensTypes.length ? lensTypes : ['광각','표준','망원','매크로','단렌즈','줌렌즈'], max:8},
    {key:'focalGroup', label:'초점거리', values:['초광각 ≤ 20mm','광각 21~35mm','표준 36~70mm','망원 71~200mm','초망원 > 200mm'], max:8},
    {key:'apertureGroup', label:'최대 조리개', values:['F1.4 이하','F1.8~F2','F2.8','F4','F4 초과'], max:8},
    {key:'stabilization', label:'손떨림 보정', values:['있음','없음'], max:6}
  ];
}

function releaseGroup(p) {
  const y = Number(p.releaseYear || 0);
  if (y >= 2024) return '2024~현재';
  if (y >= 2020) return '2020~2023';
  if (y >= 2015) return '2015~2019';
  return '2014 이전';
}

function focalGroup(p) {
  let n = Number(p.focalMinMm || 0);
  if (!n && p.focalLength) n = Number(String(p.focalLength).match(/\d+(?:\.\d+)?/)?.[0] || 0);
  if (!n) return '';
  if (n <= 20) return '초광각 ≤ 20mm';
  if (n <= 35) return '광각 21~35mm';
  if (n <= 70) return '표준 36~70mm';
  if (n <= 200) return '망원 71~200mm';
  return '초망원 > 200mm';
}

function apertureNumber(p) {
  const raw = p.maxAperture || spec(p, '최대 조리개', '개방 조리개');
  if (!raw) return null;
  const n = Number(String(raw).replace(/F\/?/ig,'').match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

function apertureGroup(p) {
  const n = apertureNumber(p);
  if (n === null) return '';
  if (n <= 1.4) return 'F1.4 이하';
  if (n <= 2) return 'F1.8~F2';
  if (n <= 2.9) return 'F2.8';
  if (n <= 4.1) return 'F4';
  return 'F4 초과';
}

function stabilization(p) {
  const v = [p.oss, spec(p,'손떨림 보정(OSS) 여부','손떨림 보정 여부','OIS','IS')].filter(Boolean).join(' ');
  if (/있음|예|지원|OIS|OSS|IS/i.test(v) && !/없음|아니오/i.test(v)) return '있음';
  return '없음';
}

function lensTypeValue(p) {
  return p.lensType || p.category || '';
}

function matchesFilter(p, key, value) {
  if (!value) return true;
  if (key === 'releaseGroup') return releaseGroup(p) === value;
  if (key === 'focalGroup') return focalGroup(p) === value;
  if (key === 'apertureGroup') return apertureGroup(p) === value;
  if (key === 'stabilization') return stabilization(p) === value;
  if (key === 'lensType') {
    const v = lensTypeValue(p);
    if (v) return v === value;
    const fmin = Number(p.focalMinMm || 0), fmax = Number(p.focalMaxMm || 0);
    if (value === '단렌즈') return fmin && fmin === fmax;
    if (value === '줌렌즈') return fmin && fmax && fmin !== fmax;
    return false;
  }
  return String(p[key] ?? '') === String(value);
}

function renderFilters() {
  const source = state.all.filter(p=>p.type===type);
  const rows = type === '바디' ? bodyRows(source) : lensRows(source);
  $('#filterRows').innerHTML = rows.map(row => {
    const current = state.filters[row.key] || '';
    const values = row.values.slice(0, row.max || row.values.length);
    return `<div class="filter-row" data-filter-row="${esc(row.key)}">
      <strong><i></i>${esc(row.label)}</strong>
      <div class="filter-options">
        <button class="filter-chip ${!current?'selected':''}" data-filter-key="${esc(row.key)}" data-filter-value="" type="button">전체</button>
        ${values.map(v=>`<button class="filter-chip ${current===String(v)?'selected':''}" data-filter-key="${esc(row.key)}" data-filter-value="${esc(v)}" type="button">${esc(v)}</button>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function filtered() {
  let list = state.all.filter(p=>p.type===type);
  const q = state.query.trim().toLowerCase();
  if (q) {
    list = list.filter(p => [p.officialName,p.model,p.modelCode,p.series,p.manufacturer,p.mount,p.lensFormat,p.focalLength,p.maxAperture]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  for (const [k,v] of Object.entries(state.filters)) if (v) list = list.filter(p=>matchesFilter(p,k,v));
  if (state.sale === 'current') list = list.filter(isCurrent);
  if (state.sale === 'discontinued') list = list.filter(p=>!isCurrent(p));
  if (state.sort === 'new') list.sort((a,b)=>(b.releaseYear||0)-(a.releaseYear||0)||productLabel(a).localeCompare(productLabel(b),'ko'));
  else if (state.sort === 'name') list.sort((a,b)=>productLabel(a).localeCompare(productLabel(b),'ko'));
  else list.sort((a,b)=>Number(isCurrent(b))-Number(isCurrent(a))||(b.releaseYear||0)-(a.releaseYear||0)||productLabel(a).localeCompare(productLabel(b),'ko'));
  return list;
}

function cameraPlaceholder(p) {
  return `<div class="product-visual camera-visual" aria-label="카메라 바디 이미지 자리">
    <span class="camera-shape"><i></i></span>
    <small>${esc(p.manufacturer || '')}</small>
  </div>`;
}

function lensPlaceholder(p) {
  return `<div class="product-visual lens-visual" aria-label="렌즈 이미지 자리">
    <span class="lens-shape"><i></i><b></b></span>
    <small>${esc(p.manufacturer || '')}</small>
  </div>`;
}

function bodySpecs(p) {
  const mp = spec(p,'유효 화소(MP)','유효 화소');
  const fps = spec(p,'최고 연속촬영 속도(fps)','연속촬영');
  const video = spec(p,'최고 동영상 해상도');
  return [
    p.sensorFormat,
    p.mount,
    mp ? `${mp}MP` : null,
    p.ibis ? `IBIS ${p.ibis}` : null,
    fps ? `${fps}fps` : null,
    video
  ].filter(Boolean);
}

function lensSpecs(p) {
  return [
    p.mount,
    p.lensFormat,
    p.focalLength || (p.focalMinMm ? `${p.focalMinMm}${p.focalMaxMm && p.focalMaxMm!==p.focalMinMm?`-${p.focalMaxMm}`:''}mm` : null),
    p.maxAperture,
    p.weightG ? `${p.weightG}g` : null,
    stabilization(p)==='있음' ? '손떨림 보정' : null
  ].filter(Boolean);
}

function actionUrl(p) {
  if (typeKey === 'body') return `/builder/?mode=lens&body=${encodeURIComponent(keyOf(p))}`;
  return `/builder/?mode=lens&lenses=${encodeURIComponent(keyOf(p))}`;
}

function card(p) {
  const specs = type === '바디' ? bodySpecs(p) : lensSpecs(p);
  const visual = type === '바디' ? cameraPlaceholder(p) : lensPlaceholder(p);
  const price = p.currentPriceUsd ? money(p.currentPriceUsd) : '가격 미확인';
  return `<article class="finder-card">
    <div class="recommend-ribbon">추천</div>
    ${visual}
    <div class="finder-card-body">
      <div class="card-topline">
        <span>${esc(p.manufacturer || '')}</span>
        <span>${esc(p.saleStatus || (isCurrent(p)?'현재 판매':'단종'))}</span>
      </div>
      <h2>${esc(productLabel(p))}</h2>
      <p class="card-model">${esc(p.modelCode || p.series || '')}</p>
      <div class="card-specs">${specs.map(s=>`<span>${esc(s)}</span>`).join('')}</div>
      <div class="card-meta">
        <span>출시 ${esc(p.releaseYear || '-')}</span>
        <span>${p.weightG ? `무게 ${esc(p.weightG)}g` : '무게 미확인'}</span>
      </div>
      <div class="card-price"><small>공식 가격</small><strong>${esc(price)}</strong></div>
      <div class="card-actions">
        <a class="detail-link" href="/database/?q=${encodeURIComponent(productLabel(p))}">상세 사양</a>
        <a class="build-add" href="${actionUrl(p)}">내 구성에 담기</a>
      </div>
    </div>
  </article>`;
}

function render() {
  const list = filtered();
  $('#catalogCount').textContent = list.length.toLocaleString();
  const visible = list.slice(0,state.visible);
  $('#productCards').innerHTML = visible.length ? visible.map(card).join('') : `<div class="finder-empty">조건에 맞는 ${type}가 없습니다.<br><button id="resetFiltersInline" type="button">필터 초기화</button></div>`;
  $('#loadMore').classList.toggle('hidden', visible.length >= list.length);
}

function resetFilters() {
  state.filters = {};
  state.query = '';
  state.sale = 'all';
  state.visible = PAGE_SIZE;
  $('#catalogSearch').value = '';
  $('#saleSelect').value = 'all';
  renderFilters();
  render();
}

state.all = await loadProducts();
renderFilters();
render();

$('#catalogSearch').addEventListener('input', e=>{state.query=e.target.value;state.visible=PAGE_SIZE;render();});
$('#clearCatalogSearch').addEventListener('click', resetFilters);
$('#saleSelect').addEventListener('change', e=>{state.sale=e.target.value;state.visible=PAGE_SIZE;render();});
$('#loadMore').addEventListener('click', ()=>{state.visible+=PAGE_SIZE;render();});

document.addEventListener('click', e=>{
  const chip=e.target.closest('[data-filter-key]');
  if(chip){
    state.filters[chip.dataset.filterKey]=chip.dataset.filterValue;
    state.visible=PAGE_SIZE;
    renderFilters();
    render();
    return;
  }
  const sort=e.target.closest('[data-sort]');
  if(sort){
    state.sort=sort.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach(x=>x.classList.toggle('active',x===sort));
    render();
    return;
  }
  if(e.target.closest('#resetFiltersInline')) resetFilters();
});
