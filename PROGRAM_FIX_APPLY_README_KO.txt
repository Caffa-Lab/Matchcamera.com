Matchcamera Rating + Resize 수정 적용 안내
=========================================

수정 내용
- Rating 프로그램 추가: /program/rating/
- Lightroom 색상 레이블: 한국어 / English / 사용자 지정 지원
- 실행 전 실제 xmp:Label 저장값 표시
- 기존 레이블 값이 달라질 때 로그 경고
- Resize 다운로드의 장비 패널을 미리보기와 같은 폭 18% 비율로 통일
- 미리보기/다운로드 글꼴, 글자 크기, 여백, 장비 이미지 배치 통일
- 고해상도 다운로드 장비 패널의 620px 상한 제거
- 테두리와 장비 패널 동시 사용 시 패널 쪽 하단 테두리 제거
- 비율 '없음'에서도 다운로드 테두리가 적용되도록 수정
- 프로그램 목록에서 Resize와 Rating을 베타로 표시

1. PowerShell에서 저장소 최신화

cd D:\Matchcamera
git status
git pull --rebase origin main

2. 다운로드한 ZIP 확인 및 덮어쓰기

$programFixZip = "C:\Users\Caffa\Desktop\다운로드\Matchcamera_Program_Rating_Resize_Fix_2026-09-05.zip"
Test-Path -LiteralPath $programFixZip
Expand-Archive -LiteralPath $programFixZip -DestinationPath "D:\Matchcamera" -Force

Test-Path 결과가 True여야 합니다.

3. 검사

cd D:\Matchcamera
node --check public\assets\js\resize\app.js
node --check public\program\resize\workers\image-worker.js
node --check public\assets\js\rating\app.js
node scripts\test_programs.mjs

4. GitHub 반영

git add public/program/index.html public/program/resize/index.html public/program/resize/workers/image-worker.js public/assets/js/resize/app.js public/assets/js/resize/image-utils.js public/program/rating/index.html public/assets/css/rating.css public/assets/js/rating/app.js public/assets/js/rating/scanner.js public/assets/js/rating/xmp.js public/sitemap.xml scripts/test_programs.mjs PROGRAM_FIX_APPLY_README_KO.txt
git commit -m "Fix program rendering and Lightroom labels"
git pull --rebase origin main
git push origin main

GitHub Actions 자동 배포가 설정되어 있으면 push 후 자동 배포됩니다.

5. 배포 후 확인

https://matchcamera.com/program/rating/
https://matchcamera.com/program/resize/

브라우저에서 Ctrl+F5를 눌러 최신 JavaScript를 불러오세요.
