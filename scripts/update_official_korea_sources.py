#!/usr/bin/env python3
from __future__ import annotations

import argparse, io, json, os, random, re, time, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from PIL import Image, ImageOps

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ROOT / "public/data/products.json"
SYSTEM_EXPANSION = ROOT / "public/data/system-expansion.json"
PARTNER_PRODUCTS = ROOT / "public/data/official-partner-products.json"
PRICES = ROOT / "public/data/korea-prices.json"
IMAGES = ROOT / "public/data/product-images.json"
REPORT = ROOT / "public/data/official-korea-source-report.json"

PRICE_POLICY = "한국 공식 제조사/공식 수입·유통사 정상가·소비자가만 사용. 할인가·최저가·병행수입·해외가격 제외."
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"

SOURCES = {
    "saeki": {
        "brands": {"Sigma"},
        "home": "https://www.saeki.co.kr/main",
        "image_host_hint": "saeki",
        "source_name": "세기몰 / 세기P&C",
    },
    "samyang": {
        "brands": {"Samyang"},
        "home": "https://samyanglensmall.com/",
        "search": "https://samyanglensmall.com/product/search.html?keyword={q}",
        "image_host_hint": "cafe24",
        "source_name": "LK삼양 카메라 렌즈 공식몰",
    },
    "sunphoto": {
        "brands": {"Tamron"},
        "home": "https://sunphoto.kr/",
        "search": "https://sunphoto.kr/product/search.html?keyword={q}",
        "image_host_hint": "cafe24",
        "source_name": "썬포토",
    },
}

REJECT = (
    "리퍼", "중고", "used", "refurb", "패키지", "bundle", "kit", "후드", "cap", "필터",
    "프로모션 세트", "사은품", "렌탈", "대여"
)
BAD_IMAGE = (
    "logo","icon","sprite","arrow","banner","event","gift","coupon","btn","button",
    "header","footer","loading","quick","common","review","detail_info"
)

def loadj(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else fallback
    except Exception:
        return fallback

def savej(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)

def compact(s=""):
    s = unicodedata.normalize("NFKC", str(s or "")).lower()
    s = s.replace("sigma","").replace("시그마","").replace("tamron","").replace("탐론","").replace("samyang","").replace("삼양","")
    return re.sub(r"[^a-z0-9가-힣]+", "", s)

def slug(s=""):
    s = unicodedata.normalize("NFKD", str(s or "product"))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()[:120] or "product"

def label(p):
    return p.get("officialName") or p.get("model") or p.get("modelCode") or p.get("id") or ""

def merged_products():
    out=[]; seen=set()
    for path in (PRODUCTS, SYSTEM_EXPANSION, PARTNER_PRODUCTS):
        for p in loadj(path, []):
            key = p.get("id") or (p.get("manufacturer"), p.get("type"), p.get("officialName"), p.get("mount"))
            if key in seen: continue
            seen.add(key); out.append(p)
    return out

def source_for(p):
    b = str(p.get("manufacturer") or "")
    if b == "Sigma": return "saeki"
    if b == "Samyang": return "samyang"
    if b == "Tamron": return "sunphoto"
    return None

def mount_suffix(mount):
    return {
        "Sony E":"SE",
        "L-Mount":"L",
        "Fujifilm X":"X",
        "Canon RF":"RF",
        "Canon EF":"EF",
        "Nikon F":"F",
        "Nikon Z":"Z",
    }.get(mount, "")

def search_query(p):
    brand = p.get("manufacturer")
    name = label(p)
    name = re.sub(r"^(Sigma|SIGMA|Tamron|TAMRON|Samyang|SAMYANG)\s+", "", name).strip()
    if brand == "Sigma":
        suf = mount_suffix(p.get("mount"))
        return f"{name} ({suf})" if suf else name
    if brand == "Tamron":
        code = str(p.get("modelCode") or "")
        model = re.search(r"\b([A-Z]\d{3})\b", code)
        m = model.group(1) if model else ""
        mount = {
            "Sony E":"Sony E-Mount",
            "Nikon Z":"Nikon Z-Mount",
            "Canon RF":"Canon RF-Mount",
            "Fujifilm X":"Fujifilm X-Mount",
        }.get(p.get("mount"), p.get("mount") or "")
        focal = re.search(r"\d+(?:-\d+)?mm", name, re.I)
        return " ".join(x for x in [focal.group(0) if focal else "", m, mount] if x)
    return name

class Browser:
    def __init__(self, visible=False):
        if sync_playwright is None:
            raise RuntimeError("playwright가 없습니다.")
        self.pw = sync_playwright().start()
        self.browser = None
        for channel in ("chrome","msedge"):
            try:
                self.browser = self.pw.chromium.launch(
                    channel=channel, headless=not visible,
                    args=["--no-first-run","--disable-dev-shm-usage"]
                )
                break
            except Exception:
                pass
        if not self.browser:
            self.browser = self.pw.chromium.launch(headless=not visible)
        self.ctx = self.browser.new_context(
            locale="ko-KR", user_agent=UA, viewport={"width":1600,"height":1200}, device_scale_factor=2
        )

    def close(self):
        for obj in (getattr(self,"ctx",None), getattr(self,"browser",None)):
            try: obj.close()
            except Exception: pass
        try: self.pw.stop()
        except Exception: pass

def search_saeki(page, query, timeout):
    page.goto(SOURCES["saeki"]["home"], wait_until="domcontentloaded", timeout=timeout)
    page.wait_for_timeout(800)
    # Top search box: choose visible text/search input near page top.
    candidates = page.locator('input:visible')
    best = None
    best_score = -1
    for i in range(candidates.count()):
        try:
            el = candidates.nth(i)
            box = el.bounding_box()
            typ = (el.get_attribute("type") or "text").lower()
            if not box or typ not in ("text","search"): continue
            score = (1000 if box["y"] < 180 else 0) + min(box["width"], 500)
            if score > best_score:
                best_score = score; best = el
        except Exception:
            pass
    if best is None:
        raise RuntimeError("세기몰 검색 입력창을 찾지 못함")
    best.fill(query)
    best.press("Enter")
    page.wait_for_timeout(1200)
    try: page.wait_for_load_state("networkidle", timeout=4000)
    except Exception: pass

def open_search(page, source, query, timeout):
    cfg = SOURCES[source]
    if source == "saeki":
        return search_saeki(page, query, timeout)
    page.goto(cfg["search"].format(q=quote(query)), wait_until="domcontentloaded", timeout=timeout)
    page.wait_for_timeout(900)
    try: page.wait_for_load_state("networkidle", timeout=3500)
    except Exception: pass

def candidate_links(page, source):
    if source == "saeki":
        selector = 'a[href*="/item/itemDetail?itemId="]'
    else:
        selector = 'a[href*="/product/"]'
    return page.evaluate("""({selector}) => {
      const seen=new Set(), out=[];
      for(const a of document.querySelectorAll(selector)){
        const href=a.href;
        if(!href || seen.has(href)) continue;
        seen.add(href);
        let text=(a.innerText||a.textContent||'')+' '+(a.getAttribute('title')||'');
        for(const im of a.querySelectorAll('img')) text+=' '+(im.alt||'')+' '+(im.title||'');
        let n=a.parentElement;
        for(let i=0;i<3&&n;i++,n=n.parentElement){
          const t=(n.innerText||n.textContent||'').replace(/\\s+/g,' ').trim();
          if(t.length>0 && t.length<550) text+=' '+t;
          else if(t.length>=550) break;
        }
        out.push({href,text:text.replace(/\\s+/g,' ').trim()});
      }
      return out;
    }""", {"selector": selector})

def score_candidate(query, p, text):
    q = compact(query)
    t = compact(text)
    if not q or not t: return -999
    score = 0
    if t == q: score += 1400
    elif t.startswith(q): score += 900
    elif q in t: score += 560
    else:
        # Tamron may reorder focal/model/mount tokens.
        toks = [compact(x) for x in re.split(r"\s+", query) if compact(x)]
        hit = sum(1 for x in toks if x in t)
        if toks and hit / len(toks) >= .75: score += 450
        else: return -999
    lower = text.lower()
    for x in REJECT:
        if x.lower() in lower: score -= 700
    # Mount correctness.
    m = str(p.get("mount") or "")
    mount_tokens = {
        "Sony E":("se","sonyemount","소니"),
        "L-Mount":("lmount","(l)"," l "),
        "Fujifilm X":("xmount","(x)","후지"),
        "Canon RF":("rfmount","(rf)","캐논rf"),
        "Canon EF":("efmount","(ef)","캐논ef"),
        "Nikon F":("nikonf","(f)","니콘f"),
        "Nikon Z":("nikonz","zmount","니콘z"),
    }.get(m, ())
    if any(compact(x) in t for x in mount_tokens): score += 150
    if len(text) > 500: score -= 150
    return score

def detail_titles(page):
    try:
        return page.evaluate("""() => {
          const vals=[];
          const add=x=>{if(x&&String(x).trim()) vals.push(String(x).replace(/\\s+/g,' ').trim())};
          add(document.querySelector('meta[property="og:title"]')?.content);
          add(document.title);
          for(const e of [...document.querySelectorAll('h1,h2,h3')].slice(0,14)) add(e.innerText||e.textContent);
          return [...new Set(vals)];
        }""")
    except Exception:
        return []

def detail_matches(page, p, query):
    titles = detail_titles(page)
    hay = " ".join(titles)
    q = compact(re.sub(r"\([^)]*\)\s*$","",query))
    if q and q in compact(hay):
        # Ensure mount if the page title exposes it.
        return True, hay[:300]
    # model code can validate Tamron pages.
    mc = str(p.get("modelCode") or "")
    m = re.search(r"\b([A-Z]\d{3})\b", mc)
    if m and compact(m.group(1)) in compact(hay):
        return True, hay[:300]
    return False, hay[:300]

def samyang_card_links(page):
    """Cafe24 Samyang product cards.
    Product name/image/detail buttons can be separate anchors, so read the whole <li> card.
    This avoids the v14 failure where 30 anchor candidates existed but none contained
    enough product-name text to score.
    """
    return page.evaluate("""() => {
      const cards=[...document.querySelectorAll('li[id^="anchorBoxId_"], .prdList > li, .xans-product-listnormal li')];
      const out=[], seen=new Set();
      for(const card of cards){
        let text=(card.innerText||card.textContent||'').replace(/\\s+/g,' ').trim();
        for(const im of card.querySelectorAll('img')){
          text += ' ' + (im.alt||'') + ' ' + (im.title||'');
        }
        const links=[...card.querySelectorAll('a[href*="/product/"]')]
          .map(a=>a.href)
          .filter(Boolean);
        // Prefer a canonical product detail URL, not category navigation/assets.
        let href=links.find(h=>new RegExp('/product/[^/?]+/[0-9]+(?:/|$)').test(h)) || links[0] || '';
        if(!href || seen.has(href)) continue;
        seen.add(href);
        out.push({href,text:text.replace(/\\s+/g,' ').trim()});
      }
      return out;
    }""")


def samyang_score_card(query, text):
    q=compact(query)
    t=compact(text)
    if not q or not t:
        return -999

    low=text.lower()

    # Never map hoods/caps/accessories to a lens.
    if any(x in low for x in ("전용 후드","hood","front cap","rear cap","캡","필터")):
        return -999

    score=0
    if t == q:
        score += 1600
    elif t.startswith(q):
        score += 1200
    elif q in t:
        score += 850
    else:
        # Cafe24 cards include price/buttons around the product name.
        toks=[compact(x) for x in re.split(r"\s+",query) if compact(x)]
        hit=sum(1 for x in toks if x in t)
        if toks and hit/len(toks) >= .8:
            score += 600
        else:
            return -999

    if "자세히보기" in text or "구매하기" in text:
        score += 80
    return score


def discover_samyang_detail(browser, p, query, timeout):
    # Official AF category is much more reliable than Cafe24 product/search.html:
    # product name, price, image, and detail button live in one product card.
    pages=[
        "https://samyanglensmall.com/category/af-%EC%9E%90%EB%8F%99%EC%B4%88%EC%A0%90/24/?page=1",
        "https://samyanglensmall.com/category/af-%EC%9E%90%EB%8F%99%EC%B4%88%EC%A0%90/24/?page=2",
        "https://samyanglensmall.com/category/%EC%A4%8C%EB%A0%8C%EC%A6%88/33/?page=1",
    ]

    # For V-AF/video products, add the site's own search result as fallback.
    pages.append(SOURCES["samyang"]["search"].format(q=quote(query)))

    collected=[]
    seen=set()
    page=browser.ctx.new_page()
    page.set_default_timeout(timeout)
    try:
        for url in pages:
            try:
                page.goto(url,wait_until="domcontentloaded",timeout=timeout)
                page.wait_for_timeout(650)
                for item in samyang_card_links(page):
                    if item["href"] in seen:
                        continue
                    seen.add(item["href"])
                    collected.append(item)
            except Exception as e:
                print("  SAMYANG LIST WARN ->",url,"|",type(e).__name__,e)
    finally:
        page.close()

    ranked=sorted(
        [(samyang_score_card(query,x["text"]),x) for x in collected],
        key=lambda z:z[0], reverse=True
    )
    ranked=[x for x in ranked if x[0] >= 550]

    if not ranked:
        raise RuntimeError(f"정확한 삼양 상품 카드 없음 ({len(collected)}개 카드 확인)")

    verify=browser.ctx.new_page()
    verify.set_default_timeout(timeout)
    try:
        for score,item in ranked[:8]:
            try:
                verify.goto(item["href"],wait_until="domcontentloaded",timeout=timeout)
                verify.wait_for_timeout(500)
                ok,title=detail_matches(verify,p,query)
                if ok:
                    return item["href"],score,title
                print("  REJECT SAMYANG ->",item["href"],"|",title[:140])
            except Exception as e:
                print("  REJECT SAMYANG ->",item["href"],"|",type(e).__name__,e)
    finally:
        verify.close()

    raise RuntimeError("삼양 상품 카드는 찾았지만 상세 제품명이 일치하지 않음")


def discover_detail(browser, source, p, query, timeout):
    if source == "samyang":
        return discover_samyang_detail(browser, p, query, timeout)

    search_page = browser.ctx.new_page()
    search_page.set_default_timeout(timeout)
    try:
        open_search(search_page, source, query, timeout)
        links = candidate_links(search_page, source)
        ranked = sorted(
            [(score_candidate(query,p,x["text"]),x) for x in links],
            key=lambda x:x[0], reverse=True
        )
        ranked = [x for x in ranked if x[0] >= 350]
        if not ranked:
            raise RuntimeError(f"정확한 상품 후보 없음 ({len(links)}개 후보)")
        verify = browser.ctx.new_page()
        verify.set_default_timeout(timeout)
        try:
            for score, item in ranked[:8]:
                try:
                    verify.goto(item["href"], wait_until="domcontentloaded", timeout=timeout)
                    verify.wait_for_timeout(650)
                    ok, title = detail_matches(verify,p,query)
                    if ok:
                        return item["href"], score, title
                    print("  REJECT ->", item["href"], "|", title[:140])
                except Exception as e:
                    print("  REJECT ->", item["href"], "|", type(e).__name__, e)
        finally:
            verify.close()
        raise RuntimeError("후보 상세 제품명이 일치하지 않음")
    finally:
        search_page.close()

def parse_money(text):
    vals=[]
    for m in re.findall(r"(?<!\d)(\d{1,3}(?:,\d{3})+|\d{5,8})\s*원", text):
        try:
            n=int(m.replace(",",""))
            if 20000 <= n <= 50000000: vals.append(n)
        except Exception: pass
    return vals

def extract_normal_price(page, source):
    # Prefer explicit consumer/list/normal price labels.
    try:
        data = page.evaluate("""() => {
          const rows=[];
          for(const tr of document.querySelectorAll('tr')){
            const txt=(tr.innerText||tr.textContent||'').replace(/\\s+/g,' ').trim();
            if(txt) rows.push(txt);
          }
          const body=(document.body.innerText||'').replace(/\\s+/g,' ').trim();
          return {rows, body:body.slice(0,9000)};
        }""")
    except Exception:
        data={"rows":[],"body":""}

    preferred=[]
    for row in data["rows"]:
        low=row.lower()
        if any(k in low for k in ("소비자가","정상가","정가","판매가")):
            vals=parse_money(row)
            if vals: preferred.extend(vals)
    # Consumer price is usually >= discounted sale price; use max among explicit rows.
    if preferred:
        return max(preferred)

    # Saeki often exposes sale + crossed normal price high in the product page.
    vals=parse_money(data["body"][:4500])
    if vals:
        # Avoid related-accessory prices by using a small front-window and choose max of first few.
        return max(vals[:8])
    return None

def image_candidates(page, source, query):
    host_hint = SOURCES[source]["image_host_hint"]
    return page.evaluate("""({q,bad,source,hostHint}) => {
      const compact=s=>String(s||'').toLowerCase().replace(/[^a-z0-9가-힣]+/g,'');
      return [...document.images].map((im,i)=>{
        im.dataset.mcOfficialCandidate=String(i);
        const src=im.currentSrc||im.src||im.getAttribute('data-src')||'';
        const alt=im.alt||'', title=im.title||'';
        const r=im.getBoundingClientRect(), nw=im.naturalWidth||0, nh=im.naturalHeight||0;
        let near='', n=im;
        for(let k=0;k<3&&n;k++,n=n.parentElement) near+=' '+(n.innerText||n.textContent||'').slice(0,500);
        const hay=(src+' '+alt+' '+title+' '+near).toLowerCase();
        let score=0;
        if(source==='saeki' && (src.includes('cdn.saeki.co.kr')||src.includes('saeki.co.kr'))) score+=180;
        if(source!=='saeki' && (src.includes('cafe24')||src.includes('ecimg'))) score+=120;
        if(q && compact(alt).includes(compact(q))) score+=300;
        if(Math.max(nw,nh)>=1000)score+=90; else if(Math.max(nw,nh)>=600)score+=70; else if(Math.max(nw,nh)>=300)score+=45; else score-=90;
        if(r.width>=160&&r.height>=100)score+=30;
        if(nw&&nh){
          const ratio=Math.max(nw,nh)/Math.max(1,Math.min(nw,nh));
          if(ratio>4.5)score-=220; else if(ratio<2.3)score+=25;
        }
        for(const w of bad)if(hay.includes(w))score-=260;
        return {i,src,alt,nw,nh,score};
      }).sort((a,b)=>b.score-a.score);
    }""", {"q":query,"bad":list(BAD_IMAGE),"source":source,"hostHint":host_hint})

def direct_image(browser, src, referer, timeout):
    if not src.startswith(("http://","https://")): return None
    try:
        r=browser.ctx.request.get(src,headers={"Referer":referer},timeout=timeout,fail_on_status_code=False)
        if not r.ok: return None
        im=Image.open(io.BytesIO(r.body())); im=ImageOps.exif_transpose(im); im.load()
        return im
    except Exception:
        return None

def screenshot_image(page, idx):
    try:
        loc=page.locator(f'img[data-mc-official-candidate="{idx}"]').first
        loc.scroll_into_view_if_needed(timeout=2500)
        data=loc.screenshot(type="png",timeout=5000)
        im=Image.open(io.BytesIO(data)); im.load()
        return im
    except Exception:
        return None

def extract_detail(browser, source, p, url, query, timeout):
    page=browser.ctx.new_page(); page.set_default_timeout(timeout)
    try:
        page.goto(url,wait_until="domcontentloaded",timeout=timeout)
        page.wait_for_timeout(900)
        ok,title=detail_matches(page,p,query)
        if not ok: raise RuntimeError(f"상세페이지 재검증 실패: {title}")
        price=extract_normal_price(page,source)
        images=image_candidates(page,source,query)
        image=None; image_url=""; method=""
        for c in images[:14]:
            if c["score"] < -80: continue
            image=direct_image(browser,c["src"],page.url,timeout)
            method="direct-image"
            if image is None:
                image=screenshot_image(page,c["i"]); method="element-screenshot"
            if image is None: continue
            if max(image.size)<120: image=None; continue
            ratio=max(image.size)/max(1,min(image.size))
            if ratio>5: image=None; continue
            image_url=c["src"]; break
        return {"price":price,"image":image,"sourcePage":page.url,"sourceImage":image_url,"extractMethod":method}
    finally:
        page.close()

def save_webp(im, brand, p):
    out=ROOT/"public/assets/images/products"/brand.lower()/(slug(p.get("id") or label(p))+".webp")
    out.parent.mkdir(parents=True,exist_ok=True)
    im=ImageOps.exif_transpose(im)
    im.thumbnail((900,900),Image.Resampling.LANCZOS)
    if im.mode not in ("RGB","RGBA"): im=im.convert("RGB")
    im.save(out,"WEBP",quality=86,method=6)
    return "/"+str(out.relative_to(ROOT/"public")).replace(os.sep,"/"), im.size

def update_price_row(price_rows,p,price,source,url):
    if not price: return False
    name=label(p); mount=p.get("mount") or ""
    matches=[r for r in price_rows if r.get("정식 제품명")==name and (r.get("마운트") or "")==mount]
    if not matches:
        same=[r for r in price_rows if r.get("정식 제품명")==name]
        if len(same)==1: matches=same
    if not matches: return False
    r=matches[0]
    r.update({
        "한국 가격 표시": f"{price:,}원",
        "한국 출고가/공식정가(원)": price,
        "한국 기준 가격(원)": price,
        "한국 공식/출시 가격(원)": price,
        "가격 유형":"한국 공식 정상가/소비자가",
        "가격 정책":PRICE_POLICY,
        "유통 형태":"국내 공식",
        "국내 유통 상태":"현재 판매/공식 가격 확인",
        "가격 기준일":datetime.now().date().isoformat(),
        "가격 출처 사이트":SOURCES[source]["source_name"],
        "가격 출처 국가":"KR",
        "가격 출처 URL":url,
        "가격 검증 상태":"한국 공식/공식 수입·유통사 출처 확인",
        "비고":"자동 수집: 공식몰 소비자가/정상가 우선. 할인·리퍼·패키지는 제외.",
    })
    return True

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--source",choices=["all","saeki","samyang","sunphoto"],default="all")
    ap.add_argument("--match",default="")
    ap.add_argument("--limit",type=int,default=0)
    ap.add_argument("--replace-images",action="store_true")
    ap.add_argument("--visible",action="store_true")
    ap.add_argument("--timeout",type=int,default=22000)
    ap.add_argument("--delay",type=float,default=.8)
    args=ap.parse_args()

    products=merged_products()
    prices=loadj(PRICES,[])
    images=loadj(IMAGES,{})
    if not isinstance(images,dict):images={}
    selected=[]
    for p in products:
        src=source_for(p)
        if not src: continue
        if args.source!="all" and src!=args.source: continue
        if p.get("type") not in ("렌즈","바디"): continue
        if args.match and compact(args.match) not in compact(" ".join(str(p.get(x) or "") for x in ("officialName","modelCode","mount"))):
            continue
        selected.append((src,p))
    if args.limit: selected=selected[:args.limit]

    print("Selected:",len(selected))
    browser=Browser(args.visible)
    report=loadj(REPORT,{"items":{}}); report.setdefault("items",{})
    ok=fail=0
    try:
        for i,(src,p) in enumerate(selected,1):
            name=label(p); q=search_query(p)
            print(f"[{i}/{len(selected)}] {src.upper()} | {name} | {p.get('mount','')} | q={q}")
            try:
                url,score,title=discover_detail(browser,src,p,q,args.timeout)
                print("  DETAIL ->",url)
                got=extract_detail(browser,src,p,url,q,args.timeout)

                price_updated=update_price_row(prices,p,got["price"],src,url)
                image_updated=False
                if got["image"] is not None:
                    old=images.get(name)
                    if args.replace_images or not old:
                        img_src,(w,h)=save_webp(got["image"],p.get("manufacturer","brand"),p)
                        images[name]={
                            "src":img_src,
                            "sourcePage":url,
                            "sourceImage":got["sourceImage"],
                            "manufacturer":p.get("manufacturer"),
                            "width":w,"height":h,
                            "method":f"{src}-official-korea",
                            "extractMethod":got["extractMethod"],
                            "fetchedAt":datetime.now(timezone.utc).isoformat(),
                            "usageReviewRequired":True,
                        }
                        image_updated=True
                savej(PRICES,prices); savej(IMAGES,images)
                report["items"][f"{src}:{name}:{p.get('mount','')}"]={
                    "status":"ok","query":q,"sourcePage":url,"price":got["price"],
                    "priceUpdated":price_updated,"imageUpdated":image_updated,
                    "sourceImage":got["sourceImage"],"title":title
                }
                print("  OK price=",got["price"],"priceDB=",price_updated,"image=",image_updated)
                ok+=1
            except Exception as e:
                print("  FAIL ->",type(e).__name__,e)
                report["items"][f"{src}:{name}:{p.get('mount','')}"]={
                    "status":"failed","query":q,"reason":str(e)
                }
                fail+=1
            report["_meta"]={"updatedAt":datetime.now(timezone.utc).isoformat(),"selected":len(selected),"ok":ok,"failed":fail}
            savej(REPORT,report)
            time.sleep(max(0,args.delay)+random.uniform(0,.2))
    finally:
        browser.close()
    savej(PRICES,prices); savej(IMAGES,images); savej(REPORT,report)
    print(f"DONE ok={ok} failed={fail}")
    print("Prices:",PRICES)
    print("Images:",IMAGES)
    print("Report:",REPORT)

if __name__=="__main__":
    main()
