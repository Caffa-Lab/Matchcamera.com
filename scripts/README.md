# Data build

`public/data/products.json` is generated from the master workbook in `data-source/`.

The current repository already contains the generated JSON. When the master spreadsheet is changed, regenerate the JSON with the same field mapping used by Matchcamera (`manufacturer`, `mount`, `sensorFormat`, `cropFactor`, `lensFormat`, `compatibleSensorFormat`, etc.).

## Product image maintenance

- `node scripts/migrate_product_image_ids.mjs`: 제품명 키를 제품 ID 키로 안전하게 이전하고 미연결 파일 보고서를 만듭니다.
- `python scripts/update_sony_official_highres.py`: Sony Korea 공식 제품 페이지에서 원본이 500px 이상인 현재 판매 제품컷만 받아 900×900 투명 WEBP로 정규화합니다. 작은 썸네일은 확대하지 않습니다.
- 자동 배경 제거 전에는 별도 원본 백업 ZIP을 먼저 만드세요. 자동 처리 결과는 `public/data/image-processing-report.json`에서 확인합니다.
