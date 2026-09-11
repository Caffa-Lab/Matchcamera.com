from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import json,re,requests,bs4
from import_korean_support_catalog import base,image,code,read
ROOT=Path(__file__).resolve().parents[1];T=ROOT/'tmp/domestic';D=ROOT/'public/data'
def norm(s):return re.sub(r'\s+',' ',s).strip().lower()
def slik():
 ps=read(T/'slikusa.com.txt')['products'];out=[]
 for r in read(T/'slik-catalog.json'):
  name=r['title'].removeprefix('슬릭 ')
  if re.search(r'Foot|Plate|Case|Strap|POLE|패키지|페키지|Standpod',name,re.I):continue
  plain=re.sub(r'\s+',' ',name).strip();matches=[]
  for p in ps:
   if re.search(r'refurbished',p['title'],re.I):continue
   title=re.sub(r'\s+',' ',p['title'])
   if not re.search(r'^SLIK\s+(?:CLOSE[ -]OUT\s*[- ]*)?'+re.escape(plain)+r'(?![A-Za-z0-9-])',title,re.I):continue
   if plain in ['PRO AL-323','PRO AL-324'] and not re.search(r'Leg Only',title,re.I):continue
   matches.append(p)
  if len(matches)!=1:continue
  src=matches[0];text=bs4.BeautifulSoup(src['body_html'],'html.parser').get_text('\n',strip=True)
  if 'SPECS' not in text:continue
  spec=text.split('SPECS')[-1];m=re.search(r'Maximum Load\s*\n([^\n]+)',spec,re.I)
  if not m:continue
  kg=re.search(r'(\d+(?:\.\d+)?)\s*kg',m[1],re.I);lb=re.search(r'(\d+(?:\.\d+)?)\s*lbs?',m[1],re.I)
  if not kg and not lb:continue
  p=base('SLIK',plain,plain,r['url'],int(r.get('price') or 0));p.update(maxLoadKg=float(kg[1]) if kg else round(float(lb[1])*.45359237,3),officialSource='https://slikusa.com/products/'+src['handle'],imageRemote=r['image'],koreaPriceStatus='한국 공식 수입사 표시 정가')
  if re.search(r'^(?:SH|SBH)-',plain):p['headType']='ball-head' if plain.startswith('SBH') else 'pan-tilt-head'
  else:p['kind']='tripod-legs' if re.search(r'Legs? Only',src['title'],re.I) else 'tripod-kit'
  for k,label in [('maxHeightMm','Max Height (Column Up)'),('foldedLengthMm','Folded Length')]:
   m=re.search(re.escape(label)+r'\s*\n(\d+(?:\.\d+)?)\s*"',spec)
   if m:p[k]=round(float(m[1])*25.4,1)
  out.append(p)
 return out
def sachtler():
 official=[]
 for q in ['aktiv6','aktiv8','FSB 6','FSB 8','Ace M','Ace XL']:
  u='https://www.sachtler.com/wp-json/wp/v2/search';r=requests.get(u,params={'search':q,'per_page':100},timeout=20)
  if r.ok:official+=r.json()
 official=list({p['id']:p for p in official if p['subtype']=='product'}.values());out=[]
 def clean(s):return re.sub(r'[^a-z0-9]','',s.lower().replace('mk ll','mk ii').replace('system',''))
 for row in read(T/'sachtler-catalog.json'):
  matches=[p for p in official if p['title'].lower().startswith('system') and clean(p['title']) in clean(row['title'])]
  if len(matches)!=1:continue
  src=matches[0];url=src['url'];r=requests.get(url,timeout=20);s=bs4.BeautifulSoup(r.text,'html.parser');text=s.get_text('\n',strip=True)
  if 'Technical Specifications' not in text:continue
  spec=text.split('Technical Specifications',1)[1].split('Diagrams')[0];load=re.search(r'Payload[^\n]*\n(?:[\d.]+ kg to )?([\d.]+) kg',spec)
  if not load:continue
  prices=re.findall(r'([\d,]+)원',row['text']);p=base('Sachtler',src['title'],src['title'],row['url'],int(prices[0].replace(',','')) if prices else None);p.update(kind='tripod-kit',maxLoadKg=float(load[1]),officialSource=url,imageRemote=row['image'],note='하중 한도는 제조사의 무게중심 조건을 함께 확인하세요.')
  for k,label,factor in [('weightKg','Weight',1),('foldedLengthMm','Transport Length',10)]:
   m=re.search(label+r'\n([\d.]+) (?:kg|cm)',spec)
   if m:p[k]=float(m[1])*factor
  head=re.search(r'Fluid Head\n([^\n]+)',spec)
  if head:p['includedHead']={'manufacturer':'Sachtler','officialName':head[1],'headType':'fluid-head','maxLoadKg':p['maxLoadKg']}
  out.append(p)
 return out
def merge(products):
 with ThreadPoolExecutor(8) as pool:list(pool.map(image,products))
 for name in ['tripods','heads']:
  path=D/(name+'.json');rows=read(path)
  for p in products:
   if ('kind' in p)!=(name=='tripods'):continue
   old=next((r for r in rows if r['id']==p['id']),None)
   if old:old.update(p)
   else:rows.append(p)
  path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':
 products=slik()+sachtler();products=list({p['id']:p for p in products}.values());merge(products);print('Additional verified supports',len(products))
