"""Import visually reviewed, exact-model official cutouts into the static catalog."""
import argparse,hashlib,json,io
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
DATA=ROOT/'public/data'
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(p,data):p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('manifest',type=Path)
    parser.add_argument('processing',type=Path)
    parser.add_argument('--reviewed',action='store_true',help='Confirm that the generated QA sheets have been inspected')
    args=parser.parse_args()
    if not args.reviewed:parser.error('Inspect the QA sheets, then pass --reviewed')
    manifest=read(args.manifest)
    processed={r['productId']:r for r in read(args.processing)}
    products={p['id']:p for f in ['products.json','system-expansion.json','official-partner-products.json','hasselblad-products.json'] for p in read(DATA/f)}
    mapping=read(DATA/'product-images.json')
    records=[];pending=[]
    for row in manifest['results']:
        candidate=row.get('candidate');output=processed.get(row['productId']);product=products[row['productId']]
        if not candidate or not output:raise ValueError(f"Missing image for {row['productId']}")
        original=Path(candidate['localOriginal'])
        digest=hashlib.sha256(original.read_bytes()).hexdigest()
        if digest!=output['sourceSha256'] or output['status']!='processed':
            raise ValueError(f"Stale or unreviewed image for {row['productId']}")
        source=Path(output['output'])
        with Image.open(source) as im:
            if 'A' not in im.getbands() or im.getchannel('A').getextrema()!=(0,255):
                raise ValueError(f"Image must retain both transparent and opaque pixels: {row['productId']}")
            # Trim empty margins so mixed official canvas sizes display consistently.
            bounds=im.getchannel('A').point(lambda value:255 if value>16 else 0).getbbox()
            left,top,right,bottom=bounds
            cropped=im.crop((max(0,left-2),max(0,top-2),min(im.width,right+2),min(im.height,bottom+2)))
            side=round(max(cropped.size)*1.12)
            normalized=Image.new('RGBA',(side,side),(0,0,0,0))
            normalized.paste(cropped,((side-cropped.width)//2,(side-cropped.height)//2))
            normalized.thumbnail((960,960),Image.Resampling.LANCZOS)
            side=normalized.width
            buffer=io.BytesIO();normalized.save(buffer,'WEBP',quality=92,method=4)
            content=buffer.getvalue()
        output_hash=hashlib.sha256(content).hexdigest()[:16]
        relative=f"/assets/images/products/{product['manufacturer'].lower()}/verified-{output_hash}.webp"
        target=ROOT/'public'/relative.lstrip('/')
        entry={
            'src':relative,'sourcePage':candidate['sourcePage'],'sourceImage':candidate['sourceImage'],
            'manufacturer':product['manufacturer'],'modelCode':product['modelCode'],
            'width':side,'height':side,'sourceWidth':output['width'],'sourceHeight':output['height'],'method':'official-reviewed-cutout',
            'extractMethod':output['method'],'fetchedAt':'2026-09-11','verifiedAt':'2026-09-11',
            'verification':'Exact official model identity and transparent image visually reviewed',
            'sourceSha256':digest,'transparent':True,'lowResolution':max(output['width'],output['height'])<500,
            'usageReviewRequired':True,
        }
        # ID supports the runtime; name also protects these assets in the legacy updater.
        mapping[row['productId']]=entry;mapping[product['officialName']]=entry
        if row['officialName']!=product['officialName']:mapping.pop(row['officialName'],None)
        records.append({'productId':product['id'],'officialName':product['officialName'],**entry,'matchingEvidence':candidate.get('matchingEvidence'),'foregroundFraction':output['foregroundFraction']})
        pending.append((content,target))
    # Validate the complete input before changing any public files.
    for content,target in pending:
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(content)
    write(DATA/'product-images.json',mapping)
    write(ROOT/'docs/official-image-refresh-20260911.json',{'verifiedAt':'2026-09-11','count':len(records),'lowResolution':sum(r['lowResolution'] for r in records),'images':records})
    print(f"Imported {len(records)} product mappings; {sum(r['lowResolution'] for r in records)} native low-resolution originals")

if __name__=='__main__':main()
