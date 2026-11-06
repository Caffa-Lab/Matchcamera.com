import {loadProductIndex,loadProducts,loadBatteries,loadMemoryCards,loadTripods,loadHeads,loadPlates,loadFlashes,loadAdapters,matchesSearch,isProductActive} from '../data.js?v=20261006-catalog';
import {STORAGE_KEY,CATEGORIES,emptyKit,parseBackup,encodeBackup,knownWeight,catalogEntry,equipmentCsv,newId,validateKit} from './model.js?v=20261107-beta';
const $=selector=>document.querySelector(selector);
const esc=(value='')=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const formatWeight=value=>value>=1000?`${(value/1000).toLocaleString('ko-KR',{maximumFractionDigits:3})}kg`:`${value.toLocaleString('ko-KR',{maximumFractionDigits:3})}g`;
const kindLoaders={battery:loadBatteries,memory:loadMemoryCards,tripod:loadTripods,head:loadHeads,plate:loadPlates,flash:loadFlashes,adapter:loadAdapters};
let kit=emptyKit(),indexPromise,fullPromise,currentCatalog=[],loadGeneration=0,savingFailed=false;
const catalogs=new Map();

function status(message,error=false){
  if(savingFailed&&!error)message+=' · 브라우저 자동 저장 실패: JSON 백업을 저장해 주세요.';
  $('#kitStatus').textContent=message;$('#kitStatus').classList.toggle('error',error||savingFailed);
}
function save(){
  kit.updatedAt=new Date().toISOString();
  try{
    const encoded=encodeBackup(kit);
    localStorage.setItem(STORAGE_KEY,encoded);
    if(localStorage.getItem(STORAGE_KEY)!==encoded)throw Error('저장 실패');
    savingFailed=false;
    $('#kitSavedAt').textContent=`자동 저장됨 · ${new Date(kit.updatedAt).toLocaleString('ko-KR')}`;
    status('변경사항을 이 브라우저에 저장했습니다.');
  }catch{
    savingFailed=true;$('#kitSavedAt').textContent='이 브라우저에 저장하지 못했습니다. JSON 백업을 저장하세요.';
    status('브라우저 저장소를 사용할 수 없거나 저장 공간이 부족합니다. 현재 내용은 이 화면에서 사용할 수 있지만, 닫기 전에 JSON 백업을 저장해 주세요.',true);
  }
}
function changed(){save();renderKit();}
function renderKit(){
  const focusedId=document.activeElement?.id;
  const summary=knownWeight(kit.items);
  $('#kitPieces').textContent=`${summary.pieces.toLocaleString('ko-KR')}개`;
  $('#kitPacked').textContent=`챙긴 장비 ${summary.packed.toLocaleString('ko-KR')}개`;
  $('#kitWeight').textContent=formatWeight(summary.weightG);
  $('#kitMissingWeight').textContent=summary.missing?`미확인 ${summary.missing}개 제외 · 실제 무게와 다를 수 있음`:summary.pieces?'등록된 무게 기준 · 배터리 포함 여부 확인':'장비를 추가해 보세요';
  $('#kitProgress').textContent=`${kit.tasks.filter(task=>task.done).length} / ${kit.tasks.length}`;
  $('#kitItems').innerHTML=kit.items.length?kit.items.map(item=>`<article class="kit-item" data-kit-item="${esc(item.id)}"><div class="kit-item-top">${item.imageSrc?`<img src="${esc(item.imageSrc)}" alt="" loading="lazy" decoding="async">`:''}<div class="kit-item-name"><strong>${esc(item.name)}</strong><small>${esc(CATEGORIES[item.category])} · ${item.source==='manual'?'직접 입력':'제품 DB'}</small></div><button type="button" class="kit-item-remove" data-remove-item="${esc(item.id)}" aria-label="${esc(item.name)} 삭제">×</button></div><div class="kit-item-edit"><div><label for="qty-${esc(item.id)}">수량</label><input id="qty-${esc(item.id)}" data-quantity="${esc(item.id)}" type="number" min="1" max="99" step="1" value="${item.quantity}" required></div><div><label for="weight-${esc(item.id)}">개당 무게 (g, 직접 수정 가능)</label><input id="weight-${esc(item.id)}" data-weight="${esc(item.id)}" type="number" min="0.001" max="1000000" step="any" value="${item.weightG??''}" placeholder="미확인"></div><label class="kit-check-label ${item.packed?'checked':''}" for="packed-${esc(item.id)}"><input id="packed-${esc(item.id)}" data-packed="${esc(item.id)}" type="checkbox" ${item.packed?'checked':''}><span>챙김</span></label></div></article>`).join(''):'<div class="kit-empty">촬영에 가져갈 장비를 추가하세요.<br>목록에 없다면 직접 입력할 수 있습니다.</div>';
  $('#kitTasks').innerHTML=kit.tasks.map(task=>`<div class="kit-task"><label class="kit-check-label ${task.done?'checked':''}" for="task-${esc(task.id)}"><input id="task-${esc(task.id)}" type="checkbox" data-task-check="${esc(task.id)}" ${task.done?'checked':''}><span>${esc(task.text)}</span></label><button type="button" data-remove-task="${esc(task.id)}" aria-label="${esc(task.text)} 항목 삭제">×</button></div>`).join('')||'<p class="kit-help">필요한 촬영 준비 항목을 추가해 보세요.</p>';
  document.querySelectorAll('.kit-item img,.kit-search-result img').forEach(image=>image.addEventListener('error',()=>{image.hidden=true;},{once:true}));
  if(focusedId)document.getElementById(focusedId)?.focus({preventScroll:true});
}
function renderSearch(){
  const query=$('#kitSearch').value.trim();
  const matches=currentCatalog.filter(item=>matchesSearch(item,query));
  const rows=matches.slice(0,30);
  $('#kitSearchCount').textContent=`${matches.length.toLocaleString('ko-KR')}개${matches.length>rows.length?' · 처음 30개 표시, 검색어를 입력해 좁혀 보세요.':''}`;
  $('#kitSearchResults').innerHTML=rows.map((item,index)=>`<article class="kit-search-result">${item.imageSrc&&item.imageSrc.startsWith('/assets/images/')?`<img src="${esc(item.imageSrc)}" alt="" loading="lazy" decoding="async">`:''}<div><strong>${esc(item.officialName||item.model||item.id)}</strong><small>${esc(item.manufacturer||'')}${item.mount?` · ${esc(item.mount)}`:''}</small></div><button type="button" data-add-catalog="${index}" aria-label="${esc(item.officialName||item.model||item.id)} 추가">추가</button></article>`).join('')||'<p class="kit-help">조건에 맞는 제품이 없습니다. 직접 입력을 이용할 수 있습니다.</p>';
  $('#kitSearchResults')._rows=rows;
  $('#kitSearchResults').querySelectorAll('img').forEach(image=>image.addEventListener('error',()=>{image.hidden=true;},{once:true}));
}
async function loadCategory(){
  const generation=++loadGeneration;
  const category=$('#kitCategory').value;
  currentCatalog=[];$('#kitSearchResults').innerHTML='';$('#kitSearchCount').textContent='제품 목록을 불러오는 중입니다.';
  try{
    let rows;
    if(['body','lens'].includes(category)){
      indexPromise??=loadProductIndex();rows=(await indexPromise).filter(item=>item.type===(category==='body'?'바디':'렌즈'));
    }else{
      if(!catalogs.has(category))catalogs.set(category,Promise.resolve(kindLoaders[category]()));
      rows=await catalogs.get(category);
    }
    if(generation!==loadGeneration)return;
    currentCatalog=rows.filter(isProductActive);
    renderSearch();
  }catch{
    if(generation!==loadGeneration)return;
    $('#kitSearchCount').textContent='제품 목록을 불러오지 못했습니다. 분류를 다시 선택하거나 직접 입력해 주세요.';
    if(['body','lens'].includes(category))indexPromise=null;else catalogs.delete(category);
  }
}
async function addCatalog(button){
  const product=$('#kitSearchResults')._rows?.[Number(button.dataset.addCatalog)];
  if(!product)return;
  const category=$('#kitCategory').value;
  button.disabled=true;
  try{
    if(kit.items.length>=200)throw Error('장비는 최대 200개 항목까지 저장할 수 있습니다.');
    const existing=kit.items.find(item=>item.source==='catalog'&&item.category===category&&item.catalogId===product.id);
    if(existing){
      if(existing.quantity>=99)throw Error('한 장비의 수량은 최대 99개입니다.');
      existing.quantity++;existing.packed=false;changed();return;
    }
    let detail=product;
    if(['body','lens'].includes(category)){
      status('선택한 장비의 상세 무게를 확인하고 있습니다.');
      try{fullPromise??=loadProducts();detail=(await fullPromise).find(item=>item.id===product.id)||product;}catch{fullPromise=null;}
    }
    // Take the exact selected record only. Never substitute another model's image.
    const entry=catalogEntry(detail,category);
    kit.items.push(entry);changed();
    if(entry.weightG===null)status('장비를 추가했습니다. 등록된 무게가 없어 합계에서 제외합니다. 알고 있는 무게를 직접 입력할 수 있습니다.');
  }catch(error){status(error.message||'장비를 추가하지 못했습니다.',true);}
  finally{button.disabled=false;}
}
function download(content,name,type){
  const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function bind(){
  $('#kitCategory').addEventListener('change',()=>{void loadCategory();});
  $('#kitSearch').addEventListener('input',renderSearch);
  $('#kitSearchResults').addEventListener('click',event=>{const button=event.target.closest('[data-add-catalog]');if(button)void addCatalog(button);});
  $('#kitManualForm').addEventListener('submit',event=>{
    event.preventDefault();if(!event.currentTarget.reportValidity())return;
    try{
      const name=$('#kitManualName').value.trim();if(!name)throw Error('장비명을 입력해 주세요.');
      if(kit.items.length>=200)throw Error('장비는 최대 200개 항목까지 저장할 수 있습니다.');
      const item={id:newId(),source:'manual',catalogId:null,category:'other',name,quantity:Number($('#kitManualQuantity').value),weightG:$('#kitManualWeight').value===''?null:Number($('#kitManualWeight').value),packed:false,imageSrc:null};
      validateKit({...kit,items:[...kit.items,item]});kit.items.push(item);changed();event.currentTarget.reset();$('#kitManualQuantity').value='1';
    }catch(error){status(error.message,true);}
  });
  $('#kitItems').addEventListener('change',event=>{
    const input=event.target;const id=input.dataset.quantity||input.dataset.weight||input.dataset.packed;
    const item=kit.items.find(row=>row.id===id);if(!item)return;
    if(!input.reportValidity()){renderKit();return;}
    if(input.dataset.quantity){item.quantity=Number(input.value);item.packed=false;}
    if(input.dataset.weight)item.weightG=input.value===''?null:Number(input.value);
    if(input.dataset.packed)item.packed=input.checked;
    changed();
  });
  $('#kitItems').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-item]');if(!button)return;
    const item=kit.items.find(row=>row.id===button.dataset.removeItem);
    if(item&&confirm(`${item.name}을(를) 장비 목록에서 삭제할까요?`)){kit.items=kit.items.filter(row=>row.id!==item.id);changed();}
  });
  $('#kitTaskForm').addEventListener('submit',event=>{
    event.preventDefault();const value=$('#kitNewTask').value.trim();if(!value)return;
    if(kit.tasks.length>=200)return status('준비 항목은 최대 200개까지 저장할 수 있습니다.',true);
    kit.tasks.push({id:newId(),text:value,done:false});changed();event.currentTarget.reset();
  });
  $('#kitTasks').addEventListener('change',event=>{const task=kit.tasks.find(row=>row.id===event.target.dataset.taskCheck);if(task){task.done=event.target.checked;changed();}});
  $('#kitTasks').addEventListener('click',event=>{
    const button=event.target.closest('[data-remove-task]');if(!button)return;
    const task=kit.tasks.find(row=>row.id===button.dataset.removeTask);
    if(task&&confirm(`준비 항목 '${task.text}'을(를) 삭제할까요?`)){kit.tasks=kit.tasks.filter(row=>row.id!==task.id);changed();}
  });
  $('#kitUnpack').addEventListener('click',()=>{if(kit.items.some(item=>item.packed)&&confirm('모든 장비의 챙김 표시를 해제할까요?')){kit.items.forEach(item=>{item.packed=false;});changed();}});
  $('#kitResetChecks').addEventListener('click',()=>{if(kit.tasks.some(task=>task.done)&&confirm('촬영 준비 체크 표시를 모두 해제할까요?')){kit.tasks.forEach(task=>{task.done=false;});changed();}});
  $('#kitExport').addEventListener('click',()=>{try{download(encodeBackup(kit),'matchcamera-kit.json','application/json');status('JSON 백업 저장을 요청했습니다. 기기의 다운로드 목록을 확인해 주세요.');}catch(error){status(error.message,true);}});
  $('#kitCsv').addEventListener('click',()=>{try{download(equipmentCsv(kit),'matchcamera-kit.csv','text/csv;charset=utf-8');status('장비 CSV 저장을 요청했습니다. 기기의 다운로드 목록을 확인해 주세요.');}catch(error){status(error.message,true);}});
  $('#kitImport').addEventListener('change',async event=>{
    const file=event.target.files?.[0];if(!file)return;
    try{
      if(file.size>512_000)throw Error('백업 파일은 500KB 이하만 불러올 수 있습니다.');
      const incoming=parseBackup(await file.text());
      if(!confirm(`장비 ${incoming.items.length}개 항목과 준비 목록 ${incoming.tasks.length}개로 현재 내용을 바꿀까요? 현재 내용이 필요하면 먼저 JSON 백업을 저장하세요.`))return;
      kit=incoming;changed();
      if(!savingFailed)status('백업의 장비와 체크리스트를 불러와 저장했습니다.');
    }catch(error){status(error.message||'백업 파일을 불러오지 못했습니다.',true);}finally{event.target.value='';}
  });
  $('#kitClear').addEventListener('click',()=>{if(confirm('장비 목록과 촬영 준비를 모두 초기화할까요? 기본 준비 목록으로 바뀝니다. 필요한 내용은 먼저 JSON 백업을 저장하세요.')){kit=emptyKit();changed();}});
}
try{
  const stored=localStorage.getItem(STORAGE_KEY);if(stored){kit=parseBackup(stored);$('#kitSavedAt').textContent=`마지막 저장 · ${new Date(kit.updatedAt).toLocaleString('ko-KR')}`;}
}catch{
  status('저장된 내용을 읽지 못했습니다. 빈 목록으로 열었습니다. 기존 JSON 백업이 있다면 불러와 주세요. 저장소가 차단된 경우 자동 저장되지 않습니다.',true);
}
bind();renderKit();void loadCategory();
