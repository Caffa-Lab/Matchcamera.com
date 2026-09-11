"""Import domestic listings only with exact model identification and documented payload.
No mount, kit payload, or product availability is inferred from brand alone.
"""
from pathlib import Path
from urllib.parse import urlparse
import re,json,io,requests
from bs4 import BeautifulSoup
from PIL import Image,ImageOps
from concurrent.futures import ThreadPoolExecutor
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'public/data';T=ROOT/'tmp';DATE='2026-09-11'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def code(s):return re.sub(r'[^A-Z0-9]','',s.upper())
def value(text,label,units='kg'):
 m=re.search(label+r'\s*:?\s*(\d+(?:\.\d+)?)\s*('+units+r')\b',text,re.I)
 return float(m[1])*(10 if m[2].lower()=='cm' else 1) if m else None
def base(brand,model,title,url,price):
 return {'id':brand.lower().replace(' ','-')+'-'+re.sub(r'[^a-z0-9]+','-',model.lower()).strip('-'),'manufacturer':brand,'officialName':title,'modelCode':model,'verifiedAt':DATE,'currentSale':'국내 판매 페이지 확인','koreaPurchasable':True,'saleSource':url,'currentPriceKrw':price or None,'koreaPriceStatus':'국내 판매처 표시 가격' if price else '한국 가격 미확인','priceSource':url,'priceDate':DATE}
def mount_value(text,label):
 m=re.search(re.escape(label)+r'\s*:?\s*([^\n]+)',text,re.I)
 if not m:return None
 if '3/8' in m[1]:return '3/8-16'
 if '1/4' in m[1]:return '1/4-20'
 return None
def import_saeki():
 out=[]
 for r in read(T/'saeki/review.json'):
  if r['status']!='verified' or r['category'][-1] in ['모노포드','기타헤드'] or r['modelCode']=='809':continue
  brand='Gitzo' if r['brand']=='GITZO' else 'Manfrotto';model=r['modelCode'];text=r['specificationText'];head=r['category'][1]=='헤드'
  p=base(brand,model,model,r['saleSource'],int(re.sub(r'[^0-9]','',r.get('price','')) or 0));p['koreaPriceStatus']='한국 공식 수입사 표시 정가';p['imageRemote']=r['image'];p['officialSource']=r['officialSource']
  for k in ['maxLoadKg','weightKg','maxHeightMm','foldedLengthMm']:
   if r.get(k) is not None:p[k]=r[k]
  material=re.search(r'\nMaterial\s*\n([^\n]+)',text)
  if material:p['material']=material[1]
  if head:
   p['headType']='ball-head' if r['category'][-1]=='Ball헤드' else 'pan-tilt-head';p['tripodMount']=mount_value(text,'Base Type') or mount_value(text,'Bottom Attachment')
   plate=re.search(r'\nPlate Type\s*\n([^\n]+)',text)
   if plate:p['includedPlate']=plate[1]
  else:
   integrated=bool(re.search(r'PIXI|MP3|MKCONVR|MKELE',model));p['kind']='tripod-kit' if integrated else 'tripod-legs';p['headMount']=None if integrated else mount_value(text,'Top Attachment')
   if integrated:p['note']='기본 헤드 포함. 별도 헤드 교체 규격은 공식 자료 확인 필요.'
  out.append(p)
 return out
def import_leofoto():
 official=read(T/'domestic/leofoto-products.json');out=[];review=[]
 for catalog in ['kpp','kpp-head','kpp-video']:
  for r in read(T/('domestic/'+catalog+'-catalog.json')):
   if 'LEOFOTO' not in r['text'].upper() and '레오포토' not in r['title']:continue
   title=r['title'];head=catalog=='kpp-head'
   if re.search(r'모노포드|총기|스파이크|플레이트|스트랩|그립|어댑터|볼\s*베이스|연장|가방',title):continue
   models=re.findall(r'(?<![A-Z0-9])(?:[A-Z]{1,4}-\d{2,4}[A-Z0-9]*|XB\d{2})(?![A-Z0-9])',title.upper())
   if not models:continue
   if "+" in title and len(models)<len(title.split("+")):continue
   matches=[]
   for p in official:
    # All kit components must be named in the same official listing.
    tokens=re.findall(r'(?<![A-Z0-9])(?:[A-Z]{1,4}-\d{2,4}[A-Z0-9]*|XB\d{2})(?![A-Z0-9])',p['title'].upper())
    if set(models)==set(tokens):matches.append(p)
   if len(matches)!=1:review.append({'title':title,'reason':'Exact single-model/kit listing not found'});continue
   src=matches[0];html=BeautifulSoup(src.get('body_html') or '', 'html.parser');text=html.get_text('\n',strip=True)
   # Do not confuse revised X/PRO products with an older Korean SKU.
   if any(m+'X' in text.upper() or m+'PRO' in text.upper() for m in models):continue
   loads=re.findall(r'(?:Max\.?\s*(?:load|payload)|Load Capacity|Safety Payload)[^\d\n]{0,18}(\d+(?:\.\d+)?)\s*kg',text,re.I)
   if not loads:review.append({'title':title,'reason':'Metric payload not confirmed'});continue
   if len(models)>1 and len(loads)<len(models):review.append({'title':title,'reason':'All kit component payloads not confirmed'});continue
   price=re.search(r'([\d,]+)원',r['text']);p=base('Leofoto','+'.join(models),' + '.join(models),r['url'],int(price[1].replace(',','')) if price else None)
   p['maxLoadKg']=min(float(n) for n in loads);p['officialSource']='https://leofotousa.com/products/'+src['handle'];p['imageRemote']=r['image'];p['kind']='tripod-kit' if len(models)>1 else 'tripod-legs'
   if head:p.pop('kind');p['headType']='fluid-head' if any(m.startswith(('BV-','FH-')) for m in models) else 'ball-head'
   if len(models)==1:
    p['weightKg']=value(text,r'Weight','kg');p['maxHeightMm']=value(text,r'Max\.?\s*height','mm|cm');p['foldedLengthMm']=value(text,r'Folded\s*length','mm|cm')
   if len(models)>1:p['note']='허용 하중은 공식 자료에서 확인된 구성품 중 낮은 한도를 적용합니다.';p['includedHead']={'officialName':models[-1],'manufacturer':'Leofoto','maxLoadKg':p['maxLoadKg']}
   out.append(p)
 (T/'leofoto-unverified.json').write_text(json.dumps(review,ensure_ascii=False,indent=2),encoding='utf-8')
 return out
def image(p):
 url=p.pop('imageRemote',None)
 if not url:return
 try:
  r=requests.get(url,headers={'User-Agent':'Mozilla/5.0','Referer':p['saleSource']},timeout=20);r.raise_for_status();im=ImageOps.exif_transpose(Image.open(io.BytesIO(r.content))).convert('RGBA');im.thumbnail((800,800))
  if min(im.size)<70:return
  dest=ROOT/('public/assets/images/accessories/support/'+p['id']+'.webp');dest.parent.mkdir(parents=True,exist_ok=True);im.save(dest,'WEBP',quality=90)
  p.update(imageSrc='/assets/images/accessories/support/'+dest.name,imageSourcePage=p['saleSource'],imageSourceUrl=url,imageFetchedAt=DATE,imageMethod='exact-domestic-model',imageUsageReviewRequired=True)
 except Exception as e:print('Image unavailable',p['id'],type(e).__name__)
if __name__=='__main__':
 candidates=import_saeki()+import_leofoto();candidates=list({(p['manufacturer'],p['modelCode']):p for p in candidates}.values())
 with ThreadPoolExecutor(8) as pool:list(pool.map(image,candidates))
 report=[]
 for name in ['tripods','heads']:
  path=D/(name+'.json');rows=read(path)
  for p in candidates:
   if ('kind' in p)!=(name=='tripods'):continue
   old=next((r for r in rows if r['manufacturer']==p['manufacturer'] and (code(r.get('modelCode',''))==code(p['modelCode']) or r['id']==p['id'])),None)
   if old:
    p['id']=old['id'];old.update({k:v for k,v in p.items() if v is not None})
   else:rows.append(p)
   report.append({'id':p['id'],'source':p['officialSource'],'saleSource':p['saleSource'],'maxLoadKg':p['maxLoadKg']})
  path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 (T/'support-import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Verified domestic products imported:',len(report))
