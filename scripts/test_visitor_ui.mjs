import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {visitorStatsMarkup,initVisitorStats} from '../public/admin/visitor-stats.js';

const sample = {
  status:'ready', collectedSince:'2026-10-29T15:01:00Z',updatedAt:'2026-10-30T03:00:00Z',
  today:{visitors:2,pageViews:9},last7Days:{visitors:3,pageViews:15},last30Days:{visitors:3,pageViews:15},
  windows:{today:{observedDays:1,complete:true},last7Days:{observedDays:2,complete:false},last30Days:{observedDays:2,complete:false}},
  daily:[{date:'2026-10-29',visitors:2,pageViews:6},{date:'2026-10-30',visitors:2,pageViews:9}],
};
const html = visitorStatsMarkup(sample);
assert.match(html,/최근 7일 추정 방문자<\/small><strong>3/,'period unique visitors must use server distinct count, not sum daily counts');
assert.match(html,/오늘 페이지 조회수<\/small><strong>9/);
assert.match(html,/수집 기간 2일/,'partial windows must not claim full month coverage');
assert.match(html,/viewBox="0 0 900 210"/);
assert.match(html,/<caption>/,'accessible exact daily table accompanies graph');
assert.equal((html.match(/<circle /g)||[]).length,2);
assert.doesNotMatch(html,/NaN|Infinity|undefined|onclick=|style=/);
assert.match(visitorStatsMarkup({...sample,collectedSince:null,daily:[]}),/첫 방문이 기록되면/);
assert.match(visitorStatsMarkup({status:'unavailable'}),/연결되지/);
assert.throws(()=>visitorStatsMarkup({status:'error'}));
assert.throws(()=>visitorStatsMarkup({...sample,today:{visitors:null,pageViews:0}}),'missing counts must not render as zero');
assert.throws(()=>visitorStatsMarkup({...sample,daily:[{date:'<script>',visitors:1,pageViews:1}]}));
assert.doesNotMatch(visitorStatsMarkup({...sample,today:{visitors:0,pageViews:0},daily:[{date:'2026-10-30',visitors:0,pageViews:0}]}),/NaN|Infinity/,'true zero visits still renders valid chart');
const month = {...sample,daily:Array.from({length:30},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,visitors:1,pageViews:2}))};
assert.equal((visitorStatsMarkup(month,7).match(/<circle /g)||[]).length,7);
assert.equal((visitorStatsMarkup(month,30).match(/<circle /g)||[]).length,30);

// Exercise failure isolation and retry using the actual UI controller.
const content = {innerHTML:'',addEventListener(){},setAttribute(){}};
const button = {disabled:false,addEventListener(){}};
globalThis.document = {querySelector: selector => selector === '#visitorStatsContent' ? content : button};
let fail = true;
const refresh = initVisitorStats(async()=>{if(fail)throw Error('private diagnostics');return sample;});
await new Promise(resolve=>setImmediate(resolve));
assert.match(content.innerHTML,/불러오지 못했습니다/);
assert.doesNotMatch(content.innerHTML,/private diagnostics/);
assert.equal(button.disabled,false);
fail=false;await refresh();
assert.match(content.innerHTML,/오늘 추정 방문자/);
delete globalThis.document;

const common = (await readFile(new URL('../public/assets/js/common.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
for(const [path,surface] of [['/','programs'],['/index.html','programs'],['/home/','home'],['/program/shutter-count/','shutter'],['/care/','care'],['/betatest/','betatest'],['/privacy/','privacy'],['/admin/',null],['/404.html',null]]){
  const seen=[];
  vm.runInNewContext(common,{location:{pathname:path},document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}}},trackUsage:()=>Promise.resolve(false),trackVisit:value=>{seen.push(value);return Promise.resolve(false);}});
  assert.deepEqual(seen,surface?[surface]:[],`${path} correct visitor coverage; admin excluded`);
}
console.log('Visitor dashboard periods, real zero/loading/errors, accessible trend, retry isolation and public page coverage passed.');
