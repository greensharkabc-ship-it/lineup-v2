// Lineup: a small local site that asks many event sites what's coming up and
// ranks the answers for one person. No dependencies; run with `node server.js`.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './lib/sources.js';
import { resolveTopics } from './lib/topics.js';
import { rank, TYPES } from './lib/rank.js';
import { suggest, locateEvents, countryCode } from './lib/geo.js';
import { describeError, mapLimit } from './lib/net.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4321;
const HOST = process.env.HOST || '127.0.0.1';
const SOURCE_TIMEOUT = 25000;
const MAX_RESULTS = 400;

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

// ---- preferences -----------------------------------------------------------

const text = (v, n) => String(v ?? '').slice(0, n).trim();

function cleanPrefs(b = {}) {
  const types = Array.isArray(b.types) ? b.types.filter(t => TYPES.includes(t)) : [];
  const l = b.loc;
  const loc = l && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lon)) && /^[A-Za-z]{2}$/.test(l.countryCode || '')
    ? { name: text(l.name, 80), admin1: text(l.admin1, 80), country: text(l.country, 80), countryCode: l.countryCode.toUpperCase(), lat: Number(l.lat), lon: Number(l.lon) }
    : null;
  return {
    city: text(b.city, 120),
    loc,
    radius: ['city', 'region', 'country', 'anywhere'].includes(b.radius) ? b.radius : 'country',
    interests: Array.isArray(b.interests) ? b.interests.filter(i => typeof i === 'string').slice(0, 20) : [],
    keywords: text(b.keywords, 200),
    types: types.length ? types : [...TYPES],
    mode: ['any', 'in-person', 'online'].includes(b.mode) ? b.mode : 'any',
    days: [14, 30, 90, 180].includes(Number(b.days)) ? Number(b.days) : 90,
    freeOnly: !!b.freeOnly,
    beginner: !!b.beginner,
  };
}

// ---- search ----------------------------------------------------------------

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), ms)),
]);

async function search(prefs, send) {
  const now = Date.now();
  send({ type: 'start', sources: SOURCES.map(s => ({ id: s.id, label: s.label, home: s.home, category: s.category || 'Other' })) });

  let loc = prefs.loc;
  if (!loc && prefs.city) loc = (await suggest(prefs.city).catch(() => []))[0] || null;
  send({ type: 'loc', loc, asked: prefs.city });

  const topics = resolveTopics(prefs.interests, prefs.keywords);
  const ctx = { prefs, loc, topics, now };
  const all = [];

  // Many sources, a few at a time: polite to the sites and kind to the network.
  await mapLimit(SOURCES, 14, async src => {
    const report = extra => send({ type: 'source', id: src.id, ...extra });
    if (!src.types.some(t => prefs.types.includes(t))) return report({ state: 'skipped', note: 'not one of your event types' });
    if (prefs.mode === 'online' && src.needsCity) return report({ state: 'skipped', note: 'lists in-person events' });
    if (src.needsCity && !loc) return report({ state: 'skipped', note: 'needs your city' });
    if (src.homeCountry && loc && loc.countryCode !== src.homeCountry) return report({ state: 'skipped', note: 'lists events for another country' });
    const began = Date.now();
    try {
      const events = await withTimeout(src.run(ctx), SOURCE_TIMEOUT);
      let kept = 0;
      for (const e of events) {
        if (!e?.title || !/^https?:\/\//i.test(e.url || '')) continue;
        e.source = src.id;
        e.sourceLabel = src.label;
        e.countryCode = (e.countryCode && String(e.countryCode).toUpperCase()) || countryCode(e.country) || null;
        all.push(e);
        kept++;
      }
      report({ state: 'ok', count: kept, ms: Date.now() - began });
    } catch (err) {
      report({ state: 'failed', note: describeError(err) });
    }
  });

  if (loc) {
    send({ type: 'stage', text: 'Measuring distances' });
    await locateEvents(all, loc);
  }
  const ranked = rank(all, ctx);
  send({
    type: 'done',
    events: ranked.slice(0, MAX_RESULTS),
    found: all.length,
    picked: ranked.length,
    topics: topics.map(t => t.label),
    loc,
  });
}

// ---- http ------------------------------------------------------------------

async function readJson(req, limit = 100_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('request too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'forbidden' });
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/geocode') {
      const places = await suggest(url.searchParams.get('q') || '').catch(() => []);
      return json(res, 200, { places });
    }
    if (req.method === 'POST' && url.pathname === '/api/search') {
      const prefs = cleanPrefs(await readJson(req));
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      const send = obj => { if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n'); };
      try { await search(prefs, send); }
      catch (err) { send({ type: 'error', message: describeError(err) }); }
      return res.end();
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, res);
    json(res, 405, { error: 'method not allowed' });
  } catch (err) {
    if (!res.headersSent) json(res, 400, { error: describeError(err) });
    else res.end();
  }
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Lineup may already be running: open http://localhost:${PORT}`);
  else console.error(err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const address = `http://localhost:${PORT}`;
  console.log(`Lineup is running at ${address}  (Ctrl+C to stop)`);
  if (process.argv.includes('--open')) {
    const opener = process.platform === 'win32' ? `start "" "${address}"` : process.platform === 'darwin' ? `open "${address}"` : `xdg-open "${address}"`;
    exec(opener, () => {});
  }
});
