import {loadProductIndex} from './data.js?v=20260902-performance';

const $=selector=>document.querySelector(selector);
const els={
  files:$('#resizeFiles'),drop:$('#resizeDropzone'),preview:$('#resizePreview'),queue:$('#resizeQueue'),count:$('#resizeCount'),status:$('#resizeStatus'),
  clear:$('#clearResize'),longEdge:$('#longEdge'),format:$('#outputFormat'),quality:$('#outputQuality'),suffix:$('#filenameSuffix'),
  equipment:$('#equipmentEnabled'),equipmentImages:$('#equipmentImages'),settings:$('#settingsEnabled'),theme:$('#panelTheme'),
  body:$('#bodySearch'),lens:$('#lensSearch'),bodyOptions:$('#bodyOptions'),lensOptions:$('#lensOptions'),exif:$('#exifSummary'),applyAll:$('#applyEquipmentAll'),
  exportCount:$('#exportCount'),exportSize:$('#exportSize'),current:$('#downloadCurrent'),all:$('#downloadAll'),
};

const state={items:[],selected:-1,products:[],bodies:[],lenses:[],renderToken:0,lastBlob:null};
const bodyType=p=>/(바디|camera|cinema)/i.test(`${p.type||''} ${p.cameraSystem||''}`)&&!/(렌즈|lens)/i.test(p.type||'');
const lensType=p=>/(렌즈|lens)/i.test(p.type||'');
const productName=p=>p?.officialName||p?.model||p?.modelCode||'';
const normalize=value=>String(value||'').toLowerCase().replace(/α/g,'a').replace(/[^a-z0-9가-힣]+/g,'');
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

function aliases(p){return [productName(p),p?.model,p?.modelCode,...(p?.exifAliases||[])].map(normalize).filter(Boolean)}
function findProduct(raw,list){
  const target=normalize(raw);if(!target)return null;
  let winner=null;let score=0;
  for(const product of list)for(const alias of aliases(product)){
    let next=0;
    if(alias===target)next=1000+alias.length;
    else if(alias.includes(target)||target.includes(alias))next=100+Math.min(alias.length,target.length);
    else{
      const tokens=String(raw).toLowerCase().split(/[^a-z0-9가-힣α]+/).map(normalize).filter(token=>token.length>1);
      next=tokens.filter(token=>alias.includes(token)).reduce((sum,token)=>sum+token.length,0);
    }
    if(next>score){score=next;winner=product}
  }
  return score>=4?winner:null;
}

function formatExposure(value){
  const n=Number(value);if(!Number.isFinite(n)||n<=0)return '';
  if(n>=1)return `${Number(n.toFixed(1))}s`;
  return `1/${Math.round(1/n)}s`;
}
function formatDate(value){
  const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))return '';
  return `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')}`;
}
function exifSettings(exif){
  const parts=[];
  if(Number(exif?.FNumber)>0)parts.push(`F ${Number(exif.FNumber).toFixed(1)}`);
  const shutter=formatExposure(exif?.ExposureTime);if(shutter)parts.push(`SS ${shutter}`);
  const iso=exif?.ISO??exif?.ISOSpeedRatings;if(iso)parts.push(`ISO ${Array.isArray(iso)?iso[0]:iso}`);
  const focal=Number(exif?.FocalLength);if(focal>0)parts.push(`${Number(focal.toFixed(1))}mm`);
  const date=formatDate(exif?.DateTimeOriginal||exif?.CreateDate);if(date)parts.push(`(${date})`);
  return parts.join('  |  ');
}

async function waitForGlobal(name,timeout=6000){
  const start=Date.now();while(Date.now()-start<timeout){if(window[name])return window[name];await new Promise(resolve=>setTimeout(resolve,50))}return null;
}
async function parseExif(file){
  const exifr=await waitForGlobal('exifr');if(!exifr)return {};
  try{return await exifr.parse(file,{tiff:true,exif:true,gps:false,icc:false,iptc:false,xmp:false})||{}}catch{return {}}
}
async function decodeImage(file){
  if('createImageBitmap'in window){try{return await createImageBitmap(file,{imageOrientation:'from-image'})}catch{}}
  const url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();URL.revokeObjectURL(url);return image;
}
function dimensions(image){return {width:image.width||image.naturalWidth,height:image.height||image.naturalHeight}}

async function initializeProducts(){
  try{
    state.products=await loadProductIndex();state.bodies=state.products.filter(bodyType);state.lenses=state.products.filter(lensType);
    els.bodyOptions.innerHTML=state.bodies.map(p=>`<option value="${escapeHtml(productName(p))}"></option>`).join('');
    els.lensOptions.innerHTML=state.lenses.map(p=>`<option value="${escapeHtml(productName(p))}"></option>`).join('');
  }catch(error){console.warn('제품 인덱스를 불러오지 못했습니다.',error)}
}
function escapeHtml(value){return String(value||'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}

async function addFiles(files){
  const accepted=[...files].filter(file=>/^image\/(jpeg|png|webp|avif)$/i.test(file.type));
  if(!accepted.length){setStatus('브라우저에서 열 수 있는 JPG, PNG, WEBP, AVIF 파일을 선택하세요.');return}
  setStatus(`${accepted.length}개 사진을 읽는 중…`);
  for(const file of accepted){
    try{
      const [image,exif]=await Promise.all([decodeImage(file),parseExif(file)]);
      const bodyRaw=exif?.Model||exif?.CameraModelName||'';const lensRaw=exif?.LensModel||exif?.Lens||'';
      state.items.push({file,image,exif,body:findProduct(bodyRaw,state.bodies),lens:findProduct(lensRaw,state.lenses),bodyRaw,lensRaw});
    }catch(error){console.warn(file.name,error)}
  }
  if(state.selected<0&&state.items.length)state.selected=0;
  refreshQueue();syncSelection();updateActions();setStatus(`${state.items.length}개 준비됨`);await renderSelected();
}

function setStatus(message){els.status.textContent=message}
function updateActions(){
  const has=state.items.length>0;els.count.textContent=`${state.items.length}개`;els.exportCount.textContent=`${state.items.length}개`;
  els.clear.disabled=!has;els.current.disabled=!has;els.all.disabled=!has;
  const total=state.items.reduce((sum,item)=>sum+item.file.size,0);els.exportSize.textContent=has?`${Math.max(.1,total/1048576).toFixed(1)} MB 이하 예상`:'-';
}
function refreshQueue(){
  els.queue.innerHTML=state.items.map((item,index)=>`<button class="resize-item${index===state.selected?' active':''}" type="button" data-index="${index}"><img src="${URL.createObjectURL(item.file)}" alt=""><span>${escapeHtml(item.file.name)}</span></button>`).join('');
  els.queue.querySelectorAll('img').forEach(img=>img.addEventListener('load',()=>URL.revokeObjectURL(img.src),{once:true}));
}
function syncSelection(){
  const item=state.items[state.selected];if(!item){els.body.value='';els.lens.value='';els.exif.textContent='사진을 선택하면 EXIF를 확인합니다.';return}
  els.body.value=productName(item.body)||item.bodyRaw||'';els.lens.value=productName(item.lens)||item.lensRaw||'';
  const lines=[item.bodyRaw&&`바디 EXIF: ${item.bodyRaw}`,item.lensRaw&&`렌즈 EXIF: ${item.lensRaw}`,exifSettings(item.exif)].filter(Boolean);
  els.exif.textContent=lines.join(' · ')||'장비 EXIF가 없습니다. 검색으로 직접 선택할 수 있습니다.';
}

function outputOptions(){return {longEdge:clamp(Number(els.longEdge.value)||2048,320,12000),type:els.format.value,quality:clamp((Number(els.quality.value)||90)/100,.1,1),panel:els.equipment.checked,images:els.equipmentImages.checked,settings:els.settings.checked,theme:els.theme.value}}
function fitOutput(item,longEdge){const {width,height}=dimensions(item.image);const scale=Math.min(1,longEdge/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))}}
function fitText(ctx,text,maxWidth,initial,min=18){let size=initial;while(size>min){ctx.font=`800 ${size}px Inter,Arial,sans-serif`;if(ctx.measureText(text).width<=maxWidth)break;size-=2}return size}
async function loadProductImage(product){
  if(!product?.imageSrc)return null;
  try{const image=new Image();image.crossOrigin='anonymous';image.src=product.imageSrc;await image.decode();return image}catch{return null}
}
function drawContain(ctx,image,x,y,width,height){const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;const scale=Math.min(width/iw,height/ih);const w=iw*scale,h=ih*scale;ctx.drawImage(image,x+(width-w)/2,y+(height-h)/2,w,h)}
async function compose(item,options=outputOptions()){
  const photo=fitOutput(item,options.longEdge);const panelHeight=options.panel?clamp(Math.round(photo.width*.18),150,390):0;
  const canvas=document.createElement('canvas');canvas.width=photo.width;canvas.height=photo.height+panelHeight;const ctx=canvas.getContext('2d',{alpha:options.type!=='image/jpeg'});
  ctx.fillStyle=options.theme==='dark'?'#0b0d10':'#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(item.image,0,0,photo.width,photo.height);
  if(!options.panel)return canvas;
  const dark=options.theme==='dark';const fg=dark?'#fff':'#080b0f';const muted=dark?'#b9c1cc':'#52606d';const bodyText=productName(item.body)||item.bodyRaw||'카메라 정보 없음';const lensText=productName(item.lens)||item.lensRaw||'렌즈 정보 없음';
  const pad=Math.max(26,Math.round(photo.width*.035));const top=photo.height;const imageArea=options.images?Math.round(photo.width*.35):0;const textWidth=photo.width-pad*2-imageArea;
  ctx.fillStyle=fg;ctx.font=`700 ${clamp(Math.round(panelHeight*.16),22,52)}px Inter,Arial,sans-serif`;ctx.fillText('Shot on',pad,top+panelHeight*.29);
  const equipment=`${bodyText} & ${lensText}`;const equipmentSize=fitText(ctx,equipment,textWidth,clamp(Math.round(panelHeight*.2),25,60),16);ctx.font=`900 ${equipmentSize}px Inter,Arial,sans-serif`;ctx.fillText(equipment,pad,top+panelHeight*.58);
  if(options.settings){ctx.fillStyle=muted;ctx.font=`500 ${clamp(Math.round(panelHeight*.095),15,30)}px Inter,Arial,sans-serif`;ctx.fillText(exifSettings(item.exif)||'EXIF 촬영 설정 없음',pad,top+panelHeight*.79)}
  if(options.images){
    const [bodyImage,lensImage]=await Promise.all([loadProductImage(item.body),loadProductImage(item.lens)]);const areaX=photo.width-imageArea;const each=imageArea/2-pad*.2;
    if(bodyImage)drawContain(ctx,bodyImage,areaX,top+10,each,panelHeight-20);
    if(lensImage)drawContain(ctx,lensImage,areaX+each,top+10,each,panelHeight-20);
  }
  return canvas;
}

async function renderSelected(){
  const item=state.items[state.selected];if(!item){els.preview.innerHTML='<div class="resize-empty"><b>완성 이미지를 여기서 미리봅니다.</b><span>왼쪽에서 사진을 선택하세요.</span></div>';return}
  const token=++state.renderToken;setStatus('미리보기 만드는 중…');
  try{const canvas=await compose(item);if(token!==state.renderToken)return;els.preview.replaceChildren(canvas);setStatus(`${state.items.length}개 준비됨`)}catch(error){console.error(error);setStatus('미리보기를 만들지 못했습니다.')}
}
function blobFromCanvas(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지 변환 실패')),type,quality))}
function extension(type){return type==='image/png'?'png':type==='image/webp'?'webp':'jpg'}
function outputName(file,type){const base=file.name.replace(/\.[^.]+$/,'');return `${base}${els.suffix.value||''}.${extension(type)}`}
function saveBlob(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)}

async function exportOne(index=state.selected,download=true){
  const item=state.items[index];if(!item)return null;const options=outputOptions();const canvas=await compose(item,options);const blob=await blobFromCanvas(canvas,options.type,options.quality);
  if(download)saveBlob(blob,outputName(item.file,options.type));return {blob,name:outputName(item.file,options.type)};
}
async function exportAll(){
  if(!state.items.length)return;const JSZip=await waitForGlobal('JSZip');if(!JSZip){setStatus('ZIP 도구를 불러오지 못했습니다.');return}
  els.all.disabled=true;const zip=new JSZip();
  try{for(let index=0;index<state.items.length;index++){setStatus(`${index+1}/${state.items.length} 변환 중…`);const result=await exportOne(index,false);zip.file(result.name,result.blob)}setStatus('ZIP 압축 중…');const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});saveBlob(blob,'matchcamera-resized.zip');setStatus('전체 저장 완료')}catch(error){console.error(error);setStatus('전체 저장 중 오류가 발생했습니다.')}finally{els.all.disabled=false}
}
function selectManual(kind){
  const item=state.items[state.selected];if(!item)return;const input=kind==='body'?els.body:els.lens;const list=kind==='body'?state.bodies:state.lenses;item[kind]=findProduct(input.value,list);if(!item[kind]&&input.value.trim())item[`${kind}Raw`]=input.value.trim();renderSelected();
}
function clearAll(){for(const item of state.items)item.image?.close?.();state.items=[];state.selected=-1;state.renderToken++;refreshQueue();syncSelection();updateActions();renderSelected();setStatus('사진을 선택하세요.')}

els.files.addEventListener('change',event=>addFiles(event.target.files));
for(const eventName of ['dragenter','dragover'])els.drop.addEventListener(event=>{event.preventDefault();els.drop.classList.add('dragging')});
for(const eventName of ['dragleave','drop'])els.drop.addEventListener(event=>{event.preventDefault();els.drop.classList.remove('dragging')});
els.drop.addEventListener('drop',event=>addFiles(event.dataTransfer.files));
els.queue.addEventListener('click',event=>{const button=event.target.closest('[data-index]');if(!button)return;state.selected=Number(button.dataset.index);refreshQueue();syncSelection();renderSelected()});
els.body.addEventListener('change',()=>selectManual('body'));els.lens.addEventListener('change',()=>selectManual('lens'));
els.applyAll.addEventListener('click',()=>{const current=state.items[state.selected];if(!current)return;for(const item of state.items){item.body=current.body;item.lens=current.lens;item.bodyRaw=current.bodyRaw;item.lensRaw=current.lensRaw}setStatus('현재 장비를 모든 사진에 적용했습니다.');renderSelected()});
els.clear.addEventListener('click',clearAll);els.current.addEventListener('click',async()=>{els.current.disabled=true;setStatus('현재 사진 저장 중…');try{await exportOne();setStatus('현재 사진 저장 완료')}finally{els.current.disabled=false}});els.all.addEventListener('click',exportAll);
for(const control of [els.longEdge,els.format,els.quality,els.equipment,els.equipmentImages,els.settings,els.theme])control.addEventListener('change',renderSelected);

await initializeProducts();
