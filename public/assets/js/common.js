
const here = location.pathname;
const nav = [
  ['/', '홈'], ['/builder/', '카메라 맞추기'], ['/database/', '제품 DB'], ['/compare/', '제품 비교']
];
const header = document.querySelector('[data-header]');
if(header){header.innerHTML=`<header class="site-header"><div class="container nav"><a class="brand" href="/"><span class="brand-mark">M</span><span>Matchcamera</span></a><nav class="nav-links">${nav.map(([u,n])=>`<a href="${u}" class="${u==='/' ? (here==='/'?'active':'') : (here.startsWith(u)?'active':'')}">${n}</a>`).join('')}</nav><a class="btn ghost tiny" href="/builder/">조합 시작</a></div></header>`}
const footer=document.querySelector('[data-footer]');
if(footer){footer.innerHTML=`<footer class="footer"><div class="container"><span>© ${new Date().getFullYear()} Matchcamera</span><span>제품 사양은 제조사 공식 자료를 우선하며 구매 전 재확인을 권장합니다.</span></div></footer>`}
