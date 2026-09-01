let cache;
let adapterCache;
let batteryCache;
let manufacturerOrderCache;
let filterOrderCache;
let flashCache;
let memoryCardCache;
let tripodCache;
let headCache;
let plateCache;

const PRODUCT_URL = '/data/products.json';
const EXPANSION_URL = '/data/system-expansion.json';
const PARTNER_PRODUCT_URL = '/data/official-partner-products.json';
const HASSELBLAD_PRODUCT_URL = '/data/hasselblad-products.json';
const KOREA_PRICE_URL = '/data/korea-prices.json';
const IMAGE_MAP_URL = '/data/product-images.json';
const ADAPTER_URL = '/data/mount-adapters.json';
const BATTERY_URL = '/data/batteries.json';
const MANUFACTURER_ORDER_URL = '/data/manufacturer-order.json';
const FILTER_ORDER_URL = '/data/filter-order.json';
const FLASH_URL = '/data/flashes.json';
const MEMORY_CARD_URL = '/data/memory-cards.json';
const TRIPOD_URL = '/data/tripods.json';
const HEAD_URL = '/data/heads.json';
const PLATE_URL = '/data/plates.json';

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

  const [expansion, partnerProducts, hasselbladProducts, koreaPrices, imageMap] = await Promise.all([
    optionalJson(EXPANSION_URL, []),
    optionalJson(PARTNER_PRODUCT_URL, []),
    optionalJson(HASSELBLAD_PRODUCT_URL, []),
    optionalJson(KOREA_PRICE_URL, []),
    optionalJson(IMAGE_MAP_URL, {}),
  ]);

  const products = mergeProductLists(mergeProductLists(mergeProductLists(baseProducts, expansion), partnerProducts), hasselbladProducts);
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
    const embeddedPrice = Number(p.currentPriceKrw);
    const hasEmbeddedPrice = Number.isFinite(embeddedPrice) && embeddedPrice > 0;
    const displayKrw = hasStreet ? street : (hasOfficial ? official : (hasEmbeddedPrice ? embeddedPrice : null));
    const img = imageMap?.[p.id] || imageMap?.[name];
    const imageSrc = typeof img === 'string' ? img : img?.src || null;
    const cameraSystem = normalizedSystem(p);

    return {
      ...p,
      cameraSystem,
      currentPriceKrw: displayKrw,
      koreaStreetPriceKrw: hasStreet ? street : null,
      koreaOfficialPriceKrw: hasOfficial ? official : (hasEmbeddedPrice ? embeddedPrice : null),
      koreaPriceType: kr?.['가격 유형'] || p.koreaPriceType || '',
      koreaDistribution: kr?.['유통 형태'] || p.koreaDistribution || '',
      koreaSaleStatus: kr?.['국내 유통 상태'] || p.koreaSaleStatus || '',
      koreaPriceDate: kr?.['가격 기준일'] || p.koreaPriceDate || '',
      koreaPriceSource: kr?.['가격 출처 URL'] || p.koreaPriceSource || '',
      koreaPriceVerification: kr?.['가격 검증 상태'] || p.koreaPriceVerification || '',
      koreaPriceNote: kr?.['비고'] || p.koreaPriceNote || '',
      imageSrc,
      imageSourcePage: typeof img === 'object' ? img?.sourcePage || img?.source || '' : '',
      imageSourceUrl: typeof img === 'object' ? img?.sourceImage || '' : '',
      searchAliases: [...new Set([...(p.searchAliases || []), ...sonyAliases({...p,cameraSystem})])],
    };
  }).filter(isProductActive);
  return cache;
}

export function isProductActive(product){
  return product?.active !== false && product?.enabled !== false && product?.visibility !== 'hidden';
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

export async function loadManufacturerOrder(){
  if(manufacturerOrderCache) return manufacturerOrderCache;
  const value=await optionalJson(MANUFACTURER_ORDER_URL,[]);
  manufacturerOrderCache=Array.isArray(value)?value.filter((brand,index)=>typeof brand==='string'&&brand.trim()&&value.indexOf(brand)===index):[];
  return manufacturerOrderCache;
}

export async function loadFilterOrder(){
  if(filterOrderCache) return filterOrderCache;
  filterOrderCache=await optionalJson(FILTER_ORDER_URL,{version:1,bodyRows:[],lensRows:[],options:{}});
  return filterOrderCache && typeof filterOrderCache==='object' ? filterOrderCache : {version:1,bodyRows:[],lensRows:[],options:{}};
}

async function loadArray(url,cacheName){
  const value=await optionalJson(url,[]);
  const rows=Array.isArray(value)?value.filter(item=>item?.active!==false):[];
  if(cacheName==='flash')flashCache=rows;
  if(cacheName==='memory')memoryCardCache=rows;
  if(cacheName==='tripod')tripodCache=rows;
  if(cacheName==='head')headCache=rows;
  if(cacheName==='plate')plateCache=rows;
  return rows;
}
export async function loadFlashes(){return flashCache||loadArray(FLASH_URL,'flash')}
export async function loadMemoryCards(){return memoryCardCache||loadArray(MEMORY_CARD_URL,'memory')}
export async function loadTripods(){return tripodCache||loadArray(TRIPOD_URL,'tripod')}
export async function loadHeads(){return headCache||loadArray(HEAD_URL,'head')}
export async function loadPlates(){return plateCache||loadArray(PLATE_URL,'plate')}

export function publicManufacturer(name=''){
  return /^(Olympus|OM SYSTEM)$/i.test(String(name).trim()) ? 'Olympus · OM SYSTEM' : String(name || '').trim();
}

export function memoryCardCompatibility(card,body){
  if(!card||!body)return {level:'unknown',label:'판정 불가',reason:'바디 또는 카드 정보가 없습니다.'};
  const specs=body.specs||{};
  const hay=[body.memoryCardTypes,body.cardTypes,body.memoryCardType,specs['메모리 카드'],specs['메모리카드'],specs['기록 매체'],specs['메모리카드 종류'],specs['메모리 카드 종류']].flat().filter(Boolean).join(' ').toLowerCase();
  if(!hay)return {level:'unknown',label:'판정 불가',reason:'바디의 메모리 카드 슬롯 규격이 등록되지 않았습니다.'};
  const type=String(card.cardType||'').toLowerCase();
  const aliases=type.includes('cfexpress type a')?['cfexpress type a','cfexpress a']:type.includes('cfexpress type b')?['cfexpress type b','cfexpress b']:type.includes('sd')?['sd','sdhc','sdxc']:type.includes('xqd')?['xqd']:[type];
  const compatible=aliases.some(alias=>alias&&hay.includes(alias));
  if(!compatible)return {level:'incompatible',label:'사용 불가',reason:`바디 슬롯 규격과 ${card.cardType||'카드'}가 일치하지 않습니다.`};
  const videoNeed=Number(body.minimumVpg||body.minimumVideoMbps||0);
  const cardVpg=Number(card.vpg||String(card.speedClass||'').match(/(?:VPG|V)(\d+)/i)?.[1]||0);
  if(videoNeed&&cardVpg&&cardVpg<videoNeed)return {level:'conditional',label:'속도 주의',reason:`카드 보장 속도 ${cardVpg}MB/s가 바디 권장 ${videoNeed}MB/s보다 낮습니다.`};
  return {level:'compatible',label:'호환',reason:`${card.cardType||'카드'} 슬롯 호환이 확인됩니다.`};
}

export function supportLoadGrade(capacityKg,payloadKg,{downgrade=false}={}){
  const capacity=Number(capacityKg);const payload=Number(payloadKg);
  if(!Number.isFinite(capacity)||capacity<=0||!Number.isFinite(payload)||payload<0)return {level:'unknown',label:'판정 불가',reserveKg:null,reason:'허용 하중 또는 탑재 중량 정보가 없습니다.'};
  const reserve=capacity-payload;
  const dangerMargin=Math.max(.2,payload*.25);
  const ampleMargin=Math.max(1,payload);
  const epsilon=1e-9;
  let index=reserve < -epsilon ? 0 : reserve + epsilon < dangerMargin ? 1 : reserve + epsilon < ampleMargin ? 2 : 3;
  if(downgrade&&index>0)index-=1;
  const rows=[['impossible','불가능'],['danger','위험'],['normal','보통'],['ample','여유']];
  const [level,label]=rows[index];
  return {level,label,reserveKg:reserve,dangerMarginKg:dangerMargin,ampleMarginKg:ampleMargin,reason:`탑재 ${payload.toFixed(2)}kg / 허용 ${capacity.toFixed(2)}kg / 여유 ${reserve.toFixed(2)}kg${downgrade?' · 안정성 조건으로 1단계 하향':''}`};
}

export function sortManufacturers(values,order=[]){
  const rank=new Map(order.map((brand,index)=>[brand,index]));
  return [...values].sort((a,b)=>(rank.get(a)??Number.MAX_SAFE_INTEGER)-(rank.get(b)??Number.MAX_SAFE_INTEGER)||String(a).localeCompare(String(b),'ko'));
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
