from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
program = ROOT / "public/index.html"
home = ROOT / "public/home/index.html"
builder = ROOT / "public/builder/index.html"

errors = []

if not program.exists():
    errors.append("public/index.html 없음")
else:
    text = program.read_text(encoding="utf-8", errors="ignore")
    if '<h1>프로그램</h1>' not in text:
        errors.append('메인 주소에 프로그램 목록이 없음')
    if 'href="https://matchcamera.com/"' not in text:
        errors.append('프로그램 메인의 canonical 주소가 올바르지 않음')
    if '/assets/js/home.js' in text or 'googlesyndication.com' in text:
        errors.append('프로그램 메인에서 카메라 홈 코드 또는 광고를 불러옴')

if not home.exists():
    errors.append("public/home/index.html 없음")
else:
    text = home.read_text(encoding="utf-8", errors="ignore")
    if 'class="home-page"' not in text:
        errors.append('public/home/index.html이 home-page가 아님')
    if '/assets/js/home.js' not in text:
        errors.append('public/home/index.html에 home.js 연결이 없음')
    if 'href="https://matchcamera.com/home/"' not in text:
        errors.append('카메라 홈의 canonical 주소가 올바르지 않음')
    if '카메라 견적내기 — Matchcamera' in text and 'builder-page' in text:
        errors.append('public/home/index.html이 Builder 페이지로 덮어써진 것으로 보임')

if not builder.exists():
    errors.append("public/builder/index.html 없음")
else:
    text = builder.read_text(encoding="utf-8", errors="ignore")
    if 'builder-page' not in text:
        errors.append('public/builder/index.html이 Builder 페이지가 아님')

if errors:
    print("HOME CHECK: FAILED")
    for e in errors:
        print(" -", e)
    sys.exit(1)

print("HOME CHECK: OK")
print(" - /            -> 프로그램")
print(" - /home/       -> 카메라 홈")
print(" - /builder/    -> 카메라 견적내기")
