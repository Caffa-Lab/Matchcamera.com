const dropzone=document.querySelector('#dropzone');
const fileInput=document.querySelector('#fileInput');
const list=document.querySelector('#list');
const status=document.querySelector('#status');
const resultCount=document.querySelector('#resultCount');
const emptyResults=document.querySelector('#emptyResults');
const clearResults=document.querySelector('#clearResults');
let renderedCount=0;

const boldMap={a:'𝗮',b:'𝗯',c:'𝗰',d:'𝗱',e:'𝗲',f:'𝗳',g:'𝗴',h:'𝗵',i:'𝗶',j:'𝗷',k:'𝗸',l:'𝗹',m:'𝗺',n:'𝗻',o:'𝗼',p:'𝗽',q:'𝗾',r:'𝗿',s:'𝘀',t:'𝘁',u:'𝘂',v:'𝘃',w:'𝘄',x:'𝘅',y:'𝘆',z:'𝘇','0':'𝟬','1':'𝟭','2':'𝟮','3':'𝟯','4':'𝟰','5':'𝟱','6':'𝟲','7':'𝟳','8':'𝟴','9':'𝟵'};
const italicMap={a:'𝙖',b:'𝙗',c:'𝙘',d:'𝙙',e:'𝙚',f:'𝙛',g:'𝙜',h:'𝙝',i:'𝙞',j:'𝙟',k:'𝙠',l:'𝙡',m:'𝙢',n:'𝙣',o:'𝙤',p:'𝙥',q:'𝙦',r:'𝙧',s:'𝙨',t:'𝙩',u:'𝙪',v:'𝙫',w:'𝙬',x:'𝙭',y:'𝙮',z:'𝙯'};
const mapText=(text,letters,digits=letters)=>String(text||'').toLowerCase().split('').map(char=>letters[char]||digits[char]||char).join('');
const bold=text=>mapText(text,boldMap);
const italic=text=>mapText(text,italicMap,{});
const italicBoldDigits=text=>mapText(text,italicMap,boldMap);
const compact=text=>String(text||'').toLowerCase().replace(/[^a-z0-9]/g,'');

function numberValue(value){
  if(value&&typeof value==='object'&&'numerator'in value&&'denominator'in value)return value.numerator/value.denominator;
  return Number(value);
}
function exposure(value){
  const n=numberValue(value);
  if(!Number.isFinite(n)||n<=0)return '—';
  return n>=1?`${Math.round(n*10)/10} s`:`1/${Math.round(1/n)} s`;
}
function aperture(value){
  const n=numberValue(value);
  return Number.isFinite(n)&&n>0?`f/${Math.round(n*10)/10}`:'—';
}
function fileSize(bytes){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function cameraBrand(make,model){
  const value=`${make||''} ${model||''}`;
  if(/sony|ilce/i.test(value))return'sony';
  if(/canon/i.test(value))return'canon';
  if(/nikon/i.test(value))return'nikon';
  if(/fujifilm/i.test(value))return'fujifilm';
  if(/panasonic|lumix/i.test(value))return'lumix';
  if(/leica/i.test(value))return'leica';
  if(/olympus|om system|om-d|omd/i.test(value))return'omsystem';
  if(/hasselblad/i.test(value))return'hasselblad';
  return'other';
}
function shortBody(model){
  const value=String(model||'').toUpperCase().trim();
  if(/ILCE-7M4|A7M4|A7 IV/.test(value))return'a7m4';
  if(/ILCE-7RM5|A7R ?V|A7R5/.test(value))return'a7r5';
  if(/ILCE-1\b|\bA1\b/.test(value))return'a1';
  if(/ILCE-9M3|A9 ?III/.test(value))return'a9iii';
  if(/EOS\s*R[A-Z0-9]/i.test(value)){
    const base=value.replace(/^CANON\s*/,'').replace(/\s+/g,'').toLowerCase();
    const mark=base.match(/mark(i{1,3}|iv|v)/i);
    if(mark){
      const numeral={I:'1',II:'2',III:'3',IV:'4',V:'5'}[mark[1].toUpperCase()]||'';
      return base.replace(/mark(i{1,3}|iv|v)/i,`m${numeral}`);
    }
    return base.replace(/[^a-z0-9]/g,'');
  }
  return value.replace(/[^A-Z0-9]/g,'').toLowerCase()||'camera';
}
function shortLens(lens,brand){
  const value=String(lens||'').toUpperCase();
  const range=value.match(/(\d{2,3})\s*-\s*(\d{2,3})\s*MM/);
  const prime=value.match(/(\d{2,3})\s*MM/);
  if(brand==='sony'){
    const gm=/\bGM\b/.test(value)?'gm':'';
    const mark=/\bII\b|\b2\b/.test(value)?'2':'';
    if(range)return`sel${range[1]}${range[2]}${gm}${mark}`.toLowerCase();
    if(prime)return`sel${prime[1]}${gm}${mark}`.toLowerCase();
  }
  if(brand==='canon'){
    const l=/\bL\b/.test(value)?'l':'';
    if(/RF\s*/.test(value))return(range?`rf${range[1]}${range[2]}${l}`:prime?`rf${prime[1]}${l}`:'lens').toLowerCase();
    if(/EF(-S)?\s*/.test(value)){
      const prefix=/EF-S/.test(value)?'efs':'ef';
      return(range?`${prefix}${range[1]}${range[2]}${l}`:prime?`${prefix}${prime[1]}${l}`:'lens').toLowerCase();
    }
  }
  if(range)return`${range[1]}${range[2]}`;
  if(prime)return prime[1];
  return value.replace(/[^A-Z0-9]/g,'').toLowerCase()||'lens';
}
function isPhone(make,model){return/(iphone|apple|samsung|galaxy|pixel|google|huawei|xiaomi|mi\s|redmi|oneplus|oppo|vivo|honor)/i.test(`${make||''} ${model||''}`);}
function phoneInfo(make,model){
  const mk=String(make||'').toLowerCase(),md=String(model||'').toLowerCase();
  const samsungCodes={'sm-f700':'galaxyzflip','sm-f707':'galaxyzflip5g','sm-f711':'galaxyzflip3','sm-f721':'galaxyzflip4','sm-f731':'galaxyzflip5','sm-f741':'galaxyzflip6','sm-f916':'galaxyzfold2','sm-f926':'galaxyzfold3','sm-f936':'galaxyzfold4','sm-f946':'galaxyzfold5','sm-f956':'galaxyzfold6','sm-s911':'galaxys23','sm-s916':'galaxys23plus','sm-s918':'galaxys23ultra','sm-s921':'galaxys24','sm-s926':'galaxys24plus','sm-s928':'galaxys24ultra'};
  if(mk.includes('samsung')||/galaxy/i.test(model||'')){
    const code=(md.match(/sm-[a-z0-9]+/i)||[''])[0].toLowerCase();
    const name=samsungCodes[code]||(md.includes('fold')?'galaxyzfold':md.includes('flip')?'galaxyzflip':compact(model)||'galaxy');
    return{display:name,tags:`#samsung #${name}`};
  }
  if(mk.includes('apple')||/iphone/i.test(model||'')){const name=`iphone${compact(String(model||'').replace(/apple|iphone/gi,''))}`;return{display:name||'iphone',tags:`#apple #${name||'iphone'}`};}
  if(mk.includes('google')||/pixel/i.test(model||'')){const name=`pixel${compact(String(model||'').replace(/google|pixel/gi,''))}`;return{display:name||'pixel',tags:`#google #${name||'pixel'}`};}
  const brand=compact(make)||'phone',name=compact(model)||'phone';
  return{display:name,tags:`#${brand} #${name}`};
}
function brandTags(brand){
  if(brand==='sony')return'#sony #sonyalpha #sonykorea';
  if(brand==='canon')return'#canon #canonphotography #canonkr';
  if(brand==='hasselblad')return'#hasselblad #hasselbladxsystem';
  return'';
}
function row(label,value='읽는 중…'){
  const element=document.createElement('div');element.className='metadata-row';
  const name=document.createElement('span');name.className='metadata-label';name.textContent=label;
  const content=document.createElement('span');content.className='metadata-value';content.textContent=value;
  element.append(name,content);return element;
}
function feedback(button,label){
  button.textContent='복사됨';button.classList.add('copied');
  setTimeout(()=>{button.textContent=label;button.classList.remove('copied');},1400);
}
async function copy(text,button,label){
  try{await navigator.clipboard.writeText(text);feedback(button,label);}
  catch{button.textContent='실패';setTimeout(()=>button.textContent=label,1400);}
}
function updateResultState(){
  resultCount.textContent=`${renderedCount}개`;
  emptyResults.hidden=renderedCount>0;
  clearResults.hidden=renderedCount===0;
}
function waitForExif(){
  if(globalThis.exifr?.parse)return Promise.resolve(globalThis.exifr);
  return new Promise((resolve,reject)=>{
    let attempts=0;
    const timer=setInterval(()=>{
      if(globalThis.exifr?.parse){clearInterval(timer);resolve(globalThis.exifr);}
      else if(++attempts>50){clearInterval(timer);reject(new Error('메타데이터 분석 라이브러리를 불러오지 못했습니다.'));}
    },100);
  });
}
async function renderFile(file,exifr){
  const objectUrl=URL.createObjectURL(file);
  const item=document.createElement('article');item.className='metadata-item';
  const actions=document.createElement('div');actions.className='metadata-actions';
  const blogButton=document.createElement('button');blogButton.className='metadata-action';blogButton.type='button';blogButton.textContent='blog';
  const instaButton=document.createElement('button');instaButton.className='metadata-action';instaButton.type='button';instaButton.textContent='insta';
  const copyButton=document.createElement('button');copyButton.className='metadata-action';copyButton.type='button';copyButton.textContent='복사';
  actions.append(blogButton,instaButton,copyButton);
  const head=document.createElement('div');head.className='metadata-filehead';
  const image=document.createElement('img');image.className='metadata-thumb';image.src=objectUrl;image.alt='';
  image.addEventListener('error',()=>{image.removeAttribute('src');image.alt='미리보기 없음';},{once:true});
  const fileInfo=document.createElement('div');fileInfo.className='metadata-file-info';
  const filename=document.createElement('div');filename.className='metadata-filename';filename.textContent=file.name;
  const details=document.createElement('div');details.className='metadata-file-meta';details.textContent=`${file.type||'이미지 파일'} · ${fileSize(file.size)}`;
  fileInfo.append(filename,details);head.append(image,fileInfo);
  const body=document.createElement('div');
  ['카메라','렌즈','ISO','셔터스피드','조리개'].forEach(label=>body.append(row(label)));
  item.append(actions,head,body);list.prepend(item);renderedCount++;updateResultState();
  try{
    const exif=await exifr.parse(file,{exif:true,tiff:true,ifd0:true});
    const make=exif?.Make||'',model=exif?.Model||'';
    const lens=exif?.LensModel||exif?.LensMake||exif?.Lens||'';
    const iso=exif?.ISO?String(exif.ISO):'—';
    const shutter=exposure(exif?.ExposureTime??exif?.ShutterSpeedValue);
    const fNumber=aperture(exif?.FNumber??exif?.ApertureValue);
    const phone=isPhone(make,model)?phoneInfo(make,model):null;
    const brand=cameraBrand(make,model),hasLens=Boolean(lens&&lens!=='—');
    const camera=[make,model].filter(Boolean).join(' ')||'—';
    const displayLens=phone?'—':hasLens?lens:'—';
    const values=[camera,displayLens,iso,shutter,fNumber];
    body.querySelectorAll('.metadata-value').forEach((element,index)=>element.textContent=values[index]);
    copyButton.addEventListener('click',()=>copy(`파일명: ${file.name}\n카메라: ${camera}\n렌즈: ${displayLens}\nISO: ${iso}\n셔터스피드: ${shutter}\n조리개: ${fNumber}`,copyButton,'복사'));
    instaButton.addEventListener('click',()=>{
      if(phone)return copy(`📷${bold(phone.display)}\n\n${phone.tags}`,instaButton,'insta');
      const cameraShort=shortBody(model||camera),lensShort=hasLens?shortLens(lens,brand):'';
      const tags=[brandTags(brand),`#${cameraShort}${hasLens?` #${lensShort}`:''}`].filter(Boolean).join('\n');
      copy(`📷${bold(cameraShort)}${hasLens?` + ${italicBoldDigits(lensShort)}`:''}\n\n${tags}`,instaButton,'insta');
    });
    blogButton.addEventListener('click',()=>{
      if(phone)return copy(bold(phone.display),blogButton,'blog');
      const cameraShort=shortBody(model||camera),lensShort=hasLens?shortLens(lens,brand):'';
      copy(`${bold(cameraShort)}${hasLens?` + ${italic(lensShort)}`:''}`,blogButton,'blog');
    });
  }catch(error){
    body.querySelectorAll('.metadata-value').forEach(element=>element.textContent='—');
    item.classList.add('is-error');
    const message=document.createElement('div');message.className='metadata-error';message.textContent='이 파일에서 EXIF 메타데이터를 읽지 못했습니다. 파일 형식 또는 메타데이터 포함 여부를 확인해 주세요.';item.append(message);
    console.error(error);
  }finally{setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);}
}
async function handleFiles(files){
  const images=[...files].filter(file=>file.type.startsWith('image/')||/\.(heic|heif|tif|tiff|arw|cr2|nef)$/i.test(file.name));
  if(!images.length){status.textContent='지원하는 이미지 파일이 없습니다.';return;}
  status.textContent=`${images.length}개 파일 처리 중…`;
  try{
    const exifr=await waitForExif();
    for(const file of images)await renderFile(file,exifr);
    status.textContent='완료';
  }catch(error){status.textContent=error.message||'처리하지 못했습니다.';}
}
function prevent(event){event.preventDefault();event.stopPropagation();}
['dragenter','dragover','dragleave','drop'].forEach(name=>dropzone.addEventListener(name,prevent));
dropzone.addEventListener('dragover',()=>dropzone.classList.add('dragover'));
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop',event=>{dropzone.classList.remove('dragover');handleFiles(event.dataTransfer.files);});
dropzone.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('label')){event.preventDefault();fileInput.click();}});
dropzone.addEventListener('click',event=>{if(!event.target.closest('label'))fileInput.click();});
fileInput.addEventListener('change',event=>{handleFiles(event.target.files);fileInput.value='';});
clearResults.addEventListener('click',()=>{list.replaceChildren();renderedCount=0;status.textContent='준비됨';updateResultState();});
updateResultState();
