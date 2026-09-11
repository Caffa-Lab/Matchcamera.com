"""Process verified originals locally; preserve RGB pixels, change alpha only.

User-authorized local batch workflow. Originals and outputs stay separate until QA.
"""
import argparse, hashlib, json, os
from pathlib import Path
os.environ.setdefault('OMP_NUM_THREADS', '4')
import numpy as np
from PIL import Image, ImageOps, ImageDraw, ImageFont
from rembg import new_session, remove
from scipy import ndimage

def white_background_mask(im):
    """Remove border-connected white only; retain white product surfaces/glass."""
    # Composite transparent margins to white so a white inset canvas remains
    # connected to the border without erasing enclosed white product details.
    rgba=im.convert('RGBA')
    rgb=np.asarray(Image.alpha_composite(Image.new('RGBA',rgba.size,'white'),rgba).convert('RGB'))
    background=(rgb.min(axis=2)>=245)&((rgb.max(axis=2).astype(int)-rgb.min(axis=2))<12)
    seed=np.zeros(background.shape,bool)
    seed[0,:]=background[0,:]; seed[-1,:]=background[-1,:]
    seed[:,0]=background[:,0]; seed[:,-1]=background[:,-1]
    return Image.fromarray((~ndimage.binary_propagation(seed,mask=background)*255).astype('uint8'))

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('manifest',type=Path)
    parser.add_argument('output',type=Path)
    parser.add_argument('--overrides',type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    report_path=args.output/'processing.json'
    previous=json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else []
    done={x['productId']:x for x in previous}
    items=json.loads(args.manifest.read_text(encoding='utf-8'))['results']
    overrides=json.loads(args.overrides.read_text(encoding='utf-8')) if args.overrides else {}
    session=None
    for i,row in enumerate(items):
        c=row.get('candidate')
        if not c or not c.get('localOriginal'): continue
        original=Path(c['localOriginal'])
        digest=hashlib.sha256(original.read_bytes()).hexdigest()
        old=done.get(row['productId'])
        override=overrides.get(row['productId'],{})
        if override and override['sourceSha256']!=digest:
            raise ValueError(f"QA override source changed: {row['productId']}; review the new original")
        if old and old.get('sourceSha256')==digest and old.get('qaOverride')==override: continue
        im=ImageOps.exif_transpose(Image.open(original)).convert('RGBA')
        if override.get('crop'):
            im=im.crop(tuple(override['crop']))
        alpha=np.asarray(im.getchannel('A'))
        native=(alpha<250).mean()>0.01 and (alpha>250).mean()>0.01
        if override.get('method')=='border-white-mask':
            result=im.copy();result.putalpha(white_background_mask(im));method='border-white-mask'
        elif native and override.get('method')!='rembg' and not override.get('forceRemoveBackground'):
            result=im; method='official-native-alpha'
        else:
            if session is None: session=new_session('isnet-general-use',providers=['CPUExecutionProvider'])
            # rembg produces only a mask; keep the manufacturer's original color pixels.
            mask=remove(im.convert('RGB'),session=session,only_mask=True)
            result=im.copy(); result.putalpha(mask.convert('L')); method='rembg-isnet-general-use-mask'
        if override.get('method')=='largest-component' or override.get('keepLargest'):
            alpha=np.asarray(result.getchannel('A')).copy()
            labels,count=ndimage.label(alpha>32)
            areas=np.bincount(labels.ravel());areas[0]=0
            keep=ndimage.binary_dilation(labels==areas.argmax(),iterations=2)
            alpha[~keep]=0;result.putalpha(Image.fromarray(alpha));method+='-largest-component'
        a=np.asarray(result.getchannel('A'))
        coverage=float((a>128).mean())
        bbox=result.getchannel('A').point(lambda x:255 if x>32 else 0).getbbox()
        status='processed' if bbox and 0.015<coverage<0.95 else 'needs-review'
        output=args.output/(hashlib.sha256(row['productId'].encode()).hexdigest()[:18]+'.webp')
        result.save(output,'WEBP',quality=95,method=5)
        record={'productId':row['productId'],'manufacturer':row['manufacturer'],'officialName':row['officialName'],'output':str(output),'original':str(original),'sourceSha256':digest,'method':method,'status':status,'width':result.width,'height':result.height,'foregroundFraction':coverage,'bbox':bbox,'qaOverride':override}
        done[row['productId']]=record
        report_path.write_text(json.dumps(list(done.values()),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(f'{i+1}/{len(items)} {row["officialName"]}: {status} ({method})',flush=True)
    records=list(done.values())
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',14)
    for start in range(0,len(records),30):
        sheet=Image.new('RGB',(1500,1500),'#e4e4ee'); draw=ImageDraw.Draw(sheet)
        for pos,r in enumerate(records[start:start+30]):
            x=(pos%5)*300; y=(pos//5)*250
            img=Image.open(r['output']).convert('RGBA'); img.thumbnail((280,210))
            for yy in range(y,y+220,20):
                for xx in range(x,x+300,20):
                    draw.rectangle((xx,yy,xx+19,yy+19),fill='#b8bdca' if ((xx-x)//20+(yy-y)//20)%2 else '#edf0f5')
            sheet.paste(img,(x+(300-img.width)//2,y+(220-img.height)//2),img)
            draw.text((x+6,y+222),f'{start+pos}: '+r['officialName'][:34],fill='black',font=font)
        sheet.save(args.output/f'qa-{start//30+1:02}.jpg',quality=90)
    print('Processed',len(records),'Review',sum(r['status']=='needs-review' for r in records),flush=True)

if __name__=='__main__': main()
