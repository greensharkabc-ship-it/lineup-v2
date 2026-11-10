// Turns the raw pile from every site into a short, ordered list for one person:
// drops what they can't attend, merges duplicates, and scores the rest.

import { haversine, sameCity, countryName } from './geo.js';

export const TYPES = ['hackathon', 'meetup', 'conference', 'workshop', 'contest', 'ctf', 'competition'];

const DAY = 86400e3;
const ALLOWED_TIERS = {
  city: ['city'],
  region: ['city', 'region'],
  country: ['city', 'region', 'country'],
  anywhere: ['city', 'region', 'country', 'abroad', 'unknown'],
};
const BEGINNER = /beginner|student|college|campus|fresher|freshers|first[- ]time|no experience|high school|undergrad|learn to code|101\b/i;
const JUNK = /\b(test|testing|sanity|dummy|sample) (event|contest|hackathon|listing)\b|delete me|do not register|\btest\d*\b$/i;

const ts = v => (v ? Date.parse(v) : NaN);
const titleKey = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '');

/** Same event listed on two sites (or twice on one): keep the first, note the rest. */
function dedupe(events) {
  const byId = new Set();
  const byTitle = new Map();
  const out = [];
  for (const e of events) {
    if (byId.has(e.id)) continue;
    byId.add(e.id);
    const key = titleKey(e.title);
    const twins = byTitle.get(key) || [];
    const start = ts(e.start);
    const twin = key.length >= 6 && twins.find(t => {
      const other = ts(t.start);
      return Number.isNaN(start) || Number.isNaN(other) ? t.source !== e.source : Math.abs(start - other) < 3 * DAY;
    });
    if (twin) {
      if (twin.source !== e.source && !twin.alsoOn.some(a => a.source === e.source)) {
        twin.alsoOn.push({ source: e.source, label: e.sourceLabel, url: e.url });
      }
      for (const tag of e.tags || []) if (!twin.tags.includes(tag)) twin.tags.push(tag);
      twin.blurb ||= e.blurb;
      twin.deadline ||= e.deadline;
      continue;
    }
    const copy = { ...e, tags: [...(e.tags || [])], alsoOn: [] };
    twins.push(copy);
    byTitle.set(key, twins);
    out.push(copy);
  }
  return out;
}

/** How far an in-person event is from the person: a tier, and km when known. */
function whereFrom(e, loc) {
  if (!loc) return { tier: 'unknown' };
  const cc = e.countryCode;
  if (e.lat != null && e.lon != null) {
    const km = Math.round(haversine(loc.lat, loc.lon, e.lat, e.lon));
    if (cc && cc !== loc.countryCode) return { tier: 'abroad', km };
    if (km <= 60) return { tier: 'city', km };
    if (km <= 350) return { tier: 'region', km };
    return { tier: cc || km < 1200 ? 'country' : 'abroad', km };
  }
  if (cc && cc !== loc.countryCode) return { tier: 'abroad' };
  if ((e.city && sameCity(e.city, loc.name)) || (e.place && sameCity(e.place, loc.name))) return { tier: 'city' };
  if (cc) return { tier: 'country' };
  return { tier: 'unknown' };
}

export function rank(events, ctx) {
  const { prefs, loc, topics, now } = ctx;
  const horizon = now + prefs.days * DAY;
  const allowed = loc ? ALLOWED_TIERS[prefs.radius] : [];
  const out = [];

  for (const e of dedupe(events)) {
    if (!prefs.types.includes(e.type)) continue;
    if (JUNK.test(e.title || '')) continue; // organisers' test listings
    if (prefs.freeOnly && e.free === false) continue;

    // When does this need the person's attention?
    const start = ts(e.start), end = ts(e.end), deadline = ts(e.deadline);
    if (deadline < now) continue; // registration or submissions already closed
    let when, whenKind;
    if (start > now) { when = start; whenKind = 'starts'; }
    else if (deadline >= now) { when = deadline; whenKind = 'closes'; }
    else if (end > now) { when = end; whenKind = 'ends'; }
    else if (Number.isNaN(end) && start > now - DAY / 2) { when = start; whenKind = 'starts'; }
    else continue; // over
    if (when > horizon) continue;

    // Can they get there?
    const mode = e.mode || 'in-person';
    if (prefs.mode === 'online' && mode === 'in-person') continue;
    if (prefs.mode === 'in-person' && mode === 'online') continue;
    let geo;
    if (mode === 'online') geo = { tier: 'online' };
    else {
      geo = whereFrom(e, loc);
      if (!allowed.includes(geo.tier)) {
        // Too far to attend, but a hybrid event still has an online side.
        if (mode === 'hybrid' && prefs.mode !== 'in-person') geo = { tier: 'online', remote: true };
        else continue;
      }
    }

    // Is it about something they care about?
    const title = e.title || '';
    const rest = [(e.tags || []).join(' · '), e.matchText || e.blurb || '', e.organizer || ''].join('\n');
    const matchedTopics = [];
    const terms = new Set();
    let inTitle = false;
    for (const t of topics) {
      const a = title.match(t.re);
      const b = a ? null : rest.match(t.re);
      if (!a && !b) continue;
      matchedTopics.push(t.label);
      if (a) { inTitle = true; for (const word of a) terms.add(word.toLowerCase()); }
    }
    const matched = topics.length ? matchedTopics.length > 0 : true;
    if (e.general && !matched) continue;

    // Score: interests 0-46, place 0-25, timing 0-15, extras 0-14.
    let interest = topics.length ? 0 : 20;
    if (matchedTopics.length) interest = (inTitle ? 32 : 24) + Math.min(matchedTopics.length - 1, 2) * 7;
    const place = { city: 25, region: 19, country: 12, online: prefs.mode === 'online' ? 25 : 15, abroad: 3, unknown: 5 }[geo.tier];
    const days = (when - now) / DAY;
    const timing = days <= 7 ? 15 : days <= 21 ? 12 : days <= 45 ? 9 : days <= 90 ? 6 : 3;
    let extras = 0;
    if (e.popularity > 0) extras += Math.min(5, Math.log10(e.popularity + 1) * 1.4);
    if (e.prize) extras += 2;
    if (e.free === true) extras += 1;
    const beginner = BEGINNER.test(`${title}\n${rest}`);
    if (prefs.beginner && beginner) extras += 6;
    const score = Math.round(interest + place + timing + Math.min(extras, 14));

    out.push({
      id: e.id, title, url: e.url, type: e.type, mode,
      start: e.start || null, end: e.end || null, deadline: e.deadline || null, allDay: !!e.allDay,
      when: new Date(when).toISOString(), whenKind,
      city: e.city || null, region: e.region || null,
      country: e.country || (e.countryCode ? countryName(e.countryCode) : null),
      place: e.place || null,
      geo,
      organizer: e.organizer || null,
      tags: e.tags.slice(0, 6),
      blurb: e.blurb || null,
      prize: e.prize || null,
      free: e.free ?? null,
      popularity: e.popularity || null,
      beginner,
      source: e.source, sourceLabel: e.sourceLabel, alsoOn: e.alsoOn,
      matched, matchedTopics, matchedTerms: [...terms],
      score,
    });
  }

  const order = (a, b) => Number(b.matched) - Number(a.matched) || b.score - a.score || Date.parse(a.when) - Date.parse(b.when);
  out.sort(order);

  // One organiser posting ten near-identical listings shouldn't fill the top of
  // the list: from their third listing on, each one sinks a little further.
  const perOrganizer = new Map();
  for (const e of out) {
    if (!e.organizer) continue;
    const key = `${e.source}|${e.organizer.toLowerCase()}`;
    const n = perOrganizer.get(key) || 0;
    perOrganizer.set(key, n + 1);
    if (n >= 2) e.score -= Math.min(12, (n - 1) * 4);
  }
  out.sort(order);
  return out;
}
