const NS = 'http://www.w3.org/2000/svg';
const DAY = 86_400_000;
let sequence = 0;
const validValue = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const validSeries = value => value?.count > 0 && validValue(value.min) && validValue(value.max) && value.max >= value.min;
const medianValue = value => value?.count >= 3 && validValue(value.median) && value.median >= value.min && value.median <= value.max ? value.median : null;
const dateNumber = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
};
const money = value => `${new Intl.NumberFormat('ko-KR').format(value)}원`;
const range = value => validSeries(value) ? `${money(value.min)}${value.min === value.max ? '' : ` ~ ${money(value.max)}`} · ${value.count}개${medianValue(value) !== null ? ` · 중앙값 ${money(value.median)}` : ''}` : '관측 없음';

// Uses real observation dates only. Gaps are left empty, and a single observed
// day stays a point instead of becoming an invented historical line.
export function createUsedPriceChart(history = {}, { document: doc = globalThis.document } = {}) {
  const node = (tag, className, text) => {
    const item = doc.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const svgNode = (tag, attributes = {}, text) => {
    const item = doc.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attributes)) item.setAttribute(name, String(value));
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const points = (Array.isArray(history.points) ? history.points : [])
    .filter(point => Number.isFinite(dateNumber(point?.date)) && (validSeries(point.active) || validSeries(point.ended)))
    .sort((a, b) => a.date.localeCompare(b.date));
  const section = node('section', 'used-chart');
  const title = node('h3', '', '관측한 판매호가 추이');
  section.append(title);
  if (!points.length) {
    section.append(node('p', 'used-chart-note', '아직 확인한 가격 이력이 없습니다. 실제로 관측한 날짜가 쌓이면 그래프에 표시합니다.'));
    return section;
  }
  const series = [
    { key: 'active', name: '판매 중 호가', className: 'is-active', offset: -4 },
    { key: 'ended', name: '종료·품절 표시가', className: 'is-ended', offset: 4 },
  ].filter(item => points.some(point => validSeries(point[item.key])));
  const legend = node('div', 'used-chart-legend');
  for (const item of series) legend.append(node('span', item.className, item.name));
  section.append(legend);
  const values = points.flatMap(point => series.flatMap(item => validSeries(point[item.key]) ? [point[item.key].min, point[item.key].max] : []));
  const low = Math.min(...values), high = Math.max(...values), padding = Math.max((high - low) * .12, high * .025, 1000);
  const domainLow = Math.max(0, low - padding), domainHigh = high + padding;
  const firstTime = dateNumber(points[0].date), lastTime = dateNumber(points.at(-1).date);
  const x = date => firstTime === lastTime ? 320 : 20 + ((dateNumber(date) - firstTime) / (lastTime - firstTime)) * 600;
  const y = price => 200 - (price - domainLow) / (domainHigh - domainLow) * 180;
  const frame = node('div', 'used-chart-frame');
  const axis = node('div', 'used-chart-y');
  const priceLabel = value => new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1}).format(value / 10_000);
  axis.append(node('span', '', priceLabel(domainHigh)), node('span', '', priceLabel((domainLow + domainHigh) / 2)), node('span', '', priceLabel(domainLow)));
  axis.setAttribute('aria-hidden', 'true');
  const plot = node('div', 'used-chart-plot');
  const chartId = `used-price-chart-${++sequence}`;
  const svg = svgNode('svg', { viewBox: '0 0 640 220', preserveAspectRatio: 'none', role: 'img', 'aria-labelledby': `${chartId}-title ${chartId}-description` });
  svg.append(svgNode('title', { id: `${chartId}-title` }, '확인한 날짜별 판매호가 범위'), svgNode('desc', {id: `${chartId}-description`}, `${points.length}개 날짜에 관측한 판매 중 호가와 종료·품절 표시가를 구분했습니다. 점과 세로선은 최저·최고 가격이며, 상품 3개 이상인 날의 중앙값은 큰 점으로 표시합니다. 상세 값은 아래 관측 기록 표에서 확인할 수 있습니다.`));
  for (const position of [20, 110, 200]) svg.append(svgNode('line', {x1: 0, x2: 640, y1: position, y2: position, class: 'used-chart-gridline', 'aria-hidden': 'true'}));
  for (const item of series) {
    let previous;
    for (const point of points) {
      const value = point[item.key];
      if (!validSeries(value)) { previous = undefined; continue; }
      const median = medianValue(value), position = x(point.date) + (series.length > 1 ? item.offset : 0);
      if (previous && median !== null && previous.median !== null && dateNumber(point.date) - dateNumber(previous.date) === DAY) {
        svg.append(svgNode('line', {x1: previous.x, y1: y(previous.median), x2: position, y2: y(median), class: `used-chart-connection ${item.className}`, 'aria-hidden': 'true'}));
      }
      const group = svgNode('g', {class: `used-chart-point ${item.className}`, tabindex: 0, role: 'img', 'aria-label': `${point.date} ${item.name}: ${range(value)}`});
      group.append(svgNode('title', {}, `${point.date} · ${item.name}\n${range(value)}`));
      group.append(svgNode('line', {x1: position, x2: position, y1: y(value.min), y2: y(value.max), class: 'used-chart-range'}));
      group.append(svgNode('circle', {cx: position, cy: y(value.min), r: 4}), svgNode('circle', {cx: position, cy: y(value.max), r: 4}));
      if (median !== null) group.append(svgNode('circle', {cx: position, cy: y(median), r: 6, class: 'used-chart-median'}));
      svg.append(group);
      previous = {date: point.date, x: position, median};
    }
  }
  const dates = node('div', `used-chart-x${points.length === 1 ? ' is-single' : ''}`);
  dates.append(node('span', '', points[0].date));
  if (points.length > 1) dates.append(node('span', '', points.at(-1).date));
  plot.append(svg, dates); frame.append(axis, plot);
  section.append(node('p', 'used-chart-unit', '가격 단위: 만원'), frame);
  section.append(node('p', 'used-chart-note', points.length === 1 ? '관측 기록 1일 · 확인한 날짜의 가격만 표시합니다. 기록이 쌓이면 변동 추이를 확인할 수 있습니다.' : `${points.length}개 날짜의 실제 관측 기록입니다. 기록이 없는 날짜는 비워 두며, 3개 이상인 날의 중앙값만 연속된 날짜끼리 연결합니다.`));
  section.append(node('p', 'used-chart-note', '종료·품절 표시가는 해당 판매 페이지에 표시된 금액입니다. 실제 결제 금액이나 판매 완료 시각을 뜻하지 않습니다.'));
  const details = node('details', 'used-chart-table');
  details.append(node('summary', '', '관측 기록 표로 보기'));
  const scroller = node('div', 'used-chart-table-scroll');
  const table = node('table');
  table.append(node('caption', 'used-sr-only', '날짜별 판매 중 호가와 종료·품절 표시가'));
  const head = node('thead'), heading = node('tr');
  for (const text of ['확인 날짜', '판매 중 호가', '종료·품절 표시가']) { const th = node('th', '', text); th.scope = 'col'; heading.append(th); }
  head.append(heading); table.append(head);
  const body = node('tbody');
  for (const point of points) { const row = node('tr'); row.append(node('th', '', point.date), node('td', '', range(point.active)), node('td', '', range(point.ended))); row.children[0].scope = 'row'; body.append(row); }
  table.append(body); scroller.append(table); details.append(scroller); section.append(details);
  return section;
}
