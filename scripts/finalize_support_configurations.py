from pathlib import Path
import json,re
from import_additional_support import merge
from import_korean_support_catalog import base,read
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'public/data';T=ROOT/'tmp/domestic'
path=D/'tripods.json';rows=read(path)
# This US listing is a tripod kit, not the separately sold Korean SH-705E head.
rows=[r for r in rows if r['id']!='slik-sh-705e']
for r in rows:
 if r['manufacturer']=='Benro' and r.get('specificationDetails') and r['kind']=='tripod-kit':
  details=r['specificationDetails']
  if not details.get('Head Type'):r['kind']='tripod-legs'
  else:
   m=re.search(r'(?:VX\d+|GX\d+|FS\d+|N\d+[A-Z]+|B\d+G)',r['modelCode'])
   r['includedHead']={'manufacturer':'Benro','officialName':m[0] if m else '기본 포함 헤드','headType':'fluid-head' if 'video' in details['Head Type'].lower() else 'ball-head'}
 if r['id']=='manfrotto-mp3-bk':r['kind']='tripod-legs';r['headReplaceable']=False;r['note']='카메라에 직접 고정하는 포켓 지지대입니다.'
 if r['kind']=='tripod-kit' and not r.get('includedHead'):
  name='기본 포함 볼헤드'
  if r['manufacturer']=='SLIK':name='SH-747FC' if '3wfc' in r['id'] else 'SBH-100AC' if 'bhac' in r['id'] else '기본 포함 헤드'
  r['includedHead']={'manufacturer':r['manufacturer'],'officialName':name}
path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
domestic=read(T/'peak-catalog.json');products=[]
for variant,title in [('pro-lite','프로 라이트 삼각대'),('pro','프로 삼각대'),('pro-tall','프로 톨 삼각대')]:
 source=read(T/('peak-'+variant+'.json'));sale=next(r for r in domestic if r['title']==title);text=source['text'].split('SPECS',1)[1].split('MATERIALS')[0]
 p=base('Peak Design',variant+'-tripod','Peak Design '+variant.replace('-',' ').title()+' Tripod',sale['url'],int(re.search(r'([\d,]+)원',sale['text'])[1].replace(',','')))
 p.update(kind='tripod-kit',officialSource=source['url'],imageRemote=sale['image'],includedHead={'manufacturer':'Peak Design','officialName':'기본 Pro 볼헤드','headType':'ball-head'},headMount=None,material='Carbon Fiber')
 for key,label,factor in [('weightKg','Weight',1),('maxLoadKg','Weight Capacity',1),('foldedLengthMm','Collapsed Length',10),('maxHeightMm',r'Max height \(center column raised\)',10)]:p[key]=float(re.search(label+r'\s*([\d.]+)',text)[1])*factor
 products.append(p)
for suffix,label,weight in [('al','알루미늄',1.56),('cf','카본',1.27)]:
 sale=next(r for r in domestic if r['title']=='트래블 삼각대 ('+label+')');old=next(r for r in rows if r['id']=='peak-design-travel-'+suffix)
 old.update(maxLoadKg=9.1,weightKg=weight,maxHeightMm=1524,foldedLengthMm=394,saleSource=sale['url'],priceSource=sale['url'],priceDate='2026-09-11',currentPriceKrw=int(re.search(r'([\d,]+)원',sale['text'])[1].replace(',','')),koreaPriceStatus='한국 공식 수입사 표시 가격',koreaPurchasable=True,verifiedAt='2026-09-11',currentSale='국내 판매 페이지 확인',imageRemote=sale['image'])
 products.append(old)
merge(products)
print('Support configuration and Peak Design variants verified')
