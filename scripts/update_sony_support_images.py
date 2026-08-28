#!/usr/bin/env python3
"""
Matchcamera - Sony 공식 호환성 사이트 제품 이미지 자동 수집기

대상
----
- Sony 바디
- Sony 렌즈
- Sony 배터리

공식 소스
---------
https://support.d-imaging.sony.co.jp/www/cscs/accessories/?area=ap&lang=ko&mdl=<MODEL_CODE>

예:
- ILCE-7M4
- SEL2470GM2
- NP-FZ100

동작
----
1. Matchcamera 제품/배터리 DB의 Sony 모델 코드를 읽음
2. Sony 공식 호환성 사이트의 해당 모델 페이지를 Playwright로 렌더링
3. 페이지의 이미지 후보 중 모델 코드/주변 텍스트/크기 기준으로 제품 이미지를 선택
4. 가능하면 브라우저 세션으로 원본 이미지 bytes를 가져오고,
   실패하면 실제 표시된 img 요소를 고해상도 스크린샷
5. WebP로 변환
6. 바디/렌즈 -> public/data/product-images.json 갱신
7. 배터리 -> public/data/batteries.json 의 imageSrc 갱신
8. report JSON 작성

공개 페이지에 정상적으로 접근하는 방식만 사용하며 로그인/CAPTCHA/접근제어를 우회하지 않습니다.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import random
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageOps

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_PATH = ROOT / "public/data/products.json"
EXPANSION_PATH = ROOT / "public/data/system-expansion.json"
PRODUCT_IMAGE_MANIFEST = ROOT / "public/data/product-images.json"
BATTERIES_PATH = ROOT / "public/data/batteries.json"
REPORT_PATH = ROOT / "public/data/sony-support-images-report.json"

PRODUCT_DIR = ROOT / "public/assets/images/products/sony"
BATTERY_DIR = ROOT / "public/assets/images/accessories/batteries/sony"

BASE = "https://support.d-imaging.sony.co.jp/www/cscs/accessories/"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0 Safari/537.36"
)

REJECT_WORDS = (
    "logo", "global", "icon", "ico", "sprite", "arrow", "close", "open",
    "compatible", "compatibility", "restriction", "status", "cookie",
    "language", "flag", "header", "footer", "blank", "spacer", "loading",
    "sony_logo", "btn_", "mark_", "qr", "common/img",
)


def load_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def norm(v=""):
    s = unicodedata.normalize("NFKC", str(v or "")).lower().replace("α", "a")
    s = re.sub(r"[^a-z0-9가-힣]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def compact(v=""):
    return re.sub(r"[^a-z0-9]+", "", unicodedata.normalize("NFKC", str(v or "")).lower().replace("α", "a"))


def slug(v="", fallback="sony"):
    s = unicodedata.normalize("NFKD", str(v or "")).replace("α", "a")
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:110] or fallback


def product_label(p):
    return p.get("officialName") or p.get("model") or p.get("modelCode") or p.get("id") or "Sony"


def merge_products():
    base = load_json(PRODUCTS_PATH, [])
    exp = load_json(EXPANSION_PATH, [])
    out = []
    seen = set()
    for p in [*(base if isinstance(base, list) else []), *(exp if isinstance(exp, list) else [])]:
        key = p.get("id") or (p.get("manufacturer"), p.get("type"), p.get("officialName"), p.get("modelCode"))
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


MODEL_PATTERNS = [
    r"\bILCE-[A-Z0-9]+\b",
    r"\bILCA-[A-Z0-9]+\b",
    r"\bILME-[A-Z0-9]+\b",
    r"\bPXW-[A-Z0-9]+\b",
    r"\bMPC-[A-Z0-9]+\b",
    r"\bNEX-[A-Z0-9]+\b",
    r"\bZV-[A-Z0-9]+\b",
    r"\bSLT-[A-Z0-9]+\b",
    r"\bDSLR-[A-Z0-9]+\b",
    r"\bSEL[A-Z0-9]+\b",
    r"\bSAL[A-Z0-9]+\b",
    r"\bNP-[A-Z0-9]+\b",
]


def model_candidates(item, kind):
    raw = " ".join([
        str(item.get("modelCode") or ""),
        str(item.get("model") or ""),
        str(item.get("officialName") or ""),
        str(item.get("series") or ""),
    ]).upper()

    found = []
    for pat in MODEL_PATTERNS:
        for m in re.findall(pat, raw, flags=re.I):
            v = m.upper()
            if v not in found:
                found.append(v)

    # modelCode가 "NEX-3 / NEX-3C" 같은 경우 각각 시도
    for part in re.split(r"[/,;|]+", str(item.get("modelCode") or "")):
        v = part.strip().upper()
        v = re.sub(r"\s*\[[^\]]+\]\s*$", "", v).strip()
        if re.fullmatch(r"[A-Z0-9][A-Z0-9-]{2,}", v) and v not in found:
            found.append(v)

    if kind == "battery":
        name = str(item.get("officialName") or "").upper().strip()
        if re.fullmatch(r"NP-[A-Z0-9-]+", name) and name not in found:
            found.insert(0, name)

    # 렌즈는 SEL/SAL을, 배터리는 NP-를 먼저
    prefix_order = {
        "lens": ("SEL", "SAL"),
        "battery": ("NP-",),
        "body": ("ILCE-", "ILCA-", "ILME-", "PXW-", "MPC-", "NEX-", "ZV-", "SLT-", "DSLR-"),
    }[kind]

    return sorted(found, key=lambda x: (0 if x.startswith(prefix_order) else 1, found.index(x)))


def source_page(code):
    return f"{BASE}?area=ap&lang=ko&mdl={quote(code)}"


class Browser:
    def __init__(self, visible=False):
        if sync_playwright is None:
            raise RuntimeError("playwright가 없습니다. requirements 파일을 설치하세요.")
        self.runtime = sync_playwright().start()
        self.browser = None
        errors = []
        for channel in ("chrome", "msedge"):
            try:
                self.browser = self.runtime.chromium.launch(
                    channel=channel,
                    headless=not visible,
                    args=["--no-first-run", "--disable-dev-shm-usage"],
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
            user_agent=UA,
            viewport={"width": 1600, "height": 1200},
            device_scale_factor=2,
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


def collect_candidates(page, code, label):
    code_c = compact(code)
    label_tokens = [compact(x) for x in re.split(r"\s+", label) if len(compact(x)) >= 3]
    result = page.evaluate(
        """({codeCompact, labelTokens, rejectWords}) => {
          const compact = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g,'');
          const imgs = [...document.querySelectorAll('img')];
          return imgs.map((el, index) => {
            el.dataset.mcSonyCandidate = String(index);
            const r = el.getBoundingClientRect();
            let parent = el;
            let nearby = '';
            for(let i=0;i<4 && parent;i++,parent=parent.parentElement){
              nearby += ' ' + (parent.innerText || parent.textContent || '').slice(0,800);
            }
            const src = el.currentSrc || el.src || el.getAttribute('data-src') || '';
            const alt = el.alt || '';
            const title = el.title || '';
            const klass = String(el.className || '');
            const id = el.id || '';
            const hay = `${src} ${alt} ${title} ${klass} ${id} ${nearby}`.toLowerCase();

            let score = 0;
            if(codeCompact && compact(src).includes(codeCompact)) score += 500;
            if(codeCompact && compact(alt).includes(codeCompact)) score += 420;
            if(codeCompact && compact(title).includes(codeCompact)) score += 350;
            if(codeCompact && compact(nearby).includes(codeCompact)) score += 260;

            for(const t of labelTokens){
              if(t && compact(nearby).includes(t)) score += 22;
              if(t && compact(alt).includes(t)) score += 35;
            }

            const nw = el.naturalWidth || 0, nh = el.naturalHeight || 0;
            const maxDim = Math.max(nw, nh);
            const minDim = Math.min(nw || 9999, nh || 9999);
            if(maxDim >= 1000) score += 85;
            else if(maxDim >= 600) score += 65;
            else if(maxDim >= 300) score += 45;
            else if(maxDim >= 140) score += 20;
            else score -= 80;

            if(r.width >= 100 && r.height >= 70) score += 30;
            if(r.width >= 180 && r.height >= 120) score += 25;
            if(r.width <= 5 || r.height <= 5) score -= 300;

            if(nw && nh){
              const ratio = Math.max(nw,nh) / Math.max(1,Math.min(nw,nh));
              if(ratio > 4) score -= 180;
              else if(ratio <= 2) score += 25;
            }

            for(const word of rejectWords){
              if(hay.includes(word)) score -= 280;
            }

            return {index, src, alt, title, nearby: nearby.slice(0,1000),
                    nw, nh, rw:r.width, rh:r.height, score};
          }).sort((a,b)=>b.score-a.score);
        }""",
        {"codeCompact": code_c, "labelTokens": label_tokens, "rejectWords": list(REJECT_WORDS)},
    )
    return result or []


def page_looks_right(page, code):
    code_c = compact(code)
    try:
        title = page.title()
    except Exception:
        title = ""
    try:
        text = page.locator("body").inner_text(timeout=3000)[:30000]
    except Exception:
        text = ""
    return code_c in compact(title + " " + text)


def image_from_direct_bytes(browser, src, referer, timeout_ms=18000):
    if not src or not src.startswith(("http://", "https://")):
        return None, None
    try:
        res = browser.context.request.get(
            src,
            headers={"Referer": referer},
            timeout=timeout_ms,
            fail_on_status_code=False,
        )
        if not res.ok:
            return None, None
        data = res.body()
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        im.load()
        if max(im.size) < 120:
            return None, None
        return im, src
    except Exception:
        return None, None


def image_from_element_screenshot(page, index):
    try:
        loc = page.locator(f'img[data-mc-sony-candidate="{index}"]').first
        if not loc.count():
            return None
        loc.scroll_into_view_if_needed(timeout=3000)
        page.wait_for_timeout(150)
        data = loc.screenshot(type="png", timeout=6000)
        im = Image.open(io.BytesIO(data))
        im.load()
        if max(im.size) < 100:
            return None
        return im
    except Exception:
        return None


def save_webp(im, out: Path, max_side=900, quality=86):
    im = ImageOps.exif_transpose(im)
    if max(im.size) < 120:
        raise ValueError(f"이미지가 너무 작음: {im.size}")
    ratio = max(im.size) / max(1, min(im.size))
    if ratio > 5:
        raise ValueError(f"제품컷으로 보기 어려운 종횡비: {im.size}")

    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    if im.mode not in ("RGB", "RGBA"):
        if "transparency" in im.info:
            im = im.convert("RGBA")
        else:
            im = im.convert("RGB")
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "WEBP", quality=quality, method=6)
    return im.size


def extract_one(browser, item, kind, code, timeout_ms):
    url = source_page(code)
    page = browser.context.new_page()
    page.set_default_timeout(timeout_ms)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        page.wait_for_timeout(1300)
        try:
            page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass

        if not page_looks_right(page, code):
            raise RuntimeError(f"페이지에서 모델 코드 {code}를 확인하지 못함")

        candidates = collect_candidates(page, code, product_label(item))
        usable = [c for c in candidates if c["score"] > -120]
        if not usable:
            raise RuntimeError("제품 이미지 후보 없음")

        errors = []
        for c in usable[:12]:
            try:
                im, direct_url = image_from_direct_bytes(browser, c.get("src"), page.url, timeout_ms)
                method = "direct-image"
                if im is None:
                    im = image_from_element_screenshot(page, c["index"])
                    method = "element-screenshot"
                if im is None:
                    continue

                # 너무 작은 아이콘/상태 이미지 추가 차단
                if max(im.size) < 120:
                    continue
                ratio = max(im.size) / max(1, min(im.size))
                if ratio > 5:
                    continue

                return {
                    "image": im,
                    "sourcePage": page.url,
                    "sourceImage": direct_url or c.get("src") or "",
                    "extractMethod": method,
                    "candidateScore": c["score"],
                    "candidateAlt": c.get("alt") or "",
                }
            except Exception as e:
                errors.append(f"{type(e).__name__}: {e}")

        raise RuntimeError(errors[-1] if errors else "사용 가능한 제품 이미지 없음")
    finally:
        page.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", choices=["all", "body", "lens", "battery"], default="all")
    ap.add_argument("--match", default="", help="제품명/모델코드/id 일부 일치")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--replace", action="store_true", help="기존 Sony 이미지도 Sony 지원 사이트 이미지로 교체")
    ap.add_argument("--visible", action="store_true", help="Chrome/Edge 창을 보이게 실행")
    ap.add_argument("--timeout", type=int, default=20000)
    ap.add_argument("--delay", type=float, default=0.7, help="제품 간 요청 간격(초)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    products = merge_products()
    batteries = load_json(BATTERIES_PATH, [])
    manifest = load_json(PRODUCT_IMAGE_MANIFEST, {})
    if not isinstance(manifest, dict):
        manifest = {}
    if not isinstance(batteries, list):
        batteries = []

    items = []
    if args.kind in ("all", "body", "lens"):
        for p in products:
            if str(p.get("manufacturer") or "").lower() != "sony":
                continue
            if p.get("type") not in ("바디", "렌즈"):
                continue
            kind = "body" if p.get("type") == "바디" else "lens"
            if args.kind not in ("all", kind):
                continue
            items.append((kind, p))

    if args.kind in ("all", "battery"):
        for b in batteries:
            if str(b.get("manufacturer") or "").lower() == "sony":
                items.append(("battery", b))

    if args.match:
        q = compact(args.match)
        items = [
            (k, i) for k, i in items
            if q in compact(" ".join(str(i.get(x) or "") for x in ("officialName", "model", "modelCode", "id", "series")))
        ]

    if args.limit:
        items = items[:args.limit]

    print(f"Selected: {len(items)}")
    if args.dry_run:
        for kind, item in items:
            print(kind, "|", product_label(item), "|", model_candidates(item, kind))
        return 0

    report = load_json(REPORT_PATH, {"items": {}})
    if not isinstance(report, dict):
        report = {"items": {}}
    report.setdefault("items", {})

    browser = Browser(visible=args.visible)
    ok = skipped = failed = 0

    try:
        for idx, (kind, item) in enumerate(items, 1):
            label = product_label(item)
            codes = model_candidates(item, kind)
            print(f"[{idx}/{len(items)}] {kind.upper()} | {label}")
            print("  codes:", ", ".join(codes) if codes else "(없음)")

            if not codes:
                print("  FAIL -> Sony 지원 사이트 모델 코드를 결정할 수 없음")
                report["items"][f"{kind}:{label}"] = {
                    "status": "failed",
                    "reason": "no model code",
                }
                failed += 1
                continue

            if kind in ("body", "lens"):
                old = manifest.get(label)
                if (
                    not args.replace
                    and isinstance(old, dict)
                    and old.get("method") == "sony-support-d-imaging"
                    and old.get("src")
                    and (ROOT / "public" / old["src"].lstrip("/")).exists()
                ):
                    print("  SKIP -> Sony 지원 사이트 이미지 이미 있음")
                    skipped += 1
                    continue
            else:
                if (
                    not args.replace
                    and item.get("imageMethod") == "sony-support-d-imaging"
                    and item.get("imageSrc")
                    and (ROOT / "public" / item["imageSrc"].lstrip("/")).exists()
                ):
                    print("  SKIP -> Sony 지원 사이트 이미지 이미 있음")
                    skipped += 1
                    continue

            best = None
            last_error = None
            used_code = None
            for code in codes:
                try:
                    best = extract_one(browser, item, kind, code, args.timeout)
                    used_code = code
                    break
                except Exception as e:
                    last_error = e
                    print(f"  {code}: {type(e).__name__}: {e}")

            if best is None:
                print(f"  FAIL -> {type(last_error).__name__ if last_error else 'Error'}: {last_error}")
                report["items"][f"{kind}:{label}"] = {
                    "status": "failed",
                    "codes": codes,
                    "reason": str(last_error or "unknown"),
                }
                failed += 1
                time.sleep(max(0, args.delay))
                continue

            if kind in ("body", "lens"):
                out = PRODUCT_DIR / f"{slug(item.get('id') or used_code or label)}.webp"
            else:
                out = BATTERY_DIR / f"{slug(item.get('id') or used_code or label)}.webp"

            try:
                w, h = save_webp(best["image"], out)
            except Exception as e:
                print(f"  FAIL -> 저장 오류: {e}")
                failed += 1
                continue

            src = "/" + str(out.relative_to(ROOT / "public")).replace(os.sep, "/")
            now = datetime.now(timezone.utc).isoformat()

            if kind in ("body", "lens"):
                manifest[label] = {
                    "src": src,
                    "sourcePage": best["sourcePage"],
                    "sourceImage": best["sourceImage"],
                    "manufacturer": "Sony",
                    "modelCode": used_code,
                    "width": w,
                    "height": h,
                    "method": "sony-support-d-imaging",
                    "extractMethod": best["extractMethod"],
                    "fetchedAt": now,
                    "usageReviewRequired": True,
                }
                save_json(PRODUCT_IMAGE_MANIFEST, manifest)
            else:
                # 실제 batteries 리스트의 같은 id 항목 갱신
                target_id = item.get("id")
                for b in batteries:
                    if b.get("id") == target_id:
                        b.update({
                            "imageSrc": src,
                            "imageSourcePage": best["sourcePage"],
                            "imageSourceUrl": best["sourceImage"],
                            "imageMethod": "sony-support-d-imaging",
                            "imageModelCode": used_code,
                            "imageWidth": w,
                            "imageHeight": h,
                            "imageFetchedAt": now,
                            "imageUsageReviewRequired": True,
                        })
                        break
                save_json(BATTERIES_PATH, batteries)

            report["items"][f"{kind}:{label}"] = {
                "status": "ok",
                "kind": kind,
                "modelCode": used_code,
                "src": src,
                "sourcePage": best["sourcePage"],
                "sourceImage": best["sourceImage"],
                "extractMethod": best["extractMethod"],
                "candidateScore": best["candidateScore"],
                "width": w,
                "height": h,
            }
            print(f"  OK -> {src}")
            print(f"       {best['sourcePage']}")
            ok += 1
            report["_meta"] = {
                "updatedAt": datetime.now(timezone.utc).isoformat(),
                "ok": ok,
                "skipped": skipped,
                "failed": failed,
                "selected": len(items),
            }
            save_json(REPORT_PATH, report)

            time.sleep(max(0, args.delay) + random.uniform(0, 0.25))

    finally:
        browser.close()

    report["_meta"] = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "skipped": skipped,
        "failed": failed,
        "selected": len(items),
    }
    save_json(REPORT_PATH, report)
    save_json(PRODUCT_IMAGE_MANIFEST, manifest)
    save_json(BATTERIES_PATH, batteries)

    print()
    print(f"DONE: ok={ok}, skipped={skipped}, failed={failed}")
    print("Product manifest:", PRODUCT_IMAGE_MANIFEST)
    print("Batteries:", BATTERIES_PATH)
    print("Report:", REPORT_PATH)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
