import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const read=async name=>JSON.parse(await fs.readFile(path.join(root,'public/data',name),'utf8'));
const prices=await read('korea-prices.json');
const four=new Set(['Sony','Canon','Nikon','Fujifilm']);
const remaining=prices.filter(p=>!four.has(p['제조사'])&&['바디','렌즈'].includes(p['제품 종류']));
assert(remaining.length>=557,'previous price review coverage must be retained as the catalog grows');
for(const row of remaining){
  const detail=row['가격 상세'];
  assert(detail?.reviewedAt&&detail.status);
  for(const offer of detail.offers){
    assert(offer.amount>0&&offer.amount<999999999);
    assert.equal(offer.currency,'KRW');
    if(offer.kind!=='unverified')assert(offer.sourceUrl.startsWith('https://')&&offer.checkedAt);
  }
  if(['unconfirmed','needs-reconfirmation'].includes(detail.status))assert.equal(row['한국 기준 가격(원)'],null);
}
const find=(name,mount)=>prices.find(p=>p['정식 제품명']===name&&p['마운트']===mount);
assert.equal(find('Tamron 28-75mm F2.8 Di III VXD G2','Sony E')['한국 기준 가격(원)'],1188000);
assert.equal(find('Tamron 28-75mm F2.8 Di III VXD G2','Nikon Z')['한국 기준 가격(원)'],1173000);
assert.equal(find('Hasselblad X2D II 100C','Hasselblad XCD')['한국 기준 가격(원)'],11380000,'body price must exclude lens kit');
globalThis.fetch=async url=>{
  try{return new Response(await fs.readFile(path.join(root,'public',String(url))));}
  catch{return new Response('',{status:404});}
};
const data=await import(pathToFileURL(path.join(root,'public/assets/js/data.js')));
const full=await data.loadProducts();
const index=await data.loadProductIndex();
const images=await read('product-images.json');
let reviewed=0,pending=0;
for(const product of full.filter(p=>!four.has(p.manufacturer)&&['바디','렌즈'].includes(p.type))){
  const fast=index.find(p=>p.id===product.id);
  assert(fast,product.id);
  assert.equal(fast.currentPriceKrw,product.currentPriceKrw);
  assert.equal(fast.imageSrc,product.imageSrc);
  if(['unconfirmed','needs-reconfirmation'].includes(product.koreaPriceDetails?.status))assert.equal(product.currentPriceKrw,null,'unverified embedded prices must not reappear');
  const image=images[product.id];
  assert(image?.src&&image.verifiedAt);
  await fs.access(path.join(root,'public',image.src));
  if(product.cameraSystem==='일체형 카메라'){
    assert(image.sourcePage?.startsWith('https://')&&image.sourceImage?.startsWith('https://'),'compact camera photos need their original source');
    reviewed++;
  }
  else if(image.method==='official-reviewed-cutout')reviewed++;
  else{assert.equal(image.method,'image-pending');pending++;}
}
assert(reviewed>=456,'new camera photos must extend the reviewed image coverage');
assert.equal(pending,3);
console.log(`Remaining catalog passed: ${remaining.length} price reviews, exact mounts/body configurations, ${reviewed} photos, ${pending} placeholders and matching catalog/index data.`);
