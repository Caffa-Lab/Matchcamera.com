const here = location.pathname;
const isHome = here === '/';
const header = document.querySelector('[data-header]');

const brandStyles = document.createElement('style');
brandStyles.textContent = `
  .brand{gap:10px!important}.brand-logo{width:38px;height:38px;display:block;flex:0 0 auto;filter:drop-shadow(0 5px 10px rgba(89,96,239,.18))}
  .brand-word{display:flex!important;align-items:baseline;gap:0;font-size:17px!important;letter-spacing:-.045em!important;line-height:1;white-space:nowrap}
  .brand-word strong{font-weight:900;color:#121827}.brand-word span{font-weight:800;color:#665cf2}
  .site-header{height:64px}.top-nav{gap:14px}.category-nav a,.category-nav button{padding:0 12px;font-size:14px}.global-search{width:230px;height:40px;border-radius:20px}.global-search input{font-size:13px;padding-left:14px}.global-search button{width:44px;height:40px;display:grid;place-items:center}.global-search button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
  @media(max-width:1180px){.category-nav a,.category-nav button{padding:0 8px;font-size:12px}.global-search{display:none}}
  @media(max-width:820px){.brand-word{display:flex!important;font-size:15px!important}}@media(max-width:520px){.brand-word{display:none!important}}
`;
document.head.appendChild(brandStyles);

const logoMark = `
<svg class="brand-logo" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
  <defs><linearGradient id="mcLogoGradient" x1="4" y1="4" x2="40" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="#5968F2"/><stop offset="1" stop-color="#805AF5"/></linearGradient></defs>
  <rect x="1" y="1" width="42" height="42" rx="12" fill="url(#mcLogoGradient)"/>
  <path d="M13.5 16.5h4.2l2-2.8h4.8l2 2.8h4c1.7 0 3 1.3 3 3v9.8c0 1.7-1.3 3-3 3h-17c-1.7 0-3-1.3-3-3v-9.8c0-1.7 1.3-3 3-3Z" fill="none" stroke="#fff" stroke-width="2.25" stroke-linejoin="round"/>
  <circle cx="22" cy="24" r="5.7" fill="none" stroke="#fff" stroke-width="2.25"/><circle cx="22" cy="24" r="2.2" fill="#fff"/><path d="M29.7 19.3h1.8" stroke="#fff" stroke-width="2.25" stroke-linecap="round"/>
</svg>`;

const nav = [
  ['/', '홈', isHome],
  ['/body/', '바디', here.startsWith('/body/')],
  ['/lens/', '렌즈', here.startsWith('/lens/')],
  ['/builder/', '내 카메라 만들기', here.startsWith('/builder/')],
  ['/compare/', '비교', here.startsWith('/compare/')],
  ['/database/', '제품 DB', here.startsWith('/database/')],
  ['/accessories/', '액세서리', here.startsWith('/accessories/')],
  ['/program/', '프로그램', here.startsWith('/program/')],
  ['/contact/', '문의하기', here.startsWith('/contact/')],
];

const searchIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4.2 4.2"></path></svg>`;

if(header){
  header.innerHTML = `
    <header class="site-header">
      <div class="top-nav">
        <a class="brand" href="/" aria-label="Matchcamera 홈">${logoMark}<span class="brand-word"><strong>Match</strong><span>camera</span></span></a>
        <nav class="category-nav" aria-label="주요 메뉴">${nav.map(([href,label,active])=>`<a href="${href}" class="${active?'active':''}">${label}</a>`).join('')}</nav>
        <form class="global-search" action="/database/" role="search">
          <input name="q" type="search" placeholder="통합 검색" aria-label="통합 검색">
          <button type="submit" aria-label="검색">${searchIcon}</button>
        </form>
      </div>
    </header>`;
}

const footer = document.querySelector('[data-footer]');
if(footer){
  footer.innerHTML = `<footer class="footer"><div class="footer-inner"><span>© ${new Date().getFullYear()} Matchcamera</span><span>제품 사양·가격·호환성은 제조사 자료를 우선하며 구매 전 재확인을 권장합니다.</span><a href="mailto:admin@matchcamera.com">admin@matchcamera.com</a></div></footer>`;
}
