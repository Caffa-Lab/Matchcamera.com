#!/usr/bin/env python3
"""
Matchcamera 제품 이미지 자동 수집기

원칙
- products.json의 모든 제품을 순회합니다.
- 제조사 공식 도메인의 공개 제품 페이지를 우선합니다.
- 로그인/캡차/접근제어를 우회하지 않습니다.
- 페이지의 og:image / twitter:image / JSON-LD / 제품 이미지 후보를 추출합니다.
- 이미지를 WebP로 리사이즈/압축하여 public/assets/images/products에 저장합니다.
- product-images.json에 로컬 경로와 원본 출처를 기록합니다.
- 이미 성공한 항목은 기본적으로 건너뛰므로 재실행/중단 후 재개가 가능합니다.

공식 사이트가 자동 요청을 막거나 구형 제품 페이지가 사라진 경우에는
report 파일에 실패 사유가 남습니다.
"""
from __future__ import annotations

import argparse
import html
import io
import json
import os
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import parse_qs, quote_plus, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from PIL import Image, ImageOps

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PRODUCTS = ROOT / "public/data/products.json"
DEFAULT_MANIFEST = ROOT / "public/data/product-images.json"
DEFAULT_REPORT = ROOT / "public/data/product-images-report.json"
DEFAULT_IMAGE_DIR = ROOT / "public/assets/images/products"

USER_AGENT = (
    "MatchcameraImageIndexer/1.1 "
    "(https://matchcamera.com/; contact via website) "
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
)

OFFICIAL_DOMAINS = {
    "Sony": [
        "sony.com", "electronics.sony.com", "sony.co.kr",
    ],
    "Canon": [
        "canon.com", "canon-europe.com", "usa.canon.com", "kr.canon",
    ],
    "Nikon": [
        "nikon.com", "imaging.nikon.com", "nikonusa.com", "nikon.co.kr",
    ],
    "Fujifilm": [
        "fujifilm-x.com", "fujifilm.com", "fujifilm-korea.co.kr",
    ],
    "Panasonic": [
        "panasonic.com", "panasonic.jp",
    ],
    "OM SYSTEM": [
        "omsystem.com", "explore.omsystem.com",
    ],
    "Olympus": [
        "olympus-imaging.com", "olympus-global.com",
    ],
    "Leica": [
        "leica-camera.com",
    ],
    "Pentax": [
        "ricoh-imaging.co.jp", "ricoh-imaging.com", "us.ricoh-imaging.com",
    ],
    "Sigma": [
        "sigma-global.com",
    ],
    "Tamron": [
        "tamron.com", "tamron.jp",
    ],
}

SEARCH_ENDPOINTS = [
    "https://html.duckduckgo.com/html/?q={query}",
    "https://www.bing.com/search?q={query}&count=10",
]

# Sony/Canon은 일반 제품 페이지 requests 접근에서 403이 자주 발생하므로
# 검색엔진에 이미 색인된 '공식 페이지 소속 이미지'를 먼저 탐색합니다.
BING_IMAGE_SEARCH = "https://www.bing.com/images/search?q={query}&form=HDRSC2&first=1"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
IMAGE_SEARCH_FIRST = {"Sony", "Canon"}

# 같은 호스트에서 403이 반복되면 해당 실행 동안 직접 접근을 중단합니다.
HOST_403_LIMIT = 2
blocked_hosts: set[str] = set()
host_403_counts: dict[str, int] = {}

BAD_IMAGE_WORDS = {
    "logo", "icon", "favicon", "sprite", "banner", "badge", "avatar",
    "social", "share", "footer", "header", "spinner", "loading",
}

session = requests.Session()
session.headers.update({
    "User-Agent": USER_AGENT,
    "From": "https://matchcamera.com/",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
})


@dataclass
class CandidatePage:
    url: str
    score: float
    title: str = ""


@dataclass
class CandidateImage:
    url: str
    score: float
    source: str = ""


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    s = s.replace("α", "a")
    s = re.sub(r"[^a-z0-9가-힣]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def compact(s: str | None) -> str:
    return norm(s).replace(" ", "")


def slug(s: str | None, fallback="product") -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.replace("α", "a").replace("Α", "a")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s[:100] or fallback


def host_allowed(url: str, domains: Iterable[str]) -> bool:
    try:
        host = urlparse(url).hostname or ""
    except Exception:
        return False
    host = host.lower().lstrip("www.")
    return any(host == d or host.endswith("." + d) for d in domains)


def all_urls(obj) -> list[str]:
    out: list[str] = []
    if isinstance(obj, dict):
        for v in obj.values():
            out.extend(all_urls(v))
    elif isinstance(obj, list):
        for v in obj:
            out.extend(all_urls(v))
    elif isinstance(obj, str) and obj.startswith(("http://", "https://")):
        out.append(obj)
    return out


def product_tokens(p: dict) -> set[str]:
    values = [
        p.get("officialName"), p.get("model"), p.get("modelCode"),
        p.get("series"), p.get("focalLength"), p.get("maxAperture"),
    ]
    toks: set[str] = set()
    for value in values:
        for token in norm(value).split():
            if len(token) >= 2:
                toks.add(token)
    return toks


def page_relevance(url: str, title: str, p: dict) -> float:
    hay = norm(url + " " + title)
    hay_compact = compact(url + " " + title)
    label = norm(p.get("officialName") or p.get("model") or "")
    model = norm(p.get("modelCode") or "")
    score = 0.0

    if label and label in hay:
        score += 90
    if compact(label) and compact(label) in hay_compact:
        score += 70
    if model and model in hay:
        score += 110
    if compact(model) and compact(model) in hay_compact:
        score += 90

    toks = product_tokens(p)
    score += sum(6 for t in toks if t in hay)
    return score


def clean_search_result_url(href: str) -> str:
    href = html.unescape(href or "")
    if href.startswith("//"):
        href = "https:" + href

    # DuckDuckGo redirect: /l/?uddg=<encoded url>
    parsed = urlparse(href)
    qs = parse_qs(parsed.query)
    if "uddg" in qs:
        return unquote(qs["uddg"][0])
    if "url" in qs and parsed.netloc.endswith("bing.com"):
        maybe = qs["url"][0]
        if maybe.startswith("http"):
            return maybe
    return href


def search_official_pages(p: dict, domains: list[str], timeout: float) -> list[CandidatePage]:
    label = p.get("officialName") or p.get("model") or ""
    model = p.get("modelCode") or ""
    manufacturer = p.get("manufacturer") or ""

    domain_expr = " OR ".join(f"site:{d}" for d in domains[:4])
    quoted = f'"{model}"' if model else f'"{label}"'
    query = f"({domain_expr}) {quoted} {manufacturer} {label}".strip()

    found: dict[str, CandidatePage] = {}
    for endpoint in SEARCH_ENDPOINTS:
        try:
            url = endpoint.format(query=quote_plus(query))
            r = session.get(url, timeout=timeout)
            if r.status_code != 200:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a", href=True):
                href = clean_search_result_url(a.get("href", ""))
                if not href.startswith("http"):
                    continue
                if not host_allowed(href, domains):
                    continue
                title = " ".join(a.stripped_strings)
                score = page_relevance(href, title, p)
                if score <= 0:
                    continue
                old = found.get(href)
                if old is None or score > old.score:
                    found[href] = CandidatePage(href, score, title)
            if found:
                break
        except Exception:
            continue

    return sorted(found.values(), key=lambda x: x.score, reverse=True)[:8]



def hostname(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def note_http_failure(url: str, status: int):
    host = hostname(url)
    if not host:
        return
    if status == 403:
        host_403_counts[host] = host_403_counts.get(host, 0) + 1
        if host_403_counts[host] >= HOST_403_LIMIT:
            blocked_hosts.add(host)
            print(f"  BLOCKED-HOST -> {host} (403 x{host_403_counts[host]}; 이 실행에서는 직접 접근 중단)")


def host_is_blocked(url: str) -> bool:
    host = hostname(url)
    return bool(host and host in blocked_hosts)


def search_official_image_urls(p: dict, domains: list[str], timeout: float) -> list[CandidateImage]:
    """
    Bing Images 결과의 m 메타데이터에서 murl(원본 이미지)과 purl(원본 페이지)을 읽습니다.
    purl이 제조사 공식 도메인일 때만 후보로 채택합니다.
    """
    label = p.get("officialName") or p.get("model") or ""
    model = p.get("modelCode") or ""
    manufacturer = p.get("manufacturer") or ""

    preferred = model if model else label
    domain_expr = " OR ".join(f"site:{d}" for d in domains[:5])
    query = f'({domain_expr}) "{preferred}" {manufacturer} {label}'.strip()

    found: dict[str, CandidateImage] = {}
    try:
        r = session.get(
            BING_IMAGE_SEARCH.format(query=quote_plus(query)),
            timeout=timeout,
            headers={
                "User-Agent": USER_AGENT,
                "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
            },
        )
        if r.status_code != 200:
            return []

        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.select("a.iusc"):
            raw = a.get("m")
            if not raw:
                continue
            try:
                meta = json.loads(raw)
            except Exception:
                continue

            image_url = meta.get("murl") or meta.get("turl")
            page_url = meta.get("purl") or ""
            desc = " ".join(str(meta.get(k) or "") for k in ("t", "desc"))

            if not image_url or not page_url:
                continue
            if not host_allowed(page_url, domains):
                continue

            relevance = page_relevance(page_url, desc, p)
            if relevance < 6:
                continue

            score = 210 + relevance
            old = found.get(image_url)
            if old is None or score > old.score:
                # CandidateImage.source에 공식 원본 페이지를 보관합니다.
                found[image_url] = CandidateImage(image_url, score, page_url)

    except Exception:
        return []

    return sorted(found.values(), key=lambda x: x.score, reverse=True)[:15]


def try_search_image_fallback(
    p: dict,
    domains: list[str],
    output: Path,
    timeout: float,
    delay: float,
    max_side: int,
    quality: int,
) -> tuple[dict | None, list[str]]:
    errors: list[str] = []
    candidates = search_official_image_urls(p, domains, timeout)

    for img in candidates:
        try:
            time.sleep(delay)
            size = download_and_convert(
                img.url,
                output,
                timeout,
                max_side,
                quality,
                referer=img.source or None,
            )
            return ({
                "sourcePage": img.source,
                "sourceImage": img.url,
                "width": size[0],
                "height": size[1],
                "method": "official-indexed-image",
            }, errors)
        except Exception as e:
            errors.append(f"indexed image {img.url}: {type(e).__name__}: {e}")

    return None, errors


def fetch_html(url: str, timeout: float) -> tuple[str, str, str]:
    if host_is_blocked(url):
        raise PermissionError(f"host circuit breaker: {hostname(url)}")

    r = session.get(url, timeout=timeout, allow_redirects=True)
    if r.status_code >= 400:
        note_http_failure(r.url or url, r.status_code)
        r.raise_for_status()

    ctype = (r.headers.get("content-type") or "").lower()
    if "html" not in ctype and "<html" not in r.text[:1000].lower():
        raise ValueError("not html")
    return r.text, r.url, ctype


def jsonld_images(soup: BeautifulSoup) -> list[str]:
    found: list[str] = []
    for tag in soup.find_all("script", attrs={"type": re.compile("ld\\+json", re.I)}):
        raw = tag.string or tag.get_text(" ", strip=True)
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue

        stack = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, dict):
                image = item.get("image")
                if isinstance(image, str):
                    found.append(image)
                elif isinstance(image, list):
                    found.extend(x for x in image if isinstance(x, str))
                elif isinstance(image, dict):
                    for key in ("url", "contentUrl"):
                        if isinstance(image.get(key), str):
                            found.append(image[key])
                stack.extend(item.values())
            elif isinstance(item, list):
                stack.extend(item)
    return found


def image_candidates(page_url: str, html_text: str, p: dict) -> list[CandidateImage]:
    soup = BeautifulSoup(html_text, "html.parser")
    candidates: dict[str, CandidateImage] = {}

    def add(raw_url: str | None, score: float, source: str, context=""):
        if not raw_url:
            return
        u = urljoin(page_url, html.unescape(raw_url.strip()))
        if not u.startswith(("http://", "https://")):
            return
        lower = u.lower()
        if any(word in lower for word in BAD_IMAGE_WORDS):
            score -= 80

        ctx = norm(context + " " + u)
        for t in product_tokens(p):
            if t in ctx:
                score += 5

        if score < 10:
            return
        old = candidates.get(u)
        if old is None or score > old.score:
            candidates[u] = CandidateImage(u, score, source)

    for prop, base in [
        ("og:image", 180),
        ("og:image:secure_url", 180),
        ("twitter:image", 165),
        ("twitter:image:src", 165),
    ]:
        for meta in soup.find_all("meta", attrs={"property": prop}) + soup.find_all("meta", attrs={"name": prop}):
            add(meta.get("content"), base, prop)

    for u in jsonld_images(soup):
        add(u, 150, "json-ld")

    for img in soup.find_all("img"):
        src = (
            img.get("src")
            or img.get("data-src")
            or img.get("data-lazy-src")
            or img.get("data-original")
        )
        context = " ".join(filter(None, [
            img.get("alt"), img.get("title"), img.get("class") and " ".join(img.get("class")),
        ]))
        score = 60
        try:
            w = int(re.sub(r"\D", "", str(img.get("width") or "0")) or 0)
            h = int(re.sub(r"\D", "", str(img.get("height") or "0")) or 0)
            if max(w, h) >= 600:
                score += 25
            if max(w, h) and max(w, h) < 200:
                score -= 50
        except Exception:
            pass
        add(src, score, "img", context)

    return sorted(candidates.values(), key=lambda x: x.score, reverse=True)


def download_and_convert(
    image_url: str,
    output_path: Path,
    timeout: float,
    max_side: int,
    quality: int,
    referer: str | None = None,
) -> tuple[int, int]:
    if host_is_blocked(image_url):
        raise PermissionError(f"host circuit breaker: {hostname(image_url)}")

    headers = {}
    if referer:
        headers["Referer"] = referer

    r = session.get(
        image_url,
        timeout=timeout,
        allow_redirects=True,
        headers=headers,
    )
    if r.status_code >= 400:
        note_http_failure(r.url or image_url, r.status_code)
        r.raise_for_status()
    ctype = (r.headers.get("content-type") or "").lower()
    if "image" not in ctype and len(r.content) < 1024:
        raise ValueError("not an image response")

    im = Image.open(io.BytesIO(r.content))
    im = ImageOps.exif_transpose(im)
    im.load()

    if max(im.size) < 300:
        raise ValueError(f"image too small: {im.size}")

    # 지나치게 긴 로고/배너를 걸러냄
    ratio = max(im.size) / max(1, min(im.size))
    if ratio > 8:
        raise ValueError(f"image aspect ratio too extreme: {im.size}")

    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    if im.mode not in ("RGB", "RGBA"):
        if "transparency" in im.info:
            im = im.convert("RGBA")
        else:
            im = im.convert("RGB")

    im.save(output_path, "WEBP", quality=quality, method=6)
    return im.size


def product_filename(p: dict) -> tuple[str, str]:
    brand = slug(p.get("manufacturer"), "other")
    stable = (
        p.get("id")
        or p.get("modelCode")
        or p.get("officialName")
        or p.get("model")
        or "product"
    )
    return brand, slug(stable, "product") + ".webp"


def candidate_product_pages(p: dict, domains: list[str], timeout: float) -> list[CandidatePage]:
    result: dict[str, CandidatePage] = {}

    # products.json 안에 이미 들어있는 URL을 먼저 활용
    for u in all_urls(p):
        if host_allowed(u, domains):
            score = page_relevance(u, "", p) + 25
            result[u] = CandidatePage(u, score, "embedded source")

    # 검색엔진은 보조 수단
    for item in search_official_pages(p, domains, timeout):
        old = result.get(item.url)
        if old is None or item.score > old.score:
            result[item.url] = item

    return sorted(result.values(), key=lambda x: x.score, reverse=True)


def resolve_one(
    p: dict,
    manifest: dict,
    image_dir: Path,
    timeout: float,
    delay: float,
    max_side: int,
    quality: int,
    refresh: bool,
    browser_fallback: bool = True,
    browser_visible: bool = False,
) -> dict:
    label = p.get("officialName") or p.get("model") or p.get("modelCode") or p.get("id")
    manufacturer = p.get("manufacturer") or ""
    domains = OFFICIAL_DOMAINS.get(manufacturer, [])

    existing = manifest.get(label)
    if (
        not refresh
        and isinstance(existing, dict)
        and existing.get("src")
        and (ROOT / "public" / existing["src"].lstrip("/")).exists()
    ):
        return {"status": "skipped", "reason": "already exists", "label": label}

    if not domains:
        return {"status": "failed", "reason": f"no official domain mapping: {manufacturer}", "label": label}

    brand_dir, filename = product_filename(p)
    output = image_dir / brand_dir / filename
    public_src = "/" + str(output.relative_to(ROOT / "public")).replace(os.sep, "/")
    errors: list[str] = []

    def commit_success(found: dict) -> dict:
        manifest[label] = {
            "src": public_src,
            "sourcePage": found.get("sourcePage", ""),
            "sourceImage": found.get("sourceImage", ""),
            "manufacturer": manufacturer,
            "modelCode": p.get("modelCode") or "",
            "width": found.get("width"),
            "height": found.get("height"),
            "method": found.get("method", "official-page"),
            "license": found.get("license", ""),
            "licenseUrl": found.get("licenseUrl", ""),
            "artist": found.get("artist", ""),
            "credit": found.get("credit", ""),
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
        }
        return {
            "status": "ok",
            "label": label,
            "src": public_src,
            "sourcePage": found.get("sourcePage", ""),
            "sourceImage": found.get("sourceImage", ""),
            "method": found.get("method", "official-page"),
        }

    # 오래된 단종 제품은 공식 상세 페이지가 사라진 경우가 많습니다.
    # 재사용 가능한 Wikimedia Commons 이미지를 먼저 찾아 불필요한 403/404 요청을 줄입니다.
    if p.get("currentSale") == "아니오" or p.get("saleStatus") in {"단종", "판매 종료"}:
        found, commons_errors = try_commons_fallback(
            p, output, timeout, delay, max_side, quality
        )
        errors.extend(commons_errors)
        if found:
            return commit_success(found)

    # Sony / Canon은 requests 직접 접근에서 403이 확인되어
    # 실제 브라우저로 공식 제품 페이지를 먼저 찾아 대표 이미지를 추출합니다.
    if manufacturer in IMAGE_SEARCH_FIRST and browser_fallback:
        found, browser_errors = try_browser_official_fallback(
            p, domains, output, timeout, delay, max_side, quality,
            visible=browser_visible,
        )
        errors.extend(browser_errors)
        if found:
            return commit_success(found)

    # 브라우저 fallback이 실패했을 때 색인된 공식 이미지 URL을 한 번 더 시도합니다.
    if manufacturer in IMAGE_SEARCH_FIRST:
        found, fallback_errors = try_search_image_fallback(
            p, domains, output, timeout, delay, max_side, quality
        )
        errors.extend(fallback_errors)
        if found:
            return commit_success(found)

    # 공식 제품 페이지 직접 접근
    pages = candidate_product_pages(p, domains, timeout)
    for page in pages[:6]:
        if host_is_blocked(page.url):
            errors.append(f"blocked host skipped: {hostname(page.url)}")
            continue

        try:
            time.sleep(delay)
            html_text, final_url, _ = fetch_html(page.url, timeout)

            soup = BeautifulSoup(html_text, "html.parser")
            title = soup.title.get_text(" ", strip=True) if soup.title else ""
            relevance = page_relevance(final_url, title, p)
            if relevance < 12 and page.title != "embedded source":
                errors.append(f"low relevance page: {final_url}")
                continue

            imgs = image_candidates(final_url, html_text, p)
            for img in imgs[:12]:
                try:
                    time.sleep(delay)
                    size = download_and_convert(
                        img.url,
                        output,
                        timeout,
                        max_side,
                        quality,
                        referer=final_url,
                    )
                    return commit_success({
                        "sourcePage": final_url,
                        "sourceImage": img.url,
                        "width": size[0],
                        "height": size[1],
                        "method": "official-page",
                    })
                except Exception as e:
                    errors.append(f"image {img.url}: {type(e).__name__}: {e}")

        except Exception as e:
            errors.append(f"page {page.url}: {type(e).__name__}: {e}")

    # 다른 제조사도 공식 페이지가 사라졌거나 차단된 경우 마지막 fallback을 사용합니다.
    if manufacturer not in IMAGE_SEARCH_FIRST:
        found, fallback_errors = try_search_image_fallback(
            p, domains, output, timeout, delay, max_side, quality
        )
        errors.extend(fallback_errors)
        if found:
            return commit_success(found)

    found, commons_errors = try_commons_fallback(
        p, output, timeout, delay, max_side, quality
    )
    errors.extend(commons_errors)
    if found:
        return commit_success(found)

    return {
        "status": "failed",
        "label": label,
        "reason": errors[-1] if errors else "no usable image",
        "errors": errors[-8:],
    }



_browser_runtime = None
_browser = None
_browser_context = None


def start_browser(visible: bool = False):
    """
    Sony/Canon처럼 requests는 403이지만 일반 브라우저에서는 공개 페이지가 열리는
    사이트를 위한 보조 수집기입니다. 인증/캡차를 우회하지 않습니다.
    """
    global _browser_runtime, _browser, _browser_context

    if _browser_context is not None:
        return _browser_context

    if sync_playwright is None:
        raise RuntimeError(
            "playwright is not installed. Run: py -m pip install playwright"
        )

    _browser_runtime = sync_playwright().start()

    errors = []
    launch_kwargs = {
        "headless": not visible,
        "args": [
            "--disable-dev-shm-usage",
            "--no-first-run",
            "--no-default-browser-check",
        ],
    }

    # 설치된 Chrome/Edge를 우선 사용하여 별도 브라우저 다운로드를 피합니다.
    for channel in ("chrome", "msedge"):
        try:
            _browser = _browser_runtime.chromium.launch(channel=channel, **launch_kwargs)
            break
        except Exception as e:
            errors.append(f"{channel}: {e}")

    if _browser is None:
        # Playwright Chromium이 이미 설치되어 있다면 마지막으로 사용합니다.
        try:
            _browser = _browser_runtime.chromium.launch(**launch_kwargs)
        except Exception as e:
            errors.append(f"chromium: {e}")
            raise RuntimeError(
                "Chrome/Edge/Playwright Chromium launch failed: " + " | ".join(errors[-3:])
            )

    _browser_context = _browser.new_context(
        locale="ko-KR",
        viewport={"width": 1440, "height": 1000},
        user_agent=USER_AGENT,
    )
    return _browser_context


def stop_browser():
    global _browser_runtime, _browser, _browser_context
    try:
        if _browser_context is not None:
            _browser_context.close()
    except Exception:
        pass
    try:
        if _browser is not None:
            _browser.close()
    except Exception:
        pass
    try:
        if _browser_runtime is not None:
            _browser_runtime.stop()
    except Exception:
        pass
    _browser_runtime = None
    _browser = None
    _browser_context = None


def browser_search_product_pages(
    p: dict,
    domains: list[str],
    timeout: float,
    visible: bool = False,
) -> list[CandidatePage]:
    """
    Bing 일반 검색을 실제 브라우저로 열어 공식 도메인 결과만 수집합니다.
    Sony/Canon의 공개 제품 상세 페이지를 찾는 데 사용합니다.
    """
    context = start_browser(visible=visible)
    page = context.new_page()
    page.set_default_timeout(int(timeout * 1000))

    label = p.get("officialName") or p.get("model") or ""
    model = p.get("modelCode") or ""
    manufacturer = p.get("manufacturer") or ""

    queries = []
    if model:
        queries.append(f'"{model}" {manufacturer}')
    if label:
        queries.append(f'"{label}" {manufacturer}')
    queries.append(f"{manufacturer} {label} {model}".strip())

    found: dict[str, CandidatePage] = {}

    try:
        for base_query in queries[:3]:
            site_expr = " OR ".join(f"site:{d}" for d in domains[:4])
            q = f"({site_expr}) {base_query}".strip()
            search_url = "https://www.bing.com/search?q=" + quote_plus(q) + "&count=10"

            try:
                page.goto(search_url, wait_until="domcontentloaded", timeout=int(timeout * 1000))
                page.wait_for_timeout(700)
            except Exception:
                continue

            anchors = page.locator("li.b_algo h2 a")
            try:
                count = min(anchors.count(), 20)
            except Exception:
                count = 0

            for i in range(count):
                try:
                    a = anchors.nth(i)
                    href = a.get_attribute("href") or ""
                    title = a.inner_text(timeout=1500) or ""
                except Exception:
                    continue

                if not href.startswith("http"):
                    continue
                if not host_allowed(href, domains):
                    continue

                score = page_relevance(href, title, p)
                if score < 4:
                    continue

                old = found.get(href)
                if old is None or score > old.score:
                    found[href] = CandidatePage(href, score, title)

            if found:
                break
    finally:
        try:
            page.close()
        except Exception:
            pass

    return sorted(found.values(), key=lambda x: x.score, reverse=True)[:8]


def browser_extract_images(
    page_url: str,
    p: dict,
    timeout: float,
    visible: bool = False,
) -> list[CandidateImage]:
    """
    공식 제품 페이지를 브라우저 렌더링 후 og:image/twitter:image/실제 img 후보를 추출합니다.
    """
    context = start_browser(visible=visible)
    page = context.new_page()
    page.set_default_timeout(int(timeout * 1000))
    found: dict[str, CandidateImage] = {}

    def add(url: str | None, score: float, source: str, context_text: str = ""):
        if not url:
            return
        u = urljoin(page.url or page_url, url.strip())
        if not u.startswith(("http://", "https://")):
            return

        lower = u.lower()
        if any(word in lower for word in BAD_IMAGE_WORDS):
            score -= 80

        ctx = norm(context_text + " " + u)
        for t in product_tokens(p):
            if t in ctx:
                score += 5

        if score < 10:
            return

        old = found.get(u)
        if old is None or score > old.score:
            found[u] = CandidateImage(u, score, source)

    try:
        page.goto(page_url, wait_until="domcontentloaded", timeout=int(timeout * 1000))
        page.wait_for_timeout(1200)

        # 페이지 자체가 403/Access Denied 텍스트를 보여주는지 확인
        title = ""
        body_text = ""
        try:
            title = page.title()
            body_text = page.locator("body").inner_text(timeout=2500)[:5000]
        except Exception:
            pass

        denied_text = norm(title + " " + body_text)
        if any(x in denied_text for x in ("access denied", "forbidden", "403 error")):
            return []

        for selector, base, source in (
            ('meta[property="og:image"]', 220, "og:image"),
            ('meta[property="og:image:secure_url"]', 220, "og:image:secure_url"),
            ('meta[name="twitter:image"]', 205, "twitter:image"),
            ('meta[name="twitter:image:src"]', 205, "twitter:image:src"),
        ):
            try:
                nodes = page.locator(selector)
                for i in range(min(nodes.count(), 10)):
                    add(nodes.nth(i).get_attribute("content"), base, source)
            except Exception:
                pass

        # 렌더링된 이미지 후보
        try:
            imgs = page.locator("img")
            count = min(imgs.count(), 120)
        except Exception:
            count = 0

        for i in range(count):
            try:
                node = imgs.nth(i)
                src = (
                    node.get_attribute("src")
                    or node.get_attribute("data-src")
                    or node.get_attribute("data-lazy-src")
                    or ""
                )
                alt = node.get_attribute("alt") or ""
                width = node.evaluate("(el) => el.naturalWidth || el.width || 0")
                height = node.evaluate("(el) => el.naturalHeight || el.height || 0")
            except Exception:
                continue

            score = 75
            if max(int(width or 0), int(height or 0)) >= 600:
                score += 45
            elif max(int(width or 0), int(height or 0)) and max(int(width or 0), int(height or 0)) < 180:
                score -= 60

            add(src, score, "browser-img", alt)

    except Exception:
        return []
    finally:
        try:
            page.close()
        except Exception:
            pass

    return sorted(found.values(), key=lambda x: x.score, reverse=True)[:20]


def browser_download_and_convert(
    image_url: str,
    output_path: Path,
    timeout: float,
    max_side: int,
    quality: int,
    referer: str | None = None,
    visible: bool = False,
) -> tuple[int, int]:
    """
    같은 브라우저 컨텍스트의 request API를 사용해 이미지 바이트를 받습니다.
    브라우저 페이지에서 필요한 쿠키가 설정된 경우도 자연스럽게 공유됩니다.
    """
    context = start_browser(visible=visible)
    headers = {}
    if referer:
        headers["referer"] = referer

    resp = context.request.get(
        image_url,
        headers=headers,
        timeout=int(timeout * 1000),
        fail_on_status_code=False,
    )
    if not resp.ok:
        raise RuntimeError(f"browser image HTTP {resp.status}: {image_url}")

    data = resp.body()
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im.load()

    if max(im.size) < 300:
        raise ValueError(f"image too small: {im.size}")

    ratio = max(im.size) / max(1, min(im.size))
    if ratio > 8:
        raise ValueError(f"image aspect ratio too extreme: {im.size}")

    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if im.mode not in ("RGB", "RGBA"):
        if "transparency" in im.info:
            im = im.convert("RGBA")
        else:
            im = im.convert("RGB")

    im.save(output_path, "WEBP", quality=quality, method=6)
    return im.size


def try_browser_official_fallback(
    p: dict,
    domains: list[str],
    output: Path,
    timeout: float,
    delay: float,
    max_side: int,
    quality: int,
    visible: bool = False,
) -> tuple[dict | None, list[str]]:
    errors: list[str] = []

    pages = browser_search_product_pages(p, domains, timeout, visible=visible)
    if not pages:
        return None, ["browser official page search returned no result"]

    for candidate in pages[:6]:
        try:
            time.sleep(delay)
            images = browser_extract_images(
                candidate.url, p, timeout, visible=visible
            )
        except Exception as e:
            errors.append(f"browser page {candidate.url}: {type(e).__name__}: {e}")
            continue

        for img in images[:15]:
            try:
                time.sleep(delay)
                try:
                    size = download_and_convert(
                        img.url,
                        output,
                        timeout,
                        max_side,
                        quality,
                        referer=candidate.url,
                    )
                except Exception:
                    size = browser_download_and_convert(
                        img.url,
                        output,
                        timeout,
                        max_side,
                        quality,
                        referer=candidate.url,
                        visible=visible,
                    )

                return ({
                    "sourcePage": candidate.url,
                    "sourceImage": img.url,
                    "width": size[0],
                    "height": size[1],
                    "method": "official-browser",
                }, errors)
            except Exception as e:
                errors.append(f"browser image {img.url}: {type(e).__name__}: {e}")

    return None, errors



ALLOWED_COMMONS_LICENSE_MARKERS = (
    "public domain",
    "cc0",
    "cc by ",
    "cc-by-",
    "cc by-sa",
    "cc-by-sa",
)


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    text = str(value)
    # URL이나 일반 텍스트를 BeautifulSoup에 넣으면 MarkupResemblesLocatorWarning이 발생할 수 있음.
    if text.startswith(("http://", "https://")) or ("<" not in text and ">" not in text):
        return text.strip()
    try:
        return BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
    except Exception:
        return text.strip()


def commons_license_allowed(short_name: str, usage_terms: str = "") -> bool:
    text = norm(f"{short_name} {usage_terms}")
    if any(token in text for token in (
        "noncommercial", "non commercial", "cc by nc", "cc-by-nc",
        "no derivatives", "cc by nd", "cc-by-nd"
    )):
        return False
    return any(norm(marker) in text for marker in ALLOWED_COMMONS_LICENSE_MARKERS)


def commons_search_candidates(p: dict, timeout: float) -> list[dict]:
    label = p.get("officialName") or p.get("model") or ""
    model = p.get("modelCode") or ""
    manufacturer = p.get("manufacturer") or ""

    queries = []
    if model:
        queries.append(f"{manufacturer} {model}")
    if label:
        queries.append(label)
    queries.append(f"{manufacturer} {label}".strip())

    found = []
    seen = set()

    for q in queries[:3]:
        params = {
            "action": "query",
            "generator": "search",
            "gsrsearch": q,
            "gsrnamespace": 6,
            "gsrlimit": 20,
            "prop": "imageinfo",
            "iiprop": "url|extmetadata|mime|size",
            "iiurlwidth": 900,
            "format": "json",
            "formatversion": 2,
            "origin": "*",
        }
        try:
            time.sleep(1.2)
            r = session.get(COMMONS_API, params=params, timeout=timeout, headers={"Api-User-Agent": USER_AGENT})
            if r.status_code != 200:
                continue
            data = r.json()
        except Exception:
            continue

        for page in data.get("query", {}).get("pages", []) or []:
            title = page.get("title") or ""
            infos = page.get("imageinfo") or []
            if not infos:
                continue

            info = infos[0]
            url = info.get("thumburl") or info.get("url")
            if not url or url in seen:
                continue

            mime = (info.get("mime") or "").lower()
            if mime and not mime.startswith("image/"):
                continue

            width = int(info.get("width") or 0)
            height = int(info.get("height") or 0)
            if max(width, height) and max(width, height) < 300:
                continue

            meta = info.get("extmetadata") or {}
            license_short = html_to_text((meta.get("LicenseShortName") or {}).get("value"))
            usage_terms = html_to_text((meta.get("UsageTerms") or {}).get("value"))
            if not commons_license_allowed(license_short, usage_terms):
                continue

            relevance = page_relevance(
                "https://commons.wikimedia.org/wiki/" + quote_plus(title.replace(" ", "_")),
                title,
                p,
            )
            if model and compact(model) in compact(title):
                relevance += 80
            if label and compact(label) in compact(title):
                relevance += 70
            if manufacturer and norm(manufacturer) in norm(title):
                relevance += 10

            if relevance < 12:
                continue

            found.append({
                "url": url,
                "descriptionurl": info.get("descriptionurl") or "",
                "title": title,
                "score": relevance,
                "width": width,
                "height": height,
                "license": license_short,
                "licenseUrl": html_to_text((meta.get("LicenseUrl") or {}).get("value")),
                "artist": html_to_text((meta.get("Artist") or {}).get("value")),
                "credit": html_to_text((meta.get("Credit") or {}).get("value")),
            })
            seen.add(url)

        if found:
            break

    return sorted(found, key=lambda x: x["score"], reverse=True)[:20]



def polite_get_bytes(
    url: str,
    timeout: float,
    referer: str | None = None,
    attempts: int = 4,
) -> bytes:
    """
    429를 만나면 Retry-After를 존중해 기다린 뒤 재시도합니다.
    Wikimedia에 과도한 연속 요청을 하지 않도록 최소 대기시간도 둡니다.
    """
    headers = {
        "User-Agent": USER_AGENT,
        "From": "https://matchcamera.com/",
    }
    if referer:
        headers["Referer"] = referer

    last_error = None
    for attempt in range(attempts):
        r = session.get(url, timeout=timeout, allow_redirects=True, headers=headers)
        if r.status_code == 429:
            retry_after = r.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else min(4 * (attempt + 1), 15)
            except Exception:
                wait = min(4 * (attempt + 1), 15)
            print(f"  RATE-LIMIT -> 429, {wait:g}초 대기 후 재시도 ({attempt+1}/{attempts})")
            time.sleep(wait)
            last_error = RuntimeError(f"HTTP 429: {url}")
            continue

        if r.status_code >= 400:
            note_http_failure(r.url or url, r.status_code)
            r.raise_for_status()

        return r.content

    if last_error:
        raise last_error
    raise RuntimeError(f"download failed: {url}")


def convert_image_bytes(
    data: bytes,
    output_path: Path,
    max_side: int,
    quality: int,
) -> tuple[int, int]:
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    im.load()

    if max(im.size) < 300:
        raise ValueError(f"image too small: {im.size}")

    ratio = max(im.size) / max(1, min(im.size))
    if ratio > 8:
        raise ValueError(f"image aspect ratio too extreme: {im.size}")

    im.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if im.mode not in ("RGB", "RGBA"):
        if "transparency" in im.info:
            im = im.convert("RGBA")
        else:
            im = im.convert("RGB")

    im.save(output_path, "WEBP", quality=quality, method=6)
    return im.size


def try_commons_fallback(
    p: dict,
    output: Path,
    timeout: float,
    delay: float,
    max_side: int,
    quality: int,
) -> tuple[dict | None, list[str]]:
    errors = []

    for item in commons_search_candidates(p, timeout):
        try:
            time.sleep(delay)
            data = polite_get_bytes(
                item["url"],
                timeout,
                referer=item.get("descriptionurl") or None,
            )
            size = convert_image_bytes(
                data,
                output,
                max_side,
                quality,
            )
            return ({
                "sourcePage": item.get("descriptionurl") or "",
                "sourceImage": item["url"],
                "width": size[0],
                "height": size[1],
                "method": "wikimedia-commons",
                "license": item.get("license") or "",
                "licenseUrl": item.get("licenseUrl") or "",
                "artist": item.get("artist") or "",
                "credit": item.get("credit") or "",
            }, errors)
        except Exception as e:
            errors.append(f"commons {item.get('url')}: {type(e).__name__}: {e}")

    return None, errors


def save_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--products", type=Path, default=DEFAULT_PRODUCTS)
    ap.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    ap.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    ap.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_DIR)
    ap.add_argument("--manufacturer", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--timeout", type=float, default=18)
    ap.add_argument("--delay", type=float, default=0.45)
    ap.add_argument("--max-side", type=int, default=900)
    ap.add_argument("--quality", type=int, default=82)
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--retry-failed", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--no-browser-fallback",
        action="store_true",
        help="Sony/Canon browser fallback을 사용하지 않습니다.",
    )
    ap.add_argument(
        "--browser-visible",
        action="store_true",
        help="Sony/Canon fallback 브라우저 창을 표시합니다.",
    )
    ap.add_argument(
        "--match",
        default="",
        help="제품명/모델코드/ID에 포함된 문자열로 대상 제품을 제한합니다.",
    )
    ap.add_argument(
        "--current-only",
        action="store_true",
        help="현재 판매 제품만 처리합니다.",
    )
    ap.add_argument(
        "--exact-name",
        default="",
        help="officialName/model과 정확히 일치하는 제품만 처리합니다.",
    )
    ap.add_argument(
        "--exact-model-code",
        default="",
        help="modelCode와 정확히 일치하는 제품만 처리합니다.",
    )
    ap.add_argument(
        "--exclude-manufacturer",
        action="append",
        default=[],
        help="처리에서 제외할 제조사. 여러 번 지정할 수 있습니다.",
    )
    args = ap.parse_args()

    products = json.loads(args.products.read_text(encoding="utf-8"))
    if not isinstance(products, list):
        raise SystemExit("products.json must be a JSON array")

    manifest = {}
    if args.manifest.exists():
        try:
            manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}
    if not isinstance(manifest, dict):
        manifest = {}

    report = {
        "_meta": {
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "totalProducts": len(products),
        },
        "items": {},
    }
    if args.report.exists():
        try:
            old_report = json.loads(args.report.read_text(encoding="utf-8"))
            if isinstance(old_report, dict) and isinstance(old_report.get("items"), dict):
                report["items"].update(old_report["items"])
        except Exception:
            pass

    selected = products

    excluded = {str(x).strip().lower() for x in (args.exclude_manufacturer or []) if str(x).strip()}
    if excluded:
        selected = [
            p for p in selected
            if str(p.get("manufacturer") or "").strip().lower() not in excluded
        ]

    if args.manufacturer:
        selected = [
            p for p in selected
            if str(p.get("manufacturer") or "").lower() == args.manufacturer.lower()
        ]

    if args.current_only:
        selected = [
            p for p in selected
            if p.get("currentSale") == "예" or p.get("saleStatus") in {"현재 판매", "판매 중"}
        ]

    if args.exact_name:
        target = norm(args.exact_name)
        selected = [
            p for p in selected
            if norm(p.get("officialName") or p.get("model") or "") == target
        ]

    if args.exact_model_code:
        target = compact(args.exact_model_code)
        selected = [
            p for p in selected
            if compact(p.get("modelCode") or "") == target
        ]

    if args.match:
        q = norm(args.match)
        qc = compact(args.match)
        selected = [
            p for p in selected
            if (
                q in norm(" ".join(str(p.get(k) or "") for k in ("officialName", "model", "modelCode", "id", "series")))
                or qc in compact(" ".join(str(p.get(k) or "") for k in ("officialName", "model", "modelCode", "id", "series")))
            )
        ]

    if args.limit:
        selected = selected[:args.limit]

    print(f"Products: {len(selected)} / {len(products)}")
    if args.dry_run:
        for p in selected[:50]:
            label = p.get("officialName") or p.get("model") or p.get("id")
            print(f"- {p.get('manufacturer')}: {label}")
        return 0

    ok = skipped = failed = 0
    for i, p in enumerate(selected, 1):
        label = p.get("officialName") or p.get("model") or p.get("modelCode") or p.get("id")
        previous = report["items"].get(label, {})
        if (
            not args.refresh
            and not args.retry_failed
            and previous.get("status") == "failed"
        ):
            # 실패한 항목을 매 실행마다 다시 두드려 차단되는 것을 방지
            print(f"[{i}/{len(selected)}] FAIL-SKIP {label}")
            failed += 1
            continue

        print(f"[{i}/{len(selected)}] {p.get('manufacturer')} | {label}")
        result = resolve_one(
            p, manifest, args.image_dir, args.timeout, args.delay,
            args.max_side, args.quality, args.refresh,
            browser_fallback=not args.no_browser_fallback,
            browser_visible=args.browser_visible,
        )
        report["items"][label] = result
        if result["status"] == "ok":
            ok += 1
            print(f"  OK -> {result.get('src')}")
        elif result["status"] == "skipped":
            skipped += 1
            print("  SKIP")
        else:
            failed += 1
            print(f"  FAIL -> {result.get('reason')}")

        # 중간에 종료돼도 진행상황 보존
        if i % 5 == 0 or result["status"] == "ok":
            save_json(args.manifest, manifest)
            report["_meta"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
            save_json(args.report, report)

    save_json(args.manifest, manifest)
    report["_meta"].update({
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "selected": len(selected),
        "okThisRun": ok,
        "skippedThisRun": skipped,
        "failedThisRun": failed,
        "blockedHostsThisRun": sorted(blocked_hosts),
        "host403CountsThisRun": dict(sorted(host_403_counts.items())),
    })
    save_json(args.report, report)

    print()
    print(f"DONE: ok={ok}, skipped={skipped}, failed={failed}")
    print(f"Manifest: {args.manifest}")
    print(f"Report:   {args.report}")
    stop_browser()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
