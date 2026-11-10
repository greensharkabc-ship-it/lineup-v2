// One adapter per site. Each returns events in the same shape:
//
//   { id, title, url, type, start, end, deadline, allDay, mode,
//     city, region, country, countryCode, place, lat, lon,
//     organizer, tags, blurb, prize, free, popularity, general }
//
// type: hackathon | meetup | conference | workshop | contest | ctf | competition
// mode: online | in-person | hybrid
// general: true for sites that list every kind of event (Luma, Meetup); those
//          results must match one of the person's interests to be shown.
//
// To add a site: write a function that returns that shape and add it to SOURCES.

import { fetchCached, mapLimit, gather } from './net.js';
import { countryCode } from './geo.js';
import { stripTags, stripHtml, stripMd, clip, iso, enc, guessType, placeParts, parseDateRange, lumaEntry, bevyEvent } from './sources/util.js';
import { BEVY_SOURCES } from './sources/bevy.js';
import { LUMA_CALENDAR_SOURCES } from './sources/lumacals.js';
import { CONTEST_SOURCES } from './sources/contests.js';
import { CHALLENGE_SOURCES } from './sources/challenges.js';
import { CONFERENCE_SOURCES } from './sources/conferences.js';
import { COMMUNITY_SOURCES } from './sources/communities.js';
import { INDIA_SOURCES } from './sources/india.js';

export { parseDateRange };

// ---- hackathon platforms ---------------------------------------------------

async function devpost(ctx) {
  const base = 'https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&per_page=40';
  const urls = [`${base}&page=1`, `${base}&page=2`, `${base}&page=3`, `${base}&challenge_type[]=in-person`];
  for (const t of ctx.topics.slice(0, 3)) urls.push(`${base}&search=${enc(t.search)}`);
  const pages = await gather(urls, u => fetchCached(u));
  const out = new Map();
  for (const page of pages) {
    for (const h of page.hackathons || []) {
      if (h.invite_only || out.has(h.id)) continue;
      const where = h.displayed_location?.location || '';
      const online = h.displayed_location?.icon === 'globe' || /^online$/i.test(where);
      const { start, end } = parseDateRange(h.submission_period_dates);
      const prize = stripTags(h.prize_amount).replace(/\s+/g, '');
      out.set(h.id, {
        id: `devpost:${h.id}`,
        title: h.title,
        url: h.url,
        type: 'hackathon',
        start, end, deadline: end, allDay: true,
        mode: online ? 'online' : 'in-person',
        ...(online ? {} : placeParts(where)),
        organizer: h.organization_name,
        tags: (h.themes || []).map(t => t.name),
        prize: /[1-9]/.test(prize) ? `${prize} in prizes` : null,
        popularity: h.registrations_count,
      });
    }
  }
  return [...out.values()];
}

async function devfolio() {
  const ask = type => fetchCached('https://api.devfolio.co/api/search/hackathons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, from: 0, size: 60 }),
  });
  const pages = await gather(['application_open', 'upcoming'], ask);
  const out = new Map();
  for (const page of pages) {
    for (const hit of page.hits?.hits || []) {
      const s = hit._source;
      if (!s || s.private || out.has(s.uuid)) continue;
      out.set(s.uuid, {
        id: `devfolio:${s.uuid}`,
        title: s.name,
        url: `https://${s.slug}.devfolio.co/`,
        type: 'hackathon',
        start: iso(s.starts_at), end: iso(s.ends_at), deadline: iso(s.hackathon_setting?.reg_ends_at),
        mode: s.is_online ? 'online' : 'in-person',
        city: s.is_online ? undefined : s.city,
        region: s.state, country: s.country, place: s.location,
        tags: (s.themes || []).map(t => t.name).filter(Boolean),
        blurb: clip(s.tagline || stripMd(s.desc)),
        prize: s.prizes?.length ? 'Prizes' : null,
        popularity: s.participants_count,
      });
    }
  }
  return [...out.values()];
}

async function mlh(ctx) {
  // MLH seasons are named for the year they end in and turn over mid-year.
  const d = new Date(ctx.now);
  const season = d.getUTCFullYear() + (d.getUTCMonth() >= 6 ? 1 : 0);
  let html = await fetchCached(`https://mlh.io/seasons/${season}/events`, { as: 'text', allow404: true });
  html ??= await fetchCached(`https://mlh.io/seasons/${season - 1}/events`, { as: 'text' });
  const m = html.match(/data-page="app"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('page layout changed');
  const events = JSON.parse(m[1]).props?.upcomingEvents || [];
  const MODE = { physical: 'in-person', digital: 'online', hybrid_physical: 'hybrid', hybrid: 'hybrid' };
  return events.map(e => ({
    id: `mlh:${e.id}`,
    title: e.name,
    url: e.websiteUrl || `https://www.mlh.com${e.url || ''}`,
    type: 'hackathon',
    start: iso(e.startsAt), end: iso(e.endsAt),
    mode: MODE[e.formatType] || 'in-person',
    city: e.venueAddress?.city || undefined,
    region: e.venueAddress?.state || undefined,
    countryCode: e.venueAddress?.country || undefined,
    place: e.location,
    tags: ['Student hackathon', ...(e.customFields?.hackathon_focus || [])],
  }));
}

async function hackclub() {
  const list = await fetchCached('https://hackathons.hackclub.com/api/events/upcoming');
  return list.map(e => ({
    id: `hackclub:${e.id}`,
    title: e.name,
    url: e.website,
    type: 'hackathon',
    start: iso(e.start), end: iso(e.end),
    mode: e.virtual ? 'online' : e.hybrid ? 'hybrid' : 'in-person',
    city: e.city || undefined, region: e.state || undefined, country: e.country || undefined, countryCode: e.countryCode || undefined,
    lat: e.latitude ?? undefined, lon: e.longitude ?? undefined,
    tags: ['High school students'],
    free: true,
  }));
}

async function hackerearth() {
  const data = await fetchCached('https://www.hackerearth.com/chrome-extension/events/');
  const when = s => iso(String(s || '').replace(' ', 'T'));
  return (data.response || []).map(e => ({
    id: `hackerearth:${e.url}`,
    title: e.title,
    url: e.url,
    type: /hackathon/i.test(e.url) ? 'hackathon' : 'contest',
    start: when(e.start_utc_tz), end: when(e.end_utc_tz), deadline: when(e.end_utc_tz),
    mode: 'online',
    organizer: 'HackerEarth',
    tags: [e.challenge_type].filter(Boolean),
    blurb: clip(stripHtml(e.description)),
  }));
}

// ---- Unstop (India: hackathons, competitions, workshops) --------------------

const UNSTOP_KINDS = [
  { opp: 'hackathons', type: 'hackathon', pages: 2 },
  { opp: 'competitions', type: 'competition', pages: 2 },
  { opp: 'workshops', type: 'workshop', pages: 1 },
  { opp: 'conferences', type: 'conference', pages: 1 },
];
const UNSTOP_TYPE = { hackathons: 'hackathon', workshops: 'workshop', conferences: 'conference' };
const UNSTOP_MODE = { online: 'online', offline: 'in-person', hybrid: 'hybrid' };

async function unstop(ctx) {
  const base = 'https://unstop.com/api/public/opportunity/search-result?oppstatus=open&per_page=50';
  const urls = [];
  for (const kind of UNSTOP_KINDS) {
    if (!ctx.prefs.types.includes(kind.type)) continue;
    for (let p = 1; p <= kind.pages; p++) urls.push(`${base}&opportunity=${kind.opp}&page=${p}`);
    if (kind.pages > 1) for (const t of ctx.topics.slice(0, 2)) urls.push(`${base}&opportunity=${kind.opp}&searchTerm=${enc(t.search)}`);
  }
  if (!urls.length) return [];
  const pages = await gather(urls, u => fetchCached(u));
  const out = new Map();
  for (const page of pages) {
    for (const e of page.data?.data || []) {
      if (out.has(e.id) || e.visibility !== 'public') continue;
      const addr = e.address_with_country_logo || {};
      const regn = e.regnRequirements || {};
      const cc = addr.country?.iso || undefined;
      const cash = (e.prizes || []).reduce((sum, p) => sum + (Number(p.cash) || 0), 0);
      const currency = e.prizes?.find(p => p.currencyCode)?.currencyCode;
      let prize = null;
      if (cash > 0) {
        const symbol = currency === 'INR' || (!currency && (!cc || cc === 'IN')) ? '₹' : currency ? `${currency} ` : null;
        prize = symbol ? `${symbol}${cash.toLocaleString('en-IN')} in prizes` : 'Cash prizes';
      }
      const mode = UNSTOP_MODE[e.region] || (addr.city ? 'in-person' : 'online');
      out.set(e.id, {
        id: `unstop:${e.id}`,
        title: String(e.title || '').trim(),
        url: e.seo_url || `https://unstop.com/${e.public_url}`,
        type: /\bctf\b|capture the flag/i.test(e.title) ? 'ctf' : UNSTOP_TYPE[e.type] || 'competition',
        end: iso(e.end_date), deadline: iso(regn.end_regn_dt),
        mode,
        city: mode === 'online' ? undefined : addr.city || undefined,
        region: addr.state || undefined, country: addr.country?.name || undefined, countryCode: cc,
        organizer: e.organisation?.name,
        tags: (e.required_skills || []).map(s => s.skill_name || s.skill).filter(Boolean).slice(0, 6),
        blurb: clip(stripHtml(e.details)),
        prize,
        free: !e.isPaid && !regn.reg_amount,
        popularity: e.registerCount,
      });
    }
  }
  return [...out.values()];
}

// ---- community event sites (need a city) ------------------------------------

const LUMA_LABEL = { tech: 'Tech', ai: 'AI', crypto: 'Crypto', climate: 'Climate', arts: 'Arts & culture', wellness: 'Wellness', games: 'Games' };

async function luma(ctx) {
  const { loc } = ctx;
  const slugs = new Set(['tech', 'ai']);
  for (const t of ctx.topics) for (const s of t.luma || []) slugs.add(s);
  const feeds = [...slugs];
  // Own keywords can be about anything, so also read the general nearby feed.
  if (ctx.topics.some(t => t.custom)) feeds.push(null);
  const base = `https://api.lu.ma/discover/get-paginated-events?latitude=${loc.lat}&longitude=${loc.lon}&pagination_limit=50`;
  const pages = await gather(feeds, async slug => {
    const url = base + (slug ? `&slug=${slug}` : '');
    const first = await fetchCached(url);
    let entries = first.entries || [];
    if (first.has_more && first.next_cursor) {
      const more = await fetchCached(`${url}&pagination_cursor=${enc(first.next_cursor)}`).catch(() => null);
      if (more?.entries) entries = entries.concat(more.entries);
    }
    return { slug, entries };
  });
  const out = new Map();
  for (const { slug, entries } of pages) {
    const tag = slug ? LUMA_LABEL[slug] || slug : null;
    for (const entry of entries) {
      const ev = entry.event;
      if (!ev?.url || ev.visibility !== 'public') continue;
      const prev = out.get(ev.api_id);
      if (prev) { if (tag && !prev.tags.includes(tag)) prev.tags.push(tag); continue; }
      out.set(ev.api_id, { ...lumaEntry(entry, tag ? [tag] : []), general: true });
    }
  }
  return [...out.values()];
}

const US_STATES = { alabama: 'al', alaska: 'ak', arizona: 'az', arkansas: 'ar', california: 'ca', colorado: 'co', connecticut: 'ct', delaware: 'de', 'district of columbia': 'dc', florida: 'fl', georgia: 'ga', hawaii: 'hi', idaho: 'id', illinois: 'il', indiana: 'in', iowa: 'ia', kansas: 'ks', kentucky: 'ky', louisiana: 'la', maine: 'me', maryland: 'md', massachusetts: 'ma', michigan: 'mi', minnesota: 'mn', mississippi: 'ms', missouri: 'mo', montana: 'mt', nebraska: 'ne', nevada: 'nv', 'new hampshire': 'nh', 'new jersey': 'nj', 'new mexico': 'nm', 'new york': 'ny', 'north carolina': 'nc', 'north dakota': 'nd', ohio: 'oh', oklahoma: 'ok', oregon: 'or', pennsylvania: 'pa', 'rhode island': 'ri', 'south carolina': 'sc', 'south dakota': 'sd', tennessee: 'tn', texas: 'tx', utah: 'ut', vermont: 'vt', virginia: 'va', washington: 'wa', 'west virginia': 'wv', wisconsin: 'wi', wyoming: 'wy' };
const CA_PROVINCES = { alberta: 'ab', 'british columbia': 'bc', manitoba: 'mb', 'new brunswick': 'nb', 'newfoundland and labrador': 'nl', 'nova scotia': 'ns', ontario: 'on', 'prince edward island': 'pe', quebec: 'qc', saskatchewan: 'sk' };

function meetupLocation(loc) {
  const cc = loc.countryCode.toLowerCase();
  const table = cc === 'us' ? US_STATES : cc === 'ca' ? CA_PROVINCES : null;
  if (!table) return `${cc}--${loc.name}`;
  const state = table[String(loc.admin1 || '').toLowerCase()];
  if (!state) throw new Error('could not work out the state for this city');
  return `${cc}--${state}--${loc.name}`;
}

async function meetup(ctx) {
  const { loc } = ctx;
  const where = meetupLocation(loc);
  const searches = ctx.topics.length ? ctx.topics.slice(0, 3).map(t => t.search) : ['tech'];
  if (ctx.prefs.types.includes('hackathon')) searches.push('hackathon');
  const pages = await gather(searches, q => fetchCached(`https://www.meetup.com/find/?keywords=${enc(q)}&location=${enc(where)}&source=EVENTS`, { as: 'text' }));
  const out = new Map();
  for (const html of pages) {
    // Meetup publishes its search results as schema.org Event data in the page.
    for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      let data;
      try { data = JSON.parse(m[1]); } catch { continue; }
      for (const e of Array.isArray(data) ? data : [data]) {
        if (e?.['@type'] !== 'Event' || !e.url || !e.name) continue;
        if (out.has(e.url)) continue;
        const attendance = String(e.eventAttendanceMode || '');
        const mode = /Online/i.test(attendance) ? 'online' : /Mixed/i.test(attendance) ? 'hybrid' : 'in-person';
        const address = e.location?.address || {};
        out.set(e.url, {
          id: `meetup:${e.url}`,
          title: e.name,
          url: e.url,
          type: guessType(e.name, 'meetup'),
          start: iso(e.startDate), end: iso(e.endDate),
          mode,
          // Results come from a search around the person's city, so fall back to it.
          city: mode === 'online' ? undefined : address.addressLocality || loc.name,
          region: address.addressRegion || undefined,
          countryCode: countryCode(address.addressCountry) || (mode === 'online' ? undefined : loc.countryCode),
          place: e.location?.name || undefined,
          lat: e.location?.geo?.latitude ?? undefined, lon: e.location?.geo?.longitude ?? undefined,
          organizer: e.organizer?.name,
          // Meetup's search is loose, so the search word is not proof of a match:
          // the event's own text has to mention the interest.
          tags: [],
          blurb: clip(stripMd(e.description)),
          matchText: clip(stripMd(e.description), 700),
          general: true,
        });
      }
    }
  }
  return [...out.values()];
}

async function gdg(ctx) {
  const { loc } = ctx;
  const km = { city: 150, region: 400, country: 1500, anywhere: 1500 }[ctx.prefs.radius] || 400;
  const data = await fetchCached(`https://gdg.community.dev/api/search/?result_types=upcoming_event&proximity=${km}&latitude=${loc.lat}&longitude=${loc.lon}`);
  return (data.results || []).map(e => bevyEvent(e, 'gdg'));
}

// ---- conferences -----------------------------------------------------------

const CONF_TOPICS = { accessibility: 'Accessibility', android: 'Android', api: 'APIs', clojure: 'Clojure', cpp: 'C++', css: 'CSS', data: 'Data & AI', devops: 'DevOps', dotnet: '.NET', general: 'General tech', graphql: 'GraphQL', groovy: 'Groovy', haskell: 'Haskell', ios: 'iOS', iot: 'IoT', java: 'Java', javascript: 'JavaScript', kotlin: 'Kotlin', leadership: 'Leadership', networking: 'Networking', opensource: 'Open source', performance: 'Performance', php: 'PHP', product: 'Product management', python: 'Python', rust: 'Rust', security: 'Security', sre: 'SRE', 'tech-comm': 'Technical writing', testing: 'Testing', typescript: 'TypeScript', ux: 'UX / design' };

async function confstech(ctx) {
  const year = new Date(ctx.now).getUTCFullYear();
  const jobs = [];
  for (const y of [year, year + 1]) for (const topic of Object.keys(CONF_TOPICS)) jobs.push({ y, topic });
  let reached = 0;
  const lists = await mapLimit(jobs, 10, async job => {
    try {
      const data = await fetchCached(`https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences/${job.y}/${job.topic}.json`, { ttl: 12 * 3600e3, allow404: true });
      reached++;
      return { topic: job.topic, data: data || [] };
    } catch { return null; }
  });
  if (!reached) throw new Error('unreachable');
  const out = new Map();
  for (const list of lists) {
    if (!list) continue;
    const tag = CONF_TOPICS[list.topic];
    for (const c of list.data) {
      if (!c?.name || !c.startDate || !c.url) continue;
      const key = `${c.name}|${c.startDate}`;
      const prev = out.get(key);
      if (prev) { if (!prev.tags.includes(tag)) prev.tags.push(tag); continue; }
      out.set(key, {
        id: `confs:${key}`,
        title: c.name,
        url: c.url,
        type: 'conference',
        start: iso(c.startDate), end: iso(`${c.endDate || c.startDate}T23:59:00Z`), allDay: true,
        mode: c.online ? (c.city ? 'hybrid' : 'online') : 'in-person',
        city: c.city || undefined, country: c.country || undefined,
        tags: [tag],
      });
    }
  }
  return [...out.values()];
}

// ---- contests --------------------------------------------------------------

async function ctftime(ctx) {
  const start = Math.floor(ctx.now / 3600e3) * 3600; // whole hour keeps the URL cacheable
  const list = await fetchCached(`https://ctftime.org/api/v1/events/?limit=100&start=${start}&finish=${start + 180 * 86400}`);
  return list.map(e => ({
    id: `ctftime:${e.id}`,
    title: e.title,
    url: e.ctftime_url || e.url,
    type: 'ctf',
    start: iso(e.start), end: iso(e.finish),
    mode: e.onsite ? 'in-person' : 'online',
    ...(e.onsite ? placeParts(e.location) : {}),
    organizer: e.organizers?.[0]?.name,
    tags: ['CTF', 'Cybersecurity', e.format, e.restrictions].filter(Boolean),
    blurb: clip(stripHtml(e.description)),
    popularity: e.participants || null,
  }));
}

async function codeforces() {
  const data = await fetchCached('https://codeforces.com/api/contest.list');
  return (data.result || []).filter(c => c.phase === 'BEFORE' && c.startTimeSeconds).map(c => ({
    id: `codeforces:${c.id}`,
    title: c.name,
    url: `https://codeforces.com/contests/${c.id}`,
    type: 'contest',
    start: iso(c.startTimeSeconds * 1000), end: iso((c.startTimeSeconds + c.durationSeconds) * 1000),
    mode: 'online',
    organizer: 'Codeforces',
    tags: ['Competitive programming'],
    free: true,
  }));
}

async function codechef() {
  const data = await fetchCached('https://www.codechef.com/api/list/contests/all?sort_by=START&sorting_order=asc&offset=0&mode=all');
  return [...(data.present_contests || []), ...(data.future_contests || [])].map(c => ({
    id: `codechef:${c.contest_code}`,
    title: c.contest_name,
    url: `https://www.codechef.com/${c.contest_code}`,
    type: 'contest',
    start: iso(c.contest_start_date_iso), end: iso(c.contest_end_date_iso),
    mode: 'online',
    organizer: 'CodeChef',
    tags: ['Competitive programming'],
    free: true,
  }));
}

async function leetcode() {
  const data = await fetchCached('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: '{ topTwoContests { title titleSlug startTime duration } }' }),
  });
  return (data.data?.topTwoContests || []).map(c => ({
    id: `leetcode:${c.titleSlug}`,
    title: `LeetCode ${c.title}`,
    url: `https://leetcode.com/contest/${c.titleSlug}/`,
    type: 'contest',
    start: iso(c.startTime * 1000), end: iso((c.startTime + c.duration) * 1000),
    mode: 'online',
    organizer: 'LeetCode',
    tags: ['Competitive programming', 'Interview prep'],
    free: true,
  }));
}

// ---- registry --------------------------------------------------------------
// Order matters when the same event is on two sites: the earlier one is kept.

// `category` groups the source in the page's "sources checked" panel.

export const SOURCES = [
  { id: 'devfolio', label: 'Devfolio', home: 'https://devfolio.co/hackathons', types: ['hackathon'], category: 'Hackathons', run: devfolio },
  { id: 'devpost', label: 'Devpost', home: 'https://devpost.com/hackathons', types: ['hackathon'], category: 'Hackathons', run: devpost },
  { id: 'mlh', label: 'MLH', home: 'https://mlh.io/events', types: ['hackathon'], category: 'Hackathons', run: mlh },
  { id: 'unstop', label: 'Unstop', home: 'https://unstop.com', types: ['hackathon', 'competition', 'workshop', 'conference', 'ctf'], homeCountry: 'IN', category: 'India', run: unstop },
  { id: 'hackerearth', label: 'HackerEarth', home: 'https://www.hackerearth.com/challenges/', types: ['hackathon', 'contest'], category: 'Hackathons', run: hackerearth },
  { id: 'hackclub', label: 'Hack Club', home: 'https://hackathons.hackclub.com', types: ['hackathon'], category: 'Hackathons', run: hackclub },
  { id: 'luma', label: 'Luma', home: 'https://lu.ma/discover', types: ['meetup', 'hackathon', 'workshop', 'conference', 'competition'], needsCity: true, category: 'Meetups & communities', run: luma },
  { id: 'meetup', label: 'Meetup', home: 'https://www.meetup.com/find/', types: ['meetup', 'hackathon', 'workshop', 'conference', 'competition'], needsCity: true, category: 'Meetups & communities', run: meetup },
  { id: 'gdg', label: 'Google Developer Groups', home: 'https://gdg.community.dev/events/', types: ['meetup', 'hackathon', 'workshop', 'conference'], needsCity: true, category: 'Meetups & communities', run: gdg },
  { id: 'confstech', label: 'confs.tech', home: 'https://confs.tech', types: ['conference'], category: 'Conferences', run: confstech },
  { id: 'ctftime', label: 'CTFtime', home: 'https://ctftime.org/event/list/upcoming', types: ['ctf'], category: 'Security', run: ctftime },
  { id: 'codeforces', label: 'Codeforces', home: 'https://codeforces.com/contests', types: ['contest'], category: 'Coding contests', run: codeforces },
  { id: 'codechef', label: 'CodeChef', home: 'https://www.codechef.com/contests', types: ['contest'], category: 'Coding contests', run: codechef },
  { id: 'leetcode', label: 'LeetCode', home: 'https://leetcode.com/contest/', types: ['contest'], category: 'Coding contests', run: leetcode },
  ...BEVY_SOURCES,
  ...CONTEST_SOURCES,
  ...CHALLENGE_SOURCES,
  ...CONFERENCE_SOURCES,
  ...COMMUNITY_SOURCES,
  ...INDIA_SOURCES,
  ...LUMA_CALENDAR_SOURCES,
];
