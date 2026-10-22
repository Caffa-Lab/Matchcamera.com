import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeUsedOffers, validateUsedPriceData, usedOfferUrl, buildUsedPriceHistory } from '../public/assets/js/used-prices.js';

const NOW = Date.parse('2026-10-22T09:00:00+09:00');
const offer = (id, priceKrw, overrides = {}) => ({
  id, productId: 'body-a', kind: 'used-sale', priceKrw,
  sourceName: '테스트 판매점', sourceUrl: `https://shop.example/item/${id}`,
  title: '카메라 A 중고 바디', condition: '중고 · 상태 판매점 확인',
  configuration: 'body-only', availability: 'in-stock', checkedAt: '2026-10-22', verified: true,
  ...overrides,
});
const summarize = items => summarizeUsedOffers('body-a', items, { now: NOW });

// Unknowns, stale quotes and ended listings cannot silently become today's market price.
assert.deepEqual([summarize([]).min, summarize([]).median, summarize([]).max], [null, null, null]);
const mixed = summarize([
  offer('a', 1_000_000), offer('b', 1_500_000), offer('c', 2_000_000),
  offer('sold', 20_000, { availability: 'sold-out' }),
  offer('pending', 50_000, { availability: 'unknown' }),
  offer('stale', 100_000, { checkedAt: '2026-10-14' }),
  offer('future', 5_000, { checkedAt: '2026-10-23' }),
  offer('other', 300_000, { productId: 'body-b' }),
]);
assert.equal(mixed.status, 'ready');
assert.equal(mixed.count, 3);
assert.equal(mixed.min, 1_000_000);
assert.equal(mixed.median, 1_500_000);
assert.equal(mixed.max, 2_000_000);
assert.equal(mixed.pendingOffers.length, 1);
assert.equal(mixed.staleOffers.length, 1);
assert.equal(mixed.excludedCount, 1);
assert.equal(mixed.endedCount, 1);
assert.equal(mixed.endedOffers[0].completionStatus, 'out-of-stock', 'Stockout does not establish a completed sale');
assert.equal(mixed.endedOffers[0].completionCheckedAt, '2026-10-22');
assert.equal(mixed.hasRecords, true);
const endedOnly = summarize([offer('ended', 400_000, { availability: 'sold-out' })]);
assert.equal(endedOnly.count, 0);
assert.equal(endedOnly.min, null);
assert.equal(endedOnly.endedCount, 1);
assert.equal(endedOnly.recordedCount, 1);
assert.equal(summarize([offer('ended', 400_000, { availability: 'sold-out', completionStatus: 'sold' })]).endedCount, 0, 'Explicit sale labels need source evidence');
assert.equal(summarize([offer('ended', 400_000, { availability: 'sold-out', completionStatus: 'sold', completionEvidence: '판매완료' })]).endedOffers[0].completionStatus, 'sold');
assert.equal(mixed.sourceCount, 1);
assert.equal(summarize([offer('a', 100)]).median, null);
assert.equal(summarize([offer('a', 100), offer('b', 200)]).median, null);
assert.equal(summarize([offer('a', 100), offer('b', 200), offer('c', 300), offer('d', 600)]).median, 250);
assert.equal(summarize([offer('a', 100, { checkedAt: '2026-10-15' })]).count, 1);
assert.equal(summarize([offer('a', 100, { checkedAt: '2026-10-14' })]).status, 'stale');
assert.equal(summarizeUsedOffers('body-a', [offer('a', 100)], { now: Date.parse('2026-10-21T15:01:00Z') }).count, 1, 'Korean day already rolled over');

for (const overrides of [
  { priceKrw: 0 }, { priceKrw: '100' }, { priceKrw: -1 }, { priceKrw: 1.5 },
  { priceKrw: Infinity }, { priceKrw: Number.MAX_SAFE_INTEGER + 1 },
  { verified: false }, { kind: 'new-sale' }, { kind: 'buyback' },
  { sourceUrl: 'javascript:alert(1)' }, { sourceUrl: 'https://name:password@shop.example/item/a' },
  { checkedAt: '2026-02-30' }, { configuration: 'body-and-lens-kit' },
]) assert.equal(summarize([offer('bad', 100, overrides)]).count, 0, JSON.stringify(overrides));

// A tracked URL or repeated record is still one physical listing, not extra evidence.
const duplicate = summarize([offer('a', 100), offer('b', 100, { sourceUrl: 'https://shop.example/item/a?utm_source=other#details' })]);
assert.equal(duplicate.count, 1);
assert.equal(duplicate.median, null);
assert.equal(duplicate.excludedCount, 1);
assert.equal(usedOfferUrl('https://shop.example/item/a?utm_source=other#details'), 'https://shop.example/item/a');

const dataset = { schemaVersion: 1, currency: 'KRW', updatedAt: '2026-10-22',
  sources: [{ name: '테스트 판매점', url: 'https://shop.example/' }], offers: [offer('a', 100)], methodology: {} };
const products = [{ id: 'body-a', type: '바디', cameraSystem: '미러리스' }];
assert.equal(validateUsedPriceData(dataset, { now: NOW, products }).offers.length, 1);
for (const flags of [{ active: false }, { enabled: false }, { visibility: 'hidden' }]) {
  assert.throws(() => validateUsedPriceData(dataset, { now: NOW, products: [{ ...products[0], ...flags }] }), /공개 제품/);
}
assert.throws(() => validateUsedPriceData({ ...dataset, offers: [offer('a', 100, { productId: 'other-mount' })] }, { now: NOW, products }), /공개 제품/);
assert.throws(() => validateUsedPriceData({ ...dataset, offers: [offer('a', 100, { configuration: 'lens-only' })] }, { now: NOW, products }), /구성/);
assert.throws(() => validateUsedPriceData({ ...dataset, offers: [offer('a', 100), offer('a', 200)] }, { now: NOW }), /중복/);
assert.throws(() => validateUsedPriceData({ ...dataset, offers: [offer('a', 100, { sourceUrl: 'https://other.example/item/a' })] }, { now: NOW }), /출처/);
assert.throws(() => validateUsedPriceData({ ...dataset, updatedAt: '2026-10-23' }, { now: NOW }), /확인일/);
assert.throws(() => validateUsedPriceData({ ...dataset, updatedAt: '2026-10-21' }, { now: NOW }), /확인일/);

// Historical points use actual observed days and the price recorded on that
// day, never today's quote placed backwards on invented dates.
const privateSold = { ...offer('private-sold', 100), priceKrw: null, availability: 'sold-out', completionStatus: 'sold', completionEvidence: '상품 상세에 판매완료 표기' };
const privateData = validateUsedPriceData({ ...dataset, offers: [privateSold] }, { now: NOW, products });
assert.equal(privateData.offers[0].priceKrw, null);
assert.deepEqual(privateData.observations, [], 'A hidden completion price must not create a graph observation');
const privateSummary = summarizeUsedOffers('body-a', privateData.offers, { now: NOW });
assert.equal(privateSummary.endedCount, 1);
assert.equal(privateSummary.min, null);
assert.equal(privateSummary.count, 0);
assert.throws(() => validateUsedPriceData({ ...dataset, offers: [offer('a', 123, { checkedAt: '2026-10-20' })], observations: [{ offerId: 'a', productId: 'body-a', sourceUrl: 'https://shop.example/item/a', priceKrw: 123, availability: 'in-stock', observedOn: '2026-10-21' }] }, { now: NOW }), /관측 이력/);
assert.deepEqual(buildUsedPriceHistory('body-a', privateData, { now: NOW }).points, []);
for (const invalid of [{ ...privateSold, completionEvidence: '' }, { ...privateSold, completionStatus: 'out-of-stock' }, { ...privateSold, availability: 'in-stock' }]) {
  assert.throws(() => validateUsedPriceData({ ...dataset, offers: [invalid] }, { now: NOW }), /상품 기록/);
}
const observation = (id, priceKrw, observedOn, availability = 'in-stock') => ({ offerId: id, productId: 'body-a',
  sourceUrl: `https://shop.example/item/${id}`, priceKrw, availability, observedOn });
const historyData = { ...dataset, offers: [offer('a', 999), offer('b', 999), offer('c', 999), offer('d', 999)], observations: [
  observation('a', 100, '2026-10-20'), observation('b', 200, '2026-10-20'), observation('c', 600, '2026-10-20'),
  observation('d', 10, '2026-10-20', 'sold-out'),
  observation('a', 120, '2026-10-22'), observation('b', 300, '2026-10-22', 'sold-out'),
  observation('c', 1, '2026-10-22', 'unknown'),
] };
const history = buildUsedPriceHistory('body-a', validateUsedPriceData(historyData, { now: NOW }), { now: NOW });
assert.deepEqual(history.points.map(point => point.date), ['2026-10-20', '2026-10-22']);
assert.equal(history.hasTrend, true);
assert.equal(history.dayCount, 2);
assert.equal(history.observationCount, 6);
assert.deepEqual(history.points[0].active, { count: 3, min: 100, max: 600, median: 200 });
assert.deepEqual(history.points[0].ended, { count: 1, min: 10, max: 10, median: null });
assert.equal(history.points[1].active.min, 120, 'Use recorded historical price rather than current 999');
assert.equal(history.points[1].active.median, null);
assert.equal(history.points[1].ended.min, 300);
assert.deepEqual(buildUsedPriceHistory('other-model', historyData, { now: NOW }).points, []);
assert.deepEqual(buildUsedPriceHistory('body-a', historyData, { now: NOW, days: 1 }).points.map(point => point.date), ['2026-10-22']);
assert.equal(buildUsedPriceHistory('body-a', dataset, { now: NOW }).hasTrend, false);
assert.equal(buildUsedPriceHistory('body-a', dataset, { now: NOW }).points.length, 1, 'Legacy snapshot only seeds its real check date');
const duplicateDay = { ...historyData, observations: [historyData.observations[0], historyData.observations[0]] };
assert.throws(() => validateUsedPriceData(duplicateDay, { now: NOW }), /중복/);
assert.equal(buildUsedPriceHistory('body-a', duplicateDay, { now: NOW }).points[0].active.count, 1);
for (const bad of [observation('a', 123, '2026-10-23'),
  { ...observation('a', 123, '2026-10-22'), sourceUrl: 'https://other.example/item/a' },
  { ...observation('a', 123, '2026-10-22'), productId: 'other-model' },
  observation('missing-offer', 123, '2026-10-22'), observation('a', 0, '2026-10-22')]) {
  assert.throws(() => validateUsedPriceData({ ...dataset, observations: [bad] }, { now: NOW }), /관측 이력/);
  assert.deepEqual(buildUsedPriceHistory('body-a', { ...dataset, observations: [bad] }, { now: NOW }).points, []);
}

// Exercise failure recovery through the actual local-data loader. No upstream API is contacted.
const originalFetch = globalThis.fetch;
let requests = 0;
try {
  const loader = await import(`../public/assets/js/used-prices.js?loader-test=${Date.now()}`);
  globalThis.fetch = async url => {
    assert.match(String(url), /^\/data\/used-prices\.json\?/);
    requests++;
    if (requests === 1) return { ok: false };
    return { ok: true, json: async () => ({ ...dataset, updatedAt: '2020-01-01', offers: [] }) };
  };
  await assert.rejects(loader.loadUsedPriceData(), /불러오지 못했습니다/);
  await Promise.all([loader.loadUsedPriceData(), loader.loadUsedPriceData()]);
  assert.equal(requests, 2, 'Retry succeeds and simultaneous callers share the one local fetch');
} finally { globalThis.fetch = originalFetch; }

// Check the published dataset against actual visible product IDs and exact configurations.
const catalog = JSON.parse(await readFile(new URL('../public/data/product-index.json', import.meta.url), 'utf8'));
const published = JSON.parse(await readFile(new URL('../public/data/used-prices.json', import.meta.url), 'utf8'));
const clean = validateUsedPriceData(published, { products: catalog });
assert(clean.offers.length > 0, 'Beta must contain sourced price observations');
assert(clean.offers.every(item => !/(^|\.)camprice\.kr$/.test(new URL(item.sourceUrl).hostname)), 'Do not republish CamPrice statistics');
console.log(`Used prices passed: real catalog mapping, asking-price semantics, sparse samples, status/freshness, deduplication, safe sources and loader retry (${clean.offers.length} published quotes).`);
