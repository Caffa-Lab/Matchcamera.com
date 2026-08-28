import {loadProducts} from './data.js';

const $ = s => document.querySelector(s);
const popularMounts = [
  ['Sony', 'Sony E'],
  ['Canon', 'Canon RF'],
  ['Nikon', 'Nikon Z'],
  ['Fujifilm', 'Fujifilm X'],
  ['L-Mount Alliance', 'L-Mount'],
  ['MFT', 'Micro Four Thirds']
];

try {
  const products = await loadProducts();
  const bodies = products.filter(x => x.type === '바디');
  const lenses = products.filter(x => x.type === '렌즈');
  const brands = new Set(products.map(x => x.manufacturer === 'Olympus' ? 'OM SYSTEM / Olympus' : x.manufacturer));

  $('#productCount').textContent = products.length.toLocaleString();
  $('#bodyCount').textContent = bodies.length.toLocaleString();
  $('#lensCount').textContent = lenses.length.toLocaleString();
  $('#brandCount').textContent = brands.size.toLocaleString();

  const mountGrid = $('#mountGrid');
  if (mountGrid) {
    mountGrid.innerHTML = popularMounts.map(([brand, mount]) => {
      const count = products.filter(p => p.mount === mount).length;
      return `<a class="mount-card" href="/database/?mount=${encodeURIComponent(mount)}">
        <span class="mount-brand">${brand}</span>
        <strong>${mount}</strong>
        <span class="mount-count">${count.toLocaleString()} products</span>
      </a>`;
    }).join('');
  }
} catch (e) {
  console.error(e);
  const mountGrid = $('#mountGrid');
  if (mountGrid) mountGrid.innerHTML = '<div class="muted tiny">마운트 정보를 불러오지 못했습니다.</div>';
}
