import {loadAdapters,loadBatteries,money} from './data.js';

const $=s=>document.querySelector(s);
const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={all:[],q:'',brand:'all',from:'all',to:'all',batteries:[],batteryQ:'',batteryBrand:'all',batterySale:'all'};

function options(values,label){
  return `<option value="all">${label}</option>`+
    values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}

function setup(){
  const vals=k=>[...new Set(state.all.map(x=>x[k]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('#adapterBrand').innerHTML=options(vals('manufacturer'),'모든 제조사');
  $('#adapterFrom').innerHTML=options(vals('fromMount'),'모든 렌즈측 마운트');
  $('#adapterTo').innerHTML=options(vals('toMount'),'모든 바디측 마운트');
}

function render(){
  const q=state.q.toLowerCase();
  const list=state.all.filter(a=>
    (!q||JSON.stringify(a).toLowerCase().includes(q))&&
    (state.brand==='all'||a.manufacturer===state.brand)&&
    (state.from==='all'||a.fromMount===state.from)&&
    (state.to==='all'||a.toMount===state.to)
  );
  $('#adapterCount').textContent=list.length.toLocaleString();
  $('#adapterList').innerHTML=list.map(a=>`
    <article class="adapter-card">
      <div><h2>${esc(a.officialName)}</h2><p>${esc(a.manufacturer)}${a.note?` · ${esc(a.note)}`:''}</p></div>
      <div class="adapter-flow"><span>렌즈 측</span><strong>${esc(a.fromMount)}</strong></div>
      <div class="adapter-flow"><span>바디 측</span><strong>${esc(a.toMount)}</strong></div>
      <div class="adapter-tags">
        <span>AF ${esc(a.afSupport||'확인 필요')}</span>
        <span>조리개 ${esc(a.apertureControl||'확인 필요')}</span>
        <span>EXIF ${esc(a.exifSupport||'확인 필요')}</span>
        ${a.focalReducer==='예'?'<span>포컬리듀서</span>':''}
      </div>
    </article>`).join('') || '<div class="empty">조건에 맞는 어댑터가 없습니다.</div>';
}


function setupBatteries(){
  const brands=[...new Set(state.batteries.map(x=>x.manufacturer).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'ko'));
  $('#batteryBrand').innerHTML=options(brands,'모든 제조사');
}

function batteryHay(b){
  return [
    b.officialName,b.manufacturer,b.note,
    ...(b.compatibleNames||[]),
    ...(b.compatibleModelCodes||[]),
    ...(b.compatiblePrefixes||[])
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderBatteries(){
  const q=state.batteryQ.toLowerCase();
  const list=state.batteries.filter(b=>
    (!q||batteryHay(b).includes(q))&&
    (state.batteryBrand==='all'||b.manufacturer===state.batteryBrand)&&
    (state.batterySale==='all'||b.currentSale===state.batterySale)
  );

  $('#batteryCount').textContent=list.length.toLocaleString();
  $('#batteryList').innerHTML=list.map(b=>{
    const names=(b.compatibleNames||[]);
    const preview=names.slice(0,7);
    const extra=Math.max(0,names.length-preview.length);
    return `<article class="battery-card">
      <div class="battery-main">
        <div class="battery-brand">${esc(b.manufacturer||'')}</div>
        <h2>${esc(b.officialName||'')}</h2>
        <p>${esc(b.note||'')}</p>
      </div>
      <div class="battery-compat">
        <span class="battery-label">호환 바디</span>
        <div class="battery-tags">
          ${preview.map(x=>`<span>${esc(x)}</span>`).join('')}
          ${extra?`<span>+${extra}개</span>`:''}
        </div>
      </div>
      <div class="battery-meta">
        <span>${b.currentSale==='예'?'현재 판매 확인':'판매 상태 확인 필요'}</span>
        <strong>${money(b.currentPriceKrw)}</strong>
      </div>
    </article>`;
  }).join('') || '<div class="empty">조건에 맞는 배터리가 없습니다.</div>';
}

function showCategory(category){
  document.querySelectorAll('[data-accessory-category]').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.accessoryCategory===category);
  });
  document.querySelectorAll('[data-accessory-panel]').forEach(panel=>{
    panel.classList.toggle('hidden',panel.dataset.accessoryPanel!==category);
  });
  const u=new URL(location.href);
  if(category==='adapter') u.searchParams.delete('category');
  else u.searchParams.set('category',category);
  history.replaceState(null,'',u);
}

[state.all,state.batteries]=await Promise.all([loadAdapters(),loadBatteries()]);
setup();
setupBatteries();
render();
renderBatteries();

$('#adapterSearch').addEventListener('input',e=>{state.q=e.target.value;render();});
[['#adapterBrand','brand'],['#adapterFrom','from'],['#adapterTo','to']].forEach(([selector,key])=>
  $(selector).addEventListener('change',e=>{state[key]=e.target.value;render();})
);


$('#batterySearch').addEventListener('input',e=>{state.batteryQ=e.target.value;renderBatteries();});
$('#batteryBrand').addEventListener('change',e=>{state.batteryBrand=e.target.value;renderBatteries();});
$('#batterySale').addEventListener('change',e=>{state.batterySale=e.target.value;renderBatteries();});

document.addEventListener('click',e=>{
  const btn=e.target.closest('[data-accessory-category]');
  if(btn) showCategory(btn.dataset.accessoryCategory);
});

const initial=new URLSearchParams(location.search).get('category');
if(['adapter','memory','battery','flash','tripod'].includes(initial)) showCategory(initial);
