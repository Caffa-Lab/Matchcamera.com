import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DATA=path.join(ROOT,'public','data');
const read=async(name,fallback)=>{try{return JSON.parse(await readFile(path.join(DATA,name),'utf8'))}catch{return fallback}};
const label=p=>String(p?.officialName||p?.model||p?.modelCode||'').trim();
const keyOf=p=>`${label(p)}||${String(p?.modelCode||'').trim()}||${String(p?.type||'').trim()}`;

function merge(...lists){
  const rows=[];const map=new Map();
  for(const list of lists)for(const item of Array.isArray(list)?list:[]){
    const key=keyOf(item);if(!key)continue;
    if(map.has(key))Object.assign(map.get(key),item);
    else{const copy={...item};map.set(key,copy);rows.push(copy)}
  }
  return rows;
}

const [base,expansion,partners,hasselblad,prices,imageMap]=await Promise.all([
  read('products.json',[]),read('system-expansion.json',[]),read('official-partner-products.json',[]),
  read('hasselblad-products.json',[]),read('korea-prices.json',[]),read('product-images.json',{}),
]);

const priceExact=new Map();const priceByName=new Map();
for(const row of Array.isArray(prices)?prices:[]){
  const name=String(row?.['정식 제품명']||'').trim();if(!name)continue;
  const mount=String(row?.['마운트']||'').trim();priceExact.set(`${name}||${mount}`,row);
  if(!priceByName.has(name))priceByName.set(name,[]);priceByName.get(name).push(row);
}

function displayPrice(p){
  const name=label(p);const mount=String(p.mount||'').trim();
  let row=priceExact.get(`${name}||${mount}`);const same=priceByName.get(name)||[];if(!row&&same.length===1)row=same[0];
  for(const value of [row?.['한국 기준 가격(원)'],row?.['한국 공식/출시 가격(원)'],p.currentPriceKrw]){
    const number=Number(value);if(Number.isFinite(number)&&number>0)return number;
  }
  return null;
}

function imageSrc(p){const value=imageMap?.[p.id]||imageMap?.[label(p)];return typeof value==='string'?value:value?.src||null}
function normalizedSystem(p){
  const raw=String(p.cameraSystem||'').trim();const name=label(p);
  if(/Cinema Line\s+FX|EOS\s+C\d|EOS R5 C|Blackmagic|PYXIS|URSA|EVA1|BGH1|BS1H/i.test(name))return '시네마';
  if(/DSLT/i.test(raw))return 'DSLR';return raw||'미러리스';
}

const index=merge(base,expansion,partners,hasselblad)
  .filter(p=>p?.active!==false&&p?.enabled!==false&&p?.visibility!=='hidden')
  .map(p=>{
    const aliases=[p.id,p.officialName,p.model,p.modelCode,p.series,...(p.searchAliases||[]),p.specs?.['모델 코드'],p.specs?.['렌즈 모델명'],p.specs?.['정식 제품명']]
      .map(value=>String(value||'').trim()).filter(Boolean);
    return {
      id:p.id,manufacturer:p.manufacturer,type:p.type,officialName:p.officialName||p.model||p.modelCode,
      model:p.model||null,modelCode:p.modelCode||null,series:p.series||null,mount:p.mount||null,
      cameraSystem:normalizedSystem(p),sensorFormat:p.sensorFormat||null,lensFormat:p.lensFormat||null,
      focalLength:p.focalLength||null,maxAperture:p.maxAperture||null,releaseYear:p.releaseYear||null,
      currentSale:p.currentSale||null,currentPriceKrw:displayPrice(p),imageSrc:imageSrc(p),
      filterDiameterMm:p.filterDiameterMm??p.specs?.['필터 구경(mm)']??null,
      exifAliases:[...new Set(aliases)],active:true,
    };
  });

await writeFile(path.join(DATA,'product-index.json'),`${JSON.stringify(index,null,2)}\n`,'utf8');
console.log(`product-index.json: ${index.length} products`);
