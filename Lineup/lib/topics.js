// Interests the page offers, with the words that count as a match.
// `search` is the single term sent to sites that take a search box query;
// `luma` lists Luma discover categories worth pulling for that interest.
// The ids here must match the checkbox values in public/index.html.

export const TOPICS = [
  { id: 'ai', label: 'AI / ML', search: 'AI', luma: ['ai'],
    kw: ['ai', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'llms', 'genai', 'gen ai', 'generative', 'gpt', 'chatgpt', 'deep learning', 'agent', 'agents', 'agentic', 'nlp', 'computer vision', 'neural', 'rag', 'mlops', 'claude', 'gemini', 'openai', 'voice agents', 'data & ai'] },
  { id: 'web', label: 'Web dev', search: 'web development', luma: ['tech'],
    kw: ['web', 'web dev', 'web development', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'full-stack', 'fullstack', 'javascript', 'typescript', 'react', 'next.js', 'nextjs', 'node.js', 'nodejs', 'css', 'html', 'vue', 'angular', 'svelte', 'php', 'django', 'graphql', 'api', 'apis', 'supabase', 'browser'] },
  { id: 'mobile', label: 'Mobile apps', search: 'mobile app', luma: ['tech'],
    kw: ['mobile', 'android', 'ios', 'flutter', 'react native', 'kotlin', 'swift', 'swiftui', 'app development', 'jetpack compose'] },
  { id: 'web3', label: 'Web3', search: 'blockchain', luma: ['crypto'],
    kw: ['web3', 'blockchain', 'crypto', 'ethereum', 'solana', 'defi', 'nft', 'smart contract', 'smart contracts', 'bitcoin', 'dao', 'onchain', 'on-chain', 'zk', 'polygon', 'stablecoin'] },
  { id: 'security', label: 'Cybersecurity', search: 'security', luma: ['tech'],
    kw: ['security', 'cybersecurity', 'cyber security', 'cyber', 'ctf', 'capture the flag', 'infosec', 'hacking', 'ethical hacking', 'pentest', 'pentesting', 'osint', 'forensics', 'malware', 'bug bounty', 'appsec', 'red team'] },
  { id: 'data', label: 'Data science', search: 'data science', luma: ['ai'],
    kw: ['data', 'data science', 'analytics', 'kaggle', 'sql', 'big data', 'visualization', 'statistics', 'data engineering', 'dataset', 'datathon', 'python', 'power bi', 'tableau'] },
  { id: 'cp', label: 'Competitive programming', search: 'coding', luma: [],
    kw: ['competitive programming', 'dsa', 'algorithm', 'algorithms', 'coding contest', 'coding challenge', 'coding competition', 'codeforces', 'leetcode', 'codechef', 'icpc', 'data structures', 'problem solving', 'interview prep'] },
  { id: 'cloud', label: 'Cloud & DevOps', search: 'cloud', luma: ['tech'],
    kw: ['cloud', 'devops', 'aws', 'azure', 'gcp', 'google cloud', 'kubernetes', 'docker', 'serverless', 'sre', 'infrastructure', 'platform engineering', 'terraform', 'ci/cd', 'observability'] },
  { id: 'design', label: 'Design', search: 'design', luma: ['arts'],
    kw: ['design', 'ui', 'ux', 'ui/ux', 'figma', 'product design', 'user experience', 'accessibility', 'designathon', 'typography', 'ux / design'] },
  { id: 'gamedev', label: 'Game dev', search: 'game', luma: ['games'],
    kw: ['game', 'games', 'gamedev', 'game dev', 'game jam', 'unity', 'unreal', 'godot', 'gaming', 'esports'] },
  { id: 'hardware', label: 'Hardware & robotics', search: 'robotics', luma: ['tech'],
    kw: ['hardware', 'iot', 'robotics', 'robot', 'robots', 'embedded', 'arduino', 'raspberry pi', 'electronics', 'drone', 'drones', 'fpga', '3d printing', 'semiconductor', 'vlsi'] },
  { id: 'opensource', label: 'Open source', search: 'open source', luma: ['tech'],
    kw: ['open source', 'open-source', 'opensource', 'oss', 'foss', 'linux', 'github', 'git', 'hacktoberfest', 'contributor', 'contributors'] },
  { id: 'startup', label: 'Startups', search: 'startup', luma: ['tech'],
    kw: ['startup', 'startups', 'entrepreneur', 'entrepreneurs', 'entrepreneurship', 'founder', 'founders', 'pitch', 'venture', 'investor', 'investors', 'fundraise', 'fundraising', 'business plan', 'b-plan', 'case study', 'case competition', 'product management', 'ideathon', 'd2c', 'saas'] },
  { id: 'fintech', label: 'Fintech', search: 'fintech', luma: ['tech'],
    kw: ['fintech', 'finance', 'payments', 'trading', 'banking', 'quant', 'upi', 'insurtech', 'paypal', 'stock market'] },
  { id: 'health', label: 'Health & bio', search: 'health', luma: ['wellness'],
    kw: ['health', 'healthcare', 'healthtech', 'health tech', 'biotech', 'medical', 'medtech', 'bio', 'biology', 'genomics', 'digital health'] },
  { id: 'climate', label: 'Climate', search: 'climate', luma: ['climate'],
    kw: ['climate', 'sustainability', 'sustainable', 'energy', 'environment', 'cleantech', 'clean energy', 'agritech', 'net zero', 'green tech'] },
];

const LETTER = '[\\p{L}\\p{N}]';
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive matcher ("ai" must not hit "Mumbai"). */
export function compile(words) {
  const alt = [...words].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return new RegExp(`(?<!${LETTER})(?:${alt})(?!${LETTER})`, 'giu');
}

/** Checked interests plus the person's own keywords, ready for matching. */
export function resolveTopics(ids = [], keywords = '') {
  const out = TOPICS.filter(t => ids.includes(t.id)).map(t => ({ ...t, re: compile(t.kw) }));
  const seen = new Set();
  for (const raw of String(keywords).split(/[,;\n]/)) {
    const word = raw.trim();
    const key = word.toLowerCase();
    if (word.length < 2 || word.length > 40 || seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `kw:${key}`, label: word, search: word, luma: [], kw: [word], re: compile([word]), custom: true });
    if (seen.size >= 8) break;
  }
  return out;
}
