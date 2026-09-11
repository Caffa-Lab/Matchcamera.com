"""Review candidates from the complete Saeki Korean tripod search catalog.
Uses exact manufacturer SKU matches for load specifications; never infers a load.
"""
import sys,json,re,requests,time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from bs4 import BeautifulSoup
from urllib.parse import quote
sys.stdout.reconfigure(encoding='utf-8')
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'tmp/saeki';OUT.mkdir(parents=True,exist_ok=True)
def html(url):
 p=OUT/('page-'+__import__('hashlib').sha256(url.encode()).hexdigest()[:20]+'.html')
 if p.exists():return BeautifulSoup(p.read_text(encoding='utf-8'),'html.parser')
 r=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'});r.raise_for_status();r.encoding='utf-8';p.write_text(r.text,encoding='utf-8');return BeautifulSoup(r.text,'html.parser')
def num(lines,labels,unit):
 for i,line in enumerate(lines):
  if line.rstrip(':').strip().lower() in [x.lower() for x in labels]:
   m=re.search(r'([\d.]+)\s*('+unit+r')\b',' '.join(lines[i+1:i+3]),re.I)
   if m:return float(m[1]),m[2]
 return None
def collect(row):
 path=OUT/(row['id']+'.json')
 if path.exists():return json.loads(path.read_text(encoding='utf-8'))
 result={**row,'saleSource':'https://www.saeki.co.kr/item/itemDetail?itemId='+row['id']}
 try:
  s=html(result['saleSource']);text=s.get_text('\n',strip=True)
  pairs={tr.find('th').get_text(' ',strip=True):tr.find('td').get_text(' ',strip=True) for tr in s.select('tr') if tr.find('th') and tr.find('td')}
  code=pairs.get('제조사코드','').strip();result['modelCode']=code;result['domesticDetails']=pairs
  if not code or ' ' in code:raise ValueError('Exact manufacturer SKU not available')
  brand={'GITZO':'Gitzo','Manfrotto':'Manfrotto'}.get(row['brand'])
  if not brand:raise ValueError('Additional manufacturer specification review needed')
  host='www.'+brand.lower()+'.com';search='https://'+host+'/global-en/catalogsearch/result/?q='+quote(code)
  ss=html(search);urls=list(dict.fromkeys(a['href'] for a in ss.select('a[href]') if a['href'].lower().rstrip('/').endswith('-'+code.lower())))
  if not urls and brand=='Gitzo':
   search='https://'+host+'/us-en/catalogsearch/result/?q='+quote(code);ss=html(search);urls=list(dict.fromkeys(a['href'] for a in ss.select('a[href]') if a['href'].lower().rstrip('/').endswith('-'+code.lower())))
  if not urls:raise ValueError('Exact SKU manufacturer page not found')
  official=urls[0];sp=html(official);lines=sp.get_text('\n',strip=True).splitlines();result['officialSource']=official
  load=num(lines,['Safety Payload UNI/PdR 105:2021','Safety Payload Weight','Safety Payload','Payload','Maximum Payload','Maximum Load','Load Capacity'],'kg')
  if not load:raise ValueError('Official numeric load not confirmed')
  result['maxLoadKg']=load[0];result['specificationText']='\n'.join(lines[lines.index('Specifications'):] if 'Specifications' in lines else lines)
  for key,labels,units in [('weightKg',['Weight'],'kg'),('maxHeightMm',['Maximum Height'],'cm|mm'),('foldedLengthMm',['Closed Length'],'cm|mm')]:
   value=num(lines,labels,units)
   if value:result[key]=value[0]*(10 if value[1]=='cm' else 1)
  result['status']='verified'
 except Exception as e:result['status']='needs-review';result['reason']=str(e)
 path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
if __name__=='__main__':
 allrows=json.loads((OUT/'catalog.json').read_text(encoding='utf-8'));brands={'Manfrotto','GITZO','SmallRig','Sachtler','Vanguard','SIRUI','Leofoto','Benro','SLIK','Velbon','PhotoClam','Peak Design'}
 rows=[r for r in allrows if r['brand'] in brands and ((r['category'][0]=='삼각대' and r['category'][1] in ['키트','삼각대 단품','헤드']) or (r['category'][1]=='비디오 삼각대' and r['category'][2] in ['키트','삼각대','헤드']))]
 (OUT/'candidates.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
 results=[]
 with ThreadPoolExecutor(4) as pool:
  for f in as_completed([pool.submit(collect,r) for r in rows]):
   result=f.result();results.append(result)
   if len(results)%10==0:print(len(results),'/',len(rows),'verified',sum(r['status']=='verified' for r in results),flush=True)
 (OUT/'review.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
 print('DONE',len(results),sum(r['status']=='verified' for r in results),flush=True)
