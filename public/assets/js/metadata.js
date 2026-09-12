import { buildMetadataCaptions } from './metadata-captions.js?v=20260912-sony-restore';

const dropzone=document.querySelector('#dropzone');
const fileInput=document.querySelector('#fileInput');
const list=document.querySelector('#list');
const status=document.querySelector('#status');
const resultCount=document.querySelector('#resultCount');
const emptyResults=document.querySelector('#emptyResults');
const clearResults=document.querySelector('#clearResults');
const previewUrls=new Set();
let renderedCount=0;
let generation=0;
let activeBatches=0;
let exifLibrary;

function fileSize(bytes){
  if(bytes<1024)return `${bytes} B`;
  if(bytes<1024*1024)return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function releasePreview(url){URL.revokeObjectURL(url);previewUrls.delete(url);}
function feedback(button,label){
  button.textContent='복사됨';button.classList.add('copied');
  setTimeout(()=>{button.textContent=label;button.classList.remove('copied');},1400);
}
async function copy(text,button,label){
  if(!text)return;
  try{await navigator.clipboard.writeText(text);feedback(button,label);}
  catch{button.textContent='복사 실패';setTimeout(()=>button.textContent=label,1400);}
}
function captionBlock(label,fileName){
  const block=document.createElement('section');block.className=`metadata-caption metadata-caption-${label}`;
  block.setAttribute('aria-label',label==='insta'?'인스타그램 문구':'블로그 문구');
  const preview=document.createElement('p');preview.className='metadata-caption-text';preview.textContent='메타데이터를 읽는 중입니다…';
  const button=document.createElement('button');button.className='metadata-action';button.type='button';button.textContent=label;button.disabled=true;
  button.setAttribute('aria-label',`${fileName} ${label==='insta'?'인스타그램':'블로그'} 문구 복사`);
  button.addEventListener('click',()=>copy(preview.textContent,button,label));
  block.append(preview,button);
  return {block,preview,button};
}
function updateResultState(){
  resultCount.textContent=`${renderedCount}개`;
  emptyResults.hidden=renderedCount>0;
  clearResults.hidden=renderedCount===0;
}
function waitForExif(){
  return exifLibrary ||= import('../vendor/exifr-full.esm.js').catch(()=>{
    exifLibrary=null;
    throw new Error('메타데이터 분석 라이브러리를 불러오지 못했습니다. 다시 시도해 주세요.');
  });
}
async function renderFile(file,exifr,batchGeneration){
  const objectUrl=URL.createObjectURL(file);previewUrls.add(objectUrl);
  const item=document.createElement('article');item.className='metadata-item';item.setAttribute('aria-busy','true');
  const head=document.createElement('div');head.className='metadata-filehead';
  const image=document.createElement('img');image.className='metadata-thumb';image.alt='';
  image.addEventListener('load',()=>releasePreview(objectUrl),{once:true});
  image.addEventListener('error',()=>{image.removeAttribute('src');image.alt='미리보기 없음';releasePreview(objectUrl);},{once:true});
  image.src=objectUrl;
  const fileInfo=document.createElement('div');fileInfo.className='metadata-file-info';
  const filename=document.createElement('h3');filename.className='metadata-filename';filename.textContent=file.name;
  const details=document.createElement('div');details.className='metadata-file-meta';details.textContent=`${file.type||'이미지 파일'} · ${fileSize(file.size)}`;
  fileInfo.append(filename,details);head.append(image,fileInfo);
  const insta=captionBlock('insta',file.name),blog=captionBlock('blog',file.name);
  item.append(head,insta.block,blog.block);list.append(item);renderedCount++;updateResultState();
  try{
    const exif=await exifr.parse(file,{exif:true,tiff:true,ifd0:true});
    if(batchGeneration!==generation)return;
    const captions=buildMetadataCaptions(exif);
    if(!captions.hasMetadata){
      insta.preview.textContent='이 사진에 저장된 카메라·렌즈 정보가 없습니다.';
      blog.preview.textContent='이 사진에 저장된 촬영 정보가 없습니다.';
      item.classList.add('is-empty');
      return;
    }
    insta.preview.textContent=captions.instagram||'이 사진에 저장된 카메라·렌즈 정보가 없습니다.';
    blog.preview.textContent=captions.blog||'이 사진에 저장된 촬영 정보가 없습니다.';
    insta.button.disabled=!captions.instagram;
    blog.button.disabled=!captions.blog;
  }catch(error){
    if(batchGeneration!==generation)return;
    item.classList.add('is-error');
    insta.preview.textContent='이 파일의 메타데이터를 읽지 못했습니다.';
    blog.preview.textContent='파일 형식 또는 촬영 정보 포함 여부를 확인해 주세요.';
    console.error(error);
  }finally{item.setAttribute('aria-busy','false');}
}
async function handleFiles(files){
  const images=[...files].filter(file=>file.type.startsWith('image/')||/\.(heic|heif|tif|tiff|arw|cr2|cr3|nef|nrw|raf|orf|rw2|pef|dng)$/i.test(file.name));
  if(!images.length){status.textContent='지원하는 이미지 파일이 없습니다.';return;}
  const batchGeneration=generation;activeBatches++;
  status.textContent=`${images.length}개 파일 처리 중…`;
  try{
    const exifr=await waitForExif();
    for(const file of images){
      if(batchGeneration!==generation)break;
      await renderFile(file,exifr,batchGeneration);
    }
    if(batchGeneration===generation&&activeBatches===1)status.textContent='완료';
  }catch(error){if(batchGeneration===generation)status.textContent=error.message||'처리하지 못했습니다.';}
  finally{if(batchGeneration===generation)activeBatches--;}
}
function prevent(event){event.preventDefault();event.stopPropagation();}
['dragenter','dragover','dragleave','drop'].forEach(name=>dropzone.addEventListener(name,prevent));
dropzone.addEventListener('dragover',()=>dropzone.classList.add('dragover'));
dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop',event=>{dropzone.classList.remove('dragover');handleFiles(event.dataTransfer.files);});
dropzone.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('label')){event.preventDefault();fileInput.click();}});
dropzone.addEventListener('click',event=>{if(!event.target.closest('label'))fileInput.click();});
fileInput.addEventListener('change',event=>{handleFiles(event.target.files);fileInput.value='';});
clearResults.addEventListener('click',()=>{
  generation++;activeBatches=0;previewUrls.forEach(releasePreview);
  list.replaceChildren();renderedCount=0;status.textContent='준비됨';updateResultState();
});
updateResultState();
