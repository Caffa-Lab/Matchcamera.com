# Matchcamera.com

카메라 바디와 렌즈를 PC 견적처럼 조합하고 호환성을 판정하는 정적 웹 프로젝트입니다.

## 현재 데이터

- 총 제품: **843**
- 바디: **261**
- 렌즈: **582**
- 기준일: **2026-08-28**

| 제조사 | 바디 | 렌즈 |
|---|---:|---:|
| Canon | 32 | 57 |
| Fujifilm | 44 | 70 |
| Leica | 9 | 25 |
| Nikon | 26 | 62 |
| OM SYSTEM | 6 | 9 |
| Olympus | 30 | 34 |
| Panasonic | 51 | 66 |
| Pentax | 5 | 8 |
| Sigma | 5 | 122 |
| Sony | 53 | 83 |
| Tamron | 0 | 46 |

## 핵심 기능

- `/builder/`: 바디 → 같은 마운트 렌즈 선택 → 이미지서클/센서 포맷 호환성 판정
- `/database/`: 제조사·마운트·제품 종류·센서 포맷·렌즈 포맷·판매 상태 필터
- `/compare/`: 제품 1:1 비교
- `public/data/products.json`: 사이트 런타임 제품 DB
- `data-source/Matchcamera_Camera_Lens_Master_Database_2026-08-28.xlsx`: 원본 마스터 Excel

## 호환성 데이터 모델

`mount`는 물리적 마운트입니다. `lensFormat`은 제조사 고유 렌즈 포맷/이미지서클 표기이며, 호환성 판단은 `compatibleSensorFormat`과 바디 `sensorFormat`, `cropFactor`를 함께 사용합니다.

예: Sony E 바디에서 E/FE/DG/DC/Di III 렌즈를 같은 물리적 마운트 후보로 묶은 뒤, Full Frame ↔ APS-C 이미지서클을 다시 판단합니다. Canon RF/RF-S, Nikon FX/DX, L-Mount SL/TL/DG/DC도 같은 방식입니다.

## GitHub → Cloudflare Workers 배포

1. 이 폴더를 GitHub 저장소에 push합니다.
2. Cloudflare Workers & Pages에서 **Import a repository**로 저장소를 연결합니다.
3. 설정 파일 `wrangler.jsonc`의 정적 assets 디렉터리는 `./public`입니다.
4. 첫 배포 후 Custom Domain에 `matchcamera.com`을 연결합니다.

로컬 확인은 정적 서버를 사용하면 됩니다. 예: VS Code Live Server 또는 `python -m http.server 5500 -d public`.

## 데이터 관리 주의

미확인 세부 사양은 추정하지 않고 비워 두거나 `확인 필요`로 표시합니다. Pentax K-01과 Sigma sd Quattro는 기존 SLR 계열 마운트를 재사용하므로 K/SA 전체 레거시 렌즈군은 별도 확장 대상으로 표시되어 있습니다.
