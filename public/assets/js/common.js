const here = location.pathname;
const isBuilder = here === '/' || here.startsWith('/builder/');
const header = document.querySelector('[data-header]');

if (header) {
  header.innerHTML = `
    <header class="site-header">
      <div class="top-nav">
        <a class="brand" href="/" aria-label="Matchcamera 홈">
          <span class="brand-mark">M</span><span class="brand-word">Matchcamera</span>
        </a>
        <nav class="category-nav" aria-label="주요 메뉴">
          <a href="/?mode=body" class="${isBuilder ? 'active-soft' : ''}">바디</a>
          <a href="/?mode=lens">렌즈</a>
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
