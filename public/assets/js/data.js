
let cache;
export async function loadProducts(){
  if(cache) return cache;
  const r = await fetch('/data/products.json');
  if(!r.ok) throw new Error('제품 DB를 불러오지 못했습니다.');
  cache = await r.json();
  return cache;
}
export const money = v => Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString('en-US',{maximumFractionDigits:2})}` : '가격 미확인';
export const yes = v => v === '예' || v === '있음';
export function productLabel(p){return p.officialName || p.model || p.modelCode || p.id}
export function productKey(p){return p.modelCode || p.model || p.id}
