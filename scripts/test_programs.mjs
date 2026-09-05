import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [hub,resize,resizeJs,index]=await Promise.all([
  read('public/program/index.html'),read('public/program/resize/index.html'),read('public/assets/js/resize.js'),read('public/data/product-index.json'),
]);

assert.match(hub,/href="\/program\/metadata\/"/,'메타데이터 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/resize\/"/,'리사이즈 도구 링크가 필요합니다.');
assert.match(resize,/id="resizeFiles"[^>]+multiple/,'다중 파일 입력이 필요합니다.');
assert.match(resize,/id="resizePreview"/,'미리보기 영역이 필요합니다.');
assert.match(resizeJs,/loadProductIndex/,'경량 제품 인덱스를 사용해야 합니다.');
assert.match(resizeJs,/exifr\.parse/,'EXIF 판독 기능이 필요합니다.');
assert.match(resizeJs,/JSZip/,'일괄 ZIP 저장 기능이 필요합니다.');
const products=JSON.parse(index);
assert.ok(products.length>500,'경량 제품 인덱스가 비어 있습니다.');
assert.ok(products.some(item=>item.type==='바디'),'바디 데이터가 필요합니다.');
assert.ok(products.some(item=>item.type==='렌즈'),'렌즈 데이터가 필요합니다.');
console.log(`program tests passed (${products.length} indexed products)`);
