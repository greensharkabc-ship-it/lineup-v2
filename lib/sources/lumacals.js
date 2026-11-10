// Public event calendars that companies and communities keep on Luma. Each one
// is listed as its own source, because each is a different organisation's
// official calendar; they share the adapter below.

import { fetchCached } from '../net.js';
import { enc, lumaEntry } from './util.js';

const CALENDARS = [
  // AI and machine learning
  { slug: 'langchain', label: 'LangChain', tags: ['AI', 'LLM apps'] },
  { slug: 'wandb', label: 'Weights & Biases', tags: ['AI', 'Machine learning'] },
  { slug: 'pinecone', label: 'Pinecone', tags: ['AI', 'Vector search'] },
  { slug: 'llamaindex', label: 'LlamaIndex', tags: ['AI', 'LLM apps'] },
  { slug: 'deeplearningai', label: 'DeepLearning.AI', tags: ['AI', 'Machine learning'] },
  { slug: 'ollama', label: 'Ollama', tags: ['AI', 'Open source'] },
  { slug: 'aitinkerers', label: 'AI Tinkerers', tags: ['AI'] },
  { slug: 'cerebral-valley', label: 'Cerebral Valley', tags: ['AI', 'Startups'] },
  { slug: 'roboflow', label: 'Roboflow', tags: ['AI', 'Computer vision'] },
  { slug: 'cerebras', label: 'Cerebras', tags: ['AI', 'Hardware'] },
  { slug: 'deepgram', label: 'Deepgram', tags: ['AI', 'Speech'] },
  { slug: 'assemblyai', label: 'AssemblyAI', tags: ['AI', 'Speech'] },
  { slug: 'langfuse', label: 'Langfuse', tags: ['AI', 'LLM apps'] },
  { slug: 'baseten', label: 'Baseten', tags: ['AI', 'MLOps'] },
  { slug: 'nvidia-events', label: 'NVIDIA', tags: ['AI', 'GPU'] },
  { slug: 'anyscale', label: 'Anyscale', tags: ['AI', 'Ray'] },
  { slug: 'mlflow', label: 'MLflow community', tags: ['AI', 'MLOps', 'Open source'] },
  { slug: 'runway', label: 'Runway', tags: ['AI', 'Creative'] },
  // Developer tools and cloud
  { slug: 'vercel-events', label: 'Vercel', tags: ['Web', 'Frontend'] },
  { slug: 'cloudflare', label: 'Cloudflare', tags: ['Cloud', 'Web'] },
  { slug: 'prisma', label: 'Prisma', tags: ['Web', 'Databases'] },
  { slug: 'neo4j', label: 'Neo4j', tags: ['Databases', 'Graph'] },
  { slug: 'motherduck', label: 'MotherDuck', tags: ['Data', 'DuckDB'] },
  { slug: 'posthog', label: 'PostHog', tags: ['Product', 'Analytics', 'Open source'] },
  { slug: 'convex', label: 'Convex', tags: ['Web', 'Backend'] },
  { slug: 'clerk', label: 'Clerk', tags: ['Web', 'Auth'] },
  { slug: 'digitalocean', label: 'DigitalOcean community', tags: ['Cloud'] },
  { slug: 'planetscale', label: 'PlanetScale', tags: ['Databases'] },
  { slug: 'twilio', label: 'Twilio', tags: ['APIs'] },
  { slug: 'linear', label: 'Linear', tags: ['Product'] },
  { slug: 'notion-events', label: 'Notion', tags: ['Product'] },
  { slug: 'amplitude', label: 'Amplitude community', tags: ['Product', 'Analytics'] },
  { slug: 'devpost', label: 'Devpost events', tags: ['Hackathon'] },
  { slug: 'producthunt', label: 'Product Hunt', tags: ['Startups', 'Product'] },
  // Web3
  { slug: 'ethglobal', label: 'ETHGlobal', tags: ['Web3', 'Ethereum', 'Hackathon'] },
  { slug: 'ethdenver', label: 'ETHDenver side events', tags: ['Web3', 'Ethereum'] },
  { slug: 'chainlink', label: 'Chainlink', tags: ['Web3'] },
  { slug: 'gitcoin', label: 'Gitcoin', tags: ['Web3', 'Open source'] },
  { slug: 'solana', label: 'Solana', tags: ['Web3', 'Solana'] },
  { slug: 'polkadot', label: 'Polkadot', tags: ['Web3'] },
];

async function calendarId(slug) {
  const data = await fetchCached(`https://api.lu.ma/url?url=${enc(slug)}`, { ttl: 24 * 3600e3 });
  const id = data?.kind === 'calendar' ? data.data?.calendar?.api_id : null;
  if (!id) throw new Error('calendar moved');
  return id;
}

function make({ slug, label, tags }) {
  return {
    id: `luma-${slug}`,
    label,
    home: `https://lu.ma/${slug}`,
    types: ['meetup', 'hackathon', 'workshop', 'conference', 'competition'],
    category: 'Company & community calendars',
    async run() {
      const id = await calendarId(slug);
      const url = `https://api.lu.ma/calendar/get-items?calendar_api_id=${id}&period=future&pagination_limit=50`;
      const first = await fetchCached(url);
      let entries = first.entries || [];
      if (first.has_more && first.next_cursor) {
        const more = await fetchCached(`${url}&pagination_cursor=${enc(first.next_cursor)}`).catch(() => null);
        if (more?.entries) entries = entries.concat(more.entries);
      }
      // A calendar can also list other people's events; only its own carry its name.
      return entries.filter(e => e.event?.url && e.event.visibility !== 'private').map(e => lumaEntry(e, tags, e.event.calendar_api_id === id ? label : undefined));
    },
  };
}

export const LUMA_CALENDAR_SOURCES = CALENDARS.map(make);
