import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { summarizeUsedOffers, validateUsedPriceData, usedOfferUrl } from '../public/assets/js/used-prices.js';

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
assert.equal(mixed.excludedCount, 2);
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
