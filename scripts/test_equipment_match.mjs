import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {equipmentText,productName,findProduct} from '../public/assets/js/resize/equipment-match.js';

const rows=JSON.parse(await readFile(new URL('../public/data/product-index.json',import.meta.url),'utf8'));
const bodies=rows.filter(p=>p.type==='바디'),lenses=rows.filter(p=>p.type==='렌즈');
for(const raw of ['',null,undefined,1,24,50,{},[24,70],'0','1','24','50','50mm','24-70mm','E','FE','Sony','Canon','RF','FE G Master','Lens not attached','Unknown lens','렌즈 정보 없음','EF50mm f/1.8 STM']){
  assert.equal(findProduct(raw,lenses),null,`must not guess a lens for ${JSON.stringify(raw)}`);
}
const sony=findProduct('SEL35F14GM',lenses);
assert.equal(sony.officialName,'Sony FE 35mm F1.4 GM');
assert.equal(findProduct('FE 35mm F1.4 GM',lenses),sony);
assert.equal(findProduct(' sony FE 35mm F1.4 GM\0 ',lenses),sony);
assert.equal(findProduct('ILCE-7RM5',bodies).officialName,'Sony α7R V');
const canon=findProduct('EOS R50',bodies);
assert.equal(canon.manufacturer,'Canon');
assert.equal(findProduct('RF24mm',lenses),null,'a code shared by two different lenses is ambiguous');
assert.equal(findProduct('RF24mm',lenses,canon),null,'same mount does not resolve two different apertures');
assert.equal(findProduct('RF24mm F1.8 MACRO IS STM',lenses,canon).manufacturer,'Canon');
assert.equal(findProduct('FE 35mm F1.4 GM II',lenses),null,'a suffix must not silently select the first generation');
const variants=[
  {id:'sigma-e',officialName:'Sigma Test 50mm F1.4',modelCode:'TEST50',manufacturer:'Sigma',mount:'Sony E'},
  {id:'sigma-z',officialName:'Sigma Test 50mm F1.4',modelCode:'TEST50',manufacturer:'Sigma',mount:'Nikon Z'},
];
assert.equal(findProduct('TEST50',variants),null);
assert.equal(findProduct('TEST50',variants,{mount:'Nikon Z'}).id,'sigma-z');
assert.equal(findProduct('TEST50',variants,{mount:'Sony E'}).manufacturer,'Sigma','body manufacturer must not replace a third-party lens');
assert.equal(equipmentText({LensModel:'SEL35F14GM'}),'');
assert.equal(findProduct('35mm F1.4',[{model:'35mm F1.4',officialName:'Test 35mm F1.4'}]),null,'focal length and aperture alone do not identify a lens');

// Exercise the application handlers with a delayed EXIF parser.
const source=await readFile(new URL('../public/assets/js/resize/app.js',import.meta.url),'utf8');
const photo={id:'photo',bodyRaw:'EOS R50',lensRaw:'',body:null,lens:null};
let finishExif;
const delayedExif=new Promise(resolve=>{finishExif=resolve;});
let renders=0;
const context=vm.createContext({
  trackUsage:()=>Promise.resolve(true),
  equipmentText,productName,findProduct,bodies,lenses,photo,photos:[photo],outputs:[{name:'old-output.jpg'}],
  parseExif:()=>delayedExif,formatExifSettings:()=>'',currentPhoto:()=>photo,
  renderAll:()=>{renders++;},refs:{equipmentBody:{value:'EOS R50'},equipmentLens:{value:''},equipmentDetected:{}},console,
});
for(const [start,end] of [
  ['async function readPhotoEquipment(', 'function matchPhotoEquipment('],
  ['function matchPhotoEquipment(', 'function syncEquipmentControls('],
  ['function selectEquipment(', 'function applyEquipmentToAll('],
  ['function applyEquipmentToAll(', 'function formatExifSettings('],
])vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),context);
photo.file={name:'test.jpg'};
const reading=vm.runInContext('readPhotoEquipment(photo)',context);
vm.runInContext("selectEquipment('lens')",context);
assert.equal(photo.lensManual,true);
const target={id:'target',bodyRaw:'',lensRaw:'',file:{name:'target.jpg'}};
context.photos.push(target);
const targetReading=vm.runInContext('readPhotoEquipment(photos[1])',context);
const before=renders;
vm.runInContext('applyEquipmentToAll()',context);
assert(renders>before,'applying equipment must also clear old download buttons');
assert.equal(vm.runInContext('outputs.length',context),0);
finishExif({Model:'ILCE-7RM5',LensModel:'SEL35F14GM'});
await Promise.all([reading,targetReading]);
for(const p of [photo,target]){
  assert.equal(p.lensRaw,'','manual clearing must survive late EXIF');
  assert.equal(p.lens,null);
  assert.equal(p.bodyRaw,'EOS R50','apply-to-all must preserve the explicit body');
}

// A direct selection made before the catalog loads still resolves once it is ready.
context.bodies=[];context.lenses=[];
context.refs.equipmentLens.value='Sony FE 35mm F1.4 GM';
vm.runInContext("selectEquipment('lens')",context);
assert.equal(photo.lens,null);
context.bodies=bodies;context.lenses=lenses;
vm.runInContext('matchPhotoEquipment(photo)',context);
assert.equal(photo.lens,sony);

// Export must wait for both catalog loading and EXIF parsing.
let finishProducts,finishPhoto;
context.productsReady=new Promise(resolve=>{finishProducts=resolve;});
photo.equipmentReady=new Promise(resolve=>{finishPhoto=resolve;});
context.photos=[photo];context.processing=false;context.outputs=[];
context.settings={};context.enforceExclusiveRatioMode=()=>{};context.syncSettings=()=>{};
context.lockControls=()=>{};context.updateProgress=()=>{};context.renderOutputList=()=>{};
context.Worker=class{terminate(){}};
context.URL={revokeObjectURL(){},createObjectURL(){return 'blob:test';}};
context.outputName=name=>name;context.applyMetadataPolicy=async(_file,blob)=>blob;
let jobs=0;
context.runWorkerJob=async()=>{jobs++;return {blob:{},width:1,height:1};};
vm.runInContext(source.slice(source.indexOf('async function processAll('),source.indexOf('function runWorkerJob(')),context);
const exporting=vm.runInContext('processAll()',context);
assert.equal(jobs,0);
finishProducts();await Promise.resolve();assert.equal(jobs,0);
finishPhoto();await exporting;assert.equal(jobs,1);

// The actual export message must omit unmatched lens assets while retaining the body.
context.crypto={randomUUID};context.setTimeout=setTimeout;context.clearTimeout=clearTimeout;
context.watermarkFile=null;context.clampBorderSize=value=>value||5;
vm.runInContext(source.slice(source.indexOf('function runWorkerJob('),source.indexOf('function renderOutputList(')),context);
let exportOptions;
const handlers=new Map();
context.worker={
  addEventListener:(event,handler)=>handlers.set(event,handler),
  removeEventListener:event=>handlers.delete(event),
  postMessage:message=>{
    exportOptions=message.options;
    handlers.get('message')({data:{jobId:message.jobId,ok:true}});
  },
};
photo.body=canon;photo.lens=null;photo.lensRaw='EF50mm f/1.8 STM';
await vm.runInContext('runWorkerJob(worker,photo)',context);
assert.equal(exportOptions.bodyImageSrc,canon.imageSrc);
assert.equal(exportOptions.lensImageSrc,'');
assert.equal(exportOptions.lensName,'EF50mm f/1.8 STM','unmatched text must not become an unrelated product name');

// Disabled legacy equipment is available only through the watermark loader.
const legacy=JSON.parse(await readFile(new URL('../public/data/watermark-equipment.json',import.meta.url),'utf8'));
const legacyIds=['ext-canon-canon-eos-5d-mark-iv','ext-canon-canon-ef-canon-ef-24-70mm-f-2-8l-ii-usm','ext-canon-canon-ef-canon-ef-16-35mm-f-4l-is-usm'];
assert.deepEqual(legacy.map(product=>product.id).sort(),[...legacyIds].sort());
assert(legacy.every(product=>product.active===false&&product.imageSrc),'watermark additions preserve their inactive catalog status');
assert(source.includes('products = await loadWatermarkEquipment()'),'the program must use the separate equipment loader');
const originalFetch=globalThis.fetch;
async function loadEquipmentCase({indexAvailable=true,extraAvailable=true,extra=legacy}={}){
  globalThis.fetch=async url=>{
    const path=new URL(String(url),'https://matchcamera.com').pathname;
    if(path==='/data/product-index.json')return {ok:indexAvailable,json:async()=>[...rows,...legacy]};
    if(path==='/data/watermark-equipment.json')return {ok:extraAvailable,json:async()=>extra};
    try{
      const json=JSON.parse(await readFile(new URL(`../public${path}`,import.meta.url),'utf8'));
      return {ok:true,json:async()=>json};
    }catch{return {ok:false};}
  };
  const data=await import(new URL(`../public/assets/js/data.js?equipmentTest=${randomUUID()}`,import.meta.url));
  const equipment=await data.loadWatermarkEquipment();
  const catalog=await data.loadProductIndex();
  const fullCatalog=await data.loadProducts();
  for(const id of legacyIds){
    assert(!catalog.some(product=>product.id===id),'lightweight public catalog must keep DSLR products hidden');
    assert(!fullCatalog.some(product=>product.id===id),'full public catalog must keep DSLR products hidden');
  }
  assert.equal(new Set(equipment.map(product=>product.id)).size,equipment.length,'watermark equipment must not duplicate ids');
  return {equipment,catalog};
}
try{
  for(const indexAvailable of [true,false]){
    const {equipment}=await loadEquipmentCase({indexAvailable});
    const body=findProduct('EOS 5D Mark IV',equipment.filter(product=>product.type==='바디'));
    const lens=findProduct('EF24-70mm F2.8 L II USM',equipment.filter(product=>product.type==='렌즈'),body);
    assert.equal(body?.id,legacyIds[0]);assert.equal(lens?.id,legacyIds[1]);
    assert(body.imageSrc&&lens.imageSrc,'both identified Canon products must have a usable image path');
    const equipmentLenses=equipment.filter(product=>product.type==='렌즈');
    for(const raw of ['EF16-35mm f/4L IS USM','EF16-35mm F4 L IS USM']){
      const wideLens=findProduct(raw,equipmentLenses,body);
      assert.equal(wideLens?.id,legacyIds[2],`the exact F4 lens must resolve for ${raw}`);
      assert(wideLens.imageSrc,'the requested F4 lens must have its own product image');
      assert.notEqual(wideLens.imageSrc,lens.imageSrc,'the F4 wide-angle lens must not reuse the 24-70mm product image');
      assert.equal(findProduct(raw,equipmentLenses)?.id,legacyIds[2],'an exact lens EXIF must also resolve without body metadata');
    }
    for(const raw of ['EF16-35mm f/2.8L III USM','EF16-35mm','16-35mm F4']){
      assert.equal(findProduct(raw,equipmentLenses,body),null,`${raw} must not be mistaken for the F4 lens`);
    }
    assert.equal(findProduct('EF50mm f/1.8 STM',equipment.filter(product=>product.type==='렌즈')),null,'other disabled lenses are still unavailable and cannot become the new Canon lens');
  }
  for(const options of [{extraAvailable:false},{extra:{invalid:'not an array'}}]){
    const {equipment,catalog}=await loadEquipmentCase(options);
    assert.deepEqual(equipment,catalog,'missing or malformed optional additions must preserve the active catalog');
  }
  const duplicate={...rows[0],active:false,imageSrc:'/duplicate-must-not-win.png'};
  const {equipment}=await loadEquipmentCase({extra:[...legacy,duplicate]});
  assert.equal(equipment.find(product=>product.id===rows[0].id).imageSrc,rows[0].imageSrc,'a stale supplemental record cannot replace an active product');
}finally{globalThis.fetch=originalFetch;}
console.log('Equipment matching passed: no guesses, exact models, manual overrides, delayed EXIF and program-only Canon legacy photos.');
