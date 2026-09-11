import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {matchesSearch,isSupportedMemoryCard,loadAdapters,loadMemoryCards,loadPlates} from '../public/assets/js/data.js';
import {accessoryComparisonProduct} from '../public/assets/js/accessory-compare.js';
const read=async name=>JSON.parse(await readFile(new URL(`../public/data/${name}.json`,import.meta.url),'utf8'));
const fixtures=[['소니 a7r5',{manufacturer:'Sony',officialName:'Sony α7R V'}],['캐논 RF',{manufacturer:'Canon',officialName:'RF 24-70mm F2.8'}],['니콘 z8',{manufacturer:'Nikon',officialName:'Nikon Z8'}],['후지필름 x t5',{manufacturer:'Fujifilm',officialName:'X-T5'}],['핫셀블라드 x2d',{manufacturer:'Hasselblad',officialName:'X2D 100C'}],['포토클램 pc59',{manufacturer:'PhotoClam',officialName:'PC-59-UP4'}],['프로그레이드 CFA',{manufacturer:'ProGrade Digital',officialName:'Cobalt',cardType:'CFexpress Type A'}]];
for(const [query,product] of fixtures)assert(matchesSearch(product,query),query);
assert(!matchesSearch(fixtures[0][1],'캐논 a7'));
for(const card of [{cardType:'SDXC',bus:'UHS-I'},{cardType:'microSDXC',bus:'UHS-II'},{cardType:'XQD'},{cardType:'CF'},{cardType:'SDXC',bus:'UHS-II',active:false}])assert(!isSupportedMemoryCard(card));
for(const card of [{cardType:'SDXC',bus:'UHS-II'},{cardType:'SDXC',bus:'UHS-III'},{cardType:'CFexpress Type A'},{cardType:'CFexpress Type B'}])assert(isSupportedMemoryCard(card));
const data={};for(const name of ['mount-adapters','memory-cards','plates'])data[name]=await read(name);
globalThis.fetch=async url=>({ok:true,json:async()=>data[url.match(/([^/]+)\.json/)[1]]});
const adapters=await loadAdapters();assert(adapters.every(r=>r.fromMount==='Leica M'));assert.equal(data['mount-adapters'].filter(r=>r.active===false).length,16);assert.deepEqual(await loadAdapters(),adapters);
const memory=await loadMemoryCards();assert(memory.length>40);assert(memory.every(isSupportedMemoryCard));assert.deepEqual(await loadMemoryCards(),memory);
const plates=await loadPlates();assert(plates.length>300);assert.equal(new Set(plates.map(r=>r.manufacturer)).size,12);
for(const [name,rows] of [['memory',memory],['plates',plates]]){assert.equal(new Set(rows.map(r=>r.id)).size,rows.length,name+' unique IDs');for(const row of rows){assert(row.imageSrc,row.id+' photo');await readFile(new URL('../public'+row.imageSrc,import.meta.url));if(row.imageFetchedAt==='2026-09-12'){assert(row.priceSource&&row.priceDate,row.id+' price provenance');assert(row.officialSource,row.id+' source');}}}
const a=accessoryComparisonProduct({id:'card',manufacturer:'Lexar',readMbps:280,writeMbps:120,capacityGb:128,hss:false,currentPriceKrw:139000,koreaPriceStatus:'국내 판매처 표시가'},'memory');assert.equal(a.specs['최대 쓰기(MB/s)'],120);assert.equal(a.specs.HSS,'미지원');assert.equal(a.koreaPriceType,'국내 판매처 표시가');assert.equal(a.type,'액세서리');
const sd=memory.find(r=>r.id==='lexar-kr-2151');assert.equal(sd.writeMbps,120,'128GB Silver Pro must not inherit 256GB speed');
console.log(`PASS Korean mixed queries, 16 disabled adapters, ${memory.length} scoped cards, ${plates.length} plates, all 12 brands, photos and comparison fields`);
