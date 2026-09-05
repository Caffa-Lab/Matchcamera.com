import {loadProducts,loadAdapters,loadBatteries,loadManufacturerOrder,loadFilterOrder,loadFlashes,loadMemoryCards,loadTripods,loadHeads,loadPlates,sortManufacturers,publicManufacturer,findBatteriesForBody,memoryCardCompatibility,supportLoadGrade,money,productLabel,productKey,matchesSearch,brandLogoUrl} from './data.js?v=20260902-performance';
import {checkCompatibility,findMountAdapters} from './compatibility.js?v=20260831-filter-fix';
import {openProductDetail} from './product-detail.js?v=20260831-builder-filter-v4';
const $=s=>document.querySelector(s);const PAGE_SIZE=40;
let catalogLimit=PAGE_SIZE;let catalogKey='';let catalogObserver=null;
const state={products:[],adapters:[],batteries:[],manufacturerOrder:[],filterOrder:null,flashes:[],memoryCards:[],tripods:[],heads:[],plates:[],body:null,lenses:[],memory:null,flash:null,tripod:null,head:null,plate:null,mode:'body',query:'',system:'all',manufacturer:'all',mount:'all',format:'all',lensType:'all',focalRange:'all',sale:'all',compatOnly:true};
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const isSale=p=>p.currentSale==='예'||p.saleStatus==='현재 판매';const keyOf=p=>p?.id||productKey(p);
function toast(m){const el=$('#toast');el.textContent=m;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1700)}
function optionList(v,l){return `<option value="all">${l}</option>`+v.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}
const BODY_FORMAT_ORDER=['풀프레임','크롭센서','중형','기타'];
const LENS_TYPE_ORDER=['줌렌즈','단렌즈'];
const FOCAL_RANGES=[
  {value:'ultra-wide',label:'초광각 · 20mm 이하',min:0,max:20},
  {value:'wide',label:'광각 · 21–35mm',min:21,max:35},
  {value:'standard',label:'표준 · 36–70mm',min:36,max:70},
  {value:'telephoto',label:'망원 · 71–200mm',min:71,max:200},
  {value:'super-telephoto',label:'초망원 · 201mm 이상',min:201,max:Infinity},
];
function bodyFormatGroup(p){
  const value=String(p.sensorFormat||'').trim();
  if(/full\s*frame|풀\s*프레임/i.test(value))return '풀프레임';
  if(/medium|중형|44\s*[×x]\s*33/i.test(value))return '중형';
  if(/aps|four\s*thirds|micro\s*four|super\s*35|\bcx\b|inch/i.test(value))return '크롭센서';
  return '기타';
}
function applyBuilderFilterOrder(){
  const container=$('.catalog-filters');if(!container)return;
  const keyToElement={cameraSystem:$('#systemFilter'),manufacturer:$('#manufacturerFilter'),mount:$('#mountFilter'),sensorFormat:$('#formatFilter'),lensFormat:$('#formatFilter'),lensType:$('#lensTypeFilter'),focalGroup:$('#focalLengthFilter')};
  const order=state.mode==='body'?state.filterOrder?.bodyRows:state.filterOrder?.lensRows;
  for(const key of order||[])if(keyToElement[key])container.append(keyToElement[key]);
  container.append($('#saleFilter'));
}
function lensFocalRange(p){
  const min=Number(p.focalMinMm);
  const max=Number(p.focalMaxMm);
  if(!Number.isFinite(min)||!Number.isFinite(max))return [];
  return FOCAL_RANGES.filter(range=>max>=range.min&&min<=range.max).map(range=>range.value);
}
function productIcon(p){if(p.imageSrc)return `<span class="catalog-thumb" style="background:#fff"><img src="${esc(p.imageSrc)}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;padding:3px" onerror="this.remove()"></span>`;return `<span class="catalog-thumb" style="background:#fff;display:grid;place-items:center;overflow:hidden"><img src="${esc(brandLogoUrl(p.manufacturer))}" alt="${esc(p.manufacturer)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;padding:3px" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><b hidden style="font-size:8px;color:#6c7580">${esc(p.manufacturer)}</b></span>`}

function selectedSlotVisual(p,kind='body'){
  if(!p){
    return `<div class="slot-icon ${kind==='body'?'camera-icon':'lens-icon'}" aria-hidden="true"></div>`;
  }
  const photo=p.imageSrc
    ? `<img class="selected-slot-photo" src="${esc(p.imageSrc)}" alt="${esc(productLabel(p))}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">`
    : '';
  const logoHidden=p.imageSrc?' hidden':'';
  return `<div class="slot-icon selected-product-visual" aria-label="${esc(productLabel(p))}">
    ${photo}
    <img class="selected-slot-brand" src="${esc(brandLogoUrl(p.manufacturer))}" alt="${esc(p.manufacturer)}"${logoHidden} onerror="this.hidden=true;this.nextElementSibling.hidden=false">
    <b class="selected-slot-brand-text"${p.imageSrc?' hidden':''}>${esc(p.manufacturer||'')}</b>
  </div>`;
}

function updateBodyVisual(){
  const visual=$('#bodyVisual');
  if(!visual)return;
  if(!state.body){
    visual.className='slot-icon camera-icon';
    visual.innerHTML='';
    visual.removeAttribute('aria-label');
    return;
  }
  const wrapper=document.createElement('div');
  wrapper.innerHTML=selectedSlotVisual(state.body,'body');
  const replacement=wrapper.firstElementChild;
  replacement.id='bodyVisual';
  visual.replaceWith(replacement);
}

function compatBadge(c){const cls=c.level==='compatible'?'good':c.level==='conditional'?'conditional':c.level==='incompatible'?'bad':'neutral';return `<span class="mini-compat ${cls}">${esc(c.label)}</span>`}
function hydrate(){const q=new URLSearchParams(location.search);const mode=q.get('mode');if(mode==='lens'||mode==='body')state.mode=mode;const bodyKey=q.get('body');const lensKeys=(q.get('lenses')||'').split(',').filter(Boolean);if(bodyKey)state.body=state.products.find(p=>p.id===bodyKey||productKey(p)===bodyKey)||null;state.lenses=lensKeys.map(k=>state.products.find(p=>p.id===k||productKey(p)===k)).filter(Boolean);for(const [key,rows,param] of [['memory',state.memoryCards,'memory'],['flash',state.flashes,'flash'],['plate',state.plates,'plate'],['head',state.heads,'head'],['tripod',state.tripods,'tripod']])state[key]=rows.find(item=>item.id===q.get(param))||null;if(state.body&&!mode&&state.body.cameraSystem!=='일체형 카메라')state.mode='lens'}
function syncUrl(){const q=new URLSearchParams();q.set('mode',state.mode);if(state.body)q.set('body',keyOf(state.body));if(state.lenses.length)q.set('lenses',state.lenses.map(keyOf).join(','));for(const key of ['memory','flash','plate','head','tripod'])if(state[key])q.set(key,state[key].id);history.replaceState(null,'',`${location.pathname}?${q}`)}
function refreshFilters(){const source=state.products.filter(p=>p.type===(state.mode==='body'?'바디':'렌즈'));const systems=[...new Set(source.map(p=>p.cameraSystem).filter(Boolean))].sort((a,b)=>['미러리스','DSLR','일체형 카메라','시네마'].indexOf(a)-['미러리스','DSLR','일체형 카메라','시네마'].indexOf(b));$('#systemFilter').innerHTML=optionList(systems,'모든 카메라 방식');if(!systems.includes(state.system))state.system='all';$('#systemFilter').value=state.system;
let sysSource=source.filter(p=>state.system==='all'||p.cameraSystem===state.system);const brands=sortManufacturers([...new Set(sysSource.map(p=>publicManufacturer(p.manufacturer)).filter(Boolean))],state.manufacturerOrder.map(publicManufacturer));$('#manufacturerFilter').innerHTML=optionList(brands,'모든 제조사');if(!brands.includes(state.manufacturer))state.manufacturer='all';$('#manufacturerFilter').value=state.manufacturer;
let mountSource=sysSource.filter(p=>state.manufacturer==='all'||publicManufacturer(p.manufacturer)===state.manufacturer);if(state.mode==='lens'&&state.body&&state.compatOnly)mountSource=mountSource.filter(p=>checkCompatibility(state.body,p,state.adapters).level!=='incompatible');const mounts=[...new Set(mountSource.map(p=>p.mount).filter(Boolean))].sort();$('#mountFilter').innerHTML=optionList(mounts,state.mode==='body'?'모든 바디 마운트':'모든 렌즈 마운트');if(!mounts.includes(state.mount))state.mount='all';$('#mountFilter').value=state.mount;
const formatSource=mountSource.filter(p=>state.mount==='all'||p.mount===state.mount);const availableBodyFormats=BODY_FORMAT_ORDER.filter(group=>formatSource.some(p=>bodyFormatGroup(p)===group));const formats=state.mode==='body'?availableBodyFormats:[...new Set(formatSource.map(p=>p.lensFormat).filter(Boolean))].sort();if(state.mode==='body'){$('#formatFilter').innerHTML='<option value="all">모든 센서 포맷</option>'+BODY_FORMAT_ORDER.map(group=>`<option value="${group}"${availableBodyFormats.includes(group)?'':' disabled'}>${group}</option>`).join('')}else $('#formatFilter').innerHTML=optionList(formats,'모든 렌즈 포맷');if(!formats.includes(state.format))state.format='all';$('#formatFilter').value=state.format;
const lensMode=state.mode==='lens';document.querySelectorAll('.lens-only-filter').forEach(el=>el.classList.toggle('hidden',!lensMode));const lensFilterSource=formatSource.filter(p=>state.format==='all'||p.lensFormat===state.format);const lensTypes=LENS_TYPE_ORDER.filter(type=>lensFilterSource.some(p=>p.lensType===type)).concat([...new Set(lensFilterSource.map(p=>p.lensType).filter(Boolean))].filter(type=>!LENS_TYPE_ORDER.includes(type)).sort());$('#lensTypeFilter').innerHTML=optionList(lensTypes,'모든 렌즈 유형');if(!lensMode||!lensTypes.includes(state.lensType))state.lensType='all';$('#lensTypeFilter').value=state.lensType;
const focalSource=lensFilterSource.filter(p=>state.lensType==='all'||p.lensType===state.lensType);const focalRanges=FOCAL_RANGES.filter(range=>focalSource.some(p=>lensFocalRange(p).includes(range.value)));$('#focalLengthFilter').innerHTML=`<option value="all">모든 초점거리</option>`+focalRanges.map(range=>`<option value="${range.value}">${range.label}</option>`).join('');if(!lensMode||!focalRanges.some(range=>range.value===state.focalRange))state.focalRange='all';$('#focalLengthFilter').value=state.focalRange;
applyBuilderFilterOrder();$('#catalogMode').value=state.mode;$('#catalogTitle').textContent=state.mode==='body'?'카메라 바디':(state.body?`${state.body.mount||state.body.cameraSystem} 호환 렌즈`:'카메라 렌즈');$('#compatOnlyWrap').classList.toggle('hidden',state.mode!=='lens'||!state.body);$('#compatOnly').checked=state.compatOnly}
function filteredCatalog(){let xs=state.products.filter(p=>p.type===(state.mode==='body'?'바디':'렌즈'));if(state.system!=='all')xs=xs.filter(p=>p.cameraSystem===state.system);if(state.mode==='lens'&&state.body&&state.compatOnly)xs=xs.filter(p=>checkCompatibility(state.body,p,state.adapters).level!=='incompatible');if(state.manufacturer!=='all')xs=xs.filter(p=>publicManufacturer(p.manufacturer)===state.manufacturer);if(state.mount!=='all')xs=xs.filter(p=>p.mount===state.mount);if(state.format!=='all')xs=xs.filter(p=>state.mode==='body'?bodyFormatGroup(p)===state.format:p.lensFormat===state.format);if(state.mode==='lens'&&state.lensType!=='all')xs=xs.filter(p=>p.lensType===state.lensType);if(state.mode==='lens'&&state.focalRange!=='all')xs=xs.filter(p=>lensFocalRange(p).includes(state.focalRange));if(state.sale==='yes')xs=xs.filter(isSale);if(state.query)xs=xs.filter(p=>matchesSearch(p,state.query));const rank=p=>state.mode==='lens'&&state.body?({compatible:0,conditional:1,unknown:2,incompatible:3}[checkCompatibility(state.body,p,state.adapters).level]??4):0;return xs.sort((a,b)=>rank(a)-rank(b)||Number(isSale(b))-Number(isSale(a))||(b.releaseYear||0)-(a.releaseYear||0)||productLabel(a).localeCompare(productLabel(b),'ko'))}
function currentCatalogKey(){return JSON.stringify([state.mode,state.query,state.system,state.manufacturer,state.mount,state.format,state.lensType,state.focalRange,state.sale,state.compatOnly,state.body?.id||''])}
function showMoreCatalog(){catalogLimit+=PAGE_SIZE;renderCatalog()}
function observeCatalogMore(){
  catalogObserver?.disconnect();
  const sentinel=$('[data-catalog-more]');
  if(!sentinel||!('IntersectionObserver' in window))return;
  catalogObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))showMoreCatalog()},{root:$('#catalogList'),rootMargin:'160px 0px'});
  catalogObserver.observe(sentinel);
}
function renderCatalog(){const nextKey=currentCatalogKey();if(nextKey!==catalogKey){catalogKey=nextKey;catalogLimit=PAGE_SIZE}const xs=filteredCatalog();$('#resultCount').textContent=xs.length.toLocaleString();const shown=xs.slice(0,catalogLimit);$('#catalogList').innerHTML=shown.map(p=>{const selected=state.mode==='body'?state.body?.id===p.id:state.lenses.some(x=>x.id===p.id);const c=state.mode==='lens'&&state.body?checkCompatibility(state.body,p,state.adapters):null;const sub=state.mode==='body'?`${p.cameraSystem||'-'} · ${p.sensorFormat||'-'} · ${p.mount||'-'}`:`${p.cameraSystem||'-'} · ${p.mount||'-'} · ${p.focalLength||'-'} ${p.maxAperture?`· ${p.maxAperture}`:''}`;return `<article class="catalog-item ${selected?'selected':''}" data-product-detail="${esc(p.id)}" tabindex="0" aria-label="${esc(productLabel(p))} 제품 상세 보기">${productIcon(p)}<div class="catalog-product"><div class="catalog-product-top"><b>${esc(productLabel(p))}</b>${isSale(p)?'<span class="sale-dot">판매</span>':''}</div><div class="catalog-sub">${esc(sub)}</div><div class="catalog-meta"><span>${esc(p.modelCode||p.series||'')}</span>${c?compatBadge(c):''}</div><div class="catalog-price">${money(p.currentPriceKrw??p.currentPriceUsd)} <small>확인가</small></div></div><button class="catalog-add ${selected?'remove':''}" data-${state.mode==='body'?'body':'lens'}="${esc(p.id)}" type="button">${selected?'선택됨':state.mode==='body'?'선택':'+ 추가'}</button></article>`}).join('')||`<div class="catalog-empty"><b>검색 결과가 없습니다.</b><span>필터를 줄이거나 검색어를 바꿔보세요.</span></div>`;if(xs.length>shown.length)$('#catalogList').insertAdjacentHTML('beforeend',`<button class="catalog-more" data-catalog-more type="button">${shown.length.toLocaleString()} / ${xs.length.toLocaleString()}개 표시 · 더 보기</button>`);requestAnimationFrame(observeCatalogMore)}
function renderBodySlot(){const el=$('#bodySlot');updateBodyVisual();if(!state.body){el.innerHTML=`<button class="empty-slot" data-slot-mode="body" type="button"><b>미선택</b><span>왼쪽 목록에서 바디를 선택하세요.</span></button>`;return}el.innerHTML=`<div class="selected-slot" data-product-detail="${esc(state.body.id)}" tabindex="0"><b>${esc(productLabel(state.body))}</b><span>${esc(state.body.manufacturer)} · ${esc(state.body.cameraSystem||'-')} · ${esc(state.body.sensorFormat||'-')} · ${esc(state.body.mount||'렌즈 고정')}</span></div><button class="slot-remove" data-remove-body type="button" aria-label="바디 제거">×</button>`}
function renderLensSlots(){const el=$('#lensSlots');if(state.body?.cameraSystem==='일체형 카메라'){el.innerHTML=`<div class="build-row lens-row"><div class="slot-icon lens-icon"></div><div class="slot-label"><strong>렌즈</strong><span>교환 불가</span></div><div class="slot-content planned-text">이 카메라는 렌즈 고정형입니다.</div><span class="soon-badge">일체형</span></div>`;return}const chosen=state.lenses.map((p,i)=>{const c=state.body?checkCompatibility(state.body,p,state.adapters):null;return `<div class="build-row lens-row">${selectedSlotVisual(p,'lens')}<div class="slot-label"><strong>렌즈 ${i+1}</strong><span>${c?esc(c.label):'렌즈 구성'}</span></div><div class="slot-content"><div class="selected-slot" data-product-detail="${esc(p.id)}" tabindex="0"><b>${esc(productLabel(p))}</b><span>${esc(p.manufacturer)} · ${esc(p.mount||'-')} · ${esc(p.focalLength||'-')} ${c?compatBadge(c):''}</span></div><button class="slot-remove" data-remove-lens="${esc(p.id)}" type="button">×</button></div><button class="slot-select" data-slot-mode="lens" type="button">렌즈 변경</button></div>`}).join('');const idx=state.lenses.length+1;el.innerHTML=chosen+`<div class="build-row lens-row add-lens-row" data-slot-mode="lens"><div class="slot-icon lens-icon"></div><div class="slot-label"><strong>렌즈 ${idx}</strong><span>복수 렌즈 추가 가능</span></div><div class="slot-content"><button class="empty-slot" data-slot-mode="lens" type="button"><b>미선택</b><span>${state.body?'호환 렌즈를 추가하세요.':'바디 선택 후 렌즈를 추가하세요.'}</span></button></div><button class="slot-select" data-slot-mode="lens" type="button">+ 렌즈 추가</button></div>`}
function renderAdapterSlot(){const el=$('#adapterSlot');if(!state.body||!state.lenses.length){el.textContent='바디와 렌즈를 선택하면 필요한 어댑터를 자동 안내합니다.';return}const needed=[];for(const l of state.lenses){const a=findMountAdapters(state.body,l,state.adapters);if(a.length)needed.push(...a.slice(0,1).map(x=>`${productLabel(l)} → ${x.officialName}`))}el.innerHTML=needed.length?needed.map(x=>`<div style="margin:2px 0"><b style="color:#5960df">${esc(x)}</b></div>`).join(''):'선택한 렌즈는 직접 장착 가능하거나 등록된 어댑터가 없습니다.'}

function renderBatterySlot(){
  const el=$('#batterySlot');
  if(!el)return;
  if(!state.body){
    el.textContent='바디를 선택하면 등록된 배터리를 자동 안내합니다.';
    return;
  }
  const matches=findBatteriesForBody(state.body,state.batteries);
  if(!matches.length){
    el.innerHTML=`<span>등록된 배터리 정보를 찾지 못했습니다. <a href="/accessories/?category=battery">배터리 DB에서 확인</a></span>`;
    return;
  }
  el.innerHTML=matches.slice(0,2).map(x=>
    `<div style="margin:2px 0"><b style="color:#5960df">${esc(x.manufacturer)} ${esc(x.officialName)}</b>${x.note?` <small style="color:#7a8290">· ${esc(x.note)}</small>`:''}</div>`
  ).join('');
}

const accessoryLabel=item=>item?.officialName||item?.id||'';
function accessoryOptions(rows,selected,label='선택 안 함'){
  return `<option value="">${label}</option>`+rows.map(item=>`<option value="${esc(item.id)}" ${selected?.id===item.id?'selected':''}>${esc(item.manufacturer||'')} · ${esc(accessoryLabel(item))}</option>`).join('');
}
function flashCompatibility(flash,body){
  if(!flash||!body)return {level:'unknown',label:'판정 불가',reason:'바디와 플래시를 선택하세요.'};
  const brand=String(body.manufacturer||'').toLowerCase();const system=String(flash.system||'').toLowerCase();const ttl=String(flash.ttlSystem||'').toLowerCase();
  const match=(brand==='sony'&&(system.includes('sony')||ttl.includes('sony')))||(brand==='canon'&&(system.includes('canon')||ttl.includes('canon')))||(brand==='nikon'&&(system.includes('nikon')||ttl.includes('nikon')))||(brand==='fujifilm'&&(system.includes('fujifilm')||ttl.includes('fujifilm')))||((brand==='olympus'||brand==='om system'||brand==='panasonic')&&(system.includes('micro four')||ttl.includes('olympus')||ttl.includes('panasonic')));
  return match?{level:'compatible',label:'TTL 호환',reason:`${flash.ttlSystem||flash.system} 기준으로 호환됩니다.`}:{level:'conditional',label:'수동 사용 확인',reason:'핫슈 장착 여부와 TTL/HSS 기능을 제조사 호환표에서 추가 확인하세요.'};
}
function plateCompatibility(plate,body){
  if(!plate||!body)return {level:'unknown',label:'판정 불가',reason:'바디와 플레이트를 선택하세요.'};
  const models=plate.compatibleModels||[];const hay=`${productLabel(body)} ${body.modelCode||''}`.toLowerCase();
  if(!models.length||plate.plateType==='universal-camera')return {level:'conditional',label:'범용 플레이트',reason:'1/4인치 체결은 가능하나 회전 방지턱·배터리 도어 간섭을 확인하세요.'};
  const match=models.some(model=>hay.includes(String(model).toLowerCase()));return match?{level:'compatible',label:'전용 호환',reason:'등록된 전용 바디 목록과 일치합니다.'}:{level:'incompatible',label:'모델 불일치',reason:'선택한 바디가 전용 호환 목록에 없습니다.'};
}
function heaviestLens(){return [...state.lenses].sort((a,b)=>Number(b.weightG||0)-Number(a.weightG||0))[0]||null;}
function mountedPayloadKg(){
  const lens=heaviestLens();const grams=Number(state.body?.weightG||0)+Number(lens?.weightG||0)+Number(state.flash?.weightG||0)+Number(state.plate?.weightG||0);
  return grams/1000;
}
function stabilityDowngrade(){const lens=heaviestLens();if(!lens)return false;const max=Number(lens.focalMaxMm||String(lens.focalLength||'').match(/(\d+(?:\.\d+)?)\s*mm(?!.*mm)/i)?.[1]||0);const collar=JSON.stringify(lens.specs||{});return max>=300&&!/삼각대 링|tripod collar|collar included|링 포함/i.test(collar);}
function noteClass(level){return level==='compatible'||level==='ample'?'good':level==='incompatible'||level==='impossible'?'bad':'warn';}
function renderAccessorySlots(){
  $('#memorySelect').innerHTML=accessoryOptions(state.memoryCards,state.memory);$('#flashSelect').innerHTML=accessoryOptions(state.flashes,state.flash);$('#plateSelect').innerHTML=accessoryOptions(state.plates,state.plate);$('#headSelect').innerHTML=accessoryOptions(state.heads,state.head);$('#tripodSelect').innerHTML=accessoryOptions(state.tripods,state.tripod);
  const memory=state.memory?memoryCardCompatibility(state.memory,state.body):{level:'unknown',label:'',reason:'바디 선택 후 슬롯 규격과 기록 속도를 검사합니다.'};$('#memoryCompat').className=`accessory-compat-note ${noteClass(memory.level)}`;$('#memoryCompat').textContent=state.memory?`${memory.label} · ${memory.reason}`:memory.reason;
  const flash=state.flash?flashCompatibility(state.flash,state.body):{level:'unknown',reason:'바디를 선택하면 TTL/HSS 시스템을 검사합니다.'};$('#flashCompat').className=`accessory-compat-note ${noteClass(flash.level)}`;$('#flashCompat').textContent=state.flash?`${flash.label} · ${flash.reason}`:flash.reason;
  const plate=state.plate?plateCompatibility(state.plate,state.body):{level:'unknown',reason:'전용/범용 플레이트와 바디 간섭 여부를 검사합니다.'};$('#plateCompat').className=`accessory-compat-note ${noteClass(plate.level)}`;$('#plateCompat').textContent=state.plate?`${plate.label} · ${plate.reason}`:plate.reason;
  const payload=mountedPayloadKg();const downgrade=stabilityDowngrade();
  const headGrade=state.head&&state.body?supportLoadGrade(state.head.maxLoadKg,payload,{downgrade}):null;$('#headLoad').className=`accessory-compat-note ${headGrade?noteClass(headGrade.level):''}`;$('#headLoad').innerHTML=headGrade?`<span class="load-grade ${headGrade.level}">${headGrade.label}</span> · ${esc(headGrade.reason)}`:'바디 + 가장 무거운 렌즈 + 플래시 + 플레이트 하중을 검사합니다.';
  const tripodPayload=payload+Number(state.head?.weightKg||0);const tripodGrade=state.tripod&&state.body?supportLoadGrade(state.tripod.maxLoadKg,tripodPayload,{downgrade}):null;$('#tripodLoad').className=`accessory-compat-note ${tripodGrade?noteClass(tripodGrade.level):''}`;$('#tripodLoad').innerHTML=tripodGrade?`<span class="load-grade ${tripodGrade.level}">${tripodGrade.label}</span> · ${esc(tripodGrade.reason)}`:'삼각대 다리는 선택한 헤드 무게까지 더해 검사합니다.';
}

function renderSummary(){
  const priceItems=[
    ...(state.body?[{label:'바디',product:state.body}]:[]),
    ...state.lenses.map((product,index)=>({label:`렌즈 ${index+1}`,product})),
    ...(state.memory?[{label:'메모리 카드',product:state.memory}]:[]),
    ...(state.flash?[{label:'플래시',product:state.flash}]:[]),
    ...(state.plate?[{label:'플레이트',product:state.plate}]:[]),
    ...(state.head?[{label:'볼헤드',product:state.head}]:[]),
    ...(state.tripod?[{label:'삼각대 다리',product:state.tripod}]:[])
  ];
  const items=priceItems.map(item=>item.product);
  const priceOf=product=>{
    const price=Number(product.currentPriceKrw);
    return Number.isFinite(price)&&price>0?price:null;
  };
  const priced=priceItems.filter(item=>priceOf(item.product)!==null);
  const total=priced.reduce((sum,item)=>sum+priceOf(item.product),0);
  const weightOf=product=>Number.isFinite(Number(product.weightG))?Number(product.weightG):Number.isFinite(Number(product.weightKg))?Number(product.weightKg)*1000:null;
  const weighted=items.filter(product=>weightOf(product)!==null);
  const weight=weighted.reduce((sum,product)=>sum+weightOf(product),0);

  $('#priceBreakdown').innerHTML=priceItems.length
    ? priceItems.map(({label,product})=>{
      const price=priceOf(product);
      return `<div class="price-breakdown-row${price===null?' is-missing':''}"><span class="price-breakdown-label">${esc(label)}</span><b title="${esc(accessoryLabel(product))}">${esc(accessoryLabel(product))}</b><strong>${price===null?'가격 미확인':money(price)}</strong></div>`;
    }).join('')
    : '<div class="price-breakdown-empty">제품을 선택하면 개별 가격이 표시됩니다.</div>';
  $('#totalPrice').textContent=priced.length?money(total):'-';
  $('#pricedCount').textContent=`${priced.length} / ${items.length}`;
  $('#priceNote').textContent=items.length&&priced.length!==items.length?'가격 미확인 제품은 합계에서 제외했습니다.':'확인된 국내 가격만 합산합니다.';
  $('#itemCount').textContent=`${items.length}개`;
  $('#totalWeight').textContent=weighted.length?`${weight.toLocaleString()} g${weighted.length!==items.length?' +':''}`:'-';
  $('#summaryMount').textContent=state.body?.mount||'-';
  $('#summarySensor').textContent=state.body?.sensorFormat||'-';

  const results=state.body?state.lenses.map(product=>({name:productLabel(product),c:checkCompatibility(state.body,product,state.adapters)})):[];
  if(state.memory)results.push({name:`메모리 · ${accessoryLabel(state.memory)}`,c:memoryCardCompatibility(state.memory,state.body)});
  if(state.flash)results.push({name:`플래시 · ${accessoryLabel(state.flash)}`,c:flashCompatibility(state.flash,state.body)});
  if(state.plate)results.push({name:`플레이트 · ${accessoryLabel(state.plate)}`,c:plateCompatibility(state.plate,state.body)});
  const payload=mountedPayloadKg();const downgrade=stabilityDowngrade();
  if(state.head)results.push({name:`볼헤드 · ${accessoryLabel(state.head)}`,c:state.body?supportLoadGrade(state.head.maxLoadKg,payload,{downgrade}):{level:'unknown',label:'판정 불가',reason:'바디를 먼저 선택하세요.'}});
  if(state.tripod)results.push({name:`삼각대 · ${accessoryLabel(state.tripod)}`,c:state.body?supportLoadGrade(state.tripod.maxLoadKg,payload+Number(state.head?.weightKg||0),{downgrade}):{level:'unknown',label:'판정 불가',reason:'바디를 먼저 선택하세요.'}});
  if(state.plate&&state.head){const ok=String(state.plate.standard||'').toLowerCase()===String(state.head.plateStandard||'').toLowerCase();results.push({name:'플레이트 ↔ 볼헤드',c:{level:ok?'compatible':'incompatible',label:ok?'규격 일치':'규격 불일치',reason:ok?`${state.plate.standard} 규격이 일치합니다.`:`${state.plate.standard||'플레이트'}와 ${state.head.plateStandard||'헤드'} 규격이 다릅니다.`}});}
  if(state.head&&state.tripod){const ok=String(state.head.tripodMount||'').toLowerCase()===String(state.tripod.headMount||'').toLowerCase();results.push({name:'볼헤드 ↔ 삼각대 다리',c:{level:ok?'compatible':'conditional',label:ok?'나사 규격 일치':'어댑터 확인',reason:ok?`${state.head.tripodMount} 체결 규격이 일치합니다.`:`${state.head.tripodMount||'헤드'}와 ${state.tripod.headMount||'삼각대'} 체결 규격을 확인하세요.`}});}
  if(!results.length){
    $('#compatOverall').className='compat-pill neutral';$('#compatOverall').textContent=state.body?.cameraSystem==='일체형 카메라'?'렌즈 고정형':'선택 필요';$('#compatDetails').innerHTML='<p class="empty-summary">제품과 액세서리를 선택하면 항목별 호환성을 확인합니다.</p>';return;
  }
  const severity={impossible:5,incompatible:5,danger:4,conditional:3,unknown:2,normal:1,compatible:0,ample:0};
  const worst=[...results].sort((a,b)=>(severity[b.c.level]??2)-(severity[a.c.level]??2))[0];const bad=(severity[worst.c.level]??2)>=4;const conditional=(severity[worst.c.level]??2)>=2;
  $('#compatOverall').className=`compat-pill ${bad?'bad':conditional?'conditional':'good'}`;$('#compatOverall').textContent=bad?worst.c.label:conditional?'조건 확인':'호환 정상';
  $('#compatDetails').innerHTML=results.map(({name,c})=>{const mapped={...c,level:['ample','normal'].includes(c.level)?'compatible':c.level==='danger'||c.level==='impossible'?'incompatible':c.level};return `<div class="compat-detail-row"><div><b>${esc(name)}</b><span>${esc(c.reason)}</span></div>${compatBadge(mapped)}</div>`;}).join('');
}
function render(){refreshFilters();renderCatalog();renderBodySlot();renderLensSlots();renderAdapterSlot();renderBatterySlot();renderAccessorySlots();renderSummary();syncUrl()}
function switchMode(mode){if(mode==='lens'&&state.body?.cameraSystem==='일체형 카메라'){toast('일체형 카메라는 교환 렌즈가 없습니다.');return}state.mode=mode;state.system='all';state.manufacturer='all';state.mount='all';state.format='all';state.lensType='all';state.focalRange='all';state.query='';$('#search').value='';render()}
function selectBody(id){const p=state.products.find(x=>x.id===id);if(!p)return;state.body=p;state.lenses=[];state.system='all';state.manufacturer='all';state.mount='all';state.format='all';state.lensType='all';state.focalRange='all';state.query='';$('#search').value='';if(p.cameraSystem==='일체형 카메라'){state.mode='body';render();toast(`${productLabel(p)}은(는) 렌즈 고정형입니다.`);return}state.mode='lens';render();toast(`${productLabel(p)} 기준으로 직접/어댑터 호환 렌즈를 표시합니다.`)}
function toggleLens(id){const p=state.products.find(x=>x.id===id);if(!p)return;if(state.lenses.some(x=>x.id===p.id))state.lenses=state.lenses.filter(x=>x.id!==p.id);else state.lenses=[...state.lenses,p];render()}
async function initializeBuilder(){
  try{
    [state.products,state.adapters,state.batteries,state.manufacturerOrder,state.filterOrder,state.flashes,state.memoryCards,state.tripods,state.heads,state.plates]=await Promise.all([loadProducts(),loadAdapters(),loadBatteries(),loadManufacturerOrder(),loadFilterOrder(),loadFlashes(),loadMemoryCards(),loadTripods(),loadHeads(),loadPlates()]);
    hydrate();
    render();
  }catch(error){
    console.error('견적 제품 데이터를 불러오지 못했습니다.',error);
    $('#resultCount').textContent='0';
    $('#catalogList').innerHTML='<div class="catalog-empty"><b>제품 정보를 불러오지 못했습니다.</b><span>페이지를 새로고침해 주세요. 계속되면 잠시 후 다시 시도해 주세요.</span></div>';
    for(const id of ['systemFilter','manufacturerFilter','mountFilter','formatFilter','lensTypeFilter','focalLengthFilter','saleFilter']) $("#"+id).disabled=true;
    toast('제품 정보를 불러오지 못했습니다.');
  }
}
await initializeBuilder();
$('#catalogMode').addEventListener('change',e=>switchMode(e.target.value));$('#search').addEventListener('input',e=>{state.query=e.target.value.trim();renderCatalog()});$('#clearSearch').addEventListener('click',()=>{state.query='';$('#search').value='';renderCatalog()});$('#systemFilter').addEventListener('change',e=>{state.system=e.target.value;state.manufacturer='all';state.mount='all';state.format='all';state.lensType='all';state.focalRange='all';render()});$('#manufacturerFilter').addEventListener('change',e=>{state.manufacturer=e.target.value;state.mount='all';state.format='all';state.lensType='all';state.focalRange='all';render()});$('#mountFilter').addEventListener('change',e=>{state.mount=e.target.value;state.format='all';state.lensType='all';state.focalRange='all';render()});$('#formatFilter').addEventListener('change',e=>{state.format=e.target.value;state.lensType='all';state.focalRange='all';render()});$('#lensTypeFilter').addEventListener('change',e=>{state.lensType=e.target.value;state.focalRange='all';render()});$('#focalLengthFilter').addEventListener('change',e=>{state.focalRange=e.target.value;render()});$('#saleFilter').addEventListener('change',e=>{state.sale=e.target.value;renderCatalog()});$('#compatOnly').addEventListener('change',e=>{state.compatOnly=e.target.checked;state.mount='all';state.format='all';state.lensType='all';state.focalRange='all';render()});
for(const [selector,key,rows] of [['#memorySelect','memory','memoryCards'],['#flashSelect','flash','flashes'],['#plateSelect','plate','plates'],['#headSelect','head','heads'],['#tripodSelect','tripod','tripods']])$(selector).addEventListener('change',e=>{state[key]=state[rows].find(item=>item.id===e.target.value)||null;render()});
function showProductDetail(id){openProductDetail(state.products.find(product=>product.id===id))}
document.addEventListener('click',e=>{if(e.target.closest('[data-catalog-more]')){showMoreCatalog();return}const b=e.target.closest('[data-body]');if(b){selectBody(b.dataset.body);return}const l=e.target.closest('[data-lens]');if(l){toggleLens(l.dataset.lens);return}if(e.target.closest('[data-remove-body]')){state.body=null;state.lenses=[];state.mode='body';render();return}const rl=e.target.closest('[data-remove-lens]');if(rl){state.lenses=state.lenses.filter(x=>x.id!==rl.dataset.removeLens);render();return}const detail=e.target.closest('[data-product-detail]');if(detail){showProductDetail(detail.dataset.productDetail);return}const slot=e.target.closest('[data-slot-mode]');if(slot){switchMode(slot.dataset.slotMode);document.querySelector('.catalog-pane')?.scrollIntoView({behavior:'smooth',block:'start'})}});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-product-detail]')){e.preventDefault();showProductDetail(e.target.dataset.productDetail)}});
$('#resetBtn').addEventListener('click',()=>{state.body=null;state.lenses=[];state.memory=null;state.flash=null;state.plate=null;state.head=null;state.tripod=null;state.mode='body';state.query='';state.system='all';state.manufacturer='all';state.mount='all';state.format='all';state.lensType='all';state.focalRange='all';state.sale='all';$('#search').value='';render();toast('구성을 초기화했습니다.')});$('#shareBtn').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('공유 링크를 복사했습니다.')}catch{toast('주소창의 URL을 복사해 주세요.')}});
