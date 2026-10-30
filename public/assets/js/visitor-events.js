import { usageOptedOut } from './usage-events.js?v=20260915-phase1';

const VISITOR_SURFACES = new Set(['programs', 'home', 'body', 'lens', 'database', 'accessories', 'compare', 'builder', 'resize', 'filename', 'metadata', 'rating', 'carousel', 'exposure', 'shutter', 'care', 'betatest', 'contact', 'trust', 'privacy', 'terms']);
export const VISITOR_STORAGE_KEY = 'matchcamera.visitor';
const VISITOR_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function readVisitor(storage, now) {
  let visitor;
  try { visitor = JSON.parse(storage.getItem(VISITOR_STORAGE_KEY)); } catch { return null; }
  if (!visitor || typeof visitor.id !== 'string' || !/^[a-f0-9]{32}$/.test(visitor.id)
    || !Number.isSafeInteger(visitor.createdAt) || visitor.createdAt > now
    || visitor.createdAt <= now - VISITOR_LIFETIME_MS) return null;
  return visitor;
}

function browserVisitor() {
  // No storage access, random source or request failure may interrupt the tools.
  const storage = globalThis.localStorage;
  if (!storage) return null;
  const now = Date.now();
  const existing = readVisitor(storage, now);
  if (existing) return existing.id;
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  const visitor = { id: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''), createdAt: now };
  storage.setItem(VISITOR_STORAGE_KEY, JSON.stringify(visitor));
  // Re-read to respect the value if another tab created it at the same time.
  return readVisitor(storage, now)?.id || null;
}

export function forgetVisitor() {
  try { globalThis.localStorage?.removeItem(VISITOR_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}

// A random browser identifier estimates visitors; it does not identify a person.
export async function trackVisit(surface) {
  if (!VISITOR_SURFACES.has(surface) || usageOptedOut()) return false;
  try {
    const visitorId = browserVisitor();
    if (!visitorId) return false;
    const response = await fetch('/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, surface }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      mode: 'cors',
      redirect: 'error',
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
