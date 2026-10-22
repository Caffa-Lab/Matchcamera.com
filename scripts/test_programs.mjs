import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import siteWorker from '../worker/index.js';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [hub,resize,resizeJs,previewRenderer,worker,rating,ratingJs,ratingXmp,index,carousel,exposure,sitemap,shutter]=await Promise.all([
  read('public/index.html'),read('public/program/resize/index.html'),read('public/assets/js/resize/app.js'),read('public/assets/js/resize/image-utils.js'),read('public/program/resize/workers/image-worker.js'),read('public/program/rating/index.html'),read('public/assets/js/rating/app.js'),read('public/assets/js/rating/xmp.js'),read('public/data/product-index.json'),
  read('public/program/carousel/index.html'),read('public/program/exposure/index.html'),read('public/sitemap.xml'),
  read('public/program/shutter-count/index.html'),
]);

assert.match(hub,/href="\/program\/metadata\/"/,'메타데이터 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/resize\/"/,'리사이즈 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/rating\/"/,'Rating 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/filename\/"/,'파일명 내보내기 링크를 유지해야 합니다.');
assert.match(hub,/<link rel="canonical" href="https:\/\/matchcamera\.com\/">/,'the root program hub must declare the root URL');
assert.doesNotMatch(hub,/\/assets\/js\/home\.js|googlesyndication\.com/,'the root program hub must retain the existing no-ad tool scope');
assert.match(hub,/name="google-adsense-account" content="ca-pub-6581176496481636"/,'retain existing publisher verification when the homepage changes');
const home = await read('public/home/index.html');
assert.match(home,/class="home-page"/);
assert.match(home,/\/assets\/js\/home\.js/,'camera homepage must keep the banner and featured-product loader');
assert.match(home,/<link rel="canonical" href="https:\/\/matchcamera\.com\/home\/">/);
assert.ok(sitemap.includes('<loc>https://matchcamera.com/home/</loc>'));
assert.ok(!sitemap.includes('<loc>https://matchcamera.com/betatest/</loc>'), 'The noindex beta must stay outside the indexable sitemap');
const routedPaths = [];
const routeEnv = { ASSETS: { async fetch(request) { routedPaths.push(new URL(request.url).pathname); return new Response('asset'); } } };
for (const path of ['/program', '/program/', '/program/index.html']) {
  for (const method of ['GET', 'HEAD']) {
    const response = await siteWorker.fetch(new Request(`https://matchcamera.com${path}?from=bookmark`, {method}), routeEnv);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('Location'), 'https://matchcamera.com/?from=bookmark');
  }
}
for (const path of ['/', '/home/', '/program/resize/', '/program/metadata/', '/program/shutter-count/']) {
  const response = await siteWorker.fetch(new Request(`https://matchcamera.com${path}`), routeEnv);
  assert.equal(response.status, 200, `${path} must remain an independent asset route`);
  assert.equal(routedPaths.at(-1), path);
}
// Navigation and homepage measurements follow the page's new role, including
// explicit index.html URLs opened in a static preview.
const common = (await read('public/assets/js/common.js')).replace(/^import .*;\r?\n/gm, '');
for (const [path, target, surface] of [['/', '/', null], ['/home/', '/home/', 'home'], ['/home/index.html', '/home/', 'home'], ['/program/resize/', '/', 'resize'], ['/betatest/', '/betatest/', null]]) {
  const events = [];
  const context = vm.createContext({location: {pathname:path}, document: {querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}}}, trackUsage: (...args)=>{events.push(args);return Promise.resolve(false);} });
  vm.runInContext(common, context);
  const active = vm.runInContext('nav.filter(item=>item[2]).map(item=>item[0])', context);
  assert.deepEqual([...active], [target], `${path} selects its matching menu entry`);
  assert.deepEqual(events, surface ? [['page_view', surface]] : [], `${path} must not be miscounted as the camera homepage`);
}
for(const [name,html] of [['carousel',carousel],['exposure',exposure],['shutter-count',shutter]]){
  assert.equal((hub.match(new RegExp(`href="/program/${name}/"`,'g'))||[]).length,1,`${name} must have one hub entry`);
  assert.match(sitemap,new RegExp(`<loc>https://matchcamera\\.com/program/${name}/</loc>`),`${name} must be discoverable in the sitemap`);
  assert.match(html,/name="viewport"/,'mobile viewport must be declared');
  assert.match(html,/\/assets\/css\/responsive\.css/,'shared navigation must retain the responsive stylesheet');
  assert.match(html,/\/assets\/js\/common\.js/,'new tools must use shared navigation');
  assert.match(html,new RegExp(`/assets/js/${name}/app\\.js`),'the tool entry module must be linked');
  assert.doesNotMatch(html,/unpkg\.com|cdn\.jsdelivr\.net|googlesyndication\.com/,'tools must retain local dependencies and the existing no-ad tool scope');
}
assert.match(carousel,/\/assets\/vendor\/jszip\.min\.js/,'carousel downloads must use the local ZIP library');
assert.match(resize,/data-file-input/,'다중 파일 입력이 필요합니다.');
assert.match(resize,/data-preview-canvas/,'미리보기 영역이 필요합니다.');
assert.match(resize,/용량 맞추기/,'저장 방식 이름은 용량 맞추기여야 합니다.');
assert.match(resize,/data-target-size-field/,'목표 용량 영역의 비활성 상태 표시가 필요합니다.');
assert.match(resize,/\/assets\/vendor\/jszip\.min\.js/,'로컬 ZIP 라이브러리가 필요합니다.');
assert.doesNotMatch(resize,/unpkg\.com|cdn\.jsdelivr\.net/,'프로그램은 외부 CDN에 의존하지 않아야 합니다.');
assert.match(resizeJs,/loadWatermarkEquipment/,'워터마크 전용 장비 목록을 사용해야 합니다.');
assert.match(resizeJs,/parseExif/,'EXIF 판독 기능이 필요합니다.');
assert.match(resizeJs,/JSZip/,'일괄 ZIP 저장 기능이 필요합니다.');
assert.match(resizeJs,/cropEnabled/,'비율 자르기 기능이 필요합니다.');
assert.match(resizeJs,/borderEnabled/,'테두리 기능이 필요합니다.');
assert.match(resizeJs,/watermarkEnabled/,'워터마크 기능이 필요합니다.');
assert.match(resizeJs,/applyMetadataPolicy/,'메타데이터 정책 기능이 필요합니다.');
assert.match(resizeJs,/targetSizeField\?\.classList\.toggle\('is-disabled'/,'최대화질에서 목표 용량 영역을 회색 처리해야 합니다.');
assert.match(worker,/appendEquipmentPanel/,'장비 사진 합성 기능이 필요합니다.');
assert.match(previewRenderer,/import \{ calculateLayout \} from '\.\/layout\.js/,'미리보기는 공통 레이아웃을 사용해야 합니다.');
assert.match(worker,/import \{ calculateLayout \} from .*layout\.js/,'저장도 같은 레이아웃을 사용해야 합니다.');
assert.match(resizeJs,/new Worker\([^;]+type:\s*['"]module['"]/,'공통 레이아웃을 불러오는 모듈 Worker가 필요합니다.');
assert.doesNotMatch(worker,/Math\.min\(620/,'고해상도 장비 패널에 고정 상한을 두면 안 됩니다.');
assert.doesNotMatch(resizeJs,/addEventListener\(event\s*=>/,'이벤트 이름이 빠진 등록 코드는 허용되지 않습니다.');
assert.match(rating,/data-label-language/,'Lightroom 레이블 언어 선택이 필요합니다.');
assert.match(rating,/data-label-custom/,'사용자 지정 레이블 입력이 필요합니다.');
assert.match(ratingJs,/빨강/,'한국어 Lightroom 레이블 매핑이 필요합니다.');
assert.match(ratingJs,/Red/,'영어 Lightroom 레이블 매핑이 필요합니다.');
assert.match(ratingXmp,/xmp:Label/,'XMP 색상 레이블 기록 기능이 필요합니다.');
const products=JSON.parse(index);
assert.ok(products.length>500,'경량 제품 인덱스가 비어 있습니다.');
assert.ok(products.some(item=>item.type==='바디'),'바디 데이터가 필요합니다.');
assert.ok(products.some(item=>item.type==='렌즈'),'렌즈 데이터가 필요합니다.');
console.log(`program tests passed (${products.length} indexed products)`);
