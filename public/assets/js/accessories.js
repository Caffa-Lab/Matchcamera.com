import {loadAdapters,loadBatteries,loadFlashes,loadMemoryCards,loadTripods,loadHeads,loadPlates,loadManufacturerOrder,sortManufacturers,money} from './data.js?v=20260901-accessories';

const $=s=>document.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={adapters:[],batteries:[],flashes:[],memoryCards:[],tripods:[],heads:[],plates:[],manufacturerOrder:[],adapterQ:'',adapterBrand:'all',from:'all',to:'all',batteryQ:'',batteryBrand:'all',batterySale:'all',memoryQ:'',flashQ:''};
const options=(values,label)=>`<option value="all">${label}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
const hay=(row)=>JSON.stringify(row).toLowerCase();

function showCategory(category){
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

function renderAdapters(){
  const q=state.adapterQ.toLowerCase();const list=state.adapters.filter(item=>(!q||hay(item).includes(q))&&(state.adapterBrand==='all'||item.manufacturer===state.adapterBrand)&&(state.from==='all'||item.fromMount===state.from)&&(state.to==='all'||item.toMount===state.to));
  $('#adapterCount').textContent=list.length.toLocaleString();
  $('#adapterList').innerHTML=list.map(item=>`<article class="adapter-card"><div><h2>${esc(item.officialName)}</h2><p>${esc(item.manufacturer)}${item.note?` · ${esc(item.note)}`:''}</p></div><div class="adapter-flow"><span>렌즈 측</span><strong>${esc(item.fromMount)}</strong></div><div class="adapter-flow"><span>바디 측</span><strong>${esc(item.toMount)}</strong></div><div class="adapter-tags"><span>AF ${esc(item.afSupport||'확인 필요')}</span><span>조리개 ${esc(item.apertureControl||'확인 필요')}</span><span>EXIF ${esc(item.exifSupport||'확인 필요')}</span>${item.focalReducer==='예'?'<span>포컬리듀서</span>':''}</div></article>`).join('')||'<div class="empty">조건에 맞는 어댑터가 없습니다.</div>';
}

function renderBatteries(){
  const q=state.batteryQ.toLowerCase();const list=state.batteries.filter(item=>(!q||hay(item).includes(q))&&(state.batteryBrand==='all'||item.manufacturer===state.batteryBrand)&&(state.batterySale==='all'||item.currentSale===state.batterySale));
  $('#batteryCount').textContent=list.length.toLocaleString();
  $('#batteryList').innerHTML=list.map(item=>{const names=item.compatibleNames||[];const visual=item.imageSrc?`<div class="battery-visual"><img src="${esc(item.imageSrc)}" alt="${esc(item.officialName)}" loading="lazy"><div class="battery-brand-fallback" hidden>${esc(item.manufacturer)}</div></div>`:`<div class="battery-visual"><div class="battery-brand-fallback">${esc(item.manufacturer)}</div></div>`;return `<article class="battery-card">${visual}<div class="battery-main"><div class="battery-brand">${esc(item.manufacturer)}</div><h2>${esc(item.officialName)}</h2><p>${esc(item.note||'')}</p><div class="battery-specs">${[item.capacityMah?`${item.capacityMah}mAh`:'',item.voltageV?`${item.voltageV}V`:'',item.weightG?`${item.weightG}g`:''].filter(Boolean).map(value=>`<span>${esc(value)}</span>`).join('')}</div></div><div class="battery-compat"><span class="battery-label">호환 바디</span><div class="battery-tags">${names.slice(0,8).map(name=>`<span>${esc(name)}</span>`).join('')}${names.length>8?`<span>+${names.length-8}개</span>`:''}</div></div><div class="battery-meta"><span>${esc(item.currentSale||'확인 필요')}</span><strong>${money(item.currentPriceKrw)}</strong></div></article>`;}).join('')||'<div class="empty">조건에 맞는 배터리가 없습니다.</div>';
}

function dataCard(item,rows){return `<article class="accessory-data-card"><small>${esc(item.manufacturer||'')}</small><h2>${esc(item.officialName||item.id)}</h2><dl>${rows.filter(([,value])=>value!==null&&value!==undefined&&value!=='').map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>${item.officialSource?`<a href="${esc(item.officialSource)}" target="_blank" rel="noopener">공식 정보 ↗</a>`:''}</article>`;}
function renderData(){
  const memories=state.memoryCards.filter(item=>!state.memoryQ||hay(item).includes(state.memoryQ.toLowerCase()));$('#memoryCount').textContent=memories.length;$('#memoryList').innerHTML=memories.map(item=>dataCard(item,[['규격',item.cardType],['버스',item.bus],['속도 등급',item.speedClass],['용량',item.capacityGb?`${item.capacityGb}GB`:null],['읽기',item.readMbps?`${item.readMbps}MB/s`:null],['쓰기',item.writeMbps?`${item.writeMbps}MB/s`:null]])).join('');
  const flashes=state.flashes.filter(item=>!state.flashQ||hay(item).includes(state.flashQ.toLowerCase()));$('#flashCount').textContent=flashes.length;$('#flashList').innerHTML=flashes.map(item=>dataCard(item,[['시스템',item.system],['TTL',item.ttlSystem],['가이드 넘버',item.guideNumber],['HSS',item.hss?'지원':'확인 필요'],['무선',item.wireless],['무게',item.weightG?`${item.weightG}g`:null]])).join('');
  $('#tripodCount').textContent=state.tripods.length;$('#tripodList').innerHTML=state.tripods.map(item=>dataCard(item,[['허용 하중',item.maxLoadKg?`${item.maxLoadKg}kg`:null],['자체 무게',item.weightKg?`${item.weightKg}kg`:null],['최대 높이',item.maxHeightMm?`${item.maxHeightMm}mm`:null],['접은 길이',item.foldedLengthMm?`${item.foldedLengthMm}mm`:null],['헤드 체결',item.headMount]])).join('');
  $('#headCount').textContent=state.heads.length;$('#headList').innerHTML=state.heads.map(item=>dataCard(item,[['종류','볼헤드'],['허용 하중',item.maxLoadKg?`${item.maxLoadKg}kg`:null],['자체 무게',item.weightKg?`${item.weightKg}kg`:null],['볼 지름',item.ballDiameterMm?`${item.ballDiameterMm}mm`:null],['플레이트',item.plateStandard],['삼각대 체결',item.tripodMount]])).join('');
  $('#plateCount').textContent=state.plates.length;$('#plateList').innerHTML=state.plates.map(item=>dataCard(item,[['종류',item.plateType],['규격',item.standard],['카메라 체결',item.cameraMount],['무게',item.weightG?`${item.weightG}g`:null],['한국 구매',item.koreaPurchasable===false?'확인 필요':'가능/확인']])).join('');
}

[state.adapters,state.batteries,state.flashes,state.memoryCards,state.tripods,state.heads,state.plates,state.manufacturerOrder]=await Promise.all([loadAdapters(),loadBatteries(),loadFlashes(),loadMemoryCards(),loadTripods(),loadHeads(),loadPlates(),loadManufacturerOrder()]);
setup();renderAdapters();renderBatteries();renderData();
const requested=new URLSearchParams(location.search).get('category');showCategory(['adapter','memory','battery','flash','tripod','head','plate'].includes(requested)?requested:'adapter');
document.addEventListener('click',event=>{const button=event.target.closest('[data-accessory-category]');if(button)showCategory(button.dataset.accessoryCategory);});
$('#adapterSearch').addEventListener('input',event=>{state.adapterQ=event.target.value;renderAdapters();});$('#adapterBrand').addEventListener('change',event=>{state.adapterBrand=event.target.value;renderAdapters();});$('#adapterFrom').addEventListener('change',event=>{state.from=event.target.value;renderAdapters();});$('#adapterTo').addEventListener('change',event=>{state.to=event.target.value;renderAdapters();});
$('#batterySearch').addEventListener('input',event=>{state.batteryQ=event.target.value;renderBatteries();});$('#batteryBrand').addEventListener('change',event=>{state.batteryBrand=event.target.value;renderBatteries();});$('#batterySale').addEventListener('change',event=>{state.batterySale=event.target.value;renderBatteries();});$('#memorySearch').addEventListener('input',event=>{state.memoryQ=event.target.value;renderData();});$('#flashSearch').addEventListener('input',event=>{state.flashQ=event.target.value;renderData();});
