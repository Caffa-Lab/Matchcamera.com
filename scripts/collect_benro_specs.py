from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from urllib.parse import quote,urlparse
import requests,bs4,re,json,hashlib
from import_korean_support_catalog import base,image,code
ROOT=Path(__file__).resolve().parents[1];T=ROOT/'tmp';C=T/'benro';C.mkdir(exist_ok=True)
def get(url):
 f=C/(hashlib.sha256(url.encode()).hexdigest()[:20]+'.html')
 if f.exists():return bs4.BeautifulSoup(f.read_text(encoding='utf-8'),'html.parser')
 r=requests.get(url,timeout=15,headers={'User-Agent':'Mozilla/5.0'});r.raise_for_status();f.write_text(r.text,encoding='utf-8');return bs4.BeautifulSoup(r.text,'html.parser')
def collect(r):
 title=r['title'];models=re.findall(r'(?<![A-Za-z0-9])(?:[A-Z]{1,8}\d[A-Z0-9-]*)(?![A-Za-z0-9])',title)
 if len(models)!=1:return None
 model=models[0];result={'title':title,'modelCode':model,'status':'unverified'}
 for host in ['https://benrousa.com','https://uk.benroeu.com']:
  try:
   s=get(host+'/search.php?search_query='+quote(model));urls=list(dict.fromkeys(a['href'].split('?')[0] for a in s.select('.card-title a[href]')))
   for url in urls[:7]:
    page=get(url);view=page.select_one('.productView');vt=view.get_text(' ',strip=True) if view else '';sku=re.search(r'SKU:\s*([A-Z0-9-]+)',vt)
    if not sku or code(sku[1])!=code(model):continue
    pairs={dt.get_text(' ',strip=True).rstrip(':'):dt.find_next_sibling().get_text(' ',strip=True) for dt in page.select('dt') if dt.find_next_sibling()}
    load=pairs.get('Maximum Payload Capacity (kg)')
    if not load or not re.fullmatch(r'\d+(\.\d+)?',load):continue
    prices=re.findall(r'([\d,]+)원',r['text']);p=base('Benro',model,model,r['url'],int(prices[0].replace(',','')) if prices else None);p.update(officialSource=url,maxLoadKg=float(load),koreaPriceStatus='한국 공식 수입사 표시 정가',specificationDetails=pairs)
    for k,label,factor in [('weightKg','Product Weight (kg)',1),('maxHeightMm','Maximum Height (cm)',10),('foldedLengthMm','Closed Length (cm)',10)]:
     v=pairs.get(label)
     if v and re.fullmatch(r'\d+(\.\d+)?',v):p[k]=float(v)*factor
    p['material']=pairs.get('Leg Material')
    if '삼각대' in title or 'tripod' in vt[:130].lower():p['kind']='tripod-legs' if '다리만' in title or 'tripod only' in vt.lower() else 'tripod-kit'
    else:p['headType']='fluid-head' if '비디오' in title else 'gimbal-head' if '짐벌' in title else 'ball-head'
    mount=pairs.get('Head Mount' if 'kind' in p else 'Base Mount Thread','')
    if mount:p['headMount' if 'kind' in p else 'tripodMount']='3/8-16' if '3/8' in mount else '1/4-20' if '1/4' in mount else None
    og=page.select_one('meta[property="og:image"]')
    if og:p['imageRemote']=og['content']
    result.update(status='verified',product=p);return result
  except Exception as e:result['reason']=str(e)
 return result
if __name__=='__main__':
 rows=sum([json.loads((T/('domestic/'+n+'-catalog.json')).read_text(encoding='utf-8')) for n in ['benro','benro-head']],[])
 rows=[r for r in rows if '벤로' in r['title'] and re.search(r'삼각대|헤드',r['title']) and not re.search(r'리퍼|전시|플레이트|컬럼|연장|가방|모노포드|고무발|렌치|센터봉',r['title'])];rows=list({r['title']:r for r in rows}.values());results=[]
 with ThreadPoolExecutor(6) as pool:
  for i,f in enumerate(as_completed([pool.submit(collect,r) for r in rows]),1):
   x=f.result()
   if x:results.append(x)
   if i%20==0:print(i,len(rows),'verified',sum(x['status']=='verified' for x in results),flush=True)
 (T/'benro-review.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8');print('DONE',len(results),sum(x['status']=='verified' for x in results),flush=True)
