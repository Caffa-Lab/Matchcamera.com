const here = location.pathname;
const isBuilder = here === '/' || here.startsWith('/builder/');
const isBody = here.startsWith('/body/');
const isLens = here.startsWith('/lens/');
const header = document.querySelector('[data-header]');

const brandStyles = document.createElement('style');
brandStyles.textContent = `
  .brand{gap:10px!important}
  .brand-logo{width:38px;height:38px;display:block;flex:0 0 auto;filter:drop-shadow(0 5px 10px rgba(89,96,239,.18))}
  .brand-word{display:flex!important;align-items:baseline;gap:0;font-size:17px!important;letter-spacing:-.045em!important;line-height:1;white-space:nowrap}
  .brand-word strong{font-weight:900;color:#121827}
  .brand-word span{font-weight:800;color:#665cf2}
  @media(max-width:820px){.brand-word{display:flex!important;font-size:15px!important}}
  @media(max-width:520px){.brand-word{display:none!important}}
`;
document.head.appendChild(brandStyles);

const logoMark = `
<svg class="brand-logo" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="mcLogoGradient" x1="4" y1="4" x2="40" y2="40" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5968F2"/>
      <stop offset="1" stop-color="#805AF5"/>
    </linearGradient>
  </defs>
  <rect x="1" y="1" width="42" height="42" rx="12" fill="url(#mcLogoGradient)"/>
  <path d="M13.5 16.5h4.2l2-2.8h4.8l2 2.8h4c1.7 0 3 1.3 3 3v9.8c0 1.7-1.3 3-3 3h-17c-1.7 0-3-1.3-3-3v-9.8c0-1.7 1.3-3 3-3Z" fill="none" stroke="#fff" stroke-width="2.25" stroke-linejoin="round"/>
  <circle cx="22" cy="24" r="5.7" fill="none" stroke="#fff" stroke-width="2.25"/>
  <circle cx="22" cy="24" r="2.2" fill="#fff"/>
  <path d="M29.7 19.3h1.8" stroke="#fff" stroke-width="2.25" stroke-linecap="round"/>
</svg>`;

if (header) {
  header.innerHTML = `
    <header class="site-header">
      <div class="top-nav">
        <a class="brand" href="/" aria-label="Matchcamera 홈">
          ${logoMark}<span class="brand-word"><strong>Match</strong><span>camera</span></span>
        </a>
        <nav class="category-nav" aria-label="주요 메뉴">
          <a href="/body/" class="${isBody ? 'active' : ''}">바디</a>
          <a href="/lens/" class="${isLens ? 'active' : ''}">렌즈</a>
          <button type="button" data-coming>삼각대</button>
          <button type="button" data-coming>액세서리</button>
          <a href="/" class="${isBuilder ? 'active' : ''}">내 카메라 만들기</a>
          <a href="/database/" class="${here.startsWith('/database/') ? 'active' : ''}">제품 DB</a>
          <a href="/compare/" class="${here.startsWith('/compare/') ? 'active' : ''}">비교</a>
        </nav>
        <form class="global-search" action="/database/">
          <input name="q" type="search" placeholder="통합 검색" aria-label="통합 검색">
          <button type="submit" aria-label="검색">⌕</button>
        </form>
      </div>
    </header>`;
}

const footer = document.querySelector('[data-footer]');
if (footer) {
  footer.innerHTML = `<footer class="footer"><div class="footer-inner"><span>© ${new Date().getFullYear()} Matchcamera</span><span>제품 사양은 제조사 공식 자료를 우선하며 구매 전 재확인을 권장합니다.</span></div></footer>`;
}

document.addEventListener('click', (e) => {
  const coming = e.target.closest('[data-coming]');
  if (!coming) return;
  e.preventDefault();
  const old = coming.textContent;
  coming.textContent = '준비 중';
  coming.classList.add('coming-pulse');
  setTimeout(() => {
    coming.textContent = old;
    coming.classList.remove('coming-pulse');
  }, 1000);
});
