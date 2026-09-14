import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {memoryCardCompatibility} from '../public/assets/js/data.js';

// A full-size SD card cannot fit the microSD slots on several compact cameras.
const sd={cardType:'SDXC',bus:'UHS-II'};
for(const media of ['microSD / microSDHC / microSDXC','micro SD/micro SDHC','micro-SDXC']){
  assert.equal(memoryCardCompatibility(sd,{specs:{'메모리카드 종류':media}}).level,'incompatible');
}
assert.equal(memoryCardCompatibility(sd,{specs:{'메모리카드 종류':'SD/SDHC/SDXC'}}).level,'compatible');
assert.equal(memoryCardCompatibility(sd,{specs:{'메모리카드 종류':'microSD with adapter / SDXC'}}).level,'compatible');
assert.equal(memoryCardCompatibility(sd,{specs:{'메모리카드 종류':'SD/SDHC (Up to 32GB Support)'}}).level,'incompatible');
assert.equal(memoryCardCompatibility(sd,{specs:{'메모리카드 종류':'SD memory card'}}).level,'unknown');
assert.equal(memoryCardCompatibility({...sd,capacityGb:512},{specs:{'메모리카드 종류':'SD/SDHC/SDXC (최대 256GB)'}}).level,'incompatible');
assert.equal(memoryCardCompatibility({...sd,capacityGb:128},{specs:{'메모리카드 종류':'SD/SDHC/SDXC (최대 256GB)'}}).level,'compatible');

// Exercise the actual URL hydration and lens-selection handlers.
const source=await readFile(new URL('../public/assets/js/builder.js',import.meta.url),'utf8');
const fixed={id:'fixed-test',type:'바디',cameraSystem:'일체형 카메라',currentPriceKrw:2000000};
const lens={id:'lens-test',type:'렌즈',currentPriceKrw:500000};
const interchangeable={id:'body-test',type:'바디',cameraSystem:'미러리스'};
const state={products:[fixed,lens,interchangeable],lenses:[],batteries:[],memoryCards:[],flashes:[],plates:[],heads:[],tripods:[],mode:'body'};
const context=vm.createContext({state,URLSearchParams,location:{search:'?mode=lens&body=fixed-test&lenses=lens-test'},productKey:p=>p.id,toast(){},render(){}});
for(const name of ['hydrate','toggleLens']){
  const line=source.split(/\r?\n/).find(line=>line.startsWith(`function ${name}(`));
  assert(line,`${name} handler is present`);vm.runInContext(line,context);
}
vm.runInContext('hydrate()',context);
assert.equal(state.body,fixed);
assert.equal(state.mode,'body');
assert.equal(state.lenses.length,0,'shared links must not charge for a hidden interchangeable lens');
vm.runInContext("toggleLens('lens-test')",context);
assert.equal(state.lenses.length,0);
context.location.search='?body=body-test&lenses=lens-test';
vm.runInContext('hydrate()',context);
assert.equal(state.mode,'lens');assert.equal(state.lenses[0],lens);

const flashFunction=source.slice(source.indexOf('function flashCompatibility('),source.indexOf('function plateCompatibility('));
vm.runInContext(flashFunction,context);
context.flash={system:'Micro Four Thirds',ttlSystem:'Panasonic'};
context.compact={cameraSystem:'일체형 카메라',manufacturer:'Panasonic',specs:{'핫슈':'없음'}};
assert.equal(vm.runInContext('flashCompatibility(flash,compact).level',context),'incompatible');
context.compact.specs['핫슈']='있음';
assert.equal(vm.runInContext('flashCompatibility(flash,compact).level',context),'conditional');
delete context.compact.specs['핫슈'];
assert.equal(vm.runInContext('flashCompatibility(flash,compact).level',context),'unknown');
context.compact.cameraSystem='미러리스';
assert.equal(vm.runInContext('flashCompatibility(flash,compact).level',context),'compatible');

const rows=JSON.parse(await readFile(new URL('../public/data/system-expansion.json',import.meta.url),'utf8'));
const fixedRows=rows.filter(p=>p.cameraSystem==='일체형 카메라');
assert.equal(new Set(fixedRows.map(p=>p.id)).size,fixedRows.length,'fixed-lens IDs must remain unique');
for(const product of fixedRows){
  assert.equal(product.type,'바디');assert.equal(product.mount,'고정 렌즈');
  if(product.verifiedAt==='2026-09-14'){
    assert(product.officialSource?.startsWith('https://'),'reviewed compact cameras need an official source');
    assert(product.specs?.['내장 렌즈'],'reviewed compact cameras need an identified built-in lens');
    assert.equal(typeof product.maxAperture,'string','compact aperture ranges must retain their full display value');
    assert.notEqual(typeof product.ibis,'boolean','stabilization must match the catalog filter values');
  }
}
console.log(`Fixed-lens catalog and builder checks passed (${fixedRows.length} cameras).`);
