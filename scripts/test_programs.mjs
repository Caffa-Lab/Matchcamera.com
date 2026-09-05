import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const [hub,resize,resizeJs,previewRenderer,worker,rating,ratingJs,ratingXmp,index]=await Promise.all([
  read('public/program/index.html'),read('public/program/resize/index.html'),read('public/assets/js/resize/app.js'),read('public/assets/js/resize/image-utils.js'),read('public/program/resize/workers/image-worker.js'),read('public/program/rating/index.html'),read('public/assets/js/rating/app.js'),read('public/assets/js/rating/xmp.js'),read('public/data/product-index.json'),
]);

assert.match(hub,/href="\/program\/metadata\/"/,'메타데이터 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/resize\/"/,'리사이즈 도구 링크가 필요합니다.');
assert.match(hub,/href="\/program\/rating\/"/,'Rating 도구 링크가 필요합니다.');
assert.match(resize,/data-file-input/,'다중 파일 입력이 필요합니다.');
assert.match(resize,/data-preview-canvas/,'미리보기 영역이 필요합니다.');
assert.match(resize,/용량 맞추기/,'저장 방식 이름은 용량 맞추기여야 합니다.');
assert.match(resize,/data-target-size-field/,'목표 용량 영역의 비활성 상태 표시가 필요합니다.');
assert.match(resize,/\/assets\/vendor\/jszip\.min\.js/,'로컬 ZIP 라이브러리가 필요합니다.');
assert.doesNotMatch(resize,/unpkg\.com|cdn\.jsdelivr\.net/,'프로그램은 외부 CDN에 의존하지 않아야 합니다.');
assert.match(resizeJs,/loadProductIndex/,'경량 제품 인덱스를 사용해야 합니다.');
assert.match(resizeJs,/parseExif/,'EXIF 판독 기능이 필요합니다.');
assert.match(resizeJs,/JSZip/,'일괄 ZIP 저장 기능이 필요합니다.');
assert.match(resizeJs,/cropEnabled/,'비율 자르기 기능이 필요합니다.');
assert.match(resizeJs,/borderEnabled/,'테두리 기능이 필요합니다.');
assert.match(resizeJs,/watermarkEnabled/,'워터마크 기능이 필요합니다.');
assert.match(resizeJs,/applyMetadataPolicy/,'메타데이터 정책 기능이 필요합니다.');
assert.match(resizeJs,/targetSizeField\?\.classList\.toggle\('is-disabled'/,'최대화질에서 목표 용량 영역을 회색 처리해야 합니다.');
assert.match(worker,/appendEquipmentPanel/,'장비 사진 합성 기능이 필요합니다.');
assert.match(previewRenderer,/Math\.round\(displayWidth \* EQUIPMENT_PANEL_RATIO\)/,'미리보기 장비 패널은 폭 기준 비율을 사용해야 합니다.');
assert.match(worker,/Math\.round\(width \* \.18\)/,'다운로드 장비 패널은 미리보기와 같은 폭 기준 비율을 사용해야 합니다.');
assert.doesNotMatch(worker,/Math\.min\(620/,'고해상도 장비 패널에 고정 상한을 두면 안 됩니다.');
assert.match(previewRenderer,/borderPlacement\.y \+ borderPlacement\.height/,'장비 패널 사용 시 하단 테두리를 제외해야 합니다.');
assert.match(worker,/placement\.y \+ placement\.height/,'다운로드에서도 장비 패널 위 하단 테두리를 제외해야 합니다.');
assert.match(worker,/else if \(options\.borderEnabled\)/,'비율을 선택하지 않아도 다운로드에 테두리를 적용해야 합니다.');
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
