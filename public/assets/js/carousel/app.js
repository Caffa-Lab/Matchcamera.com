import {computeCrop, renderOverview, renderTile, canvasToJpeg, outputName} from './renderer.js?v=20260915-tools';
import {trackUsage} from '../usage-events.js?v=20260915-tools';

const $ = id => document.getElementById(id);
const state = {photo:null, watermark:null, outputs:[], busy:false, cancelled:false, mode:'crop', slide:0, overview:null, drag:null};
const clamp = n => Math.max(0, Math.min(1, n));
const status = message => { $('exportStatus').textContent = message; };
const yieldPaint = () => new Promise(resolve => setTimeout(resolve, 0));

function options() {
  return {
    count:Number($('panelCount').value), ratio:$('panelRatio').value, tileWidth:Number($('tileWidth').value),
    offsetX:Number($('offsetX').value)/100, offsetY:Number($('offsetY').value)/100,
    watermark:{enabled:$('watermarkEnabled').checked, kind:$('watermarkKind').value,
      text:$('watermarkText').value.trim(), color:$('watermarkColor').value, position:$('watermarkPosition').value,
      size:Number($('watermarkSize').value), margin:Number($('watermarkMargin').value), opacity:Number($('watermarkOpacity').value)/100},
  };
}

function disposePhoto(photo) {
  if (!photo) return;
  if (typeof photo.image.close === 'function') photo.image.close();
  else if (photo.image instanceof HTMLCanvasElement) photo.image.width = photo.image.height = 1;
  else photo.image.src = '';
}

function discardOutputs() {
  for (const item of state.outputs) URL.revokeObjectURL(item.url);
  state.outputs = [];
  $('outputList').replaceChildren();
  $('zipButton').disabled = true;
}

function syncControls() {
  const o = options(), photo = state.photo;
  $('previewCount').textContent = `${o.count}장`;
  const [rw,rh] = o.ratio.split(':').map(Number);
  $('outputSize').textContent = `장당 ${o.tileWidth} × ${Math.round(o.tileWidth*rh/rw)}px`;
  for (const [control, label] of [['offsetX','offsetXValue'],['offsetY','offsetYValue'],['watermarkSize','watermarkSizeValue'],['watermarkMargin','watermarkMarginValue'],['watermarkOpacity','watermarkOpacityValue']]) {
    $(label).textContent = `${Number($(control).value)}%`;
  }
  $('settingsFields').disabled = state.busy;
  $('watermarkFields').disabled = state.busy || !o.watermark.enabled;
  $('textWatermarkFields').hidden = o.watermark.kind !== 'text';
  $('imageWatermarkFields').hidden = o.watermark.kind !== 'image';
  for (const id of ['dropPhoto','photoFile','sampleButton','clearPhoto','cropView','swipeView']) $(id).disabled = state.busy;
  $('exportButton').disabled = state.busy || !photo;
  $('zipButton').disabled = state.busy || !state.outputs.length;
  $('centerCrop').disabled = state.busy || !photo;
  if (photo) {
    const c = computeCrop(photo.image.width || photo.image.naturalWidth, photo.image.height || photo.image.naturalHeight, o);
    const canX = photo.image.width - c.width > 1, canY = photo.image.height - c.height > 1;
    $('offsetX').disabled = state.busy || !canX;
    $('offsetY').disabled = state.busy || !canY;
    $('positionHint').textContent = canX ? '현재 비율에서는 가로 위치를 조절할 수 있습니다.' : canY ? '현재 비율에서는 세로 위치를 조절할 수 있습니다.' : '원본 전체가 선택되어 위치를 조절할 필요가 없습니다.';
  } else {
    $('offsetX').disabled = $('offsetY').disabled = true;
  }
}

async function decodeFile(file, maxBytes, maxPixels, maxEdge) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('JPEG·PNG·WebP 사진을 선택해 주세요.');
  if (!file.size || file.size > maxBytes) throw new Error(`파일 크기는 ${maxBytes/1e6}MB 이하여야 합니다.`);
  const url = URL.createObjectURL(file), img = new Image();
  try {
    img.src = url;
    await img.decode();
    const width = img.naturalWidth, height = img.naturalHeight;
    if (!width || !height || width*height > 160_000_000) throw new Error('사진 해상도가 너무 큽니다. 작은 사본을 선택해 주세요.');
    const scale = Math.min(1, maxEdge/Math.max(width,height), Math.sqrt(maxPixels/(width*height)));
    const w = Math.max(1,Math.floor(width*scale)), h = Math.max(1,Math.floor(height*scale));
    let image;
    if (typeof createImageBitmap === 'function') {
      try { image = await createImageBitmap(img, {resizeWidth:w, resizeHeight:h, resizeQuality:'high'}); } catch { /* Use a bounded canvas if bitmap decoding is unsupported. */ }
    }
    if (!image) {
      image = document.createElement('canvas'); image.width = w; image.height = h;
      const ctx = image.getContext('2d');
      if (!ctx) throw new Error('사진을 처리할 메모리가 부족합니다. 작은 사진으로 다시 시도해 주세요.');
      ctx.drawImage(img,0,0,w,h);
    }
    return {image, name:file.name, originalWidth:width, originalHeight:height, scaled:scale<1};
  } finally { URL.revokeObjectURL(url); img.src=''; }
}

function resetPosition() { $('offsetX').value = $('offsetY').value = '50'; state.slide=0; }

function installPhoto(photo) {
  discardOutputs(); disposePhoto(state.photo); state.photo=photo; resetPosition();
  $('photoSummary').hidden=false;
  $('photoName').textContent=`${photo.name} · ${photo.originalWidth} × ${photo.originalHeight}px`;
  $('loadStatus').textContent=photo.scaled ? `미리보기와 저장에 사용할 사진을 ${photo.image.width} × ${photo.image.height}px로 축소했습니다. 원본 파일은 변경하지 않습니다.` : '사진 준비 완료. 비율과 분할 위치를 확인해 주세요.';
  status('분할 위치를 확인한 뒤 사진을 만들어 주세요.');
}

async function loadPhoto(files) {
  if (state.busy || !files?.length) return;
  state.busy=true; syncControls(); $('loadStatus').textContent='사진을 읽고 있습니다…';
  try { installPhoto(await decodeFile(files[0],80_000_000,32_000_000,8192)); }
  catch (error) { $('loadStatus').textContent=`${error.message || '사진을 읽지 못했습니다.'}${state.photo?' 현재 사진은 유지됩니다.':''}`; }
  finally { state.busy=false; $('photoFile').value=''; syncControls(); schedulePreview(); }
}

// A small built-in illustration lets visitors try the complete flow without selecting a file.
function makeSample() {
  const canvas=document.createElement('canvas');canvas.width=3200;canvas.height=1400;
  const ctx=canvas.getContext('2d');
  const sky=ctx.createLinearGradient(0,0,0,1400);sky.addColorStop(0,'#b4c4ef');sky.addColorStop(.55,'#f6d8c6');sky.addColorStop(1,'#e9e7da');ctx.fillStyle=sky;ctx.fillRect(0,0,3200,1400);
  ctx.fillStyle='#fff1ce';ctx.beginPath();ctx.arc(2420,410,135,0,Math.PI*2);ctx.fill();
  for(const [color,points] of [['#a1b2c3',[[0,760],[340,490],[570,720],[1050,360],[1500,840],[1830,570],[2250,830],[2760,470],[3200,780]]],['#708d9d',[[0,990],[540,680],[980,1080],[1490,720],[2110,1060],[2600,770],[3200,1000]]],['#496e78',[[0,1150],[610,990],[1120,1190],[1710,1040],[2210,1170],[2890,1000],[3200,1130]]]]){
    ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(0,1400);for(const point of points)ctx.lineTo(...point);ctx.lineTo(3200,1400);ctx.closePath();ctx.fill();
  }
  ctx.fillStyle='#f6f7fa';ctx.font='500 34px Arial';ctx.fillText('MATCHCAMERA / SAMPLE PANORAMA',100,1320);
  return {image:canvas,name:'matchcamera-panorama.jpg',originalWidth:3200,originalHeight:1400,scaled:false};
}

let previewFrame=0;
function schedulePreview() {
  syncControls();
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame=requestAnimationFrame(()=>{previewFrame=0;renderPreview();});
}

function drawCropPreview(photo, o) {
  const image=photo.image, w=image.width, h=image.height;
  const c=computeCrop(w,h,o), canvas=$('cropCanvas'), scale=Math.min(1,1200/w,600/h);
  canvas.width=Math.round(w*scale);canvas.height=Math.round(h*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const x=c.x*scale,y=c.y*scale,cw=c.width*scale,ch=c.height*scale;
  ctx.fillStyle='rgba(17,24,46,.58)';ctx.fillRect(0,0,canvas.width,y);ctx.fillRect(0,y+ch,canvas.width,canvas.height-y-ch);ctx.fillRect(0,y,x,ch);ctx.fillRect(x+cw,y,canvas.width-x-cw,ch);
  ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,cw-2,ch-2);
  for(let i=0;i<o.count;i++){
    const left=x+cw*i/o.count;
    if(i){ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(left,y+ch);ctx.stroke();}
    const badge=Math.min(28,cw/o.count*.35);ctx.fillStyle='#655bdc';ctx.fillRect(left+5,y+5,badge,badge);ctx.fillStyle='#fff';ctx.font=`600 ${Math.max(9,badge*.55)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),left+5+badge/2,y+5+badge/2);
  }
  const scaleUp=o.tileWidth/(c.width/o.count);
  const kept=Math.round(c.width*c.height/(w*h)*100);
  $('cropInfo').textContent=`원본 영역 ${kept}% 사용 · ${o.count}장 순서대로 연결${scaleUp>1.05?` · 원본 선택 영역보다 ${scaleUp.toFixed(1)}배 확대되어 선명도가 낮아질 수 있습니다.`:''}`;
  $('cropInfo').classList.toggle('is-warning',scaleUp>1.05);
}

function drawSlide(target,index,width) {
  const o=options(),source=state.overview;
  if(!source)return;
  const sourceWidth=source.width/o.count, sourceHeight=source.height;
  target.width=width;target.height=Math.round(width*sourceHeight/sourceWidth);
  target.getContext('2d').drawImage(source,index*sourceWidth,0,sourceWidth,sourceHeight,0,0,target.width,target.height);
}

function syncSlide() {
  const count=options().count;state.slide=Math.max(0,Math.min(count-1,state.slide));
  $('slideNumber').textContent=`${state.slide+1} / ${count}`;
  $('previousSlide').disabled=state.slide===0||!state.photo||state.busy;
  $('nextSlide').disabled=state.slide===count-1||!state.photo||state.busy;
  $('slideCanvas').setAttribute('aria-label',`${count}장 중 ${state.slide+1}번째 분할 사진`);
  if(state.overview)drawSlide($('slideCanvas'),state.slide,Math.min(720,state.overview.width/count));
  [...$('thumbnailStrip').children].forEach((button,i)=>button.setAttribute('aria-pressed',String(i===state.slide)));
}

function setView(mode) {
  state.mode=mode;
  $('cropView').setAttribute('aria-pressed',String(mode==='crop'));
  $('swipeView').setAttribute('aria-pressed',String(mode==='swipe'));
  $('cropPanel').hidden=!state.photo||mode!=='crop';
  $('swipePanel').hidden=!state.photo||mode!=='swipe';
  $('emptyPreview').hidden=!!state.photo;
  syncSlide();
}

function renderPreview() {
  $('thumbnailStrip').replaceChildren();
  if(state.overview){state.overview.width=state.overview.height=1;state.overview=null;}
  setView(state.mode);
  if(!state.photo){$('cropInfo').textContent='';return;}
  try{
    const o=options();drawCropPreview(state.photo,o);
    const previewOptions={...o,watermark:{...o.watermark,enabled:o.watermark.enabled&&(o.watermark.kind==='text'?!!o.watermark.text:!!state.watermark)}};
    state.overview=renderOverview(state.photo.image,previewOptions,state.watermark?.image,Math.min(3200,o.count*480));
    for(let i=0;i<o.count;i++){
      const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`${i+1}번째 사진 미리보기`);button.disabled=state.busy;
      const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');drawSlide(canvas,i,112);
      const label=document.createElement('span');label.textContent=`${i+1} / ${o.count}`;button.append(canvas,label);
      button.addEventListener('click',()=>{state.slide=i;setView('swipe');});$('thumbnailStrip').append(button);
    }
    syncSlide();
  }catch(error){status(error.message||'미리보기를 만들지 못했습니다.');}
}

function settingsChanged() {
  if(state.busy)return;
  discardOutputs();schedulePreview();
  if(state.photo)status('설정이 바뀌었습니다. 다시 만들면 새 설정으로 저장됩니다.');
}

$('photoFile').addEventListener('change',event=>void loadPhoto(event.target.files));
$('dropPhoto').addEventListener('click',()=>$('photoFile').click());
for(const type of ['dragenter','dragover','dragleave','drop'])$('dropPhoto').addEventListener(type,event=>{
  event.preventDefault();$('dropPhoto').classList.toggle('is-over',type==='dragenter'||type==='dragover');
  if(type==='drop')void loadPhoto(event.dataTransfer.files);
});
$('sampleButton').addEventListener('click',()=>{if(state.busy)return;installPhoto(makeSample());schedulePreview();});
$('clearPhoto').addEventListener('click',()=>{
  if(state.busy)return;discardOutputs();disposePhoto(state.photo);state.photo=null;resetPosition();
  $('photoSummary').hidden=true;$('photoName').textContent='';$('loadStatus').textContent='사진을 선택하거나 예제로 먼저 사용해 보세요.';status('사진을 선택하면 저장할 수 있습니다.');schedulePreview();
});
for(const id of ['panelCount','panelRatio','tileWidth','offsetX','offsetY','watermarkEnabled','watermarkKind','watermarkText','watermarkColor','watermarkPosition','watermarkSize','watermarkMargin','watermarkOpacity'])$(id).addEventListener('input',settingsChanged);
$('centerCrop').addEventListener('click',()=>{resetPosition();settingsChanged();});
$('cropView').addEventListener('click',()=>setView('crop'));
$('swipeView').addEventListener('click',()=>setView('swipe'));
$('previousSlide').addEventListener('click',()=>{state.slide--;syncSlide();});
$('nextSlide').addEventListener('click',()=>{state.slide++;syncSlide();});

let swipeStart=null;
$('swipeFrame').addEventListener('pointerdown',event=>{if(!state.busy&&event.isPrimary)swipeStart={x:event.clientX,y:event.clientY};});
$('swipeFrame').addEventListener('pointerup',event=>{
  if(!swipeStart)return;const dx=event.clientX-swipeStart.x,dy=event.clientY-swipeStart.y;swipeStart=null;
  if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)){state.slide+=dx<0?1:-1;syncSlide();}
});
$('swipeFrame').addEventListener('pointercancel',()=>{swipeStart=null;});

$('cropCanvas').addEventListener('pointerdown',event=>{
  if(state.busy||!state.photo||!event.isPrimary)return;
  const image=state.photo.image,c=computeCrop(image.width,image.height,options()),rect=event.currentTarget.getBoundingClientRect();
  state.drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,offsetX:options().offsetX,offsetY:options().offsetY,scaleX:image.width/rect.width,scaleY:image.height/rect.height,travelX:image.width-c.width,travelY:image.height-c.height};
  event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();
});
$('cropCanvas').addEventListener('pointermove',event=>{
  const d=state.drag;if(!d||d.pointerId!==event.pointerId)return;
  if(d.travelX>1)$('offsetX').value=String(clamp(d.offsetX+(event.clientX-d.x)*d.scaleX/d.travelX)*100);
  if(d.travelY>1)$('offsetY').value=String(clamp(d.offsetY+(event.clientY-d.y)*d.scaleY/d.travelY)*100);
  settingsChanged();
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('cropCanvas').addEventListener(type,()=>{state.drag=null;});
$('cropCanvas').addEventListener('keydown',event=>{
  if(state.busy||!state.photo||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();const step=event.shiftKey?10:1;
  const input=['ArrowLeft','ArrowRight'].includes(event.key)?$('offsetX'):$('offsetY');if(input.disabled)return;
  input.value=String(Number(input.value)+(['ArrowLeft','ArrowUp'].includes(event.key)?-step:step));settingsChanged();
});

$('selectWatermark').addEventListener('click',()=>$('watermarkFile').click());
$('watermarkFile').addEventListener('change',async event=>{
  if(state.busy||!event.target.files.length)return;
  const file=event.target.files[0];state.busy=true;syncControls();
  try{const logo=await decodeFile(file,10_000_000,4_000_000,2048);disposePhoto(state.watermark);state.watermark=logo;$('watermarkName').textContent=logo.name;discardOutputs();}
  catch(error){$('watermarkName').textContent=`${error.message || '워터마크를 읽지 못했습니다.'}${state.watermark?' 현재 워터마크는 유지됩니다.':''}`;}
  finally{event.target.value='';state.busy=false;syncControls();schedulePreview();}
});

$('exportButton').addEventListener('click',async()=>{
  if(state.busy||!state.photo)return;
  const o=options();
  if(o.watermark.enabled&&((o.watermark.kind==='text'&&!o.watermark.text)||(o.watermark.kind==='image'&&!state.watermark))){status(o.watermark.kind==='text'?'워터마크 문구를 입력하거나 워터마크를 꺼주세요.':'워터마크 이미지를 선택하거나 워터마크를 꺼주세요.');return;}
  discardOutputs();state.busy=true;state.cancelled=false;syncControls();$('cancelExport').hidden=false;void trackUsage('tool_start','carousel');
  try{
    for(let i=0;i<o.count;i++){
      if(state.cancelled)break;
      status(`${i+1} / ${o.count}장 만드는 중…`);await yieldPaint();
      const canvas=renderTile(state.photo.image,o,i,state.watermark?.image);
      let blob;try{blob=await canvasToJpeg(canvas,.94);}finally{canvas.width=canvas.height=1;}
      if(state.cancelled)break;
      const name=outputName(state.photo.name,i),url=URL.createObjectURL(blob);state.outputs.push({name,url,blob});
    }
    if(state.cancelled){discardOutputs();status('처리를 중지했습니다. 설정을 확인한 뒤 다시 만들어 주세요.');}
    else{
      for(const item of state.outputs){
        const link=document.createElement('a');link.href=item.url;link.download=item.name;
        const name=document.createElement('span');name.textContent=item.name;const size=document.createElement('small');size.textContent=`${(item.blob.size/1e6).toFixed(2)}MB ↓`;link.append(name,size);
        link.addEventListener('click',()=>{void trackUsage('tool_download','carousel');});$('outputList').append(link);
      }
      status(`${state.outputs.length}장 완료. 번호 순서대로 게시하면 이어집니다.`);void trackUsage('tool_success','carousel');
    }
  }catch(error){discardOutputs();status(`${error.message || '사진을 만들지 못했습니다.'} 작은 출력 크기로 다시 시도해 주세요.`);void trackUsage('tool_failure','carousel');}
  finally{state.busy=false;$('cancelExport').hidden=true;syncControls();syncSlide();}
});
$('cancelExport').addEventListener('click',()=>{state.cancelled=true;status('현재 사진 처리가 끝나면 중지합니다…');});
$('zipButton').addEventListener('click',async()=>{
  if(state.busy||!state.outputs.length)return;
  state.busy=true;syncControls();status('ZIP 파일을 준비하고 있습니다…');
  try{
    if(!window.JSZip)throw new Error('ZIP 기능을 불러오지 못했습니다.');
    const zip=new window.JSZip();for(const item of state.outputs)zip.file(item.name,item.blob);
    const blob=await zip.generateAsync({type:'blob',compression:'STORE'}),url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download=outputName(state.photo.name,0).replace(/_01\.jpg$/,'_carousel.zip');document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60_000);void trackUsage('tool_download','carousel');status('ZIP 저장을 요청했습니다. 개별 사진도 아래에서 저장할 수 있습니다.');
  }catch(error){status(`${error.message || 'ZIP 생성에 실패했습니다.'} 아래 개별 사진 다운로드를 사용해 주세요.`);}
  finally{state.busy=false;syncControls();}
});

syncControls();setView('crop');
