import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {hasVerifiedSupportLoad,loadTripods,loadHeads} from '../public/assets/js/data.js';
const invalid=[null,{},...['5',0,-1,null,undefined,NaN,Infinity].map(maxLoadKg=>({maxLoadKg})),{maxLoadKg:5,active:false},{maxLoadKg:5,enabled:false},{maxLoadKg:5,visibility:'hidden'}];
for(const item of invalid)assert.equal(hasVerifiedSupportLoad(item),false);
assert.equal(hasVerifiedSupportLoad({maxLoadKg:0.5}),true);
const rows=Object.fromEntries(await Promise.all(['tripods','heads'].map(async name=>[name,JSON.parse(await readFile(new URL(`../public/data/${name}.json`,import.meta.url),'utf8'))])));
globalThis.fetch=async url=>({ok:true,json:async()=>rows[url.includes('tripods')?'tripods':'heads']});
for(const [name,loader] of [['tripods',loadTripods],['heads',loadHeads]]){
 const visible=await loader();
 assert.deepEqual(visible,rows[name].filter(hasVerifiedSupportLoad));
 assert(visible.length>0&&visible.length<rows[name].length);
 for(const row of visible){assert(row.imageSrc,`${row.id}: missing photo`);await readFile(new URL(`../public${row.imageSrc}`,import.meta.url));}
 assert.deepEqual(await loader(),visible,'cached reads preserve visibility filtering');
 console.log(`${name}: ${visible.length} public / ${rows[name].length} source records`);
}
assert(!rows.tripods.some(p=>p.id==='slik-sh-705e'),'a head must not be imported as a tripod kit');
console.log('PASS support load visibility, cache, local photos and category regression');
