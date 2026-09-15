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
console.log('Equipment matching passed: no guesses, exact models, ambiguous mounts, manual overrides and delayed EXIF.');
