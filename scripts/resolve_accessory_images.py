from pathlib import Path
from urllib.parse import urljoin,quote
from concurrent.futures import ThreadPoolExecutor
import requests,json,re
from bs4 import BeautifulSoup
ROOT=Path(__file__).resolve().parents[1];C=ROOT/'tmp/accessory-sources';D=ROOT/'public/data'
def soup(url):
 r=requests.get(url,timeout=20,headers={'User-Agent':'Mozilla/5.0'});r.raise_for_status();return BeautifulSoup(r.text,'html.parser'),r.url
def save(pid,url,im,title):
 if not im:return
 p=C/(pid+'.json');old=json.loads(p.read_text(encoding='utf-8')) if p.exists() else {}
 old.update(id=pid,url=url,title=title,og=urljoin(url,im),status=200);p.write_text(json.dumps(old,ensure_ascii=False,indent=2),encoding='utf-8');print(pid,old['og'])
def nikon(pid,model,path):
 u='https://www.nikon-image.com/products/accessory/'+path+'/'+model.lower()+'/'
 s,u=soup(u);im=next((i.get('src') for i in s.select('img[src]') if model.lower() in (i.get('alt') or '').lower()),None)
 save(pid,u,im,s.title.get_text())
def main():
 for model in ['EN-EL15c','EN-EL25','EN-EL25a']:
  try:nikon('nikon-'+model.lower(),model,'power_supply')
  except Exception as e:print(model,type(e).__name__)
 for pid,u in [('nikon-ftz','https://imaging.nikon.com/imaging/lineup/accessory/camera/ftz/'),('nikon-ftz-ii','https://imaging.nikon.com/imaging/lineup/accessory/camera/ftz_2/'),('nikon-sb-5000','https://imaging.nikon.com/imaging/lineup/speedlights/sb-5000/')]:
  s,u=soup(u);im=next((i.get('src') for i in s.select('img[src]') if '/imaging/lineup/' in i['src'] and 'logo' not in i['src']),None);save(pid,u,im,s.title.get_text())
 for model in ['DMW-BLK22','DMW-FL580L','DMW-MA1']:
  u='https://shop.panasonic.com/search/suggest.json?q='+model+'&resources[type]=product';ps=requests.get(u,timeout=15).json()['resources']['results']['products'];p=next((p for p in ps if p['title'].upper().endswith(model)),None)
  if p:save('panasonic-'+model.lower(),'https://shop.panasonic.com/products/'+p['handle'],p['image'],p['title'])
 for pid,u in [('om-system-bls-50','https://explore.omsystem.com/us/en/bls-50-lithium-ion-rechargeable-battery'),('om-system-fl-700wr','https://explore.omsystem.com/us/en/fl-700wr-flash'),('sigma-bp-51','https://www.sigma-italia.it/en/products/li-ion-battery-bp-51')]:
  try:
   s,u=soup(u);im=s.select_one('meta[property="og:image"]');title=s.title.get_text()
   if im and not re.search(r'404|not found',title,re.I):save(pid,u,im['content'],title)
  except Exception as e:print(pid,type(e).__name__)
 u='https://www.ricoh-imaging.co.jp/english/products/645z/accessories/';s,u=soup(u);el=s.find(string=lambda t:t and '(D-LI90)' in t);im=el.find_parent('li').find('img')['src'];save('pentax-d-li90',u,im,'PENTAX D-LI90 rechargeable battery')
 # Verified model-specific images from Sony's own product image library.
 for pid,model in [('sony-sf-g128t','SF-G128T'),('sony-cea-g160t','CEA-G160T')]:
  u='https://www.sony.jp/products/picture/'+model+'.jpg';r=requests.get(u,timeout=10)
  if r.status_code==200 and r.headers.get('content-type','').startswith('image/'):save(pid,'https://www.sony.jp/rec-media/',u,model)
if __name__=='__main__':main()
