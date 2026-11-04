// fetch wrapper with ETag support, timeouts, and poll logging.
import { UA } from './config.mjs';
import * as L from './log.mjs';

const etags = new Map();

export async function get(src, url, { json = true, etag = false, timeoutMs = 15_000, label } = {}) {
  const t0 = performance.now();
  const headers = { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*' };
  if (etag && etags.has(url)) headers['If-None-Match'] = etags.get(url);
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(performance.now() - t0);
    if (res.status === 304) {
      L.poll({ src, label, status: 304, ms, changed: false });
      return { status: 304, notModified: true, ms };
    }
    if (!res.ok) {
      L.poll({ src, label, status: res.status, ms, changed: false });
      L.error({ src, label, status: res.status, url });
      return { status: res.status, error: `HTTP ${res.status}`, ms };
    }
    const text = await res.text();
    if (etag && res.headers.get('etag')) etags.set(url, res.headers.get('etag'));
    const meta = {
      status: res.status, ms, bytes: text.length,
      lastModified: res.headers.get('last-modified'), cache: res.headers.get('x-cache'),
    };
    let body = text;
    if (json) body = JSON.parse(text);
    return { ...meta, body };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    L.poll({ src, label, status: 0, ms, error: String(e.message || e) });
    L.error({ src, label, error: String(e.message || e), url });
    return { status: 0, error: String(e.message || e), ms };
  }
}

export function forgetEtag(url) { etags.delete(url); }
