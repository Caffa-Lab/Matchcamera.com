import fs from "node:fs/promises";
import path from "node:path";
import worker from "../worker/index.js";

const root = path.resolve(import.meta.dirname, "..");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const mime = (file) => ({
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp",
})[path.extname(file).toLowerCase()] || "application/octet-stream";

const ASSETS = {
  async fetch(request) {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const file = path.resolve(root, "public", relative);
    if (!file.startsWith(path.resolve(root, "public"))) return new Response("Forbidden", { status: 403 });
    try {
      const data = await fs.readFile(file);
      return new Response(data, { headers: { "Content-Type": mime(file) } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function signedJwt(privateKey, payload, kid = "test-key") {
  const header = base64Url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const body = base64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

async function main() {
  const localEnv = { ASSETS, ADMIN_DEV_BYPASS: "true" };
  let response = await worker.fetch(new Request("http://localhost/admin/"), localEnv);
  assert(response.status === 200, "local admin HTML must load");
  assert(response.headers.get("Cache-Control")?.includes("no-store"), "admin HTML must not be cached");
  assert(response.headers.get("Content-Security-Policy")?.includes("frame-ancestors 'none'"), "admin CSP missing");

  response = await worker.fetch(new Request("http://localhost/admin/api/session"), localEnv);
  const session = await response.json();
  assert(response.status === 200 && session.user.local === true, "local session must use localhost-only bypass");

  response = await worker.fetch(new Request("http://localhost/admin/api/state"), localEnv);
  const state = await response.json();
  const count = state.files["public/data/products.json"].length
    + state.files["public/data/system-expansion.json"].length
    + state.files["public/data/official-partner-products.json"].length;
  assert(response.status === 200 && count === 1170, "admin state product count mismatch");
  assert(state.writable === false && state.source === "local-assets", "tokenless local state must be read-only");

  response = await worker.fetch(new Request("http://localhost/admin/api/commit", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  }), localEnv);
  assert(response.status === 403, "commit without admin request header must be blocked");

  response = await worker.fetch(new Request("http://localhost/admin/api/commit", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Matchcamera-Admin": "1", Origin: "https://evil.example" }, body: JSON.stringify({}),
  }), localEnv);
  assert(response.status === 403, "cross-origin commit must be blocked");

  response = await worker.fetch(new Request("http://localhost/admin/api/commit", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Matchcamera-Admin": "1", Origin: "http://localhost" },
    body: JSON.stringify({ baseHeadSha: "local-assets", changes: [{ path: "public/data/home-config.json", value: state.files["public/data/home-config.json"] }] }),
  }), localEnv);
  assert(response.status === 503, "write without GitHub token must be blocked");

  response = await worker.fetch(new Request("https://matchcamera.com/admin/api/session"), { ASSETS });
  assert(response.status === 401, "production request without Access JWT must be blocked");

  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
  const team = `matchcamera-test-${Date.now()}.cloudflareaccess.com`;
  const aud = "matchcamera-admin-aud";
  const now = Math.floor(Date.now() / 1000);
  const token = await signedJwt(keys.privateKey, { iss: `https://${team}`, aud: [aud], exp: now + 300, iat: now, email: "admin@example.com", sub: "test-admin" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === `https://${team}/cdn-cgi/access/certs`) return Response.json({ keys: [publicJwk] });
    return originalFetch(input, init);
  };
  try {
    response = await worker.fetch(new Request("https://matchcamera.com/admin/api/session", { headers: { "Cf-Access-Jwt-Assertion": token } }), {
      ASSETS, CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud,
    });
    const verified = await response.json();
    assert(response.status === 200 && verified.user.email === "admin@example.com", "valid Access JWT must be accepted");
  } finally {
    globalThis.fetch = originalFetch;
  }

  const calls = [];
  const oldHead = "1".repeat(40);
  const baseTree = "2".repeat(40);
  const newHead = "6".repeat(40);
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });
    if (url.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: oldHead } });
    if (url.endsWith(`/git/commits/${oldHead}`)) return Response.json({ tree: { sha: baseTree } });
    if (url.endsWith(`/git/trees/${baseTree}?recursive=1`)) return Response.json({ tree: [{ path: "public/data/home-config.json", type: "blob", sha: "3".repeat(40) }], truncated: false });
    if (url.endsWith("/git/blobs") && method === "POST") return Response.json({ sha: "4".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/trees") && method === "POST") return Response.json({ sha: "5".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/commits") && method === "POST") return Response.json({ sha: newHead }, { status: 201 });
    if (url.endsWith("/git/refs/heads/main") && method === "PATCH") return Response.json({ object: { sha: newHead } });
    throw new Error(`Unexpected mocked request: ${method} ${url}`);
  };
  try {
    response = await worker.fetch(new Request("https://matchcamera.com/admin/api/commit", {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json", "X-Matchcamera-Admin": "1",
        Origin: "https://matchcamera.com", "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        baseHeadSha: oldHead,
        message: "Admin integration test",
        changes: [{ path: "public/data/home-config.json", value: state.files["public/data/home-config.json"] }],
      }),
    }), {
      ASSETS, CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud, GITHUB_ADMIN_TOKEN: "test-token",
      GITHUB_REPO_OWNER: "Caffa-Lab", GITHUB_REPO_NAME: "Matchcamera.com", GITHUB_REPO_BRANCH: "main",
    });
    const committed = await response.json();
    assert(response.status === 200 && committed.headSha === newHead, "atomic GitHub commit must complete");
    assert(calls.some((call) => call.method === "POST" && call.url.endsWith("/git/trees") && call.body.base_tree === baseTree), "new tree must use current tree as base");
    assert(calls.some((call) => call.method === "PATCH" && call.url.endsWith("/git/refs/heads/main") && call.body.force === false), "branch update must not force push");
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("Admin Worker integration checks: ok");
}

await main();
