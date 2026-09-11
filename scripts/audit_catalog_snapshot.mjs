import {readFile,writeFile,access} from 'node:fs/promises';
import {buildCatalogReview} from '../public/admin/catalog-review.js';
const read=async n=>JSON.parse(await readFile('public/data/'+n+'.json','utf8'));const imageMap=await read('product-images'),prices=await read('korea-prices');
const products=(await Promise.all(['products','system-expansion','official-partner-products','hasselblad-products'].map(async n=>(await read(n)).map((p,i)=>({...p,_sourceFile:'public/data/'+n+'.json',_sourceIndex:i}))))).flat();
const kinds={batteries:'batteries',adapters:'mount-adapters',flashes:'flashes',memoryCards:'memory-cards',tripods:'tripods',heads:'heads',plates:'plates'};
const accessories=(await Promise.all(Object.entries(kinds).map(async([kind,n])=>(await read(n)).map((p,i)=>({...p,_kind:kind,_sourceFile:'public/data/'+n+'.json',_sourceIndex:i}))))).flat();
const imageFor=p=>{const raw=imageMap[p.id]||imageMap[p.officialName];return typeof raw==='string'?{src:raw}:raw};const priceFor=p=>{const exact=prices.find(r=>r['정식 제품명']===p.officialName&&r['마운트']===p.mount);const same=prices.filter(r=>r['정식 제품명']===p.officialName);return {row:exact||(same.length===1?same[0]:null)}};
const issues=buildCatalogReview([...products,...accessories],{imageFor,priceFor});const counts={};for(const i of issues.filter(i=>i.visible))counts[i.type]=(counts[i.type]||0)+1;
const missingFiles=[];for(const p of [...products,...accessories]){const src=p._kind?p.imageSrc:imageFor(p)?.src;if(src?.startsWith('/'))try{await access('public'+src)}catch{missingFiles.push({id:p.id,src})}}
await writeFile('tmp/site-review.json',JSON.stringify({counts,missingFiles,issues},null,2));console.log(JSON.stringify({counts,missingFiles,high:issues.filter(i=>i.severity==='high').map(i=>({id:i.product.id,type:i.type,visible:i.visible,detail:i.detail}))},null,2));
