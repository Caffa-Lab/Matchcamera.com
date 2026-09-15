const EVENTS = new Set(['page_view', 'tool_start', 'tool_success', 'tool_failure', 'tool_download', 'tool_copy', 'tool_cancelled', 'compare_ready', 'estimate_ready', 'report_open']);
const SURFACES = new Set(['home', 'body', 'lens', 'database', 'accessories', 'compare', 'builder', 'resize', 'filename', 'metadata', 'rating', 'contact', 'trust']);
const MAX_BYTES = 256;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 180;
const MAX_BUCKETS = 4096;
const bursts = new Map();
let burstWindow = 0;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function reply(status, extra = {}) {
  return new Response(null, { status, headers: { ...HEADERS, ...extra } });
}

function allowedOrigin(request) {
  const url = new URL(request.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const canonical = url.protocol === 'https:' && ['matchcamera.com', 'www.matchcamera.com'].includes(url.hostname) && !url.port;
  return (canonical || local) && request.headers.get('Origin') === url.origin;
}

function allowBurst(request) {
  const window = Math.floor(Date.now() / WINDOW_MS);
  if (window !== burstWindow) { bursts.clear(); burstWindow = window; }
  // Cloudflare supplies this address. It stays only in this isolate's current
  // minute bucket: never emit it into Analytics Engine, responses or logs.
  const key = request.headers.get('CF-Connecting-IP') || 'local';
  if (!bursts.has(key) && bursts.size >= MAX_BUCKETS) return false;
  const count = (bursts.get(key) || 0) + 1;
  bursts.set(key, count);
  return count <= MAX_PER_WINDOW;
}

async function readSmallBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return { status: 400 };
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return { status: 413 };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return { payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
  } catch {
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
}

export async function handleUsage(request, env) {
  if (request.method !== 'POST') return reply(405, { Allow: 'POST' });
  if (!allowedOrigin(request)) return reply(403);
  if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') return reply(204);
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415);
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return reply(413);
  if (!allowBurst(request)) return reply(429, { 'Retry-After': '60' });
  const { status, payload } = await readSmallBody(request);
  if (status) return reply(status);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'event') || !Object.hasOwn(payload, 'surface')
    || !EVENTS.has(payload.event) || !SURFACES.has(payload.surface)) return reply(400);
  if (typeof env.USAGE_ANALYTICS?.writeDataPoint !== 'function') return reply(503);
  try {
    env.USAGE_ANALYTICS.writeDataPoint({
      blobs: ['v1', payload.event, payload.surface],
      doubles: [1],
      indexes: [payload.surface],
    });
    // writeDataPoint queues the write; this is not a durable-storage receipt.
    return reply(202);
  } catch {
    return reply(503);
  }
}
