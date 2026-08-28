from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
home = ROOT / "public/index.html"
builder = ROOT / "public/builder/index.html"

errors = []

if not home.exists():
    errors.append("public/index.html 없음")
else:
    text = home.read_text(encoding="utf-8", errors="ignore")
    if 'class="home-page"' not in text:
        errors.append('public/index.html이 home-page가 아님')
    if '/assets/js/home.js' not in text:
        errors.append('public/index.html에 home.js 연결이 없음')
    if '내 카메라 만들기 — Matchcamera' in text and 'builder-page' in text:
        errors.append('public/index.html이 Builder 페이지로 덮어써진 것으로 보임')

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
print(" - /            -> Home")
print(" - /builder/    -> 내 카메라 만들기")
