const PATHS = {
  products: "public/data/products.json",
  expansion: "public/data/system-expansion.json",
  partners: "public/data/official-partner-products.json",
  prices: "public/data/korea-prices.json",
  images: "public/data/product-images.json",
  batteries: "public/data/batteries.json",
  adapters: "public/data/mount-adapters.json",
  home: "public/data/home-config.json",
};
const PRODUCT_PATHS = [PATHS.products, PATHS.expansion, PATHS.partners];
const PAGE_SIZE = 50;
const VIEW_TITLES = {
  dashboard: "대시보드", products: "제품 관리", prices: "가격 관리", images: "이미지 관리",
  accessories: "액세서리", home: "홈 관리", audit: "DB 검수",
};
const PRICE_POLICY = "한국 공식 사이트/공식 유통사 정상가·정가만 사용. 최저가·병행수입·해외가격 제외.";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const clone = (value) => structuredClone(value);
const label = (product) => product?.officialName || product?.model || product?.modelCode || product?.id || "이름 없음";
const priceKey = (name, mount) => `${String(name || "").trim()}||${String(mount || "").trim()}`;
const validNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const formatMoney = (value) => validNumber(value) ? `${Math.round(Number(value)).toLocaleString("ko-KR")}원` : "가격 미확인";
const formatCount = (value) => Number(value || 0).toLocaleString("ko-KR");
const basename = (path) => String(path || "").split("/").pop();
const slug = (value = "item") => String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

let snapshot = null;
let files = {};
let products = [];
let issues = [];
let priceExact = new Map();
let priceByName = new Map();
let pages = { products: 1, prices: 1, images: 1 };
let currentEditor = null;
let toastTimer = null;

async function api(route, options = {}) {
  const response = await fetch(`/admin/api/${route}`, {
    cache: "no-store",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json", "X-Matchcamera-Admin": "1" } : {}),
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok || !data?.ok) throw new Error(data?.error || `관리자 API 오류 (${response.status})`);
  return data;
}

function setLoading(active, text = "데이터 처리 중") {
  $("#loading").hidden = !active;
  $("#loading strong").textContent = text;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

function sourceLabel(path) {
  return ({ [PATHS.products]: "기본 DB", [PATHS.expansion]: "확장 DB", [PATHS.partners]: "공식 파트너" })[path] || basename(path);
}

function rebuildIndexes() {
  products = PRODUCT_PATHS.flatMap((sourceFile) => (files[sourceFile] || []).map((product, sourceIndex) => ({ ...product, _sourceFile: sourceFile, _sourceIndex: sourceIndex })));
  priceExact = new Map();
  priceByName = new Map();
  (files[PATHS.prices] || []).forEach((row, index) => {
    const name = row?.["정식 제품명"];
    if (!name) return;
    const record = { row, index };
    priceExact.set(priceKey(name, row?.["마운트"]), record);
    if (!priceByName.has(name)) priceByName.set(name, []);
    priceByName.get(name).push(record);
  });
  issues = buildIssues();
}

function priceFor(product) {
  const name = label(product);
  const exact = priceExact.get(priceKey(name, product.mount));
  if (exact) return exact;
  const same = priceByName.get(name) || [];
  return same.length === 1 ? same[0] : null;
}

function priceValue(row) {
  if (!row) return null;
  for (const key of ["한국 기준 가격(원)", "한국 공식/출시 가격(원)", "한국 출고가/공식정가(원)"]) {
    if (validNumber(row[key])) return Number(row[key]);
  }
  return null;
}

function imageFor(product) {
  const raw = (files[PATHS.images] || {})[label(product)];
  if (typeof raw === "string") return { src: raw };
  return raw && typeof raw === "object" ? raw : null;
}

function buildIssues() {
  const result = [];
  const ids = new Map();
  const models = new Map();
  for (const product of products) {
    const id = String(product.id || "").trim();
    const model = String(product.modelCode || "").trim().toLowerCase();
    if (id) {
      if (!ids.has(id)) ids.set(id, []);
      ids.get(id).push(product);
    }
    if (model) {
      if (!models.has(model)) models.set(model, []);
      models.get(model).push(product);
    }
    if (!priceValue(priceFor(product)?.row)) result.push(issue("missing-price", "가격 없음", product, "한국 공식/기준 가격이 비어 있습니다."));
    if (!imageFor(product)?.src) result.push(issue("missing-image", "이미지 없음", product, "product-images.json에 이미지가 없습니다."));
    if (!String(product.mount || "").trim()) result.push(issue("missing-mount", "마운트 없음", product, "마운트 필드가 비어 있습니다."));
    const missing = ["id", "manufacturer", "type", "officialName"].filter((key) => !String(product[key] || "").trim());
    if (missing.length) result.push(issue("invalid", "필수 필드 오류", product, `누락: ${missing.join(", ")}`));
  }
  for (const [id, records] of ids) {
    if (records.length > 1) records.forEach((product) => result.push(issue("duplicate-id", "중복 ID", product, `${id}가 ${records.length}개 제품에 사용됨`)));
  }
  for (const [model, records] of models) {
    if (records.length > 1) records.forEach((product) => result.push(issue("duplicate-model", "모델코드 중복", product, `${model}가 ${records.length}개 제품에 사용됨`)));
  }
  return result;
}

function issue(type, title, product, detail) {
  return { type, title, detail, product, sourceFile: product._sourceFile, sourceIndex: product._sourceIndex };
}

function uniqueBrands() {
  return [...new Set(products.map((product) => product.manufacturer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
}

function fillSelect(selector, values, firstLabel) {
  const select = $(selector);
  const current = select.value;
  select.innerHTML = `<option value="">${esc(firstLabel)}</option>${values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
  if (values.includes(current)) select.value = current;
}

function statCard(title, value, note, tone = "") {
  return `<article class="stat-card ${tone}"><small>${esc(title)}</small><strong>${esc(formatCount(value))}</strong><span>${esc(note)}</span></article>`;
}

function issueCounts() {
  return issues.reduce((map, item) => map.set(item.type, (map.get(item.type) || 0) + 1), new Map());
}

function renderDashboard() {
  const bodies = products.filter((product) => product.type === "바디").length;
  const lenses = products.filter((product) => product.type === "렌즈").length;
  const priced = products.filter((product) => priceValue(priceFor(product)?.row)).length;
  const imaged = products.filter((product) => imageFor(product)?.src).length;
  const counts = issueCounts();
  $("#statsGrid").innerHTML = [
    statCard("전체 제품", products.length, "기본·확장·파트너 DB"),
    statCard("카메라 바디", bodies, "전체 시스템 포함"),
    statCard("렌즈", lenses, "교환식 렌즈 전체"),
    statCard("가격 확인", priced, `${products.length - priced}개 미확인`, "good"),
    statCard("이미지 있음", imaged, `${products.length - imaged}개 없음`, "good"),
    statCard("검수 필요", issues.length, "중복 포함 전체 이슈", issues.length ? "bad" : "good"),
  ].join("");
  const coverage = [
    ["가격", priced, products.length], ["제품 이미지", imaged, products.length],
    ["마운트", products.filter((p) => p.mount).length, products.length],
    ["모델 코드", products.filter((p) => p.modelCode).length, products.length],
    ["공식 출처", products.filter((p) => p.officialSource).length, products.length],
  ];
  $("#coverageList").innerHTML = coverage.map(([name, value, total]) => {
    const percent = total ? Math.round((value / total) * 100) : 0;
    return `<div class="coverage-row"><span>${esc(name)}</span><div class="bar"><span data-percent="${percent}"></span></div><b>${percent}%</b></div>`;
  }).join("");
  $$("#coverageList [data-percent]").forEach((bar) => { bar.style.width = `${bar.dataset.percent}%`; });
  $("#repositoryState").innerHTML = [
    ["저장소", `${snapshot.repository.owner}/${snapshot.repository.repo}`],
    ["브랜치", snapshot.repository.branch],
    ["현재 HEAD", snapshot.headSha.slice(0, 12)],
    ["데이터 원본", snapshot.source === "github" ? "GitHub 최신 커밋" : "로컬 정적 파일"],
    ["쓰기 상태", snapshot.writable ? "저장 가능" : "읽기 전용"],
  ].map(([key, value]) => `<div class="repository-row"><span>${esc(key)}</span><b>${esc(value)}</b></div>`).join("");
  $("#dashboardIssues").innerHTML = issues.slice(0, 8).map((item) => `<div class="compact-row"><span class="status ${item.type.includes("missing") ? "warn" : "bad"}">${esc(item.title)}</span><b>${esc(label(item.product))}</b><span>${esc(item.detail)}</span><button class="text-button" data-edit-product data-source="${esc(item.sourceFile)}" data-index="${item.sourceIndex}" type="button">수정</button></div>`).join("") || `<div class="empty-state">검수 항목이 없습니다.</div>`;
  renderAuditCards(counts);
}

function filterText(product, query) {
  const source = [label(product), product.modelCode, product.id, product.manufacturer, product.mount].filter(Boolean).join(" ").toLowerCase();
  return source.includes(String(query || "").trim().toLowerCase());
}

function paged(list, key) {
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  pages[key] = Math.min(Math.max(1, pages[key] || 1), totalPages);
  const start = (pages[key] - 1) * PAGE_SIZE;
  return { rows: list.slice(start, start + PAGE_SIZE), totalPages };
}

function renderPagination(selector, key, totalPages, render) {
  const page = pages[key];
  $(selector).innerHTML = `<button data-page-action="prev" ${page <= 1 ? "disabled" : ""}>이전</button><span>${page} / ${totalPages}</span><button data-page-action="next" ${page >= totalPages ? "disabled" : ""}>다음</button>`;
  $$(`${selector} button`).forEach((button) => button.addEventListener("click", () => {
    pages[key] += button.dataset.pageAction === "next" ? 1 : -1;
    render();
  }));
}

function renderProducts() {
  const query = $("#productSearch").value;
  const brand = $("#productBrand").value;
  const type = $("#productType").value;
  const source = $("#productSource").value;
  const filtered = products.filter((product) => filterText(product, query) && (!brand || product.manufacturer === brand) && (!type || product.type === type) && (!source || product._sourceFile === source));
  const page = paged(filtered, "products");
  $("#productRows").innerHTML = page.rows.map((product) => `<tr><td><div class="product-cell"><strong>${esc(label(product))}</strong><span>${esc(product.id)}</span></div></td><td>${esc(product.manufacturer || "-")}</td><td>${esc(product.type || "-")}</td><td>${esc(product.mount || "-")}</td><td>${esc(product.modelCode || "-")}</td><td><span class="status ${product.currentSale === "예" ? "good" : product.currentSale === "아니오" ? "bad" : "warn"}">${esc(product.saleStatus || product.currentSale || "확인 필요")}</span></td><td>${esc(sourceLabel(product._sourceFile))}</td><td class="row-actions"><button data-edit-product data-source="${esc(product._sourceFile)}" data-index="${product._sourceIndex}" type="button">수정</button></td></tr>`).join("") || `<tr><td colspan="8" class="empty-state">검색 결과가 없습니다.</td></tr>`;
  renderPagination("#productPagination", "products", page.totalPages, renderProducts);
}

function renderPrices() {
  const query = $("#priceSearch").value;
  const brand = $("#priceBrand").value;
  const status = $("#priceStatus").value;
  const filtered = products.filter((product) => {
    const hasPrice = Boolean(priceValue(priceFor(product)?.row));
    return filterText(product, query) && (!brand || product.manufacturer === brand) && (!status || (status === "verified" ? hasPrice : !hasPrice));
  });
  const page = paged(filtered, "prices");
  $("#priceRows").innerHTML = page.rows.map((product) => {
    const match = priceFor(product);
    const row = match?.row || {};
    return `<tr><td><div class="product-cell"><strong>${esc(label(product))}</strong><span>${esc(product.modelCode || product.id)}</span></div></td><td>${esc(product.manufacturer || "-")}</td><td>${esc(product.type || "-")}</td><td>${esc(formatMoney(row["한국 공식/출시 가격(원)"]))}</td><td>${esc(formatMoney(row["한국 기준 가격(원)"]))}</td><td>${esc(row["가격 기준일"] || "-")}</td><td><span class="status ${priceValue(row) ? "good" : "warn"}">${esc(row["가격 검증 상태"] || "미확인")}</span></td><td class="row-actions"><button data-edit-price data-source="${esc(product._sourceFile)}" data-index="${product._sourceIndex}" type="button">수정</button></td></tr>`;
  }).join("") || `<tr><td colspan="8" class="empty-state">검색 결과가 없습니다.</td></tr>`;
  renderPagination("#pricePagination", "prices", page.totalPages, renderPrices);
}

function renderImages() {
  const query = $("#imageSearch").value;
  const brand = $("#imageBrand").value;
  const status = $("#imageStatus").value;
  const filtered = products.filter((product) => {
    const hasImage = Boolean(imageFor(product)?.src);
    return filterText(product, query) && (!brand || product.manufacturer === brand) && (!status || (status === "available" ? hasImage : !hasImage));
  });
  const page = paged(filtered, "images");
  $("#imageGrid").innerHTML = page.rows.map((product) => {
    const image = imageFor(product);
    return `<article class="image-card"><div class="image-visual">${image?.src ? `<img src="${esc(image.src)}" alt="${esc(label(product))}" loading="lazy">` : `<span class="missing">이미지 없음</span>`}</div><h3>${esc(label(product))}</h3><p>${esc(product.manufacturer || "-")} · ${esc(product.modelCode || product.id)}</p><button data-edit-image data-source="${esc(product._sourceFile)}" data-index="${product._sourceIndex}" type="button">이미지 ${image?.src ? "관리" : "추가"}</button></article>`;
  }).join("") || `<div class="empty-state">검색 결과가 없습니다.</div>`;
  renderPagination("#imagePagination", "images", page.totalPages, renderImages);
}

function renderAccessories() {
  const kind = $("#accessoryKind").value;
  const query = $("#accessorySearch").value.toLowerCase();
  const path = kind === "batteries" ? PATHS.batteries : PATHS.adapters;
  const rows = (files[path] || []).map((row, index) => ({ row, index })).filter(({ row }) => [row.id, row.officialName, row.manufacturer].join(" ").toLowerCase().includes(query));
  if (kind === "batteries") {
    $("#accessoryHead").innerHTML = `<tr><th>배터리</th><th>제조사</th><th>호환 제품</th><th>현재 가격</th><th>판매 상태</th><th></th></tr>`;
    $("#accessoryRows").innerHTML = rows.map(({ row, index }) => `<tr><td><div class="product-cell"><strong>${esc(row.officialName)}</strong><span>${esc(row.id)}</span></div></td><td>${esc(row.manufacturer || "-")}</td><td>${formatCount((row.compatibleNames || []).length)}개</td><td>${esc(formatMoney(row.currentPriceKrw))}</td><td><span class="status ${row.currentSale === "예" ? "good" : "warn"}">${esc(row.currentSale || "확인 필요")}</span></td><td><button class="text-button" data-edit-accessory data-kind="batteries" data-index="${index}" type="button">수정</button></td></tr>`).join("");
  } else {
    $("#accessoryHead").innerHTML = `<tr><th>마운트 어댑터</th><th>제조사</th><th>변환</th><th>AF</th><th>조리개 제어</th><th></th></tr>`;
    $("#accessoryRows").innerHTML = rows.map(({ row, index }) => `<tr><td><div class="product-cell"><strong>${esc(row.officialName)}</strong><span>${esc(row.id)}</span></div></td><td>${esc(row.manufacturer || "-")}</td><td>${esc(row.fromMount || "-")} → ${esc(row.toMount || "-")}</td><td>${esc(row.afSupport || "-")}</td><td>${esc(row.apertureControl || "-")}</td><td><button class="text-button" data-edit-accessory data-kind="adapters" data-index="${index}" type="button">수정</button></td></tr>`).join("");
  }
  if (!rows.length) $("#accessoryRows").innerHTML = `<tr><td colspan="6" class="empty-state">검색 결과가 없습니다.</td></tr>`;
  $("#addAccessory").textContent = kind === "batteries" ? "+ 배터리 추가" : "+ 어댑터 추가";
}

function defaultHome() {
  return { version: 1, banners: [1, 2, 3, 4].map((slot) => ({ slot, src: `/assets/images/banner/Banner${slot}.webp`, href: "", alt: `Matchcamera Banner ${slot}`, enabled: true })), featuredBodyIds: [], featuredLensIds: [], updatedAt: null };
}

function renderHome() {
  const config = files[PATHS.home] || defaultHome();
  const cacheVersion = Number.isFinite(Date.parse(config.updatedAt)) ? Date.parse(config.updatedAt) : "";
  $("#bannerEditor").innerHTML = [1, 2, 3, 4].map((slot) => {
    const item = config.banners?.find((banner) => Number(banner.slot) === slot) || defaultHome().banners[slot - 1];
    const previewSrc = item.src && cacheVersion ? `${item.src}?v=${cacheVersion}` : item.src;
    return `<article class="banner-card" data-banner-card="${slot}"><div class="banner-preview">${previewSrc ? `<img src="${esc(previewSrc)}" alt="${esc(item.alt || "")}">` : `<span>배너 ${slot}</span>`}</div><div class="banner-fields"><div class="field full"><label>대체 텍스트</label><input name="bannerAlt${slot}" value="${esc(item.alt || "")}"></div><div class="field full"><label>클릭 링크</label><input name="bannerHref${slot}" value="${esc(item.href || "")}" placeholder="비워두면 클릭 비활성화"></div><div class="field"><label>이미지 교체 · WEBP 자동 변환</label><input name="bannerFile${slot}" type="file" accept="image/webp,image/png,image/jpeg,image/avif"></div><label class="field-check"><input name="bannerEnabled${slot}" type="checkbox" ${item.enabled !== false ? "checked" : ""}>사용</label></div></article>`;
  }).join("");
  $$('[name^="bannerFile"]', $("#bannerEditor")).forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const preview = input.closest(".banner-card")?.querySelector(".banner-preview");
      if (!preview) return;
      const reader = new FileReader();
      reader.onload = () => { preview.innerHTML = `<img src="${esc(reader.result)}" alt="선택한 배너 미리보기">`; };
      reader.onerror = () => toast("선택한 배너 미리보기를 불러오지 못했습니다.");
      reader.readAsDataURL(file);
    });
  });
  const bodyOptions = products.filter((p) => p.type === "바디").sort(productSort);
  const lensOptions = products.filter((p) => p.type === "렌즈").sort(productSort);
  $("#featuredBodyEditor").innerHTML = featuredSelects("featuredBody", config.featuredBodyIds || [], bodyOptions);
  $("#featuredLensEditor").innerHTML = featuredSelects("featuredLens", config.featuredLensIds || [], lensOptions);
}

function productSort(a, b) {
  return String(a.manufacturer || "").localeCompare(String(b.manufacturer || ""), "ko") || label(a).localeCompare(label(b), "ko");
}

function featuredSelects(name, selected, options) {
  return [0, 1, 2, 3].map((index) => `<select name="${name}${index}"><option value="">선택 안 함</option>${options.map((product) => `<option value="${esc(product.id)}" ${selected[index] === product.id ? "selected" : ""}>${esc(product.manufacturer)} · ${esc(label(product))}</option>`).join("")}</select>`).join("");
}

function renderAuditCards(counts = issueCounts()) {
  const items = [
    ["중복 ID", "duplicate-id"], ["모델코드 중복", "duplicate-model"], ["가격 없음", "missing-price"],
    ["이미지 없음", "missing-image"], ["마운트 없음", "missing-mount"], ["필수 필드 오류", "invalid"],
  ];
  $("#auditCards").innerHTML = items.map(([name, type]) => statCard(name, counts.get(type) || 0, "검수 목록", counts.get(type) ? "warn" : "good")).join("");
}

function renderAudit() {
  const type = $("#auditType").value;
  const query = $("#auditSearch").value.toLowerCase();
  const filtered = issues.filter((item) => (!type || item.type === type) && [item.title, item.detail, label(item.product), item.product.manufacturer].join(" ").toLowerCase().includes(query));
  $("#auditRows").innerHTML = filtered.slice(0, 500).map((item) => `<tr><td><span class="status ${item.type.includes("missing") ? "warn" : "bad"}">${esc(item.title)}</span></td><td><div class="product-cell"><strong>${esc(label(item.product))}</strong><span>${esc(item.product.modelCode || item.product.id)}</span></div></td><td>${esc(item.product.manufacturer || "-")}</td><td>${esc(item.detail)}</td><td>${esc(sourceLabel(item.sourceFile))}</td><td><button class="text-button" data-edit-product data-source="${esc(item.sourceFile)}" data-index="${item.sourceIndex}" type="button">수정</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty-state">검수 항목이 없습니다.</td></tr>`;
}

function renderAll() {
  const brands = uniqueBrands();
  fillSelect("#productBrand", brands, "전체 제조사");
  fillSelect("#priceBrand", brands, "전체 제조사");
  fillSelect("#imageBrand", brands, "전체 제조사");
  $("#productSource").innerHTML = `<option value="">전체 데이터 파일</option>${PRODUCT_PATHS.map((path) => `<option value="${esc(path)}">${esc(sourceLabel(path))}</option>`).join("")}`;
  renderDashboard(); renderProducts(); renderPrices(); renderImages(); renderAccessories(); renderHome(); renderAudit();
}

async function loadState(showLoader = true) {
  if (showLoader) setLoading(true, "GitHub 최신 데이터 불러오는 중");
  try {
    snapshot = await api("state");
    files = snapshot.files;
    rebuildIndexes();
    renderAll();
    $("#readonlyNotice").hidden = snapshot.writable;
    $("#syncState").textContent = `${snapshot.repository.branch} · ${snapshot.headSha.slice(0, 8)}`;
    $("#fatalError").hidden = true;
  } catch (error) {
    $("#fatalError").hidden = false;
    $("#fatalError").textContent = error.message;
    $("#syncState").textContent = "동기화 실패";
  } finally {
    if (showLoader) setLoading(false);
  }
}

async function commit(changes, message) {
  if (!snapshot?.writable) return toast("현재 읽기 전용 모드입니다.");
  setLoading(true, "GitHub에 안전하게 저장하는 중");
  try {
    const result = await api("commit", { method: "POST", body: JSON.stringify({ baseHeadSha: snapshot.headSha, message, changes }) });
    toast(`저장 완료 · ${result.headSha.slice(0, 8)}`);
    $("#editorDialog").close();
    await loadState(false);
  } catch (error) {
    toast(error.message);
    if (/원격 저장소가 변경/.test(error.message)) await loadState(false);
  } finally { setLoading(false); }
}

function field(name, title, value = "", options = {}) {
  const full = options.full ? " full" : "";
  if (options.type === "textarea") return `<div class="field${full}"><label>${esc(title)}</label><textarea name="${esc(name)}" ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""}>${esc(value ?? "")}</textarea></div>`;
  if (options.type === "select") return `<div class="field${full}"><label>${esc(title)}</label><select name="${esc(name)}">${options.values.map((item) => { const pair = Array.isArray(item) ? item : [item, item]; return `<option value="${esc(pair[0])}" ${String(value ?? "") === String(pair[0]) ? "selected" : ""}>${esc(pair[1])}</option>`; }).join("")}</select></div>`;
  return `<div class="field${full}"><label>${esc(title)}</label><input name="${esc(name)}" type="${esc(options.type || "text")}" value="${esc(value ?? "")}" ${options.placeholder ? `placeholder="${esc(options.placeholder)}"` : ""}></div>`;
}

function dialogValue(name) { return $(`[name="${name}"]`, $("#dialogBody"))?.value ?? ""; }
function numOrNull(value) { return String(value).trim() && Number.isFinite(Number(value)) ? Number(value) : null; }
function lines(value) { return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }

function openDialog(title, eyebrow, body, saveHandler, danger = "") {
  $("#dialogTitle").textContent = title;
  $("#dialogEyebrow").textContent = eyebrow;
  $("#dialogBody").innerHTML = body;
  $("#dialogDanger").innerHTML = danger;
  $("#dialogSave").onclick = saveHandler;
  $("#dialogSave").disabled = !snapshot.writable;
  $("#editorDialog").showModal();
}

function getProduct(sourceFile, sourceIndex) {
  return products.find((product) => product._sourceFile === sourceFile && product._sourceIndex === Number(sourceIndex));
}

function openProductEditor(record = null, draft = null) {
  const product = draft ? clone(draft) : record ? clone(record) : { type: "바디", cameraSystem: "미러리스", currentSale: "확인 필요", discontinued: "확인 필요", specs: {} };
  const isNew = !record;
  currentEditor = { type: "product", record };
  const body = `<div class="form-grid">
    ${field("sourceFile", "데이터 파일", record?._sourceFile || PATHS.products, { type: "select", values: PRODUCT_PATHS.map((path) => [path, sourceLabel(path)]) })}
    ${field("id", "제품 ID", product.id || "")}
    ${field("manufacturer", "제조사", product.manufacturer || "")}${field("cameraSystem", "카메라 방식", product.cameraSystem || "")}
    ${field("type", "제품 종류", product.type || "", { type: "select", values: ["바디", "렌즈"] })}${field("mount", "마운트", product.mount || "")}
    ${field("officialName", "정식 제품명", product.officialName || "", { full: true })}
    ${field("model", "모델명", product.model || "")}${field("modelCode", "모델 코드", product.modelCode || "")}
    ${field("series", "시리즈", product.series || "")}${field("releaseDate", "출시일", product.releaseDate || "")}
    ${field("releaseYear", "출시년도", product.releaseYear || "", { type: "number" })}${field("weightG", "무게(g)", product.weightG || "", { type: "number" })}
    ${field("currentSale", "현재 판매", product.currentSale || "확인 필요", { type: "select", values: ["예", "아니오", "확인 필요"] })}${field("discontinued", "단종 여부", product.discontinued || "확인 필요", { type: "select", values: ["예", "아니오", "확인 필요"] })}
    ${field("saleStatus", "판매 상태", product.saleStatus || "")}${field("sensorFormat", "센서 포맷", product.sensorFormat || "")}
    ${field("lensFormat", "렌즈 포맷", product.lensFormat || "")}${field("compatibleSensorFormat", "호환 센서 포맷", product.compatibleSensorFormat || "")}
    ${field("focalLength", "초점거리", product.focalLength || "")}${field("maxAperture", "최대 조리개", product.maxAperture || "")}
    ${field("officialSource", "공식 출처 URL", product.officialSource || "", { full: true })}
    ${field("verifiedAt", "검증일", product.verifiedAt || "")}${field("verification", "검증 상태", product.verification || "")}
    ${field("note", "비고", product.note || "", { type: "textarea", full: true })}
    ${field("specs", "전체 사양 JSON", JSON.stringify(product.specs || {}, null, 2), { type: "textarea", full: true })}
  </div>`;
  const danger = record ? `<button id="duplicateProduct" class="button secondary" type="button">복제</button> <button id="deleteProduct" class="button danger" type="button">제품 삭제</button>` : "";
  openDialog(isNew ? "제품 추가" : "제품 수정", "PRODUCT EDITOR", body, saveProduct, danger);
  if (record) {
    $("#duplicateProduct").onclick = () => {
      const duplicate = clone(record);
      delete duplicate._sourceFile; delete duplicate._sourceIndex;
      duplicate.id = `${record.id}-copy`;
      duplicate.officialName = `${label(record)} 복사본`;
      openProductEditor(null, duplicate);
    };
    $("#deleteProduct").onclick = () => deleteProduct(record);
  }
}

async function saveProduct() {
  const record = currentEditor?.record;
  let specs;
  try { specs = JSON.parse(dialogValue("specs") || "{}"); } catch { return toast("전체 사양 JSON 형식이 올바르지 않습니다."); }
  const sourceFile = dialogValue("sourceFile");
  const id = dialogValue("id").trim() || `${slug(dialogValue("manufacturer"))}-${slug(dialogValue("officialName"))}`;
  const duplicate = products.find((p) => p.id === id && !(record && p._sourceFile === record._sourceFile && p._sourceIndex === record._sourceIndex));
  if (duplicate) return toast(`이미 사용 중인 제품 ID입니다: ${id}`);
  const product = record ? clone(record) : {};
  delete product._sourceFile; delete product._sourceIndex;
  const stringFields = ["manufacturer", "cameraSystem", "type", "mount", "officialName", "model", "modelCode", "series", "releaseDate", "currentSale", "discontinued", "saleStatus", "sensorFormat", "lensFormat", "compatibleSensorFormat", "focalLength", "maxAperture", "officialSource", "verifiedAt", "verification", "note"];
  product.id = id;
  stringFields.forEach((key) => { const value = dialogValue(key).trim(); product[key] = value || null; });
  product.releaseYear = numOrNull(dialogValue("releaseYear"));
  product.weightG = numOrNull(dialogValue("weightG"));
  product.specs = specs;
  Object.assign(product.specs, {
    "제조사": product.manufacturer,
    "카메라 방식": product.cameraSystem,
    "제품 종류": product.type,
    "마운트": product.mount,
    "시리즈": product.series,
    "모델명": product.model,
    "정식 제품명": product.officialName,
    "모델 코드": product.modelCode,
    "출시일": product.releaseDate,
    "출시년도": product.releaseYear,
    "단종 여부": product.discontinued,
    "현재 판매 여부": product.currentSale,
    "센서 포맷": product.sensorFormat,
    "렌즈 포맷": product.lensFormat,
    "호환 센서 포맷": product.compatibleSensorFormat,
    "초점거리": product.focalLength,
    "최대 조리개": product.maxAperture,
    "무게(g)": product.weightG,
    "판매 상태": product.saleStatus,
    "비고": product.note,
    "공식 출처 URL": product.officialSource,
    "데이터 기준일": product.verifiedAt,
    "검증 상태": product.verification,
  });
  const changed = new Map();
  if (record) {
    const oldRows = clone(files[record._sourceFile]);
    oldRows.splice(record._sourceIndex, 1);
    changed.set(record._sourceFile, oldRows);
  }
  const targetRows = changed.has(sourceFile) ? changed.get(sourceFile) : clone(files[sourceFile]);
  targetRows.push(product);
  changed.set(sourceFile, targetRows);
  if (record) {
    const oldName = label(record);
    const newName = label(product);
    const priceMatch = priceFor(record);
    if (priceMatch) {
      const priceRows = clone(files[PATHS.prices]);
      Object.assign(priceRows[priceMatch.index], {
        "제조사": product.manufacturer || "", "카메라 방식": product.cameraSystem || "", "제품 종류": product.type || "",
        "마운트": product.mount || "", "정식 제품명": newName, "모델 코드": product.modelCode || "",
        "출시년도": product.releaseYear || null, "현재 판매 여부(원본)": product.currentSale || "확인 필요",
        "원본 공식 출처 URL": product.officialSource || priceRows[priceMatch.index]["원본 공식 출처 URL"] || "",
      });
      changed.set(PATHS.prices, priceRows);
    }
    if (oldName !== newName && Object.prototype.hasOwnProperty.call(files[PATHS.images], oldName)) {
      const mapping = clone(files[PATHS.images]);
      mapping[newName] = mapping[oldName];
      delete mapping[oldName];
      changed.set(PATHS.images, mapping);
    }
    if (record.id !== product.id) {
      const home = clone(files[PATHS.home] || defaultHome());
      home.featuredBodyIds = (home.featuredBodyIds || []).map((value) => value === record.id ? product.id : value);
      home.featuredLensIds = (home.featuredLensIds || []).map((value) => value === record.id ? product.id : value);
      home.updatedAt = new Date().toISOString();
      changed.set(PATHS.home, home);
    }
  }
  await commit([...changed].map(([path, value]) => ({ path, value })), `Admin: ${record ? "update" : "add"} product ${product.officialName || product.id}`);
}

async function deleteProduct(record) {
  if (!confirm(`제품과 연결된 가격·이미지·홈 대표 설정을 함께 삭제할까요?\n${label(record)}`)) return;
  const rows = clone(files[record._sourceFile]);
  rows.splice(record._sourceIndex, 1);
  const changes = [{ path: record._sourceFile, value: rows }];
  const priceMatch = priceFor(record);
  if (priceMatch) {
    const priceRows = clone(files[PATHS.prices]);
    priceRows.splice(priceMatch.index, 1);
    changes.push({ path: PATHS.prices, value: priceRows });
  }
  const image = imageFor(record);
  if (image) {
    const mapping = clone(files[PATHS.images]);
    delete mapping[label(record)];
    changes.push({ path: PATHS.images, value: mapping });
    const imagePath = localRepoPath(image.src);
    const shared = Object.entries(files[PATHS.images]).some(([name, value]) => name !== label(record) && (typeof value === "string" ? value : value?.src) === image.src);
    if (imagePath && !shared) changes.push({ path: imagePath, delete: true });
  }
  const home = clone(files[PATHS.home] || defaultHome());
  const before = `${(home.featuredBodyIds || []).join("|")}::${(home.featuredLensIds || []).join("|")}`;
  home.featuredBodyIds = (home.featuredBodyIds || []).filter((id) => id !== record.id);
  home.featuredLensIds = (home.featuredLensIds || []).filter((id) => id !== record.id);
  const after = `${home.featuredBodyIds.join("|")}::${home.featuredLensIds.join("|")}`;
  if (before !== after) {
    home.updatedAt = new Date().toISOString();
    changes.push({ path: PATHS.home, value: home });
  }
  await commit(changes, `Admin: delete product ${label(record)}`);
}

function openPriceEditor(product) {
  const match = priceFor(product);
  const row = match ? clone(match.row) : {};
  currentEditor = { type: "price", product, priceIndex: match?.index ?? null };
  const body = `<div class="form-grid">
    ${field("productName", "정식 제품명", label(product), { full: true })}
    ${field("officialPrice", "한국 공식/출시 가격(원)", row["한국 공식/출시 가격(원)"] || "", { type: "number" })}
    ${field("referencePrice", "한국 기준 가격(원)", row["한국 기준 가격(원)"] || "", { type: "number" })}
    ${field("launchPrice", "한국 출고가/공식정가(원)", row["한국 출고가/공식정가(원)"] || "", { type: "number" })}
    ${field("priceType", "가격 유형", row["가격 유형"] || "한국 공식 정상가")}
    ${field("saleStatus", "국내 유통 상태", row["국내 유통 상태"] || product.saleStatus || "확인 필요")}
    ${field("priceDate", "가격 기준일", row["가격 기준일"] || new Date().toISOString().slice(0, 10), { type: "date" })}
    ${field("sourceSite", "가격 출처 사이트", row["가격 출처 사이트"] || `${product.manufacturer || "제조사"} Korea`)}
    ${field("sourceUrl", "가격 출처 URL", row["가격 출처 URL"] || product.officialSource || "", { full: true })}
    ${field("verification", "가격 검증 상태", row["가격 검증 상태"] || "한국 공식 출처 확인")}
    ${field("distribution", "유통 형태", row["유통 형태"] || "정품")}
    ${field("note", "비고", row["비고"] || "", { type: "textarea", full: true })}
  </div>`;
  const danger = match ? `<button id="deletePrice" class="button danger" type="button">가격 정보 삭제</button>` : "";
  openDialog(`${label(product)} 가격`, "KOREA PRICE", body, savePrice, danger);
  if (match) $("#deletePrice").onclick = () => deletePrice(product, match.index);
}

async function savePrice() {
  const { product, priceIndex } = currentEditor;
  const rows = clone(files[PATHS.prices]);
  const row = priceIndex === null ? {} : clone(rows[priceIndex]);
  const official = numOrNull(dialogValue("officialPrice"));
  const reference = numOrNull(dialogValue("referencePrice"));
  const launch = numOrNull(dialogValue("launchPrice"));
  const display = reference || official || launch;
  if (priceIndex === null) row.ID = Math.max(0, ...rows.map((item) => Number(item.ID) || 0)) + 1;
  Object.assign(row, {
    "제조사": product.manufacturer || "", "카메라 방식": product.cameraSystem || "", "제품 종류": product.type || "",
    "마운트": product.mount || "", "정식 제품명": label(product), "모델 코드": product.modelCode || "", "출시년도": product.releaseYear || null,
    "현재 판매 여부(원본)": product.currentSale || "확인 필요", "한국 가격 표시": display ? `${display.toLocaleString("ko-KR")}원` : "출고가 미확인",
    "한국 출고가/공식정가(원)": launch, "한국 기준 가격(원)": reference, "한국 공식/출시 가격(원)": official,
    "가격 유형": dialogValue("priceType").trim(), "가격 정책": row["가격 정책"] || PRICE_POLICY,
    "유통 형태": dialogValue("distribution").trim(), "국내 유통 상태": dialogValue("saleStatus").trim(),
    "가격 기준일": dialogValue("priceDate") || null, "가격 출처 사이트": dialogValue("sourceSite").trim(), "가격 출처 국가": "KR",
    "가격 출처 URL": dialogValue("sourceUrl").trim(), "가격 검증 상태": dialogValue("verification").trim(),
    "비고": dialogValue("note").trim(), "원본 공식 출처 URL": row["원본 공식 출처 URL"] || product.officialSource || "",
  });
  if (priceIndex === null) rows.push(row); else rows[priceIndex] = row;
  await commit([{ path: PATHS.prices, value: rows }], `Admin: update Korea price ${label(product)}`);
}

async function deletePrice(product, index) {
  if (!confirm(`${label(product)}의 가격 행을 삭제할까요?`)) return;
  const rows = clone(files[PATHS.prices]); rows.splice(index, 1);
  await commit([{ path: PATHS.prices, value: rows }], `Admin: delete Korea price ${label(product)}`);
}

function openImageEditor(product) {
  const image = clone(imageFor(product) || {});
  currentEditor = { type: "image", product, image };
  const body = `${image.src ? `<div class="preview-large"><img src="${esc(image.src)}" alt="${esc(label(product))}"></div>` : ""}<div class="form-grid">
    ${field("imageSrc", "사이트 이미지 경로", image.src || "", { full: true, placeholder: "/assets/images/products/..." })}
    <div class="field full"><label>새 이미지 파일</label><input name="imageFile" type="file" accept="image/webp,image/png,image/jpeg,image/avif"></div>
    ${field("sourcePage", "공식 이미지 출처 페이지", image.sourcePage || image.source || "", { full: true })}
    ${field("sourceImage", "원본 이미지 URL", image.sourceImage || "", { full: true })}
    ${field("method", "수집/등록 방식", image.method || "manual-admin")}${field("fetchedAt", "등록일", image.fetchedAt || new Date().toISOString())}
    <label class="field-check"><input name="usageReview" type="checkbox" ${image.usageReviewRequired !== false ? "checked" : ""}>이미지 사용권 검토 필요</label>
  </div>`;
  const danger = image.src ? `<button id="deleteImage" class="button danger" type="button">이미지 제거</button>` : "";
  openDialog(`${label(product)} 이미지`, "PRODUCT IMAGE", body, saveImage, danger);
  if (image.src) $("#deleteImage").onclick = () => deleteImage(product, image);
}

function localRepoPath(src) {
  return String(src || "").startsWith("/assets/images/") ? `public${src}` : null;
}

async function fileBase64(file) {
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  return String(dataUrl).split(",")[1] || "";
}

async function bannerWebpBase64(file) {
  if (!file?.size) throw new Error("선택한 배너 이미지가 비어 있습니다.");
  if (file.size > 6 * 1024 * 1024) throw new Error("배너 원본 파일은 6MB 이하여야 합니다.");
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    if (!bitmap.width || !bitmap.height) throw new Error("배너 이미지 크기를 확인할 수 없습니다.");
    if (bitmap.width * bitmap.height > 40_000_000) throw new Error("배너 이미지 해상도가 너무 큽니다.");
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("배너 이미지 변환을 시작할 수 없습니다.");
    context.drawImage(bitmap, 0, 0);
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.92));
    if (!webp?.size || webp.type !== "image/webp") throw new Error("배너를 WEBP로 변환하지 못했습니다.");
    if (webp.size > 6 * 1024 * 1024) throw new Error("변환된 배너가 6MB를 초과합니다.");
    const base64 = await fileBase64(webp);
    if (!base64) throw new Error("변환된 배너 데이터가 비어 있습니다.");
    return base64;
  } finally {
    bitmap?.close();
  }
}

async function imageDimensions(file) {
  try { const bitmap = await createImageBitmap(file); const result = { width: bitmap.width, height: bitmap.height }; bitmap.close(); return result; }
  catch { return { width: null, height: null }; }
}

async function saveImage() {
  const { product, image: previous } = currentEditor;
  const mapping = clone(files[PATHS.images]);
  const file = $(`[name="imageFile"]`, $("#dialogBody")).files[0];
  let src = dialogValue("imageSrc").trim();
  const changes = [];
  let dimensions = { width: previous.width || null, height: previous.height || null };
  if (file) {
    const extRaw = file.name.split(".").pop().toLowerCase();
    const ext = extRaw === "jpeg" ? "jpg" : extRaw;
    if (!["webp", "png", "jpg", "avif"].includes(ext)) return toast("WEBP, PNG, JPG, AVIF 이미지만 사용할 수 있습니다.");
    const repoPath = `public/assets/images/products/${slug(product.manufacturer)}/${slug(product.id)}.${ext}`;
    src = repoPath.replace(/^public/, "");
    dimensions = await imageDimensions(file);
    changes.push({ path: repoPath, base64: await fileBase64(file) });
    const oldPath = localRepoPath(previous.src);
    if (oldPath && oldPath !== repoPath) changes.push({ path: oldPath, delete: true });
  }
  if (!src) return toast("사이트 이미지 경로나 새 이미지 파일이 필요합니다.");
  mapping[label(product)] = {
    src, sourcePage: dialogValue("sourcePage").trim(), sourceImage: dialogValue("sourceImage").trim(),
    method: dialogValue("method").trim() || "manual-admin", fetchedAt: dialogValue("fetchedAt").trim() || new Date().toISOString(),
    width: dimensions.width, height: dimensions.height,
    usageReviewRequired: $(`[name="usageReview"]`, $("#dialogBody")).checked,
  };
  changes.unshift({ path: PATHS.images, value: mapping });
  await commit(changes, `Admin: update product image ${label(product)}`);
}

async function deleteImage(product, image) {
  if (!confirm(`${label(product)}의 이미지 매핑과 로컬 파일을 제거할까요?`)) return;
  const mapping = clone(files[PATHS.images]); delete mapping[label(product)];
  const changes = [{ path: PATHS.images, value: mapping }];
  const path = localRepoPath(image.src); if (path) changes.push({ path, delete: true });
  await commit(changes, `Admin: delete product image ${label(product)}`);
}

function openAccessoryEditor(kind, index = null) {
  const path = kind === "batteries" ? PATHS.batteries : PATHS.adapters;
  const record = index === null ? {} : clone(files[path][index]);
  currentEditor = { type: "accessory", kind, index, path };
  const body = kind === "batteries" ? `<div class="form-grid">
    ${field("id", "ID", record.id || "")}${field("manufacturer", "제조사", record.manufacturer || "")}${field("officialName", "배터리명", record.officialName || "", { full: true })}
    ${field("currentSale", "현재 판매", record.currentSale || "확인 필요", { type: "select", values: ["예", "아니오", "확인 필요"] })}${field("currentPriceKrw", "한국 가격(원)", record.currentPriceKrw || "", { type: "number" })}
    ${field("priceType", "가격 유형", record.priceType || "")}${field("priceDate", "가격 기준일", record.priceDate || "", { type: "date" })}
    ${field("priceSource", "가격 출처 URL", record.priceSource || "", { full: true })}${field("imageSrc", "이미지 경로", record.imageSrc || "", { full: true })}
    ${field("compatibleNames", "호환 제품명 · 한 줄에 하나", (record.compatibleNames || []).join("\n"), { type: "textarea", full: true })}
    ${field("compatibleModelCodes", "호환 모델코드 · 한 줄에 하나", (record.compatibleModelCodes || []).join("\n"), { type: "textarea", full: true })}
    ${field("compatiblePrefixes", "호환 접두어 · 한 줄에 하나", (record.compatiblePrefixes || []).join("\n"), { type: "textarea", full: true })}${field("note", "비고", record.note || "", { type: "textarea", full: true })}
  </div>` : `<div class="form-grid">
    ${field("id", "ID", record.id || "")}${field("manufacturer", "제조사", record.manufacturer || "")}${field("officialName", "어댑터명", record.officialName || "", { full: true })}
    ${field("fromMount", "렌즈 측 마운트", record.fromMount || "")}${field("toMount", "바디 측 마운트", record.toMount || "")}
    ${field("afSupport", "AF 지원", record.afSupport || "확인 필요", { type: "select", values: ["예", "아니오", "확인 필요"] })}${field("apertureControl", "조리개 제어", record.apertureControl || "확인 필요", { type: "select", values: ["예", "아니오", "확인 필요"] })}
    ${field("exifSupport", "EXIF", record.exifSupport || "확인 필요")}${field("stabilizationLink", "손떨림 연동", record.stabilizationLink || "확인 필요")}
    ${field("weatherSealing", "방진방적", record.weatherSealing || "확인 필요")}${field("focalReducer", "포컬 리듀서", record.focalReducer || "아니오")}
    ${field("magnification", "배율", record.magnification ?? 1, { type: "number" })}${field("note", "비고", record.note || "", { type: "textarea", full: true })}
  </div>`;
  const danger = index === null ? "" : `<button id="deleteAccessory" class="button danger" type="button">삭제</button>`;
  openDialog(index === null ? "액세서리 추가" : "액세서리 수정", kind === "batteries" ? "BATTERY" : "MOUNT ADAPTER", body, saveAccessory, danger);
  if (index !== null) $("#deleteAccessory").onclick = deleteAccessory;
}

async function saveAccessory() {
  const { kind, index, path } = currentEditor;
  const rows = clone(files[path]);
  const record = index === null ? {} : clone(rows[index]);
  if (kind === "batteries") {
    Object.assign(record, {
      id: dialogValue("id").trim(), manufacturer: dialogValue("manufacturer").trim(), officialName: dialogValue("officialName").trim(),
      currentSale: dialogValue("currentSale"), currentPriceKrw: numOrNull(dialogValue("currentPriceKrw")), priceType: dialogValue("priceType").trim(),
      priceDate: dialogValue("priceDate") || null, priceSource: dialogValue("priceSource").trim(), imageSrc: dialogValue("imageSrc").trim(),
      compatibleNames: lines(dialogValue("compatibleNames")), compatibleModelCodes: lines(dialogValue("compatibleModelCodes")),
      compatiblePrefixes: lines(dialogValue("compatiblePrefixes")), note: dialogValue("note").trim(),
    });
  } else {
    ["id", "manufacturer", "officialName", "fromMount", "toMount", "afSupport", "apertureControl", "exifSupport", "stabilizationLink", "weatherSealing", "focalReducer", "note"].forEach((key) => { record[key] = dialogValue(key).trim(); });
    record.magnification = numOrNull(dialogValue("magnification"));
  }
  if (!record.id || !record.officialName) return toast("ID와 제품명은 필수입니다.");
  if (index === null) rows.push(record); else rows[index] = record;
  await commit([{ path, value: rows }], `Admin: ${index === null ? "add" : "update"} ${kind === "batteries" ? "battery" : "mount adapter"} ${record.officialName}`);
}

async function deleteAccessory() {
  const { kind, index, path } = currentEditor;
  const record = files[path][index];
  if (!confirm(`${record.officialName}을(를) 삭제할까요?`)) return;
  const rows = clone(files[path]); rows.splice(index, 1);
  await commit([{ path, value: rows }], `Admin: delete ${kind === "batteries" ? "battery" : "mount adapter"} ${record.officialName}`);
}

async function saveHome() {
  try {
    const current = files[PATHS.home] || defaultHome();
    const config = { version: 1, banners: [], featuredBodyIds: [], featuredLensIds: [], updatedAt: new Date().toISOString() };
    const changes = [];
    for (let slot = 1; slot <= 4; slot += 1) {
      const old = current.banners?.find((banner) => Number(banner.slot) === slot) || defaultHome().banners[slot - 1];
      const file = $(`[name="bannerFile${slot}"]`).files[0];
      let src = old.src;
      if (file) {
        const path = `public/assets/images/banner/Banner${slot}.webp`;
        const base64 = await bannerWebpBase64(file);
        src = path.replace(/^public/, "");
        changes.push({ path, base64 });
        const oldPath = localRepoPath(old.src);
        if (oldPath && oldPath !== path) changes.push({ path: oldPath, delete: true });
      }
      config.banners.push({ slot, src, href: $(`[name="bannerHref${slot}"]`).value.trim(), alt: $(`[name="bannerAlt${slot}"]`).value.trim(), enabled: $(`[name="bannerEnabled${slot}"]`).checked });
    }
    for (let index = 0; index < 4; index += 1) {
      const body = $(`[name="featuredBody${index}"]`).value; if (body) config.featuredBodyIds.push(body);
      const lens = $(`[name="featuredLens${index}"]`).value; if (lens) config.featuredLensIds.push(lens);
    }
    if (new Set(config.featuredBodyIds).size !== config.featuredBodyIds.length || new Set(config.featuredLensIds).size !== config.featuredLensIds.length) return toast("같은 대표 제품을 중복 선택할 수 없습니다.");
    changes.unshift({ path: PATHS.home, value: config });
    await commit(changes, "Admin: update homepage configuration");
  } catch (error) {
    toast(error.message || "배너 이미지를 처리하지 못했습니다.");
  }
}

function showView(view) {
  $$(".side-nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $$(".view").forEach((section) => section.classList.toggle("active", section.dataset.page === view));
  $("#viewTitle").textContent = VIEW_TITLES[view];
  history.replaceState(null, "", `#${view}`);
}

function bindEvents() {
  $$(".side-nav button").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$('[data-go]').forEach((button) => button.addEventListener("click", () => showView(button.dataset.go)));
  $("#refreshButton").addEventListener("click", () => loadState());
  [["#productSearch", renderProducts], ["#productBrand", renderProducts], ["#productType", renderProducts], ["#productSource", renderProducts], ["#priceSearch", renderPrices], ["#priceBrand", renderPrices], ["#priceStatus", renderPrices], ["#imageSearch", renderImages], ["#imageBrand", renderImages], ["#imageStatus", renderImages], ["#accessoryKind", renderAccessories], ["#accessorySearch", renderAccessories], ["#auditType", renderAudit], ["#auditSearch", renderAudit]].forEach(([selector, renderer]) => {
    $(selector).addEventListener($(selector).tagName === "INPUT" ? "input" : "change", () => { pages.products = pages.prices = pages.images = 1; renderer(); });
  });
  $("#addProduct").addEventListener("click", () => openProductEditor());
  $("#addAccessory").addEventListener("click", () => openAccessoryEditor($("#accessoryKind").value));
  $("#saveHome").addEventListener("click", saveHome);
  document.addEventListener("click", (event) => {
    const productButton = event.target.closest("[data-edit-product]");
    if (productButton) return openProductEditor(getProduct(productButton.dataset.source, productButton.dataset.index));
    const priceButton = event.target.closest("[data-edit-price]");
    if (priceButton) return openPriceEditor(getProduct(priceButton.dataset.source, priceButton.dataset.index));
    const imageButton = event.target.closest("[data-edit-image]");
    if (imageButton) return openImageEditor(getProduct(imageButton.dataset.source, imageButton.dataset.index));
    const accessoryButton = event.target.closest("[data-edit-accessory]");
    if (accessoryButton) return openAccessoryEditor(accessoryButton.dataset.kind, Number(accessoryButton.dataset.index));
  });
}

async function boot() {
  bindEvents();
  const initialView = location.hash.slice(1);
  if (VIEW_TITLES[initialView]) showView(initialView);
  setLoading(true, "관리자 세션 확인 중");
  try {
    const session = await api("session");
    $("#sessionEmail").textContent = session.user.email;
    await loadState(false);
  } catch (error) {
    $("#fatalError").hidden = false;
    $("#fatalError").textContent = error.message;
    $("#sessionEmail").textContent = "인증 실패";
  } finally { setLoading(false); }
}

boot();
