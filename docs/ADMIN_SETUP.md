# Matchcamera 관리자 페이지 설정

관리자 주소는 `https://matchcamera.com/admin/`입니다.

이 버전은 기존 JSON 데이터 구조를 유지하면서 다음 경로로 저장합니다.

`관리자 브라우저 → Cloudflare Access → Worker 관리자 API → GitHub 단일 커밋 → Cloudflare 자동 배포`

브라우저에는 GitHub Token이나 관리자 비밀번호가 포함되지 않습니다. `/admin/`의 HTML·CSS·JavaScript와 `/admin/api/` 요청은 모두 Worker가 Cloudflare Access JWT를 검증한 뒤 처리합니다.

## 1. GitHub 최소 권한 Token 만들기

GitHub의 Fine-grained personal access token을 사용합니다.

- Resource owner: `Caffa-Lab`
- Repository access: `Matchcamera.com`만 선택
- Repository permissions:
  - Contents: Read and write
  - Metadata: Read
- 만료일: 가능한 짧게 설정하고 만료 전에 교체

생성한 Token은 저장소 파일, `wrangler.jsonc`, 프런트엔드 코드에 넣지 않습니다.

장기적으로 여러 관리자를 운영하거나 개인 계정과 자동화를 분리할 때는 GitHub App installation token 방식으로 교체하는 것을 권장합니다.

## 2. Cloudflare Access 애플리케이션 만들기

Cloudflare Zero Trust에서 Self-hosted application을 추가합니다.

- Application name: `Matchcamera Admin`
- Public hostname: `matchcamera.com`
- Path: `admin/*`
- Session duration: 운영 편의에 맞게 설정
- Allow policy: 실제 관리자 이메일만 허용

정책에 `Everyone`을 허용하지 않습니다. 본인 이메일 또는 관리자 그룹만 포함합니다.

설정 후 다음 두 값을 확인합니다.

- Team domain: `<팀이름>.cloudflareaccess.com`
- Application AUD: Access 애플리케이션의 Audience tag

Worker는 Access 앞단 설정만 신뢰하지 않고 `Cf-Access-Jwt-Assertion`의 RS256 서명, 발급자, AUD, 만료 시간을 다시 검증합니다.

## 3. Worker secret 등록

PowerShell에서 `D:\Matchcamera`로 이동한 뒤 실행합니다.

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put GITHUB_ADMIN_TOKEN
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put CF_ACCESS_TEAM_DOMAIN
& "C:\Program Files\nodejs\npx.cmd" wrangler secret put CF_ACCESS_AUD
```

입력값:

- `GITHUB_ADMIN_TOKEN`: 1단계에서 만든 Fine-grained token
- `CF_ACCESS_TEAM_DOMAIN`: `https://` 없이 `<팀이름>.cloudflareaccess.com`
- `CF_ACCESS_AUD`: Access 애플리케이션 Audience tag

저장소/브랜치는 `wrangler.jsonc`의 비밀이 아닌 환경변수로 이미 설정돼 있습니다.

```json
{
  "GITHUB_REPO_OWNER": "Caffa-Lab",
  "GITHUB_REPO_NAME": "Matchcamera.com",
  "GITHUB_REPO_BRANCH": "main"
}
```

## 4. 배포

compatibility date는 기존 값 `2026-08-27`을 유지합니다.

```powershell
& "C:\Program Files\nodejs\npx.cmd" wrangler deploy
```

배포 후 다음을 확인합니다.

1. 로그아웃 상태에서 `/admin/` 접속 시 Cloudflare Access 로그인이 표시되는지 확인
2. 허용되지 않은 이메일로 접속할 수 없는지 확인
3. 관리자 대시보드에서 GitHub `main` HEAD가 표시되는지 확인
4. 테스트 제품의 비고를 수정하고 GitHub에 커밋 하나가 생성되는지 확인
5. GitHub 연동 자동 배포가 완료된 뒤 공개 페이지에 반영되는지 확인

GitHub 자동 배포가 연결되지 않은 경우 관리자 저장은 GitHub까지만 완료됩니다. 그때는 수동으로 `wrangler deploy`를 실행해야 사이트에 반영됩니다.

## 5. 로컬 읽기 전용 확인

로컬에서 화면만 확인할 때 프로젝트 루트에 커밋하지 않는 `.dev.vars` 파일을 만들 수 있습니다.

```text
ADMIN_DEV_BYPASS=true
```

`localhost`와 `127.0.0.1`에서만 동작하며, GitHub Token이 없으면 관리자 화면은 읽기 전용으로 표시됩니다. 운영 환경에는 `ADMIN_DEV_BYPASS`를 설정하지 않습니다.

## 데이터 저장 범위

관리자 API가 수정할 수 있는 JSON은 다음 파일로 제한됩니다.

- `public/data/products.json`
- `public/data/system-expansion.json`
- `public/data/official-partner-products.json`
- `public/data/korea-prices.json`
- `public/data/product-images.json`
- `public/data/batteries.json`
- `public/data/mount-adapters.json`
- `public/data/home-config.json`

이미지는 다음 경로만 허용됩니다.

- `public/assets/images/banner/Banner1~Banner4.*`
- `public/assets/images/products/<brand>/<file>.*`

저장 시 브라우저가 읽었던 GitHub HEAD와 현재 HEAD가 다르면 `409 Conflict`로 중단됩니다. 새로고침 후 최신 데이터를 다시 확인해야 덮어쓰기 사고를 막을 수 있습니다.

## 백업과 복구

모든 관리자 변경은 GitHub 커밋으로 남습니다. 문제가 생기면 GitHub에서 해당 커밋을 revert하여 복구합니다. 강제 push나 기존 커밋 덮어쓰기는 관리자 API에서 사용하지 않습니다.

## 현재 JSON 방식과 D1 비교

| 항목 | 현재 GitHub JSON 방식 | Cloudflare D1 방식 |
|---|---|---|
| 구현 난이도 | 현재 구조를 재사용하므로 낮음 | 스키마·마이그레이션·API 전면 변경 필요 |
| 보안 | Access + Worker + secret으로 충분 | 동일한 인증 구조 필요 |
| 백업 | Git 커밋이 곧 버전 기록 | 별도 export/backup 설계 필요 |
| 사이트 읽기 속도 | 정적 JSON CDN 캐시 사용 | Worker/D1 조회 필요 |
| 동시 수정 | HEAD 충돌 감지, 단일 관리자에 적합 | 트랜잭션과 다중 관리자에 유리 |
| 확장성 | 현재 약 1천 개 제품 규모에 충분 | 수만 개·관계형 조회·다중 관리 시 유리 |

현재 Matchcamera 규모와 기존 배포 구조에서는 GitHub JSON 방식을 우선 사용합니다. 관리자 수가 늘거나 변경 빈도가 높아지고, 가격 이력·감사 로그·사용자 권한을 관계형으로 관리해야 할 때 D1 이전을 검토합니다.
