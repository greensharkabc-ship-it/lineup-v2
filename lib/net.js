// Shared HTTP helper: one honest client name, a timeout, and a short in-memory
// cache so repeated searches don't hit the event sites again.

const UA = 'Lineup/1.0 (personal event finder)';
const MAX_ENTRIES = 600;
const cache = new Map();
const inflight = new Map();

export async function fetchCached(url, opts = {}) {
  const { ttl = 15 * 60e3, as = 'json', timeout = 12000, method = 'GET', body, headers, allow404 = false } = opts;
  const key = `${method} ${url} ${body || ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  if (inflight.has(key)) return inflight.get(key);

  const request = (async () => {
    const res = await fetch(url, {
      method,
      body,
      headers: { 'user-agent': UA, accept: 'application/json, text/html;q=0.8', ...headers },
      signal: AbortSignal.timeout(timeout),
    });
    let value;
    if (res.status === 404 && allow404) value = null;
    else if (!res.ok) throw new Error(`responded ${res.status}`);
    else value = as === 'text' ? await res.text() : await res.json();
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
    return value;
  })().finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
}

/** Run fn over items with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Run several requests and keep the ones that worked; fail only if all did. */
export async function gather(items, fn) {
  const settled = await Promise.allSettled(items.map(fn));
  const ok = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
  if (!ok.length && settled.length) throw settled[0].reason;
  return ok;
}

export function describeError(err) {
  if (!err) return 'failed';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timed out';
  if (err.message === 'fetch failed') return 'unreachable';
  return String(err.message || 'failed').slice(0, 80);
}
