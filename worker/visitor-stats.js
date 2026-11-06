// Browser estimates are kept separate from the identifier-free usage v1 dataset.
const SURFACES = new Set(['programs', 'home', 'body', 'lens', 'database', 'accessories', 'care', 'compare', 'builder', 'resize', 'filename', 'metadata', 'rating', 'carousel', 'exposure', 'shutter', 'contact', 'trust', 'betatest', 'privacy', 'terms', 'beta', 'calculators', 'kit', 'photo_privacy']);
const MAX_BYTES = 256;
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 5_000;
const MAX_PER_MINUTE = 180;
const MAX_BUCKETS = 4096;
const bursts = new Map();
let burstMinute = -1;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

function reply(status, extra = {}) {
  return new Response(null, { status, headers: { ...HEADERS, ...extra } });
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: HEADERS });
}

function dayIndex(time) { return Math.floor((time + KST_OFFSET_MS) / DAY_MS); }
function dayLabel(index) { return new Date(index * DAY_MS).toISOString().slice(0, 10); }
function dayStart(index) { return index * DAY_MS - KST_OFFSET_MS; }

function allowedOrigin(request) {
  const url = new URL(request.url);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const canonical = url.protocol === 'https:' && ['matchcamera.com', 'www.matchcamera.com'].includes(url.hostname) && !url.port;
  return (canonical || local) && request.headers.get('Origin') === url.origin;
}

function allowBurst(request) {
  const minute = Math.floor(Date.now() / 60_000);
  if (minute !== burstMinute) { bursts.clear(); burstMinute = minute; }
  // The connection address lives only in this isolate's current-minute map.
  // It is never forwarded to the Durable Object, returned or logged.
  const key = request.headers.get('CF-Connecting-IP') || 'local';
  if (!bursts.has(key) && bursts.size >= MAX_BUCKETS) return false;
  const count = (bursts.get(key) || 0) + 1;
  bursts.set(key, count);
  return count <= MAX_PER_MINUTE;
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
      if (size > MAX_BYTES) { await reader.cancel(); return { status: 413 }; }
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

function hasBinding(env) {
  return typeof env.VISITOR_STATS?.idFromName === 'function' && typeof env.VISITOR_STATS?.get === 'function';
}

async function callStore(env, path, payload) {
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error('Visitor statistics timeout')); }, UPSTREAM_TIMEOUT_MS);
  });
  try {
    const stub = env.VISITOR_STATS.get(env.VISITOR_STATS.idFromName('matchcamera-visitors-v1'));
    return await Promise.race([
      stub.fetch(new Request(`https://visitor-stats.internal/${path}`, {
        method: payload ? 'POST' : 'GET',
        headers: payload ? { 'Content-Type': 'application/json' } : {},
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
      })),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleVisit(request, env) {
  if (request.method !== 'POST') return reply(405, { Allow: 'POST' });
  if (!allowedOrigin(request)) return reply(403);
  if (request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1') return reply(204);
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415);
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) return reply(413);
  if (!allowBurst(request)) return reply(429, { 'Retry-After': '60' });
  const { payload, status } = await readSmallBody(request);
  if (status) return reply(status);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || Object.keys(payload).length !== 2 || !Object.hasOwn(payload, 'visitorId') || !Object.hasOwn(payload, 'surface')
    || typeof payload.visitorId !== 'string' || !/^[0-9a-f]{32}$/.test(payload.visitorId)
    || !SURFACES.has(payload.surface)) return reply(400);
  if (!hasBinding(env)) return reply(503);
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload.visitorId));
    const visitorHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const response = await callStore(env, 'record', { visitorHash });
    return reply(response.status === 202 ? 202 : 503);
  } catch {
    // Best effort only; never log browser IDs, network details or private errors.
    return reply(503);
  }
}

export async function readVisitorStats(env) {
  if (!hasBinding(env)) return { ok: true, status: 'unavailable', reason: 'not_configured', timeZone: 'Asia/Seoul' };
  try {
    const response = await callStore(env, 'summary');
    if (!response.ok) throw new Error('Visitor statistics unavailable');
    const data = await response.json();
    if (data?.status !== 'ready') throw new Error('Invalid visitor statistics');
    return { ok: true, ...data };
  } catch {
    return { ok: true, status: 'error', reason: 'temporarily_unavailable', timeZone: 'Asia/Seoul' };
  }
}

// A plain fetch-based Durable Object class keeps the storage logic runnable in
// Node's SQLite tests as well as Cloudflare's SQLite-backed Durable Object runtime.
export class VisitorStats {
  constructor(ctx) {
    this.storage = ctx.storage;
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS visitor_days (day TEXT NOT NULL, visitor_hash TEXT NOT NULL, page_views INTEGER NOT NULL, PRIMARY KEY (day, visitor_hash))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS visitor_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  meta(key) {
    return [...this.sql.exec('SELECT value FROM visitor_meta WHERE key = ?', key)][0]?.value || null;
  }

  setMeta(key, value) {
    this.sql.exec('INSERT INTO visitor_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  cleanup(now, force = false) {
    const current = dayIndex(now);
    const day = dayLabel(current);
    if (force || this.meta('last_cleanup_day') !== day) {
      this.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM visitor_days WHERE day < ?', dayLabel(current - RETENTION_DAYS + 1));
        this.setMeta('last_cleanup_day', day);
      });
    }
  }

  async scheduleCleanup(now) {
    // Do not push an existing alarm into the future on every page view.
    if (await this.storage.getAlarm() === null) await this.storage.setAlarm(dayStart(dayIndex(now) + 1) + 60_000);
  }

  record(visitorHash, now) {
    const day = dayLabel(dayIndex(now));
    const timestamp = new Date(now).toISOString();
    this.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO visitor_days (day, visitor_hash, page_views) VALUES (?, ?, 1) ON CONFLICT(day, visitor_hash) DO UPDATE SET page_views = page_views + 1', day, visitorHash);
      if (!this.meta('collected_since')) this.setMeta('collected_since', timestamp);
      this.setMeta('updated_at', timestamp);
    });
  }

  summary(now) {
    const current = dayIndex(now);
    const collectedSince = this.meta('collected_since');
    const firstTime = collectedSince ? Date.parse(collectedSince) : null;
    const firstDay = firstTime === null ? null : dayIndex(firstTime);
    const totals = days => {
      const row = [...this.sql.exec('SELECT COUNT(DISTINCT visitor_hash) AS visitors, COALESCE(SUM(page_views), 0) AS pageViews FROM visitor_days WHERE day >= ? AND day <= ?', dayLabel(current - days + 1), dayLabel(current))][0];
      return { visitors: Number(row.visitors), pageViews: Number(row.pageViews) };
    };
    const window = days => ({
      startDate: dayLabel(current - days + 1), endDate: dayLabel(current),
      observedDays: firstDay === null ? 0 : Math.max(0, Math.min(days, current - firstDay + 1)),
      complete: firstTime !== null && firstTime <= dayStart(current - days + 1),
    });
    const dailyRows = [...this.sql.exec('SELECT day AS date, COUNT(*) AS visitors, SUM(page_views) AS pageViews FROM visitor_days WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day', dayLabel(current - RETENTION_DAYS + 1), dayLabel(current))];
    const rowsByDate = new Map(dailyRows.map(row => [row.date, row]));
    const daily = [];
    if (firstDay !== null) {
      for (let index = Math.max(firstDay, current - RETENTION_DAYS + 1); index <= current; index++) {
        const date = dayLabel(index);
        const row = rowsByDate.get(date);
        daily.push({ date, visitors: Number(row?.visitors || 0), pageViews: Number(row?.pageViews || 0) });
      }
    }
    return {
      status: 'ready', collectedSince, updatedAt: this.meta('updated_at'), timeZone: 'Asia/Seoul', retentionDays: RETENTION_DAYS,
      today: totals(1), last7Days: totals(7), last30Days: totals(30), daily,
      windows: { today: window(1), last7Days: window(7), last30Days: window(30) },
    };
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const now = Date.now();
      if (url.pathname === '/record' && request.method === 'POST') {
        const { payload, status } = await readSmallBody(request);
        if (status) return reply(status);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1
          || typeof payload.visitorHash !== 'string' || !/^[0-9a-f]{64}$/.test(payload.visitorHash)) return reply(400);
        this.cleanup(now);
        this.record(payload.visitorHash, now);
        await this.scheduleCleanup(now);
        return reply(202);
      }
      if (url.pathname === '/summary' && request.method === 'GET') {
        this.cleanup(now);
        const summary = this.summary(now);
        if (summary.last30Days.pageViews > 0) await this.scheduleCleanup(now);
        return json(summary);
      }
      return reply(404);
    } catch {
      return reply(503);
    }
  }

  async alarm() {
    const now = Date.now();
    this.cleanup(now, true);
    // Stop after the last identifier expires. A later visit starts the alarm again.
    const remaining = [...this.sql.exec('SELECT 1 AS present FROM visitor_days LIMIT 1')].length > 0;
    if (remaining) await this.storage.setAlarm(dayStart(dayIndex(now) + 1) + 60_000);
  }
}
