import {loadAdapters,loadBatteries,loadFlashes,loadMemoryCards,loadTripods,loadHeads,loadPlates,loadManufacturerOrder,sortManufacturers,matchesSearch,money} from './data.js?v=20260901-accessories';
import {SUPPORT_KINDS,HEAD_TYPES,supportSort,tripodHeadCompatibility,plateHeadCompatibility,supportHead} from './support-compatibility.js?v=20260911';

const $=s=>document.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={adapters:[],batteries:[],flashes:[],memoryCards:[],tripods:[],heads:[],plates:[],manufacturerOrder:[],adapterQ:'',adapterBrand:'all',from:'all',to:'all',batteryQ:'',batteryBrand:'all',batterySale:'all',memoryQ:'',flashQ:'',plateLimit:48};
const options=(values,label)=>`<option value="all">${label}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');

function showCategory(category){
  $('#supportChecker').classList.toggle('hidden',!['tripod','head','plate'].includes(category));
  document.querySelectorAll('[data-accessory-category]').forEach(button=>button.classList.toggle('active',button.dataset.accessoryCategory===category));
  document.querySelectorAll('[data-accessory-panel]').forEach(panel=>panel.classList.toggle('hidden',panel.dataset.accessoryPanel!==category));
  const url=new URL(location.href);if(category==='adapter')url.searchParams.delete('category');else url.searchParams.set('category',category);history.replaceState(null,'',url);
}

function setup(){
  const adapterBrands=sortManufacturers([...new Set(state.adapters.map(item=>item.manufacturer).filter(Boolean))],state.manufacturerOrder);
  $('#adapterBrand').innerHTML=options(adapterBrands,'모든 제조사');
  $('#adapterFrom').innerHTML=options([...new Set(state.adapters.map(item=>item.fromMount).filter(Boolean))].sort(),'모든 렌즈측 마운트');
  $('#adapterTo').innerHTML=options([...new Set(state.adapters.map(item=>item.toMount).filter(Boolean))].sort(),'모든 바디측 마운트');
  $('#batteryBrand').innerHTML=options(sortManufacturers([...new Set(state.batteries.map(item=>item.manufacturer).filter(Boolean))],state.manufacturerOrder),'모든 제조사');
}

function accessoryPhoto(item){return item.imageSrc?`<img class="accessory-product-photo" src="${esc(item.imageSrc)}" alt="${esc(item.officialName||item.id)}" loading="lazy" decoding="async" onerror="this.hidden=true">${item.imageNote?`<p class="accessory-image-note">${esc(item.imageNote)}</p>`:''}`:'';}

function renderAdapters(){
  const q=state.adapterQ.toLowerCase();const list=state.adapters.filter(item=>(!q||matchesSearch(item,q))&&(state.adapterBrand==='all'||item.manufacturer===state.adapterBrand)&&(state.from==='all'||item.fromMount===state.from)&&(state.to==='all'||item.toMount===state.to));
  $('#adapterCount').textContent=list.length.toLocaleString();
  $('#adapterList').innerHTML=list.map(item=>`<article class="adapter-card"><div>${accessoryPhoto(item)}<h2>${esc(item.officialName)}</h2><p>${esc(item.manufacturer)}${item.note?` · ${esc(item.note)}`:''}</p></div><div class="adapter-flow"><span>렌즈 측</span><strong>${esc(item.fromMount)}</strong></div><div class="adapter-flow"><span>바디 측</span><strong>${esc(item.toMount)}</strong></div><div class="adapter-tags"><span>AF ${esc(item.afSupport||'확인 필요')}</span><span>조리개 ${esc(item.apertureControl||'확인 필요')}</span><span>EXIF ${esc(item.exifSupport||'확인 필요')}</span>${item.focalReducer==='예'?'<span>포컬리듀서</span>':''}</div></article>`).join('')||'<div class="empty">조건에 맞는 어댑터가 없습니다.</div>';
}

function renderBatteries(){
  const q=state.batteryQ.toLowerCase();const list=state.batteries.filter(item=>(!q||matchesSearch(item,q))&&(state.batteryBrand==='all'||item.manufacturer===state.batteryBrand)&&(state.batterySale==='all'||item.currentSale===state.batterySale));
  $('#batteryCount').textContent=list.length.toLocaleString();
  $('#batteryList').innerHTML=list.map(item=>{const names=item.compatibleNames||[];const visual=item.imageSrc?`<div class="battery-visual"><img src="${esc(item.imageSrc)}" alt="${esc(item.officialName)}" loading="lazy"><div class="battery-brand-fallback" hidden>${esc(item.manufacturer)}</div></div>`:`<div class="battery-visual"><div class="battery-brand-fallback">${esc(item.manufacturer)}</div></div>`;return `<article class="battery-card">${visual}<div class="battery-main"><div class="battery-brand">${esc(item.manufacturer)}</div><h2>${esc(item.officialName)}</h2><p>${esc(item.note||'')}</p><div class="battery-specs">${[item.capacityMah?`${item.capacityMah}mAh`:'',item.voltageV?`${item.voltageV}V`:'',item.weightG?`${item.weightG}g`:''].filter(Boolean).map(value=>`<span>${esc(value)}</span>`).join('')}</div></div><div class="battery-compat"><span class="battery-label">호환 바디</span><div class="battery-tags">${names.slice(0,8).map(name=>`<span>${esc(name)}</span>`).join('')}${names.length>8?`<span>+${names.length-8}개</span>`:''}</div></div><div class="battery-meta"><span>${esc(item.currentSale||'확인 필요')}</span><strong>${money(item.currentPriceKrw)}</strong></div></article>`;}).join('')||'<div class="empty">조건에 맞는 배터리가 없습니다.</div>';
}

function dataCard(item,rows){const category=state.memoryCards.includes(item)?'memory':state.plates.includes(item)?'plate':state.flashes.includes(item)?'flash':state.tripods.includes(item)?'tripod':'head';rows=[...rows,...(rows.some(([key])=>key==='한국 가격')?[]:[['한국 가격',money(item.currentPriceKrw)],['가격 기준',item.koreaPriceStatus||item.priceType],['확인일',item.priceDate||item.verifiedAt]])];return `<article class="accessory-data-card">${accessoryPhoto(item)}<small>${esc(item.manufacturer||'')}</small><h2>${esc(item.officialName||item.id)}</h2><dl>${rows.filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${item.officialSource?`<a href="${esc(item.officialSource)}" target="_blank" rel="noopener">자료 출처 ↗</a>`:''}${item.priceSource&&item.priceSource!==item.officialSource?`<a href="${esc(item.priceSource)}" target="_blank" rel="noopener">가격 출처 ↗</a>`:''}<a href="/compare/?category=${category}&a=${encodeURIComponent(item.id)}">비교하기 →</a>${['memory','plate','flash'].includes(category)?`<a href="/builder/?${category}=${encodeURIComponent(item.id)}">견적에 담기 →</a>`:''}</article>`;}
function renderData(){
  const memories=state.memoryCards.filter(item=>(!state.memoryQ||matchesSearch(item,state.memoryQ))&&($('#memoryBrand').value==='all'||item.manufacturer===$('#memoryBrand').value)&&($('#memoryType').value==='all'||($('#memoryType').value==='SD'?item.cardType.startsWith('SD'):item.cardType===$('#memoryType').value))); $('#memoryCount').textContent=memories.length;$('#memoryList').innerHTML=memories.map(item=>dataCard(item,[['규격',item.cardType],['버스',item.bus],['속도 등급',item.speedClass],['용량',item.capacityGb?`${item.capacityGb}GB`:null],['최대 읽기',item.readMbps?`${item.readMbps}MB/s`:null],['최대 쓰기',item.writeMbps?`${item.writeMbps}MB/s`:null],['사양 기준',item.specificationNote]])).join('');
  const flashes=state.flashes.filter(item=>!state.flashQ||matchesSearch(item,state.flashQ));$('#flashCount').textContent=flashes.length;$('#flashList').innerHTML=flashes.map(item=>dataCard(item,[['시스템',item.system],['TTL',item.ttlSystem],['가이드 넘버',item.guideNumber],['HSS',item.hss?'지원':'확인 필요'],['무선',item.wireless],['무게',item.weightG?`${item.weightG}g`:null]])).join('');
  renderSupports();
  const plates=state.plates.filter(item=>matchesSearch(item,$('#plateSearch').value)&&($('#plateBrand').value==='all'||item.manufacturer===$('#plateBrand').value));$('#plateCount').textContent=plates.length;$('#plateList').innerHTML=plates.slice(0,state.plateLimit).map(item=>dataCard(item,[['종류',({'universal-camera':'범용 카메라 플레이트','dedicated-l-bracket':'전용 L 브래킷','camera-plate':'카메라 플레이트','lens-plate':'렌즈 플레이트','l-bracket':'L 브래킷'})[item.plateType]||item.plateType],['규격',item.standard],['카메라 체결',item.cameraMount],['무게',item.weightG?`${item.weightG}g`:null],['판매 상태',item.currentSale||'확인 필요']])).join('');
  $('#plateMore').hidden=plates.length<=state.plateLimit;
}

const mountLabel=value=>value?.startsWith('bowl-')?`${value.slice(5)}mm 볼`:value||'미확인';
function supportCard(item){
 const tripod=Boolean(item.kind);
 const rows=[['구성',tripod?SUPPORT_KINDS[item.kind]:'헤드 단품'],['종류',HEAD_TYPES[item.headType||item.includedHead?.headType]],['포함 헤드',item.includedHead?.officialName],['허용 하중',item.maxLoadKg?`${item.maxLoadKg}kg`:'미확인'],['무게',item.weightKg?`${item.weightKg}kg`:'미확인'],['최대 높이',item.maxHeightMm?`${item.maxHeightMm}mm`:null],['접은 길이',item.foldedLengthMm?`${item.foldedLengthMm}mm`:null],['다리↔헤드',mountLabel(tripod?item.headMount:item.tripodMount)],['플레이트',item.plateStandard||item.includedHead?.plateStandard],['한국 가격',money(item.currentPriceKrw)],['가격 기준',item.koreaPriceStatus],['확인일',item.verifiedAt],['참고',item.note]];
 const card=dataCard(item,rows);
 return card.replace('</article>',`<a href="/builder/?${tripod?'tripod':'head'}=${encodeURIComponent(item.id)}">견적에 담기 →</a></article>`);
}
function renderSupports(){
 for(const [key,rows] of [['tripod',state.tripods],['head',state.heads]]){
  const q=$(`#${key}Search`).value.trim().toLowerCase(),brand=$(`#${key}Brand`).value;
  const type=$(key==='tripod'?'#tripodKind':'#headType').value;
  const selected=rows.filter(r=>(!q||matchesSearch(r,q))&&(brand==='all'||r.manufacturer===brand)&&(type==='all'||(key==='tripod'?r.kind:r.headType)===type));
  $(`#${key}Count`).textContent=selected.length;
  $(`#${key}List`).innerHTML=selected.map(supportCard).join('')||'<p class="empty">조건에 맞는 제품이 없습니다.</p>';
 }
}
function renderSupportCheck(){
 const tripod=state.tripods.find(r=>r.id===$('#checkTripod').value);
 const head=state.heads.find(r=>r.id===$('#checkHead').value);
 const plate=state.plates.find(r=>r.id===$('#checkPlate').value);
 const checks=[];
 if(tripod?.includedHead&&!head)checks.push({label:'포함 헤드 사용',reason:tripod.includedHead.officialName+' · 별도 헤드를 추가하지 않아도 됩니다.'});
 else checks.push(tripodHeadCompatibility(tripod,head));
 if(plate)checks.push(plateHeadCompatibility(plate,supportHead(tripod,head)));
 $('#supportResult').innerHTML=checks.map(r=>`<p><strong>${esc(r.label)}</strong> · ${esc(r.reason)}</p>`).join('');
}
function setupSupports(){
 state.tripods=supportSort(state.tripods);state.heads=supportSort(state.heads);
 for(const [key,rows] of [['tripod',state.tripods],['head',state.heads]]){
  $(`#${key}Brand`).innerHTML=options([...new Set(rows.map(r=>r.manufacturer))],'모든 브랜드');
  $(`#${key}Search`).addEventListener('input',renderSupports);$(`#${key}Brand`).addEventListener('change',renderSupports);
 }
 $('#tripodKind').addEventListener('change',renderSupports);$('#headType').addEventListener('change',renderSupports);
 for(const [id,rows,label] of [['#checkTripod',state.tripods,'삼각대 선택'],['#checkHead',state.heads,'별도 헤드 없음 / 세트 포함 헤드'],['#checkPlate',state.plates,'플레이트 선택']]){
  $(id).innerHTML=`<option value="">${label}</option>`+rows.map(r=>`<option value="${esc(r.id)}">${esc(r.manufacturer)} · ${esc(r.officialName)}</option>`).join('');
  $(id).addEventListener('change',renderSupportCheck);
 }
 renderSupportCheck();
}

[state.adapters,state.batteries,state.flashes,state.memoryCards,state.tripods,state.heads,state.plates,state.manufacturerOrder]=await Promise.all([loadAdapters(),loadBatteries(),loadFlashes(),loadMemoryCards(),loadTripods(),loadHeads(),loadPlates(),loadManufacturerOrder()]);
for(const [key,rows] of [['memory',state.memoryCards],['plate',state.plates]]){ $(`#${key}Brand`).innerHTML=options(sortManufacturers([...new Set(rows.map(r=>r.manufacturer))],state.manufacturerOrder),'모든 브랜드');$(`#${key}Brand`).addEventListener('change',renderData); }
$('#plateSearch').addEventListener('input',()=>{state.plateLimit=48;renderData();});$('#plateMore').addEventListener('click',()=>{state.plateLimit+=48;renderData();});$('#memoryType').addEventListener('change',renderData);
for(const panel of document.querySelectorAll('[data-accessory-panel]')){const category=panel.dataset.accessoryPanel;if(category!=='care')panel.insertAdjacentHTML('afterbegin',`<p><a href="/compare/?category=${category}">이 종류 제품 비교 →</a></p>`);}
setup();setupSupports();renderAdapters();renderBatteries();renderData();
const requested=new URLSearchParams(location.search).get('category');showCategory(['adapter','memory','battery','flash','tripod','head','plate','care'].includes(requested)?requested:'adapter');
document.addEventListener('click',event=>{const button=event.target.closest('[data-accessory-category]');if(button)showCategory(button.dataset.accessoryCategory);});
$('#adapterSearch').addEventListener('input',event=>{state.adapterQ=event.target.value;renderAdapters();});$('#adapterBrand').addEventListener('change',event=>{state.adapterBrand=event.target.value;renderAdapters();});$('#adapterFrom').addEventListener('change',event=>{state.from=event.target.value;renderAdapters();});$('#adapterTo').addEventListener('change',event=>{state.to=event.target.value;renderAdapters();});
$('#batterySearch').addEventListener('input',event=>{state.batteryQ=event.target.value;renderBatteries();});$('#batteryBrand').addEventListener('change',event=>{state.batteryBrand=event.target.value;renderBatteries();});$('#batterySale').addEventListener('change',event=>{state.batterySale=event.target.value;renderBatteries();});$('#memorySearch').addEventListener('input',event=>{state.memoryQ=event.target.value;renderData();});$('#flashSearch').addEventListener('input',event=>{state.flashQ=event.target.value;renderData();});
