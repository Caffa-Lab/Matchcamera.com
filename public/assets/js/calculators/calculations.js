export const SENSOR_FORMATS = Object.freeze({
  full: {label:'풀프레임 · 36 × 24mm',width:36,height:24,coc:0.03},
  aps: {label:'APS-C · 23.5 × 15.6mm',width:23.5,height:15.6,coc:0.02},
  canon: {label:'Canon APS-C · 22.3 × 14.9mm',width:22.3,height:14.9,coc:0.019},
  mft: {label:'마이크로 포서드 · 17.3 × 13mm',width:17.3,height:13,coc:0.015},
  gfx: {label:'중형 · 43.8 × 32.9mm',width:43.8,height:32.9,coc:0.04},
  inch: {label:'1형 · 13.2 × 8.8mm',width:13.2,height:8.8,coc:0.011},
});

function range(value,min,max,label) {
  if(typeof value !== 'number'||!Number.isFinite(value)||value<min||value>max) throw new RangeError(`${label}: ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 범위의 숫자를 입력해 주세요.`);
  return value;
}
function integer(value,min,max,label) {range(value,min,max,label);if(!Number.isInteger(value))throw new RangeError(`${label} 값은 정수로 입력해 주세요.`);return value;}

// Thin-lens distances, in mm. h0=f²/(N*c); hyperfocal=h0+f.
// Distances refer to the lens's principal plane; not a manufacturer's focus scale.
export function depthOfField({focalMm,aperture,cocMm,focusM,infinity=false}) {
  range(focalMm,1,2000,'실제 초점거리(mm)');range(aperture,0.5,128,'조리개');range(cocMm,0.001,0.1,'허용 착란원(mm)');
  const h0=focalMm*focalMm/(aperture*cocMm),hyperfocalM=(h0+focalMm)/1000;
  if(infinity) return {hyperfocalM,nearM:h0/1000,farM:Infinity,totalM:Infinity};
  range(focusM,0.01,1000000,'초점 거리(m)');
  const s=focusM*1000;
  if(s<=focalMm)throw new RangeError('초점을 맞춘 거리(m)는 렌즈 초점거리(mm)를 m로 환산한 값보다 커야 합니다.');
  const nearM=(s*h0/(h0+s-focalMm))/1000;
  const farM=s>=h0+focalMm?Infinity:(s*h0/(h0-s+focalMm))/1000;
  return {hyperfocalM,nearM,farM,totalM:farM-nearM};
}

export function fieldOfView({focalMm,sensorWidthMm,sensorHeightMm,distanceM}) {
  range(focalMm,1,2000,'실제 초점거리(mm)');range(sensorWidthMm,1,100,'센서 가로(mm)');range(sensorHeightMm,1,100,'센서 세로(mm)');range(distanceM,0.01,1000000,'피사체까지 거리(m)');
  const crop=Math.hypot(36,24)/Math.hypot(sensorWidthMm,sensorHeightMm);
  const horizontalDegrees=2*Math.atan(sensorWidthMm/(2*focalMm))*180/Math.PI;
  return {crop,equivalentMm:focalMm*crop,horizontalDegrees,verticalDegrees:2*Math.atan(sensorHeightMm/(2*focalMm))*180/Math.PI,sceneWidthM:distanceM*sensorWidthMm/focalMm};
}

export function storageEstimate({capacityGB,fileMB,bitrateMbps,usablePercent}) {
  range(capacityGB,0.1,100000,'카드 용량(GB)');range(fileMB,0.01,100000,'사진 한 장(MB)');range(bitrateMbps,0.01,100000,'동영상 비트레이트(Mb/s)');range(usablePercent,0.1,100,'사용 가능 비율(%)');
  const usableGB=capacityGB*usablePercent/100;
  return {usableGB,photos:Math.floor(usableGB*1000/fileMB),videoSeconds:usableGB*8000/bitrateMbps};
}

export function timelapsePlan({movieSeconds,fps,intervalSeconds,shutterSeconds}) {
  range(movieSeconds,0.1,86400,'완성 영상 길이(초)');range(fps,1,240,'영상 프레임레이트(fps)');range(intervalSeconds,0.01,86400,'촬영 간격(초)');range(shutterSeconds,0.000001,86400,'노출 시간(초)');
  if(shutterSeconds>intervalSeconds)throw new RangeError('노출 시간은 촬영 시작 간격보다 길 수 없습니다. 간격을 늘리거나 노출 시간을 줄여 주세요.');
  // Subtract a tiny floating-point tolerance before rounding whole photos up.
  const frames=Math.ceil(movieSeconds*fps-1e-9);
  const shootingSeconds=(frames-1)*intervalSeconds+shutterSeconds;
  return {frames,movieSeconds:frames/fps,shootingSeconds,startSpanSeconds:(frames-1)*intervalSeconds,spareSeconds:intervalSeconds-shutterSeconds};
}

export function printDimensions({widthPx,heightPx,ppi,targetWidthCm}) {
  integer(widthPx,1,100000,'가로 픽셀');integer(heightPx,1,100000,'세로 픽셀');range(ppi,1,2400,'사진 해상도(PPI)');range(targetWidthCm,0.1,10000,'희망 출력 가로(cm)');
  return {widthCm:widthPx/ppi*2.54,heightCm:heightPx/ppi*2.54,widthInches:widthPx/ppi,heightInches:heightPx/ppi,targetHeightCm:targetWidthCm*heightPx/widthPx,effectivePpi:widthPx/(targetWidthCm/2.54),megapixels:widthPx*heightPx/1000000};
}
