import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SUPPORT_BRANDS,supportSort,normalizeSupportMount,tripodHeadCompatibility,plateHeadCompatibility,supportHead} from '../public/assets/js/support-compatibility.js';
const read=async name=>JSON.parse(await readFile(new URL(`../public/data/${name}.json`,import.meta.url),'utf8'));
const tripods=await read('tripods'),heads=await read('heads');
for(const brand of SUPPORT_BRANDS)assert(tripods.some(p=>p.manufacturer===brand),brand);
for(const rows of [tripods,heads]){
 assert.equal(new Set(rows.map(p=>p.id)).size,rows.length);
 for(const row of rows){assert(row.officialSource.startsWith('https://')&&row.verifiedAt);if(row.kind==='tripod-kit')assert(row.includedHead?.officialName);}
}
const manfrotto=tripods.find(p=>p.id==='manfrotto-mt055xpro3'),benro=heads.find(p=>p.id==='benro-gx35');
assert.equal(tripodHeadCompatibility(manfrotto,benro).level,'compatible','cross-brand standard thread');
assert.equal(normalizeSupportMount('3/8″ screw'),''); // Descriptive text must not accidentally imply a verified socket.
assert.equal(normalizeSupportMount('3/8-inch'),'3/8-16');
assert.equal(tripodHeadCompatibility({},{}).level,'unknown','two absent mounts are never compatible');
assert.equal(tripodHeadCompatibility({headMount:'unverified'},{tripodMount:'unverified'}).level,'unknown');
assert.equal(tripodHeadCompatibility({headMount:'1/4-20'},benro).level,'conditional');
assert.equal(tripodHeadCompatibility({headMount:'bowl-100'},{tripodMount:'bowl-75'}).level,'conditional');
assert.equal(tripodHeadCompatibility({headMount:'bowl-75'},{tripodMount:'bowl-75'}).level,'compatible');
assert.equal(tripodHeadCompatibility(manfrotto,{tripodMount:'bowl-75'}).level,'conditional');
assert.equal(tripodHeadCompatibility({headReplaceable:false,headMount:'3/8-16'},benro).level,'incompatible');
const peak=tripods.find(p=>p.id==='peak-design-travel-cf');
assert.match(tripodHeadCompatibility(peak,benro).reason,/Universal Head Adapter/);
assert.equal(tripodHeadCompatibility(peak,benro).level,'conditional');
assert.equal(supportHead(peak,null),peak.includedHead);
assert.equal(supportHead(peak,benro),benro);
assert.equal(plateHeadCompatibility({},{}).level,'unknown');
assert.equal(plateHeadCompatibility({standard:'Arca-Swiss'},{plateStandard:'Arca-Swiss'}).level,'conditional');
assert.equal(plateHeadCompatibility({standard:'Arca-Swiss'},{plateStandard:'Manfrotto RC2'}).level,'incompatible');
assert.equal(plateHeadCompatibility({modelCode:'200PL-14'},{includedPlate:'200PL-14'}).level,'compatible');
assert.equal(supportSort(tripods)[0].manufacturer,'Manfrotto');
const velbon=tripods.find(p=>p.manufacturer==='Velbon');assert.equal(velbon.maxLoadKg,3,'kit recommended load must not use the 8kg legs-only figure');
console.log('Support checks passed: 11 new brands, kit configuration, cross-brand threads, missing specs, bowl adapters and separate plate compatibility.');
