import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const readJson=file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const productFiles=['public/data/products.json','public/data/system-expansion.json','public/data/official-partner-products.json','public/data/hasselblad-products.json'];
const products=productFiles.flatMap(file=>readJson(file));
const mappingPath=path.join(root,'public/data/product-images.json');
const mapping=readJson('public/data/product-images.json');
const label=product=>product.officialName||product.model||product.modelCode||product.id;
const byName=new Map();
for(const product of products){const name=label(product);if(!byName.has(name))byName.set(name,[]);byName.get(name).push(product);}
const migrated={};const unresolved=[];
for(const [key,value] of Object.entries(mapping)){
  const direct=products.find(product=>product.id===key);
  const candidates=byName.get(key)||[];
  const product=direct||(candidates.length===1?candidates[0]:null);
  if(product)migrated[product.id]=value;
  else{migrated[key]=value;unresolved.push(key);}
}
const used=new Set(Object.values(migrated).map(value=>typeof value==='string'?value:value?.src).filter(Boolean));
const imageRoot=path.join(root,'public/assets/images/products');
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.(?:webp|png|jpe?g|avif)$/i.test(entry.name))files.push(full);}}
walk(imageRoot);
const publicPath=file=>`/${path.relative(path.join(root,'public'),file).replaceAll(path.sep,'/')}`;
const byBasename=new Map(files.map(file=>[path.basename(file,path.extname(file)).toLowerCase(),file]));
for(const product of products){
  if(migrated[product.id])continue;
  const file=byBasename.get(String(product.id||'').toLowerCase());
  if(file){const src=publicPath(file);migrated[product.id]={src,method:'existing-file-id-match',fetchedAt:new Date().toISOString(),usageReviewRequired:true};used.add(src);}
}
const orphans=files.map(publicPath).filter(src=>!used.has(src));
fs.writeFileSync(mappingPath,`${JSON.stringify(migrated,null,2)}\n`);
fs.writeFileSync(path.join(root,'public/data/product-images-orphans.json'),`${JSON.stringify({generatedAt:new Date().toISOString(),unresolvedLegacyKeys:unresolved,orphanFiles:orphans},null,2)}\n`);
console.log(JSON.stringify({products:products.length,mappings:Object.keys(migrated).length,unresolvedLegacyKeys:unresolved.length,orphanFiles:orphans.length},null,2));
