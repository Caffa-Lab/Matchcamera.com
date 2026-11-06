import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {checkCompatibility} from '../public/assets/js/compatibility.js';
import {recommendBudgetKits,budgetProductCandidates,budgetFocalRange,budgetResultsMarkup} from '../public/assets/js/builder-budget.js';

const price=(amount,kind='current')=>({currentPriceKrw:amount,koreaPriceDetails:{offers:[{amount,kind,currency:'KRW',sourceUrl:'https://manufacturer.test/product',checkedAt:'2026-11-07'}]}});
const body=(id,amount=600000,extra={})=>({id,officialName:id,manufacturer:'Sony',type:'바디',cameraSystem:'미러리스',mount:'Sony E',sensorFormat:'Full Frame',currentSale:'예',...price(amount),...extra});
const lens=(id,amount=400000,extra={})=>({id,officialName:id,manufacturer:'Sony',type:'렌즈',cameraSystem:'미러리스',mount:'Sony E',compatibleSensorFormat:'Full Frame',focalMinMm:35,focalMaxMm:70,currentSale:'예',...price(amount),...extra});
const base=[body('b'),lens('l')];
let results=recommendBudgetKits(base,{budget:1000000});
assert.equal(results.length,1);
assert.equal(results[0].total,1000000);
assert.equal(results[0].remaining,0);
assert.equal(results[0].bodyShare,.6);
assert.equal(recommendBudgetKits(base,{budget:999999}).length,0,'no recommendation exceeds the entered budget');
assert.equal(recommendBudgetKits(base,{budget:1000000,manufacturer:'Canon'}).length,0);
for(const budget of [null,undefined,0,-1,Infinity,100.1,'1000000',500000001])assert.deepEqual(recommendBudgetKits(base,{budget}),[]);
assert.equal(recommendBudgetKits(base,{budget:1000000,limit:0}).length,0);
assert.equal(recommendBudgetKits(base,{budget:1000000,purpose:'bogus'}).length,0);

for(const excluded of [
  body('inactive',1,{active:false}),body('disabled',1,{enabled:false}),body('hidden',1,{visibility:'hidden'}),
  body('discontinued',1,{currentSale:'아니오',saleStatus:'현재 판매'}),body('unknown-sale',1,{currentSale:'확인 필요'}),
  body('dslr',1,{cameraSystem:'DSLR'}),body('fixed',1,{cameraSystem:'일체형 카메라'}),
  body('mount-missing',1,{mount:''}),body('unverified',1,price(1,'unverified')),
  body('no-source',1,{koreaPriceDetails:{offers:[{amount:1,kind:'current',checkedAt:'2026-11-07'}]}}),
  body('no-date',1,{koreaPriceDetails:{offers:[{amount:1,kind:'current',sourceUrl:'https://manufacturer.test/product'}]}}),
  body('pending',1,{priceStatus:'not-announced'}),body('historic',1,price(1,'historical')),
]){
  assert.equal(budgetProductCandidates([excluded]).length,0,`${excluded.id} must not become a budget recommendation`);
  assert.equal(recommendBudgetKits([excluded,lens('l')],{budget:1000000}).length,0);
}
assert.equal(budgetProductCandidates([body('launch',600000,price(600000,'launch'))]).length,1,'dated launch price can be a disclosed reference');
assert.equal(budgetProductCandidates([...base,...base]).length,2,'duplicate catalog IDs must not repeat offers');
assert.equal(recommendBudgetKits([body('b'),lens('wrong-mount',1,{mount:'Canon RF'})],{budget:1000000}).length,0);
assert.equal(recommendBudgetKits([body('b'),lens('crop-only',1,{compatibleSensorFormat:'APS-C'})],{budget:1000000}).length,0,'conditional crop-mode pair is excluded');
assert.equal(recommendBudgetKits([body('b'),lens('format-unknown',1,{compatibleSensorFormat:null})],{budget:1000000}).length,0,'same mount alone does not establish compatibility');
const cropBody=body('crop',600000,{sensorFormat:'APS-C',cropFactor:1.5});
assert.equal(recommendBudgetKits([cropBody,lens('full-lens')],{budget:1000000}).length,1,'full-image-circle lens on smaller sensor remains native compatible');
assert.deepEqual(budgetFocalRange(cropBody,lens('zoom',400000,{focalMinMm:16,focalMaxMm:50})),{min:24,max:75});
assert.equal(recommendBudgetKits([cropBody,lens('wide',400000,{focalMinMm:16,focalMaxMm:50})],{budget:1000000,purpose:'wide'}).length,1);
assert.equal(recommendBudgetKits([cropBody,lens('not-wide',400000,{focalMinMm:24,focalMaxMm:70})],{budget:1000000,purpose:'wide'}).length,0);
assert.equal(recommendBudgetKits([cropBody,lens('tele',400000,{focalMinMm:50,focalMaxMm:100})],{budget:1000000,purpose:'tele'}).length,1);
assert.equal(recommendBudgetKits([cropBody,lens('focal-unknown',400000,{focalMinMm:null,focalMaxMm:null})],{budget:1000000,purpose:'standard'}).length,0);

const diverse=[...Array.from({length:8},(_,i)=>body(`b${i}`,600000+i)),...Array.from({length:8},(_,i)=>lens(`l${i}`,400000+i))];
results=recommendBudgetKits(diverse,{budget:1200000,limit:1000});
assert.equal(results.length,8);
for(const id of new Set(results.map(x=>x.body.id)))assert(results.filter(x=>x.body.id===id).length<=2);
assert.deepEqual(recommendBudgetKits([...diverse].reverse(),{budget:1200000}).map(x=>[x.body.id,x.lens.id]),results.map(x=>[x.body.id,x.lens.id]),'ranking deterministic across catalog order');
const markup=budgetResultsMarkup(recommendBudgetKits([body('<script>'),lens('lens')],{budget:1000000}),1000000);
assert(!markup.includes('<script>'));
assert.match(markup,/&lt;script&gt;/);
assert.match(markup,/가격 출처/);
assert.match(markup,/한국 공식 현재가/);
assert.match(markup,/2026-11-07/);
assert.match(markup,/target="_blank" rel="noopener noreferrer"/);

// The public catalog, prices and compatibility engine must work together.
globalThis.fetch=async url=>{try{return new Response(await readFile(new URL(`../public${String(url).split('?')[0]}`,import.meta.url)));}catch{return new Response('',{status:404});}};
const {loadProducts}=await import('../public/assets/js/data.js');
const products=await loadProducts();
for(const purpose of ['all','standard','wide','tele']){
  const kits=recommendBudgetKits(products,{budget:3000000,purpose});
  assert(kits.length>0,`real catalog has ${purpose} priced native kits`);
  for(const kit of kits){
    assert(kit.total<=3000000);
    assert.equal(kit.body.cameraSystem,'미러리스');assert.equal(kit.lens.cameraSystem,'미러리스');
    assert.equal(checkCompatibility(kit.body,kit.lens,[]).level,'compatible');
    assert.equal(kit.body.mount,kit.lens.mount);
    assert(kit.bodyPrice.included&&kit.lensPrice.included);
  }
}

// Execute the actual builder application boundary, not a duplicate of it.
const builder=await readFile(new URL('../public/assets/js/builder.js',import.meta.url),'utf8');
const selected={body:base[0],lens:base[1]};let renders=0;
const state={body:body('old'),lenses:[lens('oldlens')],battery:{id:'oldbattery'},memory:{},flash:{},plate:{},head:{},tripod:{},query:'old'};
const search={value:'old'},bodySlot={scrollIntoView(){}};
const context=vm.createContext({state,$:selector=>selector==='#search'?search:bodySlot,render:()=>renders++,toast(){}});
vm.runInContext(builder.slice(builder.indexOf('function applyBudgetRecommendation'),builder.indexOf('async function initializeBuilder')),context);
context.selected=selected;vm.runInContext('applyBudgetRecommendation(selected)',context);
assert.equal(state.body,selected.body);assert.equal(state.lenses[0],selected.lens);assert.equal(state.lenses.length,1);
for(const key of ['battery','memory','flash','plate','head','tripod'])assert.equal(state[key],null);
assert.equal(state.mode,'lens');assert.equal(state.compatOnly,true);assert.equal(search.value,'');assert.equal(renders,1);
console.log('Budget native kits: budget/verified-price/active-sale invariants, format and focal selection, deterministic diversity, real catalog and builder application passed.');
