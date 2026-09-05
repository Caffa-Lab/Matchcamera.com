import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [hub,resize,resizeJs,worker,index]=await Promise.all([
  read('public/program/index.html'),read('public/program/resize/index.html'),read('public/assets/js/resize/app.js'),read('public/program/resize/workers/image-worker.js'),read('public/data/product-index.json'),
]);

assert.match(hub,/href="\/program\/metadata\/"/,'메타데이터 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/resize\/"/,'리사이즈 도구 링크가 필요합니다.');
assert.match(resize,/data-file-input/,'다중 파일 입력이 필요합니다.');
assert.match(resize,/data-preview-canvas/,'미리보기 영역이 필요합니다.');
assert.match(resize,/\/assets\/vendor\/jszip\.min\.js/,'로컬 ZIP 라이브러리가 필요합니다.');
assert.doesNotMatch(resize,/unpkg\.com|cdn\.jsdelivr\.net/,'프로그램은 외부 CDN에 의존하지 않아야 합니다.');
assert.match(resizeJs,/loadProductIndex/,'경량 제품 인덱스를 사용해야 합니다.');
assert.match(resizeJs,/parseExif/,'EXIF 판독 기능이 필요합니다.');
assert.match(resizeJs,/JSZip/,'일괄 ZIP 저장 기능이 필요합니다.');
assert.match(resizeJs,/cropEnabled/,'비율 자르기 기능이 필요합니다.');
assert.match(resizeJs,/borderEnabled/,'테두리 기능이 필요합니다.');
assert.match(resizeJs,/watermarkEnabled/,'워터마크 기능이 필요합니다.');
assert.match(resizeJs,/applyMetadataPolicy/,'메타데이터 정책 기능이 필요합니다.');
assert.match(worker,/appendEquipmentPanel/,'장비 사진 합성 기능이 필요합니다.');
assert.doesNotMatch(resizeJs,/addEventListener\(event\s*=>/,'이벤트 이름이 빠진 등록 코드는 허용되지 않습니다.');
const products=JSON.parse(index);
assert.ok(products.length>500,'경량 제품 인덱스가 비어 있습니다.');
assert.ok(products.some(item=>item.type==='바디'),'바디 데이터가 필요합니다.');
assert.ok(products.some(item=>item.type==='렌즈'),'렌즈 데이터가 필요합니다.');
console.log(`program tests passed (${products.length} indexed products)`);
