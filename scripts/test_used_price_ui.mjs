import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { matchesSearch, sortManufacturers, publicManufacturer, productLabel } from '../public/assets/js/data.js';
import { summarizeUsedOffers, buildUsedPriceHistory } from '../public/assets/js/used-prices.js';
import { createUsedPriceChart } from '../public/assets/js/used/price-chart.js';

const NOW = Date.parse('2026-10-22T12:00:00+09:00');
const source = await fs.readFile(new URL('../public/assets/js/used/app.js', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('../public/betatest/index.html', import.meta.url), 'utf8');
assert.match(html, /name="robots" content="noindex,follow"/);
assert.match(html, /https:\/\/matchcamera\.com\/betatest\//);
assert.doesNotMatch(html, /googlesyndication|unpkg\.com|jsdelivr\.net/);
assert.doesNotMatch(source, /\bfetch\s*\(/, 'The UI reads local data through the shared loader, never a third-party API');

const IDS = ['usedSearch', 'usedType', 'usedBrand', 'usedAvailability', 'usedShowAll', 'usedStatus', 'usedGrid', 'usedCount', 'usedMore', 'usedDetail', 'usedRetry', 'usedReset'];
for (const id of IDS) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
const flush = () => new Promise(resolve => setImmediate(resolve));
function element(tagName = 'div') {
  const listeners = new Map();
  let text = '';
  return {
    tagName, children: [], attributes: {}, className: '', hidden: false, disabled: false, checked: false, value: '', focusCount: 0, scrollCount: 0,
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set textContent(value) { text = String(value); this.children = []; },
    set innerHTML(_value) { throw new Error('Untrusted catalogue and offer text must not be interpreted as HTML'); },
    append(...children) { this.children.push(...children); for (const child of children) child.parent = this; },
    replaceChildren(...children) { text = ''; this.children = []; this.append(...children); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); },
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); },
    addEventListener(type, callback) { listeners.set(type, [...listeners.get(type) || [], callback]); },
    fire(type) { return Promise.all((listeners.get(type) || []).map(callback => callback({target: this}))); },
    focus() { this.focusCount++; }, scrollIntoView() { this.scrollCount++; },
  };
}
const all = item => [item, ...item.children.flatMap(all)];
const classes = (item, name) => all(item).filter(child => child.className.split(' ').includes(name));
const product = (id, manufacturer, officialName, type = '바디', extras = {}) => ({ id, manufacturer, officialName, type, modelCode: `${id}-code`, mount: 'verified mount', ...extras });
const products = [
  product('sony', 'Sony', 'Sony α7 IV', '바디', { exifAliases: ['A7M4-special'], imageSrc: '/assets/images/sony-camera.webp' }),
  product('canon', 'Canon', 'Canon EOS R6 Mark II'),
  product('nikon', 'Nikon', 'Nikon Z 6III'),
  product('fuji', 'Fujifilm', 'Fujifilm X-T5'),
  product('hidden', 'Sony', 'Hidden camera', '바디', { active: false }),
  product('accessory', 'Canon', 'Accessory', '배터리'),
];
const offer = (id, productId, priceKrw, extras = {}) => ({ id, productId, priceKrw, kind: 'used-sale', sourceName: `Shop ${id}`, sourceUrl: `https://shop.example/products/${id}`, title: `Used product ${id}`, condition: '중고 / 구성품 확인', configuration: 'body-only', availability: 'in-stock', checkedAt: '2026-10-22', verified: true, ...extras });
const data = {
  schemaVersion: 1, updatedAt: '2026-10-22', currency: 'KRW', sources: [], methodology: {}, offers: [
    offer('a', 'sony', 1_000_000, {title: '<img src=x onerror=alert(1)>', condition: '<script>unexpected()</script>'}),
    offer('b', 'sony', 1_100_000), offer('c', 'sony', 1_300_000),
    offer('d', 'canon', 900_000, {availability: 'unknown'}),
    offer('e', 'nikon', 800_000, {checkedAt: '2026-10-01'}),
    offer('f', 'hidden', 100_000),
  ],
};
async function app({ href = 'https://matchcamera.com/betatest/', dataset = data, catalogue = products, failures = 0 } = {}) {
  const refs = new Map(IDS.map(id => [id, element()]));
  const window = element('window');
  window.location = new URL(href);
  window.matchMedia = () => ({matches: true});
  const histories = [];
  window.history = Object.fromEntries(['replaceState', 'pushState'].map(method => [method, (_state, _title, url) => { histories.push(method); window.location = new URL(url); }]));
  let loads = 0;
  const errors = [];
  const document = {getElementById: id => refs.get(id), createElement: element, createElementNS: (_namespace, tag) => element(tag)};
  const context = vm.createContext({
    document, window, URL, URLSearchParams, Intl,
    console: {error: (...args) => errors.push(args)},
    loadProductIndex: async () => catalogue,
    loadManufacturerOrder: async () => ['Nikon', 'Sony', 'Fujifilm', 'Canon'],
    loadUsedPriceData: async () => { if (loads++ < failures) throw new Error('Simulated local data unavailable'); return dataset; },
    summarizeUsedOffers: (id, offers) => summarizeUsedOffers(id, offers, {now: NOW}),
    buildUsedPriceHistory: (id, dataset) => buildUsedPriceHistory(id, dataset, {now: NOW}),
    createUsedPriceChart: history => createUsedPriceChart(history, {document}),
    matchesSearch, sortManufacturers, publicManufacturer, productLabel,
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '') + '\nglobalThis.ui = {state, select, filterProducts, externalUrl};', context);
  await flush();
  return { refs, window, histories, errors, ui: context.ui, get: id => refs.get(id), loadCount: () => loads };
}

// Ended-only products are discoverable, but neither sold nor out-of-stock
// records can alter the active summary. Only explicit evidence earns 'sold'.
{
  const page = await app({dataset: {...data, offers: [...data.offers,
    offer('ended-sony', 'sony', 100_000, {availability: 'sold-out'}),
    offer('sold-fuji', 'fuji', 200_000, {availability: 'sold-out', completionStatus: 'sold', completionEvidence: '판매처 판매완료 표기'}),
  ]}});
  assert.equal(page.get('usedCount').textContent, '4개');
  page.get('usedAvailability').value = 'active'; await page.get('usedAvailability').fire('change');
  assert.equal(page.get('usedCount').textContent, '1개');
  assert.equal(page.window.location.search, '?status=active');
  page.get('usedAvailability').value = 'ended'; await page.get('usedAvailability').fire('change');
  assert.equal(page.get('usedCount').textContent, '2개');
  assert.match(page.get('usedGrid').textContent, /Fujifilm X-T5/);
  page.ui.select('fuji');
  assert.match(page.get('usedDetail').textContent, /판매 완료 표기/);
  assert.match(page.get('usedDetail').textContent, /실제 결제 금액이 아니며/);
  assert.equal(classes(page.get('usedDetail'), 'used-summary').length, 0);
  page.ui.select('sony');
  assert.match(page.get('usedDetail').textContent, /판매 종료·품절/);
  assert.match(classes(page.get('usedDetail'), 'used-summary')[0].textContent, /1,100,000원/);
  assert.doesNotMatch(classes(page.get('usedDetail'), 'used-summary')[0].textContent, /100,000원같은/);
  assert.match(page.get('usedDetail').textContent, /관측 기록 1일/);
  await page.get('usedReset').fire('click');
  assert.equal(page.get('usedAvailability').value, '');
  assert.equal(page.window.location.search, '');
}

// Real observation dates are the only x coordinates. A one-day snapshot has no
// invented trend, and a missing calendar day breaks otherwise valid medians.
{
  const document = {createElement: element, createElementNS: (_namespace, tag) => element(tag)};
  const one = createUsedPriceChart({points: [{date: '2026-10-22', active: {count: 1, min: 1_000_000, max: 1_000_000, median: null}, ended: {count: 0}}]}, {document});
  assert.match(one.textContent, /관측 기록 1일/);
  assert.equal(classes(one, 'used-chart-connection').length, 0);
  assert.equal(classes(one, 'used-chart-median').length, 0);
  assert.equal(all(one).filter(item => item.tagName === 'svg').length, 1);
  assert.equal(classes(one, 'used-chart-point')[0].attributes.tabindex, '0');
  assert.match(one.textContent, /2026-10-22/);
  const active = (min, max, median) => ({count: 3, min, max, median});
  const many = createUsedPriceChart({points: [
    {date: '2026-10-22', active: active(800_000, 1_000_000, 900_000)},
    {date: '2026-10-19', active: active(1_000_000, 1_200_000, 1_100_000), ended: {count: 1, min: 750_000, max: 750_000}},
    {date: '2026-10-20', active: active(900_000, 1_100_000, 1_000_000)},
    {date: '2026-99-99', active: active(1, 3, 2)},
  ]}, {document});
  assert.equal(classes(many, 'used-chart-connection').length, 1, 'Only Oct19 to20 is connected; Oct21 stays missing');
  assert.equal(classes(many, 'used-chart-median').length, 3);
  assert.equal(classes(many, 'used-chart-point').filter(item => item.className.includes('is-ended')).length, 1);
  assert.doesNotMatch(many.textContent, /2026-10-21|2026-99-99/);
  assert.match(many.textContent, /실제 결제 금액이나 판매 완료 시각을 뜻하지/);
  const empty = createUsedPriceChart({points: []}, {document});
  assert.equal(all(empty).filter(item => item.tagName === 'svg').length, 0);
  assert.match(empty.textContent, /아직 확인한 가격 이력이 없습니다/);
}

// A hidden asking price excludes the listing, even with explicit completion.
{
  const page = await app({dataset: {...data, offers: [offer('private', 'fuji', null, {
    availability: 'sold-out', completionStatus: 'sold', completionEvidence: '판매처 판매완료 표기', completionCheckedAt: '2026-10-22',
  })]}});
  assert.equal(page.get('usedCount').textContent, '0개');
  page.get('usedAvailability').value = 'ended'; await page.get('usedAvailability').fire('change');
  assert.equal(page.get('usedCount').textContent, '0개');
  page.ui.select('fuji');
  assert.doesNotMatch(page.get('usedDetail').textContent, /판매 완료 가격 비공개|판매 완료 표기|Shop private|Used product private/);
  assert.equal(classes(page.get('usedDetail'), 'used-offer').length, 0);
  assert.equal(classes(page.get('usedDetail'), 'used-summary').length, 0);
  assert.equal(classes(page.get('usedDetail'), 'used-chart-point').length, 0);
  assert.doesNotMatch(page.get('usedDetail').textContent, /NaN|0원/);
}

// Fresh stock quotes enter statistics. Unknown stock is discoverable separately,
// and hidden or non-camera products do not leak into the beta catalogue.
{
  const page = await app();
  assert.equal(page.get('usedGrid').attributes['aria-busy'], 'false');
  assert.equal(page.get('usedSearch').disabled, false);
  assert.equal(page.get('usedCount').textContent, '3개');
  assert.deepEqual(Array.from(page.get('usedBrand').children, item => item.value), ['', 'Sony', 'Canon', 'Nikon', 'Fujifilm']);
  assert.match(page.get('usedGrid').textContent, /1,100,000원/);
  assert.match(page.get('usedGrid').textContent, /재고 확인 필요/);
  assert.doesNotMatch(page.get('usedGrid').textContent, /900,000원|Hidden camera|Accessory|800,000원/);
  page.ui.select('sony');
  assert.equal(page.window.location.search, '?product=sony');
  assert.equal(page.get('usedDetail').focusCount, 1);
  assert.match(page.get('usedDetail').textContent, /1,100,000원/);
  assert.match(page.get('usedDetail').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(page.get('usedDetail').textContent, /<script>unexpected\(\)<\/script>/);
  assert.equal(all(page.get('usedDetail')).filter(item => item.tagName === 'script').length, 0);
  for (const link of all(page.get('usedDetail')).filter(item => item.tagName === 'a')) {
    assert.match(link.href, /^https:\/\//); assert.equal(link.rel, 'noopener noreferrer');
  }
  page.ui.select('canon');
  assert.match(page.get('usedDetail').textContent, /재고 확인이 필요한 상품 1개/);
  assert.match(page.get('usedDetail').textContent, /900,000원/);
  assert.match(page.get('usedDetail').textContent, /최저·최고·중앙값 계산에서 제외/);
  assert.equal(classes(page.get('usedDetail'), 'used-summary').length, 0);
  assert.equal(page.ui.externalUrl('javascript:alert(1)'), '');
  assert.equal(page.ui.externalUrl('https://user:pass@shop.example/'), '');
}

// Korean brands and EXIF aliases search through the same catalogue matcher.
// Filter state travels in the URL and browser back restores the selected model.
{
  const page = await app();
  page.get('usedSearch').value = '소니'; await page.get('usedSearch').fire('input');
  assert.equal(page.get('usedCount').textContent, '1개');
  page.get('usedSearch').value = 'A7M4-special'; await page.get('usedSearch').fire('input');
  assert.equal(page.get('usedCount').textContent, '1개');
  assert.equal(page.window.location.search, '?q=A7M4-special');
  await page.get('usedReset').fire('click');
  assert.equal(page.window.location.search, '');
  assert.equal(page.get('usedCount').textContent, '3개');
  page.window.location = new URL('https://matchcamera.com/betatest/?product=canon');
  await page.window.fire('popstate');
  assert.match(page.get('usedDetail').textContent, /Canon EOS R6 Mark II/);
}

// Small samples stay literal rather than acquiring a misleading market average.
{
  const page = await app({dataset: {...data, offers: [offer('small', 'sony', 1_250_000)]}, href: 'https://matchcamera.com/betatest/?product=sony'});
  assert.match(page.get('usedDetail').textContent, /자료 3개부터 표시/);
  assert.match(page.get('usedGrid').textContent, /확인된 판매호가부터/);
  assert.equal(all(page.get('usedDetail')).some(item => item.textContent === '0원'), false);
}

// Empty, old and missing models remain useful states and never fabricate a zero.
{
  const page = await app({dataset: {...data, offers: []}});
  assert.match(page.get('usedGrid').textContent, /판매호가 자료를 준비/);
  page.get('usedShowAll').checked = true; await page.get('usedShowAll').fire('change');
  assert.equal(page.get('usedCount').textContent, '4개');
  page.ui.select('fuji');
  assert.match(page.get('usedDetail').textContent, /중고가 자료를 준비/);
  assert.equal(all(page.get('usedDetail')).some(item => item.textContent === '0원'), false);
  page.ui.select('hidden'); assert.match(page.get('usedDetail').textContent, /제품 정보를 찾을 수 없습니다/);
  const old = await app({href: 'https://matchcamera.com/betatest/?product=nikon'});
  assert.match(old.get('usedGrid').textContent, /Nikon Z 6III/);
  old.get('usedSearch').value = '니콘'; await old.get('usedSearch').fire('input');
  assert.equal(old.get('usedCount').textContent, '1개');
  old.ui.select('nikon');
  assert.match(old.get('usedDetail').textContent, /확인일이 지난 자료 1개/);
  assert.match(old.get('usedDetail').textContent, /이전 확인 시점의 기록/);
  assert.equal(classes(old.get('usedDetail'), 'used-summary').length, 0);
}

// A failed local fetch has an explicit recovery path instead of an empty market.
{
  const page = await app({failures: 1});
  assert.equal(page.get('usedRetry').hidden, false);
  assert.match(page.get('usedGrid').textContent, /자료를 불러오지 못했습니다/);
  page.get('usedSearch').value = '소니'; await page.get('usedSearch').fire('input');
  assert.match(page.get('usedGrid').textContent, /자료를 불러오지 못했습니다/);
  await page.get('usedRetry').fire('click'); await flush();
  assert.equal(page.get('usedRetry').hidden, true);
  assert.equal(page.get('usedCount').textContent, '3개');
  assert.equal(page.loadCount(), 2);
}

console.log('Used price UI passed: safe catalogue/offers, active/pending/ended/stale isolation, status search, real-date chart gaps/single-day and fetch recovery.');
