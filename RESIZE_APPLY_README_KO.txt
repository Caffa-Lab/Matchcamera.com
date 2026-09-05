Matchcamera 사진 리사이즈 전체 기능 적용 안내 (2026-09-05)
==========================================================

이 ZIP은 D:\Matchcamera에 그대로 덮어쓰는 overlay입니다.
제공한 CaffaLab 리사이즈 프로그램의 기능을 Matchcamera 디자인에 맞춰 이식하고
EXIF 기반 바디·렌즈 검색 및 제품 사진 합성을 추가한 수정본입니다.

적용 방법
---------
1. PowerShell에서 저장소 최신 상태를 받습니다.

   cd D:\Matchcamera
   git status
   git pull --rebase origin main

2. ZIP을 D:\Matchcamera에 덮어씁니다.

   $mcZip = "C:\Users\Caffa\Desktop\다운로드\Matchcamera_Resize_Full_Functions_Equipment_2026-09-05.zip"
   Test-Path -LiteralPath $mcZip
   Expand-Archive -LiteralPath $mcZip -DestinationPath "D:\Matchcamera" -Force

3. 검사하고 GitHub에 올립니다.

   cd D:\Matchcamera
   node scripts\build_product_index.mjs
   node scripts\test_programs.mjs
   node --check public\assets\js\resize\app.js
   node --check public\program\resize\workers\image-worker.js
   git add .
   git commit -m "Restore full resize features and add equipment overlay"
   git pull --rebase origin main
   git push origin main

GitHub Actions 자동 배포가 완료되면 아래 주소에서 Ctrl+F5를 누릅니다.
https://matchcamera.com/program/resize/

포함 기능
---------
- 여러 사진 추가, 순서 이동, 개별 삭제, 전체 초기화
- 회전, 비율 자르기, 자동 비율, 테두리 생성, 흰색/검은색 여백, 여백 크기
- 3분할 격자 미리보기
- 이미지 워터마크, 위치·크기·여백·커스텀 드래그, 전체 적용
- 최대화질 또는 목표 용량 JPEG 저장
- 메타데이터 종류별 제거 및 지원 항목 보존
- 개별 결과 다운로드 및 전체 ZIP 다운로드
- EXIF 바디·렌즈·조리개·셔터·ISO·초점거리·촬영일 판독
- Matchcamera 제품 DB 자동 매칭, 수동 검색·선택, 전체 사진 동일 장비 적용
- 흰색/검은색 장비 패널과 실제 바디·렌즈 제품 사진 합성
- EXIF와 ZIP 라이브러리 로컬 포함(외부 CDN 차단 방지)
