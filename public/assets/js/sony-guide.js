const $ = selector => document.querySelector(selector);
const search=$('#sonySearch'),filters=[...document.querySelectorAll('[data-sony-filter]')],cards=[...document.querySelectorAll('[data-sony-setting]')];
const normalize=text=>String(text).normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/[\s·_\-/]+/g,'');
const searchable=new Map(cards.map(card=>[card,normalize(card.textContent)]));
let selected='all';
function apply(){
  const terms=search.value.trim().split(/\s+/).filter(Boolean).map(normalize);
  let shown=0;
  for(const card of cards){const visible=(selected==='all'||card.dataset.category===selected)&&terms.every(term=>searchable.get(card).includes(term));card.hidden=!visible;if(visible)shown++;}
  for(const button of filters)button.setAttribute('aria-pressed',String(button.dataset.sonyFilter===selected));
  $('#sonyResultCount').textContent=`설정 ${shown}개 / 전체 ${cards.length}개`;
  $('#sonyNoResults').hidden=shown>0;
}
search.addEventListener('input',apply);
for(const button of filters)button.addEventListener('click',()=>{selected=button.dataset.sonyFilter;apply();});
$('#sonyClear').addEventListener('click',()=>{search.value='';selected='all';apply();search.focus();});
$('#sonyExpand').addEventListener('click',()=>{for(const card of cards)if(!card.hidden)card.open=true;});
$('#sonyCollapse').addEventListener('click',()=>{for(const card of cards)if(!card.hidden)card.open=false;});
$('#sonyManualSelect').addEventListener('change',event=>{
  const option=event.target.selectedOptions[0],link=$('#sonyManualOpen');
  link.href=option.dataset.url||'https://www.sony.co.kr/electronics/support';
  link.textContent=option.value?`${option.textContent} 공식 도움말 ↗`:'소니 지원에서 기종 찾기 ↗';
});
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-copy-setting]');if(!button)return;
  const url=new URL(location.href);url.search='';url.hash=button.dataset.copySetting;
  const status=$('#sonyCopyStatus');
  try{await navigator.clipboard.writeText(url.href);status.textContent='이 설정의 링크를 복사했습니다.';button.textContent='복사됨';setTimeout(()=>{button.textContent='이 설정 링크 복사';},2000);}
  catch{status.textContent=`복사할 설정 주소: ${url.href}`;button.textContent='아래에 주소 표시됨';}
});
function openLinkedSetting(){
  let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{return;}
  const card=cards.find(card=>card.id===id);if(!card)return;
  selected='all';search.value='';apply();card.open=true;requestAnimationFrame(()=>card.scrollIntoView({block:'start'}));
}
window.addEventListener('hashchange',openLinkedSetting);
apply();openLinkedSetting();
