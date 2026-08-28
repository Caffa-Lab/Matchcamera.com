let cache;

const PRODUCT_URL = '/data/products.json';
const KOREA_PRICE_URL = '/data/korea-prices.json';
const IMAGE_MAP_URL = '/data/product-images.json';

async function optionalJson(url, fallback){
  try{
    const r = await fetch(url, {cache:'no-cache'});
    if(!r.ok) return fallback;
    return await r.json();
  }catch(e){
    console.warn(`${url} 로드 실패`, e);
    return fallback;
  }
}

const priceKey = (name, mount) =>
  `${String(name || '').trim()}||${String(mount || '').trim()}`;

function romanFromNumber(n){
  return ({1:'I',2:'II',3:'III',4:'IV',5:'V',6:'VI'})[Number(n)] || String(n);
}

/**
 * 사용자가 Sony α 시리즈를 "a7", "alpha7", "알파7", "a7m4"처럼
 * 입력해도 기존 검색 코드가 이해할 수 있도록 입력 이벤트 중에만
 * Sony식 α 표기로 변환합니다. 화면 입력값은 즉시 원래 값으로 복원됩니다.
 */
export function legacySonyQuery(value=''){
  let s = String(value);

  // alpha7 / 알파7 -> a7
  s = s.replace(/alpha\s*(?=\d)/gi, 'a');
  s = s.replace(/알파\s*(?=\d)/g, 'a');

  // a7m4, a7rm5, a7cm2, a9m3, a1m2 -> α7 IV, α7R V ...
  s = s.replace(/\ba(\d+)([rsc]?)[\s-]*m([1-6])\b/gi, (_, num, suffix, mark) => {
    return `α${num}${String(suffix || '').toUpperCase()} ${romanFromNumber(mark)}`;
  });

  // a7iv / a7riv -> α7 IV / α7R IV
  s = s.replace(/\ba(\d+)([rsc]?)(vi|iv|iii|ii|v|i)\b/gi, (_, num, suffix, mark) => {
    return `α${num}${String(suffix || '').toUpperCase()} ${String(mark).toUpperCase()}`;
  });

  // a7 IV / a6700 -> α7 IV / α6700
  s = s.replace(/(^|[\s(])a(?=\d)/gi, '$1α');
  return s;
}

function installLegacySearchAliasBridge(){
  if(globalThis.__matchcameraSonyAliasInstalled) return;
  globalThis.__matchcameraSonyAliasInstalled = true;

  document.addEventListener('input', e => {
    const el = e.target;
    if(!(el instanceof HTMLInputElement)) return;
    if(!['catalogSearch','search','q'].includes(el.id)) return;

    const original = el.value;
    const transformed = legacySonyQuery(original);
    if(original === transformed) return;

    // page-specific input listener가 변환값을 읽도록 capture 단계에서 임시 변경
    el.value = transformed;
    queueMicrotask(() => {
      // 그 사이 사용자가 다른 값을 입력하지 않은 경우에만 표시값 복원
      if(el.value === transformed) el.value = original;
    });
  }, true);
}

if(typeof document !== 'undefined') installLegacySearchAliasBridge();

export function normalizeSearch(value=''){
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/alpha\s*(?=\d)/g, 'a')
    .replace(/알파\s*(?=\d)/g, 'a')
    .replace(/[αΑ]/g, 'a')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function compactSearch(value=''){
  return normalizeSearch(value).replace(/\s+/g, '');
}

function sonyAliases(p){
  if(String(p.manufacturer || '').toLowerCase() !== 'sony') return [];

  const label = p.officialName || p.model || '';
  const aLabel = String(label)
    .replace(/[αΑ]/g, 'a')
    .replace(/\bAlpha(?=\d)/gi, 'a');

  const aliases = new Set([aLabel]);

  const m = aLabel.match(/\ba(\d+)([rsc]?)(?:\s+)?(vi|iv|iii|ii|v|i)?\b/i);
  if(m){
    const base = `a${m[1]}${m[2] || ''}`;
    aliases.add(base);
    aliases.add(`alpha${m[1]}${m[2] || ''}`);
    aliases.add(`알파${m[1]}${m[2] || ''}`);

    if(m[3]){
      const roman = m[3].toUpperCase();
      const number = ({I:1,II:2,III:3,IV:4,V:5,VI:6})[roman];
      aliases.add(`${base}${roman.toLowerCase()}`);
      aliases.add(`${base} ${roman}`);
      if(number) aliases.add(`${base}m${number}`);
    }
  }

  return [...aliases].filter(Boolean);
}

export function productSearchText(p){
  const values = [
    p.officialName,
    p.model,
    p.modelCode,
    p.series,
    p.category,
    p.manufacturer,
    p.mount,
    p.lensFormat,
    p.focalLength,
    p.maxAperture,
    ...(p.searchAliases || []),
    ...sonyAliases(p),
  ].filter(Boolean);

  const spaced = values.map(normalizeSearch).join(' ');
  const compact = values.map(compactSearch).join(' ');
  return {spaced, compact};
}

export function matchesSearch(p, query=''){
  const q1 = normalizeSearch(query);
  if(!q1) return true;
  const q2 = compactSearch(query);
  const hay = productSearchText(p);
  return hay.spaced.includes(q1) || (q2 && hay.compact.includes(q2));
}

export async function loadProducts(){
  if(cache) return cache;

  const productRes = await fetch(PRODUCT_URL);
  if(!productRes.ok) throw new Error('제품 DB를 불러오지 못했습니다.');

  const products = await productRes.json();
  const [koreaPrices, imageMap] = await Promise.all([
    optionalJson(KOREA_PRICE_URL, []),
    optionalJson(IMAGE_MAP_URL, {}),
  ]);

  const priceExact = new Map();
  const priceByName = new Map();

  for(const row of Array.isArray(koreaPrices) ? koreaPrices : []){
    const name = row?.['정식 제품명'];
    const mount = row?.['마운트'];
    if(!name) continue;
    priceExact.set(priceKey(name, mount), row);
    if(!priceByName.has(name)) priceByName.set(name, []);
    priceByName.get(name).push(row);
  }

  cache = products.map(p => {
    const name = p.officialName || p.model || p.modelCode || '';
    const mount = p.mount || '';

    let kr = priceExact.get(priceKey(name, mount));
    if(!kr){
      const sameName = priceByName.get(name) || [];
      if(sameName.length === 1) kr = sameName[0];
    }

    const street = Number(kr?.['한국 기준 가격(원)']);
    const official = Number(kr?.['한국 공식/출시 가격(원)']);
    const hasStreet = Number.isFinite(street) && street > 0;
    const hasOfficial = Number.isFinite(official) && official > 0;
    const displayKrw = hasStreet ? street : (hasOfficial ? official : null);

    const img = imageMap?.[name];
    const imageSrc = typeof img === 'string' ? img : img?.src || null;

    return {
      ...p,
      originalPriceUsd: p.currentPriceUsd ?? null,

      // 한국 가격
      currentPriceKrw: displayKrw,
      koreaStreetPriceKrw: hasStreet ? street : null,
      koreaOfficialPriceKrw: hasOfficial ? official : null,
      koreaPriceType: kr?.['가격 유형'] || '',
      koreaDistribution: kr?.['유통 형태'] || '',
      koreaSaleStatus: kr?.['국내 유통 상태'] || '',
      koreaPriceDate: kr?.['가격 기준일'] || '',
      koreaPriceSource: kr?.['가격 출처 URL'] || '',
      koreaPriceVerification: kr?.['가격 검증 상태'] || '',
      koreaPriceNote: kr?.['비고'] || '',

      // 기존 UI가 currentPriceUsd를 참조하는 동안 원화 합계가 동작하도록 호환 유지
      currentPriceUsd: displayKrw,

      // 제품 사진
      imageSrc,
      imageSourcePage: typeof img === 'object' ? img?.sourcePage || img?.source || '' : '',
      imageSourceUrl: typeof img === 'object' ? img?.sourceImage || '' : '',

      // 향후 검색 UI에서 직접 사용할 수 있는 별칭
      searchAliases: sonyAliases(p),
    };
  });

  return cache;
}

export const money = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0
    ? `${Math.round(n).toLocaleString('ko-KR')}원`
    : '가격 미확인';
};

export const yes = v => v === '예' || v === '있음';

export function productLabel(p){
  return p.officialName || p.model || p.modelCode || p.id;
}

export function productKey(p){
  return p.modelCode || p.model || p.id;
}
