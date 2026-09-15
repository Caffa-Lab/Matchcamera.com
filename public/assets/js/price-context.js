const text=value=>typeof value==='string'?value.trim():'';
const amount=value=>{const number=Number(value);return Number.isFinite(number)&&number>0?number:null;};
const source=value=>{try{const url=new URL(value);return /^https?:$/.test(url.protocol)?url.href:'';}catch{return '';}};
const date=value=>{const valueText=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(valueText))return '';const parsed=new Date(`${valueText}T00:00:00Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===valueText?valueText:'';};
const labels={current:'한국 공식 현재가',launch:'한국 출시가',historical:'과거 공식 가격',unverified:'이전 가격 · 재확인 필요'};

// A recorded price is not necessarily today's purchase price. Only a dated,
// attributed record with a known price basis participates in the reference sum.
export function priceContext(product={}){
  const value=amount(product.currentPriceKrw);
  const details=product.koreaPriceDetails;
  const offers=Array.isArray(details?.offers)?details.offers:[];
  const matching=offers.filter(offer=>amount(offer.amount)===value&&value!==null&&(!offer.currency||offer.currency==='KRW'));
  const offer=matching.find(offer=>offer.kind==='current')||matching.find(offer=>['launch','historical'].includes(offer.kind))||matching[0];
  const recordedLabel=text(product.koreaPriceType)||text(product.priceType)||text(product.koreaPriceStatus);
  const status=[recordedLabel,details?.status,product.koreaPriceVerification,product.priceVerification].join(' ');
  const unverified=/재확인|미확인|미발표|unverified|needs-reconfirmation/i.test(status)||offer?.kind==='unverified';
  const sourceUrl=source(offer?.sourceUrl)||(!offers.length?source(product.koreaPriceSource)||source(product.priceSource):'');
  const checkedAt=date(offer?.checkedAt);
  const basisDate=checkedAt||date(offer?.asOf)||(!offers.length?(date(product.koreaPriceDate)||date(product.priceDate)):'');
  let kind=offer?.kind||(/출시/.test(recordedLabel)?'launch':/과거/.test(recordedLabel)?'historical':/현재/.test(recordedLabel)?'current':/판매처|표시가/.test(recordedLabel)?'retail':/공식|정가|출고가|판매가/.test(recordedLabel)?'official':'unknown');
  if(unverified)kind='unverified';
  const knownKind=['current','launch','historical','retail','official'].includes(kind);
  const included=value!==null&&knownKind&&!!sourceUrl&&!!basisDate;
  const label=value===null?'가격 미확인':kind==='unverified'?labels.unverified:(offer?labels[kind]:recordedLabel)||'가격 기준 미확인';
  const exclusionReason=value===null?'금액 미확인':kind==='unverified'?'재확인 필요':!knownKind?'가격 기준 미확인':!sourceUrl?'가격 출처 미확인':!basisDate?'가격 기준일 미확인':'';
  return {amount:value,kind,label,sourceUrl,date:basisDate,dateLabel:checkedAt?'출처 확인일':'가격 기준일',included,exclusionReason,historical:included&&['launch','historical'].includes(kind)};
}

export function estimatePriceSummary(products=[]){
  const contexts=products.map(priceContext);
  const included=contexts.filter(context=>context.included);
  const missing=contexts.filter(context=>context.amount===null).length;
  const unverified=contexts.filter(context=>context.amount!==null&&!context.included).length;
  const launch=included.filter(context=>context.kind==='launch').length;
  const historical=included.filter(context=>context.kind==='historical').length;
  const parts=[];
  if(launch||historical)parts.push(`${[launch?`출시가 ${launch}개`:'',historical?`과거가 ${historical}개`:''].filter(Boolean).join(' · ')} 포함.`);
  if(missing||unverified)parts.push(`${[missing?`금액 미확인 ${missing}개`:'',unverified?`가격 근거 재확인 ${unverified}개`:''].filter(Boolean).join(' · ')} 제외.`);
  parts.push(products.length?'기록된 가격의 참고 합계이며 실제 구매금액과 다를 수 있습니다.':'제품을 선택하면 가격 종류와 합산 여부를 표시합니다.');
  return {total:included.length?included.reduce((sum,context)=>sum+context.amount,0):null,includedCount:included.length,totalCount:products.length,missingCount:missing,unverifiedCount:unverified,launchCount:launch,historicalCount:historical,note:parts.join(' ')};
}
