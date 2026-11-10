// Data science and AI competition platforms, plus web3 bounties.

import { fetchCached, gather } from '../net.js';
import { stripHtml, clip, iso, decode } from './util.js';

async function evalai(ctx) {
  const pages = await gather(['present', 'future'], when => fetchCached(`https://eval.ai/api/challenges/challenge/${when}/approved/public`));
  const out = new Map();
  for (const page of pages) {
    for (const c of page.results || []) {
      if (out.has(c.id) || (c.end_date && Date.parse(c.end_date) < ctx.now)) continue;
      out.set(c.id, {
        id: `evalai:${c.id}`,
        title: c.title,
        url: `https://eval.ai/web/challenges/challenge-page/${c.id}/overview`,
        type: 'competition',
        start: iso(c.start_date), end: iso(c.end_date), deadline: iso(c.end_date),
        mode: 'online',
        organizer: c.creator?.team_name,
        tags: ['AI', 'Machine learning', 'Research'],
        blurb: clip(c.short_description || stripHtml(c.description)),
        free: true,
      });
    }
  }
  return [...out.values()];
}

async function drivendata() {
  const html = await fetchCached('https://www.drivendata.org/competitions/', { as: 'text' });
  const out = new Map();
  for (const block of html.split('panel-container').slice(1)) {
    const head = block.slice(0, 3000);
    if (!/data-status_active="1"/.test(head)) continue;
    const link = head.match(/href="(\/competitions\/\d+\/[^"]+)"[^>]*title="([^"]+)"/);
    if (!link || out.has(link[1])) continue;
    const deadline = head.match(/data-deadline="[^"]*?(\d{8})"/)?.[1];
    const purse = Number(head.match(/data-total_prize_purse="([\d.]+)"/)?.[1] || 0);
    const joined = Number(head.match(/data-joined="(\d+)"/)?.[1] || 0);
    const categories = [...head.matchAll(/data-category_(\w+)="1"/g)].map(m => m[1].replace(/_/g, ' '));
    out.set(link[1], {
      id: `drivendata:${link[1]}`,
      title: decode(link[2]),
      url: `https://www.drivendata.org${link[1]}`,
      type: 'competition',
      deadline: deadline ? iso(`${deadline.slice(0, 4)}-${deadline.slice(4, 6)}-${deadline.slice(6, 8)}T23:59:00Z`) : null,
      allDay: true,
      mode: 'online',
      organizer: 'DrivenData',
      tags: ['Data science', 'Social impact', ...categories.slice(0, 3)],
      prize: purse > 0 ? `$${purse.toLocaleString('en-US')} in prizes` : null,
      popularity: joined || null,
      free: true,
    });
  }
  return [...out.values()];
}

async function superteam(ctx) {
  const list = await fetchCached('https://earn.superteam.fun/api/listings?type=hackathon');
  return (list || []).filter(l => l.slug && l.status === 'OPEN' && (!l.deadline || Date.parse(l.deadline) > ctx.now)).map(l => ({
    id: `superteam:${l.id}`,
    title: l.title,
    url: `https://earn.superteam.fun/listings/${l.type || 'bounty'}/${l.slug}/`,
    type: l.type === 'hackathon' ? 'hackathon' : 'competition',
    deadline: iso(l.deadline),
    mode: 'online',
    organizer: l.sponsor?.name,
    tags: ['Web3', 'Solana', l.type === 'bounty' ? 'Bounty' : null].filter(Boolean),
    prize: l.rewardAmount ? `${l.rewardAmount.toLocaleString('en-US')} ${l.token || ''}`.trim() : null,
    popularity: l._count?.Submission || null,
    free: true,
  }));
}

const src = (id, label, home, run, types = ['competition']) => ({ id, label, home, types, category: 'Challenges & competitions', run });

export const CHALLENGE_SOURCES = [
  src('evalai', 'EvalAI', 'https://eval.ai/web/challenges/list', evalai),
  src('drivendata', 'DrivenData', 'https://www.drivendata.org/competitions/', drivendata),
  src('superteam', 'Superteam Earn', 'https://earn.superteam.fun/', superteam, ['competition', 'hackathon']),
];
