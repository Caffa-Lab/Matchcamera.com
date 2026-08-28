#!/usr/bin/env python3
"""
Matchcamera Sony Store product-image collector.

Purpose
-------
Sony 제품만 store.sony.co.kr/product-view 의 상품 페이지를 우선 사용하여
배너/샘플사진보다 '흰 배경 제품컷'에 가까운 이미지를 선택합니다.

Flow
----
1. products.json에서 Sony 제품 선택
2. sony-store-pages.json에 이미 매핑된 상품 페이지가 있으면 사용
3. 없으면 Bing에서 site:store.sony.co.kr/product-view + 모델코드/제품명으로 탐색
4. Playwright Chrome/Edge로 Sony Store 상품 페이지 렌더링
5. img/currentSrc/srcset/background-image/performance resource 후보 수집
6. 이미지 자체를 분석하여 흰/투명 배경 + 적절한 종횡비 + 큰 해상도 후보 우선
7. WebP 저장 + product-images.json 갱신
8. 발견한 Sony Store URL은 sony-store-pages.json에 저장해 다음 실행부터 재사용

Important
---------
공개 페이지에만 접근합니다. 로그인/CAPTCHA/접근제어 우회는 하지 않습니다.
Sony Store 이용조건/저작권 정책에 따라 공개 서비스 사용 전 이미지 사용 권한을 확인해야 합니다.
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse

import requests
from PIL import Image, ImageOps, ImageStat

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_PATH = ROOT / "public/data/products.json"
MANIFEST_PATH = ROOT / "public/data/product-images.json"
STORE_MAP_PATH = ROOT / "public/data/sony-store-pages.json"
REPORT_PATH = ROOT / "public/data/sony-store-images-report.json"
IMAGE_DIR = ROOT / "public/assets/images/products/sony"

STORE_HOST = "store.sony.co.kr"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131 Safari/537.36"
)

session = requests.Session()
session.headers.update({
    "User-Agent": USER_AGENT,
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
})


def norm(value=""):
    s = unicodedata.normalize("NFKC", str(value or "")).lower().replace("α", "a")
    s = re.sub(r"[^a-z0-9가-힣]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def compact(value=""):
    return norm(value).replace(" ", "")


def slug(value="", fallback="sony-product"):
    s = unicodedata.normalize("NFKD", str(value or "")).replace("α", "a")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:100] or fallback


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def label_of(p):
    return p.get("officialName") or p.get("model") or p.get("modelCode") or p.get("id") or "Sony product"


def stable_filename(p):
    stable = p.get("id") or p.get("modelCode") or label_of(p)
    return slug(stable) + ".webp"


def is_store_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return (
            (parsed.hostname or "").lower() == STORE_HOST
            and parsed.path.startswith("/product-view/")
        )
    except Exception:
        return False


class Browser:
    def __init__(self, visible=False):
        if sync_playwright is None:
            raise RuntimeError("playwright 미설치: py -m pip install playwright")
        self.runtime = sync_playwright().start()
        self.browser = None
        errors = []
        for channel in ("chrome", "msedge"):
            try:
                self.browser = self.runtime.chromium.launch(
                    channel=channel,
                    headless=not visible,
                    args=["--disable-dev-shm-usage", "--no-first-run"],
                )
                break
            except Exception as e:
                errors.append(f"{channel}: {e}")
        if self.browser is None:
            try:
                self.browser = self.runtime.chromium.launch(headless=not visible)
            except Exception as e:
                errors.append(f"chromium: {e}")
                self.runtime.stop()
                raise RuntimeError("브라우저 실행 실패: " + " | ".join(errors[-3:]))

        self.context = self.browser.new_context(
            locale="ko-KR",
            viewport={"width": 1440, "height": 1100},
            user_agent=USER_AGENT,
        )

    def close(self):
        try:
            self.context.close()
        except Exception:
            pass
        try:
            self.browser.close()
        except Exception:
            pass
        try:
            self.runtime.stop()
        except Exception:
            pass


def bing_store_search(browser: Browser, p: dict, timeout_ms=18000):
    page = browser.context.new_page()
    page.set_default_timeout(timeout_ms)
    label = label_of(p)
    model = p.get("modelCode") or ""

    queries = []
    if model:
        queries.append(f'site:{STORE_HOST}/product-view "{model}" Sony')
    queries.append(f'site:{STORE_HOST}/product-view "{label}"')
    queries.append(f'site:{STORE_HOST}/product-view Sony {model} {label}'.strip())

    found = {}
    try:
        for q in queries:
            url = "https://www.bing.com/search?q=" + quote_plus(q) + "&count=10"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                page.wait_for_timeout(800)
            except Exception:
                continue

            anchors = page.locator("li.b_algo h2 a")
            try:
                count = min(anchors.count(), 15)
            except Exception:
                count = 0

            for i in range(count):
                try:
                    node = anchors.nth(i)
                    href = node.get_attribute("href") or ""
                    title = node.inner_text(timeout=1000) or ""
                except Exception:
                    continue
                if not is_store_url(href):
                    continue

                score = 0
                hay = compact(href + " " + title)
                if model and compact(model) in hay:
                    score += 100
                if compact(label) in hay:
                    score += 80
                score += 10
                found[href] = max(found.get(href, 0), score)

            if found:
                break
    finally:
        page.close()

    return [u for u, _ in sorted(found.items(), key=lambda kv: kv[1], reverse=True)]


def map_lookup(store_map: dict, p: dict):
    label = label_of(p)
    model = p.get("modelCode") or ""

    for key in (label, model, p.get("id") or ""):
        if not key:
            continue
        entry = store_map.get(key)
        if isinstance(entry, str) and is_store_url(entry):
            return entry
        if isinstance(entry, dict) and is_store_url(entry.get("url", "")):
            return entry["url"]
    return None


def remember_store_page(store_map: dict, p: dict, url: str):
    label = label_of(p)
    store_map[label] = {
        "modelCode": p.get("modelCode") or "",
        "url": url,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def page_matches_product(page, p: dict):
    label = label_of(p)
    model = p.get("modelCode") or ""
    try:
        title = page.title()
    except Exception:
        title = ""
    try:
        body = page.locator("body").inner_text(timeout=3000)[:15000]
    except Exception:
        body = ""

    hay = compact(title + " " + body)
    if model and compact(model) in hay:
        return True
    # 긴 공식 제품명은 exact compact 포함 시 유효
    if len(compact(label)) >= 6 and compact(label) in hay:
        return True
    # 페이지가 JS 앱이라 텍스트에 모델이 없을 수 있으므로 URL 매핑은 허용
    return bool(is_store_url(page.url))


def collect_dom_candidates(page):
    """
    score_hint는 DOM 단서 기반 점수. 실제 이미지 바이트 점수와 합산합니다.
    """
    found = {}

    def add(url, score, alt=""):
        if not url or not str(url).startswith(("http://", "https://")):
            return
        u = str(url).strip()
        low = u.lower()
        if any(x in low for x in ("logo", "icon", "sprite", "banner", "event", "promo", "footer", "header")):
            score -= 90
        if any(x in norm(alt) for x in ("제품", "상품", "product", "body", "lens")):
            score += 25
        found[u] = max(found.get(u, -9999), score)

    # <img> candidates
    imgs = page.locator("img")
    try:
        count = min(imgs.count(), 250)
    except Exception:
        count = 0

    for i in range(count):
        try:
            node = imgs.nth(i)
            data = node.evaluate("""el => ({
                src: el.currentSrc || el.src || el.getAttribute('data-src') || '',
                alt: el.alt || el.title || '',
                nw: el.naturalWidth || 0,
                nh: el.naturalHeight || 0,
                visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
            })""")
        except Exception:
            continue

        score = 30
        if data.get("visible"):
            score += 10
        if max(int(data.get("nw") or 0), int(data.get("nh") or 0)) >= 800:
            score += 50
        elif max(int(data.get("nw") or 0), int(data.get("nh") or 0)) >= 450:
            score += 25
        add(data.get("src"), score, data.get("alt") or "")

    # CSS background-image candidates
    try:
        backgrounds = page.evaluate("""() => {
            const out = [];
            for (const el of document.querySelectorAll('*')) {
              const bg = getComputedStyle(el).backgroundImage;
              if (!bg || bg === 'none') continue;
              const m = bg.match(/url\\(["']?(.*?)["']?\\)/);
              if (m && m[1]) out.push(m[1]);
              if (out.length > 300) break;
            }
            return out;
        }""")
        for u in backgrounds or []:
            add(urljoin(page.url, u), 15, "")
    except Exception:
        pass

    # Resource entries are useful for JS-only galleries.
    try:
        resources = page.evaluate("""() => performance.getEntriesByType('resource')
          .map(x => x.name)
          .filter(x => /\\.(jpe?g|png|webp|avif)(\\?|$)/i.test(x))
          .slice(-500)""")
        for u in resources or []:
            add(u, 8, "")
    except Exception:
        pass

    return sorted(found.items(), key=lambda kv: kv[1], reverse=True)


def download_bytes(browser: Browser, url: str, referer: str, timeout_ms=18000):
    # Browser context shares cookies from the Sony Store page.
    resp = browser.context.request.get(
        url,
        headers={"referer": referer},
        timeout=timeout_ms,
        fail_on_status_code=False,
    )
    if resp.ok:
        return resp.body()

    # Some CDN images work better without browser request.
    r = session.get(url, headers={"Referer": referer}, timeout=timeout_ms / 1000, allow_redirects=True)
    r.raise_for_status()
    return r.content


def border_background_score(im: Image.Image):
    rgba = im.convert("RGBA")
    w, h = rgba.size
    if w < 10 or h < 10:
        return 0.0

    px = rgba.load()
    samples = []
    step_x = max(1, w // 80)
    step_y = max(1, h // 80)

    for x in range(0, w, step_x):
        for y in (0, min(h - 1, 2), max(0, h - 3), h - 1):
            samples.append(px[x, y])
    for y in range(0, h, step_y):
        for x in (0, min(w - 1, 2), max(0, w - 3), w - 1):
            samples.append(px[x, y])

    if not samples:
        return 0.0

    good = 0
    for r, g, b, a in samples:
        if a <= 20 or (r >= 235 and g >= 235 and b >= 235):
            good += 1
    return good / len(samples)


def visual_score(data: bytes, dom_hint: float):
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im.load()

    w, h = im.size
    if max(w, h) < 320:
        raise ValueError(f"too small: {im.size}")

    ratio = max(w, h) / max(1, min(w, h))
    if ratio > 4.5:
        raise ValueError(f"banner-like ratio: {im.size}")

    score = float(dom_hint)
    score += min(max(w, h) / 15, 80)

    # Product cut images on a white/transparent background get strong priority.
    bg = border_background_score(im)
    score += bg * 150

    # Typical body/lens card image aspect ratios.
    if 0.65 <= (w / h) <= 1.7:
        score += 35
    if 0.8 <= (w / h) <= 1.35:
        score += 20

    # Extremely photographic/lifestyle-looking images tend to have non-white borders.
    if bg < 0.08:
        score -= 35

    return score, im


def save_webp(im: Image.Image, output: Path, max_side=900, quality=84):
    im = ImageOps.exif_transpose(im)
    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    if im.mode not in ("RGB", "RGBA"):
        if "transparency" in im.info:
            im = im.convert("RGBA")
        else:
            im = im.convert("RGB")
    output.parent.mkdir(parents=True, exist_ok=True)
    im.save(output, "WEBP", quality=quality, method=6)
    return im.size


def choose_product_image(browser: Browser, store_url: str, p: dict, timeout_ms=20000):
    page = browser.context.new_page()
    page.set_default_timeout(timeout_ms)

    try:
        page.goto(store_url, wait_until="domcontentloaded", timeout=timeout_ms)
        # Sony Store is a JS app; give product gallery time to render.
        page.wait_for_timeout(3000)
        try:
            page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass

        if not page_matches_product(page, p):
            raise RuntimeError("Sony Store page did not match product")

        candidates = collect_dom_candidates(page)
        if not candidates:
            raise RuntimeError("no image candidates")

        best = None
        errors = []

        for url, hint in candidates[:35]:
            try:
                data = download_bytes(browser, url, page.url, timeout_ms=timeout_ms)
                score, im = visual_score(data, hint)
                if best is None or score > best["score"]:
                    best = {
                        "score": score,
                        "url": url,
                        "image": im.copy(),
                        "sourcePage": page.url,
                    }
            except Exception as e:
                errors.append(f"{url}: {type(e).__name__}: {e}")

        if best is None:
            raise RuntimeError(errors[-1] if errors else "no usable image")

        return best
    finally:
        page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--products", type=Path, default=PRODUCTS_PATH)
    ap.add_argument("--manifest", type=Path, default=MANIFEST_PATH)
    ap.add_argument("--store-map", type=Path, default=STORE_MAP_PATH)
    ap.add_argument("--report", type=Path, default=REPORT_PATH)
    ap.add_argument("--match", default="")
    ap.add_argument("--exact-model-code", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--visible", action="store_true")
    ap.add_argument("--replace", action="store_true")
    ap.add_argument("--refresh-pages", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    products = load_json(args.products, [])
    if not isinstance(products, list):
        raise SystemExit("products.json must be a list")

    selected = [
        p for p in products
        if str(p.get("manufacturer") or "").lower() == "sony"
    ]

    if args.exact_model_code:
        target = compact(args.exact_model_code)
        selected = [p for p in selected if compact(p.get("modelCode") or "") == target]

    if args.match:
        q = compact(args.match)
        selected = [
            p for p in selected
            if q in compact(" ".join(str(p.get(k) or "") for k in ("officialName","model","modelCode","id","series")))
        ]

    if args.limit:
        selected = selected[:args.limit]

    print(f"Sony products: {len(selected)} / {len(products)}")
    if args.dry_run:
        for p in selected:
            print("-", label_of(p), "|", p.get("modelCode") or "")
        return 0

    manifest = load_json(args.manifest, {})
    if not isinstance(manifest, dict):
        manifest = {}

    store_map = load_json(args.store_map, {})
    if not isinstance(store_map, dict):
        store_map = {}

    report = {
        "_meta": {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "selected": len(selected),
        },
        "items": {},
    }

    browser = Browser(visible=args.visible)
    ok = skipped = failed = 0

    try:
        for index, p in enumerate(selected, 1):
            label = label_of(p)
            print(f"[{index}/{len(selected)}] {label}")

            existing = manifest.get(label)
            if (
                not args.replace
                and isinstance(existing, dict)
                and existing.get("method") == "sony-store-product"
                and existing.get("src")
                and (ROOT / "public" / existing["src"].lstrip("/")).exists()
            ):
                print("  SKIP -> Sony Store image already exists")
                report["items"][label] = {"status": "skipped"}
                skipped += 1
                continue

            store_url = None if args.refresh_pages else map_lookup(store_map, p)

            if not store_url:
                urls = bing_store_search(browser, p)
                store_url = urls[0] if urls else None
                if store_url:
                    remember_store_page(store_map, p, store_url)
                    save_json(args.store_map, store_map)

            if not store_url:
                print("  FAIL -> Sony Store product page not found")
                report["items"][label] = {
                    "status": "failed",
                    "reason": "Sony Store product page not found",
                }
                failed += 1
                continue

            try:
                best = choose_product_image(browser, store_url, p)
                filename = stable_filename(p)
                output = IMAGE_DIR / filename
                size = save_webp(best["image"], output)

                src = "/" + str(output.relative_to(ROOT / "public")).replace(os.sep, "/")
                manifest[label] = {
                    "src": src,
                    "sourcePage": best["sourcePage"],
                    "sourceImage": best["url"],
                    "manufacturer": "Sony",
                    "modelCode": p.get("modelCode") or "",
                    "width": size[0],
                    "height": size[1],
                    "method": "sony-store-product",
                    "imageRole": "product-cut",
                    "fetchedAt": datetime.now(timezone.utc).isoformat(),
                    "usageReviewRequired": True,
                }
                save_json(args.manifest, manifest)

                report["items"][label] = {
                    "status": "ok",
                    "src": src,
                    "sourcePage": best["sourcePage"],
                    "sourceImage": best["url"],
                    "score": round(best["score"], 2),
                }
                print(f"  OK -> {src}")
                print(f"       Store: {best['sourcePage']}")
                ok += 1

            except Exception as e:
                report["items"][label] = {
                    "status": "failed",
                    "sourcePage": store_url,
                    "reason": f"{type(e).__name__}: {e}",
                }
                print(f"  FAIL -> {type(e).__name__}: {e}")
                failed += 1

            report["_meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
            save_json(args.report, report)

    finally:
        browser.close()

    report["_meta"].update({
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "skipped": skipped,
        "failed": failed,
    })
    save_json(args.report, report)
    save_json(args.store_map, store_map)

    print()
    print(f"DONE: ok={ok}, skipped={skipped}, failed={failed}")
    print("Manifest:", args.manifest)
    print("Store map:", args.store_map)
    print("Report:", args.report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
