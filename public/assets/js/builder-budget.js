import {checkCompatibility} from './compatibility.js?v=20260831-filter-fix';
import {priceContext} from './price-context.js?v=20261006-catalog';

const ACTIVE = product => product?.active !== false && product?.enabled !== false && product?.visibility !== 'hidden';
const FOR_SALE = product => product.currentSale === '예' || (!product.currentSale && product.saleStatus === '현재 판매');
const label = product => product.officialName || product.model || product.modelCode || product.id;
const esc = (value='') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = amount => `${amount.toLocaleString('ko-KR')}원`;
const PURPOSES = new Set(['all','standard','wide','tele']);

function sensorCrop(body) {
  const recorded = Number(body.cropFactor);
  if (Number.isFinite(recorded) && recorded > 0) return recorded;
  if (body.sensorFormat === 'Full Frame') return 1;
  if (body.sensorFormat === 'APS-C') return body.mount.startsWith('Canon') ? 1.6 : 1.5;
  if (body.sensorFormat === 'Micro Four Thirds') return 2;
  if (body.sensorFormat === 'Medium Format 44×33') return .79;
  return null;
}

export function budgetFocalRange(body,lens) {
  const crop = sensorCrop(body), min = Number(lens.focalMinMm), max = Number(lens.focalMaxMm);
  if (!crop || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) return null;
  return {min:min * crop,max:max * crop};
}

function purposeMatches(range,purpose) {
  if (purpose === 'all') return true;
  if (!range) return false;
  if (purpose === 'wide') return range.min <= 28;
  if (purpose === 'standard') return range.max >= 35 && range.min <= 70;
  return range.max >= 100;
}

export function budgetProductCandidates(products=[]) {
  const seen = new Set();
  return products.filter(product => {
    if (!product?.id || seen.has(product.id) || !ACTIVE(product) || !FOR_SALE(product) || product.cameraSystem !== '미러리스') return false;
    if (!['바디','렌즈'].includes(product.type) || !String(product.mount || '').trim()) return false;
    const price = priceContext(product);
    if (!price.included || !Number.isSafeInteger(price.amount) || price.amount <= 0 || !['current','official','launch'].includes(price.kind)) return false;
    seen.add(product.id);
    return true;
  });
}

// This is a transparent budget fit, not a score for photographic quality.
// Lower penalty favors a 60% body share and using the entered budget; retain
// at most two lens choices per body so one model cannot fill the whole list.
export function recommendBudgetKits(products,{budget,manufacturer='all',purpose='all',limit=8}={}) {
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 500_000_000) return [];
  if (!PURPOSES.has(purpose)) return [];
  const cap = Number.isInteger(limit) ? Math.min(8,Math.max(0,limit)) : 8;
  if (!cap) return [];
  const candidates = budgetProductCandidates(products).map(product => ({product,price:priceContext(product)}));
  const bodies = candidates.filter(({product}) => product.type === '바디' && (manufacturer === 'all' || product.manufacturer === manufacturer));
  const lenses = candidates.filter(({product}) => product.type === '렌즈');
  const matches = [];
  for (const body of bodies) for (const lens of lenses) {
    const total = body.price.amount + lens.price.amount;
    if (total > budget || body.product.mount !== lens.product.mount) continue;
    const compatibility = checkCompatibility(body.product,lens.product,[]);
    if (compatibility.level !== 'compatible') continue;
    const equivalent = budgetFocalRange(body.product,lens.product);
    if (!purposeMatches(equivalent,purpose)) continue;
    const bodyShare = body.price.amount / total;
    matches.push({body:body.product,lens:lens.product,bodyPrice:body.price,lensPrice:lens.price,total,remaining:budget-total,bodyShare,equivalent,compatibility,
      fitPenalty:Math.abs(bodyShare-.6) + (1-total/budget)*.3});
  }
  matches.sort((a,b) => a.fitPenalty-b.fitPenalty || b.total-a.total || label(a.body).localeCompare(label(b.body),'ko') || label(a.lens).localeCompare(label(b.lens),'ko') || a.body.id.localeCompare(b.body.id) || a.lens.id.localeCompare(b.lens.id));
  const usedBodies = new Map(), result = [];
  for (const match of matches) {
    const used = usedBodies.get(match.body.id) || 0;
    if (used >= 2) continue;
    result.push(match);usedBodies.set(match.body.id,used+1);
    if (result.length === cap) break;
  }
  return result;
}

function priceMarkup(price) {
  return `<span>${esc(money(price.amount))} · ${esc(price.label)}</span><small>${esc(price.dateLabel)} ${esc(price.date)} · <a href="${esc(price.sourceUrl)}" target="_blank" rel="noopener noreferrer">가격 출처 ↗</a></small>`;
}

export function budgetResultsMarkup(matches,budget) {
  if (!matches.length) return '<p class="budget-empty">이 조건으로 확인 가능한 바디·렌즈 조합이 없습니다. 예산이나 제조사·화각 조건을 바꿔 보세요. 판매 여부·가격 출처·직접 장착 호환성이 확인된 제품만 표시합니다.</p>';
  return `<p class="budget-result-caption">${esc(money(budget))} 이내 참고 조합 ${matches.length}개</p><div class="budget-cards">${matches.map((kit,index) => {
    const focal = kit.equivalent ? `35mm 환산 ${Math.round(kit.equivalent.min*10)/10}${kit.equivalent.min !== kit.equivalent.max ? `–${Math.round(kit.equivalent.max*10)/10}` : ''}mm` : '환산 화각 미확인';
    return `<article class="budget-card"><div class="budget-card-top"><b>조합 ${index+1}</b><strong>${money(kit.total)}</strong></div>
      <div class="budget-product"><span class="budget-product-kind">바디</span><div><b>${esc(label(kit.body))}</b>${priceMarkup(kit.bodyPrice)}</div></div>
      <div class="budget-product"><span class="budget-product-kind">렌즈</span><div><b>${esc(label(kit.lens))}</b>${priceMarkup(kit.lensPrice)}</div></div>
      <p class="budget-fit">${esc(kit.compatibility.label)} · ${esc(focal)}<br>바디 비중 ${Math.round(kit.bodyShare*100)}% · 예산 여유 ${money(kit.remaining)}</p>
      <button type="button" data-budget-apply="${index}">이 조합으로 견적 만들기</button></article>`;
  }).join('')}</div>`;
}

export function initBudgetRecommendations({products,manufacturerOrder=[],onApply,initialOpen=false}) {
  const panel = document.querySelector('#budgetRecommendations');
  if (!panel) return;
  const form = panel.querySelector('form'), result = panel.querySelector('[data-budget-results]');
  const brand = form.elements.namedItem('budgetBrand'), budgetInput = form.elements.namedItem('budgetKrw');
  const brands = [...new Set(budgetProductCandidates(products).filter(p=>p.type==='바디').map(p=>p.manufacturer))];
  const rank = name => {const index=manufacturerOrder.indexOf(name);return index<0?Number.MAX_SAFE_INTEGER:index;};
  brands.sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b,'ko'));
  brand.innerHTML = '<option value="all">모든 제조사</option>'+brands.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('');
  panel.querySelector('fieldset').disabled = false;
  let recommendations = [];
  form.addEventListener('submit',event => {
    event.preventDefault();
    const budget = Number(budgetInput.value);
    if (!Number.isSafeInteger(budget) || budget < 10000 || budget > 500000000) {
      result.textContent='예산을 10,000원부터 500,000,000원 사이의 정수로 입력해 주세요.';
      budgetInput.focus();return;
    }
    recommendations = recommendBudgetKits(products,{budget,manufacturer:brand.value,purpose:form.elements.namedItem('budgetPurpose').value});
    result.innerHTML = budgetResultsMarkup(recommendations,budget);
  });
  result.addEventListener('click',event => {
    const button = event.target.closest('[data-budget-apply]');
    if (!button) return;
    const recommendation = recommendations[Number(button.dataset.budgetApply)];
    if (recommendation) onApply(recommendation);
  });
  if (initialOpen) {
    panel.open = true;
    requestAnimationFrame(()=>panel.scrollIntoView({block:'start'}));
  }
}
