# Matchcamera 1단계 이용 집계

작성일: 2026-09-15. 목적은 무료 도구의 이용과 처리 안정성을 확인하고, 다음 개발 순서를 결정하는 것이다. 이 구현은 **동작 횟수 집계**이며 사람을 추적하는 방문자 분석이 아니다.

## 수집 내용과 제외 내용

브라우저는 같은 사이트의 `POST /api/usage`에 아래 두 값만 보낸다.

```json
{"event":"tool_success","surface":"resize"}
```

이벤트명과 기능명은 미리 정한 목록 중에서만 선택된다. 사진, 파일명, EXIF, 검색어, 제품명, 제품 ID, 페이지 URL, 문의 내용, 이메일, 사용자 식별자를 보내지 않는다. 쿠키를 보내거나 방문자 ID를 만들지 않는다. Referrer도 보내지 않는다. 광고용 스크립트의 동작과는 별개의 자체 집계이다.

네트워크 요청이므로 연결에 필요한 IP 등은 Cloudflare에서 처리된다. 과도한 요청을 제한하기 위해 Worker는 Cloudflare가 제공한 IP를 인스턴스 메모리의 분 단위 버킷에서만 사용한다. 분이 바뀐 뒤 첫 요청 또는 인스턴스 종료 시 기존 버킷이 폐기되며, IP는 분석 데이터·응답·애플리케이션 로그에 기록하지 않는다. Cloudflare 자체 보안·접속 로그는 이 분석 데이터와 구별한다.

브라우저의 DNT 또는 Global Privacy Control이 켜져 있거나 `localStorage`의 `matchcamera.metricsOptOut` 값이 `1` 또는 `true`이면 보내지 않는다. 이 선택은 해당 브라우저에만 적용되며 사이트 저장 공간을 삭제하면 사라진다. 저장 설정에 접근할 수 없는 환경에서도 보내지 않는다. Worker 역시 DNT/GPC 헤더를 받으면 저장하지 않는다. 수집 실패는 프로그램의 본래 동작을 중단시키지 않는다.

## 이벤트 사전

| event | 의미 | 해석 주의 |
|---|---|---|
| `page_view` | 대상 화면이 열림 | 사람 수·고유 방문 수가 아닌 화면 열림 수 |
| `tool_start` | 처리 작업 시작 | 도구별 작업 단위를 아래와 같이 구분 |
| `tool_success` | 해당 처리 작업 완료 | 파일 저장 완료나 사용자 만족을 뜻하지 않음 |
| `tool_failure` | 처리 작업 실패 | 오류 내용·파일 정보는 전송하지 않음 |
| `tool_cancelled` | 진행 중인 작업이 사진 교체 등으로 취소됨 | 기술적 실패와 구분 |
| `tool_download` | 다운로드 동작 실행 | 운영체제에 실제 저장되었는지 확인하지 않음 |
| `tool_copy` | 결과 문구 복사 성공 | 클립보드 내용은 전송하지 않음 |
| `compare_ready` | 비교할 제품 구성이 준비됨 | 구매 또는 사용자 수가 아님 |
| `estimate_ready` | 견적 구성이 준비됨 | 주문 완료·구매 의사 확정이 아님 |
| `report_open` | 오류 제보 경로를 엶 | 이메일 발송·접수 완료가 아님 |

`surface` 허용값은 `home`, `body`, `lens`, `database`, `accessories`, `compare`, `builder`, `resize`, `filename`, `metadata`, `rating`, `carousel`, `exposure`, `contact`, `trust`이다. 새로운 값은 클라이언트와 Worker 양쪽의 목록, 이 사전, 검증을 함께 바꿔야 한다. 허용 목록에 있다는 사실만으로 해당 화면의 모든 동작이 계측되었다고 간주하지 않는다.

현재 계측 단위는 메타데이터 추출(`metadata`)의 경우 파일별 분석, 파일명 내보내기(`filename`)의 경우 파일별 출력, 리사이즈·장비 워터마크(`resize`)의 경우 내보내기 작업 묶음이다. 따라서 서로 다른 도구의 처리 횟수를 합쳐 “처리한 사진 수”로 발표하지 않는다. 다운로드·복사도 클릭 또는 성공 동작의 횟수이며 고유 파일 수가 아니다.

인스타 연속 사진(`carousel`)은 처리 버튼으로 시작한 전체 분할 내보내기 작업을 한 번으로 센다. 결과 JPEG 수만큼 시작·성공을 늘리지 않으며, 개별 JPEG 또는 ZIP 다운로드 동작은 `tool_download`로 별도 집계한다. 노출·ND 계산기(`exposure`)는 계산 버튼으로 시작한 계산 작업 한 번을 기준으로 시작·성공·실패를 센다. 타이머의 매 초 변화나 설정 입력마다 이벤트를 보내지 않는다. 두 도구 모두 사진·파일명·편집 설정값·조리개·ISO·셔터스피드·ND 값·계산 결과를 전송하지 않는다.

메타데이터 분석 성공에는 정상적으로 파일을 분석한 뒤 촬영 정보가 없음을 확인한 경우도 포함한다. EXIF 라이브러리를 불러오지 못해 분석 자체가 시작되지 않은 경우와 페이지 초기화 이전 오류는 현재 처리 실패 집계에 포함하지 않는다.

## 서버 계약과 장애 해석

- 메서드는 POST만 허용한다. GET·OPTIONS는 `405`, `Allow: POST`이다.
- HTTPS의 `matchcamera.com` 또는 `www.matchcamera.com`에서 요청 URL과 Origin이 정확히 같은 경우만 허용한다. 로컬 개발은 localhost·127.0.0.1·IPv6 loopback의 동일 Origin을 허용한다. Origin이 없거나 다르면 `403`이다. CORS를 개방하지 않는다.
- `application/json`만 허용한다. 요청 본문은 실제 읽은 길이를 포함해 256바이트까지이며, 정확히 `event`와 `surface` 두 필드만 있어야 한다. 추가 필드나 미등록 값은 거절한다.
- 하나의 Worker 인스턴스에서 한 IP는 분당 180건까지 허용한다. 인스턴스·분이 바뀌면 초기화되는 보조 제한이며 전역 봇 차단이 아니다. 공유 IP나 대량 처리로 집계가 누락될 수도 있다.
- 유효한 이벤트를 Analytics Engine 쓰기 큐에 넣으면 `202`이다. 이 응답은 데이터가 이미 조회 가능하거나 영구 저장됐다는 확인서가 아니다.
- 바인딩 누락 또는 쓰기 호출 실패는 `503`이다. 수집 기능이 꺼졌는데 정상 수집으로 표시하지 않는다.
- 거절 응답이나 오류 로그에 사용자 본문을 재출력하지 않는다. 자동 재시도도 하지 않아 중복 가능성과 사용자 작업 방해를 줄인다.

브라우저의 fetch는 고정된 `/api/usage` 주소, `redirect: error`, `credentials: omit`, `referrerPolicy: no-referrer`, `mode: cors`를 사용한다. `cors`는 fetch의 기본 모드이며 서버에서 외부 Origin을 허용한다는 뜻이 아니다. `same-origin` 모드와 `no-referrer`를 함께 사용하면 POST의 Origin이 `null`로 변할 수 있어 서버의 정상 요청 검증을 통과하지 못한다. [Fetch 표준의 Origin 처리](https://fetch.spec.whatwg.org/#origin-header)

## 저장소와 스키마

`wrangler.jsonc`의 `USAGE_ANALYTICS` 바인딩은 `matchcamera_usage_v1` 데이터셋을 사용한다. 배열 순서는 스키마이므로 배포 이후 임의로 바꾸지 않는다.

| Analytics Engine 열 | 값 |
|---|---|
| `blob1` | 고정 스키마 버전 `v1` |
| `blob2` | 이벤트명 |
| `blob3` | 기능명 |
| `double1` | 고정 숫자 `1` |
| `index1` | 기능명; 샘플링 키, 개인 식별자 아님 |
| `timestamp` | Cloudflare가 쓰기 시 부여하는 시각 |

데이터셋은 바인딩을 배포한 뒤 처음 쓸 때 자동 생성된다. `writeDataPoint()`는 즉시 반환하고 실제 쓰기는 런타임이 처리한다. [Cloudflare 시작 문서](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)

현재 공식 문서의 보관 기간은 3개월이다. 장기 운영표에는 주간 집계만 따로 기록할 수 있지만, 이 변경에 자동 백업·별도 보관은 포함하지 않았다. [Cloudflare 보관 한도](https://developers.cloudflare.com/analytics/analytics-engine/limits/)

2026-09-15 확인 당시 공식 가격 문서는 Analytics Engine 사용에 아직 청구하지 않는다고 안내한다. 기존 Workers 사용량에는 요청이 추가되며, 요금 정책은 추후 달라질 수 있다. 이번 작업으로 유료 플랜 가입·결제 정보 입력·새 비밀키 발급은 하지 않는다. [Cloudflare 가격 문서](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)

## 운영자가 보는 조회 방법

데이터 조회에는 해당 Cloudflare 계정의 접근 권한이 필요하다. SQL API를 쓰려면 계정 ID와 `Account Analytics Read` 권한이 있는 API 토큰이 필요하며, 기존 GitHub 배포 토큰에 이 읽기 권한이 있다고 가정하면 안 된다. 이 구현은 읽기용 비밀키나 공개 대시보드를 만들지 않는다. Cloudflare에서 제공하는 계정별 분석 화면 또는 승인된 읽기 경로로 조회한다. [Cloudflare 조회 안내](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)

다음은 SQL API용 주간 이벤트 표이다. 샘플링을 반영하기 위해 `COUNT(*)` 대신 **`SUM(_sample_interval)`**을 사용한다. 숫자 `double1`이 항상 1이므로 `SUM(_sample_interval * double1)`도 동일하다.

```sql
SELECT
  blob3 AS surface,
  blob2 AS event,
  SUM(_sample_interval) AS event_count
FROM matchcamera_usage_v1
WHERE timestamp >= NOW() - INTERVAL '7' DAY
  AND blob1 = 'v1'
GROUP BY surface, event
ORDER BY surface, event
```

다음은 일별 추이를 대시보드로 만들 때의 기본 쿼리다. `day_utc`는 UTC 기준 일 경계이므로 운영표에 한국 시간 날짜를 쓸 때는 변환 기준을 명시한다.

```sql
SELECT
  intDiv(toUInt32(timestamp), 86400) * 86400 AS day_utc,
  blob3 AS surface,
  blob2 AS event,
  SUM(_sample_interval) AS event_count
FROM matchcamera_usage_v1
WHERE timestamp >= NOW() - INTERVAL '30' DAY
  AND blob1 = 'v1'
GROUP BY day_utc, surface, event
ORDER BY day_utc, surface, event
```

SQL 요청 주소는 `https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql`이다. 계정 ID와 읽기 토큰을 공개 JavaScript·저장소·화면에 넣지 않는다. [Cloudflare SQL 문서](https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/)

## 매주 판단할 지표와 한계

1. 기능별 시작·성공·실패·취소 횟수와 다운로드·복사 동작을 같은 기간끼리 비교한다.
2. `실패 / (성공 + 실패)`는 **관측된 완료 작업의 실패 비율**로만 사용한다. 취소는 별도로 보고, 식별자 없는 개별 이벤트가 누락되거나 샘플링되므로 정확한 사용자 퍼널로 해석하지 않는다.
3. 견적·비교 횟수가 늘어나는지 보고 관련 사용자 인터뷰와 판매점 실험의 우선순위를 정한다.
4. 제보 경로 열림과 실제 받은 제보는 별개로 기록한다. 신뢰 개선 성과에는 접수 건수·정정까지 걸린 시간도 필요하다.
5. **이 자료만으로 MAU, 고유 이용자 수, 다음 달 재방문률, 개인별 전환율, 유입 채널별 성과를 계산할 수 없다.** 페이지를 연 횟수를 “사용자 수”라고 바꾸어 적지 않는다. 사업계획서의 이용자·재사용 목표는 별도 검증 방법이 마련될 때까지 미측정으로 표시한다.

브라우저 차단·옵트아웃·오프라인·화면 종료·전송 실패·요청 제한·자동화된 트래픽 때문에 실제 이용과 차이가 생긴다. 로그인, 결제, 사용자 식별을 추가하기 전에는 동작 횟수의 추세와 직접 받은 의견을 함께 사용한다.

## 검증 및 배포 확인

`node scripts/test_usage_events.mjs`는 실제 Worker 라우팅과 쓰기 데이터, Origin·본문 검증, 개인정보 신호, 누락 바인딩, 요청 제한, 브라우저 요청 옵션과 실패 격리를 검증한다. 단위 검증의 Analytics Engine은 가짜 바인딩이므로 Cloudflare 실데이터 조회 확인과 구별한다.

배포 뒤 GET의 405는 라우팅만 증명한다. 정상 POST의 202는 바인딩의 쓰기 호출 접수까지 증명한다. 실제 이벤트 수 확인은 계정 권한으로 데이터셋을 조회한 뒤에만 완료로 보고한다. 정상 POST를 인위적으로 보내는 검증은 집계에 이벤트를 추가하므로 시간과 건수를 운영 기록에 남긴다.
