"""Cache public manufacturer pages and structured tables for a reviewable specification audit.
This collector never changes published product data.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from urllib.parse import urljoin,urlparse
import requests,json,hashlib,threading,re
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tmp/catalog-sources';OUT.mkdir(parents=True,exist_ok=True)
images=json.loads((ROOT/'public/data/product-images.json').read_text(encoding='utf-8'))
locks={};guard=threading.Lock()
def fetch(url):
 key=hashlib.sha256(url.encode()).hexdigest()[:20];path=OUT/(key+'.json')
 if path.exists():return json.loads(path.read_text(encoding='utf-8'))
 with guard: sem=locks.setdefault(urlparse(url).netloc,threading.Semaphore(2))
 try:
  with sem:r=requests.get(url,timeout=18,headers={'User-Agent':'Mozilla/5.0'})
  r.encoding=r.apparent_encoding if r.encoding in ('ISO-8859-1',None) else r.encoding
  soup=BeautifulSoup(r.text,'html.parser');rows=[]
  for row in soup.select('tr'):
   cells=[c.get_text(' ',strip=True) for c in row.find_all(['th','td'],recursive=False)]
   if len(cells)>=2:rows.append(cells)
  for dt in soup.select('dt'):
   dd=dt.find_next_sibling('dd')
   if dd:rows.append([dt.get_text(' ',strip=True),dd.get_text(' ',strip=True)])
  links=[urljoin(r.url,a['href']) for a in soup.select('a[href]') if re.search(r'specifications?|technical\s+data|仕様|主な仕様|사양|스펙',a.get_text(' ',strip=True),re.I)]
  og=soup.select_one('meta[property="og:image"]')
  for el in soup.select('script,style,nav,footer,header'):el.decompose()
  d={'url':url,'resolvedUrl':r.url,'status':r.status_code,'title':soup.title.get_text(' ',strip=True) if soup.title else '', 'rows':rows,'specLinks':list(dict.fromkeys(links))[:12],'image':urljoin(r.url,og.get('content','')) if og else '', 'text':soup.get_text('\n',strip=True)[:180000]}
 except Exception as e:d={'url':url,'status':0,'error':str(e)}
 path.write_text(json.dumps(d,ensure_ascii=False),encoding='utf-8');return d
if __name__=='__main__':
 urls=list(dict.fromkeys(x.get('sourcePage') for x in images.values() if isinstance(x,dict) and x.get('sourcePage')))
 with ThreadPoolExecutor(12) as pool:
  futures={pool.submit(fetch,u):u for u in urls}
  for i,f in enumerate(as_completed(futures),1):
   d=f.result()
   if i%40==0:print(i,'/',len(urls),'pages',flush=True)
 print('Source cache complete',len(urls),flush=True)
