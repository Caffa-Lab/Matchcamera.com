import {brandLogoUrl, money, productLabel} from './data.js?v=20260901-all';

const esc=(value='')=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const hasValue=value=>value!==null&&value!==undefined&&String(value).trim()!=='';

function lensFilterDetails(p){
  if(p.type!=='렌즈')return [];
  const specs=p.specs||{};
  const rawDiameter=p.filterDiameterMm??specs['필터 구경(mm)']??specs['필터 구경']??specs['Filter diameter'];
  const frontStatus=p.frontFilterStatus??specs['전면 필터 장착 가능 여부'];
  let diameter='정보 미확인';
  if(Number(rawDiameter)>0)diameter=`${Number(rawDiameter)}mm`;
  else if(rawDiameter===0||/없음|불가|none/i.test(String(rawDiameter||''))||/없음|불가/i.test(String(frontStatus||'')))diameter='필터 장착 불가';
  else if(hasValue(rawDiameter))diameter=String(rawDiameter);
  const rows=[['필터 구경',diameter]];
  if(hasValue(frontStatus))rows.push(['전면 필터',String(frontStatus)]);
  return rows;
}

function ensureDialog(){
  let dialog=document.querySelector('#matchcameraProductDialog');
  if(dialog)return dialog;
  dialog=document.createElement('dialog');
  dialog.id='matchcameraProductDialog';
  dialog.className='product-detail-dialog';
  dialog.setAttribute('aria-labelledby','productDetailTitle');
  dialog.innerHTML='<div class="product-detail-content"></div>';
  dialog.addEventListener('click',event=>{
    if(event.target===dialog||event.target.closest('[data-product-detail-close]'))dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function productImage(p){
  const label=productLabel(p);
  const photo=p.imageSrc?`<img class="product-detail-photo" src="${esc(p.imageSrc)}" alt="${esc(label)}">`:'';
  return `<div class="product-detail-visual ${p.imageSrc?'has-photo':''}">${photo}<div class="product-detail-fallback"><img src="${esc(brandLogoUrl(p.manufacturer))}" alt="${esc(p.manufacturer||'')}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc(p.manufacturer||'제품 이미지 없음')}</span></div></div>`;
}

function specificationRows(p){
  const base=[
    ['카메라 방식',p.cameraSystem],['제조사',p.manufacturer],['마운트',p.mount],
    ['센서 포맷',p.sensorFormat],['렌즈 포맷',p.lensFormat],['모델 코드',p.modelCode],
    ['제품 종류',p.type],['시리즈',p.series],['출시년도',p.releaseYear],
    ['초점거리',p.focalLength],['최대 조리개',p.maxAperture],
    ...lensFilterDetails(p),
  ];
  const seen=new Set([...base.map(([key])=>key),'필터 구경(mm)','Filter diameter','전면 필터 장착 가능 여부']);
  const hiddenKey=/(?:usd|미국\s*(?:가격|출시가|판매가|정가|소비자가)|us\s*(?:price|msrp))/i;
  return [
    ...base.filter(([,value])=>hasValue(value)),
    ...Object.entries(p.specs||{}).filter(([key,value])=>hasValue(value)&&!seen.has(key)&&!hiddenKey.test(key)),
  ];
}

export function openProductDetail(p){
  if(!p)return;
  const dialog=ensureDialog();
  const label=productLabel(p);
  const rows=specificationRows(p);
  const priceLabel=p.koreaPriceType||'한국 공식 정가/출고가';
  const saleStatus=p.koreaSaleStatus||p.saleStatus||p.currentSale||'판매 상태 미확인';
  dialog.querySelector('.product-detail-content').innerHTML=`
    <header class="product-detail-head">
      <div><span>제품 상세</span><h2 id="productDetailTitle">${esc(label)}</h2></div>
      <button class="product-detail-close" type="button" data-product-detail-close aria-label="제품 상세 닫기">닫기</button>
    </header>
    <div class="product-detail-scroll">
      <section class="product-detail-summary">
        ${productImage(p)}
        <div class="product-detail-price">
          <span>${esc(p.manufacturer||'')} ${p.modelCode?`· ${esc(p.modelCode)}`:''}</span>
          <strong>${esc(label)}</strong>
          <div class="product-detail-status">${esc(saleStatus)}</div>
          <small>${esc(priceLabel)}</small>
          <b>${esc(money(p.currentPriceKrw))}</b>
          ${p.koreaPriceDate?`<em>가격 기준일 ${esc(p.koreaPriceDate)}</em>`:''}
        </div>
      </section>
      <section class="product-detail-specifications" aria-label="상세 사양">
        <h3>상세 사양</h3>
        <div class="product-detail-spec-grid">${rows.map(([key,value])=>`<div class="product-detail-spec"><span>${esc(key)}</span><strong>${esc(String(value))}</strong></div>`).join('')}</div>
      </section>
    </div>`;
  const photo=dialog.querySelector('.product-detail-photo');
  photo?.addEventListener('error',()=>{
    photo.remove();
    dialog.querySelector('.product-detail-visual')?.classList.remove('has-photo');
  },{once:true});
  if(dialog.open)dialog.close();
  dialog.showModal();
}
