#!/usr/bin/env python3
"""Sony Korea 공식 제품 페이지의 500px 이상 대표 제품컷으로 Sony 이미지를 교체한다."""
from __future__ import annotations

import concurrent.futures
import html
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

ROOT = Path(__file__).resolve().parents[1]
PRODUCT_FILES = [
    ROOT / "public/data/products.json",
    ROOT / "public/data/system-expansion.json",
    ROOT / "public/data/official-partner-products.json",
]
MANIFEST = ROOT / "public/data/product-images.json"
REPORT = ROOT / "public/data/sony-official-highres-report.json"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def label(product):
    return product.get("officialName") or product.get("model") or product.get("modelCode") or product.get("id")


def normalized_code(value):
    return re.sub(r"[^A-Z0-9]", "", str(value or "").upper())


def product_codes(product):
    source = " ".join(str(product.get(key) or "") for key in ("modelCode", "model", "officialName"))
    patterns = [r"\b(?:ILCE|ILCA|ILME|MPC|PXW|NEX|ZV|SLT|DSLR)-[A-Z0-9]+\b", r"\b(?:SEL|SAL)[A-Z0-9]+\b"]
    out = []
    for pattern in patterns:
        for code in re.findall(pattern, source.upper()):
            if code not in out:
                out.append(code)
    return out


def page_candidates(product):
    result = []
    official = str(product.get("officialSource") or "")
    if "sony.co.kr/" in official and "/products/" in official:
        result.append(official.split("?")[0])
    for code in product_codes(product):
        slug = code.lower()
        if product.get("type") == "렌즈":
            result.append(f"https://www.sony.co.kr/lenses/products/{slug}")
        else:
            if product.get("cameraSystem") == "시네마":
                result.extend([f"https://www.sony.co.kr/cinema-line/products/{slug}", f"https://www.sony.co.kr/interchangeable-lens-cameras/products/{slug}"])
            else:
                result.append(f"https://www.sony.co.kr/interchangeable-lens-cameras/products/{slug}")
    return list(dict.fromkeys(result))


def large_scene7(url):
    parts = urlsplit(html.unescape(url))
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({"fmt": "png-alpha", "wid": "1200", "hei": "1200"})
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def identify(path):
    result = subprocess.run(["identify", "-format", "%w %h", str(path)], check=True, capture_output=True, text=True)
    width, height = result.stdout.strip().split()
    return int(width), int(height)


def collect(product):
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    codes = {normalized_code(code) for code in product_codes(product)}
    errors = []
    for page in page_candidates(product):
        try:
            response = session.get(page, timeout=18)
            if response.status_code != 200 or len(response.text) < 10_000:
                continue
            match_code = re.search(r"productCode\s*:\s*['\"]([^'\"]+)", response.text)
            if codes and match_code and normalized_code(match_code.group(1)) not in codes:
                continue
            match = re.search(r"productImage\s*:\s*['\"]([^'\"]+)", response.text)
            if not match:
                match = re.search(r"<meta[^>]+property=['\"]og:image['\"][^>]+content=['\"]([^'\"]+)", response.text, re.I)
            if not match:
                continue
            source_image = large_scene7(match.group(1))
            image = session.get(source_image, timeout=24, headers={"Referer": page})
            if image.status_code != 200 or not image.headers.get("content-type", "").startswith("image/"):
                continue
            return {"product": product, "page": page, "sourceImage": source_image, "bytes": image.content}
        except Exception as exc:
            errors.append(str(exc))
    return {"product": product, "error": errors[-1] if errors else "공식 고해상도 제품 페이지를 찾지 못했습니다."}


def main():
    products = [product for path in PRODUCT_FILES for product in load(path) if product.get("manufacturer") == "Sony" and (product.get("currentSale") == "예" or product.get("saleStatus") == "현재 판매")]
    manifest = load(MANIFEST)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        downloads = list(pool.map(collect, products))
    for result in downloads:
        product = result["product"]
        if "bytes" not in result:
            results.append({"id": product.get("id"), "status": "not-found", "error": result.get("error")})
            continue
        mapping = manifest.get(product.get("id")) or manifest.get(label(product))
        if not mapping:
            results.append({"id": product.get("id"), "status": "no-mapping"})
            continue
        src = mapping if isinstance(mapping, str) else mapping.get("src")
        if not src or not src.startswith("/assets/images/products/sony/"):
            results.append({"id": product.get("id"), "status": "invalid-path"})
            continue
        output = ROOT / "public" / src.lstrip("/")
        with tempfile.NamedTemporaryFile(suffix=".png") as raw:
            raw.write(result["bytes"]); raw.flush()
            try:
                width, height = identify(raw.name)
                if max(width, height) < 500:
                    results.append({"id": product.get("id"), "status": "too-small", "size": [width, height]})
                    continue
                subprocess.run([
                    "convert", raw.name, "-alpha", "on", "-bordercolor", "white", "-border", "1", "-fuzz", "7%", "-fill", "none",
                    "-draw", "matte 0,0 floodfill", "-shave", "1x1", "-resize", "900x900>", "-gravity", "center", "-background", "none",
                    "-extent", "900x900", "-quality", "92", str(output),
                ], check=True)
            except Exception as exc:
                results.append({"id": product.get("id"), "status": "convert-error", "error": str(exc)})
                continue
        record = dict(mapping) if isinstance(mapping, dict) else {"src": mapping}
        record.update({"sourcePage": result["page"], "sourceImage": result["sourceImage"], "method": "sony-korea-official-pdp-highres", "fetchedAt": datetime.now(timezone.utc).isoformat(), "width": 900, "height": 900, "sourceWidth": width, "sourceHeight": height, "usageReviewRequired": True})
        manifest[product["id"]] = record
        manifest.pop(label(product), None)
        results.append({"id": product.get("id"), "status": "updated", "source": result["page"], "sourceSize": [width, height]})
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {"generatedAt": datetime.now(timezone.utc).isoformat(), "minimumSourceSide": 500, "totalSony": len(products), "updated": sum(item["status"] == "updated" for item in results), "results": results}
    REPORT.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: summary[key] for key in ("totalSony", "updated")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
