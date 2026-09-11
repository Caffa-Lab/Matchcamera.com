// Cache model pages and image candidates for human review; never publish guesses.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Caffa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'tmp/accessory-sources');fs.mkdirSync(dir,{recursive:true});
const overrides={
 'godox-v1pro-s':"https://godox.com/product-b/V1Pro.html",
 'godox-v1pro-c':"https://godox.com/product-b/V1Pro.html",
 'godox-v1pro-n':"https://godox.com/product-b/V1Pro.html",
 'godox-v1pro-f':"https://godox.com/product-b/V1Pro.html",
 'godox-v1pro-o':"https://godox.com/product-b/V1Pro.html",
 'canon-lp-e6nh':'https://asia.canon/en/consumer/battery-pack-lp-e6nh/product',
 'nikon-en-el15c':'https://imaging.nikon.com/imaging/lineup/accessory/power/en-el15c/',
 'nikon-en-el25':'https://imaging.nikon.com/imaging/lineup/accessory/power/en-el25/',
 'nikon-en-el25a':'https://imaging.nikon.com/imaging/lineup/accessory/power/en-el25a/',
 'fujifilm-np-w235':'https://www.fujifilm-x.com/global/products/accessories/np-w235/',
 'fujifilm-np-w126s':'https://www.fujifilm-x.com/global/products/accessories/np-w126s/',
 'panasonic-dmw-blk22':'https://panasonic.jp/dc/products/accessories/dmw_blk22.html',
 'om-system-blx-1':'https://explore.omsystem.com/us/en/blx-1-lithium-ion-rechargeable-battery',
 'om-system-bls-50':'https://explore.omsystem.com/us/en/bls-50-lithium-ion-battery',
 'pentax-d-li90':'https://www.ricoh-imaging.co.jp/english/products/accessory/index2_list.html',
 'sigma-bp-51':'https://www.sigma-global.com/en/accessories/bp-51/',
 'canon-ef-eos-r':'https://asia.canon/en/consumer/mount-adapter-ef-eos-r/product',
 'canon-control-ring-ef-eos-r':'https://asia.canon/en/consumer/control-ring-mount-adapter-ef-eos-r/product',
 'canon-drop-in-ef-eos-r':'https://asia.canon/en/consumer/drop-in-filter-mount-adapter-ef-eos-r-with-variable-nd-filter-a/product',
 'canon-ef-eos-m':'https://asia.canon/en/consumer/mount-adapter-ef-eos-m/product',
 'nikon-ftz':'https://imaging.nikon.com/imaging/lineup/accessory/camera/ftz/',
 'nikon-ftz-ii':'https://imaging.nikon.com/imaging/lineup/accessory/camera/ftz_2/',
 'nikon-ft1':'https://imaging.nikon.com/imaging/lineup/acil/lenses/mount_adapter_ft1/',
 'sony-la-ea5':'https://www.sony.jp/ichigan/products/LA-EA5/',
 'sony-la-ea4':'https://www.sony.jp/ichigan/products/LA-EA4/',
 'sigma-mc11-ef-e':'https://www.sigma-global.com/en/accessories/mc-11/',
 'sigma-mc11-sa-e':'https://www.sigma-global.com/en/accessories/mc-11/',
 'sigma-mc21-ef-l':'https://www.sigma-global.com/en/accessories/mc-21/',
 'sigma-mc21-sa-l':'https://www.sigma-global.com/en/accessories/mc-21/',
 'olympus-mmf3':'https://explore.omsystem.com/us/en/mmf-3-four-thirds-adapter',
 'panasonic-dmw-ma1':'https://panasonic.jp/dc/products/accessories/dmw_ma1.html',
 'leica-m-adapter-l':'https://leica-camera.com/en-int/photography/accessories/adapters/m-adapter-l-black',
 'pentax-k-q':'https://www.ricoh-imaging.co.jp/english/products/accessory/index2_list.html',
 'sony-hvl-f60rm2':'https://www.sony.jp/ichigan/products/HVL-F60RM2/',
 'sony-hvl-f46rm':'https://www.sony.jp/ichigan/products/HVL-F46RM/',
 'canon-speedlite-el-5':'https://asia.canon/en/consumer/speedlite-el-5/product',
 'sony-sf-g128t':'https://www.sony.jp/rec-media/products/SF-G_T/','sony-cea-g160t':'https://www.sony.jp/rec-media/products/CEA-G/'};
const rows=['mount-adapters','batteries','flashes','memory-cards','plates','tripods','heads'].flatMap(n=>JSON.parse(fs.readFileSync(path.join(root,'public/data',n+'.json'),'utf8')).filter(x=>!x.imageSrc).map(x=>({...x,category:n,url:overrides[x.id]||x.officialSource})));
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});let i=0;await Promise.all(Array.from({length:4},async()=>{const p=await b.newPage();while(i<rows.length){const r=rows[i++],f=path.join(dir,r.id+'.json');if(!r.url)continue;try{const res=await p.goto(r.url,{waitUntil:'domcontentloaded',timeout:18000});const info=await p.evaluate(()=>({title:document.title,url:location.href,text:document.body.innerText.slice(0,18000),og:document.querySelector('meta[property="og:image"]')?.content,images:[...document.images].map(im=>({src:im.currentSrc||im.src,alt:im.alt,w:im.naturalWidth,h:im.naturalHeight})).filter(x=>x.src&&!x.src.endsWith(".svg")),links:[...document.querySelectorAll('a[href]')].map(a=>({text:a.textContent.trim(),url:a.href})).filter(a=>a.text)}));fs.writeFileSync(f,JSON.stringify({...r,...info,status:res.status()},null,2));}catch(e){console.log('FAIL',r.id,e.message.slice(0,50))}if(i%10===0)console.log(i,'/',rows.length)}await p.close()}));await b.close()})().catch(e=>{console.error(e);process.exit(1)});
