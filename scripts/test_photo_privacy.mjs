import assert from 'node:assert/strict';
import {LIMITS,validateFiles,outputDimensions,hasPrivateMetadata,cleanPhoto,outputName} from '../public/assets/js/photo-privacy/engine.js';

const bytes=(...parts)=>Buffer.concat(parts.map(part=>Buffer.isBuffer(part)?part:Buffer.from(part)));
const u32be=value=>{const b=Buffer.alloc(4);b.writeUInt32BE(value);return b;};
const u32le=value=>{const b=Buffer.alloc(4);b.writeUInt32LE(value);return b;};
const jpegSegment=(marker,payload=Buffer.alloc(0))=>{const size=Buffer.alloc(2);size.writeUInt16BE(payload.length+2);return bytes([255,marker],size,payload);};
const pixelText=Buffer.from('pixels contain Exif\0\0 XMP IPTC eXIf tEXt EXIF');
const jpeg=(segments=[],pixels=pixelText)=>bytes([255,216],...segments,[255,218,0,2],pixels,[255,217]);
const pngChunk=(name,payload=Buffer.alloc(0))=>bytes(u32be(payload.length),Buffer.from(name),payload,[0,0,0,0]);
const png=chunks=>bytes([137,80,78,71,13,10,26,10],...chunks,pngChunk('IEND'));
const webpChunk=(name,payload=Buffer.alloc(0))=>bytes(Buffer.from(name),u32le(payload.length),payload,...(payload.length%2?[[0]]:[]));
const webp=chunks=>{const data=bytes(Buffer.from('WEBP'),...chunks);return bytes(Buffer.from('RIFF'),u32le(data.length),data);};
const cleanJpeg=jpeg([jpegSegment(224,Buffer.from('JFIF'))]);
const cleanPng=png([pngChunk('IHDR',Buffer.alloc(13)),pngChunk('IDAT',pixelText)]);
const cleanWebp=webp([webpChunk('VP8 ',pixelText)]);

for(const marker of [225,237,254]){
  assert.equal(hasPrivateMetadata(jpeg([jpegSegment(marker,Buffer.from('private'))]),'image/jpeg'),true,`JPEG APP1/APP13/comment ${marker} rejected`);
}
assert.equal(hasPrivateMetadata(cleanJpeg,'image/jpeg'),false,'EXIF-like text in scan data is not a metadata header');
const scanStart=Buffer.from([255,218,0,2]);
const scanPixels=bytes(Buffer.from('scan'),[255,0,225,255,208],Buffer.from('pixels'));
const betweenScans=bytes([255,216],scanStart,scanPixels,jpegSegment(225,Buffer.from('Exif GPS between scans')),scanStart,pixelText,[255,217]);
assert.equal(hasPrivateMetadata(betweenScans,'image/jpeg'),true,'private APP metadata between progressive JPEG scans is still rejected');
const multipleCleanScans=bytes([255,216],scanStart,scanPixels,jpegSegment(196),scanStart,pixelText,[255,217]);
assert.equal(hasPrivateMetadata(multipleCleanScans,'image/jpeg'),false,'stuffed FF00 and restart markers inside multiple scans are image data');
assert.throws(()=>hasPrivateMetadata(bytes([255,216,255,218]),'image/jpeg'),/JPEG/,'a short SOS header fails closed');
assert.equal(hasPrivateMetadata(jpeg([jpegSegment(224,bytes([255,225],pixelText)),jpegSegment(226,Buffer.from('ICC_PROFILE'))]),'image/jpeg'),false,'APP payload/ICC color header are not interpreted as private segments');
assert.equal(hasPrivateMetadata(bytes([255,216,255,255],jpegSegment(224).subarray(1),[255,218,0,2,1,255,217]),'image/jpeg'),false,'legal marker fill bytes are skipped');
for(const malformed of [Buffer.alloc(0),Buffer.from([255,216,0,0]),bytes([255,216,255,224,0,1,255,217]),bytes([255,216,255,224,255,255,255,217]),bytes([255,216,255,224,0,8,255,217])]){
  assert.throws(()=>hasPrivateMetadata(malformed,'image/jpeg'),/JPEG/,'truncated/invalid JPEG must fail closed');
}

assert.equal(hasPrivateMetadata(cleanPng,'image/png'),false,'text matching metadata markers inside IDAT is pixel data');
for(const marker of ['eXIf','tEXt','iTXt','zTXt'])assert.equal(hasPrivateMetadata(png([pngChunk('IHDR',Buffer.alloc(13)),pngChunk(marker,Buffer.from('private'))]),'image/png'),true,`PNG ${marker}`);
assert.equal(hasPrivateMetadata(png([pngChunk('iCCP',Buffer.from('color'))]),'image/png'),false,'color profile is not private text');
assert.throws(()=>hasPrivateMetadata(Buffer.from('not png'),'image/png'),/PNG/);
assert.throws(()=>hasPrivateMetadata(bytes([137,80,78,71,13,10,26,10],u32be(999),Buffer.from('IDAT'),[0,0,0,0]),'image/png'),/PNG/);
assert.throws(()=>hasPrivateMetadata(bytes([137,80,78,71,13,10,26,10],pngChunk('IDAT')),'image/png'),/PNG/,'missing terminal chunk fails closed');

assert.equal(hasPrivateMetadata(cleanWebp,'image/webp'),false,'EXIF-like text inside the image chunk is not a metadata chunk');
for(const marker of ['EXIF','XMP '])assert.equal(hasPrivateMetadata(webp([webpChunk('VP8 ',Buffer.alloc(2)),webpChunk(marker,Buffer.from('private'))]),'image/webp'),true,`WebP ${marker}`);
assert.equal(hasPrivateMetadata(webp([webpChunk('ICCP',Buffer.from('color'))]),'image/webp'),false);
assert.throws(()=>hasPrivateMetadata(Buffer.from('not webp'),'image/webp'),/WebP/);
const wrongRiff=Buffer.from(cleanWebp);wrongRiff.writeUInt32LE(1,4);assert.throws(()=>hasPrivateMetadata(wrongRiff,'image/webp'),/WebP/);
assert.throws(()=>hasPrivateMetadata(webp([bytes(Buffer.from('VP8 '),u32le(100),[0,0])]),'image/webp'),/WebP/);
assert.throws(()=>hasPrivateMetadata(webp([bytes(Buffer.from('VP8 '),u32le(1),[0])]),'image/webp'),/WebP/,'odd chunks require a padding byte');
assert.throws(()=>hasPrivateMetadata(cleanJpeg,'application/octet-stream'));

const photo=(size=2000,type='image/jpeg')=>({size,type,name:'private-gps-original.jpg'});
assert.equal(validateFiles([photo()]).length,1);
assert.equal(validateFiles([photo(LIMITS.fileBytes)]).length,1);
assert.equal(validateFiles(Array.from({length:4},()=>photo(LIMITS.fileBytes))).length,4,'exact batch ceiling is accepted');
assert.throws(()=>validateFiles([]));assert.throws(()=>validateFiles(Array.from({length:11},()=>photo())));
for(const size of [0,-1,NaN,Infinity,LIMITS.fileBytes+1])assert.throws(()=>validateFiles([photo(size)]));
for(const type of ['image/heic','image/x-canon-cr3','application/octet-stream',''])assert.throws(()=>validateFiles([photo(100,type)]));
assert.throws(()=>validateFiles(Array.from({length:5},()=>photo(LIMITS.fileBytes))),'batch mass limit applies even when each file is permitted');
assert.deepEqual(outputDimensions(6000,4000,2400),{width:2400,height:1600});
assert.deepEqual(outputDimensions(3000,6000,1920),{width:960,height:1920});
assert.deepEqual(outputDimensions(800,600,4000),{width:800,height:600},'never upscale');
assert.deepEqual(outputDimensions(10000,10000,0),{width:10000,height:10000});
assert.deepEqual(outputDimensions(1000000,1,1920),{width:1920,height:1},'thin images retain at least one pixel');
for(const dimensions of [[0,1],[-1,200],[100.5,100],[NaN,100],[10001,10000]])assert.throws(()=>outputDimensions(...dimensions));
assert.throws(()=>outputDimensions(100,100,2000));

function platformFixture({fallback=false,format='image/jpeg',encoded,blobNull=false,contextMissing=false,decodeError=false}={}){
  const calls=[],image={width:4000,height:3000,close(){calls.push(['close']);}};
  const canvas={width:0,height:0,getContext(kind){calls.push(['context',kind]);return contextMissing?null:context;},toBlob(done,type,quality){calls.push(['encode',type,quality]);done(blobNull?null:new Blob([encoded||(format==='image/png'?cleanPng:format==='image/webp'?cleanWebp:cleanJpeg)],{type:format}));}};
  const context={set fillStyle(value){calls.push(['fillStyle',value]);},fillRect(...args){calls.push(['fill',...args]);},drawImage(...args){calls.push(['draw',...args]);}};
  const platform={
    document:{createElement(tag){assert.equal(tag,'canvas');calls.push(['canvas']);return canvas;}},
    URL:{createObjectURL(file){calls.push(['objectURL',file]);return 'blob:local-source';},revokeObjectURL(url){calls.push(['revoke',url]);}},
    Image:class {constructor(){this.naturalWidth=4000;this.naturalHeight=3000;calls.push(['image']);}async decode(){calls.push(['decode',this.src]);if(decodeError)throw Error('decode failed');}},
  };
  if(!fallback)platform.createImageBitmap=async(file,options)=>{calls.push(['bitmap',file,options]);if(decodeError)throw Error('decode failed');return image;};
  return {platform,calls,canvas,image};
}
const raw=photo();raw.arrayBuffer=async()=>{throw Error('raw metadata bytes should never be copied');};
let fixture=platformFixture();
let result=await cleanPhoto(raw,{type:'image/jpeg',quality:.95,edge:1920},fixture.platform);
assert.deepEqual({width:result.width,height:result.height},{width:1920,height:1440});
assert.deepEqual(fixture.calls.find(row=>row[0]==='bitmap'),['bitmap',raw,{imageOrientation:'from-image'}]);
assert.deepEqual(fixture.calls.find(row=>row[0]==='fillStyle'),['fillStyle','#fff']);
assert.deepEqual(fixture.calls.find(row=>row[0]==='fill'),['fill',0,0,1920,1440]);
assert.deepEqual(fixture.calls.find(row=>row[0]==='draw'),['draw',fixture.image,0,0,1920,1440]);
assert.ok(fixture.calls.findIndex(row=>row[0]==='fill')<fixture.calls.findIndex(row=>row[0]==='draw'),'flatten transparency onto white before drawing JPEG');
assert.deepEqual(fixture.calls.find(row=>row[0]==='encode'),['encode','image/jpeg',.95]);
assert.deepEqual(Buffer.from(await result.blob.arrayBuffer()),cleanJpeg,'returned output is encoder result, not original bytes');
assert.equal(fixture.canvas.width,1);assert.equal(fixture.canvas.height,1);assert.equal(fixture.calls.filter(row=>row[0]==='close').length,1);
assert.equal(fixture.calls.filter(row=>row[0]==='objectURL').length,0,'bitmap path needs no source object URL');

fixture=platformFixture({fallback:true,format:'image/png'});
result=await cleanPhoto(raw,{type:'image/png'},fixture.platform);
assert.deepEqual(fixture.calls.find(row=>row[0]==='decode'),['decode','blob:local-source']);
assert.deepEqual(fixture.calls.find(row=>row[0]==='revoke'),['revoke','blob:local-source']);
assert.equal(fixture.calls.some(row=>row[0]==='fill'),false,'PNG keeps alpha rather than painting white');
assert.equal(result.blob.type,'image/png');assert.equal(fixture.canvas.width,1);

for(const [options,settings,message] of [
  [{format:'image/png'},{type:'image/webp'},/지원하지/],
  [{blobNull:true},{type:'image/jpeg'},/내보내지/],
  [{encoded:jpeg([jpegSegment(225,Buffer.from('GPS'))])},{type:'image/jpeg'},/메타데이터/],
  [{encoded:Buffer.from('invalid encoder bytes')},{type:'image/jpeg'},/JPEG/],
  [{contextMissing:true},{type:'image/jpeg'},/작업 공간/],
]){
  fixture=platformFixture(options);await assert.rejects(()=>cleanPhoto(raw,settings,fixture.platform),message);
  assert.equal(fixture.calls.filter(row=>row[0]==='close').length,1,'bitmap closes even when exporting/verification fails');assert.equal(fixture.canvas.width,1);assert.equal(fixture.canvas.height,1);
}
fixture=platformFixture({fallback:true,decodeError:true});
await assert.rejects(()=>cleanPhoto(raw,{},fixture.platform),/decode failed/);
assert.deepEqual(fixture.calls.find(row=>row[0]==='revoke'),['revoke','blob:local-source'],'fallback source URL revokes on failed decode');
assert.equal(fixture.calls.some(row=>row[0]==='canvas'),false);
fixture=platformFixture({decodeError:true});await assert.rejects(()=>cleanPhoto(raw,{},fixture.platform),/decode failed/);assert.equal(fixture.calls.some(row=>row[0]==='canvas'),false);
fixture=platformFixture();await assert.rejects(()=>cleanPhoto(raw,{quality:.7},fixture.platform));assert.equal(fixture.calls.length,0,'invalid settings fail before decoding');
assert.equal(outputName(0,'image/jpeg'),'matchcamera-clean-001.jpg');
assert.equal(outputName(9,'image/webp'),'matchcamera-clean-010.webp');
assert.equal(outputName(1,'image/png'),'matchcamera-clean-002.png');
assert.doesNotMatch(outputName(0,'image/jpeg'),/private|original|gps/i,'generated filename contains no original filename');
console.log('Photo privacy tests passed: container metadata headers vs pixel data, malformed bounds, mass/pixel limits, redraw/orientation, alpha handling, encoder rejection and resource cleanup.');
