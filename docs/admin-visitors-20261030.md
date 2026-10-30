# 관리자 방문 통계 · 2026-10-30

관리자 대시보드의 방문 통계는 이번 배포 이후부터 별도로 수집한다. 기존 Analytics Engine의 동작 횟수를 사람 수로 변환하거나 과거 방문자 수를 복원하지 않는다.

- **추정 방문자**: 암호학적 난수로 만든 브라우저 식별값을 기준으로 기간 내 중복을 제외한 수. 로그인 사용자·실제 사람 수가 아니다. 오늘, 오늘 포함 최근 7일, 오늘 포함 최근 30일을 각각 COUNT DISTINCT로 집계한다. 일별 방문자의 합계와 기간 방문자는 다르다.
- **페이지 조회수**: 해당 공개 페이지의 공통 모듈이 실행되고 방문 수집 요청이 정상 저장된 횟수. 새로고침을 포함한다. 관리자·404 화면은 제외한다. 기능 이용 횟수 데이터와 별개의 지표다.
- 한국시간(Asia/Seoul)의 날짜 경계를 사용한다. 첫 기록 시각과 수집 기간을 표시하며 수집 시작 전 그래프 점을 만들지 않는다. 수집 이후 방문이 없는 날짜는 실제 0으로 표시한다.
- 브라우저 식별값은 localStorage의 `matchcamera.visitor`에 `{id,createdAt}` 형태로 저장한다. 생성 시각부터 30일 고정 만료이며 방문 때마다 연장하지 않는다. 사이트 데이터 삭제, 만료, 기기·브라우저 변경 시 같은 사람도 중복될 수 있다. 개인정보 신호·추적 차단·연결 실패 시 집계에서 빠지고 자동 접근이 일부 포함될 수 있다.

## 경로와 보관

공개 브라우저는 같은 사이트의 `POST /api/visits`에 식별값과 사전 정의된 페이지 종류만 보낸다. 파일·EXIF·검색어·제품 정보·전체 URL·Referrer를 포함하지 않고 credentials를 생략한다. DNT·GPC·기존 `matchcamera.metricsOptOut` 선택을 존중하며 저장소 사용이 막히면 전송하지 않는다. 개인정보 페이지에서 측정을 끄면 로컬 방문 식별값도 삭제한다.

Worker는 Origin, 본문 크기/스키마, 페이지 목록을 검증하고 일시적인 분 단위 제한을 적용한다. 연결 IP는 이 제한의 메모리 키에만 쓰며 저장소·응답·로그로 보내지 않는다. 식별값은 SHA-256 해시로 변환하며 원본을 저장하지 않는다. 페이지 종류는 검증에만 쓰고 개별 방문 경로를 저장하지 않는다.

`VISITOR_STATS` 바인딩의 SQLite Durable Object `VisitorStats`는 날짜·해시별 조회수만 저장한다. 최근 30개 한국시간 날짜를 유지하며 날짜별 알람과 요청 시 정리로 만료 기록을 삭제한다. 수집 시작·마지막 기록 시각은 별도로 남는다. 삭제 전 자료는 Cloudflare의 PITR 복구 범위에 추가로 최대 30일 남을 수 있다. [공식 SQLite 저장소와 PITR 문서](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

공개 endpoint는 숫자나 식별값을 반환하지 않는다. `GET /admin/api/visitors`는 기존 Cloudflare Access JWT 검증 뒤에만 실행하며 전체 기간 요약·일별 집계만 반환한다. 응답은 no-store다. 미연결·첫 방문 전·조회 실패와 실제 0을 구별하고 통계 오류가 상품 관리 로딩을 막지 않도록 분리했다. 이 지표는 인증된 사람 수나 부정 클릭을 검증하는 자료로 사용하지 않는다.

## 배포와 운영

`wrangler.jsonc`에 `VisitorStats`의 `new_sqlite_classes` 마이그레이션과 바인딩을 선언했다. 기존 GitHub 배포 과정에서 생성·연결하므로 별도 분석 읽기 토큰을 만들 필요가 없다. 기존 `matchcamera_usage_v1` 스키마와 수집 설정은 유지한다. 마이그레이션 태그/클래스/namespace를 임의로 이름 변경하거나 제거하지 않는다.

Cloudflare SQLite Durable Objects는 Free/ Paid 플랜에서 지원하며 실제 요청·SQL 사용량은 해당 계정의 할당량/요금 정책을 따른다. 플랜 변경이나 새 결제 등록은 수행하지 않았다. [공식 한도](https://developers.cloudflare.com/durable-objects/platform/limits/), [공식 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/)

개인정보처리방침 §7과 시행일을 함께 갱신했다. 일반 화면의 서비스 동작과 기존 관리자 인증·제품 저장 경로는 유지한다.

## 검증

- `node scripts/test_visitor_events.mjs`: 난수 식별값, 고정 만료, 개인정보 선택, 저장/네트워크 실패 격리.
- `node scripts/test_visitor_stats.mjs`: Node 24 SQLite 실제 SQL을 통한 기간 중복 제거, 한국시간 경계, 보관 기간/알람 삭제, 요청 제한·비공개 조회 인증.
- `node scripts/test_visitor_ui.mjs`: 기간 고유 수와 일별 합계 구분, 첫 방문 전·0·오류, 그래프/일별 표, 재시도, 공개 페이지 범위.
- 로컬 Wrangler에서는 실제 Durable Object 런타임으로 수집·조회 경로를 확인한다. 로컬 테스트 기록은 운영 데이터와 분리된다.

브라우저 연결은 이번 작업 시 Work 설정에서 비활성화되어 UI를 직접 열어 확인할 수 없었다. UI 모듈·경로·실제 저장/조회 및 배포 검증 결과와 화면 직접 확인은 구별한다.
