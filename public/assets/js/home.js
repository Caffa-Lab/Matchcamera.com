import {loadProducts, money, productLabel, brandLogoUrl} from './data.js';

const $ = s => document.querySelector(s);
const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Banner: Banner1~4 중 실제로 존재하는 것만 사용.
const slides = [...document.querySelectorAll('.banner-slide')];
let available = [];
let bannerIndex = 0;
let timer = null;

function refreshBanners(){
  available = slides.filter(s => !s.classList.contains('is-missing'));
  $('#bannerFallback').hidden = available.length > 0;
  $('#bannerPrev').hidden = available.length <= 1;
  $('#bannerNext').hidden = available.length <= 1;
  $('#bannerDots').innerHTML = available.map((_,i)=>`<button class="banner-dot ${i===bannerIndex?'active':''}" data-dot="${i}" type="button" aria-label="${i+1}번 배너"></button>`).join('');
  showBanner(Math.min(bannerIndex, Math.max(0, available.length-1)), false);
}

function showBanner(index, restart=true){
  if(!available.length) return;
  bannerIndex = (index + available.length) % available.length;
  slides.forEach(s=>s.classList.remove('active'));
  available[bannerIndex].classList.add('active');
  document.querySelectorAll('.banner-dot').forEach((d,i)=>d.classList.toggle('active', i===bannerIndex));
  if(restart) startTimer();
}
function startTimer(){ clearInterval(timer); if(available.length>1) timer=setInterval(()=>showBanner(bannerIndex+1,false),5500); }
slides.forEach(slide=>{
  const img=slide.querySelector('img');
  img.addEventListener('error',()=>{slide.classList.add('is-missing');refreshBanners();},{once:true});
  img.addEventListener('load',()=>refreshBanners(),{once:true});
});
$('#bannerPrev').addEventListener('click',()=>showBanner(bannerIndex-1));
$('#bannerNext').addEventListener('click',()=>showBanner(bannerIndex+1));
$('#bannerDots').addEventListener('click',e=>{const d=e.target.closest('[data-dot]');if(d)showBanner(Number(d.dataset.dot));});
setTimeout(()=>{refreshBanners();startTimer();},150);

const preferredBodies = {
  Sony: ['Sony α7 V','Sony α7 IV'],
  Canon: ['Canon EOS R6 Mark III','Canon EOS R5 Mark II','Canon EOS R5'],
  Nikon: ['Nikon Z6III','Nikon Z8','Nikon Z 6II'],
  Fujifilm: ['Fujifilm X-H2','Fujifilm X-T5','Fujifilm X-H2S'],
};
const preferredLenses = {
  Sony: ['Sony FE 24-70mm F2.8 GM II'],
  Canon: ['Canon RF24-70mm F2.8 L IS USM'],
  Nikon: ['Nikon NIKKOR Z 24-70mm F2.8 S II','Nikon NIKKOR Z 24-70mm F2.8 S'],
  Fujifilm: ['Fujifilm XF16-55mmF2.8 R LM WR II','Fujifilm XF16-55mmF2.8 R LM WR'],
};

function pickPreferred(products, brand, names, type){
  for(const n of names){const hit=products.find(p=>p.type===type&&p.manufacturer===brand&&productLabel(p)===n);if(hit)return hit;}
  return products.filter(p=>p.type===type&&p.manufacturer===brand&&p.currentSale==='예').sort((a,b)=>(b.releaseYear||0)-(a.releaseYear||0))[0]
    || products.filter(p=>p.type===type&&p.manufacturer===brand).sort((a,b)=>(b.releaseYear||0)-(a.releaseYear||0))[0];
}

function visual(p){
  const photo = p.imageSrc ? `<img class="product-image" src="${esc(p.imageSrc)}" alt="${esc(productLabel(p))}" onerror="this.remove();this.parentElement.classList.add('show-brand')">` : '';
  return `<div class="featured-visual ${p.imageSrc?'':'show-brand'}">${photo}<img class="brand-logo-fallback" src="${esc(brandLogoUrl(p.manufacturer))}" alt="${esc(p.manufacturer)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="featured-brand-text" hidden>${esc(p.manufacturer)}</span></div>`;
}
function card(p){
  const format = p.type==='바디' ? (p.sensorFormat||p.cameraSystem||'') : (p.focalLength||p.lensFormat||'');
  return `<a class="featured-card" href="/database/?q=${encodeURIComponent(productLabel(p))}">${visual(p)}<small>${esc(p.manufacturer)} · ${esc(p.mount||'')}</small><h3>${esc(productLabel(p))}</h3><div class="featured-meta">${esc(format)}${p.releaseYear?` · ${p.releaseYear}`:''}</div><div class="featured-price">${esc(money(p.currentPriceKrw ?? p.currentPriceUsd))}</div></a>`;
}

try{
  const products=await loadProducts();
  const brands=['Sony','Canon','Nikon','Fujifilm'];
  const bodies=brands.map(b=>pickPreferred(products,b,preferredBodies[b],'바디')).filter(Boolean);
  const lenses=brands.map(b=>pickPreferred(products,b,preferredLenses[b],'렌즈')).filter(Boolean);
  $('#featuredBodies').innerHTML=bodies.map(card).join('');
  $('#featuredLenses').innerHTML=lenses.map(card).join('');
}catch(e){
  console.error(e);
  $('#featuredBodies').innerHTML='<div class="simple-card">제품 DB를 불러오지 못했습니다.</div>';
  $('#featuredLenses').innerHTML='';
}
