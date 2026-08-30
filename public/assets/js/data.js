let cache;
let adapterCache;
let batteryCache;

const PRODUCT_URL = '/data/products.json';
const EXPANSION_URL = '/data/system-expansion.json';
const PARTNER_PRODUCT_URL = '/data/official-partner-products.json';
const KOREA_PRICE_URL = '/data/korea-prices.json';
const IMAGE_MAP_URL = '/data/product-images.json';
const ADAPTER_URL = '/data/mount-adapters.json';
const BATTERY_URL = '/data/batteries.json';

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

const priceKey = (name, mount) => `${String(name || '').trim()}||${String(mount || '').trim()}`;
const romanFromNumber = n => ({1:'I',2:'II',3:'III',4:'IV',5:'V',6:'VI'})[Number(n)] || String(n);
const romanToNumber = r => ({I:1,II:2,III:3,IV:4,V:5,VI:6})[String(r || '').toUpperCase()] || null;

export function legacySonyQuery(value=''){
  let s = String(value);
  s = s.replace(/alpha\s*(?=\d)/gi, 'a').replace(/알파\s*(?=\d)/g, 'a');

  // a7r5 / a7s3 / a7c2 -> α7R V / α7S III / α7C II
  s = s.replace(/\ba(\d+)([rsc]?)[\s-]*([1-6])\b/gi, (_, num, suffix, mark) =>
    `α${num}${String(suffix || '').toUpperCase()} ${romanFromNumber(mark)}`
  );

  // a7m5 / a7rm5 / a9m3 / a1m2
  s = s.replace(/\ba(\d+)([rsc]?)[\s-]*m([1-6])\b/gi, (_, num, suffix, mark) =>
    `α${num}${String(suffix || '').toUpperCase()} ${romanFromNumber(mark)}`
  );

  // a7rv / a7r v / a7iv
  s = s.replace(/\ba(\d+)([rsc]?)[\s-]*(vi|iv|iii|ii|v|i)\b/gi, (_, num, suffix, mark) =>
    `α${num}${String(suffix || '').toUpperCase()} ${String(mark).toUpperCase()}`
  );

  s = s.replace(/(^|[\s(])a(?=\d)/gi, '$1α');
  return s;
}

function installLegacySearchAliasBridge(){
  if(globalThis.__matchcameraSonyAliasInstalled) return;
  globalThis.__matchcameraSonyAliasInstalled = true;
  document.addEventListener('input', e => {
    const el = e.target;
    if(!(el instanceof HTMLInputElement)) return;
    if(!['catalogSearch','search','q','homeSearch'].includes(el.id)) return;
    const original = el.value;
    const transformed = legacySonyQuery(original);
    if(original === transformed) return;
    el.value = transformed;
    queueMicrotask(() => {
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

function compactSearch(value=''){ return normalizeSearch(value).replace(/\s+/g, ''); }

function sonyAliases(p){
  if(String(p.manufacturer || '').toLowerCase() !== 'sony') return [];
  const label = String(p.officialName || p.model || '').replace(/[αΑ]/g, 'a').replace(/\bAlpha(?=\d)/gi, 'a');
  const aliases = new Set([label]);
  const m = label.match(/\ba(\d+)([rsc]?)(?:\s+)?(vi|iv|iii|ii|v|i)?\b/i);
  if(m){
    const base = `a${m[1]}${m[2] || ''}`;
    aliases.add(base);
    aliases.add(`alpha${m[1]}${m[2] || ''}`);
    aliases.add(`알파${m[1]}${m[2] || ''}`);
    if(m[3]){
      const roman = m[3].toUpperCase();
      const number = romanToNumber(roman);
      aliases.add(`${base}${roman.toLowerCase()}`);
      aliases.add(`${base} ${roman}`);
      if(number){
        aliases.add(`${base}${number}`);       // a7r5
        aliases.add(`${base}m${number}`);      // a7rm5
        aliases.add(`alpha${m[1]}${m[2] || ''}${number}`);
        aliases.add(`알파${m[1]}${m[2] || ''}${number}`);
      }
    }
  }
  return [...aliases].filter(Boolean);
}

function normalizedSystem(p){
  const raw = String(p.cameraSystem || '').trim();
  const name = String(p.officialName || '');
  if(/Cinema Line\s+FX|EOS\s+C\d|EOS R5 C|Blackmagic|PYXIS|URSA|EVA1|BGH1|BS1H/i.test(name)) return '시네마';
  if(/DSLT/i.test(raw)) return 'DSLR';
  return raw || '미러리스';
}

export function productSearchText(p){
  const values = [
    p.officialName,p.model,p.modelCode,p.series,p.category,p.manufacturer,p.mount,
    p.lensFormat,p.focalLength,p.maxAperture,p.cameraSystem,p.sensorFormat,
    ...(p.searchAliases || []),...sonyAliases(p),
  ].filter(Boolean);
  return {
    spaced: values.map(normalizeSearch).join(' '),
    compact: values.map(compactSearch).join(' '),
  };
}

export function matchesSearch(p, query=''){
  const q1 = normalizeSearch(query);
  if(!q1) return true;
  const q2 = compactSearch(query);
  const hay = productSearchText(p);
  return hay.spaced.includes(q1) || (q2 && hay.compact.includes(q2));
}

function mergeProductLists(base, extra){
  const out = [];
  const byKey = new Map();
  const keyOf = p => `${String(p.officialName||'').trim()}||${String(p.modelCode||'').trim()}||${String(p.type||'').trim()}`;
  for(const p of [...(Array.isArray(base)?base:[]), ...(Array.isArray(extra)?extra:[])]){
    const key = keyOf(p);
    if(byKey.has(key)) Object.assign(byKey.get(key), p);
    else {
      const copy = {...p};
      byKey.set(key, copy);
      out.push(copy);
    }
  }
  return out;
}

export async function loadProducts(){
  if(cache) return cache;
  const productRes = await fetch(PRODUCT_URL);
  if(!productRes.ok) throw new Error('제품 DB를 불러오지 못했습니다.');
  const baseProducts = await productRes.json();

  const [expansion, partnerProducts, koreaPrices, imageMap] = await Promise.all([
    optionalJson(EXPANSION_URL, []),
    optionalJson(PARTNER_PRODUCT_URL, []),
    optionalJson(KOREA_PRICE_URL, []),
    optionalJson(IMAGE_MAP_URL, {}),
  ]);

  const products = mergeProductLists(mergeProductLists(baseProducts, expansion), partnerProducts);
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
    const cameraSystem = normalizedSystem(p);

    return {
      ...p,
      cameraSystem,
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
      imageSrc,
      imageSourcePage: typeof img === 'object' ? img?.sourcePage || img?.source || '' : '',
      imageSourceUrl: typeof img === 'object' ? img?.sourceImage || '' : '',
      searchAliases: [...new Set([...(p.searchAliases || []), ...sonyAliases({...p,cameraSystem})])],
    };
  });
  return cache;
}

export async function loadAdapters(){
  if(adapterCache) return adapterCache;
  adapterCache = await optionalJson(ADAPTER_URL, []);
  return Array.isArray(adapterCache) ? adapterCache : [];
}

export async function loadBatteries(){
  if(batteryCache) return batteryCache;
  batteryCache = await optionalJson(BATTERY_URL, []);
  return Array.isArray(batteryCache) ? batteryCache : [];
}

export function batteryMatchesBody(battery, body){
  if(!battery || !body) return false;
  const label = normalizeSearch(productLabel(body));
  const modelCode = normalizeSearch(body.modelCode || '');
  const names = Array.isArray(battery.compatibleNames) ? battery.compatibleNames : [];
  const codes = Array.isArray(battery.compatibleModelCodes) ? battery.compatibleModelCodes : [];
  const prefixes = Array.isArray(battery.compatiblePrefixes) ? battery.compatiblePrefixes : [];

  if(names.some(x => normalizeSearch(x) === label)) return true;
  if(modelCode && codes.some(x => normalizeSearch(x) === modelCode)) return true;
  if(prefixes.some(x => label.startsWith(normalizeSearch(x)))) return true;
  return false;
}

export function findBatteriesForBody(body, batteries=[]){
  return (Array.isArray(batteries) ? batteries : []).filter(b => batteryMatchesBody(b, body));
}

export const money = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n).toLocaleString('ko-KR')}원` : '가격 미확인';
};
export const yes = v => v === '예' || v === '있음';
export function productLabel(p){ return p.officialName || p.model || p.modelCode || p.id; }
export function productKey(p){ return p.modelCode || p.model || p.id; }

export function brandSlug(name=''){
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
const PNG_BRAND_LOGOS=new Set(['sony','canon','fujifilm','leica','nikon','olympus','om-system','panasonic','pentax','ricoh','sigma','tamron','samyang']);
export function brandLogoUrl(name=''){const slug=brandSlug(name);return `/assets/images/brands/${slug}.${PNG_BRAND_LOGOS.has(slug)?'png':'svg'}`;}
