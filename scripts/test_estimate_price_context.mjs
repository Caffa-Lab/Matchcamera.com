import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {priceContext,estimatePriceSummary} from '../public/assets/js/price-context.js';

const root=path.resolve(import.meta.dirname,'..');
const record=(kind,amount=1000000)=>({currentPriceKrw:amount,koreaPriceDetails:{offers:[{kind,amount,currency:'KRW',sourceUrl:'https://example.com/product',checkedAt:'2026-09-15'}]}});
const current=record('current'),launch=record('launch',800000),historical=record('historical',600000),unverified=record('unverified',400000);
assert.equal(priceContext(current).included,true);
assert.equal(priceContext(launch).label,'한국 출시가');
assert.equal(priceContext(historical).historical,true);
assert.equal(priceContext(unverified).included,false,'unverified records must not become a confirmed quote');
for(const value of [null,undefined,'',0,-1,'abc',Infinity])assert.equal(priceContext({currentPriceKrw:value}).amount,null);

const retailer={currentPriceKrw:32000,priceType:'국내 판매처 표시가',priceSource:'https://example.com/plate',priceDate:'2026-09-12'};
assert.equal(priceContext(retailer).included,true,'accessories retain their dated retailer price');
assert.equal(priceContext(retailer).label,'국내 판매처 표시가');
assert.equal(priceContext({...retailer,priceDate:'2026-02-30'}).included,false);
assert.equal(priceContext({...retailer,priceDate:''}).exclusionReason,'가격 기준일 미확인');
assert.equal(priceContext({...retailer,priceSource:'javascript:alert(1)'}).sourceUrl,'');
assert.equal(priceContext({...retailer,priceSource:''}).included,false);
assert.equal(priceContext({...retailer,priceType:''}).included,false,'a positive amount with no price basis is not a known price');
assert.equal(priceContext({...current,currentPriceKrw:900000,koreaPriceSource:'https://example.com/wrong',koreaPriceDate:'2026-09-15'}).included,false,'source for a different recorded amount must not justify the displayed price');
assert.equal(priceContext({...current,koreaPriceVerification:'재확인 필요'}).included,false);

const mixed=estimatePriceSummary([current,launch,historical,unverified,{}]);
assert.equal(mixed.total,2400000);
assert.deepEqual([mixed.includedCount,mixed.totalCount,mixed.missingCount,mixed.unverifiedCount,mixed.launchCount,mixed.historicalCount],[3,5,1,1,1,1]);
assert.match(mixed.note,/출시가 1개 · 과거가 1개 포함/);
assert.match(mixed.note,/금액 미확인 1개 · 가격 근거 재확인 1개 제외/);
assert.match(mixed.note,/실제 구매금액과 다를/);
assert.equal(estimatePriceSummary([{},unverified]).total,null,'all unknown prices must not be presented as a zero-cost estimate');
assert.equal(estimatePriceSummary([]).total,null);
assert.equal(estimatePriceSummary([current,{}]).total,1000000);

// Read the same merged data that the catalog and builder consume.
globalThis.fetch=async url=>{
  try{return new Response(await fs.readFile(path.join(root,'public',String(url).split('?')[0])));}
  catch{return new Response('',{status:404});}
};
const data=await import(pathToFileURL(path.join(root,'public/assets/js/data.js')));
const products=await data.loadProducts();
const a6400=products.find(product=>product.officialName==='Sony α6400');
const nex5n=products.find(product=>product.officialName==='Sony NEX-5N');
assert(a6400&&nex5n);
assert.equal(priceContext(a6400).kind,'launch');
assert.equal(priceContext(a6400).included,true);
assert.equal(priceContext(nex5n).included,false);
assert.equal(estimatePriceSummary([a6400,nex5n]).total,a6400.currentPriceKrw);
const plate=(await data.loadPlates()).find(product=>product.id==='photoclam-pc-59-up4');
assert.equal(priceContext(plate).included,true);

// Execute the builder's actual price rendering functions without a browser.
const builder=await fs.readFile(path.join(root,'public/assets/js/builder.js'),'utf8');
const elements=new Map();
const calls=[];
const state={body:{...a6400,id:'body'},lenses:[{...unverified,id:'lens'}],adapters:[],battery:null,memory:null,flash:null,plate:null,head:null,tripod:null};
const context={state,priceContext,estimatePriceSummary,money:data.money,accessoryLabel:product=>product.officialName||'제품',equipmentWeightKg:()=>null,SUPPORT_KINDS:{},measuredEstimates:new Set(),keyOf:product=>product.id,checkCompatibility:()=>({level:'compatible'}),trackUsage:(...args)=>{calls.push(args);},esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  $:selector=>{if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);}};
vm.createContext(context);
vm.runInContext(builder.slice(builder.indexOf('function priceContextMarkup'),builder.indexOf('function hydrate')),context);
vm.runInContext(builder.slice(builder.indexOf('function renderSummary'),builder.indexOf('  const results=state.body?'))+'}\nrenderSummary();',context);
assert.equal(elements.get('#totalPrice').textContent,data.money(a6400.currentPriceKrw));
assert.equal(elements.get('#pricedCount').textContent,'1 / 2');
assert.match(elements.get('#priceBreakdown').innerHTML,/한국 출시가 · 합계 포함/);
assert.match(elements.get('#priceBreakdown').innerHTML,/재확인 필요 · 합계 제외/);
assert.match(elements.get('#priceBreakdown').innerHTML,/target="_blank" rel="noopener noreferrer"/);
assert.match(elements.get('#priceBreakdown').innerHTML,/기록 400,000원/);
assert.deepEqual(calls,[['estimate_ready','builder']],'only a fixed event name and surface are sent');
vm.runInContext('renderSummary();renderSummary();',context);
assert.equal(calls.length,1,'rerenders must not produce repeated completion events');
state.lenses=[];
state.body={id:'new-body'};
vm.runInContext('renderSummary();',context);
assert.equal(calls.length,1,'a body alone is not an interchangeable kit');
state.body={id:'fixed-body',cameraSystem:'일체형 카메라'};
vm.runInContext('renderSummary();renderSummary();',context);
assert.equal(calls.length,2,'a fixed-lens body completes one estimate');
assert.equal(elements.get('#totalPrice').textContent,'-');
assert.match(elements.get('#priceNote').textContent,/금액 미확인 1개 제외/);
state.body=null;
vm.runInContext('renderSummary();',context);
assert.equal(elements.get('#pricedCount').textContent,'0 / 0');
assert.match(elements.get('#priceBreakdown').innerHTML,/제품을 선택하면/);
assert.match(builder,/if\(e.target.closest\('\[data-price-source\]'\)\)return/,'price source links must not also open the product dialog');
console.log('Estimate price context passed: sourced/current/launch/historical/unknown records, real catalog data, partial totals, rendering and deduplicated completion events.');
