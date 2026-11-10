// Small helpers shared by every site adapter.

import { countryCode } from '../geo.js';

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#039;': "'", '&apos;': "'", '&rsquo;': "'", '&lsquo;': "'", '&ldquo;': '"', '&rdquo;': '"', '&ndash;': '-', '&mdash;': '-', '&#8211;': '-', '&#8212;': '-', '&#8216;': "'", '&#8217;': "'", '&#8220;': '"', '&#8221;': '"', '&hellip;': '…', '&#8230;': '…' };
export const decode = s => String(s || '').replace(/&#(\d+);/g, (m, n) => (n < 65536 ? String.fromCharCode(n) : m)).replace(/&[a-z#0-9]+;/gi, m => ENTITIES[m.toLowerCase()] ?? ' ');
export const stripTags = s => decode(String(s || '').replace(/<[^>]*>/g, ''));
export const stripHtml = s => decode(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export const stripMd = s => String(s || '').replace(/\]\([^)]*\)/g, ' ').replace(/[#>*_`~[\]|]/g, ' ').replace(/\s+/g, ' ').trim();
export const clip = (s, n = 200) => {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t;
};
export const iso = v => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
export const enc = encodeURIComponent;

/** Refine the type of an event from a site that mixes kinds. */
export function guessType(text, fallback) {
  const t = String(text || '');
  if (/hackathon|hack ?day|hackfest|buildathon|ideathon|codefest|datathon|game jam|build ?day|builder day|buildfest/i.test(t)) return 'hackathon';
  if (/\bctf\b|capture the flag/i.test(t)) return 'ctf';
  if (/workshop|bootcamp|boot camp|hands[- ]on|masterclass|study jam|study group|codelab|training|webinar|office hours|tutorial/i.test(t)) return 'workshop';
  if (/conference|summit|devfest|\bconf\b|symposium|\bexpo\b|\bcon\b|festival/i.test(t)) return 'conference';
  if (/contest|competition|olympiad|\bquiz\b|championship|challenge/i.test(t)) return 'competition';
  return fallback;
}

/** "Lille, France" -> city + country. Two-letter endings ("Austin, TX") are states, not countries. */
export function placeParts(text) {
  const place = String(text || '').trim();
  const parts = place.split(/,|·/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return {};
  const last = parts[parts.length - 1];
  const cc = parts.length > 1 && (last.length > 3 || /^(usa|uk|uae)$/i.test(last)) ? countryCode(last) : null;
  return { place, city: parts[0], countryCode: cc || undefined };
}

/** For full street addresses: the city is near the end, before the country. */
export function cityFromAddress(text) {
  const parts = String(text || '').split(/,|·/).map(s => s.replace(/\b\d{5,6}\b/g, '').trim()).filter(Boolean);
  if (!parts.length) return {};
  let cc;
  let last = parts[parts.length - 1];
  if (parts.length > 1 && (last.length > 3 || /^(usa|uk|uae)$/i.test(last)) && countryCode(last)) {
    cc = countryCode(last);
    parts.pop();
  }
  last = parts[parts.length - 1] || '';
  // "Stavanger" rather than "4006 Stavanger"; "Indianapolis, IN" keeps the city.
  const city = (parts.length > 1 ? parts[parts.length - 1] : parts[0]).replace(/^\d+\s+/, '');
  return { place: text, city: /^[A-Z]{2}$/.test(city) && parts.length > 1 ? parts[parts.length - 2] : city, countryCode: cc || undefined };
}

export const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
export const monthIndex = name => MONTHS[String(name || '').slice(0, 3).toLowerCase()];

/**
 * Pages that print "Nov 9-12" without a year list upcoming events only, so a
 * month that is well behind today belongs to next year.
 */
export function yearFor(month, now = Date.now()) {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const guess = Date.UTC(year, month + 1, 0);
  return guess < now - 20 * 86400e3 ? year + 1 : year;
}

/** "Nov 9-12", "Nov 30-Dec 2", "Dec 1", "Nov 5-6" -> start/end as all-day UTC. */
export function parseShortRange(text, now = Date.now()) {
  const m = String(text || '').trim().match(/^([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})(?:\s*[-–]\s*(?:([A-Za-z]{3})[a-z]*\.?\s*)?(\d{1,2}))?/);
  if (!m) return {};
  const m1 = monthIndex(m[1]);
  if (m1 == null) return {};
  const y1 = yearFor(m1, now);
  const m2 = m[3] ? monthIndex(m[3]) : m1;
  const d2 = m[4] ? Number(m[4]) : Number(m[2]);
  const y2 = m2 < m1 ? y1 + 1 : y1;
  return { start: new Date(Date.UTC(y1, m1, Number(m[2]))).toISOString(), end: new Date(Date.UTC(y2, m2, d2, 23, 59)).toISOString() };
}

/** Devpost prints ranges like "Oct 01 - Nov 12, 2026" or "Nov 06 - 12, 2026". */
export function parseDateRange(text) {
  if (!text) return {};
  const parts = String(text).split(/\s+-\s+/).map(s => s.trim());
  const year = Number(parts[parts.length - 1].match(/(\d{4})\s*$/)?.[1]);
  if (!year) return {};
  const read = (s, fallbackMonth) => {
    const m = s.match(/^(?:([A-Za-z]{3})[A-Za-z]*\.?\s+)?(\d{1,2})(?:,\s*(\d{4}))?$/);
    if (!m) return null;
    const month = m[1] ? MONTHS[m[1].toLowerCase()] : fallbackMonth;
    if (month == null) return null;
    return { month, day: Number(m[2]), year: m[3] ? Number(m[3]) : null };
  };
  const first = read(parts[0], null);
  if (!first) return {};
  const last = parts.length > 1 ? read(parts[1], first.month) : first;
  if (!last) return {};
  last.year ??= year;
  first.year ??= first.month > last.month ? last.year - 1 : last.year;
  return {
    start: new Date(Date.UTC(first.year, first.month, first.day)).toISOString(),
    end: new Date(Date.UTC(last.year, last.month, last.day, 23, 59)).toISOString(),
  };
}

/** "December 10, 2026" / "December 10-11, 2026" / "Dec 14, 2026 - Dec 17, 2026" -> start/end. */
export function parseLongRange(text) {
  const t = String(text || '').trim();
  let m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[-–]\s*([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s*(\d{4})$/);
  if (m) {
    const m1 = monthIndex(m[1]), m2 = monthIndex(m[4]);
    if (m1 == null || m2 == null) return {};
    const y2 = Number(m[6]), y1 = m[3] ? Number(m[3]) : (m1 > m2 ? y2 - 1 : y2);
    return { start: new Date(Date.UTC(y1, m1, Number(m[2]))).toISOString(), end: new Date(Date.UTC(y2, m2, Number(m[5]), 23, 59)).toISOString() };
  }
  m = t.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?,?\s*(\d{4})$/);
  if (m) {
    const mo = monthIndex(m[1]);
    if (mo == null) return {};
    const y = Number(m[4]);
    return { start: new Date(Date.UTC(y, mo, Number(m[2]))).toISOString(), end: new Date(Date.UTC(y, mo, Number(m[3] || m[2]), 23, 59)).toISOString() };
  }
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s*(\d{4})$/);
  if (m) {
    const mo = monthIndex(m[2]);
    if (mo == null) return {};
    const y = Number(m[3]);
    return { start: new Date(Date.UTC(y, mo, Number(m[1]))).toISOString(), end: new Date(Date.UTC(y, mo, Number(m[1]), 23, 59)).toISOString() };
  }
  return {};
}

/** Every <script type="application/ld+json"> block on a page, parsed. */
export function jsonLd(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { /* skip a broken block */ }
  }
  return out;
}

/** All schema.org Event objects on a page, wherever they sit (arrays, @graph, ItemList). */
export function ldEvents(html) {
  const found = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node['@type'] === 'Event' || (Array.isArray(node['@type']) && node['@type'].includes('Event'))) found.push(node);
    for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) if (node[key]) walk(node[key]);
  };
  jsonLd(html).forEach(walk);
  return found;
}

export const ldMode = e => {
  const a = String(e.eventAttendanceMode || '');
  if (/Online/i.test(a) || e.location?.['@type'] === 'VirtualLocation') return 'online';
  if (/Mixed/i.test(a)) return 'hybrid';
  return 'in-person';
};

/** Items of an RSS 2.0 feed: {title, link, description, categories, pubDate}. */
export function rssItems(xml) {
  const text = s => decode(String(s || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim());
  const tag = (block, name) => text((block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`)) || [])[1]);
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
    title: tag(m[1], 'title'),
    link: tag(m[1], 'link'),
    description: tag(m[1], 'description'),
    pubDate: tag(m[1], 'pubDate'),
    categories: [...m[1].matchAll(/<category[^>]*>([\s\S]*?)<\/category>/g)].map(c => text(c[1])),
  }));
}

/** One Luma listing (from the discover feed or a calendar) in Lineup's shape. */
export function lumaEntry(entry, tags = [], organizer) {
  const ev = entry.event;
  const g = ev.geo_address_info || {};
  const calendar = entry.calendar?.name;
  const url = /^https?:\/\//.test(ev.url) ? ev.url : `https://lu.ma/${ev.url}`;
  return {
    id: `luma:${ev.api_id || url}`,
    title: ev.name,
    url,
    type: guessType(ev.name, 'meetup'),
    start: iso(ev.start_at), end: iso(ev.end_at),
    mode: ev.location_type === 'offline' || (ev.location_type !== 'online' && (g.city || ev.coordinate)) ? 'in-person' : 'online',
    city: g.city || g.city_state?.split(',')[0] || undefined,
    region: g.region || undefined, country: g.country || undefined, countryCode: g.country_code || undefined,
    place: g.address || undefined,
    lat: ev.coordinate?.latitude ?? undefined, lon: ev.coordinate?.longitude ?? undefined,
    organizer: organizer || (calendar && calendar !== 'Personal' ? calendar : entry.hosts?.[0]?.name),
    tags: [...tags],
    free: entry.ticket_info ? !!entry.ticket_info.is_free : null,
    popularity: entry.guest_count,
  };
}

/** One listing from a Bevy-powered community site (GDG, CNCF, Figma and others). */
export function bevyEvent(e, host, tags = []) {
  const virtual = /^virtual$/i.test(e.city || '') || /^virtual$/i.test(e.chapter?.city || '');
  return {
    id: `${host}:${e.id}`,
    title: e.title,
    url: e.url,
    type: guessType(`${e.title} ${(e.tags || []).join(' ')}`, 'meetup'),
    start: iso(e.start_date),
    mode: virtual ? 'online' : 'in-person',
    city: virtual ? undefined : e.city || e.chapter?.city || undefined,
    region: e.chapter?.state || undefined,
    country: e.chapter?.country_name || undefined, countryCode: e.chapter?.country || undefined,
    organizer: e.chapter?.title,
    tags: [...tags, ...(e.tags || []).slice(0, 5)],
    blurb: clip(e.description_short),
  };
}

/** Dates like "2026-11-11 04:00:00 CET" that name a zone instead of an offset. */
const ZONES = { UTC: '+00:00', GMT: '+00:00', CET: '+01:00', CEST: '+02:00', EET: '+02:00', EEST: '+03:00', BST: '+01:00', IST: '+05:30', JST: '+09:00', KST: '+09:00', EST: '-05:00', EDT: '-04:00', CST: '-06:00', CDT: '-05:00', MST: '-07:00', MDT: '-06:00', PST: '-08:00', PDT: '-07:00', AEST: '+10:00', AEDT: '+11:00' };
export function zonedIso(text) {
  const m = String(text || '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([A-Z]{3,4})?$/);
  if (!m) return iso(text);
  return iso(`${m[1]}T${m[2]}${ZONES[m[3]] || '+00:00'}`);
}
