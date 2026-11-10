// Coding contest sites and CTF platforms beyond Codeforces, CodeChef and LeetCode.

import { fetchCached, gather } from '../net.js';
import { stripHtml, clip, iso, guessType, zonedIso } from './util.js';

const CP = ['Competitive programming'];

async function hackerrank() {
  const data = await fetchCached('https://www.hackerrank.com/rest/contests/upcoming?offset=0&limit=50');
  return (data.models || []).filter(c => c.slug && !c.ended).map(c => ({
    id: `hackerrank:${c.id}`,
    title: c.name,
    url: `https://www.hackerrank.com/contests/${c.slug}`,
    type: 'contest',
    start: iso(c.get_starttimeiso), end: iso(c.get_endtimeiso),
    mode: 'online',
    organizer: 'HackerRank',
    tags: [...CP, ...(c.rated ? ['Rated'] : [])],
    blurb: clip(stripHtml(c.description)),
    free: true,
  }));
}

async function codingame(ctx) {
  const list = await fetchCached('https://www.codingame.com/services/Challenge/findAllChallenges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' });
  return (list || []).filter(c => c.publicId && c.date > ctx.now - 86400e3).map(c => ({
    id: `codingame:${c.publicId}`,
    title: c.title,
    url: `https://www.codingame.com/contests/${c.publicId}`,
    type: 'contest',
    start: iso(c.date),
    mode: 'online',
    organizer: 'CodinGame',
    tags: [...CP, 'Bot programming'],
    free: true,
  }));
}

async function code360() {
  const pages = await gather([1, 2], p => fetchCached(`https://www.naukri.com/code360/api/v3/public_section/contest_list?page=${p}`));
  const out = new Map();
  for (const page of pages) {
    for (const e of page.data?.events || []) {
      if (!e.slug || out.has(e.id)) continue;
      out.set(e.id, {
        id: `code360:${e.id}`,
        title: e.name,
        url: `https://www.naukri.com/code360/contests/${e.slug}`,
        type: 'contest',
        start: iso(e.event_start_time * 1000), end: iso(e.event_end_time * 1000),
        deadline: iso(e.registration_end_time * 1000),
        mode: 'online',
        organizer: 'Coding Ninjas',
        tags: [...CP, e.contest_type].filter(Boolean),
        blurb: clip(stripHtml(e.short_desc)),
        free: !Number(e.fees),
      });
    }
  }
  return [...out.values()];
}

async function dmoj(ctx) {
  const data = await fetchCached('https://dmoj.ca/api/v2/contests');
  return (data.data?.objects || []).filter(c => Date.parse(c.end_time) > ctx.now).map(c => ({
    id: `dmoj:${c.key}`,
    title: c.name,
    url: `https://dmoj.ca/contest/${c.key}`,
    type: 'contest',
    start: iso(c.start_time), end: iso(c.end_time),
    mode: 'online',
    organizer: 'DMOJ',
    tags: [...CP, ...(c.is_rated ? ['Rated'] : []), ...(c.tags || []).slice(0, 3)],
    free: true,
  }));
}

async function atcoder() {
  const html = await fetchCached('https://atcoder.jp/contests/?lang=en', { as: 'text' });
  const section = html.split('id="contest-table-upcoming"')[1]?.split('</table>')[0] || '';
  const out = [];
  for (const row of section.split('<tr>').slice(1)) {
    const time = row.match(/<time[^>]*>([^<]+)<\/time>/)?.[1];
    const link = row.match(/<a href="(\/contests\/[^"]+)">([^<]+)<\/a>/);
    const duration = row.match(/<td class="text-center">(\d+):(\d+)<\/td>/);
    if (!time || !link) continue;
    const start = iso(time.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    const minutes = duration ? Number(duration[1]) * 60 + Number(duration[2]) : 0;
    const rated = row.match(/<td class="text-center">\s*([^<]*?)\s*<\/td>\s*<\/tr>/)?.[1]?.trim();
    out.push({
      id: `atcoder:${link[1]}`,
      title: link[2].trim(),
      url: `https://atcoder.jp${link[1]}`,
      type: 'contest',
      start, end: start && minutes ? iso(Date.parse(start) + minutes * 60e3) : null,
      mode: 'online',
      organizer: 'AtCoder',
      tags: [...CP, ...(rated && rated !== '-' ? [`Rated ${rated}`] : [])],
      free: true,
    });
  }
  return out;
}

async function kattis() {
  const html = await fetchCached('https://open.kattis.com/contests', { as: 'text' });
  const section = html.split('id="table-contests-upcoming"')[1]?.split('</table>')[0] || '';
  const out = [];
  for (const row of section.split('<tr>').slice(1)) {
    const link = row.match(/<a href="(\/contests\/[^"]+)">([^<]+)<\/a>/);
    const start = row.match(/data-col="start">\s*([^<]+?)\s*<\/td>/)?.[1];
    const end = row.match(/data-col="end">\s*([^<]+?)\s*<\/td>/)?.[1];
    if (!link || !start) continue;
    out.push({
      id: `kattis:${link[1]}`,
      title: link[2].trim(),
      url: `https://open.kattis.com${link[1]}`,
      type: 'contest',
      start: zonedIso(start), end: zonedIso(end),
      mode: 'online',
      organizer: 'Kattis',
      tags: CP,
      free: true,
    });
  }
  return out;
}

async function eolymp(ctx) {
  const html = await fetchCached('https://www.eolymp.com/en/contests', { as: 'text' });
  const out = new Map();
  for (const m of html.matchAll(/<time datetime="([^"]+)">[\s\S]{0,600}?href="(\/contests\/[^"]+)">([^<]+)<\/a>/gi)) {
    const start = iso(m[1]);
    if (!start || Date.parse(start) < ctx.now - 86400e3 || out.has(m[2])) continue;
    out.set(m[2], {
      id: `eolymp:${m[2]}`,
      title: m[3].trim(),
      url: `https://www.eolymp.com/en${m[2]}`,
      type: 'contest',
      start,
      mode: 'online',
      organizer: 'Eolymp',
      tags: CP,
      free: true,
    });
  }
  return [...out.values()];
}

async function toph(ctx) {
  const html = await fetchCached('https://toph.co/contests', { as: 'text' });
  const out = [];
  for (const m of html.matchAll(/<a class=cdeck__name href=([^>\s]+)>([^<]+)<\/a>[\s\S]*?#hourglass(\w+)[\s\S]*?data-timestamp=(\d+)/g)) {
    const when = Number(m[4]) * 1000;
    if (m[3] === 'end' || when < ctx.now) continue;
    const path = m[1].replace(/^"|"$/g, '');
    out.push({
      id: `toph:${path}`,
      title: m[2].trim(),
      url: `https://toph.co${path}`,
      type: 'contest',
      start: iso(when),
      mode: 'online',
      organizer: 'Toph',
      tags: CP,
      free: true,
    });
  }
  return out;
}

async function hackthebox(ctx) {
  const list = await fetchCached('https://ctf.hackthebox.com/api/public/ctfs');
  return (list || []).filter(c => c.status !== 'Ended' && Date.parse(c.ends_at) > ctx.now && !c.private).map(c => ({
    id: `htb:${c.id}`,
    title: c.name,
    url: `https://ctf.hackthebox.com/event/${c.id}`,
    type: 'ctf',
    start: iso(c.starts_at), end: iso(c.ends_at),
    mode: 'online',
    organizer: c.isHtbOrganizer ? 'Hack The Box' : 'Community on Hack The Box',
    tags: ['CTF', 'Cybersecurity', c.format, c.isUni ? 'University teams' : null].filter(Boolean),
    popularity: c.players || null,
  }));
}

const src = (id, label, home, run, extra = {}) => ({ id, label, home, types: ['contest'], category: 'Coding contests', run, ...extra });

export const CONTEST_SOURCES = [
  src('hackerrank', 'HackerRank', 'https://www.hackerrank.com/contests', hackerrank),
  src('codingame', 'CodinGame', 'https://www.codingame.com/contests', codingame),
  src('code360', 'Code360 (Coding Ninjas)', 'https://www.naukri.com/code360/contests', code360),
  src('dmoj', 'DMOJ', 'https://dmoj.ca/contests/', dmoj),
  src('atcoder', 'AtCoder', 'https://atcoder.jp/contests/', atcoder),
  src('kattis', 'Kattis', 'https://open.kattis.com/contests', kattis),
  src('eolymp', 'Eolymp', 'https://www.eolymp.com/en/contests', eolymp),
  src('toph', 'Toph', 'https://toph.co/contests', toph),
  src('hackthebox', 'Hack The Box CTF', 'https://ctf.hackthebox.com/', hackthebox, { types: ['ctf'], category: 'Security' }),
];
