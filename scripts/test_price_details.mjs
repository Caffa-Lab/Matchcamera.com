import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const {priceDetailsMarkup}=await import(pathToFileURL(path.join(root,'public/assets/js/product-detail.js')));

// A current quote and launch price must retain their own labels and dates.
const markup=priceDetailsMarkup({koreaPriceDetails:{reviewedAt:'2026-09-11',statusLabel:'공식 현재가 확인',offers:[
  {kind:'current',amount:1800000,sourceUrl:'https://example.com/current',sourceName:'공식몰',checkedAt:'2026-09-11',configuration:'바디 단품'},
  {kind:'launch',amount:2200000,sourceUrl:'https://example.com/launch',sourceName:'출시 공지',checkedAt:'2026-09-11',asOf:'2024-01-01',configuration:'바디 단품'},
]}});
assert.match(markup,/한국 공식 현재가/);
assert.match(markup,/한국 출시가/);
assert.match(markup,/1,800,000원/);
assert.match(markup,/2,200,000원/);
assert.match(markup,/가격 적용일 2024-01-01/);
assert.match(markup,/rel="noopener noreferrer"/);
const unknown=priceDetailsMarkup({koreaPriceDetails:{statusLabel:'한국 가격 미발표',offers:[]}});
assert.match(unknown,/한국 가격 미발표/);
assert.doesNotMatch(unknown,/>0원</);
const unsafe=priceDetailsMarkup({koreaPriceDetails:{offers:[{kind:'unverified',amount:1000,sourceUrl:'javascript:alert(1)',sourceName:'<img src=x onerror=alert(1)>',configuration:'<script>alert(1)</script>'}]}});
assert.doesNotMatch(unsafe,/href="javascript:|<script>|<img/);
assert.match(unsafe,/이전 기록 · 재확인 필요/);

if(process.argv.includes('--snapshot')){
  const rows=JSON.parse(await fs.readFile(path.join(root,'public/data/korea-prices.json'),'utf8'));
  const target=rows.filter(r=>['Sony','Canon','Nikon','Fujifilm'].includes(r['제조사'])&&['바디','렌즈'].includes(r['제품 종류']));
  assert.equal(target.length,628);
  for(const row of target){
    const d=row['가격 상세'];assert(d?.status&&d.reviewedAt,'each target price needs a review result');
    for(const offer of d.offers){
      assert(Number.isFinite(offer.amount)&&offer.amount>0);
      assert.equal(offer.currency,'KRW');
      if(offer.kind!=='unverified')assert(offer.sourceUrl.startsWith('https://')&&offer.checkedAt,'confirmed prices require dated sources');
    }
  }
  const fuji=target.find(r=>r['정식 제품명']==='Fujifilm X-T5');
  assert.equal(fuji['한국 기준 가격(원)'],2399000,'X-T5 must use the body price, not the XF lens kit');
  const raw=JSON.parse(await fs.readFile(path.join(root,'public/data/products.json'),'utf8'));
  assert.equal(raw.find(p=>p.modelCode==='RF14mm').maxAperture,'F1.4');
  assert.equal(raw.find(p=>p.modelCode==='GF19-35mmT3.5').maxAperture,'T3.5');
  assert.equal(raw.find(p=>p.modelCode==='SEL100F28GM').maxAperture,'F2.8 (T5.6)','STF lens transmission information must be preserved');
  globalThis.fetch=async url=>{
    try{return new Response(await fs.readFile(path.join(root,'public',String(url))));}
    catch{return new Response('',{status:404});}
  };
  const data=await import(pathToFileURL(path.join(root,'public/assets/js/data.js')));
  for(const catalog of [await data.loadProducts(),await data.loadProductIndex()]){
    assert.equal(catalog.find(p=>p.modelCode==='GF19-35mmT3.5').maxAperture,'T3.5','merged catalogs must retain the corrected aperture');
    assert.equal(catalog.find(p=>p.modelCode==='RF14mm').maxAperture,'F1.4');
  }
  const loaded=(await data.loadProducts()).find(p=>p.officialName==='Fujifilm X-T5');
  assert.equal(loaded.koreaPriceDetails.offers[0].amount,2399000,'the detail view must receive the verified body price');
}
console.log('Price details passed: current/launch distinction, unknown prices, source links and safe rendering.');
