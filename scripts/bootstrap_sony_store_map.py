from pathlib import Path
import json

root = Path(__file__).resolve().parents[1]
dst = root / "public/data/sony-store-pages.json"
example = root / "public/data/sony-store-pages.example.json"

if not dst.exists():
    data = json.loads(example.read_text(encoding="utf-8"))
    meta = data.pop("_meta", None)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Created:", dst)
else:
    print("Already exists:", dst)
