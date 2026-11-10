// Sites that mostly list events in India.

import { fetchCached } from '../net.js';
import { stripHtml, clip, iso, guessType, cityFromAddress, rssItems, parseLongRange, monthIndex } from './util.js';

async function fossUnited(ctx) {
  const today = new Date(ctx.now).toISOString().slice(0, 10);
  const fields = JSON.stringify(['name', 'event_name', 'event_type', 'event_start_date', 'event_end_date', 'event_location', 'chapter_name', 'route', 'is_paid_event', 'event_description', 'status']);
  const filters = JSON.stringify([['event_start_date', '>=', today], ['is_published', '=', 1]]);
  const data = await fetchCached(`https://fossunited.org/api/resource/FOSS%20Chapter%20Event?limit_page_length=100&fields=${encodeURIComponent(fields)}&filters=${encodeURIComponent(filters)}`);
  return (data.data || []).filter(e => e.route && e.event_name && !/\btest\b|delete me/i.test(e.event_name)).map(e => {
    const online = /online/i.test(e.event_type || '') || /online/i.test(e.event_location || '');
    const where = online ? {} : cityFromAddress(e.event_location || e.chapter_name || '');
    return {
      id: `fossunited:${e.name}`,
      title: e.event_name,
      url: `https://fossunited.org/${e.route}`,
      type: guessType(`${e.event_type} ${e.event_name}`, 'meetup'),
      start: iso(e.event_start_date?.replace(' ', 'T') + '+05:30'), end: iso(e.event_end_date ? e.event_end_date.replace(' ', 'T') + '+05:30' : null),
      mode: online ? 'online' : 'in-person',
      ...where,
      countryCode: online ? undefined : 'IN',
      organizer: e.chapter_name ? `FOSS United ${e.chapter_name}` : 'FOSS United',
      tags: ['Open source', 'FOSS'],
      blurb: clip(stripHtml(e.event_description)),
      free: !e.is_paid_event,
    };
  });
}

/** KnowAFest writes dates inside free text: "26 November 2026", "Nov 26, 2026", "26/11/2026". */
function dateInText(text, now) {
  const t = String(text || '');
  let m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m) { const r = parseLongRange(`${m[1]} ${m[2].slice(0, 3)} ${m[3]}`); if (r.start) return r; }
  m = t.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (m && monthIndex(m[1]) != null) { const r = parseLongRange(`${m[1].slice(0, 3)} ${m[2]}, ${m[3]}`); if (r.start) return r; }
  m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) { const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))); if (!Number.isNaN(d.getTime())) return { start: d.toISOString(), end: iso(d.getTime() + 86399e3) }; }
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]{3,9})\b/);
  if (m && monthIndex(m[2]) != null) {
    const month = monthIndex(m[2]);
    const year = new Date(now).getUTCFullYear() + (month < new Date(now).getUTCMonth() - 1 ? 1 : 0);
    const d = new Date(Date.UTC(year, month, Number(m[1])));
    return { start: d.toISOString(), end: iso(d.getTime() + 86399e3) };
  }
  return {};
}

async function knowafest(ctx) {
  const xml = await fetchCached('https://www.knowafest.com/feed.xml', { as: 'text' });
  const out = [];
  for (const item of rssItems(xml)) {
    if (!item.link) continue;
    const { start, end } = dateInText(item.description, ctx.now);
    if (!start) continue;
    const text = `${item.title} ${item.categories.join(' ')}`;
    out.push({
      id: `knowafest:${item.link}`,
      title: item.title,
      url: item.link,
      type: guessType(text, /fest|symposium/i.test(text) ? 'conference' : 'competition'),
      start, end, allDay: true,
      mode: /online|virtual/i.test(item.description) ? 'online' : 'in-person',
      countryCode: 'IN',
      tags: ['College fest', ...item.categories.slice(0, 2)],
      blurb: clip(item.description),
    });
  }
  return out;
}

async function geeksforgeeks(ctx) {
  const data = await fetchCached('https://practiceapi.geeksforgeeks.org/api/vr/events/?sub_type=upcoming&page_number=1');
  return (data.results?.upcoming || []).filter(e => e.slug && e.start_time).map(e => {
    const online = !e.location_type || /online|virtual/i.test(e.location_type);
    return {
      id: `gfg:${e.id}`,
      title: e.title,
      url: `https://www.geeksforgeeks.org/events/${e.slug}`,
      type: guessType(`${e.type_text} ${e.title}`, /contest|hackathon/i.test(e.type_text || '') ? 'contest' : 'workshop'),
      start: iso(`${e.start_time}+05:30`), end: iso(e.end_time ? `${e.end_time}+05:30` : null),
      mode: online ? 'online' : 'in-person',
      ...(online ? {} : cityFromAddress(e.location_details || '')),
      countryCode: online ? undefined : 'IN',
      organizer: 'GeeksforGeeks',
      tags: ['GeeksforGeeks', e.type_text].filter(Boolean),
      blurb: clip(e.overview || stripHtml(e.description)),
      free: !Number(e.price),
    };
  }).filter(e => !e.end || Date.parse(e.end) > ctx.now);
}

const src = (id, label, home, run, types) => ({ id, label, home, types, category: 'India', homeCountry: 'IN', run });

export const INDIA_SOURCES = [
  src('fossunited', 'FOSS United', 'https://fossunited.org/events', fossUnited, ['meetup', 'conference', 'workshop', 'hackathon']),
  src('geeksforgeeks', 'GeeksforGeeks events', 'https://www.geeksforgeeks.org/events/', geeksforgeeks, ['workshop', 'contest', 'hackathon']),
  src('knowafest', 'KnowAFest', 'https://www.knowafest.com/events', knowafest, ['competition', 'hackathon', 'conference', 'workshop']),
];
