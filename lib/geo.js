// Places: city lookup (Open-Meteo geocoding, no key needed), country names,
// and distances. City coordinates are remembered on disk in .cache/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCached, mapLimit } from './net.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_FILE = path.join(ROOT, '.cache', 'geocode.json');
const GEOCODER = 'https://geocoding-api.open-meteo.com/v1/search';

export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.']/g, '').replace(/\s+/g, ' ').trim();

// ---- countries -------------------------------------------------------------

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const NAME_TO_CODE = new Map();
const CODES = new Set();
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    let name;
    try { name = regionNames.of(code); } catch { continue; }
    if (!name || name === code || /unknown/i.test(name)) continue;
    CODES.add(code);
    NAME_TO_CODE.set(fold(name), code);
  }
}
const ALIASES = {
  US: ['usa', 'us', 'united states of america', 'america'],
  GB: ['uk', 'england', 'scotland', 'wales', 'great britain', 'britain', 'northern ireland'],
  KR: ['south korea', 'korea', 'republic of korea'],
  RU: ['russia', 'russian federation'],
  CZ: ['czech republic', 'czechia'],
  TR: ['turkey', 'turkiye'],
  AE: ['uae', 'united arab emirates'],
  NL: ['the netherlands', 'netherlands', 'holland'],
  VN: ['vietnam', 'viet nam'],
  HK: ['hong kong'],
  TW: ['taiwan'],
  MO: ['macau', 'macao'],
  IN: ['india', 'bharat'],
  DE: ['deutschland'],
};
for (const [code, names] of Object.entries(ALIASES)) for (const n of names) NAME_TO_CODE.set(n, code);

/** "India" | "IN" | "U.S.A." -> "IN" / "US"; null when not recognised. */
export function countryCode(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^[A-Za-z]{2}$/.test(raw) && CODES.has(raw.toUpperCase()) && !NAME_TO_CODE.has(fold(raw))) return raw.toUpperCase();
  return NAME_TO_CODE.get(fold(raw)) || null;
}

export function countryName(code) {
  if (!code) return '';
  try { return regionNames.of(code.toUpperCase()) || code; } catch { return code; }
}

// ---- distance --------------------------------------------------------------

export function haversine(lat1, lon1, lat2, lon2) {
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function sameCity(a, b) {
  const x = fold(a), y = fold(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// ---- geocoding -------------------------------------------------------------

const toPlace = r => ({
  name: r.name,
  admin1: r.admin1 || '',
  country: r.country || countryName(r.country_code),
  countryCode: (r.country_code || '').toUpperCase(),
  lat: r.latitude,
  lon: r.longitude,
});

/** City suggestions for what the person typed ("Delhi", "Pune, India"). */
export async function suggest(text) {
  const parts = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length || parts[0].length < 2) return [];
  const cc = parts.length > 1 ? countryCode(parts[parts.length - 1]) : null;
  const url = `${GEOCODER}?name=${encodeURIComponent(parts[0])}&count=8&language=en${cc ? `&countryCode=${cc}` : ''}`;
  const data = await fetchCached(url, { ttl: 24 * 3600e3, timeout: 8000 });
  return (data.results || []).slice(0, 6).map(toPlace);
}

let disk = null;
let saveTimer = null;
function loadDisk() {
  if (disk) return disk;
  try { disk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { disk = {}; }
  return disk;
}
function saveDisk() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(disk));
    } catch { /* the cache is only a speed-up */ }
  }, 500);
  saveTimer.unref?.();
}

export const cleanCity = c => String(c || '').split(',')[0].replace(/\b(district|metropolitan area|metro area|ncr)\b/gi, '').replace(/\s+/g, ' ').trim();

/** Coordinates for a city name; `cc` limits the lookup to one country, '' means anywhere. */
async function cityCoords(city, cc) {
  const key = `${fold(city)}|${cc}`;
  const store = loadDisk();
  if (key in store) return store[key];
  const data = await fetchCached(`${GEOCODER}?name=${encodeURIComponent(city)}&count=1&language=en${cc ? `&countryCode=${cc}` : ''}`, { ttl: 24 * 3600e3, timeout: 6000 });
  const r = data.results?.[0];
  // Without a country, only accept a real town, not a hamlet that happens to share the name.
  store[key] = r && (cc || (r.population || 0) >= 20000 || /^PPL[ACG]/.test(r.feature_code || '')) ? { lat: r.latitude, lon: r.longitude, cc: (r.country_code || '').toUpperCase() } : null;
  saveDisk();
  return store[key];
}

/**
 * Give in-person events coordinates, so "near you" means kilometres rather
 * than a name match. Events known to be abroad are left alone; events whose
 * country is unknown (a bare "Lisbon") are looked up worldwide.
 */
export async function locateEvents(events, loc, { budgetMs = 6000, maxCities = 240 } = {}) {
  if (!loc) return;
  const byCity = new Map();
  for (const e of events) {
    if (e.mode === 'online' || e.lat != null || !e.city) continue;
    if (e.countryCode && e.countryCode !== loc.countryCode) continue;
    const city = cleanCity(e.city);
    if (city.length < 3) continue;
    const cc = e.countryCode ? loc.countryCode : '';
    const key = `${fold(city)}|${cc}`;
    if (!byCity.has(key)) byCity.set(key, { city, cc, events: [] });
    byCity.get(key).events.push(e);
  }
  const jobs = [...byCity.values()].slice(0, maxCities);
  const work = mapLimit(jobs, 10, async job => {
    const hit = await cityCoords(job.city, job.cc).catch(() => null);
    if (!hit) return;
    for (const e of job.events) {
      e.lat = hit.lat;
      e.lon = hit.lon;
      e.countryCode ||= hit.cc || loc.countryCode;
    }
  });
  // Don't hold the whole search hostage to slow lookups; they finish in the
  // background and are on disk for the next search.
  await Promise.race([work, new Promise(resolve => setTimeout(resolve, budgetMs))]);
}
