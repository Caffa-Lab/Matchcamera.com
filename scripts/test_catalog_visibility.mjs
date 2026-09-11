import {buildCatalogReview,REVIEW_TYPES} from '../public/admin/catalog-review.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');
const read=async name=>JSON.parse(await fs.readFile(path.join(root,'public/data',name),'utf8'));
const sourceFiles=['products.json','system-expansion.json','official-partner-products.json','hasselblad-products.json'];
const sources=await Promise.all(sourceFiles.map(read));
const sourceRows=sources.flat();
const dslrMounts=new Set(['Sony A','Canon EF','Canon EF-S','Canon EF/EF-S','Nikon F','Pentax K','Sigma SA','Four Thirds']);
const isDslr=p=>['DSLR','DSLT'].includes(p.cameraSystem)||(p.type==='렌즈'&&dslrMounts.has(p.mount));
const disabled=sourceRows.filter(isDslr);
const snapshot=process.argv.includes('--snapshot');
if(snapshot){
  assert(disabled.length>250,'DSLR records must remain in the source database');
  assert(disabled.every(p=>p.active===false),'DSLR bodies and lenses must start inactive');
}
const merged=new Map();
for(const product of sourceRows){
  const key=[product.officialName||product.model||product.modelCode||'',product.modelCode||'',product.type||''].map(value=>String(value).trim()).join('||');
  merged.set(key,{...merged.get(key),...product});
}
const expectedIds=[...merged.values()].filter(p=>p.active!==false&&p.enabled!==false&&p.visibility!=='hidden').map(p=>p.id).sort();

// Exercise both public loading paths against the real data, without a browser.
globalThis.fetch=async url=>{
  try{return new Response(await fs.readFile(path.join(root,'public',String(url))));}
  catch{return new Response('',{status:404});}
};
const data=await import(pathToFileURL(path.join(root,'public/assets/js/data.js')));
for(const rows of [await data.loadProducts(),await data.loadProductIndex()]){
  assert.deepEqual(rows.map(p=>p.id).sort(),expectedIds,'public catalogs must follow persisted active states');
  if(snapshot){
    assert(!rows.some(isDslr),'public catalogs must initially hide DSLR products');
    assert(rows.some(p=>p.modelCode==='SEL814G'),'new Sony lens must appear in both catalogs');
    assert(rows.some(p=>p.mount==='Canon EF-M'),'EF-M mirrorless lenses must remain available');
    assert(rows.some(p=>p.cameraSystem==='시네마'&&p.mount==='Canon EF'),'EF cinema bodies must remain available');
  }
}
const index=await read('product-index.json');
if(snapshot)assert.equal(index.find(p=>p.modelCode==='SEL814G').currentPriceKrw,null,'unannounced Korean price must not be invented');

// Run actual admin handlers, replacing only UI boot and persistence boundary.
const script=await fs.readFile(path.join(root,'public/admin/admin.js'),'utf8');
const context=vm.createContext({buildCatalogReview,REVIEW_TYPES,structuredClone,console,window:{addEventListener(){}},setTimeout,clearTimeout});
vm.runInContext(script.replace(/^import .*catalog-review.*\r?\n/,'').replace(/\nboot\(\);\s*$/,'\n'),context);
vm.runInContext(`commit=async changes=>{for(const change of changes) files[change.path]=change.value;};`,context);
context.fixture={id:'fixture-dslr',manufacturer:'Test',type:'바디',cameraSystem:'DSLR',mount:'Test Mount',officialName:'Test DSLR',model:'Test DSLR',modelCode:'DSLR1',specs:{'센서':'Full Frame'}};
for(const legacy of [{},{enabled:false},{visibility:'hidden'},{enabled:false,visibility:'hidden'}]){
  context.legacy=legacy;
  vm.runInContext(`files[PATHS.products]=[{...fixture,...legacy,active:false}];`,context);
  await vm.runInContext(`toggleProductVisibility({...files[PATHS.products][0],_sourceFile:PATHS.products,_sourceIndex:0})`,context);
  assert.equal(vm.runInContext('isActive(files[PATHS.products][0])',context),true,'admin activation must clear every legacy hide flag');
  await vm.runInContext(`toggleProductVisibility({...files[PATHS.products][0],_sourceFile:PATHS.products,_sourceIndex:0})`,context);
  const result=vm.runInContext('files[PATHS.products][0]',context);
  assert.equal(result.active,false,'second toggle must disable the product');
  assert.equal(result.id,context.fixture.id,'toggle must preserve product identity');
  assert.deepEqual(JSON.parse(JSON.stringify(result.specs)),context.fixture.specs,'toggle must preserve specifications');
}
vm.runInContext(`
  files[PATHS.products]=[{...fixture,active:false,enabled:false,visibility:'hidden'}];
  currentEditor={record:{...files[PATHS.products][0],_sourceFile:PATHS.products,_sourceIndex:0}};
  products=[currentEditor.record];
  const form={...fixture,active:'true',sourceFile:PATHS.products,specs:JSON.stringify(fixture.specs)};
  dialogValue=key=>String(form[key]??'');
`,context);
await vm.runInContext('saveProduct()',context);
assert.equal(vm.runInContext('isActive(files[PATHS.products][0])',context),true,'editor activation must also clear legacy flags');
vm.runInContext(`files[PATHS.expansion]=[{...files[PATHS.products][0],id:'duplicate-source-id'}];`,context);
await vm.runInContext(`toggleProductVisibility({...files[PATHS.products][0],_sourceFile:PATHS.products,_sourceIndex:0})`,context);
assert.equal(vm.runInContext('isActive(files[PATHS.expansion][0])',context),false,'a later duplicate must not override a disabled product');
await vm.runInContext(`toggleProductVisibility({...files[PATHS.expansion][0],_sourceFile:PATHS.expansion,_sourceIndex:0})`,context);
assert.equal(vm.runInContext('isActive(files[PATHS.products][0])',context),true,'either duplicate can reactivate the product');
console.log(`Catalog visibility passed: ${expectedIds.length} public products; admin toggles, editor and duplicate records verified${snapshot?`; ${disabled.length} inactive DSLR records preserved`:''}.`);
