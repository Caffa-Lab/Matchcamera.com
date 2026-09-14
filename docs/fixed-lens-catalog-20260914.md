# 일체형 카메라 카탈로그 검토 — 2026-09-14

기존 17종을 보완하고 78종을 추가하여 11개 브랜드, 95종을 수록했습니다. 바디 목록·제품 DB·비교·견적에서 같은 제품 데이터를 사용합니다. 추천 예산 기능은 사용자 요청에 따라 보류했습니다.

## 수록 범위

한국 공식 현행 목록과 국내 판매·출시·정품 지원 근거가 확보된 주요 이전 모델을 조사했습니다. 모든 역사 모델의 전수 목록은 아닙니다. 근거가 없는 오래된 Cyber-shot/IXUS 계열이나 개발 발표 단계의 GR IVx는 포함하지 않았습니다. 색상만 다른 모델은 중복 등록하지 않았습니다.

디지털 촬영이 가능한 instax·SOFORT는 수록하고 하이브리드 즉석카메라는 별도 category에 기록했습니다. 순수 필름 즉석카메라와 액션캠은 범위에서 제외했습니다. Sony RX0은 제조사의 프리미엄 컴팩트 계열로 수록했습니다.

| 브랜드 | 모델 수 |
|---|---:|
| Sony | 27 |
| Canon | 17 |
| Nikon | 3 |
| Fujifilm | 11 |
| Leica | 9 |
| Panasonic | 5 |
| Ricoh | 7 |
| Pentax | 3 |
| OM SYSTEM | 1 |
| Kodak | 8 |
| Sigma | 4 |

## 가격과 사양

- 공식 현재가·출시가·과거 공식가가 확인된 모델 44종, 공식 가격 미확인 51종.
- 가격 기록 종류: current 33건, launch 8건, historical 3건.
- 원화 공식 가격만 반영했습니다. Kodak 및 TG-7의 해외구매·병행수입 판매 확인은 국내 유통 근거로만 기록하며 판매점 가격을 공식가로 사용하지 않았습니다.
- X100V의 이전 검토에서 확인된 과거 공식가 1,699,000원은 유지했습니다. 미확인 과거 가격은 대표 가격으로 남기지 않았습니다.
- 실제 초점거리, 35mm 환산 초점거리, 줌 렌즈 조리개 범위를 분리했습니다. 센서 이동식 IBIS와 렌즈 OIS도 구분했습니다.
- Sigma Foveon 화소는 제조사의 층 합산 수치임을 설명하고 층별 출력 해상도를 함께 기록했습니다.
- 무게는 본체 단독/배터리·카드 포함 여부를 기록하고 공식 자료가 불분명하면 비워 두었습니다.
- 사진 95종에 원본 출처를 연결했습니다. 큰 Canon 원본 3개는 웹용 WebP로 최적화했고 원본은 tmp/fixed-originals에 보관했습니다. Sony W830은 확보 가능한 공식 원본 해상도가 낮습니다.

## 동작과 검증

- 일체형도 바디 카드에서 견적에 담을 수 있습니다. 선택된 일체형의 내장 렌즈를 표시하고 별도 교환 렌즈를 합산하지 않습니다. 잘못된 공유 URL에 렌즈가 들어 있어도 초기화 때 제거합니다.
- 비교 화면에 내장 렌즈·환산 초점거리·최대 조리개 항목을 추가했습니다.
- microSD와 일반 SD의 물리 규격, SDHC와 SDXC 지원, 명시된 최대 용량을 검사합니다.
- 일체형 플래시는 브랜드 일치만으로 TTL 호환을 확정하지 않습니다. 핫슈 없음이 확인된 TZ99·TZ300·LX10은 장착 불가로 안내합니다.
- 원본 DB의 비활성화 상태와 기존 제품 식별자는 유지했습니다.
- 배포 워크플로의 필수 29개 검증 통과. 로컬 화면에서 95종 필터, L10 검색·가격 출처·견적 연결을 확인했습니다.

## 주요 공식 근거

- [Panasonic Korea L10 출시](https://www.panasonic.co.kr/event/news_view.do?seq=184)
- [Sony RX10 V 공식 사양](https://www.sony.jp/cyber-shot/products/DSC-RX10M5/spec.html)
- [Canon Camera Museum](https://global.canon/en/c-museum/)
- [Fujifilm Korea X100VI](https://fujifilm-korea.co.kr/products/id/1330)
- [SD Association 규격 호환 안내](https://www.sdcard.org/consumers/faq/)

각 제품의 상세 출처와 확인일은 system-expansion.json의 officialSource/specSources, korea-prices.json의 가격 상세, product-images.json의 sourcePage/sourceImage에서 확인할 수 있습니다.
