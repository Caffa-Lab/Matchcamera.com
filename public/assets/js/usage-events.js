const EVENTS = new Set(['page_view', 'tool_start', 'tool_success', 'tool_failure', 'tool_download', 'tool_copy', 'tool_cancelled', 'compare_ready', 'estimate_ready', 'report_open']);
const SURFACES = new Set(['home', 'body', 'lens', 'database', 'accessories', 'compare', 'builder', 'resize', 'filename', 'metadata', 'rating', 'carousel', 'exposure', 'contact', 'trust']);

export function usageOptedOut() {
  try {
    if (globalThis.navigator?.globalPrivacyControl === true || globalThis.navigator?.doNotTrack === '1' || globalThis.window?.doNotTrack === '1') return true;
    const preference = globalThis.localStorage?.getItem('matchcamera.metricsOptOut');
    return preference === '1' || preference === 'true';
  } catch {
    // If the browser blocks preference storage, avoid sending without knowing its choice.
    return true;
  }
}

// Accept only fixed labels. Never pass files, products, search text or URLs here.
export async function trackUsage(event, surface) {
  if (!EVENTS.has(event) || !SURFACES.has(surface) || usageOptedOut()) return false;
  try {
    const response = await fetch('/api/usage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, surface }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      // cors mode preserves Origin on a no-referrer POST; the URL remains local
      // and redirects are forbidden. same-origin mode can send Origin: null.
      mode: 'cors',
      redirect: 'error',
      keepalive: true,
    });
    return response.ok;
  } catch {
    // Measurement is best effort and must never interrupt the user's work.
    return false;
  }
}
