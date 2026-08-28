Matchcamera 카메라 견적형 UI v1

적용 방법
1. 이 ZIP의 내용을 D:\Matchcamera 에 그대로 덮어씁니다.
2. VS Code 터미널에서 D:\Matchcamera 로 이동합니다.
3. git add .
4. git commit -m "Redesign Matchcamera camera builder"
5. git push
6. 즉시 수동 배포가 필요하면:
   & "C:\Program Files\nodejs\npx.cmd" wrangler deploy

주요 변경
- matchcamera.com 메인을 카메라 조합기 화면으로 변경
- 좌측: 바디/렌즈 제품 목록 + 검색/필터
- 중앙: 바디 + 복수 렌즈 구성 슬롯
- 우측: 가격/무게/마운트/센서/호환성 요약
- 바디 선택 후 같은 마운트의 호환 렌즈 자동 필터
- 저장/불러오기/공유 URL 유지
- 메모리카드/배터리/플래시/삼각대는 DB 확장 전 '준비 중' 표시
- 밝은 회색 기반의 견적 사이트형 UI
- wrangler.jsonc는 현재 배포 성공 설정(matchcamera-com, 2026-08-27) 유지
