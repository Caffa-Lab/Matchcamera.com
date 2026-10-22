import { loadProductIndex, loadManufacturerOrder, sortManufacturers, publicManufacturer, productLabel, matchesSearch } from '../data.js?v=20261006-catalog';
import { loadUsedPriceData, summarizeUsedOffers, buildUsedPriceHistory } from '../used-prices.js?v=20261022-history';
import { createUsedPriceChart } from './price-chart.js?v=20261022-history';

const $ = id => document.getElementById(id);
const refs = Object.fromEntries(['usedSearch', 'usedType', 'usedBrand', 'usedAvailability', 'usedShowAll', 'usedStatus', 'usedGrid', 'usedCount', 'usedMore', 'usedDetail', 'usedRetry', 'usedReset'].map(id => [id, $(id)]));
const PAGE_SIZE = 24;
const PRIORITY_BRANDS = ['Sony', 'Canon', 'Nikon', 'Fujifilm', 'Hasselblad'];
const money = value => Number.isFinite(value) && value > 0 ? `${new Intl.NumberFormat('ko-KR').format(value)}원` : '가격 확인 필요';
const state = { products: [], data: null, summaries: new Map(), query: '', type: '', brand: '', availability: '', all: false, visible: PAGE_SIZE, selected: '', loading: false, error: false };
const node = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = String(text);
  return item;
};
function action(text, handler, className = 'used-button') {
  const button = node('button', className, text);
  button.type = 'button'; button.addEventListener('click', handler); return button;
}
function externalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
function visual(product) {
  const wrap = node('div', 'used-visual');
  const fallback = node('span', 'used-visual-placeholder', publicManufacturer(product.manufacturer) || '사진 준비 중');
  wrap.append(fallback);
  const source = typeof product.imageSrc === 'string' ? product.imageSrc : '';
  if (source.startsWith('/assets/images/') && !source.includes('..') && !source.includes('\\')) {
    const image = node('img'); image.src = source; image.alt = productLabel(product); image.loading = 'lazy'; image.decoding = 'async';
    fallback.hidden = true;
    image.addEventListener('error', () => { image.remove(); fallback.hidden = false; }, { once: true });
    wrap.append(image);
  }
  return wrap;
}
function summary(product) { return state.summaries.get(product.id); }
const hasPrice = result => Boolean(result?.count > 0 && Number.isFinite(result.min) && Number.isFinite(result.max));
const hasMedian = result => Boolean(result?.count >= 3 && Number.isFinite(result.median));
const hasEnded = result => Boolean(result?.endedOffers?.length);
const hasRecord = result => hasPrice(result) || Boolean(result?.pendingOffers?.length) || Boolean(result?.staleOffers?.length) || hasEnded(result);
function setLoading(loading) {
  state.loading = loading;
  for (const id of ['usedSearch', 'usedType', 'usedBrand', 'usedAvailability', 'usedShowAll', 'usedReset']) refs[id].disabled = loading;
  refs.usedGrid.setAttribute('aria-busy', String(loading));
}
function readLocation() {
  const params = new URLSearchParams(window.location.search);
  state.query = params.get('q') || '';
  state.type = ['바디', '렌즈'].includes(params.get('type')) ? params.get('type') : '';
  state.brand = params.get('brand') || '';
  state.availability = ['active', 'ended'].includes(params.get('status')) ? params.get('status') : '';
  state.all = params.get('all') === '1';
  state.selected = params.get('product') || '';
  state.visible = PAGE_SIZE;
  refs.usedSearch.value = state.query; refs.usedType.value = state.type;
  refs.usedBrand.value = state.brand; refs.usedAvailability.value = state.availability; refs.usedShowAll.checked = state.all;
}
function writeLocation(push = false) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries({ q: state.query, type: state.type, brand: state.brand, status: state.availability, all: state.all ? '1' : '', product: state.selected })) {
    if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
  }
  if (url.href !== window.location.href) window.history[push ? 'pushState' : 'replaceState']({}, '', url);
}
function filterProducts() {
  return state.products.filter(product => (!state.type || product.type === state.type)
    && (!state.brand || publicManufacturer(product.manufacturer) === state.brand)
    && matchesSearch(product, state.query)
    && (!state.availability || (state.availability === 'active' ? hasPrice(summary(product)) : hasEnded(summary(product))))
    && (state.all || hasRecord(summary(product))))
    .sort((a, b) => Number(hasPrice(summary(b))) - Number(hasPrice(summary(a)))
      || (summary(b)?.count || 0) - (summary(a)?.count || 0)
      || productLabel(a).localeCompare(productLabel(b), 'ko'));
}
function select(productId, focus = true) {
  state.selected = productId; writeLocation(true); renderDetail(); renderGrid();
  if (focus && !refs.usedDetail.hidden) {
    refs.usedDetail.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    refs.usedDetail.focus({ preventScroll: true });
  }
}
function productCard(product) {
  const result = summary(product);
  const card = action('', () => select(product.id), `used-card${state.selected === product.id ? ' is-selected' : ''}`);
  card.setAttribute('aria-label', `${productLabel(product)} 중고 판매호가 보기`);
  card.setAttribute('aria-pressed', String(state.selected === product.id));
  card.append(visual(product));
  const body = node('span', 'used-card-content');
  body.append(node('span', 'used-product-meta', `${publicManufacturer(product.manufacturer)} · ${product.type}`), node('span', 'used-card-name', productLabel(product)), node('span', 'used-card-model', [product.modelCode, product.mount].filter(Boolean).join(' · ')));
  const price = node('span', 'used-card-price');
  if (hasPrice(result)) {
    price.append(node('span', 'used-price-caption', hasMedian(result) ? '판매호가 중앙값' : '확인된 판매호가부터'), node('strong', '', money(hasMedian(result) ? result.median : result.min)));
  } else {
    price.append(node('span', 'used-price-caption', '최근 판매호가'), node('strong', 'used-unavailable-price', result?.pendingOffers?.length ? '재고 확인 필요' : hasEnded(result) ? '판매 종료 기록 있음' : result?.staleOffers?.length ? '최근 자료 확인 필요' : '가격 자료 준비 중'));
  }
  const foot = node('span', 'used-card-foot');
  foot.append(node('span', '', hasPrice(result) ? `${result.count}개 판매 중${hasEnded(result) ? ` · ${result.endedOffers.length}개 종료` : ` · ${result.sourceCount}개 판매점`}` : result?.pendingOffers?.length ? `재고 확인 전 자료 ${result.pendingOffers.length}개` : hasEnded(result) ? `판매 완료·품절 기록 ${result.endedOffers.length}개` : '확인 가능한 자료 없음'), node('span', '', '자세히 보기 →'));
  body.append(price, foot); card.append(body); return card;
}
function empty(message, description, expand = false) {
  const item = node('div', 'used-empty');
  item.append(node('strong', '', message), node('p', '', description));
  if (expand) item.append(action('가격 자료 없는 제품도 찾기', () => { state.all = true; refs.usedShowAll.checked = true; state.visible = PAGE_SIZE; writeLocation(); renderGrid(); }));
  return item;
}
function renderGrid() {
  const rows = filterProducts();
  refs.usedCount.textContent = `${rows.length.toLocaleString('ko-KR')}개`;
  refs.usedGrid.replaceChildren(...rows.slice(0, state.visible).map(productCard));
  if (!rows.length && !state.loading) {
    const noCoverage = !state.products.some(product => hasRecord(summary(product)));
    refs.usedGrid.append(empty(noCoverage && !state.all ? '확인된 판매호가 자료를 준비하고 있습니다.' : '조건에 맞는 제품이 없습니다.', state.all ? '제품명이나 브랜드를 바꾸거나 검색 조건을 초기화해 보세요.' : noCoverage ? '확인한 가격 자료가 등록되면 제품별 판매 상품과 확인일을 함께 보여드립니다. 전체 제품을 먼저 둘러볼 수도 있습니다.' : '아직 확인된 판매호가가 없는 제품일 수 있습니다. 전체 제품에서도 찾아보세요.', !state.all));
  }
  refs.usedMore.hidden = rows.length <= state.visible;
  refs.usedGrid.setAttribute('aria-busy', String(state.loading));
}
function stat(label, value, hint, informational = false) {
  const item = node('div', `used-stat${informational ? ' is-info' : ''}`);
  item.append(node('span', '', label), node('strong', '', value));
  if (hint) item.append(node('small', '', hint));
  return item;
}
function offerCard(offer, stale = false) {
  const article = node('article', 'used-offer');
  const body = node('div');
  const shop = node('div', 'used-offer-shop');
  const availability = { 'in-stock': '판매처 판매 중 표기', unknown: '재고 확인 필요', 'sold-out': offer.completionStatus === 'sold' ? '판매 완료 표기' : '판매 종료·품절' };
  shop.append(node('strong', '', offer.sourceName || '판매점'), node('span', `used-stock${offer.availability !== 'in-stock' || stale ? ' is-unknown' : ''}`, stale ? '확인일 경과' : availability[offer.availability] || '재고 확인 필요'));
  const configuration = { 'body-only': '바디 단품', 'lens-only': '렌즈 단품', 'fixed-lens': '일체형 카메라' };
  const details = node('div', 'used-offer-details');
  details.append(node('span', '', `상태: ${offer.condition || '판매점에서 확인'}`), node('span', '', `구성: ${configuration[offer.configuration] || '판매점에서 확인'}`), node('span', '', `확인일 ${offer.checkedAt || '미확인'}`));
  if (offer.availability === 'sold-out' && offer.completionCheckedAt) details.append(node('span', '', `종료 표기 확인 ${offer.completionCheckedAt}`));
  body.append(shop, node('p', 'used-offer-title', offer.title || '판매 상품'), details);
  const links = node('div', 'used-offer-action');
  const privatePrice = offer.availability === 'sold-out' && offer.completionStatus === 'sold' && offer.priceKrw === null;
  links.append(node('strong', privatePrice ? 'used-private-price' : '', privatePrice ? '판매 완료 가격 비공개' : money(offer.priceKrw)));
  const url = externalUrl(offer.sourceUrl);
  if (url) { const link = node('a', '', '판매 상품 보기 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `${offer.sourceName || '판매점'} ${offer.title || '상품'} 새 창에서 보기`); links.append(link); }
  else links.append(node('span', 'used-link-unavailable', '상품 링크 확인 중'));
  article.append(body, links); return article;
}
function renderDetail() {
  refs.usedDetail.replaceChildren();
  const product = state.products.find(item => item.id === state.selected);
  refs.usedDetail.hidden = !state.selected;
  if (!state.selected) return;
  if (!product) {
    refs.usedDetail.append(empty('제품 정보를 찾을 수 없습니다.', '공개 중인 바디·렌즈 제품에서 다시 선택해 주세요.'));
    refs.usedDetail.append(action('제품 목록 보기', () => select('', false)));
    return;
  }
  const result = summary(product);
  const top = node('div', 'used-detail-topline');
  top.append(node('span', '', '선택한 제품 · 중고 판매호가'), action('닫기', () => select('', false), 'used-close'));
  const hero = node('div', 'used-detail-hero');
  const title = node('div');
  title.append(node('p', 'used-product-meta', `${publicManufacturer(product.manufacturer)} · ${product.type}`), node('h2', '', productLabel(product)), node('p', 'used-detail-model', [product.modelCode, product.mount, product.cameraSystem].filter(Boolean).join(' · ')));
  hero.append(visual(product), title); refs.usedDetail.append(top, hero);
  if (hasPrice(result)) {
    const stats = node('div', 'used-summary');
    stats.append(hasMedian(result) ? stat('등록 판매호가 중앙값', money(result.median), `${result.count}개 상품 · ${result.sourceCount}개 판매점 기준`) : stat('등록 판매호가 중앙값', '자료 3개부터 표시', `현재 ${result.count}개 상품 · ${result.sourceCount}개 판매점`, true), stat('확인된 최저 판매호가', money(result.min), '같은 구성 기준'), stat('확인된 최고 판매호가', money(result.max), '상태·보증은 상품별 확인'));
    refs.usedDetail.append(stats, node('p', 'used-detail-note', `최근 확인 ${result.lastCheckedAt || '확인 중'} · 판매 상태와 구성에 따라 가격이 다릅니다. 실거래가나 전체 시장의 평균 가격을 의미하지 않습니다.`), createUsedPriceChart(buildUsedPriceHistory(product.id, state.data)));
    const heading = node('div', 'used-offers-heading');
    heading.append(node('h3', '', `확인한 판매 상품 ${result.count}개`), node('p', '', '판매호가 낮은 순'));
    const offers = node('div', 'used-offer-list');
    offers.append(...[...result.offers].sort((a, b) => a.priceKrw - b.priceKrw).map(offer => offerCard(offer)));
    refs.usedDetail.append(heading, offers);
  } else {
    const notice = node('div', 'used-detail-empty');
    notice.append(node('strong', '', result?.pendingOffers?.length ? '판매 여부를 확인한 뒤 가격을 집계합니다.' : hasEnded(result) ? '현재 판매 중인 상품은 확인되지 않았습니다.' : result?.staleOffers?.length ? '최근 확인한 가격 자료가 없습니다.' : '이 제품의 중고가 자료를 준비하고 있습니다.'), node('span', '', result?.pendingOffers?.length ? '아래 상품의 표시 가격은 확인했지만 현재 재고가 확인되지 않아 최저·최고·중앙값 계산에서 제외했습니다.' : hasEnded(result) ? '아래 종료·품절 상품의 이전 표시가는 최근 판매 중 가격에 합산하지 않습니다.' : result?.staleOffers?.length ? '확인일이 지난 자료는 최근 판매호가 계산에 사용하지 않습니다.' : '확인된 판매 상품이 등록되면 가격과 상품 상태를 함께 보여드립니다.'));
    refs.usedDetail.append(notice, createUsedPriceChart(buildUsedPriceHistory(product.id, state.data)));
  }
  if (result?.pendingOffers?.length) {
    const heading = node('div', 'used-offers-heading');
    heading.append(node('h3', '', `재고 확인이 필요한 상품 ${result.pendingOffers.length}개`), node('p', '', '최근 판매호가 계산에서 제외'));
    const pending = node('div', 'used-offer-list');
    pending.append(...result.pendingOffers.map(offer => offerCard(offer)));
    refs.usedDetail.append(heading, pending);
  }
  if (hasEnded(result)) {
    const heading = node('div', 'used-offers-heading');
    heading.append(node('h3', '', `판매 완료·품절 기록 ${result.endedOffers.length}개`), node('p', '', '판매 중 가격 계산에서 제외'));
    const ended = node('div', 'used-offer-list used-ended-offers');
    ended.append(...result.endedOffers.map(offer => offerCard(offer)));
    refs.usedDetail.append(heading, node('p', 'used-ended-note', '판매처가 판매 완료로 표시한 상품과 품절·판매 종료 상품을 구분해 제공합니다. 표시 가격은 실제 결제 금액이 아니며, 확인일은 실제 거래일과 다릅니다.'), ended);
  }
  if (result?.staleOffers?.length) {
    const stale = node('details', 'used-stale');
    stale.append(node('summary', '', `확인일이 지난 자료 ${result.staleOffers.length}개 보기`), node('p', '', '아래 가격은 이전 확인 시점의 기록이며 최근 판매호가 계산에서 제외했습니다. 현재 판매 여부와 가격은 판매점에서 확인하세요.'));
    const offers = node('div', 'used-offer-list'); offers.append(...result.staleOffers.map(offer => offerCard(offer, true))); stale.append(offers); refs.usedDetail.append(stale);
  }
  if (result?.excludedCount) refs.usedDetail.append(node('p', 'used-detail-note', `구성 불일치·확인 불가 등 기준에 맞지 않는 자료 ${result.excludedCount}개는 가격 계산에서 제외했습니다.`));
}
function updateFilters() {
  if (state.loading || state.error) return;
  state.query = refs.usedSearch.value.trim(); state.type = refs.usedType.value;
  state.brand = refs.usedBrand.value; state.availability = refs.usedAvailability.value; state.all = refs.usedShowAll.checked;
  state.visible = PAGE_SIZE; state.selected = ''; writeLocation(); renderDetail(); renderGrid();
}
async function boot() {
  if (state.loading) return;
  setLoading(true); state.error = false; refs.usedRetry.hidden = true;
  refs.usedStatus.textContent = '제품과 판매호가 자료를 불러오고 있습니다…';
  refs.usedGrid.setAttribute('aria-busy', 'true');
  try {
    const [products, data, order] = await Promise.all([loadProductIndex(), loadUsedPriceData(), loadManufacturerOrder()]);
    state.products = products.filter(product => ['바디', '렌즈'].includes(product.type) && product.active !== false && product.enabled !== false && product.visibility !== 'hidden')
      .map(product => ({ ...product, searchAliases: [...new Set([...(product.searchAliases || []), ...(product.exifAliases || [])])] }));
    state.data = data;
    state.summaries = new Map(state.products.map(product => [product.id, summarizeUsedOffers(product.id, data.offers)]));
    const brandOrder = [...new Set([...PRIORITY_BRANDS, ...order].map(publicManufacturer))];
    const brands = sortManufacturers([...new Set(state.products.map(product => publicManufacturer(product.manufacturer)).filter(Boolean))], brandOrder);
    refs.usedBrand.replaceChildren(node('option', '', '전체 브랜드')); refs.usedBrand.children[0].value = '';
    for (const brand of brands) { const option = node('option', '', brand); option.value = brand; refs.usedBrand.append(option); }
    readLocation();
    if (state.brand && !brands.includes(state.brand)) { state.brand = ''; refs.usedBrand.value = ''; }
    setLoading(false); renderDetail(); renderGrid();
    const covered = state.products.filter(product => hasPrice(summary(product))).length;
    const pending = state.products.filter(product => !hasPrice(summary(product)) && summary(product)?.pendingOffers?.length).length;
    const ended = state.products.filter(product => hasEnded(summary(product))).length;
    refs.usedStatus.textContent = `자료 갱신 ${data.updatedAt || '확인 중'} · 판매 중 ${covered.toLocaleString('ko-KR')}개 제품${ended ? ` · 종료·품절 기록 ${ended.toLocaleString('ko-KR')}개 제품` : ''}${pending ? ` · 재고 확인 필요 ${pending.toLocaleString('ko-KR')}개 제품` : ''} · BETA`;
  } catch (error) {
    setLoading(false); state.error = true;
    refs.usedStatus.textContent = '가격 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    refs.usedRetry.hidden = false; refs.usedMore.hidden = true; refs.usedDetail.hidden = true;
    refs.usedGrid.replaceChildren(empty('자료를 불러오지 못했습니다.', '네트워크 연결을 확인한 뒤 다시 불러오기를 눌러 주세요.'));
    refs.usedCount.textContent = '—';
    console.error('Used price data could not be loaded', error);
  }
}
refs.usedSearch.addEventListener('input', updateFilters);
for (const ref of [refs.usedType, refs.usedBrand, refs.usedAvailability, refs.usedShowAll]) ref.addEventListener('change', updateFilters);
refs.usedReset.addEventListener('click', () => { refs.usedSearch.value = ''; refs.usedType.value = ''; refs.usedBrand.value = ''; refs.usedAvailability.value = ''; refs.usedShowAll.checked = false; updateFilters(); refs.usedSearch.focus(); });
refs.usedMore.addEventListener('click', () => { state.visible += PAGE_SIZE; renderGrid(); });
refs.usedRetry.addEventListener('click', boot);
window.addEventListener('popstate', () => { if (!state.data) return; readLocation(); renderDetail(); renderGrid(); });
void boot();
