import json,re
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from collect_catalog_sources import fetch
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'public/data'
products=sum([json.loads((D/(n+'.json')).read_text(encoding='utf-8')) for n in ['products','system-expansion','official-partner-products','hasselblad-products']],[])
extra=json.loads((ROOT/'tmp/extra-spec-sources.json').read_text(encoding='utf-8')) if (ROOT/'tmp/extra-spec-sources.json').exists() else {}
def job(p):
 name=p['officialName'].removeprefix('Canon ').lower();slug=re.sub(r'[^a-z0-9-]+','-',name).strip('-')
 urls=[]
 if p['type']=='바디':urls=['https://asia.canon/en/consumer/'+slug+'/body/specification']
 else:
  # Canon Asia writes the f-number and L suffix together in product slugs.
  slug=re.sub(r'-f(?=\d)','-f-',slug).replace('-l-','l-');urls=['https://asia.canon/en/consumer/'+slug+'/main/specification']
 valid=[]
 for u in urls:
  page=fetch(u)
  if page['status']==200 and len(page.get('rows',[]))>5 and slug.split('/')[0].replace('-','') in re.sub(r'[^a-z0-9]','',page.get('title','').lower()):valid.append(u)
 return p['id'],valid
rows=list({p['id']:p for p in products if p['manufacturer']=='Canon' and p.get('cameraSystem')!='DSLR'}.values())
with ThreadPoolExecutor(8) as pool:
 for i,f in enumerate(as_completed([pool.submit(job,p) for p in rows]),1):
  k,v=f.result()
  if v:extra[k]=v
  if i%25==0:print(i,len(rows),'verified pages',len(extra),flush=True)
(ROOT/'tmp/extra-spec-sources.json').write_text(json.dumps(extra,ensure_ascii=False,indent=2),encoding='utf-8')
print('DONE',len(extra),flush=True)
