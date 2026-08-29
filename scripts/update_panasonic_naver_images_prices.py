#!/usr/bin/env python3
"""
Matchcamera - Panasonic 네이버 브랜드스토어 가격 + 제품 이미지 수집기

사용자가 지정한 공식 Panasonic 네이버 브랜드스토어 카테고리:
https://brand.naver.com/panasonic/category/d1638682756a48b4a157b156ed0f2ca8?cp=1

동작
----
1) 카테고리 cp=1..N 순회
2) Panasonic 상품 카드 수집
3) 상세 페이지를 다시 열어 제품명 / 가격 / 대표 이미지 재확인
4) Matchcamera Panasonic 바디/렌즈와 안전하게 매칭
5) 가격 -> public/data/korea-prices.json
6) 이미지 -> public/assets/images/products/panasonic/*.webp
7) 이미지 매니페스트 -> public/data/product-images.json
8) 모든 추출 결과/실패/애매한 후보 -> public/data/panasonic-naver-extracted.json

원칙
----
- 공식 네이버 브랜드스토어 공개 페이지에 정상 접근하는 방식만 사용
- CAPTCHA/로그인/접근제어 우회 없음
- 할인 전 정상가/소비자가가 DOM에 보이면 그것을 우선
- 정상가가 없으면 공식몰 현재 표시 판매가를 저장하되 '가격 유형'에 구분
- 제품명 매칭이 애매하면 DB를 수정하지 않고 audit JSON에만 기록
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
from urllib.parse import urljoin, urlparse, parse_qs, urlencode, urlunparse

from PIL import Image, ImageOps

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None


ROOT = Path(__file__).resolve().parents[1]
PRODUCTS_PATH = ROOT / "public/data/products.json"
EXPANSION_PATH = ROOT / "public/data/system-expansion.json"
PARTNER_PATH = ROOT / "public/data/official-partner-products.json"
PRICE_PATH = ROOT / "public/data/korea-prices.json"
IMAGE_MANIFEST_PATH = ROOT / "public/data/product-images.json"
REPORT_PATH = ROOT / "public/data/panasonic-naver-extracted.json"

OUT_DIR = ROOT / "public/assets/images/products/panasonic"

CATEGORY_URL = "https://brand.naver.com/panasonic/category/d1638682756a48b4a157b156ed0f2ca8?cp={page}"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0 Safari/537.36"
)

PRICE_POLICY = (
    "한국 공식 제조사/공식 브랜드스토어 정상가·소비자가 우선. "
    "정상가가 노출되지 않으면 공식몰 현재 판매가를 구분하여 사용. "
    "병행수입·해외가격 제외."
)

BAD_WORDS = (
    "배터리", "충전기", "스트랩", "케이스", "가방", "필터", "후드",
    "마이크", "삼각대", "메모리", "sd카드", "리모컨", "어댑터",
    "렌탈", "대여", "중고", "리퍼", "refurb", "사은품", "패키지",
)

BAD_IMAGE_WORDS = (
    "logo", "icon", "sprite", "arrow", "banner", "event", "gift", "coupon",
    "button", "btn", "header", "footer", "loading", "quick", "review", "profile",
)

# Panasonic 한국/글로벌 제품코드가 네이버 상품명에 표시될 때 보강용.
ALIASES = {
    # Bodies
    "Panasonic LUMIX S1": ["S1", "DC-S1"],
    "Panasonic LUMIX S1R": ["S1R", "DC-S1R"],
    "Panasonic LUMIX S1H": ["S1H", "DC-S1H"],
    "Panasonic LUMIX S5": ["S5", "DC-S5"],
    "Panasonic LUMIX S5II": ["S5II", "S5M2", "DC-S5M2"],
    "Panasonic LUMIX S5IIX": ["S5IIX", "S5M2X", "DC-S5M2X"],
    "Panasonic LUMIX S9": ["S9", "DC-S9"],
    "Panasonic LUMIX S1RII": ["S1RII", "S1RM2", "DC-S1RM2"],
    "Panasonic LUMIX S1II": ["S1II", "S1M2", "DC-S1M2"],
    "Panasonic LUMIX S1IIE": ["S1IIE", "S1M2E", "DC-S1M2E"],
    "Panasonic LUMIX BS1H": ["BS1H", "DC-BS1H"],
    "Panasonic LUMIX G9II": ["G9II", "G9M2", "DC-G9M2"],
    "Panasonic LUMIX GH7": ["GH7", "DC-GH7"],
    "Panasonic LUMIX GH6": ["GH6", "DC-GH6"],
    "Panasonic LUMIX G100D": ["G100D", "DC-G100D"],
    "Panasonic LUMIX G100": ["G100", "DC-G100"],
    "Panasonic LUMIX BGH1": ["BGH1", "DC-BGH1"],

    # L-Mount lenses
    "Panasonic LUMIX S 14-28mm F4-5.6 MACRO": ["14-28", "S-R1428", "SR1428"],
    "Panasonic LUMIX S PRO 16-35mm F4": ["16-35", "S-R1635", "SR1635"],
    "Panasonic LUMIX S 18-40mm F4.5-6.3": ["18-40", "S-R1840", "SR1840"],
    "Panasonic LUMIX S 20-60mm F3.5-5.6": ["20-60", "S-R2060", "SR2060"],
    "Panasonic LUMIX S 24-60mm F2.8": ["24-60", "S-E2460", "SE2460"],
    "Panasonic LUMIX S PRO 24-70mm F2.8": ["24-70", "S-E2470", "SE2470"],
    "Panasonic LUMIX S 24-105mm F4 MACRO O.I.S.": ["24-105", "S-R24105", "SR24105"],
    "Panasonic LUMIX S PRO 70-200mm F2.8 O.I.S.": ["70-200", "F2.8", "S-E70200", "SE70200"],
    "Panasonic LUMIX S PRO 70-200mm F4 O.I.S.": ["70-200", "F4", "S-R70200", "SR70200"],
    "Panasonic LUMIX S 70-300mm F4.5-5.6 MACRO O.I.S.": ["70-300", "S-R70300", "SR70300"],
    "Panasonic LUMIX S 100-500mm F5-7.1 O.I.S.": ["100-500", "S-R100500", "SR100500"],
    "Panasonic LUMIX S 28-200mm F4-7.1 MACRO O.I.S.": ["28-200", "S-R28200", "SR28200"],
    "Panasonic LUMIX S 18mm F1.8": ["18mm", "F1.8", "S-S18", "SS18"],
    "Panasonic LUMIX S 24mm F1.8": ["24mm", "F1.8", "S-S24", "SS24"],
    "Panasonic LUMIX S 26mm F8": ["26mm", "F8", "S-R26", "SR26"],
    "Panasonic LUMIX S 35mm F1.8": ["35mm", "F1.8", "S-S35", "SS35"],
    "Panasonic LUMIX S 40mm F2": ["40mm", "F2", "S-R40", "SR40"],
    "Panasonic LUMIX S PRO 50mm F1.4": ["50mm", "F1.4", "S-X50", "SX50"],
    "Panasonic LUMIX S 50mm F1.8": ["50mm", "F1.8", "S-S50", "SS50"],
    "Panasonic LUMIX S 85mm F1.8": ["85mm", "F1.8", "S-S85", "SS85"],
    "Panasonic LUMIX S 100mm F2.8 MACRO": ["100mm", "F2.8", "S-E100", "SE100"],

    # Representative MFT codes
    "Panasonic LEICA DG SUMMILUX 9mm F1.7 ASPH.": ["9mm", "F1.7", "H-X09", "HX09"],
    "Panasonic LEICA DG VARIO-ELMARIT 8-18mm F2.8-4 ASPH.": ["8-18", "H-E08018", "HE08018"],
    "Panasonic LUMIX G VARIO 7-14mm F4 ASPH.": ["7-14", "H-F007014", "HF007014"],
    "Panasonic LEICA DG VARIO-SUMMILUX 10-25mm F1.7 ASPH.": ["10-25", "H-X1025", "HX1025"],
    "Panasonic LUMIX G X VARIO 12-35mm F2.8 POWER O.I.S.": ["12-35", "F2.8", "H-HSA12035", "HHSA12035"],
}


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback
    except Exception:
        return fallback


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def nfkc(v=""):
    return unicodedata.normalize("NFKC", str(v or ""))


def compact(v=""):
    s = nfkc(v).lower()
    replacements = {
        "파나소닉": "", "panasonic": "", "lumix": "", "루믹스": "",
        "leica": "", "라이카": "", "정품": "", "공식": "",
        "mark ii": "ii", "mark2": "ii",
        "ⅱ": "ii", "Ⅱ": "ii",
        "o.i.s.": "ois", "o.i.s": "ois",
    }
    for a, b in replacements.items():
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9가-힣]+", "", s)


def slug(v=""):
    s = unicodedata.normalize("NFKD", str(v or "panasonic"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:120] or "panasonic"


def label(p):
    return p.get("officialName") or p.get("model") or p.get("modelCode") or p.get("id") or ""


def merged_products():
    out, seen = [], set()
    for path in (PRODUCTS_PATH, EXPANSION_PATH, PARTNER_PATH):
        for p in load_json(path, []):
            key = p.get("id") or (p.get("manufacturer"), p.get("type"), label(p), p.get("mount"))
            if key in seen:
                continue
            seen.add(key)
            out.append(p)
    return out


def panasonic_products():
    return [
        p for p in merged_products()
        if str(p.get("manufacturer") or "").lower() == "panasonic"
        and p.get("type") in ("바디", "렌즈")
    ]


def get_query_page(url, page_no):
    parts = list(urlparse(url))
    q = parse_qs(parts[4])
    q["cp"] = [str(page_no)]
    parts[4] = urlencode(q, doseq=True)
    return urlunparse(parts)


class Browser:
    def __init__(self, visible=False):
        if sync_playwright is None:
            raise RuntimeError("playwright가 없습니다. requirements 파일을 설치하세요.")

        self.pw = sync_playwright().start()
        self.browser = None
        errors = []

        for channel in ("chrome", "msedge"):
            try:
                self.browser = self.pw.chromium.launch(
                    channel=channel,
                    headless=not visible,
                    args=[
                        "--no-first-run",
                        "--disable-dev-shm-usage",
                        "--disable-blink-features=AutomationControlled",
                    ],
                )
                break
            except Exception as e:
                errors.append(f"{channel}: {e}")

        if self.browser is None:
            try:
                self.browser = self.pw.chromium.launch(headless=not visible)
            except Exception as e:
                errors.append(f"chromium: {e}")
                self.pw.stop()
                raise RuntimeError("브라우저 실행 실패: " + " | ".join(errors[-3:]))

        self.ctx = self.browser.new_context(
            locale="ko-KR",
            user_agent=UA,
            viewport={"width": 1600, "height": 1200},
            device_scale_factor=2,
        )
        self.ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass
        try:
            self.browser.close()
        except Exception:
            pass
        try:
            self.pw.stop()
        except Exception:
            pass


def wait_and_scroll(page):
    page.wait_for_timeout(900)
    try:
        page.wait_for_load_state("networkidle", timeout=4000)
    except Exception:
        pass

    last = 0
    for _ in range(10):
        try:
            h = page.evaluate("document.body.scrollHeight")
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(350)
            if h == last:
                break
            last = h
        except Exception:
            break
    try:
        page.evaluate("window.scrollTo(0,0)")
    except Exception:
        pass


def category_cards(page):
    return page.evaluate(r"""() => {
      const normUrl = href => {
        try { return new URL(href, location.href).href; } catch { return ''; }
      };

      const candidates = [...document.querySelectorAll('a[href*="/products/"],a[href*="/product/"]')];
      const out = [];
      const seen = new Set();

      for (const a of candidates) {
        const href = normUrl(a.getAttribute('href') || a.href);
        if (!href) continue;
        if (!(href.includes('brand.naver.com/panasonic') || href.includes('smartstore.naver.com/panasonic'))) continue;
        if (!/\/products?\//.test(href)) continue;

        let card = a;
        let best = a;
        for (let i=0; i<6 && card; i++, card=card.parentElement) {
          const txt = (card.innerText || card.textContent || '').replace(/\s+/g,' ').trim();
          if (txt.length >= 15 && txt.length <= 800) best = card;
          if (card.tagName === 'LI') { best = card; break; }
        }

        const text = (best.innerText || best.textContent || '').replace(/\s+/g,' ').trim();
        const imgs = [...best.querySelectorAll('img')];
        const image = imgs.map(im => im.currentSrc || im.src || im.getAttribute('data-src') || '')
                          .find(Boolean) || '';
        const alt = imgs.map(im => im.alt || '').filter(Boolean).join(' ');

        let title = '';
        const titleEls = [...best.querySelectorAll('[title],[aria-label],strong,b,h3,h4')];
        const texts = [
          a.getAttribute('aria-label') || '',
          a.getAttribute('title') || '',
          a.innerText || '',
          alt,
          ...titleEls.map(x => x.getAttribute('title') || x.getAttribute('aria-label') || x.innerText || '')
        ].map(x => String(x||'').replace(/\s+/g,' ').trim()).filter(Boolean);

        title = texts.sort((x,y) => y.length-x.length)
                     .find(x => x.length >= 5 && x.length <= 220) || '';

        if (!seen.has(href)) {
          seen.add(href);
          out.push({href, title, text, image});
        }
      }
      return out;
    }""")


def parse_price_tokens(text):
    vals = []
    for m in re.finditer(r"(?<!\d)(\d{1,3}(?:,\d{3})+|\d{5,8})\s*원", str(text or "")):
        try:
            v = int(m.group(1).replace(",", ""))
            if 10000 <= v <= 50000000:
                vals.append(v)
        except Exception:
            pass
    return vals


def detail_metadata(page):
    return page.evaluate(r"""() => {
      const vals = [];
      const add = x => {
        if (x && String(x).trim()) vals.push(String(x).replace(/\s+/g,' ').trim());
      };

      add(document.querySelector('meta[property="og:title"]')?.content);
      add(document.querySelector('meta[name="twitter:title"]')?.content);
      add(document.title);
      for (const e of [...document.querySelectorAll('h1,h2,h3')].slice(0,20)) {
        add(e.innerText || e.textContent);
      }

      const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';
      const body = (document.body.innerText || '').replace(/\s+/g,' ').trim();

      const priceEls = [...document.querySelectorAll(
        'del,s,[class*="price"],[class*="Price"],[class*="discount"],[class*="sale"],[class*="cost"]'
      )].slice(0,120).map(e => ({
        tag: e.tagName,
        cls: String(e.className || ''),
        text: (e.innerText || e.textContent || '').replace(/\s+/g,' ').trim(),
        style: getComputedStyle(e).textDecorationLine || ''
      })).filter(x => x.text);

      const imgs = [...document.images].map((im,i) => {
        im.dataset.mcPanasonicNaver = String(i);
        const r = im.getBoundingClientRect();
        return {
          i,
          src: im.currentSrc || im.src || im.getAttribute('data-src') || '',
          alt: im.alt || '',
          nw: im.naturalWidth || 0,
          nh: im.naturalHeight || 0,
          rw: r.width,
          rh: r.height
        };
      });

      return {
        titles: [...new Set(vals)],
        ogImage,
        body: body.slice(0,15000),
        priceEls,
        imgs
      };
    }""")


def choose_price(meta):
    # 1) explicit line-through / 정상가 / 소비자가 / 정가
    normal = []
    current = []

    for e in meta.get("priceEls", []):
        txt = e.get("text", "")
        vals = parse_price_tokens(txt)
        if not vals:
            continue
        low = (txt + " " + e.get("cls","")).lower()
        if (
            e.get("tag") in ("DEL","S")
            or "line-through" in e.get("style","")
            or any(k in low for k in ("정상가","소비자가","정가","원가"))
        ):
            normal.extend(vals)
        elif any(k in low for k in ("판매가","할인가","최종","price","sale")):
            current.extend(vals)

    if normal:
        # 정상가가 여러 개면 제품가격 후보 중 큰 쪽이 일반적으로 원가/정상가.
        return max(normal), "네이버 브랜드스토어 정상가/소비자가"

    if current:
        return max(current[:6]), "네이버 브랜드스토어 현재 판매가"

    # 2) page text: front section only to avoid related products.
    vals = parse_price_tokens(meta.get("body","")[:5000])
    if vals:
        return max(vals[:8]), "네이버 브랜드스토어 현재 표시가"

    return None, "가격 미확인"


def model_tokens(p):
    name = label(p)
    toks = set()

    # Strong aliases
    for a in ALIASES.get(name, []):
        c = compact(a)
        if c:
            toks.add(c)

    # Name-derived meaningful tokens
    n = nfkc(name)
    for raw in re.findall(
        r"(?:S5IIX|S5II|S1RII|S1IIE|S1II|G9II|GH7|GH6|G100D|BS1H|BGH1|"
        r"\d{1,3}(?:-\d{1,3})?mm|F\d(?:\.\d)?(?:-\d(?:\.\d)?)?|PRO|MACRO)",
        n,
        flags=re.I
    ):
        c = compact(raw)
        if c:
            toks.add(c)

    mc = compact(p.get("modelCode") or "")
    if mc and len(mc) >= 4:
        toks.add(mc)

    return toks


def product_score(p, title):
    t = compact(title)
    if not t:
        return -1.0, []

    # Accessory/card rejection.
    low = nfkc(title).lower()
    if any(w in low for w in BAD_WORDS):
        return -1.0, []

    toks = model_tokens(p)
    if not toks:
        return -1.0, []

    hits = [x for x in toks if x in t]

    # Strong alias/model-code hit.
    strong = [compact(x) for x in ALIASES.get(label(p), []) if compact(x)]
    strong_hits = [x for x in strong if x in t]

    score = 0.0
    if strong_hits:
        score += 0.72

    # Focal/aperture/body token coverage.
    score += min(0.28, 0.06 * len(hits))

    # Exact normalized official name containment.
    off = compact(label(p))
    if off and (off in t or t in off):
        score += 0.35

    # Product type clues
    if p.get("type") == "렌즈":
        if "mm" in low or re.search(r"\bf\d", low):
            score += 0.05
    else:
        if any(k in t for k in ("dc", "body", "바디")):
            score += 0.04

    return min(score, 1.25), hits


def best_match(products, title):
    ranked = []
    for p in products:
        score, hits = product_score(p, title)
        if score > 0:
            ranked.append((score, p, hits))

    ranked.sort(key=lambda x: x[0], reverse=True)
    if not ranked:
        return None, 0.0, [], []

    top = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else 0.0
    margin = top[0] - second

    # Conservative acceptance.
    if top[0] < 0.76 or (second >= 0.70 and margin < 0.12):
        candidates = [
            {"name": label(x[1]), "mount": x[1].get("mount"), "score": round(x[0],3), "hits": x[2]}
            for x in ranked[:5]
        ]
        return None, top[0], top[2], candidates

    return top[1], top[0], top[2], [
        {"name": label(x[1]), "mount": x[1].get("mount"), "score": round(x[0],3), "hits": x[2]}
        for x in ranked[:5]
    ]


def direct_image(browser, src, referer, timeout):
    if not src or not src.startswith(("http://","https://")):
        return None
    try:
        r = browser.ctx.request.get(
            src,
            headers={"Referer": referer},
            timeout=timeout,
            fail_on_status_code=False,
        )
        if not r.ok:
            return None
        im = Image.open(io.BytesIO(r.body()))
        im = ImageOps.exif_transpose(im)
        im.load()
        if max(im.size) < 150:
            return None
        return im
    except Exception:
        return None


def image_candidates(meta, title):
    title_c = compact(title)
    out = []

    if meta.get("ogImage"):
        out.append({
            "src": meta["ogImage"], "i": None, "score": 1000, "alt": "og:image"
        })

    for im in meta.get("imgs", []):
        src = im.get("src") or ""
        alt = im.get("alt") or ""
        hay = (src + " " + alt).lower()
        score = 0

        if "shop-phinf.pstatic.net" in src or "shopping-phinf.pstatic.net" in src:
            score += 220

        if title_c and compact(alt) and (
            compact(alt) in title_c or title_c in compact(alt)
        ):
            score += 180

        m = max(im.get("nw",0), im.get("nh",0))
        if m >= 1200: score += 100
        elif m >= 700: score += 80
        elif m >= 350: score += 55
        elif m >= 180: score += 25
        else: score -= 100

        if im.get("rw",0) >= 180 and im.get("rh",0) >= 120:
            score += 35

        nw, nh = im.get("nw",0), im.get("nh",0)
        if nw and nh:
            ratio = max(nw,nh) / max(1,min(nw,nh))
            if ratio > 4.5:
                score -= 220
            elif ratio <= 2.2:
                score += 25

        for w in BAD_IMAGE_WORDS:
            if w in hay:
                score -= 260

        out.append({"src":src, "i":im.get("i"), "score":score, "alt":alt})

    return sorted(out, key=lambda x:x["score"], reverse=True)


def screenshot_img(page, idx):
    if idx is None:
        return None
    try:
        loc = page.locator(f'img[data-mc-panasonic-naver="{idx}"]').first
        if not loc.count():
            return None
        loc.scroll_into_view_if_needed(timeout=2500)
        data = loc.screenshot(type="png", timeout=5000)
        im = Image.open(io.BytesIO(data))
        im.load()
        return im
    except Exception:
        return None


def save_webp(im, p):
    out = OUT_DIR / f"{slug(p.get('id') or label(p))}.webp"
    out.parent.mkdir(parents=True, exist_ok=True)

    im = ImageOps.exif_transpose(im)
    im.thumbnail((900,900), Image.Resampling.LANCZOS)

    if im.mode not in ("RGB","RGBA"):
        im = im.convert("RGB")

    im.save(out, "WEBP", quality=87, method=6)
    src = "/" + str(out.relative_to(ROOT/"public")).replace(os.sep, "/")
    return src, im.size


def update_price_row(price_rows, p, price, price_type, source_url):
    if not price:
        return False

    name = label(p)
    mount = p.get("mount") or ""
    matches = [
        r for r in price_rows
        if r.get("정식 제품명") == name and (r.get("마운트") or "") == mount
    ]

    if not matches:
        same = [r for r in price_rows if r.get("정식 제품명") == name]
        if len(same) == 1:
            matches = same

    if not matches:
        return False

    r = matches[0]
    today = datetime.now().date().isoformat()

    r.update({
        "한국 가격 표시": f"{price:,}원",
        "한국 출고가/공식정가(원)": price,
        "한국 기준 가격(원)": price,
        "한국 공식/출시 가격(원)": price,
        "가격 유형": price_type,
        "가격 정책": PRICE_POLICY,
        "유통 형태": "국내 공식",
        "국내 유통 상태": "Panasonic 공식 네이버 브랜드스토어 확인",
        "가격 기준일": today,
        "가격 출처 사이트": "Panasonic Korea 네이버 브랜드스토어",
        "가격 출처 국가": "KR",
        "가격 출처 URL": source_url,
        "가격 검증 상태": "한국 공식 브랜드스토어 출처 확인",
        "비고": (
            "Panasonic 공식 네이버 브랜드스토어에서 자동 수집. "
            + (
                "할인 전 정상가/소비자가 우선."
                if "정상가" in price_type or "소비자가" in price_type
                else "정상가가 별도 노출되지 않아 공식몰 현재 표시 가격으로 기록."
            )
        ),
    })
    return True


def scrape_detail(browser, url, fallback_title, timeout):
    page = browser.ctx.new_page()
    page.set_default_timeout(timeout)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        wait_and_scroll(page)

        meta = detail_metadata(page)

        # Best title
        titles = [x for x in meta.get("titles", []) if 5 <= len(x) <= 250]
        title = titles[0] if titles else fallback_title

        price, price_type = choose_price(meta)

        image = None
        source_image = ""
        extract_method = ""

        for c in image_candidates(meta, title)[:15]:
            if c["score"] < -50:
                continue

            image = direct_image(browser, c["src"], page.url, timeout)
            extract_method = "direct-image"

            if image is None:
                image = screenshot_img(page, c["i"])
                extract_method = "element-screenshot"

            if image is None:
                continue

            if max(image.size) < 150:
                image = None
                continue

            ratio = max(image.size) / max(1, min(image.size))
            if ratio > 5:
                image = None
                continue

            source_image = c["src"]
            break

        return {
            "title": title,
            "allTitles": titles[:10],
            "price": price,
            "priceType": price_type,
            "image": image,
            "sourceImage": source_image,
            "extractMethod": extract_method,
            "sourcePage": page.url,
        }

    finally:
        page.close()


def crawl_category(browser, start_page, max_pages, timeout):
    products = []
    seen_urls = set()
    empty_streak = 0

    page = browser.ctx.new_page()
    page.set_default_timeout(timeout)

    try:
        for cp in range(start_page, max_pages + 1):
            url = CATEGORY_URL.format(page=cp)
            print(f"[CATEGORY {cp}] {url}")

            try:
                page.goto(url, wait_until="domcontentloaded", timeout=timeout)
                wait_and_scroll(page)
            except Exception as e:
                print("  WARN ->", type(e).__name__, e)
                empty_streak += 1
                if empty_streak >= 2:
                    break
                continue

            cards = category_cards(page)
            new = [x for x in cards if x["href"] not in seen_urls]

            print(f"  cards={len(cards)}, new={len(new)}")

            if not new:
                empty_streak += 1
                if empty_streak >= 2:
                    break
            else:
                empty_streak = 0

            for x in new:
                seen_urls.add(x["href"])
                x["categoryPage"] = cp
                products.append(x)

    finally:
        page.close()

    return products


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start-page", type=int, default=1)
    ap.add_argument("--max-pages", type=int, default=20)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--match", default="", help="네이버 상품명 또는 Matchcamera 제품명 일부")
    ap.add_argument("--visible", action="store_true")
    ap.add_argument("--replace-images", action="store_true")
    ap.add_argument("--timeout", type=int, default=25000)
    ap.add_argument("--delay", type=float, default=.65)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db_products = panasonic_products()
    prices = load_json(PRICE_PATH, [])
    manifest = load_json(IMAGE_MANIFEST_PATH, {})
    if not isinstance(manifest, dict):
        manifest = {}

    report = {
        "_meta": {
            "source": CATEGORY_URL.format(page=1),
            "startedAt": datetime.now(timezone.utc).isoformat(),
            "dbPanasonicProducts": len(db_products),
        },
        "items": []
    }

    browser = Browser(visible=args.visible)

    try:
        cards = crawl_category(browser, args.start_page, args.max_pages, args.timeout)

        if args.match:
            q = compact(args.match)
            cards = [
                x for x in cards
                if q in compact(x.get("title","") + " " + x.get("text",""))
            ]

        if args.limit:
            cards = cards[:args.limit]

        print(f"\nSelected category products: {len(cards)}")

        matched_ok = price_ok = image_ok = failed = ambiguous = 0

        for idx, card in enumerate(cards, 1):
            print(f"\n[{idx}/{len(cards)}] CARD | {card.get('title') or card.get('text','')[:120]}")
            print("  URL ->", card["href"])

            try:
                got = scrape_detail(browser, card["href"], card.get("title",""), args.timeout)
                title = got["title"] or card.get("title") or card.get("text","")

                p, score, hits, candidates = best_match(db_products, title)

                entry = {
                    "status": "extracted",
                    "naverTitle": title,
                    "sourcePage": got["sourcePage"],
                    "sourceImage": got["sourceImage"],
                    "price": got["price"],
                    "priceType": got["priceType"],
                    "matchScore": round(score, 3),
                    "matchHits": hits,
                    "matchCandidates": candidates,
                    "categoryPage": card.get("categoryPage"),
                }

                if p is None:
                    print("  AMBIGUOUS/UNMATCHED ->", title)
                    print("  candidates ->", candidates[:3])
                    entry["status"] = "ambiguous"
                    ambiguous += 1
                    report["items"].append(entry)
                    continue

                entry["matchedProduct"] = label(p)
                entry["matchedMount"] = p.get("mount")
                matched_ok += 1

                print(f"  MATCH -> {label(p)} | score={score:.3f} | hits={hits}")

                price_updated = update_price_row(
                    prices, p, got["price"], got["priceType"], got["sourcePage"]
                )
                if price_updated:
                    price_ok += 1
                    print(f"  PRICE -> {got['price']:,}원 ({got['priceType']})")
                elif got["price"]:
                    print("  PRICE FOUND but price row not matched ->", got["price"])

                image_updated = False
                if got["image"] is not None:
                    old = manifest.get(label(p))
                    if args.replace_images or not old or not old.get("src"):
                        img_src, (w,h) = save_webp(got["image"], p)
                        manifest[label(p)] = {
                            "src": img_src,
                            "sourcePage": got["sourcePage"],
                            "sourceImage": got["sourceImage"],
                            "manufacturer": "Panasonic",
                            "width": w,
                            "height": h,
                            "method": "panasonic-naver-brandstore",
                            "extractMethod": got["extractMethod"],
                            "fetchedAt": datetime.now(timezone.utc).isoformat(),
                            "usageReviewRequired": True,
                        }
                        image_updated = True
                        image_ok += 1
                        print("  IMAGE ->", img_src)

                entry["status"] = "ok"
                entry["priceUpdated"] = price_updated
                entry["imageUpdated"] = image_updated
                report["items"].append(entry)

                save_json(PRICE_PATH, prices)
                save_json(IMAGE_MANIFEST_PATH, manifest)
                report["_meta"].update({
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "matched": matched_ok,
                    "priceUpdated": price_ok,
                    "imageUpdated": image_ok,
                    "ambiguous": ambiguous,
                    "failed": failed,
                })
                save_json(REPORT_PATH, report)

            except Exception as e:
                print("  FAIL ->", type(e).__name__, e)
                failed += 1
                report["items"].append({
                    "status": "failed",
                    "sourcePage": card.get("href"),
                    "cardTitle": card.get("title"),
                    "reason": f"{type(e).__name__}: {e}",
                })

            time.sleep(max(0, args.delay) + random.uniform(0,.2))

        report["_meta"].update({
            "finishedAt": datetime.now(timezone.utc).isoformat(),
            "categoryProducts": len(cards),
            "matched": matched_ok,
            "priceUpdated": price_ok,
            "imageUpdated": image_ok,
            "ambiguous": ambiguous,
            "failed": failed,
        })

        save_json(PRICE_PATH, prices)
        save_json(IMAGE_MANIFEST_PATH, manifest)
        save_json(REPORT_PATH, report)

        print("\n===============================================")
        print("PANASONIC NAVER BRANDSTORE DONE")
        print("category products :", len(cards))
        print("matched           :", matched_ok)
        print("price updated     :", price_ok)
        print("image updated     :", image_ok)
        print("ambiguous         :", ambiguous)
        print("failed            :", failed)
        print("prices            :", PRICE_PATH)
        print("images            :", IMAGE_MANIFEST_PATH)
        print("report            :", REPORT_PATH)
        print("===============================================")

    finally:
        browser.close()


if __name__ == "__main__":
    main()
