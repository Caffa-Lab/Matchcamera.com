// Keep an announced product with no Korean price distinct from an older price
// record that we have not been able to verify.
export function productPriceStatus(product={}){
  return product.koreaPriceDetails?.status || product.priceStatus || product.koreaPriceStatus || '';
}

export function isPricePending(product={}){
  return productPriceStatus(product)==='not-announced';
}

export const money=value=>{
  const number=Number(value);
  return Number.isFinite(number)&&number>0?`${Math.round(number).toLocaleString('ko-KR')}원`:'가격 미확인';
};

export function productMoney(product={}){
  return isPricePending(product)?'가격 미정':money(product.currentPriceKrw);
}
