export const MAX_BYTES=5_000_000;
export const filenameText=name=>String(name).replace(/\.[^.]+$/,'');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export function textPlacement(ctx,text,width,height,options){
  const margin=Math.min(width,height)*options.margin/100;
  let size=Math.min(width,height)*options.size/100;
  ctx.font=`600 ${size}px Arial, "Noto Sans KR", sans-serif`;
  const measured=ctx.measureText(text).width;
  if(measured>width-margin*2)size*=(width-margin*2)/measured;
  ctx.font=`600 ${size}px Arial, "Noto Sans KR", sans-serif`;
  const metrics=ctx.measureText(text),w=metrics.width,h=size*1.25;
  const positions={left:[margin+w/2,height-margin-h/2],center:[width/2,height-margin-h/2],right:[width-margin-w/2,height-margin-h/2]};
  const [cx,cy]=positions[options.position]||[width*options.x,height*options.y];
  return {x:clamp(cx,w/2,width-w/2),y:clamp(cy,h/2,height-h/2),width:w,height:h,size};
}

export function renderFilename(image,name,options,maxEdge=Infinity){
  const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
  const scale=Math.min(1,maxEdge/Math.max(w,h));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const text=filenameText(name),box=textPlacement(ctx,text,canvas.width,canvas.height,options);
  ctx.fillStyle=options.color==='black'?'#000':'#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,box.x,box.y);
  return canvas;
}

const encode=(canvas,quality)=>new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('이미지를 저장하지 못했습니다.')),'image/jpeg',quality));
export async function exportFilename(image,name,options,maxBytes=MAX_BYTES){
  let edge=Math.min(8192,Math.max(image.naturalWidth||image.width,image.naturalHeight||image.height));
  for(let attempt=0;attempt<20;attempt++){
    const canvas=renderFilename(image,name,options,edge);
    let blob=await encode(canvas,.96);
    if(blob.size<=maxBytes)return blob;
    let low=.5,high=.96,best=await encode(canvas,low);
    if(best.size<=maxBytes){
      for(let i=0;i<7;i++){const mid=(low+high)/2;blob=await encode(canvas,mid);if(blob.size<=maxBytes){best=blob;low=mid}else high=mid;}
      return best;
    }
    edge=Math.max(1,Math.floor(edge*.8));
    canvas.width=canvas.height=1;
  }
  throw new Error('5MB 이하로 저장하지 못했습니다. 다른 사진으로 다시 시도해 주세요.');
}

export function uniqueOutputName(name,used){
  const base=filenameText(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')||'photo';
  let output=`${base}_filename.jpg`,i=2;
  while(used.has(output.toLowerCase()))output=`${base}_filename_${i++}.jpg`;
  used.add(output.toLowerCase());return output;
}
