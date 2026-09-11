// Review flags indicate missing evidence, not that a manufacturer's claim is false.
export const REVIEW_TYPES={
 'invalid':'필수 필드 오류','duplicate-id':'중복 ID','duplicate-model':'같은 마운트 모델 중복',
 'missing-load':'지지하중 미확인','kit-load':'세트 하중 불일치','missing-image':'사진 없음',
 'missing-specs':'핵심 사양 부족','missing-price':'가격 미확인','missing-source':'출처 미확인',
 'stale-price':'가격 재확인 필요','stale-specs':'사양 재확인 필요','invalid-date':'확인일 오류'
};
const present=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&!['-','미확인','확인 필요'].includes(String(v).trim());
const positive=v=>present(v)&&Number.isFinite(Number(v))&&Number(v)>0;
const url=v=>/^https?:\/\//.test(String(v||''));
const active=p=>p.active!==false&&p.enabled!==false&&p.visibility!=='hidden';
const name=p=>p.officialName||p.model||p.id||'이름 없음';
function reviewDate(value,now){
 if(!value)return 'missing';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return 'invalid';
 const time=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value||time>now+86400000)return 'invalid';
 return now-time>180*86400000?'stale':'current';
}
export function buildCatalogReview(products,{imageFor=()=>null,priceFor=()=>null,now=Date.now()}={}){
 const result=[],ids=new Map(),models=new Map();
 const add=(type,p,detail,severity='medium',action='product')=>result.push({type,title:REVIEW_TYPES[type],detail,severity,action:p._kind?'accessory':action,kind:p._kind||'',product:p,sourceFile:p._sourceFile,sourceIndex:p._sourceIndex,visible:active(p)&&(!['tripods','heads'].includes(p._kind)||typeof p.maxLoadKg==='number'&&p.maxLoadKg>0)});
 for(const p of products){
  const accessory=!!p._kind,price=accessory?null:priceFor(p)?.row,image=accessory?{src:p.imageSrc}:imageFor(p);
  const amount=accessory?p.currentPriceKrw:price?.['한국 기준 가격(원)']||price?.['한국 공식/출시 가격(원)']||price?.['한국 출고가/공식정가(원)']||p.currentPriceKrw;
  const id=String(p.id||'').trim();if(id){if(!ids.has(id))ids.set(id,[]);ids.get(id).push(p);}
  const model=[p.manufacturer,p.type||p._kind,p.mount||'',String(p.modelCode||'').trim().toLowerCase()].join('|');
  if(p.modelCode){if(!models.has(model))models.set(model,[]);models.get(model).push(p);}
  const missing=['id','manufacturer','officialName',...(accessory?[]:['type'])].filter(k=>!present(p[k]));
  if(missing.length)add('invalid',p,`누락: ${missing.join(', ')}`,'high');
  if(!image?.src||image.method==='image-pending'||/image-pending|placeholder/.test(image.src))add('missing-image',p,'정확한 모델 사진이 등록되지 않았습니다.','medium','image');
  if(!positive(amount))add('missing-price',p,'확인 가능한 국내 가격이 없습니다.','medium','price');
  if(['tripods','heads'].includes(p._kind)){
   if(typeof p.maxLoadKg!=='number'||!Number.isFinite(p.maxLoadKg)||p.maxLoadKg<=0)add('missing-load',p,'숫자로 확인된 지지하중이 없어 공개 목록과 견적에서 제외됩니다.','high');
   if(p.kind==='tripod-kit'&&!p.includedHead?.officialName)add('kit-load',p,'세트에 포함된 헤드가 명시되지 않았습니다.','high');
   if(positive(p.includedHead?.maxLoadKg)&&positive(p.maxLoadKg)&&p.maxLoadKg>p.includedHead.maxLoadKg)add('kit-load',p,'세트 지지하중이 포함 헤드의 지지하중보다 큽니다.','high');
  }
  const specs=p.specs||{};
  const required=accessory?[]:p.type==='바디'?[
   ['마운트',p.mount],['센서 포맷',p.sensorFormat],['유효 화소',p.megapixels||specs['유효 화소(MP)']],['무게',p.weightG||specs['무게(g)']],['배터리',specs['배터리 모델']||specs['배터리 상세']],['기록 매체',specs['메모리카드 종류']]
  ]:[['마운트',p.mount],['초점거리',p.focalLength||p.focalMinMm],['조리개',p.maxAperture],['무게',p.weightG||specs['무게(g)']],['최단 촬영 거리',specs['최단 촬영 거리(m)']||specs['최단 촬영 거리 상세']]];
  const gaps=required.filter(([,value])=>!present(value)).map(([key])=>key);
  if(gaps.length)add('missing-specs',p,`미확인 항목: ${gaps.join(', ')}`);
  if(accessory&&!positive(p.weightKg)&&!positive(p.weightG)&&!['memoryCards','adapters','batteries'].includes(p._kind))add('missing-specs',p,'무게가 없어 선택 시 탑재 중량을 완전히 계산할 수 없습니다.');
  const sources=Object.values(p.specSources||{}).map(s=>s.url).filter(url);
  const source=p.officialSource||specs['공식 출처 URL'];
  if(!sources.length&&!url(source))add('missing-source',p,'사양을 확인할 공식 출처 URL이 필요합니다.');
  if(positive(amount)){
   const ps=accessory?p.priceSource:price?.['가격 출처 URL']||p.koreaPriceSource;
   if(!url(ps))add('missing-source',p,'가격 출처 URL이 필요합니다.','medium','price');
   const date=accessory?p.priceDate:price?.['가격 기준일']||p.koreaPriceDate;
   const status=reviewDate(date,now);
   if(status==='invalid')add('invalid-date',p,`가격 확인일 형식 또는 미래 날짜 확인: ${date}`,'medium','price');
   // Historic launch prices do not expire; review only current price observations.
   else if(['missing','stale'].includes(status)&&!/출시|출고/.test(price?.['가격 유형']||p.koreaPriceType||''))add('stale-price',p,date?`가격 확인일 ${date} · 180일 경과`:'가격 확인일이 없습니다.','medium','price');
  }
  const date=specs['사양 확인일']||p.verifiedAt;
  const status=reviewDate(date,now);
  if(status==='invalid')add('invalid-date',p,`사양 확인일 형식 또는 미래 날짜 확인: ${date}`);
  else if(status==='stale'||status==='missing'&&!accessory)add('stale-specs',p,date?`사양 확인일 ${date} · 180일 경과`:'모델별 사양 확인일이 없습니다.','low');
 }
 for(const [id,rows] of ids)if(rows.length>1)for(const p of rows)add('duplicate-id',p,`${id}가 ${rows.length}개 원본 레코드에 사용됩니다.`,'high');
 for(const rows of models.values())if(rows.length>1)for(const p of rows)add('duplicate-model',p,`같은 제조사·종류·마운트의 모델코드가 ${rows.length}개입니다. 단품·세트 및 원본 병합 여부를 검토하세요.`,'low');
 const rank={high:0,medium:1,low:2};
 return result.sort((a,b)=>Number(b.visible)-Number(a.visible)||rank[a.severity]-rank[b.severity]||name(a.product).localeCompare(name(b.product),'ko'));
}
