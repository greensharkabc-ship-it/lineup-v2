// Community sites built on Bevy share one search API (the same one Google
// Developer Groups uses). Each entry here is one community.

import { fetchCached, gather } from '../net.js';
import { bevyEvent } from './util.js';

const COMMUNITIES = [
  { id: 'cncf', label: 'CNCF community', host: 'community.cncf.io', tags: ['Cloud native', 'Kubernetes'] },
  { id: 'atlassian', label: 'Atlassian Community Events', host: 'ace.atlassian.com', tags: ['Atlassian'] },
  { id: 'figma', label: 'Friends of Figma', host: 'friends.figma.com', tags: ['Design', 'Figma'] },
  { id: 'trailblazer', label: 'Salesforce Trailblazer groups', host: 'trailblazercommunitygroups.com', tags: ['Salesforce'] },
  { id: 'startupgrind', label: 'Startup Grind', host: 'www.startupgrind.com', tags: ['Startups'] },
  { id: 'snowflake', label: 'Snowflake user groups', host: 'usergroups.snowflake.com', tags: ['Data', 'Snowflake'] },
];

function make({ id, label, host, tags }) {
  return {
    id,
    label,
    home: `https://${host}/events/`,
    types: ['meetup', 'hackathon', 'workshop', 'conference', 'competition'],
    category: 'Meetups & communities',
    async run(ctx) {
      const { loc } = ctx;
      const urls = [`https://${host}/api/search/?result_types=upcoming_event&country_code=Earth`];
      if (loc) {
        const km = { city: 150, region: 400, country: 1500, anywhere: 1500 }[ctx.prefs.radius] || 400;
        urls.push(`https://${host}/api/search/?result_types=upcoming_event&proximity=${km}&latitude=${loc.lat}&longitude=${loc.lon}`);
      }
      const pages = await gather(urls, u => fetchCached(u));
      const out = new Map();
      for (const page of pages) for (const e of page.results || []) if (!out.has(e.id)) out.set(e.id, bevyEvent(e, id, tags));
      return [...out.values()];
    },
  };
}

export const BEVY_SOURCES = COMMUNITIES.map(make);
