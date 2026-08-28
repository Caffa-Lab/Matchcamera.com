let cache;

const priceKey = (name, mount) =>
  `${String(name || '').trim()}||${String(mount || '').trim()}`;

export async function loadProducts(){
  if(cache) return cache;

  const [productRes, priceRes] = await Promise.all([
    fetch('/data/products.json'),
    fetch('/data/korea-prices.json')
  ]);

  if(!productRes.ok) throw new Error('제품 DB를 불러오지 못했습니다.');

  const products = await productRes.json();

  // 한국 가격 DB가 아직 없거나 읽기 실패해도 제품 DB 자체는 동작하도록 처리
  let koreaPrices = [];
  if(priceRes.ok){
    try {
      koreaPrices = await priceRes.json();
    } catch (e) {
      console.warn('한국 가격 DB 파싱 실패:', e);
    }
  } else {
    console.warn('한국 가격 DB를 불러오지 못했습니다.');
  }

  const byExactKey = new Map();
  const byName = new Map();

  for(const row of koreaPrices){
    const name = row['정식 제품명'];
    const mount = row['마운트'];
    if(!name) continue;
    byExactKey.set(priceKey(name, mount), row);

    // 같은 제품명이 여러 마운트에 존재하지 않는 경우의 보조 매칭용
    if(!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row);
  }

  cache = products.map(p => {
    const name = p.officialName || p.model || p.modelCode || '';
    const mount = p.mount || '';

    let kr = byExactKey.get(priceKey(name, mount));

    // 정확한 마운트 매칭이 없고 같은 이름의 가격 행이 하나뿐이면 보조 매칭
    if(!kr){
      const candidates = byName.get(name) || [];
      if(candidates.length === 1) kr = candidates[0];
    }

    const krStreet = Number(kr?.['한국 기준 가격(원)']);
    const krOfficial = Number(kr?.['한국 공식/출시 가격(원)']);

    const hasStreet = Number.isFinite(krStreet) && krStreet > 0;
    const hasOfficial = Number.isFinite(krOfficial) && krOfficial > 0;
    const displayKrw = hasStreet ? krStreet : (hasOfficial ? krOfficial : null);

    return {
      ...p,

      // 기존 해외 가격은 보존
      originalPriceUsd: p.currentPriceUsd ?? null,

      // 한국 가격 필드
      currentPriceKrw: displayKrw,
      koreaStreetPriceKrw: hasStreet ? krStreet : null,
      koreaOfficialPriceKrw: hasOfficial ? krOfficial : null,
      koreaPriceType: kr?.['가격 유형'] || '',
      koreaDistribution: kr?.['유통 형태'] || '',
      koreaSaleStatus: kr?.['국내 유통 상태'] || '',
      koreaPriceDate: kr?.['가격 기준일'] || '',
      koreaPriceSource: kr?.['가격 출처 URL'] || '',
      koreaPriceVerification: kr?.['가격 검증 상태'] || '',
      koreaPriceNote: kr?.['비고'] || '',

      // 기존 화면 코드가 currentPriceUsd를 참조하므로 한국 가격으로 호환 연결.
      // 추후 UI 전체를 currentPriceKrw로 변경하면 이 호환 필드는 제거 가능.
      currentPriceUsd: displayKrw
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
