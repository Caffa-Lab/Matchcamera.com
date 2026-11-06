import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {handleVisit} from '../worker/visitor-stats.js';

const root = path.resolve('public');
const pages = ['beta/index.html','program/calculators/index.html','program/kit/index.html','program/photo-privacy/index.html'];
const read = file => fs.readFile(path.join(root,file),'utf8');
const sitemap = await read('sitemap.xml');
for(const page of pages){
  const html=await read(page);
  assert.match(html,/noindex,follow/,'experimental pages must declare beta indexing policy');
  assert.match(html,/BETA/);
  assert.match(html,/name="viewport"/);
  assert.match(html,/\/assets\/css\/responsive\.css/);
  assert.match(html,/\/assets\/js\/common\.js/);
  assert.match(html,/\/apple-touch-icon\.png/);
  assert.equal((html.match(/<h1(?:\s[^>]*)?>/g)||[]).length,1);
  assert.doesNotMatch(html,/googlesyndication|unpkg\.com|cdn\.jsdelivr\.net/,'beta tools keep local dependencies and existing ad scope');
  assert(!sitemap.includes(`https://matchcamera.com/${page.replace('index.html','')}`),'noindex experiments must not enter indexable sitemap');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,new Set(ids).size,`${page} unique element IDs`);
  for(const [,url] of html.matchAll(/(?:href|src)="(\/[^"\s]+)"/g)){
    const parsed=new URL(url,'https://matchcamera.com'), local=path.join(root,decodeURIComponent(parsed.pathname));
    const target=parsed.pathname.endsWith('/')?path.join(local,'index.html'):local;
    await fs.access(target);
    if(parsed.hash){const linked=await fs.readFile(target,'utf8');assert(linked.includes(`id="${parsed.hash.slice(1)}"`),`${page}: missing linked anchor ${url}`);}
  }
}
const hub=await read('beta/index.html');
assert.equal((hub.match(/class="beta-card"/g)||[]).length,9);
assert.match(await read('index.html'),/href="\/beta\/"/,'program homepage must expose the experiments');
assert.match(await read('builder/index.html'),/id="budgetRecommendations"/);
const privacy=await read('privacy/index.html');
assert.match(privacy,/사진 개인정보 제거 BETA/);
assert.match(privacy,/내 장비·촬영 준비 BETA/);
assert.match(privacy,/다른 기기와 자동 동기화하지/);

const common=(await read('assets/js/common.js')).replace(/^import .*;\r?\n/gm,'');
for(const [pathname,surface] of [['/beta/','beta'],['/program/calculators/','calculators'],['/program/kit/','kit'],['/program/photo-privacy/','photo_privacy']]){
  const captured=[];
  const context=vm.createContext({location:{pathname},document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}}},trackUsage:()=>Promise.resolve(false),trackVisit:surface=>{captured.push(surface);return Promise.resolve(true);}});
  vm.runInContext(common,context);
  assert.deepEqual(captured,[surface],`${pathname} uses fixed non-sensitive visitor label`);
  assert.deepEqual([...vm.runInContext('nav.filter(item=>item[2]).map(item=>item[0])',context)],['/'],'beta pages keep the program menu active');
  const response=await handleVisit(new Request('https://matchcamera.com/api/visits',{method:'POST',headers:{Origin:'https://matchcamera.com','Content-Type':'application/json'},body:JSON.stringify({visitorId:'f'.repeat(32),surface})}),{VISITOR_STATS:{idFromName:()=>1,get:()=>({fetch:async()=>new Response(null,{status:202})})}});
  assert.equal(response.status,202,'new page labels must be accepted by the existing protected collection contract');
}
console.log('BETA tools: nine linked features, real asset/anchor targets, indexing/ad scope, privacy and visitor integration passed.');
