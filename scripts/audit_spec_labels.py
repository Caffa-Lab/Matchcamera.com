"""Reject ambiguous Fuji sub-row labels; enrich from explicit model-spec rows only."""
import json,re,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
count=0
for name in ['products','system-expansion','hasselblad-products']:
 path=ROOT/'public/data'/(name+'.json');rows=json.loads(path.read_text(encoding='utf8'))
 for p in rows:
  specs=p.get('specs',{});sources=p.get('specSources',{})
  for k in list(sources):
   v=str(specs.get(k,''));src=sources[k]
   if k=='센서 종류' and not re.search('CMOS|CCD|MOS|Foveon|X-Trans',v,re.I):
    specs['센서 크기']=specs.pop(k);sources['센서 크기']=sources.pop(k);count+=1
   elif p['manufacturer']=='Fujifilm' and ((k=='치수 상세' and 'mm' not in v) or k=='동영상 기록 상세'):
    del specs[k];del sources[k];count+=1
  if p['manufacturer']!='Fujifilm' or not sources:continue
  u=next(iter(sources.values()))['url'];cache=ROOT/'tmp/catalog-sources'/(hashlib.sha256(u.encode()).hexdigest()[:20]+'.json')
  if not cache.exists():continue
  rr=json.loads(cache.read_text(encoding='utf8')).get('rows',[]);start=next((i for i,r in enumerate(rr) if r[0] in ['형식','모델명','모델 이름','모델']),None)
  if start is None:continue
  rr=rr[start:];updates={}
  mapping={'유효 화소수':'유효 화소(MP)','저장 매체':'메모리카드 종류','화상 처리 엔진':'이미지 프로세서','전원 공급':'배터리 상세','기본 구성 액세서리':'동봉 액세서리','USB':'USB 종류','HDMI 출력':'HDMI 종류'}
  for r in rr:
   if len(r)==2 and r[0] in mapping:
    key=mapping[r[0]];v=r[1]
    if key=='유효 화소(MP)':
     clean=v.replace(',',''); units=re.findall(r'(\d+(?:\.\d+)?)\s*(억|만)',clean)
     if units:v=sum(float(n)*(100 if unit=='억' else .01) for n,unit in units)
     else:
      m=re.search(r'\d+(?:\.\d+)?',clean)
      if not m or not re.search('million|MP',clean,re.I):continue
      v=float(m[0])
    updates[key]=v
   if len(r)==3 and r[0]=='Dimensions' and r[1]=='너비' and re.fullmatch(r'\d+(?:\.\d+)?mm',r[2]):
    i=rr.index(r);dims=rr[i:i+3]
    if len(dims)==3 and dims[1][0]=='높이' and dims[2][0]=='두께':
     for k,val in zip(['가로 크기(mm)','세로 크기(mm)','두께(mm)'],[r[2],dims[1][1],dims[2][1]]):updates[k]=float(re.search(r'\d+(?:\.\d+)?',val)[0])
   if len(r)==3 and r[0]=='무게' and r[1]=='배터리 및 메모리카드 포함':
    m=re.search(r'(\d+(?:\.\d+)?)\s*g\b',r[2]);
    if m:updates['무게(g)']=float(m[1]);updates['무게 기준']='배터리·메모리카드 포함'
   if len(r)==3 and r[0]=='손떨림 보정' and 'sensor shift' in r[2]:updates['손떨림 보정 상세']=r[2];updates['손떨림 보정(IBIS) 여부']='있음'
   if len(r)==2 and r[0]=='RAW' and 'RAW' in r[1]:updates['사진 RAW 상세']=r[1];updates['RAW 지원 여부']='있음'
  if '동봉 액세서리' in updates:
   m=re.search(r'NP-W\d+[A-Z]*',updates['동봉 액세서리'])
   if m:updates['배터리 모델']=m[0]
  specs.update(updates);sources.update({k:{'url':u,'checkedAt':'2026-09-11'} for k in updates});count+=len(updates)
  if '무게(g)' in updates:p['weightG']=updates['무게(g)']
  if '유효 화소(MP)' in updates:p['megapixels']=updates['유효 화소(MP)']
 path.write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Audited/corrected fields',count)
