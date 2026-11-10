// Community calendars: Python user groups, OpenStreetMap, IxDA design chapters.

import { fetchCached } from '../net.js';
import { stripHtml, clip, iso, decode, guessType, placeParts, cityFromAddress } from './util.js';

async function pythonOrg() {
  const html = await fetchCached('https://www.python.org/events/', { as: 'text' });
  const out = [];
  for (const m of html.matchAll(/<h3 class="event-title"><a href="([^"]+)">([^<]+)<\/a>[\s\S]*?<time datetime="([^"]+)">[\s\S]*?(?:<span class="event-location">([^<]*)<\/span>)?\s*<\/p>/g)) {
    const where = decode(m[4] || '').trim();
    const online = /^online$/i.test(where);
    const title = decode(m[2]).trim();
    out.push({
      id: `python:${m[1]}`,
      title,
      url: `https://www.python.org${m[1]}`,
      type: /python-events/.test(m[1]) ? 'conference' : guessType(title, 'meetup'),
      start: iso(m[3]),
      mode: online ? 'online' : 'in-person',
      ...(online ? {} : cityFromAddress(where)),
      organizer: 'python.org listing',
      tags: ['Python'],
    });
  }
  return out;
}

async function osmcal(ctx) {
  const list = await fetchCached('https://osmcal.org/api/v2/events/');
  return (list || []).filter(e => e.url && e.date?.start && Date.parse(e.date.end || e.date.start) > ctx.now - 86400e3).map(e => ({
    id: `osmcal:${e.url}`,
    title: e.name,
    url: e.url,
    type: guessType(e.name, 'meetup'),
    start: iso(e.date.start), end: iso(e.date.end), allDay: !!e.date.whole_day,
    mode: e.location ? 'in-person' : 'online',
    ...(e.location ? placeParts(e.location.short) : {}),
    lat: e.location?.coords?.[1], lon: e.location?.coords?.[0],
    organizer: 'OpenStreetMap community',
    tags: ['OpenStreetMap', 'Open source', 'Mapping'],
    free: true,
  }));
}

async function ixda(ctx) {
  const list = await fetchCached('https://ixda.org/wp-json/wp/v2/se-event?per_page=60&orderby=date&order=desc');
  const out = [];
  for (const e of list || []) {
    const meta = e.meta || {};
    const start = Number(meta.se_event_date_start) * 1000;
    if (!start || start < ctx.now) continue;
    const where = String(meta.se_event_location || '').trim();
    const online = /online|virtual|zoom/i.test(where) || !where;
    out.push({
      id: `ixda:${e.id}`,
      title: decode(e.title?.rendered),
      url: meta.se_event_external_link || e.link,
      type: guessType(e.title?.rendered, 'meetup'),
      start: iso(start), end: iso(Number(meta.se_event_date_end) * 1000 || null),
      mode: online ? 'online' : 'in-person',
      ...(online ? {} : cityFromAddress(where)),
      organizer: 'IxDA chapter',
      tags: ['Design', 'UX'],
      blurb: clip(stripHtml(e.excerpt?.rendered)),
    });
  }
  return out;
}

const src = (id, label, home, run, types = ['meetup', 'conference', 'workshop']) => ({ id, label, home, types, category: 'Meetups & communities', run });

export const COMMUNITY_SOURCES = [
  src('python', 'python.org events', 'https://www.python.org/events/', pythonOrg),
  src('osmcal', 'OpenStreetMap calendar', 'https://osmcal.org', osmcal),
  src('ixda', 'IxDA', 'https://ixda.org/events/', ixda),
];
