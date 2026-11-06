import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const CATEGORIES=[['quality','화질·색'],['focus','AF·피사체'],['exposure','ISO·노출'],['shutter','셔터·손떨림'],['video','영상·오디오'],['workflow','버튼·저장'],['trouble','문제 해결']];
const categoryNames=new Map(CATEGORIES);
const text=value=>typeof value==='string'&&value.trim().length>0;
export function officialSonyUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['helpguide.sony.net','www.sony.co.kr','support.d-imaging.sony.co.jp','www.sony.com','www.sony.jp'].includes(url.hostname);}catch{return false;}
}
export function validateGuide(data){
  if(data?.version!==1||!/^\d{4}-\d{2}-\d{2}$/.test(data.checkedAt)||!Array.isArray(data.cards)||!data.cards.length||!Array.isArray(data.manuals)||!Array.isArray(data.recipes))throw Error('소니 가이드 데이터 형식을 확인하세요.');
  const ids=new Set();
  for(const card of data.cards){
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id)||ids.has(card.id)||!categoryNames.has(card.category)||!['title','why','tip','caveat','scope'].every(key=>text(card[key]))||!Array.isArray(card.howTo)||!card.howTo.length||!card.howTo.every(text)||!Array.isArray(card.keywords)||!card.keywords.length||!card.keywords.every(text))throw Error(`소니 설정 카드 형식: ${card.id}`);
    ids.add(card.id);
    for(const source of [card.source,...(card.sources||[])])if(!text(source?.title)||!text(source.model)||!officialSonyUrl(source.url))throw Error(`소니 공식 근거 확인: ${card.id}`);
  }
  for(const manual of data.manuals)if(!text(manual.id)||!text(manual.name)||!text(manual.model)||!officialSonyUrl(manual.url))throw Error('기종별 도움말 형식을 확인하세요.');
  for(const recipe of data.recipes)if(!text(recipe.id)||!text(recipe.title)||!text(recipe.description)||!text(recipe.tip)||!text(recipe.caveat)||!Array.isArray(recipe.settings)||!recipe.settings.length||!recipe.settings.every(row=>text(row.label)&&text(row.value)))throw Error(`촬영 예시 형식: ${recipe.id}`);
  return data;
}

export function guideFragments(data){
  validateGuide(data);
  return {
    MANUAL_OPTIONS:data.manuals.map(manual=>`<option value="${escape(manual.id)}" data-url="${escape(manual.url)}">${escape(manual.name)} (${escape(manual.model)})</option>`).join(''),
    MANUAL_LINKS:data.manuals.map(manual=>`<a href="${escape(manual.url)}" target="_blank" rel="noopener noreferrer">${escape(manual.name)} · ${escape(manual.model)} ↗</a>`).join(''),
    FILTERS:[['all','전체'],...CATEGORIES].map(([id,label])=>`<button type="button" data-sony-filter="${id}" aria-pressed="${id==='all'}">${escape(label)}</button>`).join(''),
    SETTINGS:data.cards.map((card,index)=>{
      const sources=[...new Map([card.source,...(card.sources||[])].map(source=>[source.url,source])).values()];
      const scope=card.scope.replace(/\s+/g,'')==='공통개념'?'공통 개념':'지원 기종 확인';
      return `<details class="sony-setting" id="setting-${card.id}" data-sony-setting data-category="${card.category}"><summary><span class="sony-setting-number">${String(index+1).padStart(2,'0')}</span><div><span class="sony-setting-category">${escape(categoryNames.get(card.category))} · ${scope}</span><h3>${escape(card.title)}</h3><p>${escape(card.why)}</p></div><span class="sony-setting-toggle" aria-hidden="true">+</span></summary><div class="sony-setting-body"><h4>메뉴에서 찾을 말</h4><div class="sony-keywords">${card.keywords.map(keyword=>`<span>${escape(keyword)}</span>`).join('')}</div><h4>설정할 때 확인할 순서</h4><ol>${card.howTo.map(step=>`<li>${escape(step)}</li>`).join('')}</ol><div class="sony-tip"><strong>매치카메라 활용 팁</strong><p>${escape(card.tip.replace(/^매치카메라 팁[:：]\s*/,''))}</p></div><div class="sony-caveat"><strong>기종·조건 확인</strong><p>${escape(card.caveat)}</p></div><div class="sony-setting-footer"><div>${sources.map(source=>`<p><a class="sony-source" href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">공식 근거: ${escape(source.title)} ↗</a><br><small>${escape(source.model)}</small></p>`).join('')}</div><button class="sony-copy" type="button" data-copy-setting="setting-${card.id}">이 설정 링크 복사</button></div></div></details>`;
    }).join('\n'),
    RECIPES:data.recipes.map(recipe=>`<article class="sony-scene" id="scene-${escape(recipe.id)}"><span class="sony-eyebrow">매치카메라 시작 예시</span><h3>${escape(recipe.title)}</h3><p>${escape(recipe.description)}</p><dl>${recipe.settings.map(row=>`<div><dt>${escape(row.label)}</dt><dd>${escape(row.value)}</dd></div>`).join('')}</dl><p class="sony-scene-tip">${escape(recipe.tip)}</p><p class="sony-scene-caveat">${escape(recipe.caveat)}</p></article>`).join('\n'),
  };
}

export function buildGuidePage(data,template){
  let html=template;
  for(const [key,fragment] of Object.entries(guideFragments(data))){
    const start=`<!-- SONY_${key}_START -->`,end=`<!-- SONY_${key}_END -->`;
    const a=html.indexOf(start),b=html.indexOf(end);
    if(a<0||b<a)throw Error(`가이드 템플릿 영역이 없습니다: ${key}`);
    html=html.slice(0,a+start.length)+'\n'+fragment+'\n'+html.slice(b);
  }
  return html;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const file=path.join(ROOT,'public/sony/index.html');
  const [data,template]=await Promise.all([fs.readFile(path.join(ROOT,'public/data/sony-guide.json'),'utf8').then(JSON.parse),fs.readFile(file,'utf8')]);
  const html=buildGuidePage(data,template);
  if(process.argv.includes('--check')){if(html!==template)throw Error('소니 설정 가이드 HTML이 최신 데이터와 다릅니다. node scripts/build_sony_guide.mjs 를 실행하세요.');}
  else await fs.writeFile(file,html,'utf8');
  console.log(`Sony guide ${process.argv.includes('--check')?'verified':'built'}: ${data.cards.length} settings, ${data.recipes.length} scenes, ${data.manuals.length} manuals`);
}
