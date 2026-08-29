#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

JSON_FILES = [
    ROOT / "public/data/products.json",
    ROOT / "public/data/system-expansion.json",
    ROOT / "public/data/official-partner-products.json",
]

DATA_JS = ROOT / "public/assets/js/data.js"
DATABASE_JS = ROOT / "public/assets/js/database.js"

def norm_key(k):
    return re.sub(r"[\s_\-()\[\]{}./]+", "", str(k or "")).lower()

def is_us_price_key(k):
    n = norm_key(k)

    exact = {
        "currentpriceusd",
        "originalpriceusd",
        "priceusd",
        "msrpusd",
        "launchpriceusd",
        "releasepriceusd",
        "retailpriceusd",
        "streetpriceusd",
        "usprice",
        "usmsrp",
        "미국가격",
        "미국출시가",
        "미국판매가",
        "미국소비자가",
        "미국권장가격",
    }
    if n in exact:
        return True

    # Any price-labelled field explicitly containing USD.
    if "usd" in n and any(x in n for x in ("price","msrp","가격","출시가","판매가","정가","소비자가")):
        return True

    # Korean/English U.S. price descriptors.
    if ("미국" in n or n.startswith("us")) and any(
        x in n for x in ("가격","출시가","판매가","정가","소비자가","price","msrp")
    ):
        return True

    return False

def clean_obj(obj, stats):
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if is_us_price_key(k):
                stats["removed"] += 1
                stats["keys"][str(k)] = stats["keys"].get(str(k), 0) + 1
                continue
            out[k] = clean_obj(v, stats)
        return out
    if isinstance(obj, list):
        return [clean_obj(x, stats) for x in obj]
    return obj

def backup(path: Path):
    bak = path.with_name(path.name + ".bak-before-us-price-cleanup")
    if path.exists() and not bak.exists():
        shutil.copy2(path, bak)

def clean_json(path: Path):
    if not path.exists():
        print("SKIP missing:", path)
        return {"removed":0,"keys":{}}

    data = json.loads(path.read_text(encoding="utf-8"))
    stats = {"removed":0,"keys":{}}
    cleaned = clean_obj(data, stats)

    backup(path)
    path.write_text(
        json.dumps(cleaned, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"JSON {path.relative_to(ROOT)} -> removed {stats['removed']} US-price fields")
    if stats["keys"]:
        for k, n in sorted(stats["keys"].items(), key=lambda x:(-x[1],x[0])):
            print(f"   {k}: {n}")
    return stats

def patch_data_js():
    if not DATA_JS.exists():
        print("SKIP missing:", DATA_JS)
        return

    text = DATA_JS.read_text(encoding="utf-8")
    original = text

    # v7/v16 data loader retained U.S. source price as originalPriceUsd and
    # overloaded currentPriceUsd with KRW for backward compatibility.
    # Remove both legacy fields. All price displays must use currentPriceKrw.
    text = re.sub(
        r"^\s*originalPriceUsd:\s*p\.currentPriceUsd\s*\?\?\s*null,\s*\r?\n",
        "",
        text,
        flags=re.M,
    )
    text = re.sub(
        r"^\s*currentPriceUsd:\s*displayKrw,\s*\r?\n",
        "",
        text,
        flags=re.M,
    )

    if text != original:
        backup(DATA_JS)
        DATA_JS.write_text(text, encoding="utf-8")
        print("PATCH public/assets/js/data.js -> legacy USD fields removed")
    else:
        print("INFO data.js -> USD compatibility fields already absent or pattern changed")

def patch_database_js():
    if not DATABASE_JS.exists():
        print("SKIP missing:", DATABASE_JS)
        return

    text = DATABASE_JS.read_text(encoding="utf-8")
    original = text

    # Defense-in-depth: even if an old/stale JSON still has a U.S. price
    # field in specs, Product DB detail must not render it.
    old = (
        "Object.entries(p.specs||{}).filter(([k,v])=>"
        "v!==null&&v!==undefined&&String(v)!==''&&!seen.has(k))"
    )
    new = (
        "Object.entries(p.specs||{}).filter(([k,v])=>"
        "v!==null&&v!==undefined&&String(v)!==''&&!seen.has(k)"
        "&&!/(?:usd|미국\\s*(?:가격|출시가|판매가|정가|소비자가)|us\\s*(?:price|msrp))/i.test(String(k)))"
    )

    if old in text:
        text = text.replace(old, new, 1)

    if text != original:
        backup(DATABASE_JS)
        DATABASE_JS.write_text(text, encoding="utf-8")
        print("PATCH public/assets/js/database.js -> U.S. price specs hidden")
    else:
        print("INFO database.js -> filter already patched or source pattern changed")

def main():
    total = 0
    for path in JSON_FILES:
        stats = clean_json(path)
        total += stats["removed"]

    patch_data_js()
    patch_database_js()

    print()
    print("DONE")
    print("Removed US/USD price fields:", total)
    print("Korean price database was NOT modified:")
    print("  public/data/korea-prices.json")
    print()
    print("Backup files end with:")
    print("  .bak-before-us-price-cleanup")

if __name__ == "__main__":
    main()
