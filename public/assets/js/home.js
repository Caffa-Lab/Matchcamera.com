import {loadProducts, money, productLabel, brandLogoUrl} from './data.js';

const $ = s => document.querySelector(s);
const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaultBanners = [1,2,3,4].map(slot=>({slot,src:`/assets/images/banner/Banner${slot}.webp`,href:'',alt:`Matchcamera Banner ${slot}`,enabled:true}));

let slides = [];
let available = [];
let bannerIndex = 0;
let timer = null;

async function loadHomeConfig(){
  try{
    const response=await fetch('/data/home-config.json',{cache:'no-cache'});
    if(response.ok) return await response.json();
  }catch(error){ console.warn('홈 설정을 불러오지 못했습니다.',error); }
  return {banners:defaultBanners,featuredBodyIds:[],featuredLensIds:[]};
}

function safeBannerSrc(value){
  const src=String(value||'').trim();
  return /^\/assets\/images\/banner\/Banner[1-4]\.(?:webp|png|jpe?g|avif)$/i.test(src)?src:'';
}
function safeBannerHref(value){
  const href=String(value||'').trim();
  if(!href)return '';
  if(href.startsWith('/')&&!href.startsWith('//'))return href;
  try{const url=new URL(href);return url.protocol==='https:'?url.href:''}catch{return ''}
}

function renderBanners(config){
  document.querySelectorAll('.banner-slide').forEach(slide=>slide.remove());
  clearInterval(timer);
  bannerIndex=0;
  const items=(Array.isArray(config?.banners)?config.banners:defaultBanners)
    .map(item=>({...item,src:safeBannerSrc(item?.src),href:safeBannerHref(item?.href)}))
    .filter(item=>item&&item.enabled!==false&&item.src)
    .sort((a,b)=>Number(a.slot||0)-Number(b.slot||0));
  const markup=items.map((item,index)=>{
    const tag=item.href?'a':'div';
    const href=item.href?` href="${esc(item.href)}"`:'';
    return `<${tag} class="banner-slide ${index===0?'active':''}"${href} data-banner-index="${index}"><img src="${esc(item.src)}" alt="${esc(item.alt||`Matchcamera Banner ${item.slot||index+1}`)}"></${tag}>`;
  }).join('');
  $('#bannerTrack').insertAdjacentHTML('afterbegin',markup);
  slides=[...document.querySelectorAll('.banner-slide')];
  slides.forEach(slide=>{
    const img=slide.querySelector('img');
    img.addEventListener('error',()=>{slide.classList.add('is-missing');refreshBanners();},{once:true});
    img.addEventListener('load',()=>refreshBanners(),{once:true});
    if(img.complete&&!img.naturalWidth) slide.classList.add('is-missing');
  });
  refreshBanners();
  startTimer();
}

function refreshBanners(){
  available=slides.filter(slide=>!slide.classList.contains('is-missing'));
  $('#bannerFallback').hidden=available.length>0;
  $('#bannerPrev').hidden=available.length<=1;
  $('#bannerNext').hidden=available.length<=1;
  $('#bannerDots').innerHTML=available.map((_,i)=>`<button class="banner-dot ${i===bannerIndex?'active':''}" data-dot="${i}" type="button" aria-label="${i+1}번 배너"></button>`).join('');
  showBanner(Math.min(bannerIndex,Math.max(0,available.length-1)),false);
}

function showBanner(index,restart=true){
  if(!available.length)return;
  bannerIndex=(index+available.length)%available.length;
  slides.forEach(slide=>slide.classList.remove('active'));
  available[bannerIndex].classList.add('active');
  document.querySelectorAll('.banner-dot').forEach((dot,i)=>dot.classList.toggle('active',i===bannerIndex));
  if(restart)startTimer();
}
function startTimer(){clearInterval(timer);if(available.length>1)timer=setInterval(()=>showBanner(bannerIndex+1,false),5500)}
$('#bannerPrev').addEventListener('click',()=>showBanner(bannerIndex-1));
$('#bannerNext').addEventListener('click',()=>showBanner(bannerIndex+1));
$('#bannerDots').addEventListener('click',event=>{const dot=event.target.closest('[data-dot]');if(dot)showBanner(Number(dot.dataset.dot))});

const preferredBodies={
  Sony:['Sony α7 V','Sony α7 IV'],Canon:['Canon EOS R6 Mark III','Canon EOS R5 Mark II','Canon EOS R5'],
  Nikon:['Nikon Z6III','Nikon Z8','Nikon Z 6II'],Fujifilm:['Fujifilm X-H2','Fujifilm X-T5','Fujifilm X-H2S'],
};
const preferredLenses={
  Sony:['Sony FE 24-70mm F2.8 GM II'],Canon:['Canon RF24-70mm F2.8 L IS USM'],
  Nikon:['Nikon NIKKOR Z 24-70mm F2.8 S II','Nikon NIKKOR Z 24-70mm F2.8 S'],
  Fujifilm:['Fujifilm XF16-55mmF2.8 R LM WR II','Fujifilm XF16-55mmF2.8 R LM WR'],
};

function pickPreferred(products,brand,names,type){
  for(const name of names){const hit=products.find(p=>p.type===type&&p.manufacturer===brand&&productLabel(p)===name);if(hit)return hit}
  return products.filter(p=>p.type===type&&p.manufacturer===brand&&p.currentSale==='예').sort((a,b)=>(b.releaseYear||0)-(a.releaseYear||0))[0]
    ||products.filter(p=>p.type===type&&p.manufacturer===brand).sort((a,b)=>(b.releaseYear||0)-(a.releaseYear||0))[0];
}

function configuredProducts(products,ids,type,fallbackMap){
  const chosen=[];
  for(const id of Array.isArray(ids)?ids:[]){const hit=products.find(p=>p.id===id&&p.type===type);if(hit&&!chosen.includes(hit))chosen.push(hit)}
  if(chosen.length<4){
    for(const brand of ['Sony','Canon','Nikon','Fujifilm']){
      const hit=pickPreferred(products,brand,fallbackMap[brand],type);
      if(hit&&!chosen.includes(hit))chosen.push(hit);
      if(chosen.length>=4)break;
    }
  }
  return chosen.slice(0,4);
}

function visual(p){
  const photo=p.imageSrc?`<img class="product-image" src="${esc(p.imageSrc)}" alt="${esc(productLabel(p))}" onerror="this.remove();this.parentElement.classList.add('show-brand')">`:'';
  return `<div class="featured-visual ${p.imageSrc?'':'show-brand'}">${photo}<img class="brand-logo-fallback" src="${esc(brandLogoUrl(p.manufacturer))}" alt="${esc(p.manufacturer)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="featured-brand-text" hidden>${esc(p.manufacturer)}</span></div>`;
}
function card(p){
  const format=p.type==='바디'?(p.sensorFormat||p.cameraSystem||''):(p.focalLength||p.lensFormat||'');
  return `<a class="featured-card" href="/database/?q=${encodeURIComponent(productLabel(p))}">${visual(p)}<small>${esc(p.manufacturer)} · ${esc(p.mount||'')}</small><h3>${esc(productLabel(p))}</h3><div class="featured-meta">${esc(format)}${p.releaseYear?` · ${p.releaseYear}`:''}</div><div class="featured-price">${esc(money(p.currentPriceKrw))}</div></a>`;
}

try{
  const [config,products]=await Promise.all([loadHomeConfig(),loadProducts()]);
  renderBanners(config);
  const bodies=configuredProducts(products,config.featuredBodyIds,'바디',preferredBodies);
  const lenses=configuredProducts(products,config.featuredLensIds,'렌즈',preferredLenses);
  $('#featuredBodies').innerHTML=bodies.map(card).join('');
  $('#featuredLenses').innerHTML=lenses.map(card).join('');
}catch(error){
  console.error(error);
  renderBanners({banners:defaultBanners});
  $('#featuredBodies').innerHTML='<div class="simple-card">제품 DB를 불러오지 못했습니다.</div>';
  $('#featuredLenses').innerHTML='';
}
