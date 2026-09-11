import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const products=(await Promise.all(['products','system-expansion','hasselblad-products'].map(async n=>JSON.parse(await readFile(new URL(`../public/data/${n}.json`,import.meta.url),'utf8'))))).flat();
const canon=products.find(p=>p.id==='canon-바디-canon-rf-eos-r5-mark-ii');
assert.equal(canon.specs['총 화소(MP)'],50.3);
assert.equal(canon.weightG,746);
assert.equal(canon.specs['배터리 모델'],'LP-E6P');
for(const [name,mp] of [['Fujifilm X-T5',40.2],['Fujifilm X-H2S',26.16],['Fujifilm GFX100 II',102]]){
 const p=products.find(p=>p.officialName===name);assert.equal(p.megapixels,mp,`${name}: Korean pixel units`);
}
for(const p of products){
 for(const [key,source] of Object.entries(p.specSources||{})){
  assert(source.url.startsWith('https://')&&source.checkedAt);
  assert(p.specs[key]!==undefined,`${p.id} ${key}: missing sourced value`);
 }
 if(p.manufacturer==='Fujifilm'&&p.specSources){
  assert(!/ISO|셔터|EV/.test(p.specs['동영상 기록 상세']||''),'sub-row exposure settings are not movie specifications');
  if(p.specSources['치수 상세'])assert(/mm/.test(p.specs['치수 상세']));
 }
}
console.log('PASS source provenance, Canon battery/weight, Korean megapixel units and Fuji table sections');
