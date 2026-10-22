export const USED_PRICE_MAX_AGE_DAYS = 7;
export const USED_PRICE_MIN_SAMPLES = 3;
const DAY = 86_400_000;
const CONFIGURATIONS = new Set(['body-only', 'lens-only', 'fixed-lens']);
const AVAILABILITIES = new Set(['in-stock', 'unknown', 'sold-out']);

const cleanText = (value, max = 300) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function dateNumber(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
function todayNumber(now) {
  const time = Number(now);
  if (!Number.isFinite(time)) throw new Error('가격 확인 기준일을 읽을 수 없습니다.');
  // Confirmations and freshness use calendar dates in Korea, including at UTC midnight.
  return dateNumber(new Date(time + 9 * 3_600_000).toISOString().slice(0, 10));
}
export function usedOfferUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}
function normalizeOffer(raw) {
  if (!raw || typeof raw !== 'object' || raw.verified !== true || raw.kind !== 'used-sale') return null;
  const id = cleanText(raw.id, 180), productId = cleanText(raw.productId, 180);
  const sourceName = cleanText(raw.sourceName, 80), sourceUrl = usedOfferUrl(raw.sourceUrl);
  const title = cleanText(raw.title), condition = cleanText(raw.condition, 160);
  if (!id || !productId || !sourceName || !sourceUrl || !title || !condition) return null;
  if (!CONFIGURATIONS.has(raw.configuration) || !AVAILABILITIES.has(raw.availability) || dateNumber(raw.checkedAt) === null) return null;
  let completion;
  if (raw.availability === 'sold-out') {
    const completionStatus = raw.completionStatus || 'out-of-stock';
    const completionCheckedAt = raw.completionCheckedAt || raw.checkedAt;
    const completionEvidence = cleanText(raw.completionEvidence, 160);
    if (!['sold', 'out-of-stock'].includes(completionStatus) || dateNumber(completionCheckedAt) === null || completionCheckedAt > raw.checkedAt) return null;
    if (completionStatus === 'sold' && !completionEvidence) return null;
    completion = { completionStatus, completionCheckedAt, ...(completionEvidence ? { completionEvidence } : {}) };
  }
  // Only listings with a public numeric asking price belong in this beta,
  // including ended listings. A completion label cannot replace a price.
  if (!Number.isSafeInteger(raw.priceKrw) || raw.priceKrw <= 0) return null;
  return { id, productId, kind: 'used-sale', priceKrw: raw.priceKrw, sourceName, sourceUrl, title, condition,
    configuration: raw.configuration, availability: raw.availability, checkedAt: raw.checkedAt, verified: true, ...completion };
}

export function summarizeUsedOffers(productId, offers = [], { now = Date.now() } = {}) {
  const today = todayNumber(now);
  const groups = { offers: [], staleOffers: [], pendingOffers: [], endedOffers: [] };
  let excludedCount = 0;
  const ids = new Set(), urls = new Set();
  for (const raw of Array.isArray(offers) ? offers : []) {
    if (raw?.productId !== productId) continue;
    const offer = normalizeOffer(raw);
    if (!offer || ids.has(offer.id) || urls.has(offer.sourceUrl)) { excludedCount++; continue; }
    const age = (today - dateNumber(offer.checkedAt)) / DAY;
    if (age < 0) { excludedCount++; continue; }
    ids.add(offer.id); urls.add(offer.sourceUrl);
    if (offer.availability === 'sold-out') groups.endedOffers.push(offer);
    else if (age > USED_PRICE_MAX_AGE_DAYS) groups.staleOffers.push(offer);
    else if (offer.availability === 'unknown') groups.pendingOffers.push(offer);
    else groups.offers.push(offer);
  }
  for (const items of Object.values(groups)) items.sort((a, b) => a.priceKrw - b.priceKrw || a.id.localeCompare(b.id));
  const active = groups.offers, count = active.length;
  const sources = new Set(active.map(offer => new URL(offer.sourceUrl).hostname.replace(/^www\./, '')));
  const middle = Math.floor(count / 2);
  const median = count < USED_PRICE_MIN_SAMPLES ? null : count % 2 ? active[middle].priceKrw : Math.round((active[middle - 1].priceKrw + active[middle].priceKrw) / 2);
  return { status: count >= USED_PRICE_MIN_SAMPLES ? 'ready' : count ? 'limited' : groups.staleOffers.length ? 'stale' : 'unavailable',
    median, min: count ? active[0].priceKrw : null, max: count ? active.at(-1).priceKrw : null,
    count, sourceCount: sources.size, lastCheckedAt: active.map(offer => offer.checkedAt).sort().at(-1) || '',
    ...groups, endedCount: groups.endedOffers.length,
    recordedCount: Object.values(groups).reduce((sum, items) => sum + items.length, 0),
    hasRecords: Object.values(groups).some(items => items.length > 0), excludedCount };
}

function observationFor(offer) {
  return { offerId: offer.id, productId: offer.productId, sourceUrl: offer.sourceUrl, priceKrw: offer.priceKrw,
    availability: offer.availability, observedOn: offer.checkedAt,
    ...(offer.completionStatus ? { completionStatus: offer.completionStatus } : {}) };
}
function normalizeObservation(raw, offer) {
  if (!raw || !offer || raw.offerId !== offer.id || raw.productId !== offer.productId || usedOfferUrl(raw.sourceUrl) !== offer.sourceUrl) return null;
  if (dateNumber(raw.observedOn) === null || !Number.isSafeInteger(raw.priceKrw) || raw.priceKrw <= 0 || !AVAILABILITIES.has(raw.availability)) return null;
  const result = { offerId: offer.id, productId: offer.productId, sourceUrl: offer.sourceUrl,
    priceKrw: raw.priceKrw, availability: raw.availability, observedOn: raw.observedOn };
  if (raw.availability === 'sold-out') {
    if (raw.completionStatus && !['sold', 'out-of-stock'].includes(raw.completionStatus)) return null;
    result.completionStatus = raw.completionStatus || 'out-of-stock';
  }
  return result;
}
function rangeSummary(values) {
  values.sort((a, b) => a - b);
  const count = values.length, middle = Math.floor(count / 2);
  return { count, min: count ? values[0] : null, max: count ? values.at(-1) : null,
    median: count < USED_PRICE_MIN_SAMPLES ? null : count % 2 ? values[middle] : Math.round((values[middle - 1] + values[middle]) / 2) };
}

// Dates refer to actual page observations, never registration dates or an
// invented sale date. Missing dates stay missing and ended prices stay separate.
export function buildUsedPriceHistory(productId, data, { now = Date.now(), days = 90 } = {}) {
  const today = todayNumber(now);
  const windowDays = Number.isInteger(days) && days > 0 ? Math.min(days, 366) : 90;
  const first = today - (windowDays - 1) * DAY;
  const offers = new Map((Array.isArray(data?.offers) ? data.offers : []).map(raw => normalizeOffer(raw)).filter(Boolean).map(offer => [offer.id, offer]));
  const records = Array.isArray(data?.observations) ? data.observations : [...offers.values()].map(observationFor);
  const unique = new Map();
  for (const raw of records) {
    const record = normalizeObservation(raw, offers.get(raw?.offerId));
    if (!record || record.productId !== productId) continue;
    const date = dateNumber(record.observedOn);
    if (date < first || date > today || record.availability === 'unknown') continue;
    unique.set(`${record.observedOn}|${record.sourceUrl}`, record);
  }
  const byDate = new Map();
  for (const record of unique.values()) {
    if (!byDate.has(record.observedOn)) byDate.set(record.observedOn, { active: [], ended: [] });
    byDate.get(record.observedOn)[record.availability === 'sold-out' ? 'ended' : 'active'].push(record.priceKrw);
  }
  const points = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, buckets]) => ({ date,
    active: rangeSummary(buckets.active), ended: rangeSummary(buckets.ended) }));
  return { points, observationCount: unique.size, dayCount: points.length, hasTrend: points.length > 1 };
}

export function validateUsedPriceData(raw, { now = Date.now(), products } = {}) {
  const today = todayNumber(now);
  if (raw?.schemaVersion !== 1 || raw.currency !== 'KRW' || !Array.isArray(raw.offers) || !Array.isArray(raw.sources)) throw new Error('중고가 자료 형식을 확인하지 못했습니다.');
  const updated = dateNumber(raw.updatedAt);
  if (updated === null || updated > today) throw new Error('중고가 자료 확인일이 올바르지 않습니다.');
  const sourceNames = new Map();
  const sources = raw.sources.map(source => {
    const name = cleanText(source?.name, 80), url = usedOfferUrl(source?.url);
    if (!name || !url || sourceNames.has(name)) throw new Error('중고가 출처 정보를 확인하지 못했습니다.');
    sourceNames.set(name, new URL(url).hostname.replace(/^www\./, ''));
    return { name, url };
  });
  const ids = new Set(), urls = new Set();
  const catalog = Array.isArray(products) ? new Map(products.map(product => [product.id, product])) : null;
  const offers = raw.offers.map(rawOffer => {
    const offer = normalizeOffer(rawOffer);
    if (!offer || ids.has(offer.id) || urls.has(offer.sourceUrl)) throw new Error('중고가 상품 기록이 올바르지 않거나 중복되었습니다.');
    const host = new URL(offer.sourceUrl).hostname.replace(/^www\./, '');
    if (sourceNames.get(offer.sourceName) !== host) throw new Error('상품 링크와 가격 출처가 일치하지 않습니다.');
    if (dateNumber(offer.checkedAt) > today || dateNumber(offer.checkedAt) > updated) throw new Error('상품 가격 확인일이 올바르지 않습니다.');
    if (catalog) {
      const product = catalog.get(offer.productId);
      if (!product || !['바디', '렌즈'].includes(product.type) || product.active === false || product.enabled === false || product.visibility === 'hidden') throw new Error('중고가 상품에 연결된 공개 제품을 확인하지 못했습니다.');
      const expected = product.type === '렌즈' ? 'lens-only' : /^일체형/.test(product.cameraSystem || '') || product.fixedLens === true ? 'fixed-lens' : 'body-only';
      if (offer.configuration !== expected) throw new Error('중고가 상품의 제품 구성이 일치하지 않습니다.');
    }
    ids.add(offer.id); urls.add(offer.sourceUrl);
    return offer;
  });
  if (raw.observations !== undefined && !Array.isArray(raw.observations)) throw new Error('가격 관측 이력 형식이 올바르지 않습니다.');
  const byId = new Map(offers.map(offer => [offer.id, offer]));
  const observed = new Set();
  const observations = (raw.observations || offers.map(observationFor)).map(item => {
    const record = normalizeObservation(item, byId.get(item?.offerId));
    if (!record || dateNumber(record.observedOn) > updated || dateNumber(record.observedOn) > today || record.observedOn > byId.get(record.offerId).checkedAt) throw new Error('가격 관측 이력의 출처 또는 확인일이 올바르지 않습니다.');
    const key = `${record.observedOn}|${record.sourceUrl}`;
    if (observed.has(key)) throw new Error('같은 날의 상품 관측 이력이 중복되었습니다.');
    observed.add(key);
    return record;
  });
  return { schemaVersion: 1, updatedAt: raw.updatedAt, currency: 'KRW', offers, sources, observations,
    methodology: raw.methodology && typeof raw.methodology === 'object' ? raw.methodology : {} };
}

let cached;
export async function loadUsedPriceData() {
  if (!cached) {
    cached = (async () => {
      const response = await fetch('/data/used-prices.json?v=20261022-public-prices', { cache: 'no-cache' });
      if (!response.ok) throw new Error('중고가 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return validateUsedPriceData(await response.json());
    })().catch(error => { cached = null; throw error; });
  }
  return cached;
}
