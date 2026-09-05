Matchcamera 누적 수정사항 적용 안내 (2026-09-02)
================================================

이 ZIP은 D:\Matchcamera에 그대로 덮어쓰는 overlay입니다.
.git 폴더와 secret은 포함하지 않습니다.

1. PowerShell에서 원격 최신 상태를 먼저 받습니다.

   cd D:\Matchcamera
   git status
   git pull --rebase origin main

2. 내려받은 ZIP 경로를 확인합니다.

   $mcZip = "C:\Users\Caffa\Desktop\다운로드\Matchcamera_All_Updates_Overlay_2026-09-02.zip"
   Test-Path -LiteralPath $mcZip

   True가 나와야 합니다. False이면 실제 다운로드 위치에 맞게 $mcZip 값만 바꾸세요.

3. 저장소에 덮어씁니다.

   Expand-Archive -LiteralPath $mcZip -DestinationPath "D:\Matchcamera" -Force

4. 검사 후 GitHub에 올립니다.

   cd D:\Matchcamera
   node scripts\build_product_index.mjs
   node --check public\admin\admin.js
   node --check public\assets\js\builder.js
   node --check public\assets\js\resize.js
   node scripts\test_programs.mjs
   node scripts\test_admin_worker.mjs
   python scripts\check_homepage.py
   git status
   git add .
   git commit -m "Apply Matchcamera consolidated updates"
   git pull --rebase origin main
   git push origin main

5. GitHub Actions의 Deploy Matchcamera Worker가 완료되면 사이트에서 Ctrl+F5를 누릅니다.

상품 이미지 원본 복원
---------------------
별도 제공되는 Matchcamera_Product_Images_Original_Backup_2026-09-01.zip에는
투명 배경 처리 전 public/assets/images/products 전체와 당시 product-images.json이 들어 있습니다.
필요할 때만 D:\Matchcamera에 덮어쓰면 원본으로 복원됩니다.

중요
----
- 관리자 수정은 대기열에 모이고, '변경사항 한 번에 배포'를 눌렀을 때 한 커밋으로 저장됩니다.
- 제품 비활성화는 DB를 삭제하지 않으며 공개 화면에서만 숨깁니다.
- Sony 고해상도 교체는 공식 제품 페이지에서 원본 긴 변 500px 이상이 검증된 항목만 적용합니다.
- 구형/미공개 제품은 다른 제품 사진이나 단순 확대 이미지로 대체하지 않습니다.
- 홈은 경량 제품 인덱스를 사용하고 견적 페이지는 처음 40개만 표시한 뒤 스크롤할 때 추가로 불러옵니다.
- 렌즈 필터 구경은 검색 필터가 아니라 제품 상세정보와 관리자 제품 편집에서 관리합니다.
- 프로그램 메뉴는 도구 선택 화면이며 메타데이터 추출기와 사진 리사이즈·장비 워터마크 도구를 제공합니다.
- 새 사진 도구는 EXIF로 바디·렌즈를 자동 인식하고, 검색 보정·제품 이미지 합성·일괄 ZIP 저장을 브라우저 안에서 처리합니다.
