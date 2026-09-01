Matchcamera 누적 수정사항 적용 안내 (2026-09-01)
================================================

이 ZIP은 D:\Matchcamera에 그대로 덮어쓰는 overlay입니다.
.git 폴더와 secret은 포함하지 않습니다.

1. PowerShell에서 원격 최신 상태를 먼저 받습니다.

   cd D:\Matchcamera
   git status
   git pull --rebase origin main

2. 내려받은 ZIP 경로를 확인합니다.

   $mcZip = "$env:USERPROFILE\Downloads\Matchcamera_All_Updates_Overlay_2026-09-01.zip"
   Test-Path -LiteralPath $mcZip

   True가 나와야 합니다. False이면 실제 다운로드 위치에 맞게 $mcZip 값만 바꾸세요.

3. 저장소에 덮어씁니다.

   Expand-Archive -LiteralPath $mcZip -DestinationPath "D:\Matchcamera" -Force

4. 검사 후 GitHub에 올립니다.

   cd D:\Matchcamera
   node --check public\admin\admin.js
   node --check public\assets\js\builder.js
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
