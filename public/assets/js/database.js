import {loadProducts,money,productLabel,matchesSearch} from './data.js';
const $=s=>document.querySelector(s);
const state={all:[],q:'',manufacturer:'all',mount:'all',type:'all',sensor:'all',lens:'all',sale:'all'};

function options(values,label){
  return `<option value="all">${label}</option>`+values.map(v=>`<option value="${v}">${v}</option>`).join('');
}

function setupFilters(){
  const brands=[...new Set(state.all.map(p=>p.manufacturer).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('#manufacturer').innerHTML=options(brands,'모든 제조사');
  const mounts=[...new Set(state.all.map(p=>p.mount).filter(Boolean))].sort();
  $('#mount').innerHTML=options(mounts,'모든 마운트');
  const sensors=[...new Set(state.all.flatMap(p=>[p.sensorFormat,p.compatibleSensorFormat]).filter(Boolean))].sort();
  $('#sensor').innerHTML=options(sensors,'모든 센서 포맷');
  const formats=[...new Set(state.all.map(p=>p.lensFormat).filter(Boolean))].sort();
  $('#lensFormat').innerHTML=options(formats,'모든 렌즈 포맷');
}

function filtered(){
  let x=[...state.all];
  if(state.q)x=x.filter(p=>matchesSearch(p,state.q));
  if(state.manufacturer!=='all')x=x.filter(p=>p.manufacturer===state.manufacturer);
  if(state.mount!=='all')x=x.filter(p=>p.mount===state.mount);
  if(state.type!=='all')x=x.filter(p=>p.type===state.type);
  if(state.sensor!=='all')x=x.filter(p=>p.sensorFormat===state.sensor||p.compatibleSensorFormat===state.sensor);
  if(state.lens!=='all')x=x.filter(p=>p.lensFormat===state.lens);
  if(state.sale!=='all')x=x.filter(p=>p.currentSale===state.sale);
  return x.sort((a,b)=>(b.releaseYear||0)-(a.releaseYear||0)||productLabel(a).localeCompare(productLabel(b),'ko'));
}

function render(){
  const x=filtered();
  $('#count').textContent=x.length.toLocaleString();
  $('#rows').innerHTML=x.map(p=>`<tr>
    <td><button class="link-btn" data-detail="${p.id}">${productLabel(p)}</button><div class="muted tiny">${p.modelCode||''}</div></td>
    <td>${p.manufacturer}</td><td>${p.type}</td><td>${p.mount||'-'}</td>
    <td>${p.type==='바디'?(p.sensorFormat||'-'):(p.lensFormat||'-')}</td>
    <td>${p.type==='렌즈'?(p.focalLength||'-'):'-'}</td>
    <td>${p.type==='렌즈'?(p.maxAperture||'-'):'-'}</td>
    <td>${p.weightG?`${p.weightG} g`:'-'}</td>
    <td>${p.releaseYear||'-'}</td>
    <td>${p.saleStatus||p.currentSale||'-'}</td>
  </tr>`).join('')||'<tr><td colspan="10" class="empty">검색 결과가 없습니다.</td></tr>';
}

function detail(p){
  $('#dialogTitle').textContent=productLabel(p);
  const specs=Object.entries(p.specs||{});
  $('#specs').innerHTML=specs.map(([k,v])=>`<div class="spec"><span>${k}</span><span>${String(v)}</span></div>`).join('');
  $('#productDialog').showModal();
}

state.all=await loadProducts();
const initial=new URLSearchParams(location.search).get('q')||'';
state.q=initial;
setupFilters();
if($('#q'))$('#q').value=initial;
render();

[['#q','q','input'],['#manufacturer','manufacturer','change'],['#mount','mount','change'],['#type','type','change'],['#sensor','sensor','change'],['#lensFormat','lens','change'],['#sale','sale','change']]
.forEach(([sel,key,evt])=>$(sel).addEventListener(evt,e=>{state[key]=e.target.value;render();}));

document.addEventListener('click',e=>{
  const d=e.target.closest('[data-detail]');
  if(d)detail(state.all.find(p=>p.id===d.dataset.detail));
  if(e.target.closest('[data-close-dialog]'))$('#productDialog').close();
});
