const esc = (value = '') => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const count = value => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('방문 통계 형식을 확인하지 못했습니다.');
  return value.toLocaleString('ko-KR');
};
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5).replace('-', '.') : '';

function visitorChart(rows) {
  const width = 900, height = 210, left = 45, right = 20, top = 20, bottom = 35;
  const baseline = height - bottom;
  const max = Math.max(1, ...rows.map(row => row.visitors));
  const x = index => rows.length === 1 ? (width + left - right) / 2 : left + index * (width - left - right) / (rows.length - 1);
  const y = value => baseline - value * (baseline - top) / max;
  const points = rows.map((row, index) => `${x(index)},${y(row.visitors)}`).join(' ');
  const labels = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
  return `<svg class="visitor-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="일별 추정 방문자 수. 아래 일별 수치에서 정확한 값을 확인할 수 있습니다.">
    <line x1="${left}" y1="${top}" x2="${width-right}" y2="${top}" class="visitor-chart-grid"/>
    <line x1="${left}" y1="${baseline}" x2="${width-right}" y2="${baseline}" class="visitor-chart-grid"/>
    <text x="${left-10}" y="${top+4}" text-anchor="end">${count(max)}</text><text x="${left-10}" y="${baseline+4}" text-anchor="end">0</text>
    <polyline points="${points}" class="visitor-chart-line"/>
    ${rows.map((row, index) => `<circle cx="${x(index)}" cy="${y(row.visitors)}" r="${rows.length > 14 ? 3 : 4}" class="visitor-chart-dot"><title>${esc(row.date)} · 방문자 ${count(row.visitors)} · 조회수 ${count(row.pageViews)}</title></circle>`).join('')}
    ${labels.map(index => `<text x="${x(index)}" y="${height-8}" text-anchor="middle">${dateLabel(rows[index].date)}</text>`).join('')}
  </svg>`;
}

export function visitorStatsMarkup(data, range = 30) {
  if (data.status === 'unavailable') return '<p class="visitor-message">방문 통계 저장소가 연결되지 않았습니다. 배포 설정을 확인해 주세요.</p>';
  if (data.status !== 'ready' || !Array.isArray(data.daily)) throw new Error('방문 통계를 불러오지 못했습니다.');
  if (!data.collectedSince) return '<p class="visitor-message">방문 통계 수집을 준비했습니다. 첫 방문이 기록되면 수치가 표시됩니다.</p>';
  const rows = data.daily.filter(row => row.collected !== false).slice(-range);
  if (!rows.length || rows.some(row => !dateLabel(row.date))) throw new Error('일별 방문 통계를 확인하지 못했습니다.');
  rows.forEach(row => { count(row.visitors); count(row.pageViews); });
  const periods = [['today', '오늘'], ['last7Days', '최근 7일'], ['last30Days', '최근 30일']];
  const cards = periods.flatMap(([key, title]) => {
    const period = data[key];
    if (!period) throw new Error('기간별 방문 통계를 확인하지 못했습니다.');
    const window = data.windows?.[key];
    const note = window?.complete === false ? `수집 기간 ${count(window.observedDays)}일 · 오늘 포함` : '한국시간 기준 · 오늘 포함';
    return [
      `<article class="stat-card visitor-count"><small>${title} 추정 방문자</small><strong>${count(period.visitors)}<em>명</em></strong><span>${esc(note)}</span></article>`,
      `<article class="stat-card"><small>${title} 페이지 조회수</small><strong>${count(period.pageViews)}<em>회</em></strong><span>${esc(note)}</span></article>`,
    ];
  });
  const start = new Date(data.collectedSince);
  const updated = new Date(data.updatedAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(updated.getTime())) throw new Error('통계 기준 시각을 확인하지 못했습니다.');
  const formatDate = date => date.toLocaleString('ko-KR', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  return `<div class="stats-grid visitor-stats-grid">${cards.join('')}</div>
    <div class="visitor-chart-head"><h3>일별 추정 방문자</h3><div class="visitor-range" role="group" aria-label="그래프 기간">${[7,30].map(days => `<button type="button" data-visitor-range="${days}" aria-pressed="${range === days}">최근 ${days}일</button>`).join('')}</div></div>
    ${visitorChart(rows)}
    <p class="visitor-meta">수집 시작 ${esc(formatDate(start))} · 마지막 기록 ${esc(formatDate(updated))} (한국시간)</p>
    <details class="visitor-details"><summary>일별 수치 보기</summary><div class="visitor-table-wrap"><table><caption>수집 기간의 일별 방문자와 페이지 조회수</caption><thead><tr><th scope="col">날짜 (한국시간)</th><th scope="col">추정 방문자</th><th scope="col">페이지 조회수</th></tr></thead><tbody>${[...rows].reverse().map(row => `<tr><th scope="row">${esc(row.date)}</th><td>${count(row.visitors)}명</td><td>${count(row.pageViews)}회</td></tr>`).join('')}</tbody></table></div></details>`;
}

export function initVisitorStats(load) {
  const content = document.querySelector('#visitorStatsContent');
  const button = document.querySelector('#refreshVisitors');
  let data = null, range = 30, pending = false;
  content.addEventListener('click', event => {
    const toggle = event.target.closest('[data-visitor-range]');
    if (!toggle || !data) return;
    range = Number(toggle.dataset.visitorRange);
    content.innerHTML = visitorStatsMarkup(data, range);
    content.querySelector(`[data-visitor-range="${range}"]`)?.focus();
  });
  async function refresh() {
    if (pending) return;
    pending = true;
    button.disabled = true;
    content.setAttribute('aria-busy', 'true');
    content.innerHTML = '<p class="visitor-message" role="status">방문 통계를 불러오는 중입니다.</p>';
    try {
      data = await load();
      content.innerHTML = visitorStatsMarkup(data, range);
    } catch {
      data = null;
      content.innerHTML = '<p class="visitor-message visitor-error" role="status">방문 통계를 불러오지 못했습니다. 통계 새로고침으로 다시 시도해 주세요.</p>';
    } finally {
      pending = false;
      button.disabled = false;
      content.setAttribute('aria-busy', 'false');
    }
  }
  button.addEventListener('click', refresh);
  void refresh();
  return refresh;
}
