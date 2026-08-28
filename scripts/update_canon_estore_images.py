#!/usr/bin/env python3
"""
Matchcamera - Canon Korea eStore 공식 이미지 자동 수집기

대상: Canon 바디 / 렌즈 / 배터리
소스: https://estore.kr.canon/

- Canon eStore 통합검색 UI로 상세 페이지를 찾음
- 일반상품을 우선하고 렌즈킷/안심플러스/리퍼비시/사은품을 감점
- image.kr.canon CDN 이미지를 최우선
- WebP 최대 900px
- 바디/렌즈 -> product-images.json
- 배터리 -> batteries.json imageSrc

로그인/CAPTCHA/접근제어를 우회하지 않습니다.
"""
from __future__ import annotations
import argparse, io, json, os, random, re, time, unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin
from PIL import Image, ImageOps

try:
    from playwright.sync_api import sync_playwright
except Exception:
    sync_playwright = None

ROOT=Path(__file__).resolve().parents[1]
PRODUCTS=ROOT/"public/data/products.json"
EXPANSION=ROOT/"public/data/system-expansion.json"
MANIFEST=ROOT/"public/data/product-images.json"
BATTERIES=ROOT/"public/data/batteries.json"
REPORT=ROOT/"public/data/canon-estore-images-report.json"

OUT_PRODUCT=ROOT/"public/assets/images/products/canon"
OUT_BATTERY=ROOT/"public/assets/images/accessories/batteries/canon"
HOME="https://estore.kr.canon/main"

UA=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36")

BAD_PAGE_WORDS=("안심플러스","리퍼비시","refurb","A등급","포장손상","특별 사은품","사은품")
BAD_IMAGE_WORDS=("logo","icon","ico","sprite","arrow","button","btn","banner","event","gift",
                 "coupon","common","loading","footer","header","qr","compare","quick")


def loadj(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default
    except Exception:
        return default

def savej(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    t=p.with_suffix(p.suffix+".tmp")
    t.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    t.replace(p)

def compact(s=""):
    s=unicodedata.normalize("NFKC",str(s or "")).lower()
    s=s.replace("canon","").replace("캐논","")
    return re.sub(r"[^a-z0-9가-힣]+","",s)

def slug(s):
    s=unicodedata.normalize("NFKD",str(s or "canon"))
    s="".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-zA-Z0-9]+","-",s).strip("-").lower()[:120] or "canon"

def label(x):
    return x.get("officialName") or x.get("model") or x.get("modelCode") or x.get("id") or "Canon"

def search_name(x, kind):
    n=label(x)
    n=re.sub(r"^\s*(Canon|캐논)\s+","",n,flags=re.I)
    # body DB sometimes includes "Body"; Canon eStore generally doesn't need it.
    n=re.sub(r"\s+Body\s*$","",n,flags=re.I)
    if kind=="battery":
        return x.get("officialName") or n
    return n.strip()

def merged_products():
    out=[]; seen=set()
    for x in [*loadj(PRODUCTS,[]),*loadj(EXPANSION,[])]:
        k=x.get("id") or (x.get("manufacturer"),x.get("type"),x.get("officialName"))
        if k in seen: continue
        seen.add(k); out.append(x)
    return out

class Browser:
    def __init__(self, visible=False):
        if sync_playwright is None:
            raise RuntimeError("playwright가 없습니다.")
        self.pw=sync_playwright().start()
        self.browser=None
        errors=[]
        for channel in ("chrome","msedge"):
            try:
                self.browser=self.pw.chromium.launch(channel=channel,headless=not visible,
                    args=["--no-first-run","--disable-dev-shm-usage"])
                break
            except Exception as e: errors.append(str(e))
        if not self.browser:
            self.browser=self.pw.chromium.launch(headless=not visible)
        self.ctx=self.browser.new_context(locale="ko-KR",user_agent=UA,
                                          viewport={"width":1600,"height":1200},
                                          device_scale_factor=2)
    def close(self):
        try:self.ctx.close()
        except:pass
        try:self.browser.close()
        except:pass
        try:self.pw.stop()
        except:pass

def open_search(page, query, timeout):
    page.goto(HOME,wait_until="domcontentloaded",timeout=timeout)
    page.wait_for_timeout(900)

    # cookie/event popups are not required; press Escape a few times to clear overlays
    for _ in range(3):
        try: page.keyboard.press("Escape")
        except: pass
        page.wait_for_timeout(100)

    # Search icon/button. Several versions of the site use an img alt="검색".
    clicked=False
    candidates=[
        'img[alt="검색"]',
        'button:has(img[alt="검색"])',
        'a:has(img[alt="검색"])',
        '[aria-label*="검색"]',
    ]
    for sel in candidates:
        try:
            loc=page.locator(sel).first
            if loc.count() and loc.is_visible():
                loc.click(timeout=2500)
                clicked=True
                break
        except: pass

    page.wait_for_timeout(400)

    inp=page.locator('input[placeholder="검색어를 입력해주세요."]:visible')
    if not inp.count():
        # Fallback: click text/button named 통합 검색 or 검색
        for sel in ('text=통합 검색','button:has-text("검색")','a:has-text("검색")'):
            try:
                l=page.locator(sel).first
                if l.count() and l.is_visible():
                    l.click(timeout=1500); page.wait_for_timeout(300)
                    break
            except: pass
        inp=page.locator('input[placeholder="검색어를 입력해주세요."]:visible')

    if not inp.count():
        raise RuntimeError("Canon eStore 검색 입력창을 찾지 못했습니다.")

    inp=inp.last
    inp.fill(query)
    inp.press("Enter")
    page.wait_for_timeout(1300)
    try: page.wait_for_load_state("networkidle",timeout=4500)
    except: pass

def result_links(page):
    return page.evaluate("""() => {
      const seen=new Set(), out=[];
      for(const a of document.querySelectorAll('a[href*="/estore/detailview/"]')){
        const href=a.href;
        if(!href || seen.has(href)) continue;
        seen.add(href);
        let node=a, text='';
        for(let i=0;i<4 && node;i++,node=node.parentElement){
          text += ' ' + (node.innerText || node.textContent || '').slice(0,700);
        }
        out.push({href,text:text.replace(/\\s+/g,' ').trim()});
      }
      return out;
    }""")

def score_result(query, text, href):
    q=compact(query); t=compact(text)
    if not q or not t: return -999
    score=0
    if t==q: score+=1000
    if q in t: score+=500
    # Starts/near exact names are favored
    if t.startswith(q): score+=200
    # Extra kit names can contain the body name, so penalize obvious kit suffixes.
    lower=text.lower()
    for w in BAD_PAGE_WORDS:
        if w.lower() in lower: score-=450
    if re.search(r"\b(18-45|18-150|24-105|24-240|15-45|18-55)\b",lower) and not re.search(r"\b(18-45|18-150|24-105|24-240|15-45|18-55)\b",query.lower()):
        score-=500
    if "/detailview/" in href: score+=40
    return score

def discover_detail(browser, query, timeout):
    page=browser.ctx.new_page(); page.set_default_timeout(timeout)
    try:
        open_search(page,query,timeout)
        links=result_links(page)
        ranked=sorted(((score_result(query,x["text"],x["href"]),x) for x in links),
                      key=lambda z:z[0],reverse=True)
        if not ranked or ranked[0][0] < 200:
            raise RuntimeError(f"정확한 일반상품 상세 페이지를 찾지 못함 ({len(links)}개 후보)")
        return ranked[0][1]["href"], ranked[0][1]["text"], ranked[0][0]
    finally:
        page.close()

def image_candidates(page, query):
    q=compact(query)
    return page.evaluate("""({q,bad})=>{
      const c=s=>String(s||'').toLowerCase().replace(/[^a-z0-9가-힣]+/g,'');
      const out=[];
      [...document.images].forEach((im,i)=>{
        im.dataset.mcCanonCandidate=String(i);
        const src=im.currentSrc||im.src||im.getAttribute('data-src')||'';
        const alt=im.alt||'', title=im.title||'';
        const r=im.getBoundingClientRect();
        let node=im, near='';
        for(let k=0;k<4&&node;k++,node=node.parentElement) near+=' '+(node.innerText||node.textContent||'').slice(0,700);
        const hay=(src+' '+alt+' '+title+' '+near).toLowerCase();
        let score=0;
        if(src.includes('image.kr.canon')) score+=220;
        if(q && c(alt).includes(q)) score+=420;
        if(q && c(near).includes(q)) score+=260;
        const nw=im.naturalWidth||0,nh=im.naturalHeight||0,m=Math.max(nw,nh);
        if(m>=1200)score+=100; else if(m>=700)score+=80; else if(m>=350)score+=55; else if(m>=160)score+=25; else score-=100;
        if(r.width>=180&&r.height>=120)score+=35;
        if(nw&&nh){
          const ratio=Math.max(nw,nh)/Math.max(1,Math.min(nw,nh));
          if(ratio>4)score-=220; else if(ratio<=2.2)score+=30;
        }
        for(const w of bad)if(hay.includes(w))score-=240;
        out.push({i,src,alt,nw,nh,score});
      });
      return out.sort((a,b)=>b.score-a.score);
    }""",{"q":q,"bad":list(BAD_IMAGE_WORDS)})

def direct_image(browser,src,referer,timeout):
    if not src.startswith(("http://","https://")): return None
    try:
        res=browser.ctx.request.get(src,headers={"Referer":referer},timeout=timeout,fail_on_status_code=False)
        if not res.ok:return None
        im=Image.open(io.BytesIO(res.body()));im=ImageOps.exif_transpose(im);im.load()
        return im
    except:return None

def screenshot_image(page,idx):
    try:
        loc=page.locator(f'img[data-mc-canon-candidate="{idx}"]').first
        loc.scroll_into_view_if_needed(timeout=3000)
        data=loc.screenshot(type="png",timeout=6000)
        im=Image.open(io.BytesIO(data));im.load();return im
    except:return None

def extract(browser,url,query,timeout):
    p=browser.ctx.new_page();p.set_default_timeout(timeout)
    try:
        p.goto(url,wait_until="domcontentloaded",timeout=timeout);p.wait_for_timeout(1200)
        title=p.title()
        body=p.locator("body").inner_text(timeout=3000)[:25000]
        if compact(query) not in compact(title+" "+body):
            raise RuntimeError("상세 페이지 제품명이 DB 제품과 맞지 않음")
        cs=image_candidates(p,query)
        for c in cs[:14]:
            if c["score"] < -50: continue
            im=direct_image(browser,c["src"],p.url,timeout)
            method="direct-image"
            if im is None:
                im=screenshot_image(p,c["i"]);method="element-screenshot"
            if im is None: continue
            if max(im.size)<120: continue
            ratio=max(im.size)/max(1,min(im.size))
            if ratio>5: continue
            return dict(image=im,sourcePage=p.url,sourceImage=c["src"],
                        extractMethod=method,score=c["score"])
        raise RuntimeError("제품 이미지 후보를 찾지 못함")
    finally:p.close()

def save_webp(im,out):
    im=ImageOps.exif_transpose(im)
    im.thumbnail((900,900),Image.Resampling.LANCZOS)
    if im.mode not in ("RGB","RGBA"):im=im.convert("RGB")
    out.parent.mkdir(parents=True,exist_ok=True)
    im.save(out,"WEBP",quality=86,method=6)
    return im.size

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--kind",choices=["all","body","lens","battery"],default="all")
    ap.add_argument("--match",default="")
    ap.add_argument("--limit",type=int,default=0)
    ap.add_argument("--replace",action="store_true")
    ap.add_argument("--visible",action="store_true")
    ap.add_argument("--timeout",type=int,default=22000)
    ap.add_argument("--delay",type=float,default=.8)
    ap.add_argument("--dry-run",action="store_true")
    a=ap.parse_args()

    products=merged_products()
    bats=loadj(BATTERIES,[])
    mani=loadj(MANIFEST,{})
    if not isinstance(mani,dict):mani={}
    items=[]
    if a.kind in ("all","body","lens"):
        for x in products:
            if str(x.get("manufacturer","")).lower()!="canon":continue
            if x.get("type") not in ("바디","렌즈"):continue
            k="body" if x.get("type")=="바디" else "lens"
            if a.kind in ("all",k):items.append((k,x))
    if a.kind in ("all","battery"):
        for x in bats:
            if str(x.get("manufacturer","")).lower()=="canon":items.append(("battery",x))
    if a.match:
        q=compact(a.match)
        items=[(k,x) for k,x in items if q in compact(" ".join(str(x.get(v,"")) for v in ("officialName","model","modelCode","id")))]
    if a.limit:items=items[:a.limit]

    print("Selected:",len(items))
    if a.dry_run:
        for k,x in items:print(k,"|",label(x),"| query:",search_name(x,k))
        return

    report=loadj(REPORT,{"items":{}})
    report.setdefault("items",{})
    br=Browser(a.visible)
    ok=skip=fail=0
    try:
        for n,(kind,x) in enumerate(items,1):
            nm=label(x); query=search_name(x,kind)
            print(f"[{n}/{len(items)}] {kind.upper()} | {nm} | {query}")

            if kind in ("body","lens"):
                old=mani.get(nm)
                if not a.replace and isinstance(old,dict) and old.get("method")=="canon-korea-estore" and old.get("src") and (ROOT/"public"/old["src"].lstrip("/")).exists():
                    print("  SKIP");skip+=1;continue
            else:
                if not a.replace and x.get("imageMethod")=="canon-korea-estore" and x.get("imageSrc") and (ROOT/"public"/x["imageSrc"].lstrip("/")).exists():
                    print("  SKIP");skip+=1;continue

            try:
                url,found_text,result_score=discover_detail(br,query,a.timeout)
                print("  DETAIL ->",url)
                got=extract(br,url,query,a.timeout)
                out=(OUT_PRODUCT if kind!="battery" else OUT_BATTERY)/(slug(x.get("id") or query)+".webp")
                w,h=save_webp(got["image"],out)
                src="/"+str(out.relative_to(ROOT/"public")).replace(os.sep,"/")
                now=datetime.now(timezone.utc).isoformat()
                if kind in ("body","lens"):
                    mani[nm]={
                        "src":src,"sourcePage":got["sourcePage"],"sourceImage":got["sourceImage"],
                        "manufacturer":"Canon","width":w,"height":h,
                        "method":"canon-korea-estore","extractMethod":got["extractMethod"],
                        "fetchedAt":now,"usageReviewRequired":True
                    }
                    savej(MANIFEST,mani)
                else:
                    for b in bats:
                        if b.get("id")==x.get("id"):
                            b.update({
                                "imageSrc":src,"imageSourcePage":got["sourcePage"],
                                "imageSourceUrl":got["sourceImage"],"imageMethod":"canon-korea-estore",
                                "imageWidth":w,"imageHeight":h,"imageFetchedAt":now,
                                "imageUsageReviewRequired":True
                            });break
                    savej(BATTERIES,bats)
                report["items"][f"{kind}:{nm}"]={
                    "status":"ok","query":query,"src":src,"sourcePage":got["sourcePage"],
                    "sourceImage":got["sourceImage"],"resultScore":result_score,
                    "imageScore":got["score"],"width":w,"height":h
                }
                print("  OK ->",src);ok+=1
            except Exception as e:
                print("  FAIL ->",type(e).__name__,e);fail+=1
                report["items"][f"{kind}:{nm}"]={"status":"failed","query":query,"reason":str(e)}

            report["_meta"]={"updatedAt":datetime.now(timezone.utc).isoformat(),
                             "selected":len(items),"ok":ok,"skipped":skip,"failed":fail}
            savej(REPORT,report)
            time.sleep(max(0,a.delay)+random.uniform(0,.25))
    finally:br.close()

    savej(MANIFEST,mani);savej(BATTERIES,bats);savej(REPORT,report)
    print(f"DONE ok={ok} skipped={skip} failed={fail}")

if __name__=="__main__":
    main()
