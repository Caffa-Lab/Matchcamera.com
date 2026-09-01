import {brandLogoUrl,loadProducts,loadManufacturerOrder,matchesSearch,money,productLabel} from './data.js?v=20260901-all';

const $=selector=>document.querySelector(selector);
const esc=(value='')=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const hasValue=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
const [products,manufacturerOrder]=await Promise.all([loadProducts(),loadManufacturerOrder()]);
const manufacturerRanks=new Map(manufacturerOrder.map((brand,index)=>[brand,index]));
const state={type:'바디',a:null,b:null};
const pickers={
  a:{root:$('[data-picker="a"]'),input:$('#compareSearchA'),results:$('#compareResultsA')},
  b:{root:$('[data-picker="b"]'),input:$('#compareSearchB'),results:$('#compareResultsB')},
};

function typeProducts(){
  return products.filter(product=>product.type===state.type).sort((a,b)=>{
    const currentA=a.currentSale==='예'?1:0;
    const currentB=b.currentSale==='예'?1:0;
    return (manufacturerRanks.get(a.manufacturer)??Number.MAX_SAFE_INTEGER)-(manufacturerRanks.get(b.manufacturer)??Number.MAX_SAFE_INTEGER)||currentB-currentA||(b.releaseYear||0)-(a.releaseYear||0)||productLabel(a).localeCompare(productLabel(b),'ko');
  });
}

function imageMarkup(product){
  if(!product)return '<div class="compare-product-empty"><span>제품을 검색해 선택하세요.</span></div>';
  const label=productLabel(product);
  const photo=product.imageSrc?`<img class="compare-product-photo" src="${esc(product.imageSrc)}" alt="${esc(label)}">`:'';
  return `<div class="compare-product-visual ${product.imageSrc?'has-photo':''}">${photo}<div class="compare-product-fallback"><img src="${esc(brandLogoUrl(product.manufacturer))}" alt="${esc(product.manufacturer||'')}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span hidden>${esc(product.manufacturer||'제품 이미지 없음')}</span></div></div>`;
}

function productCard(key){
  const product=state[key];
  if(!product)return `<article class="compare-product-card is-empty">${imageMarkup(null)}<div class="compare-empty-copy"><b>제품 ${key.toUpperCase()}</b><span>${state.type}를 검색해 선택하세요.</span></div></article>`;
  const priceType=product.koreaPriceType||'한국 공식 정가/출고가';
  return `<article class="compare-product-card">${imageMarkup(product)}<div class="compare-product-info"><span>${esc(product.manufacturer||'')} · ${esc(product.mount||'-')}</span><h2>${esc(productLabel(product))}</h2><small>${esc(product.modelCode||product.series||'')}</small><div class="compare-product-price"><em>${esc(priceType)}</em><strong>${esc(money(product.currentPriceKrw))}</strong></div></div></article>`;
}

function specValue(product,key){
  if(!product)return null;
  const direct={
    '제조사':product.manufacturer,'카메라 방식':product.cameraSystem,'마운트':product.mount,
    '센서 포맷':product.sensorFormat,'렌즈 포맷':product.lensFormat,'모델 코드':product.modelCode,
    '출시년도':product.releaseYear,'초점거리':product.focalLength,'최대 조리개':product.maxAperture,
    '무게(g)':product.weightG,'판매 상태':product.koreaSaleStatus||product.saleStatus||product.currentSale,
    '한국 가격':money(product.currentPriceKrw),
  }[key];
  return hasValue(direct)?direct:product.specs?.[key];
}

function comparisonKeys(){
  const base=state.type==='바디'
    ?['제조사','카메라 방식','마운트','센서 포맷','모델 코드','출시년도','유효 화소(MP)','총 화소(MP)','센서 종류','이미지 프로세서','손떨림 보정(IBIS) 여부','AF 방식','AF 위상차 포인트','AF 콘트라스트 포인트','최고 연속촬영 속도(fps)','최고 동영상 해상도','최고 동영상 프레임레이트(fps)','RAW 지원 여부','가로 크기(mm)','세로 크기(mm)','두께(mm)','무게(g)','판매 상태','한국 가격']
    :['제조사','카메라 방식','마운트','렌즈 포맷','모델 코드','출시년도','초점거리','최대 조리개','렌즈 유형','조리개 날 수','최단 촬영 거리(m)','최대 촬영 배율','필터 구경(mm)','손떨림 보정(OSS) 여부','AF 지원 여부','방진방적 여부','길이(mm)','최대 지름(mm)','무게(g)','판매 상태','한국 가격'];
  const extra=new Set();
  for(const product of [state.a,state.b].filter(Boolean)){
    for(const [key,value] of Object.entries(product.specs||{})){
      if(hasValue(value)&&!/(?:usd|미국\s*(?:가격|출시가|판매가|정가|소비자가)|us\s*(?:price|msrp))/i.test(key))extra.add(key);
    }
  }
  return [...base,...[...extra].filter(key=>!base.includes(key))];
}

const displayValue=value=>hasValue(value)?esc(String(value)):'<span class="compare-missing">-</span>';

function renderComparison(){
  $('#compareProducts').innerHTML=productCard('a')+productCard('b');
  document.querySelectorAll('.compare-product-photo').forEach(image=>image.addEventListener('error',()=>{
    image.closest('.compare-product-visual')?.classList.remove('has-photo');
    image.remove();
  },{once:true}));
  if(!state.a&&!state.b){
    $('#compareTable').innerHTML='<div class="compare-table-empty"><strong>비교할 제품을 선택하세요.</strong><span>위 검색창에서 두 제품을 각각 검색할 수 있습니다.</span></div>';
    return;
  }
  const rows=comparisonKeys().filter(key=>hasValue(specValue(state.a,key))||hasValue(specValue(state.b,key)));
  $('#compareTable').innerHTML=`<table class="compare-table"><thead><tr><th>비교 항목</th><th>${esc(state.a?productLabel(state.a):'제품 A')}</th><th>${esc(state.b?productLabel(state.b):'제품 B')}</th></tr></thead><tbody>${rows.map(key=>`<tr><th>${esc(key)}</th><td>${displayValue(specValue(state.a,key))}</td><td>${displayValue(specValue(state.b,key))}</td></tr>`).join('')}</tbody></table>`;
}

function closeResults(key){pickers[key].results.hidden=true;pickers[key].input.setAttribute('aria-expanded','false');}

function showResults(key){
  const picker=pickers[key];
  const query=picker.input.value.trim();
  const matches=typeProducts().filter(product=>!query||matchesSearch(product,query)).slice(0,12);
  picker.results.innerHTML=matches.length?matches.map(product=>`<button type="button" role="option" data-select-product="${esc(product.id)}" data-picker-key="${key}"><span>${esc(product.manufacturer||'')} · ${esc(product.mount||'-')}</span><strong>${esc(productLabel(product))}</strong><small>${esc(product.modelCode||'')} · ${esc(money(product.currentPriceKrw))}</small></button>`).join(''):'<div class="compare-no-result">검색 결과가 없습니다.</div>';
  picker.results.hidden=false;
  picker.input.setAttribute('aria-expanded','true');
}

function selectProduct(key,id){
  const product=products.find(item=>item.id===id&&item.type===state.type);
  if(!product)return;
  state[key]=product;
  pickers[key].input.value=productLabel(product);
  closeResults(key);
  renderComparison();
}

function clearPicker(key){state[key]=null;pickers[key].input.value='';closeResults(key);renderComparison();}

for(const [key,picker] of Object.entries(pickers)){
  picker.input.addEventListener('focus',()=>showResults(key));
  picker.input.addEventListener('input',()=>{
    if(state[key]&&picker.input.value!==productLabel(state[key]))state[key]=null;
    showResults(key);
    renderComparison();
  });
  picker.input.addEventListener('keydown',event=>{
    if(event.key==='Escape')closeResults(key);
    if(event.key==='Enter'){
      const first=picker.results.querySelector('[data-select-product]');
      if(first){event.preventDefault();selectProduct(key,first.dataset.selectProduct);}
    }
  });
}

document.addEventListener('click',event=>{
  const tab=event.target.closest('[data-compare-type]');
  if(tab){
    state.type=tab.dataset.compareType;state.a=null;state.b=null;
    for(const [key,picker] of Object.entries(pickers)){picker.input.value='';closeResults(key);}
    document.querySelectorAll('[data-compare-type]').forEach(button=>{const active=button===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
    renderComparison();return;
  }
  const option=event.target.closest('[data-select-product]');
  if(option){selectProduct(option.dataset.pickerKey,option.dataset.selectProduct);return;}
  const clear=event.target.closest('[data-clear-picker]');
  if(clear){clearPicker(clear.dataset.clearPicker);pickers[clear.dataset.clearPicker].input.focus();return;}
  for(const [key,picker] of Object.entries(pickers))if(!picker.root.contains(event.target))closeResults(key);
});

renderComparison();
