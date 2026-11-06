import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {depthOfField,fieldOfView,storageEstimate,timelapsePlan,printDimensions,SENSOR_FORMATS} from '../public/assets/js/calculators/calculations.js';
const close=(actual,expected,tolerance=1e-9)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

// Exact thin-lens case: f=50, N=10, c=.025 => h0=10m, H=10.05m.
const lens={focalMm:50,aperture:10,cocMm:.025,focusM:2};
let dof=depthOfField(lens);
close(dof.hyperfocalM,10.05);close(dof.nearM,20000/11950);close(dof.farM,20000/8050);close(dof.totalM,dof.farM-dof.nearM);
dof=depthOfField({...lens,focusM:10.05});
assert.equal(dof.farM,Infinity);close(dof.nearM,5.025);
dof=depthOfField({...lens,infinity:true,focusM:NaN});close(dof.nearM,10);assert.equal(dof.farM,Infinity);
assert.throws(()=>depthOfField({...lens,focusM:.05}),/거리/);
assert.throws(()=>depthOfField({...lens,cocMm:0}));
assert.throws(()=>depthOfField({...lens,aperture:NaN}));

const full=fieldOfView({focalMm:50,sensorWidthMm:36,sensorHeightMm:24,distanceM:10});
close(full.crop,1);close(full.equivalentMm,50);close(full.sceneWidthM,7.2);close(full.horizontalDegrees,39.597752709049864);
const half=fieldOfView({focalMm:25,sensorWidthMm:18,sensorHeightMm:12,distanceM:10});
close(half.crop,2);close(half.equivalentMm,50);close(half.horizontalDegrees,full.horizontalDegrees);close(half.sceneWidthM,full.sceneWidthM);
assert.throws(()=>fieldOfView({focalMm:0,sensorWidthMm:36,sensorHeightMm:24,distanceM:10}));
for(const preset of Object.values(SENSOR_FORMATS))assert.ok(preset.width>0&&preset.height>0&&preset.coc>0);

const storage=storageEstimate({capacityGB:128,fileMB:40,bitrateMbps:200,usablePercent:100});
assert.equal(storage.photos,3200);assert.equal(storage.videoSeconds,5120);assert.equal(storage.usableGB,128);
assert.equal(storageEstimate({capacityGB:1,fileMB:3000,bitrateMbps:8,usablePercent:50}).photos,0);
assert.equal(storageEstimate({capacityGB:1,fileMB:1,bitrateMbps:8,usablePercent:100}).videoSeconds,1000,'decimal GB and bit/byte conversion');
assert.throws(()=>storageEstimate({capacityGB:128,fileMB:40,bitrateMbps:0,usablePercent:100}));
assert.throws(()=>storageEstimate({capacityGB:128,fileMB:40,bitrateMbps:8,usablePercent:101}));

const lapse=timelapsePlan({movieSeconds:10,fps:30,intervalSeconds:5,shutterSeconds:1});
assert.equal(lapse.frames,300);assert.equal(lapse.shootingSeconds,1496);assert.equal(lapse.startSpanSeconds,1495);assert.equal(lapse.spareSeconds,4);
const single=timelapsePlan({movieSeconds:.1,fps:1,intervalSeconds:5,shutterSeconds:1});assert.equal(single.frames,1);assert.equal(single.shootingSeconds,1);assert.equal(single.movieSeconds,1);
assert.equal(timelapsePlan({movieSeconds:10,fps:29.97,intervalSeconds:2,shutterSeconds:1}).frames,300);
assert.throws(()=>timelapsePlan({movieSeconds:10,fps:30,intervalSeconds:1,shutterSeconds:2}),/ノ|노출/);
assert.equal(timelapsePlan({movieSeconds:10,fps:30,intervalSeconds:1,shutterSeconds:1}).spareSeconds,0);

const print=printDimensions({widthPx:6000,heightPx:4000,ppi:300,targetWidthCm:50.8});
close(print.widthCm,50.8);close(print.heightCm,33.86666666666667);close(print.effectivePpi,300);assert.equal(print.megapixels,24);
close(print.widthInches,20);close(print.heightInches,4000/300);
close(printDimensions({widthPx:4000,heightPx:6000,ppi:200,targetWidthCm:25.4}).targetHeightCm,38.1);
assert.throws(()=>printDimensions({widthPx:6000.5,heightPx:4000,ppi:300,targetWidthCm:50}));
assert.throws(()=>printDimensions({widthPx:6000,heightPx:4000,ppi:0,targetWidthCm:50}));

const html=await readFile(new URL('../public/program/calculators/index.html',import.meta.url),'utf8');
for(const id of ['dof','fov','storage','timelapse','print']){
  assert.match(html,new RegExp(`id="${id}"`));assert.match(html,new RegExp(`href="#${id}"`));
  assert.match(html,new RegExp(`data-calculator="${id}"`));assert.match(html,new RegExp(`data-copy="${id}"`));
}
assert.equal((html.match(/data-calculator=/g)||[]).length,5);
assert.match(html,/PPI/);assert.match(html,/DPI/);assert.match(html,/1,000,000,000/);
assert.doesNotMatch(html,/googlesyndication|cdn\.jsdelivr|unpkg\.com/);
console.log('Photo calculator tests passed: thin-lens DOF/infinity, crop/FOV, decimal storage, interval timing, print units and five accessible tool routes.');
