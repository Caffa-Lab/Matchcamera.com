"""Publish reviewed model-specific official product images, preserving provenance."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin
import requests,json,re,io
from PIL import Image,ImageOps,ImageDraw
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'public/data';C=ROOT/'tmp/accessory-sources';OUT=ROOT/'public/assets/images/accessories/verified';OUT.mkdir(parents=True,exist_ok=True)
pending=[]
OG=set('canon-control-ring-ef-eos-r canon-ef-eos-m canon-ef-eos-r canon-lp-e6nh canon-speedlite-el-5 fujifilm-ef-x500 fujifilm-np-w126s fujifilm-np-w235 gitzo-gh1382qd gitzo-gt1545t benro-gx35 benro-ttor34c benro-ttor34c-gx35-kit leica-m-adapter-l manfrotto-mhxpro-bhq2 manfrotto-mt055xpro3 om-system-blx-1 sony-hvl-f46rm sony-hvl-f60rm2 sony-la-ea4 sony-la-ea5 vanguard-veo3-263ab-kit sachtler-fsb6-mkii'.split())
OG.update(['nikon-en-el15c', 'nikon-en-el25', 'nikon-en-el25a', 'nikon-ftz', 'nikon-ftz-ii', 'nikon-sb-5000', 'panasonic-dmw-blk22', 'om-system-bls-50', 'sigma-bp-51', 'pentax-d-li90', 'sony-sf-g128t'])
OG.update('om-system-fl-700wr panasonic-dmw-fl580l nikon-ft1 panasonic-dmw-ma1 olympus-mmf3 leofoto-lh40 sachtler-flowtech75-aktiv-ms sigma-mc11-ef-e sigma-mc11-sa-e sigma-mc21-ef-l godox-v1pro-s godox-v1pro-c godox-v1pro-n godox-v1pro-f godox-v1pro-o'.split())

OG.update('pentax-k-q sandisk-extreme-pro-sd-v90-128 sandisk-extreme-pro-cfexpress-b-256 angelbird-av-pro-cfexpress-a-se-160 canon-drop-in-ef-eos-r'.split())

OG.update('lexar-2000x-sd-v90-128 prograde-cobalt-cfexpress-a-160'.split())

OG.add('samsung-pro-plus-sd-256')

OG.update('sirui-am284-k20x-kit sigma-mc21-sa-l'.split())

def fetch(row):
 p=C/(row['id']+'.json')
 if not p.exists():return None
 source=json.loads(p.read_text(encoding='utf-8'));url=None
 if row['id'] in OG:url=source.get('og')
 if row['manufacturer']=='PhotoClam':
  model=row.get('modelCode') or row['officialName'].split()[0]
  im=next((i for i in source['images'] if '/web/product/' in i['src'] and model.lower() in i['alt'].lower()),None)
  if not im and '/product/' in source['url']:
   im=next((i for i in source['images'] if '/web/product/big/' in i['src']),None)
  if im:url=im['src']
 if row['id']=='peak-design-travel-al':url=next((i['src'] for i in source['images'] if 'Aluminum Travel Tripod with the standard plate' in i['alt']),None)
 if not url:return None
 url=urljoin(source['url'],url)
 pending.append({'id':row['id'],'url':url,'referer':source['url']})
 try:
  binary=ROOT/('tmp/accessory-sources/'+row['id']+'.bin')
  if binary.exists():content=binary.read_bytes()
  else:
   r=requests.get(url,timeout=25,headers={'User-Agent':'Mozilla/5.0','Referer':source['url']});r.raise_for_status();content=r.content
  im=Image.open(io.BytesIO(content));im=ImageOps.exif_transpose(im).convert('RGBA');im.thumbnail((900,900),Image.Resampling.LANCZOS)
  if min(im.size)<80:return None
  dest=OUT/(row['id']+'.webp');im.save(dest,'WEBP',quality=92)
  return row['id'],{'imageSrc':'/assets/images/accessories/verified/'+dest.name,'imageSourcePage':source['url'],'imageSourceUrl':url,'imageFetchedAt':'2026-09-11','imageWidth':im.width,'imageHeight':im.height,'imageMethod':'official-exact-model','imageUsageReviewRequired':True}
 except Exception as e:print('IMAGE FAILED',row['id'],type(e).__name__);return None
if __name__=='__main__':
 files={n:json.loads((D/(n+'.json')).read_text(encoding='utf-8')) for n in ['mount-adapters','batteries','flashes','memory-cards','tripods','heads','plates']}
 with ThreadPoolExecutor(8) as pool:updates=dict(x for x in pool.map(fetch,[p for ps in files.values() for p in ps if not p.get('imageSrc')]) if x)
 (ROOT/'tmp/pending-assets.json').write_text(json.dumps([r for r in pending if r['id'] not in updates],ensure_ascii=False),encoding='utf-8')
 for name,rows in files.items():
  for row in rows:row.update(updates.get(row['id'],{}))
  (D/(name+'.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 thumbs=[]
 for pid,u in updates.items():
  im=Image.open(ROOT/('public'+u['imageSrc'])).convert('RGBA');thumb=Image.new('RGB',(220,230),'#eee');im.thumbnail((200,185));thumb.paste(im,((220-im.width)//2,5),im);ImageDraw.Draw(thumb).text((5,195),pid[:32],fill='black');thumbs.append(thumb)
 if thumbs:
  sheet=Image.new('RGB',(1100,230*((len(thumbs)+4)//5)),'white')
  for i,im in enumerate(thumbs):sheet.paste(im,((i%5)*220,(i//5)*230))
  sheet.save(ROOT/'tmp/accessory-contact-sheet.jpg')
 print('Images applied',len(updates))
