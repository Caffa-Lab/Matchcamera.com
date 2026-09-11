const SENSOR_CLASS={'Full Frame':3,'APS-H':2.4,'APS-C':2,'Super 35':2,'Micro Four Thirds':1.5,'CX':1.1,'1/1.7-inch':.8,'1/2.3-inch':.7,'Medium Format 44×33':4,'Q system':.7};
function cropFactor(body){const v=Number(body?.cropFactor);if(Number.isFinite(v)&&v>0)return v;if(body?.sensorFormat==='Full Frame')return 1;if(body?.sensorFormat==='APS-C')return body?.mount?.startsWith('Canon')?1.6:1.5;if(body?.sensorFormat==='Super 35')return 1.5;if(body?.sensorFormat==='Micro Four Thirds')return 2;if(body?.sensorFormat==='CX')return 2.7;if(body?.sensorFormat==='Medium Format 44×33')return .79;return null;}
function effectiveFocal(body,lens){const c=cropFactor(body),a=Number(lens?.focalMinMm),b=Number(lens?.focalMaxMm);if(!c||!Number.isFinite(a)||!Number.isFinite(b)||a<=0||b<=0)return'';const x=Math.round(a*c*10)/10,y=Math.round(b*c*10)/10;return x===y?`${x}mm`:`${x}-${y}mm`;}
function adapterFromMatches(adapterMount,lensMount){if(adapterMount===lensMount)return true;if(adapterMount==='Canon EF'&&lensMount==='Canon EF-S')return true;return false;}
export function findMountAdapters(body,lens,adapters=[]){if(!body||!lens)return[];return adapters.filter(a=>a.active!==false&&a.enabled!==false&&a.visibility!=='hidden'&&adapterFromMatches(a.fromMount,lens.mount)&&a.toMount===body.mount);}
export function checkCompatibility(body,lens,adapters=[]){
  if(!body||!lens)return{level:'unknown',label:'선택 필요',reason:'바디와 렌즈를 선택하세요.'};
  if(body.type!=='바디'||lens.type!=='렌즈')return{level:'incompatible',label:'조합 오류',reason:'바디와 렌즈 조합이 아닙니다.'};
  if(body.cameraSystem==='일체형 카메라')return{level:'incompatible',label:'렌즈 고정형',reason:'일체형 카메라는 교환 렌즈를 장착하지 않습니다.'};
  if(!String(body.mount||'').trim()||!String(lens.mount||'').trim())return{level:'unknown',label:'확인 필요',reason:'바디 또는 렌즈의 마운트 정보가 없어 장착 여부를 판단할 수 없습니다.'};
  const canonApsCBody = body.mount==='Canon EF/EF-S';
  const canonDirect = canonApsCBody && (lens.mount==='Canon EF'||lens.mount==='Canon EF-S');
  if(body.mount!==lens.mount && !canonDirect){
    const found=findMountAdapters(body,lens,adapters);
    if(found.length){const a=found[0];return{level:'conditional',label:'어댑터 호환',reason:`직접 장착은 불가능하지만 ${a.officialName} 사용 시 ${lens.mount} → ${body.mount} 변환 규격입니다. AF: ${a.afSupport||'미확인'} · 조리개 제어: ${a.apertureControl||'미확인'}. 정확한 렌즈 모델과 펌웨어의 지원 여부를 제조사 호환표에서 확인하세요.`,adapter:a,adapters:found};}
    return{level:'incompatible',label:'호환 불가',reason:`물리적 마운트가 다릅니다: ${body.mount} ↔ ${lens.mount}`};
  }
  const bs=body.sensorFormat,ls=lens.compatibleSensorFormat;const eq=effectiveFocal(body,lens);
  if(!bs||!ls||!Number.isFinite(SENSOR_CLASS[bs])||!Number.isFinite(SENSOR_CLASS[ls]))return{level:'unknown',label:'포맷 확인 필요',reason:`${body.mount} 마운트는 일치하지만 센서·렌즈 대응 포맷 정보가 부족합니다. 이미지서클과 AF 지원은 별도로 확인해야 합니다.`};
  const bClass=SENSOR_CLASS[bs],lClass=SENSOR_CLASS[ls];
  if(Number.isFinite(bClass)&&Number.isFinite(lClass)&&bClass>lClass)return{level:'conditional',label:'조건부 호환',reason:`장착은 가능하지만 렌즈 대응 포맷(${ls})이 바디 센서(${bs})보다 작습니다. 크롭 모드 또는 이미지서클 제한을 확인하세요.${eq?` 환산 화각 약 ${eq}.`:''}`};
  if(bs!==ls&&Number.isFinite(bClass)&&Number.isFinite(lClass)&&bClass<lClass)return{level:'compatible',label:'호환',reason:`더 큰 이미지서클의 ${ls} 렌즈를 ${bs} 바디에서 사용할 수 있습니다.${eq?` 환산 화각 약 ${eq}.`:''}`};
  if(bs!==ls)return{level:'conditional',label:'포맷 범위 확인',reason:`마운트는 일치하지만 바디(${bs})와 렌즈(${ls})의 포맷 표기가 다릅니다. 실제 센서 크기와 렌즈 이미지서클을 확인하세요.`};
  return{level:'compatible',label:'마운트·포맷 일치',reason:`${body.mount} 마운트와 ${bs} 대응 포맷이 일치합니다. AF·전자 기능은 렌즈별 지원 사양을 확인하세요.${eq?` 환산 화각 약 ${eq}.`:''}`};
}
