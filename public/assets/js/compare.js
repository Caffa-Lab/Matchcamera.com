
import {loadProducts,productLabel,money} from './data.js';
const $=s=>document.querySelector(s);const products=await loadProducts();
function options(type){return products.filter(p=>type==='all'||p.type===type).sort((a,b)=>productLabel(a).localeCompare(productLabel(b),'ko')).map(p=>`<option value="${p.id}">${productLabel(p)}</option>`).join('')}
$('#a').innerHTML='<option value="">제품 선택</option>'+options('all');$('#b').innerHTML='<option value="">제품 선택</option>'+options('all');
function render(){const a=products.find(p=>p.id===$('#a').value),b=products.find(p=>p.id===$('#b').value);for(const [id,p] of [['left',a],['right',b]]){const el=$('#'+id);if(!p){el.innerHTML='<div class="empty">제품을 선택하세요.</div>';continue}const rows=[['제품',productLabel(p)],['종류',p.type],['마운트',p.mount],['포맷',p.type==='바디'?p.sensorFormat:p.lensFormat],['출시년도',p.releaseYear],['초점거리',p.focalLength],['최대 조리개',p.maxAperture],['무게',p.weightG?`${p.weightG} g`:null],['현재 가격',money(p.currentPriceUsd)],['판매 상태',p.saleStatus]].filter(x=>x[1]);el.innerHTML=rows.map(([k,v])=>`<div class="spec"><span>${k}</span><span>${v}</span></div>`).join('')}}
$('#a').addEventListener('change',render);$('#b').addEventListener('change',render);render();
