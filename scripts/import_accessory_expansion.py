"""Import reviewed domestic accessory listings. Unknown technical specs stay null.
Input snapshots live in ignored tmp/accessory-expansion; output retains provenance.
"""
import json,re,hashlib,io,requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];INPUT=ROOT/'tmp/accessory-expansion';DATE='2026-09-12'
def read(k):return json.loads((INPUT/(k+'.json')).read_text('utf-8'))
def clean(s):return re.sub(r'\s+',' ',s).strip()
def norm(s):return re.sub('[^a-z0-9]','',s.lower())
def price(r):
 text=r.get('priceText') or r['text'];m=re.search(r'(?:할인판매가|판매가)\s*:\s*([\d,]+)원',text)
 vals=re.findall(r'([\d,]+)\s*원',text)
 return int((m[1] if m else vals[0]).replace(',','')) if m or vals else None

def common(r,brand,id):
 p=price(r);sold=r.get('soldOut') or bool(re.search(r'sold out|품절',r.get('text',''),re.I))
 return dict(id=id,manufacturer=brand,officialName=clean(r['title']),active=True,currentSale='품절' if sold else '판매 페이지 확인',koreaPurchasable=not sold,currentPriceKrw=p if p and p>0 else None,koreaPriceStatus='국내 판매처 표시가',priceType='국내 판매처 표시가',priceSource=r['url'],priceDate=r.get('verifiedAt',DATE),officialSource=r['url'],verifiedAt=DATE,imageSourcePage=r['url'],imageSourceUrl=r.get('image'),imageFetchedAt=DATE,imageMethod='domestic-exact-product-listing',verificationStatus='국내 판매 목록 확인 · 미확인 사양은 공란',sourceType='domestic-listing')
plates=json.loads((INPUT/'plates-before.json').read_text('utf-8'));memories=json.loads((INPUT/'memory-before.json').read_text('utf-8'))
selected=[];excluded=[]
for key in ['photoclam','kpp','benro','take','vanguard','peak','velbon','saeki','asahi','slik-all','sachtler-all']:
 for r in read(key):
  t=clean(__import__('unicodedata').normalize('NFKC',r['title']));brand={'photoclam':'PhotoClam','benro':'Benro','vanguard':'Vanguard','peak':'Peak Design','velbon':'Velbon','saeki':'Manfrotto','slik-all':'SLIK','sachtler-all':'Sachtler'}.get(key)
  if key=='benro' and not t.startswith('벤로'):continue
  if key=='kpp':brand='Leofoto' if '레오포토' in t else 'SmallRig' if '스몰리그' in t else None
  if key=='take':brand='SmallRig' if '스몰리그' in t else None
  if key=='asahi':brand='Gitzo' if '짓조' in t else 'SIRUI' if '시루이' in t else None
  if not brand or not re.search('플레이트|plate|렌즈풋|L 브라켓|퀵슈',t,re.I) or re.search('나사 고정|플레이트용 나사|플레이트 고정|플레이트 나사|리퍼|배터리|볼트|부싱|케이블|아이폰|갤럭시|백플레이트|V마운트|V 락|상단|탑 플레이트|탑플레이트|XLR|고정 나사|고무|핸드 스트랩|스마트폰|돌리|콜드슈|퀵슈.*나사|렌치|Ball Head|Low Profile head|flat top plate',t,re.I):
   excluded.append({'source':key,'name':t,'reason':'다른 브랜드, 플레이트 이외의 제품 또는 부품/리퍼'});continue
  # Some distributor titles use a model code after the Korean label.
  code=r.get('modelCode')
  if brand=='SLIK':
   m=re.search(r'#(\d{4})',t);code=m[1] if m else None
  if brand=='Sachtler':
   code='0164' if 'Sideload plate S' in t else '0364' if 'Go Plate S' in t else '1064' if 'Go Plate 16' in t else '3051' if 'Go Plate 35' in t else None
  if brand=='PhotoClam':m=re.search(r'\b(?:PC[A-Z]?|LB|LP|PCF|PCP)[-][A-Z0-9][-A-Z0-9]*(?: [A-Z0-9][A-Z0-9-]*)*',t,re.I);code=m[0] if m else None
  if brand=='SmallRig':m=re.search(r'(?:스몰리그\s+([A-Z]{0,3}\d{4}[A-Z]?))|\b([A-Z]{0,3}\d{4}[A-Z]?)\s*$',t);code=next((g for g in m.groups() if g),None) if m else None
  if brand=='SIRUI':m=re.search(r'\b(?:TY[- ](?:C[- ]?)?|PH-)\d+[A-Z]?(?:-\d)?|\bTY-(?:BG|LP\d+)',t,re.I);code=m[0] if m else None
  if brand=='Gitzo':m=re.search(r'GS5370[A-Z]*',t);code=m[0] if m else None
  if brand=='Leofoto':m=re.search(r'\b(?:LP[A-Z]?|NF|SF|CF|CFC|PL|NP|DP|VR|QF|UL|MP|PS|DA|DL|LB|LPS|BPL|TP)[-][A-Z0-9][-A-Z0-9]*',t);code=m[0] if m else None
  if brand=='Benro':m=re.search(r'\b(?:MPU|PU|QR|BL|ACSM)[A-Z0-9]+(?:\sPRO)?',t);code=m[0] if m else None
  if brand=='Vanguard':m=re.search(r'QS-\d+(?:S|\sV2)?',t);code=m[0] if m else None
  if brand=='Velbon':m=re.search(r'QB-[A-Z0-9]+',t);code=m[0] if m else None
  if brand=='Peak Design':code={'스탠다드 플레이트 블랙':'PL-S-3','듀얼 플레이트 블랙':'PL-D-2','필드 플레이트 블랙':'field-plate'}.get(t)
  identity=norm(code or t)
  if brand in ['Leofoto','PhotoClam']:identity=r['url']
  # Keep color variants distinct, but collapse identical model listings from multiple sellers.
  if brand=='Leofoto' and re.search('퍼플|실버|오렌지|블랙|레드',t):identity+='-'+next(x for x in ['퍼플','실버','오렌지','블랙','레드'] if x in t)
  if any(x.get('_identity')==brand+identity for x in selected):continue
  old=next((x for x in plates if x['manufacturer']==brand and code and norm(code)==norm(x.get('modelCode') or x['id'].replace('photoclam-',''))),None)
  rid=old['id'] if old else brand.lower().replace(' ','-')+'-plate-'+hashlib.sha256((brand+identity).encode()).hexdigest()[:12]
  row=common(r,brand,rid);row['modelCode']=code;row['_identity']=brand+identity
  row.update(plateType='lens-plate' if re.search('렌즈|렌즈풋',t) else 'l-bracket' if re.search(r'L\s?플레이트|L 브라켓|엘마운트',t) else 'camera-plate',standard=None,cameraMount=None,weightG=None,compatibleModels=[])
  if re.search('Arca|알카\s?스위스|도브테일',t,re.I):row['standard']='Arca-Swiss' if re.search('Arca|알카\s?스위스',t,re.I) else None
  if re.search('1/4',t):row['cameraMount']='1/4-inch'
  if old:
   for k in ['standard','cameraMount','weightG','compatibleModels','plateType']:row[k]=old.get(k,row[k])
  selected.append(row)
for row in selected:
 row.pop('_identity',None);old=next((r for r in plates if r['id']==row['id']),None)
 if old:old.update(row)
 else:plates.append(row)
# Capacity-specific card SKUs; never classify microSD or readers as full-size cards.
for r in read('lexar'):
 t=clean(r['title'])
 if re.search('micro|마이크로|리더|리퍼',t,re.I) or not re.search('UHS-II|CFexpress',t,re.I):continue
 cap=re.search(r'(\d+)\s*(GB|TB)\s*$',t,re.I)
 if not cap:continue
 gb=int(cap[1])*(1000 if cap[2].upper()=='TB' else 1);sd='UHS-II' in t;type='SDXC' if sd else 'CFexpress Type A' if re.search(r'Type\s*A\b',t,re.I) else 'CFexpress Type B'
 no=re.search(r'product_no=(\d+)',r['url'])[1];rid='lexar-kr-'+no
 if '2000x' in t.lower() and gb==128:rid='lexar-2000x-sd-v90-128'
 row=common(r,'Lexar',rid);row.update(cardType=type,bus='UHS-II' if sd else 'PCIe',capacityGb=gb,readMbps=None,writeMbps=None,speedClass=None,vpg=None)
 row['officialName']=clean(re.sub(r'^.*?(?=Lexar)', '',t))
 if not sd and '4.0' in t and '4.0' not in row['officialName']:row['officialName']=row['officialName'].replace('CFexpress','CFexpress 4.0')
 if sd:
  row['speedClass']='U3 / V90' if '2000x' in t.lower() else 'U3 / V60'
  if '2000x' in t.lower():row.update(readMbps=300,writeMbps=260,specificationSource='https://americas.lexar.com/product/lexar-professional-2000x-sdhc-sdxc-uhs-ii-card-gold-series/')
  # Other families have multiple revisions; retain null until exact packaging/spec is reviewed.
 # Per-capacity labels were visually reviewed in the distributor's product images.
 if sd and '2000x' not in t.lower():
  row['readMbps']=280
  row['writeMbps']=({64:130,128:120}.get(gb,160) if 'silver' in t.lower() else 210 if gb in [64,128] else 205)
  row['specificationSource']=r['image'];row['specificationNote']='해당 용량의 국내 판매 제품 라벨 기준 최대 속도. 세대·리비전에 따라 달라질 수 있습니다.'
 if not sd:
  lower=t.lower()
  if type.endswith('A'):
   row['vpg']=200 if 'silver' in lower else 400
   if '4.0' in lower:row.update(readMbps=1750 if 'silver' in lower else 1800,writeMbps=1650)
   else:row.update(readMbps=900,writeMbps=800)
  elif '4.0' in lower:
   row.update(readMbps=3700 if 'diamond' in lower else 3600,writeMbps=3400 if 'diamond' in lower else 3000 if 'silver' in lower else 3300)
   if 'diamond' in lower:row['vpg']=400
  else:row['readMbps']=1900 if gb==2000 and 'gold' in lower else 1750
  row['speedClass']=('VPG'+str(row['vpg'])) if row['vpg'] else None
  row['specificationSource']=r['image'];row['specificationNote']='해당 용량의 국내 판매 제품 라벨 기준 최대 속도. 미확인 쓰기 속도는 표시하지 않습니다.'
  if type.endswith('A') and '4.0' not in lower:row['specificationSource']='https://resources.lexar.com/download/205/lexar-brochure/14645/lexar-brochure-en-2025q3.pdf'
 old=next((x for x in memories if x['id']==rid),None)
 if old:old.update(row)
 else:memories.append(row)
# Download source product thumbnails without substituting a different model/capacity.
photos=[r for r in plates+memories if r.get('imageFetchedAt')==DATE and r.get('imageSourceUrl')]
folder=ROOT/'public/assets/images/accessories/catalog-20260912';folder.mkdir(parents=True,exist_ok=True)
def photo(row):
 path=folder/(row['id']+'.webp')
 try:
  if not path.exists():
   response=requests.get(row['imageSourceUrl'].replace('http://','https://'),headers={'User-Agent':'Mozilla/5.0','Referer':row['imageSourcePage']},timeout=25);response.raise_for_status();im=Image.open(io.BytesIO(response.content));im.thumbnail((700,700));im.convert('RGBA').save(path,'WEBP',quality=90)
  with Image.open(path) as im:row.update(imageSrc='/'+path.relative_to(ROOT/'public').as_posix(),imageWidth=im.width,imageHeight=im.height)
 except Exception as e:return row['id'],str(e)
 return None
with ThreadPoolExecutor(8) as pool:errors=[r for r in pool.map(photo,photos) if r]
for name,rows in [('plates',plates),('memory-cards',memories)]:
 (ROOT/('public/data/'+name+'.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n','utf-8')
(INPUT/'import-review.json').write_text(json.dumps({'plates':len(plates),'memoryCards':len(memories),'excluded':excluded,'photoErrors':errors},ensure_ascii=False,indent=2),'utf-8')
print('plates',len(plates),'memory',len(memories),'photo errors',errors)
