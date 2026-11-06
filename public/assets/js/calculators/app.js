import {SENSOR_FORMATS,depthOfField,fieldOfView,storageEstimate,timelapsePlan,printDimensions} from './calculations.js';

const IDS=['dof','fov','storage','timelapse','print'];
const results=new Map();
const number=(value,digits=2)=>value.toLocaleString('ko-KR',{maximumFractionDigits:digits});
const metres=value=>value===Infinity?'무한대':`${number(value,value<1?4:2)} m`;
const seconds=value=>{
  if(value<60)return `${number(value,value<0.001?6:3)}초`;
  const hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),secs=value%60;
  return [hours?`${number(hours,0)}시간`:'',minutes?`${minutes}분`:'',secs?`${number(secs,2)}초`:''].filter(Boolean).join(' ');
};
const value=(form,key)=>{
  const text=form.elements.namedItem(key).value.trim();
  return text===''?NaN:Number(text);
};
const input=(form,keys)=>Object.fromEntries(keys.map(key=>[key,value(form,key)]));

function calculate(id,form) {
  if(id==='dof'){
    const r=depthOfField({...input(form,['focalMm','aperture','cocMm','focusM']),infinity:form.elements.namedItem('focusMode').value==='infinity'});
    return [['과초점거리',metres(r.hyperfocalM)],['가까운 선명 범위',metres(r.nearM)],['먼 선명 범위',metres(r.farM)],['전체 심도',metres(r.totalM)]];
  }
  if(id==='fov'){
    const r=fieldOfView(input(form,['focalMm','sensorWidthMm','sensorHeightMm','distanceM']));
    const svg=document.querySelector('[data-result="fov"] svg');
    const half=r.horizontalDegrees*Math.PI/360;
    const extent=120*Math.sin(half),farY=140-120*Math.cos(half);
    svg.querySelector('[data-fov-ray]').setAttribute('d',`M180 140 L${180-extent} ${farY} L${180+extent} ${farY} Z`);
    svg.querySelector('[data-fov-text]').textContent=`가로 ${number(r.horizontalDegrees,1)}° · 개념도`;
    return [['35mm 환산 초점거리',`${number(r.equivalentMm,1)} mm`],['대각선 기준 크롭 배율',`${number(r.crop,3)} 배`],['가로 · 세로 화각',`${number(r.horizontalDegrees,1)}° · ${number(r.verticalDegrees,1)}°`],['해당 거리의 가로 범위',metres(r.sceneWidthM)]];
  }
  if(id==='storage'){
    const r=storageEstimate(input(form,['capacityGB','usablePercent','fileMB','bitrateMbps']));
    return [['계산에 사용한 용량',`${number(r.usableGB,3)} GB`],['사진만 저장',`약 ${number(r.photos,0)} 장`],['동영상만 저장',`약 ${seconds(r.videoSeconds)}`]];
  }
  if(id==='timelapse'){
    const r=timelapsePlan(input(form,['movieSeconds','fps','intervalSeconds','shutterSeconds']));
    return [['필요한 사진',`${number(r.frames,0)} 장`],['실제 완성 영상 길이',seconds(r.movieSeconds)],['첫 시작 → 마지막 노출 종료',seconds(r.shootingSeconds)],['사진 사이 처리 여유',r.spareSeconds===0?'0초 · 처리 여유 없음':seconds(r.spareSeconds)]];
  }
  const r=printDimensions(input(form,['widthPx','heightPx','ppi','targetWidthCm']));
  return [['입력 PPI에서 출력 크기',`${number(r.widthCm)} × ${number(r.heightCm)} cm`],['인치로 환산한 출력 크기',`${number(r.widthInches)} × ${number(r.heightInches)} inch`],['희망 가로에서 세로 크기',`${number(r.targetHeightCm)} cm`],['희망 크기의 실제 픽셀 밀도',`${number(r.effectivePpi,1)} PPI`],['원본 화소 수',`${number(r.megapixels,2)} MP`]];
}

function updateSensor(id,form) {
  const preset=SENSOR_FORMATS[form.elements.namedItem('sensor')?.value];
  if(id==='dof'&&preset) form.elements.namedItem('cocMm').value=preset.coc;
  if(id==='fov')for(const [name,key] of [['sensorWidthMm','width'],['sensorHeightMm','height']]){
    const field=form.elements.namedItem(name);
    field.readOnly=Boolean(preset);
    if(preset)field.value=preset[key];
  }
}

function render(id,form) {
  const error=form.querySelector('[data-error]'),result=document.querySelector(`[data-result="${id}"]`),copy=form.querySelector('[data-copy]');
  form.querySelector('[data-status]').textContent='';
  form.querySelector('[data-copy-fallback]')?.remove();
  if(id==='dof') form.elements.namedItem('focusM').disabled=form.elements.namedItem('focusMode').value==='infinity';
  try{
    const entries=calculate(id,form);
    const dl=result.querySelector('dl');dl.replaceChildren();
    for(const [label,text] of entries){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=text;row.append(dt,dd);dl.append(row);}
    const parameters=[...form.elements].filter(element=>['INPUT','SELECT'].includes(element.tagName)&&!element.disabled).map(element=>`${element.closest('label').firstChild.textContent.trim()}: ${element.tagName==='SELECT'?element.selectedOptions[0]?.textContent:element.value}`);
    results.set(id,[`Matchcamera · ${document.getElementById(id).querySelector('h2').textContent.trim()}`,...parameters,...entries.map(([label,text])=>`${label}: ${text}`),'입력값에 따른 이론·추정 결과입니다.'].join('\n'));
    error.hidden=true;error.textContent='';result.hidden=false;copy.disabled=false;
  }catch(e){
    error.textContent=e.message||'입력값을 확인해 주세요.';error.hidden=false;result.hidden=true;copy.disabled=true;results.delete(id);
  }
}

async function copy(id,form) {
  const text=results.get(id);if(!text)return;
  const status=form.querySelector('[data-status]');
  try{
    if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);status.textContent='계산 결과를 복사했습니다.';
  }catch{
    form.querySelector('[data-copy-fallback]')?.remove();
    const field=document.createElement('textarea');field.dataset.copyFallback='';field.readOnly=true;field.value=text;field.setAttribute('aria-label','복사할 계산 결과');field.className='calc-copy-fallback';form.append(field);field.focus();field.select();status.textContent='자동 복사를 사용할 수 없어 내용을 선택했습니다. 직접 복사해 주세요.';
  }
}

function activate() {
  const hash=location.hash.slice(1),active=IDS.includes(hash)?hash:'dof';
  for(const id of IDS)document.getElementById(id).hidden=id!==active;
  for(const link of document.querySelectorAll('.calc-nav a')){
    if(link.hash===`#${active}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
}

for(const id of IDS){
  const form=document.querySelector(`[data-calculator="${id}"]`);
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('input',()=>render(id,form));
  form.addEventListener('change',event=>{if(event.target.name==='sensor')updateSensor(id,form);render(id,form);});
  form.addEventListener('reset',()=>queueMicrotask(()=>{updateSensor(id,form);render(id,form);}));
  form.querySelector('[data-copy]').addEventListener('click',()=>void copy(id,form));
  updateSensor(id,form);render(id,form);
}
window.addEventListener('hashchange',activate);
activate();
