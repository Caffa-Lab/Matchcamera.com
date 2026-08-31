const ADMIN_PREFIX = "/admin/";
const ADMIN_API_PREFIX = "/admin/api/";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REQUEST_BYTES = 90 * 1024 * 1024;
const MAX_BINARY_BYTES = 6 * 1024 * 1024;

const DATA_PATHS = [
  "public/data/products.json",
  "public/data/system-expansion.json",
  "public/data/official-partner-products.json",
  "public/data/korea-prices.json",
  "public/data/product-images.json",
  "public/data/batteries.json",
  "public/data/mount-adapters.json",
  "public/data/home-config.json",
  "public/data/manufacturer-order.json",
];

const REQUIRED_DATA_PATHS = new Set(DATA_PATHS.slice(0, 7));
const PRODUCT_PATHS = new Set(DATA_PATHS.slice(0, 3));
const ARRAY_DATA_PATHS = new Set([
  ...DATA_PATHS.slice(0, 4),
  "public/data/batteries.json",
  "public/data/mount-adapters.json",
  "public/data/manufacturer-order.json",
]);

const ADMIN_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const jwksCache = new Map();

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, { status, headers: { ...ADMIN_HEADERS, ...extraHeaders } });
}

function withAdminHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(ADMIN_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function normalizeTeamDomain(value = "") {
  return String(value).trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function base64UrlBytes(value) {
  let source = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  source += "=".repeat((4 - (source.length % 4)) % 4);
  const decoded = atob(source);
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}

function parseJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function audienceMatches(actual, expected) {
  return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

async function getAccessJwks(teamDomain) {
  const cached = jwksCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new HttpError(503, "Cloudflare Access 공개 키를 불러오지 못했습니다.");
  const data = await response.json();
  const keys = Array.isArray(data?.keys) ? data.keys : [];
  if (!keys.length) throw new HttpError(503, "Cloudflare Access 공개 키가 비어 있습니다.");
  jwksCache.set(teamDomain, { keys, expiresAt: Date.now() + 60 * 60 * 1000 });
  return keys;
}

async function verifyAccessJwt(token, env) {
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  const expectedAud = String(env.CF_ACCESS_AUD || "").trim();
  if (!teamDomain || !expectedAud) throw new HttpError(503, "관리자 인증 환경변수가 설정되지 않았습니다.");
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new HttpError(401, "유효한 Cloudflare Access 토큰이 필요합니다.");
  let header;
  let payload;
  try {
    header = parseJwtPart(parts[0]);
    payload = parseJwtPart(parts[1]);
  } catch {
    throw new HttpError(401, "Cloudflare Access 토큰을 해석하지 못했습니다.");
  }
  if (header?.alg !== "RS256" || !header?.kid) throw new HttpError(401, "지원하지 않는 Cloudflare Access 토큰입니다.");
  const keys = await getAccessJwks(teamDomain);
  const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) throw new HttpError(401, "Cloudflare Access 서명 키를 찾지 못했습니다.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!verified) throw new HttpError(401, "Cloudflare Access 토큰 서명이 올바르지 않습니다.");
  const now = Math.floor(Date.now() / 1000);
  const expectedIss = `https://${teamDomain}`;
  if (String(payload?.iss || "").replace(/\/+$/, "") !== expectedIss) throw new HttpError(401, "Cloudflare Access 발급자가 일치하지 않습니다.");
  if (!audienceMatches(payload?.aud, expectedAud)) throw new HttpError(401, "Cloudflare Access 대상 애플리케이션이 일치하지 않습니다.");
  if (!Number.isFinite(payload?.exp) || payload.exp <= now - 30) throw new HttpError(401, "Cloudflare Access 세션이 만료되었습니다.");
  if (Number.isFinite(payload?.nbf) && payload.nbf > now + 30) throw new HttpError(401, "아직 유효하지 않은 Cloudflare Access 토큰입니다.");
  if (Number.isFinite(payload?.iat) && payload.iat > now + 60) throw new HttpError(401, "Cloudflare Access 토큰 발급 시간이 올바르지 않습니다.");
  return { email: String(payload.email || payload.sub || "관리자"), subject: String(payload.sub || "") };
}

function isLocalRequest(url) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

async function authenticateAdmin(request, env) {
  const url = new URL(request.url);
  if (env.ADMIN_DEV_BYPASS === "true" && isLocalRequest(url)) {
    return { email: "local-dev@matchcamera.local", subject: "local-dev", local: true };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new HttpError(401, "Cloudflare Access 로그인이 필요합니다.");
  return verifyAccessJwt(token, env);
}

function repoSettings(env) {
  return {
    owner: String(env.GITHUB_REPO_OWNER || "Caffa-Lab"),
    repo: String(env.GITHUB_REPO_NAME || "Matchcamera.com"),
    branch: String(env.GITHUB_REPO_BRANCH || "main"),
  };
}

function githubRefPath(branch) {
  return `heads/${branch.split("/").map(encodeURIComponent).join("/")}`;
}

async function githubRequest(env, path, options = {}) {
  const token = String(env.GITHUB_ADMIN_TOKEN || "").trim();
  if (!token) throw new HttpError(503, "GITHUB_ADMIN_TOKEN이 설정되지 않았습니다.");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Matchcamera-Admin-Worker",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body === "object" && body?.message ? `GitHub API 오류: ${body.message}` : `GitHub API 오류 (${response.status})`;
    throw new HttpError(response.status === 422 ? 409 : 502, message);
  }
  return body;
}

function decodeBase64Text(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function defaultHomeConfig() {
  return {
    version: 1,
    banners: [1, 2, 3, 4].map((slot) => ({ slot, src: `/assets/images/banner/Banner${slot}.webp`, href: "", alt: `Matchcamera Banner ${slot}`, enabled: true })),
    featuredBodyIds: [],
    featuredLensIds: [],
    updatedAt: null,
  };
}

function defaultDataValue(path) {
  if (path === "public/data/home-config.json") return defaultHomeConfig();
  if (path === "public/data/manufacturer-order.json") return [];
  return null;
}

async function readGithubSnapshot(env) {
  const { owner, repo, branch } = repoSettings(env);
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const ref = await githubRequest(env, `${root}/git/ref/${githubRefPath(branch)}`);
  const headSha = ref?.object?.sha;
  if (!headSha) throw new HttpError(502, "GitHub 브랜치 HEAD를 확인하지 못했습니다.");
  const commit = await githubRequest(env, `${root}/git/commits/${encodeURIComponent(headSha)}`);
  const treeSha = commit?.tree?.sha;
  if (!treeSha) throw new HttpError(502, "GitHub 트리를 확인하지 못했습니다.");
  const tree = await githubRequest(env, `${root}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
  if (tree?.truncated) throw new HttpError(502, "GitHub 파일 목록이 잘려 관리자 데이터를 안전하게 읽을 수 없습니다.");
  const byPath = new Map((tree?.tree || []).map((entry) => [entry.path, entry]));
  const files = {};
  await Promise.all(DATA_PATHS.map(async (path) => {
    const entry = byPath.get(path);
    if (!entry) {
      if (REQUIRED_DATA_PATHS.has(path)) throw new HttpError(502, `필수 데이터 파일이 없습니다: ${path}`);
      files[path] = defaultDataValue(path);
      return;
    }
    const blob = await githubRequest(env, `${root}/git/blobs/${encodeURIComponent(entry.sha)}`);
    try { files[path] = JSON.parse(decodeBase64Text(blob?.content)); }
    catch { throw new HttpError(502, `JSON 파일을 해석하지 못했습니다: ${path}`); }
  }));
  return { headSha, treeSha, files, writable: true, source: "github" };
}

async function readLocalAssetState(request, env) {
  const files = {};
  for (const path of DATA_PATHS) {
    const assetUrl = new URL(path.replace(/^public/, ""), request.url);
    const response = await env.ASSETS.fetch(new Request(assetUrl, request));
    if (!response.ok) {
      if (REQUIRED_DATA_PATHS.has(path)) throw new HttpError(502, `로컬 데이터 파일이 없습니다: ${path}`);
      files[path] = defaultDataValue(path);
      continue;
    }
    files[path] = await response.json();
  }
  return { headSha: "local-assets", treeSha: null, files, writable: false, source: "local-assets" };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateHomeConfig(value) {
  if (!isPlainObject(value)) throw new HttpError(400, "홈 설정은 JSON 객체여야 합니다.");
  if (!Array.isArray(value.banners) || value.banners.length > 4) throw new HttpError(400, "배너 설정은 최대 4개여야 합니다.");
  for (const banner of value.banners) {
    if (!isPlainObject(banner) || ![1, 2, 3, 4].includes(Number(banner.slot))) throw new HttpError(400, "배너 슬롯 값이 올바르지 않습니다.");
    if (!/^\/assets\/images\/banner\/Banner[1-4]\.(?:webp|png|jpe?g|avif)$/i.test(String(banner.src || ""))) throw new HttpError(400, "배너 이미지 경로가 허용 범위를 벗어났습니다.");
    const href = String(banner.href || "").trim();
    if (href && !href.startsWith("/") && !/^https:\/\//i.test(href)) throw new HttpError(400, "배너 링크는 사이트 내부 경로 또는 HTTPS URL이어야 합니다.");
  }
  for (const key of ["featuredBodyIds", "featuredLensIds"]) {
    if (!Array.isArray(value[key]) || value[key].length > 4 || value[key].some((id) => typeof id !== "string")) {
      throw new HttpError(400, `${key}는 최대 4개의 제품 ID 배열이어야 합니다.`);
    }
  }
}

function validateJsonValue(path, value) {
  if (!DATA_PATHS.includes(path)) throw new HttpError(400, `수정할 수 없는 데이터 경로입니다: ${path}`);
  if (ARRAY_DATA_PATHS.has(path) && !Array.isArray(value)) throw new HttpError(400, `${path}는 JSON 배열이어야 합니다.`);
  if (path === "public/data/product-images.json" && !isPlainObject(value)) throw new HttpError(400, "product-images.json은 JSON 객체여야 합니다.");
  if (path === "public/data/manufacturer-order.json") {
    if (value.length > 100 || value.some((brand) => typeof brand !== "string" || !brand.trim()) || new Set(value).size !== value.length) {
      throw new HttpError(400, "제조사 순서는 중복 없는 문자열 배열이어야 합니다.");
    }
  }
  if (PRODUCT_PATHS.has(path)) {
    const ids = new Set();
    for (const row of value) {
      if (!isPlainObject(row) || !String(row.id || "").trim()) throw new HttpError(400, `${path}의 모든 제품에는 id가 필요합니다.`);
      if (ids.has(row.id)) throw new HttpError(400, `${path}에 중복 ID가 있습니다: ${row.id}`);
      ids.add(row.id);
    }
  }
  if (path === "public/data/home-config.json") validateHomeConfig(value);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (new TextEncoder().encode(serialized).byteLength > 9 * 1024 * 1024) throw new HttpError(413, `${path}가 허용 크기를 초과했습니다.`);
  return serialized;
}

function normalizeBinaryPath(path) {
  const value = String(path || "");
  const banner = /^public\/assets\/images\/banner\/Banner[1-4]\.(?:webp|png|jpe?g|avif)$/i;
  const product = /^public\/assets\/images\/products\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*\.(?:webp|png|jpe?g|avif)$/i;
  if (!banner.test(value) && !product.test(value)) throw new HttpError(400, `수정할 수 없는 이미지 경로입니다: ${value}`);
  return value;
}

function validateBinaryImage(path, base64) {
  let prefix = "";
  try { prefix = atob(base64.slice(0, 64)); }
  catch { throw new HttpError(400, "이미지 데이터를 해석하지 못했습니다."); }
  if (/\.webp$/i.test(path)) {
    const isWebp = prefix.length >= 12 && prefix.slice(0, 4) === "RIFF" && prefix.slice(8, 12) === "WEBP";
    if (!isWebp) throw new HttpError(400, "WEBP 확장자와 실제 이미지 형식이 일치하지 않습니다.");
  }
}

function validateSameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "다른 출처의 관리자 요청은 허용되지 않습니다.");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) throw new HttpError(403, "교차 사이트 관리자 요청은 허용되지 않습니다.");
  if (request.headers.get("X-Matchcamera-Admin") !== "1") throw new HttpError(403, "관리자 요청 헤더가 없습니다.");
}

async function commitChanges(env, payload) {
  const { owner, repo, branch } = repoSettings(env);
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const changes = Array.isArray(payload?.changes) ? payload.changes : [];
  if (!changes.length || changes.length > 64) throw new HttpError(400, "한 번에 1~64개 파일만 수정할 수 있습니다.");
  const seen = new Set();
  const normalized = [];
  for (const change of changes) {
    const path = String(change?.path || "");
    if (!path || seen.has(path)) throw new HttpError(400, `중복되거나 비어 있는 변경 경로입니다: ${path}`);
    seen.add(path);
    if (Object.prototype.hasOwnProperty.call(change, "value")) {
      normalized.push({ path, content: validateJsonValue(path, change.value), encoding: "utf-8", delete: false });
      continue;
    }
    const binaryPath = normalizeBinaryPath(path);
    if (change?.delete === true) {
      normalized.push({ path: binaryPath, delete: true });
      continue;
    }
    const base64 = String(change?.base64 || "").replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new HttpError(400, "이미지 데이터가 올바른 Base64가 아닙니다.");
    const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    if (!bytes) throw new HttpError(400, "빈 이미지 파일은 저장할 수 없습니다.");
    if (bytes > MAX_BINARY_BYTES) throw new HttpError(413, "이미지는 파일당 6MB 이하여야 합니다.");
    validateBinaryImage(binaryPath, base64);
    normalized.push({ path: binaryPath, content: base64, encoding: "base64", delete: false });
  }
  const ref = await githubRequest(env, `${root}/git/ref/${githubRefPath(branch)}`);
  const currentHead = ref?.object?.sha;
  const expectedHead = String(payload?.baseHeadSha || "");
  if (!currentHead || !expectedHead || expectedHead !== currentHead) throw new HttpError(409, "원격 저장소가 변경되었습니다. 새로고침한 뒤 다시 저장해 주세요.");
  const commit = await githubRequest(env, `${root}/git/commits/${encodeURIComponent(currentHead)}`);
  const baseTree = commit?.tree?.sha;
  if (!baseTree) throw new HttpError(502, "기준 Git 트리를 확인하지 못했습니다.");
  const currentTree = await githubRequest(env, `${root}/git/trees/${encodeURIComponent(baseTree)}?recursive=1`);
  if (currentTree?.truncated) throw new HttpError(502, "GitHub 파일 목록이 잘려 변경 대상을 안전하게 확인할 수 없습니다.");
  const existingPaths = new Set((currentTree?.tree || []).map((entry) => entry.path));
  const treeEntries = [];
  for (const change of normalized) {
    if (change.delete) {
      if (!existingPaths.has(change.path)) continue;
      treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
      continue;
    }
    const blob = await githubRequest(env, `${root}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: change.content, encoding: change.encoding }),
    });
    treeEntries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  if (!treeEntries.length) throw new HttpError(400, "실제로 변경할 파일이 없습니다.");
  const tree = await githubRequest(env, `${root}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }),
  });
  const message = String(payload?.message || "Update Matchcamera data from admin").replace(/[\r\n]+/g, " ").trim().slice(0, 120) || "Update Matchcamera data from admin";
  const created = await githubRequest(env, `${root}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [currentHead] }),
  });
  await githubRequest(env, `${root}/git/refs/${githubRefPath(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: created.sha, force: false }),
  });
  return {
    headSha: created.sha,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${created.sha}`,
    changedPaths: normalized.map((change) => change.path),
  };
}

async function handleAdminApi(request, env, auth) {
  const url = new URL(request.url);
  const route = url.pathname.slice(ADMIN_API_PREFIX.length).replace(/\/+$/, "");
  if (route === "session" && request.method === "GET") {
    return json({
      ok: true,
      user: auth,
      config: {
        access: Boolean(env.CF_ACCESS_TEAM_DOMAIN && env.CF_ACCESS_AUD) || Boolean(auth.local),
        github: Boolean(env.GITHUB_ADMIN_TOKEN),
      },
    });
  }
  if (route === "state" && request.method === "GET") {
    const snapshot = auth.local && !env.GITHUB_ADMIN_TOKEN ? await readLocalAssetState(request, env) : await readGithubSnapshot(env);
    return json({ ok: true, ...snapshot, repository: repoSettings(env) });
  }
  if (route === "commit" && request.method === "POST") {
    validateSameOrigin(request);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_REQUEST_BYTES) throw new HttpError(413, "요청 크기가 12MB를 초과했습니다.");
    let payload;
    try { payload = await request.json(); }
    catch { throw new HttpError(400, "JSON 요청을 해석하지 못했습니다."); }
    return json({ ok: true, ...await commitChanges(env, payload) });
  }
  throw new HttpError(404, "관리자 API 경로를 찾지 못했습니다.");
}

async function handleAdmin(request, env) {
  try {
    const auth = await authenticateAdmin(request, env);
    const url = new URL(request.url);
    if (url.pathname.startsWith(ADMIN_API_PREFIX)) return await handleAdminApi(request, env, auth);
    if (!["GET", "HEAD"].includes(request.method)) throw new HttpError(405, "허용되지 않는 요청 방식입니다.");
    return withAdminHeaders(await env.ASSETS.fetch(request));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "관리자 요청을 처리하지 못했습니다.";
    if (status >= 500 && status !== 503) console.error("Admin error", error);
    return json({ ok: false, error: message, details: error instanceof HttpError ? error.details : null }, status);
  }
}

async function serveAssetOrNotFound(request, env) {
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404 || !["GET", "HEAD"].includes(request.method)) return response;
  const notFoundUrl = new URL("/404.html", request.url);
  const notFound = await env.ASSETS.fetch(new Request(notFoundUrl, request));
  if (!notFound.ok) return response;
  const headers = new Headers(notFound.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : notFound.body, {
    status: 404,
    statusText: "Not Found",
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "matchcamera", platform: "cloudflare-workers", time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/admin") return Response.redirect(`${url.origin}/admin/`, 308);
    if (url.pathname.startsWith(ADMIN_PREFIX)) return handleAdmin(request, env);
    return serveAssetOrNotFound(request, env);
  },
};

export const __test = {
  audienceMatches,
  base64UrlBytes,
  defaultHomeConfig,
  normalizeBinaryPath,
  normalizeTeamDomain,
  validateHomeConfig,
  validateJsonValue,
};
