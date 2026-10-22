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
  if (!Number.isSafeInteger(raw.priceKrw) || raw.priceKrw <= 0) return null;
  if (!CONFIGURATIONS.has(raw.configuration) || !AVAILABILITIES.has(raw.availability) || dateNumber(raw.checkedAt) === null) return null;
  return { id, productId, kind: 'used-sale', priceKrw: raw.priceKrw, sourceName, sourceUrl, title, condition,
    configuration: raw.configuration, availability: raw.availability, checkedAt: raw.checkedAt, verified: true };
}

export function summarizeUsedOffers(productId, offers = [], { now = Date.now() } = {}) {
  const today = todayNumber(now);
  const groups = { offers: [], staleOffers: [], pendingOffers: [] };
  let excludedCount = 0;
  const ids = new Set(), urls = new Set();
  for (const raw of Array.isArray(offers) ? offers : []) {
    if (raw?.productId !== productId) continue;
    const offer = normalizeOffer(raw);
    if (!offer || ids.has(offer.id) || urls.has(offer.sourceUrl)) { excludedCount++; continue; }
    const age = (today - dateNumber(offer.checkedAt)) / DAY;
    if (age < 0 || offer.availability === 'sold-out') { excludedCount++; continue; }
    ids.add(offer.id); urls.add(offer.sourceUrl);
    if (age > USED_PRICE_MAX_AGE_DAYS) groups.staleOffers.push(offer);
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
    ...groups, excludedCount };
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
  return { schemaVersion: 1, updatedAt: raw.updatedAt, currency: 'KRW', offers, sources,
    methodology: raw.methodology && typeof raw.methodology === 'object' ? raw.methodology : {} };
}

let cached;
export async function loadUsedPriceData() {
  if (!cached) {
    cached = (async () => {
      const response = await fetch('/data/used-prices.json?v=20261022-beta', { cache: 'no-cache' });
      if (!response.ok) throw new Error('중고가 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return validateUsedPriceData(await response.json());
    })().catch(error => { cached = null; throw error; });
  }
  return cached;
}
