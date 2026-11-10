# Lineup

Type your city and what you're into; get one ranked list of hackathons, meetups,
workshops, conferences, coding contests and CTFs pulled live from 84 sources.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. Nothing to install.

- **Windows:** double-click `start.bat`. It starts the server and opens the page.
- **Anywhere:** run `node server.js`, then open <http://localhost:4321>.

Leave that window open while you use the site. Close it (or press Ctrl+C) to stop.
Set `PORT=5000` before starting if 4321 is taken.

## What it searches

84 sources, grouped the same way as the "sources" panel on the page:

| Group | Sources |
| --- | --- |
| Hackathons | Devfolio, Devpost, MLH, HackerEarth, Hack Club |
| Coding contests | Codeforces, CodeChef, LeetCode, HackerRank, CodinGame, Code360 (Coding Ninjas), DMOJ, AtCoder, Kattis, Eolymp, Toph |
| Security | CTFtime, Hack The Box CTF, infosec-conferences.com |
| Challenges & competitions | EvalAI, DrivenData, Superteam Earn |
| Meetups & communities | Luma (near you), Meetup (near you), Google Developer Groups, CNCF community, Atlassian Community Events, Friends of Figma, Salesforce Trailblazer groups, Startup Grind, Snowflake user groups, python.org events, OpenStreetMap calendar, IxDA |
| Conferences | confs.tech, Techmeme events, dev.events, KDnuggets meetings, WikiCFP, Product School |
| India | Unstop, FOSS United, GeeksforGeeks events, KnowAFest |
| Company & community calendars (on Luma) | LangChain, Weights & Biases, Pinecone, LlamaIndex, DeepLearning.AI, Ollama, AI Tinkerers, Cerebral Valley, Roboflow, Cerebras, Deepgram, AssemblyAI, Langfuse, Baseten, NVIDIA, Anyscale, MLflow, Runway, Vercel, Cloudflare, Prisma, Neo4j, MotherDuck, PostHog, Convex, Clerk, DigitalOcean, PlanetScale, Twilio, Linear, Notion, Amplitude, Devpost events, Product Hunt, ETHGlobal, ETHDenver, Chainlink, Gitcoin, Solana, Polkadot |

Sources marked "near you" need a city; Indian sources are skipped when your city
is outside India. A calendar with nothing coming up shows a 0, which is normal.

Google, Eventbrite and LinkedIn don't let programs read their listings, so the
page ends with links that open your search on each of them instead. Sites that
were tried and dropped because they block automated reads or publish no usable
dates: Eventbrite, 10times, AllEvents, Kaggle, DoraHacks, Topcoder, IEEE vTools,
Zindi, Grand Challenge, AIcrowd, Reskilll, Linux Foundation events.

## How the ranking works

Every event gets up to 100 points (`lib/rank.js`):

- **Interests, up to 46.** A match in the title counts more than one in the tags
  or description; matching several interests adds a little.
- **Place, up to 25.** In your city beats a few hours away beats elsewhere in
  your country. Online events sit in the middle. In-person events farther than
  the distance you chose are left out.
- **Timing, up to 15.** Sooner ranks higher.
- **Extras, up to 14.** Sign-ups, prizes, free entry, and beginner-friendliness
  if you ticked that box.

Events whose registration has closed, or that fall outside your time window, are
dropped. The same event on two sites is shown once with both links. Events from
Luma and Meetup must mention one of your interests to appear at all, because
those sites list everything from yoga to book clubs.

## Files

```
server.js                   the web server and the search endpoint
lib/sources.js              the first 14 adapters and the list of all sources
lib/sources/util.js         helpers shared by adapters (dates, HTML, JSON-LD, RSS)
lib/sources/bevy.js         communities on Bevy (CNCF, Figma, Atlassian, ...)
lib/sources/lumacals.js     company and community calendars on Luma
lib/sources/contests.js     coding contest sites and Hack The Box
lib/sources/challenges.js   data-science challenges and web3 bounties
lib/sources/conferences.js  conference listings
lib/sources/communities.js  python.org, OpenStreetMap, IxDA
lib/sources/india.js        India-focused sites
lib/rank.js                 filtering, de-duplication and scoring
lib/topics.js               the interests and the words that count as a match
lib/geo.js                  city lookup and distances
lib/net.js                  fetching with a timeout and a 15-minute cache
public/                     the page (index.html, styles.css, app.js)
```

To add a site, write a function that returns events in the shape described at
the top of `lib/sources.js`, give it a `category`, and add it to one of the
lists in `lib/sources/`. To add a Luma calendar, add its slug to
`lib/sources/lumacals.js`; to add a Bevy community, add its host to
`lib/sources/bevy.js`.

## Good to know

- Your preferences and saved events stay in your browser. The server keeps
  nothing except a small file of city coordinates in `.cache/`.
- The first search takes 20 to 30 seconds while all 84 sources answer and
  distances are worked out; after that, searches take a few seconds, because
  answers are cached for 15 minutes.
- These sites don't offer official search APIs, so Lineup reads the same public
  listings their own pages use. If a site changes its layout, that one source
  shows "no answer" and the rest keep working. Results are cached for 15 minutes
  to keep the load on those sites light; please keep it to personal use.
- Dates and details come from the listings. Check the organiser's page before
  you plan around an event.
