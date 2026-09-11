"""Import only recognized factual specification rows from exact manufacturer pages.
Raw cache and field-level sources make every update reproducible. Unknowns stay unknown.
"""
import json,re,hashlib,unicodedata
from pathlib import Path
from urllib.parse import urljoin,urlparse
ROOT=Path(__file__).resolve().parents[1];DATA=ROOT/'public/data';CACHE=ROOT/'tmp/catalog-sources'
FILES=['products','system-expansion','official-partner-products','hasselblad-products']
def norm(s):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',s)).strip().lower()
GROUPS={
 '유효 화소(MP)':['Effective pixels','Effective Pixels (Megapixels)','カメラ有効画素数','有効画素数','유효 화소 수','유효 화소'],
 '총 화소(MP)':['Total pixels','総画素数','총 화소'],
 '센서 크기':['Sensor Size','Image Sensor Size'],
 '센서 종류':['Image sensor','Image Sensor Type','撮像素子','센서','이미지 센서'],
 '이미지 프로세서':['Processor Type','Image processor','Image Processing Engine','화상 처리 엔진','画像処理エンジン'],
 '손떨림 보정 상세':['In-body Image Stabilizer (sensor shift IS)','Image Stabilization','Image Stabilisation','Vibration reduction','手ブレ補正','방식 / 보정효과','손떨림 보정'],
 'AF 방식':['Autofocus','Autofocus system','AF System','Focus type','AF 방식'],
 'AF 포인트 상세':['AF points','AF System Points','Focus points','測距点数','초점 영역 선택'],
 'ISO 감도':['Effective ISO','ISO sensitivity (Recommended Exposure Index)','ISO speed (Recommended exposure index)','Sensitivity','Sensitivity (Standard output)','감도'],
 '연속촬영 상세':['Continuous shooting speed','Continuous Shooting Speed (Shots Per Sec) (Up To)','Approximate frame advance rate','Frame advance rate','Continuous shooting','연사'],
 '사진 기록 형식':['Still Image Format','Image type','画像ファイル形式','기록 방식','기록 포맷'],
 '사진 해상도 상세':['Image Resolution','Image size (pixels)','기록 화소 수','記録画素数 [3:2]'],
 '동영상 기록 상세':['Frame size (pixels) and frame rate','Movie Format','Movie recording size','Video Quality','동영상','Movie'],
 '메모리카드 종류':['Memory Card Type','Media','Recording media','Storage media','Storage Medium','기록 매체','記録媒体'],
 'USB 종류':['USB','USB interface','Digital terminal','USB端子'],
 'HDMI 종류':['HDMI output','HDMI mini OUT terminal','HDMI端子'],
 '연결 단자 상세':['Peripheral Connections','Interface','External interfaces','디지털 인터페이스'],
 '마이크 단자 상세':['Audio input','External microphone IN terminal','マイク端子'],
 '헤드폰 단자 상세':['Audio output','ヘッドホン端子'],
 '배터리 상세':['Standard Power Supply','Battery','Battery / Batteries','Batteries','Battery type','사용 배터리','사용 전원','使用電池'],
 '치수 상세':['Dimensions','Dimensions (W x H x D)','Dimensions (W × H × D)','Dimensions (Excl. Protrusions) (mm) (Approx.)','Dimensions (W x H x D) (approx.)','외형 치수','크기','外形寸法 (幅×高さ×奥行、CIPA準拠)'],
 '무게 상세':['Weight','質量 約 (g)','무게','중량','Weight (g) (Including the battery and memory card) (Approx.) *For camera kits, weight includes kit lens(es).'],
 '렌즈 구성':['Lens construction','Optical Construction','Lens Construction','レンズ構成 (群-枚)','렌즈 구성'],
 '화각':['Angle of view','Angle of View (diagonal)','화각','画角 (35mm判)'],
 '최소 조리개':['Minimum aperture','Minimum Aperture','最小絞り (F値)','최소 조리개'],
 '조리개 날 수':['Diaphragm blades','Number of Diaphragm Blades','Aperture Blades**','絞り羽根 (枚)','조리개 날개 수'],
 '조리개 상세':['조리개 제어'],
 '최단 촬영 거리 상세':['Minimum focus distance','Minimum focusing distance','Minimum Focusing Distance','Minimum Object Distance','Closest focusing distance','최소 초점 거리 (포컬플레인으로부터 측정)','최단 촬영 거리','최소 초점 거리','最短撮影距離 (m)'],
 '최대 촬영 배율':['Maximum reproduction ratio','Maximum Magnification Ratio','Maximum magnification','最大撮影倍率 (倍)','최대 배율'],
 '필터 구경(mm)':['Filter-attachment size','Filter Size','Filter size','フィルター径 (mm)','필터 사이즈','필터 크기'],
 '최대 지름(mm)':['Maximum Diameter'],
 '길이(mm)':['Length*','Length'],
 '렌즈 치수 상세':['Dimensions (Diameter × Length)','外形寸法 最大径x長さ (mm)','외형 치수: 직경 x 길이 *1 (약)'],
 '뷰파인더 상세':['Viewfinder','Viewfinder Type'],
 '모니터 상세':['Monitor type','Monitor','Monitor size and dots','LCD Monitor','LCD Monitor (Size) (Inch)'],
 '셔터 속도':['Shutter speed','Shutter Speed Range (Sec.)','Shutter Speed'],
 '동봉 액세서리':['Supplied accessories','Standard Accessories','기본구성 액세서리'],
}
GROUPS['렌즈 구성']+=['Construction (Groups Elements)']
GROUPS['조리개 날 수']+=['No. of Diaphragm Blades','Aperture Type']
GROUPS['필터 구경(mm)']+=['Filter Size (mm)']
GROUPS['최단 촬영 거리 상세']+=['Closest Focusing Distance (m, ft)','Closest Focusing Distance (m)']
GROUPS['최대 촬영 배율']+=['Max. Magnification (x)','Maximum Magnification (x)']
GROUPS['최소 조리개']+=['Min. Aperture']
GROUPS['무게 상세']+=['Weight (g) (Approx.)','Weight (g)']
GROUPS['렌즈 치수 상세']+=['Diameter x Length (mm) (Approx.)','Maximum Diameter x Length (mm)']
GROUPS['길이(mm)']+=['Overall Length']
GROUPS['최대 지름(mm)']+=['Max. Diameter']
GROUPS['방진방적 상세']=['Dust and Splash Resistant','Anti-dust and Moisture']
GROUPS['손떨림 보정 상세']+=['Optical Image Stabilizer','VC (Vibration Compensation)']
GROUPS['AF 구동 방식']=['Drive System']
LABELS={norm(label):key for key,ls in GROUPS.items() for label in ls}
ALLOWED={'www.sony.jp','imaging.nikon.com','nij.nikon.com','global.canon','asia.canon','fujifilm-korea.co.kr','www.tamron.com','www.ricoh-imaging.co.jp','explore.omsystem.com','panasonic.jp','leica-camera.com','www.sigma-global.com','shop.panasonic.com'}
def cached(url):
 p=CACHE/(hashlib.sha256(url.encode()).hexdigest()[:20]+'.json')
 return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None
def number(s):
 m=re.search(r'\d+(?:\.\d+)?',s.replace(',',''));return float(m[0]) if m else None
def extract(page,product):
 host=urlparse(page['url']).netloc
 if page.get('status')!=200 or host not in ALLOWED:return {}
 rows=page.get('rows',[]);out={};seen=set()
 if host in ['www.sigma-global.com','shop.panasonic.com']:
  text=page.get('text','');marker='Camera Type' if host=='www.sigma-global.com' else 'Specifications'
  if marker not in text:return {}
  text=text.split(marker,1)[1].split('Camera Compatibility')[0].split('View all')[0]
  lines=[s.strip() for s in text.splitlines() if s.strip()]
  for i,label in enumerate(lines[:-1]):
   if norm(label) not in LABELS:continue
   values=[]
   for value in lines[i+1:]:
    if norm(value) in LABELS or value in ['Edition Number','Mount / Product Barcode','Camera Compatibility','Accessories']:break
    values.append(value)
   if not values:continue
   if host=='www.sigma-global.com':
    mount={'Sony E':'Sony E-mount','Leica L':'L-Mount','L-Mount':'L-Mount','Fujifilm X':'FUJIFILM X Mount','Canon RF':'Canon RF Mount','Nikon Z':'Nikon Z Mount','Micro Four Thirds':'Micro Four Thirds Mount'}.get(product.get('mount'))
    if any(re.search(r'(?:mount|Mount)\s*[:：]',v) for v in values):
     values=[v for v in values if mount and norm(v).startswith(norm(mount))]
     if not values:continue
   rows.append([label,' / '.join(values[:3])])
 if host=='fujifilm-korea.co.kr':
  # Sample-photo EXIF is not product data. Specs start at the model/type row.
  start=next((i for i,r in enumerate(rows) if r[0] in ['형식','모델명','모델 이름','모델']),None)
  if start is None:return {}
  rows=rows[start:]
 for cells in rows:
  # Multi-product comparison columns require a separate explicit parser.
  if len(cells)!=2:continue
  label,value=cells;ln=norm(label);v=value.strip()
  # First occurrence is body-only on Canon Asia; subsequent sections are kits.
  if ln in seen:continue
  if ln!='type':seen.add(ln)
  key=LABELS.get(ln)
  if ln=='type':
   if re.search(r'CMOS|CCD',v) and 'sensor' in v.lower():key='센서 종류'
   elif re.search(r'phase|contrast|Hybrid.*AF',v,re.I):key='AF 방식'
  if not key:
   if ln.startswith('focus points ('):key='AF 포인트 상세'
   elif host=='fujifilm-korea.co.kr' and ln.startswith('무게'):key='무게 상세'
   elif host=='fujifilm-korea.co.kr' and ln.startswith('외형 치수'):key='렌즈 치수 상세' if product['type']=='렌즈' else '치수 상세'
   elif ln.startswith('dimensions (w'):key='치수 상세'
  if not key or key in out or not v or v in ['-','—','N/A']:continue
  if host=='fujifilm-korea.co.kr' and ((key=='치수 상세' and 'mm' not in v) or key=='동영상 기록 상세'):continue
  if len(v)>1700:continue # Long format matrices need manual summary, not truncation.
  if key in ['유효 화소(MP)','총 화소(MP)']:
   n=number(v)
   if n is None:continue
   if '万' in v:n/=100
   if n>300 or n<.1:continue
   out[key]=n;continue
  if key in ['필터 구경(mm)','최대 지름(mm)','길이(mm)','조리개 날 수']:
   n=number(v)
   if n and not re.search(r'Sony|Nikon|L-Mount|Canon',v,re.I):out[key]=n
   continue
  out[key]=v
  if key=='무게 상세':
   # Numeric-only rows are already labelled grams by the whitelisted source.
   m=re.search(r'(\d+(?:\.\d+)?)\s*g\b',v,re.I) or (re.fullmatch(r'\d+(?:\.\d+)?',v))
   if m and (product['type']=='렌즈' or host=='asia.canon'):
    out['무게(g)']=float(m[1] if m.lastindex else m[0])
    if product['type']=='바디' and host=='asia.canon':out['무게 기준']='배터리·메모리카드 포함'
  if key=='렌즈 치수 상세':
   m=re.search(r'[Øφ]?\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)',v,re.I)
   if m:out['최대 지름(mm)']=float(m[1]);out['길이(mm)']=float(m[2])
  if key=='배터리 상세':
   m=re.search(r'(?:LP-E\d+[A-Z]*|EN-EL\d+[a-z]*|NP-[A-Z0-9]+|D-LI\d+|DMW-BL[A-Z0-9]+)',v)
   if m:out['배터리 모델']=m[0]
  if key=='손떨림 보정 상세' and product['type']=='바디':
   if re.search(r'sensor.shift|built.in|^yes$|5.axis|センサーシフト',v,re.I):out['손떨림 보정(IBIS) 여부']='있음'
   elif v.lower()=='no':out['손떨림 보정(IBIS) 여부']='없음'
  if key=='사진 기록 형식' and 'RAW' in v.upper():out['RAW 지원 여부']='있음'
  if key=='치수 상세' and ('w' in ln and 'h' in ln and 'd' in ln or host=='asia.canon'):
   m=re.search(r'(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)',v)
   if m:
    for k,n in zip(['가로 크기(mm)','세로 크기(mm)','두께(mm)'],m.groups()):out[k]=float(n)
 return out
def run():
 images=json.loads((DATA/'product-images.json').read_text(encoding='utf-8'));overrides=json.loads((ROOT/'tmp/extra-spec-sources.json').read_text(encoding='utf-8')) if (ROOT/'tmp/extra-spec-sources.json').exists() else {}
 report=[]
 for filename in FILES:
  path=DATA/(filename+'.json');products=json.loads(path.read_text(encoding='utf-8'))
  for p in products:
   url=images.get(p['id'],{}).get('sourcePage');urls=[url] if url else []
   first=cached(url) if url else None
   if first:urls += [u for u in first.get('specLinks',[]) if urlparse(u).netloc==urlparse(url).netloc and '#' not in u]
   urls+=overrides.get(p['id'],[])
   if p['manufacturer']=='Tamron':
    code=re.search(r'\b([A-Z]\d{3})\b',p.get('modelCode',''))
    if code:urls.append('https://www.tamron.com/global/consumer/lenses/'+code[1].lower()+'/spec.html')
   fields={};sources={}
   for u in dict.fromkeys(urls):
    page=cached(u)
    if not page:continue
    for k,v in extract(page,p).items():fields[k]=v;sources[k]=u
   if not fields:continue
   p.setdefault('specs',{}).update(fields)
   p['specs']['사양 확인일']='2026-09-11';p['specs']['공식 사양 출처']=' | '.join(dict.fromkeys(sources.values()))
   p['specs']['검증 상태']='추가 사양은 모델별 공식 자료 확인 · 미확인 항목은 별도 표시'
   p['specSources']={**p.get('specSources',{}),**{k:{'url':u,'checkedAt':'2026-09-11'} for k,u in sources.items()}}
   if '유효 화소(MP)' in fields:p['megapixels']=fields['유효 화소(MP)']
   if '무게(g)' in fields:p['weightG']=fields['무게(g)']
   report.append({'id':p['id'],'brand':p['manufacturer'],'fields':list(fields),'sources':list(dict.fromkeys(sources.values()))})
  path.write_text(json.dumps(products,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 (ROOT/'tmp/spec-refresh-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Updated',len(report),'records;',sum(len(r['fields']) for r in report),'verified fields')
if __name__=='__main__':run()
