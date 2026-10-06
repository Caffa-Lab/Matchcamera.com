import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {money,productMoney,productPriceStatus} from '../public/assets/js/price-format.js';
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

const pendingProduct={id:'pending-lens',type:'렌즈',manufacturer:'Sony',officialName:'Pending lens',modelCode:'PENDING',mount:'Sony E',priceStatus:'not-announced',currentPriceKrw:1000000};
assert.equal(productMoney(pendingProduct),'가격 미정');
assert.equal(productMoney({currentPriceKrw:null,priceStatus:'unconfirmed'}),'가격 미확인');
assert.equal(productMoney({currentPriceKrw:1000000}),'1,000,000원');
assert.equal(money(null),'가격 미확인');
assert.equal(productMoney({...pendingProduct,koreaPriceDetails:{status:'confirmed-current'}}),'1,000,000원','a verified price update takes precedence over the old announcement state');
const pendingDetails=priceDetailsMarkup({...pendingProduct,koreaPriceDetails:{status:'not-announced',offers:[{kind:'current',amount:1000000}]}});
assert.match(pendingDetails,/가격 미정/);
assert.doesNotMatch(pendingDetails,/1,000,000원|>0원</,'pending details must not show stale offers');

// Both data paths must carry the explicit state and suppress stale amounts.
const fixtureProducts=[pendingProduct,{...pendingProduct,id:'pending-detail',officialName:'Pending detail',modelCode:'DETAIL',priceStatus:undefined},{...pendingProduct,id:'unknown-product',officialName:'Unknown product',modelCode:'UNKNOWN',priceStatus:'unconfirmed',currentPriceKrw:null}];
const fixtures={
  'products.json':fixtureProducts,
  'korea-prices.json':fixtureProducts.slice(0,2).map(product=>({'정식 제품명':product.officialName,'마운트':product.mount,'한국 기준 가격(원)':2000000,'한국 공식/출시 가격(원)':3000000,'가격 상세':{status:'not-announced',offers:[]}})),
  'product-images.json':{},
};
globalThis.fetch=async url=>new Response(JSON.stringify(fixtures[path.basename(String(url).split('?')[0])]||[]));
const fixtureData=await import(`${pathToFileURL(path.join(root,'public/assets/js/data.js'))}?pending-price-test`);
const loadedFixtures=await fixtureData.loadProducts();
for(const product of loadedFixtures.slice(0,2)){
  assert.equal(product.priceStatus,'not-announced');
  assert.equal(product.currentPriceKrw,null);
  assert.equal(product.koreaOfficialPriceKrw,null);
  assert.equal(product.koreaStreetPriceKrw,null);
  assert.equal(productMoney(product),'가격 미정');
}
assert.equal(productMoney(loadedFixtures[2]),'가격 미확인');
let builtIndex;
const buildSource=(await fs.readFile(path.join(root,'scripts/build_product_index.mjs'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^const ROOT=.*;\r?\n/m,'');
await vm.runInNewContext(`(async()=>{${buildSource}})()`,{ROOT:root,path,productPriceStatus,console:{log(){}},readFile:async file=>JSON.stringify(fixtures[path.basename(file)]||[]),writeFile:async(file,content)=>{assert.equal(path.basename(file),'product-index.json');builtIndex=JSON.parse(content);}});
for(const product of builtIndex.slice(0,2)){
  assert.equal(product.priceStatus,'not-announced');
  assert.equal(product.currentPriceKrw,null);
  assert.equal(productMoney(product),'가격 미정');
}
assert.equal(productMoney(builtIndex[2]),'가격 미확인');

// Exercise actual catalog, homepage and comparison renderers, including search.
const rendererContext={product:pendingProduct,productMoney,money,productLabel:p=>p.officialName,esc:value=>String(value??''),type:'렌즈',lensSpecs:()=>[],productVisual:()=>'',actionUrl:()=>'',isCurrent:()=>false,visual:()=>'',state:{a:pendingProduct,type:'렌즈'},imageMarkup:()=>'',hasValue:value=>value!==undefined&&value!==null&&value!=='',typeProducts:()=>[pendingProduct],matchesSearch:()=>true,pickers:{a:{input:{value:'Pending',setAttribute(){}},results:{}}}};
vm.createContext(rendererContext);
for(const [file,fn,next] of [['catalog.js','card',''],['home.js','card',''],['compare.js','productCard','specValue'],['compare.js','specValue','comparisonKeys'],['compare.js','showResults','selectProduct']]){
  const source=await fs.readFile(path.join(root,'public/assets/js',file),'utf8');
  const start=source.indexOf(`function ${fn}(`);
  assert(start>=0,`${file} ${fn} renderer must exist`);
  const end=next?source.indexOf(`function ${next}(`,start):source.indexOf('\n}',start)+2;
  let code=file==='catalog.js'?source.split(/\r?\n/).find(line=>line.startsWith('function card(')):source.slice(start,end);
  if(file==='home.js')code=code.replace('function card(', 'function homeCard(');
  vm.runInContext(code,rendererContext);
}
assert.match(vm.runInContext('card(product)',rendererContext),/가격 미정/);
assert.match(vm.runInContext('homeCard(product)',rendererContext),/가격 미정/);
assert.match(vm.runInContext("productCard('a')",rendererContext),/가격 미정/);
assert.equal(vm.runInContext("specValue(product,'한국 가격')",rendererContext),'가격 미정');
vm.runInContext("showResults('a')",rendererContext);
assert.match(rendererContext.pickers.a.results.innerHTML,/가격 미정/);

if(process.argv.includes('--snapshot')){
  const rows=JSON.parse(await fs.readFile(path.join(root,'public/data/korea-prices.json'),'utf8'));
  const target=rows.filter(r=>['Sony','Canon','Nikon','Fujifilm'].includes(r['제조사'])&&['바디','렌즈'].includes(r['제품 종류']));
  assert(target.length>=628,'previous price coverage must be retained as new cameras are added');
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
