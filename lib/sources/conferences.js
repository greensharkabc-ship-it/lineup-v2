// Conference listings: industry calendars, developer event feeds and research venues.

import { fetchCached } from '../net.js';
import { clip, iso, decode, guessType, placeParts, parseShortRange, parseLongRange, rssItems, ldEvents, ldMode } from './util.js';

async function techmeme(ctx) {
  const html = await fetchCached('https://www.techmeme.com/events', { as: 'text' });
  const out = [];
  for (const m of html.matchAll(/<div class="rhov"><a href="([^"]+)"><div>([^<]*)<\/div><div>([^<]*)(?:<span>[^<]*<\/span>)?<\/div><div>([^<]*)<\/div><\/a>/g)) {
    const title = decode(m[3]).trim();
    if (!title || /^(Earnings|IPO|Lockup|Expiration):/i.test(title)) continue;
    const { start, end } = parseShortRange(m[2], ctx.now);
    if (!start) continue;
    // "/r2/websummit.com_-awzxRwUO.htm" encodes the event's own address.
    const slug = m[1].match(/^\/r2\/(.+?)-[A-Za-z0-9_-]{8}\.htm$/)?.[1];
    const url = slug ? `https://${slug.replace(/_$/, '').replace(/_/g, '/')}` : `https://www.techmeme.com${m[1]}`;
    const where = decode(m[4]).trim();
    const online = /^(online|virtual)$/i.test(where);
    out.push({
      id: `techmeme:${m[1]}`,
      title,
      url,
      type: guessType(title, 'conference'),
      start, end, allDay: true,
      mode: online ? 'online' : where ? 'in-person' : 'online',
      ...(online || !where ? {} : placeParts(where)),
      tags: ['Industry'],
    });
  }
  return out;
}

async function devEvents() {
  const xml = await fetchCached('https://dev.events/rss.xml', { as: 'text' });
  const out = [];
  for (const item of rssItems(xml)) {
    const m = item.description.match(/is happening on ([A-Za-z]+ \d{1,2}(?:\s*[-–]\s*\d{1,2})?,? \d{4})(?:,\s*(Online)|\s+in\s+([^.]+?))?\.\s*More information/i);
    if (!m) continue;
    const { start, end } = parseLongRange(m[1].replace(/,?\s(\d{4})$/, ', $1'));
    if (!start) continue;
    const online = !!m[2];
    const parts = (m[3] || '').split(',').map(s => s.trim()).filter(Boolean);
    out.push({
      id: `devevents:${item.link}`,
      title: item.title,
      url: item.link,
      type: guessType(item.title, 'conference'),
      start, end, allDay: true,
      mode: online ? 'online' : 'in-person',
      city: online ? undefined : parts[0], country: online ? undefined : parts[1],
      tags: item.categories.slice(0, 4),
    });
  }
  return out;
}

async function kdnuggets(ctx) {
  const html = await fetchCached('https://www.kdnuggets.com/meetings/index.html', { as: 'text' });
  const out = [];
  for (const m of html.matchAll(/<li>\s*([A-Z][a-z]{2}\s[\d]+(?:\s*[-–]\s*(?:[A-Z][a-z]{2}\s)?\d+)?)\s*•\s*<a href="([^"]+)"[^>]*>([^<]+)<\/a>\s*•\s*([^<\n]+)/g)) {
    const { start, end } = parseShortRange(m[1], ctx.now);
    if (!start) continue;
    const where = decode(m[4]).trim();
    const online = /online|virtual/i.test(where);
    const place = where.replace(/\s*\/\s*online\s*$/i, '').trim();
    out.push({
      id: `kdnuggets:${m[2]}`,
      title: decode(m[3]).trim(),
      url: m[2].split('?utm_')[0],
      type: guessType(m[3], 'conference'),
      start, end, allDay: true,
      mode: online && place && !/^online$/i.test(where) ? 'hybrid' : online ? 'online' : 'in-person',
      ...(online && /^online$/i.test(where) ? {} : placeParts(place)),
      tags: ['Data science', 'AI'],
    });
  }
  return out;
}

async function wikicfp() {
  const xml = await fetchCached('http://www.wikicfp.com/cfp/rss?cat=computer%20science', { as: 'text' });
  const out = new Map();
  for (const item of rssItems(xml)) {
    const m = item.description.match(/\[([^\]]*)\]\s*\[([^\]]*)\]\s*$/);
    if (!m) continue;
    const { start, end } = parseLongRange(m[2]);
    if (!start) continue;
    const name = item.title.replace(/^[^:]{1,40}\s:\s/, '').trim() || item.title;
    const key = name.toLowerCase();
    if (out.has(key)) continue;
    const where = m[1].trim();
    const online = /online|virtual/i.test(where);
    out.set(key, {
      id: `wikicfp:${item.link}`,
      title: name,
      url: item.link,
      type: 'conference',
      start, end, allDay: true,
      mode: online ? 'online' : 'in-person',
      ...(online ? {} : placeParts(where.replace('/', ', '))),
      tags: ['Research', 'Call for papers'],
      blurb: item.title !== name ? item.title.split(' : ')[0] : null,
    });
  }
  return [...out.values()];
}

async function infosecConferences() {
  const html = await fetchCached('https://infosec-conferences.com/upcoming/', { as: 'text', timeout: 25000, ttl: 3600e3 });
  return ldEvents(html).filter(e => e.url && e.startDate).map(e => ({
    id: `infosecconf:${e.url}`,
    title: decode(e.name),
    url: e.url,
    type: 'conference',
    start: iso(e.startDate), end: iso(e.endDate ? `${e.endDate}T23:59:00Z` : null), allDay: !/T/.test(e.startDate),
    mode: ldMode(e),
    ...placeParts(e.location?.name || [e.location?.address?.addressLocality, e.location?.address?.addressCountry].filter(Boolean).join(', ')),
    countryCode: e.location?.address?.addressCountry?.length === 2 ? e.location.address.addressCountry : undefined,
    tags: ['Cybersecurity'],
  }));
}

async function productSchool() {
  const html = await fetchCached('https://productschool.com/events', { as: 'text' });
  return ldEvents(html).filter(e => e.name && e.startDate).map(e => ({
    id: `productschool:${e.url || e.name}:${e.startDate}`,
    title: decode(e.name),
    url: e.url || 'https://productschool.com/events',
    type: guessType(e.name, 'workshop'),
    start: iso(e.startDate), end: iso(e.endDate),
    mode: ldMode(e),
    organizer: 'Product School',
    tags: ['Product management'],
    blurb: clip(e.description),
    free: true,
  }));
}

const src = (id, label, home, run, extra = {}) => ({ id, label, home, types: ['conference', 'workshop', 'meetup'], category: 'Conferences', run, ...extra });

export const CONFERENCE_SOURCES = [
  src('techmeme', 'Techmeme events', 'https://www.techmeme.com/events', techmeme),
  src('devevents', 'dev.events', 'https://dev.events', devEvents),
  src('kdnuggets', 'KDnuggets meetings', 'https://www.kdnuggets.com/meetings/', kdnuggets),
  src('wikicfp', 'WikiCFP', 'http://www.wikicfp.com/cfp/call?conference=computer%20science', wikicfp, { types: ['conference'] }),
  src('infosecconf', 'infosec-conferences.com', 'https://infosec-conferences.com', infosecConferences, { types: ['conference'], category: 'Security' }),
  src('productschool', 'Product School', 'https://productschool.com/events', productSchool, { types: ['workshop', 'conference'] }),
];
