"""Import manually reviewed Korean manufacturer specification images and exact domestic SKUs."""
import json,re,requests,bs4
from pathlib import Path
from urllib.parse import urljoin
from import_korean_support_catalog import base,read
from import_additional_support import merge
ROOT=Path(__file__).resolve().parents[1];T=ROOT/'tmp/photoclam-kr'
# max payload kg, weight kg, maximum height mm, folded length mm, image position.
# Multi-model tables, conflicting declarations and unverified kit heads are excluded.
review={
'PTC-2652MXL':(25,1.6,1790,597,3),'PTC-2641M':(35,1.68,1700,540,2),
'PTC-2342TC':(20,1.4,1551,530,3),'PTC-2352TC':(20,1.48,1415,460,3),
'PTC-1442P':(25,1.36,1616,520,3),'PTC-2442P':(30,1.63,1700,565,3),'PTC-2442PS':(30,1.59,1630,510,3),
'PTC-3442PS':(38,1.9,1630,510,2),'PTC-3442PLC':(38,1.67,1500,580,3),
'PTC-4442PLC':(50,2,1550,590,2),'PTC-5442PLC':(60,2.4,1550,610,2),
'PTC-MINI28 C':(28,1.05,520,290,1),'PTC-MINI50W':(60,2.1,640,340,1),
'PTC-5442PXLC':(55,2.85,2000,710,2),'PTC-5442PL W':(60,3.04,1560,610,2),
'PTC-4441PWXL':(38,2.9,1900,705,3),'PTC-3442PL W75':(38,2.1,1550,580,2),
'PTC-4442PL W75':(50,2.19,1550,600,2),'PTC-5442PLW-75':(60,2.8,1560,610,2),
'PTC-3442PXL C':(38,1.9,1800,660,2),'PTC-1645M WR':(35,1.46,1625,530,2),
'PTC-0645M WR':(25,1.15,1380,480,2),'PTC-1655M WR':(35,1.5,1610,480,3),
'PTC-3651M XL':(35,2.55,2170,670,3),'PTC-3641ML':(39,2.4,1880,640,2),
'PTC-7651MW-C':(100,4.2,None,None,3),
}
rows=[]
for page in range(1,4):
 u=f'https://www.photoclam.kr/goods/goods_list.php?cateCd=001&page={page}';s=bs4.BeautifulSoup(requests.get(u,timeout=20).text,'html.parser')
 for el in s.select('.item_cont'):
  title=el.select_one('.item_name').get_text(' ',strip=True)
  if '+' in title:continue
  for model,values in review.items():
   if not re.match(r'포토클램\s+'+re.escape(model)+r'(?=\s|$)',title):continue
   # A bare base code must not swallow a separately specified suffix/variant.
   tail=title.split(model,1)[1].strip()
   if re.match(r'[A-Z]',tail):continue
   cached=next((r for r in read(T/'catalog.json') if r['model']==re.match(r'PTC-[A-Z0-9]+',model)[0]),None)
   if not cached:continue
   price=int(re.sub(r'\D','',el.select_one('.item_price').get_text()));url=urljoin(u,el.select_one('.item_tit_box a')['href']);p=base('PhotoClam',model,model,url,price)
   load,weight,height,folded,index=values;p.update(kind='tripod-legs',maxLoadKg=load,weightKg=weight,material='Carbon Fiber',officialSource=url,specificationImageSource=cached['specImages'][index],imageRemote=el.select_one('.item_photo_box img')['src'],koreaPriceStatus='한국 제조사 공식몰 판매가',note='헤드 별도. 제조사 모델별 사양 이미지 확인.')
   if height:p['maxHeightMm']=height
   if folded:p['foldedLengthMm']=folded
   rows.append(p)
rows=list({p['id']:p for p in rows}.values());merge(rows);print('PhotoClam exact domestic models',len(rows))
