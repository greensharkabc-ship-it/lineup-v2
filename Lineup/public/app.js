'use strict';

// Lineup's page: reads the preferences form, asks the local server to search,
// and draws the answers as tickets. Everything that comes from an event site is
// escaped before it touches the page.

const DAY = 86400e3;
const PAGE = 40;
const TYPE = {
  hackathon: ['Hackathon', 'Hackathons'],
  meetup: ['Meetup', 'Meetups & talks'],
  workshop: ['Workshop', 'Workshops'],
  conference: ['Conference', 'Conferences'],
  contest: ['Coding contest', 'Coding contests'],
  ctf: ['CTF', 'CTFs'],
  competition: ['Competition', 'Competitions'],
};
const WINDOW = { 14: 'the next 2 weeks', 30: 'the next month', 90: 'the next 3 months', 180: 'the next 6 months' };

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const safeUrl = u => {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '#'; } catch { return '#'; }
};
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window: carry on without it */ } },
  drop(key) { try { localStorage.removeItem(key); } catch { /* same */ } },
};

const els = {
  form: $('#prefs'), city: $('#city'), options: $('#city-options'), keywords: $('#keywords'),
  freeOnly: $('#free-only'), beginner: $('#beginner'), reset: $('#reset'),
  summary: $('#summary'), sub: $('#summary-sub'), sort: $('#sort'), sources: $('#sources'), sourcesSummary: $('#sources-summary'), sourceGroups: $('#source-groups'), brandLine: $('#brand-line'), notice: $('#notice'),
  filter: $('#type-filter'), list: $('#list'), more: $('#more'),
  elsewhere: $('#elsewhere'), links: $('#elsewhere-links'),
  savedToggle: $('#saved-toggle'), savedCount: $('#saved-count'), results: $('#results'),
};

const state = {
  loc: null, locLabel: '', locMiss: '',
  prefs: null, loading: false, error: '', stage: '',
  sources: [], events: [], found: 0, picked: 0, topics: [], resultLoc: null,
  sort: 'best', typeFilter: null, shown: PAGE, view: 'results',
};
let saved = store.get('lineup.saved', {});

// ---- dates ---------------------------------------------------------------

const fmt = (opts, date) => new Intl.DateTimeFormat(undefined, opts).format(date);
const zone = allDay => (allDay ? { timeZone: 'UTC' } : {});
const shortDate = (iso, allDay) => fmt({ day: 'numeric', month: 'short', ...zone(allDay) }, new Date(iso));

/** Whole calendar days from today to the given moment. */
function dayDiff(iso, allDay) {
  const d = new Date(iso);
  const n = new Date();
  const that = allDay ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = allDay ? Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) : new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((that - today) / DAY);
}
const inDays = n => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function whenLine(e) {
  if (e.whenKind === 'closes') return 'Open now';
  if (e.whenKind === 'ends') return 'On now';
  if (e.allDay) {
    const a = shortDate(e.start, true);
    const b = e.end ? shortDate(e.end, true) : a;
    return a === b ? a : `${a} – ${b}`;
  }
  const s = new Date(e.start);
  return `${fmt({ weekday: 'short', day: 'numeric', month: 'short' }, s)}, ${fmt({ hour: 'numeric', minute: '2-digit' }, s)}`;
}

function calendarUrl(e) {
  const stamp = d => new Date(d).toISOString().replace(/[-:]|\.\d{3}/g, '');
  const ymd = d => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
  let dates, title = e.title;
  if (e.whenKind === 'starts') {
    if (e.allDay) dates = `${ymd(e.start)}/${ymd(Date.parse(e.end || e.start) + DAY)}`;
    else dates = `${stamp(e.start)}/${stamp(e.end && Date.parse(e.end) > Date.parse(e.start) ? e.end : Date.parse(e.start) + 3600e3)}`;
  } else {
    // Nothing to attend at a set hour: put the closing time in the calendar instead.
    title = `${e.whenKind === 'closes' ? 'Closes' : 'Ends'}: ${e.title}`;
    dates = `${stamp(Date.parse(e.when) - 3600e3)}/${stamp(e.when)}`;
  }
  const where = e.mode === 'online' ? 'Online' : [e.place, e.city, e.country].filter(Boolean).join(', ');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details: e.url, location: where });
  return `https://calendar.google.com/calendar/render?${q}`;
}

// ---- preferences form ------------------------------------------------------

const checked = name => $$(`input[name="${name}"]:checked`, els.form).map(i => i.value);
const setChecks = (name, values = []) => $$(`input[name="${name}"]`, els.form).forEach(i => { i.checked = values.includes(i.value); });
const setRadio = (name, value) => { const el = $(`input[name="${name}"][value="${value}"]`, els.form); if (el) el.checked = true; };
// "Delhi, India" rather than "Delhi, National Capital Territory of Delhi, India".
const placeLabel = p => [p.name, p.admin1 && !p.admin1.includes(p.name) ? p.admin1 : null, p.country].filter(Boolean).join(', ');

function readPrefs() {
  const city = els.city.value.trim();
  return {
    city,
    loc: state.loc && state.locLabel === city ? state.loc : null,
    radius: els.form.elements.radius.value,
    interests: checked('interest'),
    keywords: els.keywords.value.trim(),
    types: checked('type'),
    mode: els.form.elements.mode.value,
    days: Number(els.form.elements.days.value),
    freeOnly: els.freeOnly.checked,
    beginner: els.beginner.checked,
  };
}

function applyPrefs(p) {
  if (!p) return;
  els.city.value = p.city || '';
  state.loc = p.loc || null;
  state.locLabel = p.loc ? p.city || '' : '';
  if (p.radius) setRadio('radius', p.radius);
  setChecks('interest', p.interests || []);
  els.keywords.value = p.keywords || '';
  if (p.types?.length) setChecks('type', p.types);
  if (p.mode) setRadio('mode', p.mode);
  if (p.days) setRadio('days', p.days);
  els.freeOnly.checked = !!p.freeOnly;
  els.beginner.checked = !!p.beginner;
}

// ---- city suggestions ----------------------------------------------------

let options = [];
let active = -1;
let suggestTimer;
let suggestSeq = 0;

function closeOptions() {
  options = [];
  active = -1;
  els.options.hidden = true;
  els.options.innerHTML = '';
  els.city.setAttribute('aria-expanded', 'false');
  els.city.removeAttribute('aria-activedescendant');
}
function drawOptions() {
  els.options.innerHTML = options.map((p, i) => `<li role="option" id="city-option-${i}" data-i="${i}" aria-selected="${i === active}"><span>${esc(p.name)}</span><small>${esc([p.admin1, p.country].filter(Boolean).join(', '))}</small></li>`).join('');
  els.options.hidden = !options.length;
  els.city.setAttribute('aria-expanded', String(!!options.length));
  if (active >= 0) els.city.setAttribute('aria-activedescendant', `city-option-${active}`);
  else els.city.removeAttribute('aria-activedescendant');
}
function pickOption(i) {
  const p = options[i];
  if (!p) return;
  state.loc = p;
  state.locLabel = placeLabel(p);
  els.city.value = state.locLabel;
  closeOptions();
}

els.city.addEventListener('input', () => {
  state.loc = null;
  state.locLabel = '';
  clearTimeout(suggestTimer);
  const q = els.city.value.trim();
  if (q.length < 2) return closeOptions();
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const { places } = await res.json();
      // Ignore answers that arrive after the person has moved on.
      if (seq !== suggestSeq || document.activeElement !== els.city || els.city.value.trim() !== q) return;
      options = places || [];
      active = -1;
      drawOptions();
    } catch { closeOptions(); }
  }, 180);
});
els.city.addEventListener('keydown', ev => {
  if (!options.length) return;
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    drawOptions();
  } else if (ev.key === 'Enter' && active >= 0) {
    ev.preventDefault();
    pickOption(active);
  } else if (ev.key === 'Escape') closeOptions();
});
els.city.addEventListener('blur', () => setTimeout(closeOptions, 120));
els.options.addEventListener('mousedown', ev => {
  const li = ev.target.closest('li[data-i]');
  if (!li) return;
  ev.preventDefault();
  pickOption(Number(li.dataset.i));
});

// ---- search ----------------------------------------------------------------

let controller = null;

async function search() {
  controller?.abort();
  const mine = (controller = new AbortController());
  const prefs = readPrefs();
  Object.assign(state, { prefs, loading: true, error: '', stage: '', locMiss: '', sources: [], events: [], found: 0, picked: 0, topics: [], typeFilter: null, shown: PAGE, view: 'results' });
  store.set('lineup.prefs', { ...prefs, loc: state.loc });
  render();
  try {
    const res = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prefs), signal: mine.signal });
    if (!res.ok || !res.body) throw new Error('bad response');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut;
      while ((cut = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line) onMessage(JSON.parse(line));
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    state.error = 'Lineup\'s server didn\'t answer. Check that the window running "node server.js" is still open, then search again.';
  } finally {
    if (controller === mine) {
      state.loading = false;
      render();
    }
  }
}

function onMessage(msg) {
  switch (msg.type) {
    case 'start':
      state.sources = msg.sources.map(s => ({ ...s, state: 'pending' }));
      els.brandLine.textContent = `Hackathons, meetups, conferences and contests from ${state.sources.length} sources, sorted for you.`;
      break;
    case 'loc':
      state.resultLoc = msg.loc;
      state.locMiss = !msg.loc && msg.asked ? msg.asked : '';
      if (msg.loc && !state.loc && els.city.value.trim() === msg.asked) {
        state.loc = msg.loc;
        state.locLabel = placeLabel(msg.loc);
        els.city.value = state.locLabel;
        store.set('lineup.prefs', { ...readPrefs(), loc: state.loc });
      }
      return;
    case 'source': {
      const s = state.sources.find(x => x.id === msg.id);
      if (s) Object.assign(s, msg);
      break;
    }
    case 'stage':
      state.stage = msg.text;
      break;
    case 'done':
      Object.assign(state, { events: msg.events, found: msg.found, picked: msg.picked, topics: msg.topics, resultLoc: msg.loc });
      return; // drawn when loading ends
    case 'error':
      state.error = `The search stopped early (${msg.message}). Try again.`;
      return;
    default:
      return;
  }
  renderHead();
  renderSources();
}

// ---- drawing ---------------------------------------------------------------

function render() {
  renderHead();
  renderSources();
  renderNotice();
  renderFilter();
  renderList();
  renderElsewhere();
  els.savedCount.textContent = Object.keys(saved).length;
  els.savedToggle.setAttribute('aria-pressed', String(state.view === 'saved'));
  els.sort.hidden = state.view === 'saved';
}

function renderHead() {
  let title, sub;
  if (state.view === 'saved') {
    const n = Object.keys(saved).length;
    title = n ? `${n} saved ${n === 1 ? 'event' : 'events'}` : 'Nothing saved yet';
    sub = 'Saved events are kept in this browser, soonest first.';
  } else if (state.loading) {
    const total = state.sources.length;
    const answered = state.sources.filter(s => s.state !== 'pending').length;
    title = total ? `Checking ${total} sources…` : 'Checking sources…';
    sub = state.stage && answered === total ? `${state.stage}…` : total ? `${answered} of ${total} have answered` : 'Starting up';
  } else if (state.error) {
    title = 'The search didn\'t finish';
    sub = '';
  } else {
    const n = state.picked;
    const near = state.resultLoc && state.prefs?.mode !== 'online' ? `near ${state.resultLoc.name}` : 'you can join online';
    const answered = state.sources.filter(s => s.state === 'ok').length;
    title = n ? `${n.toLocaleString()} ${n === 1 ? 'pick' : 'picks'} ${near}` : 'Nothing matched';
    sub = `Sorted from ${state.found.toLocaleString()} listings across ${answered} sources, for ${WINDOW[state.prefs?.days] || WINDOW[90]}.`;
    if (state.events.length < n) sub += ` Showing the top ${state.events.length}.`;
  }
  els.summary.textContent = title;
  els.sub.textContent = sub;
  els.sub.hidden = !sub;
}

function renderSources() {
  els.sources.hidden = state.view === 'saved' || !state.sources.length;
  if (els.sources.hidden) return;
  const total = state.sources.length;
  const ok = state.sources.filter(s => s.state === 'ok');
  const failed = state.sources.filter(s => s.state === 'failed').length;
  const skipped = state.sources.filter(s => s.state === 'skipped').length;
  const answered = ok.length + failed + skipped;
  const listings = ok.reduce((n, s) => n + (s.count || 0), 0);
  els.sourcesSummary.textContent = answered < total
    ? `Checking ${total} sources… ${answered} answered`
    : `${ok.length} of ${total} sources answered · ${listings.toLocaleString()} listings read${failed ? ` · ${failed} didn't answer` : ''}${skipped ? ` · ${skipped} skipped` : ''}`;
  const groups = new Map();
  for (const s of state.sources) {
    if (!groups.has(s.category)) groups.set(s.category, []);
    groups.get(s.category).push(s);
  }
  const chip = s => {
    const tail = s.state === 'ok' ? ` <b>${s.count}</b>` : s.state === 'failed' ? ' · no answer' : '';
    const title = s.state === 'skipped' ? `Skipped: ${s.note}` : s.state === 'failed' ? `No answer: ${s.note}` : s.state === 'ok' ? `${s.count} listings read` : 'Waiting';
    return `<li data-state="${esc(s.state)}" title="${esc(title)}"><span class="dot"></span>${esc(s.label)}${tail}</li>`;
  };
  els.sourceGroups.innerHTML = [...groups].map(([name, list]) => `<div class="source-group"><h3>${esc(name)} <small>${list.length}</small></h3><ul>${list.map(chip).join('')}</ul></div>`).join('');
}

function renderNotice() {
  const lines = [];
  let isError = false;
  if (state.view === 'results' && !state.loading) {
    if (state.error) { lines.push(state.error); isError = true; }
    else {
      if (state.locMiss) lines.push(`Couldn't find a city called “${state.locMiss}”, so this is online events only. Pick your city from the suggestions as you type.`);
      else if (!state.resultLoc) lines.push('Add your city on the left to include in-person events near you. This list is online events only.');
      const failed = state.sources.filter(s => s.state === 'failed').map(s => s.label);
      if (failed.length) lines.push(`${failed.join(', ')} didn't answer this time, so ${failed.length === 1 ? 'its' : 'their'} events are missing. Searching again in a minute usually fixes it.`);
    }
  }
  els.notice.hidden = !lines.length;
  els.notice.classList.toggle('error', isError);
  els.notice.textContent = lines.join(' ');
}

const baseList = () => (state.view === 'saved' ? Object.values(saved) : state.events);

function visible() {
  let list = baseList();
  if (state.typeFilter) list = list.filter(e => e.type === state.typeFilter);
  if (state.view === 'saved' || state.sort === 'soonest') return [...list].sort((a, b) => Date.parse(a.when) - Date.parse(b.when));
  if (state.sort === 'closing') return list.filter(e => e.deadline).sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline));
  return list;
}

function renderFilter() {
  const list = baseList();
  const counts = {};
  for (const e of list) counts[e.type] = (counts[e.type] || 0) + 1;
  const kinds = Object.keys(TYPE).filter(t => counts[t]);
  if (state.typeFilter && !counts[state.typeFilter]) state.typeFilter = null;
  els.filter.hidden = (state.loading && state.view === 'results') || kinds.length < 2;
  const button = (value, label, n) => `<button type="button" data-type="${value}" aria-pressed="${(state.typeFilter || '') === value}">${esc(label)} <small>${n}</small></button>`;
  els.filter.innerHTML = button('', 'All', list.length) + kinds.map(t => button(t, TYPE[t][1], counts[t])).join('');
}

function highlight(title, terms) {
  if (!terms?.length) return esc(title);
  const words = [...terms].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'giu');
  let out = '';
  let last = 0;
  for (const m of title.matchAll(re)) {
    out += `${esc(title.slice(last, m.index))}<mark>${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + esc(title.slice(last));
}

function whereLine(e) {
  if (e.mode === 'online') return 'Online';
  const g = e.geo || {};
  const far = g.tier === 'country' || g.tier === 'abroad' || g.remote;
  const place = [e.city || e.place, far ? (g.tier === 'country' ? e.region : e.country) || e.country : null].filter(Boolean).join(', ');
  if (g.remote) return `Online option${place ? ` · on site in ${place}` : ''}`;
  const km = g.km != null && (g.tier === 'city' || g.tier === 'region') ? ` · ${g.km < 1 ? 'under 1' : g.km} km away` : '';
  return `${e.mode === 'hybrid' ? 'Hybrid' : 'In person'}${place ? ` · ${place}` : ''}${km}`;
}

function ticket(e) {
  const when = new Date(e.when);
  const z = zone(e.allDay);
  const left = dayDiff(e.when, e.allDay);
  const over = Date.parse(e.when) < Date.now() - DAY;
  const urgent = !over && e.whenKind === 'closes' && left <= 3;
  const stubKind = over ? 'Past' : e.whenKind === 'closes' ? 'Closes' : e.whenKind === 'ends' ? 'Until' : left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : '';

  const facts = [];
  for (const t of e.matchedTopics || []) facts.push(['match', t]);
  if (state.prefs?.beginner && e.beginner) facts.push(['match', 'Beginner-friendly']);
  if (!over && e.deadline) {
    const d = dayDiff(e.deadline, e.allDay);
    facts.push([`deadline${d <= 3 ? ' urgent' : ''}`, `Closes ${shortDate(e.deadline, e.allDay)} · ${inDays(d)}`]);
  } else if (!over && e.whenKind === 'starts' && left <= 14) {
    facts.push(['deadline', `Starts ${inDays(left)}`]);
  }
  if (e.prize) facts.push(['', e.prize]);
  if (e.free === true) facts.push(['', 'Free']);
  if (e.popularity >= 20) facts.push(['', `${e.popularity.toLocaleString()} ${e.source === 'luma' ? 'going' : 'registered'}`]);
  const shownTopics = new Set((e.matchedTopics || []).map(t => t.toLowerCase()));
  for (const tag of (e.tags || []).filter(t => t && !shownTopics.has(t.toLowerCase())).slice(0, 3)) facts.push(['tag', tag]);

  let fit = '';
  if (state.view === 'results' && state.topics.length && e.matched) {
    const level = e.score >= 68 ? 3 : e.score >= 54 ? 2 : 1;
    fit = `<span class="fit" data-level="${level}"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span>${['Worth a look', 'Good match', 'Strong match'][level - 1]}</span>`;
  }
  const also = (e.alsoOn || []).map(a => `<a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener noreferrer">${esc(a.label)}</a>`).join(', ');
  const isSaved = !!saved[e.id];
  const url = esc(safeUrl(e.url));

  return `<li class="ticket">
    <div class="stub${urgent ? ' urgent' : ''}">
      ${stubKind ? `<span class="stub-kind">${stubKind}</span>` : ''}
      <span class="stub-month">${esc(fmt({ month: 'short', ...z }, when))}</span>
      <span class="stub-day">${esc(fmt({ day: 'numeric', ...z }, when))}</span>
      <span class="stub-dow">${esc(fmt({ weekday: 'short', ...z }, when))}</span>
    </div>
    <div class="ticket-body">
      <div class="eyebrow">
        <span class="kind">${esc(TYPE[e.type]?.[0] || 'Event')}</span>
        <span>${esc(whereLine(e))}</span><span class="sep" aria-hidden="true">/</span><span>${esc(whenLine(e))}</span>
        ${fit}
      </div>
      <h3><a href="${url}" target="_blank" rel="noopener noreferrer">${highlight(e.title, e.matchedTerms)}</a></h3>
      ${e.blurb ? `<p class="blurb">${esc(e.blurb)}</p>` : ''}
      ${facts.length ? `<ul class="facts">${facts.map(([cls, text]) => `<li${cls ? ` class="${cls}"` : ''}>${esc(text)}</li>`).join('')}</ul>` : ''}
      <div class="ticket-foot">
        <span class="via">${e.organizer ? `${esc(e.organizer)} · ` : ''}via ${esc(e.sourceLabel)}${also ? ` · also on ${also}` : ''}</span>
        <span class="actions">
          <button type="button" class="save" data-id="${esc(e.id)}" aria-pressed="${isSaved}">${isSaved ? 'Saved' : 'Save'}</button>
          <a class="cal" href="${esc(calendarUrl(e))}" target="_blank" rel="noopener noreferrer">Add to calendar</a>
          <a class="open" href="${url}" target="_blank" rel="noopener noreferrer">Open ↗</a>
        </span>
      </div>
    </div>
  </li>`;
}

const skeleton = () => `<li class="ticket skeleton" aria-hidden="true">
  <div class="stub"><span class="bone"></span></div>
  <div class="ticket-body"><span class="bone" style="width:38%"></span><span class="bone" style="width:72%;height:18px"></span><span class="bone" style="width:90%"></span><span class="bone" style="width:55%"></span></div>
</li>`;

function emptyMessage() {
  if (state.view === 'saved') return ['Nothing saved yet', 'Press Save on any event and it will wait for you here.'];
  if (state.error) return ['No results to show', 'Run the search again once the server is back.'];
  if (state.events.length && state.sort === 'closing') return ['No deadlines listed', 'None of these events publish a registration deadline. Switch back to Best match to see them.'];
  if (!state.resultLoc && state.prefs?.mode === 'in-person') return ['Add your city first', 'In-person events need a place to measure from. Type your city on the left and search again.'];
  return ['Nothing matched these preferences', 'Try a longer time window, a wider travel distance, or tick more kinds of event.'];
}

function renderList() {
  if (state.loading && state.view === 'results') {
    els.list.innerHTML = skeleton().repeat(4);
    els.more.hidden = true;
    return;
  }
  const all = visible();
  if (!all.length) {
    const [head, body] = emptyMessage();
    els.list.innerHTML = `<li class="empty"><strong>${esc(head)}</strong>${esc(body)}</li>`;
    els.more.hidden = true;
    return;
  }
  const split = state.view === 'results' && state.sort === 'best' && state.topics.length > 0;
  let html = '';
  let divided = false;
  for (const e of all.slice(0, state.shown)) {
    if (split && !divided && !e.matched) {
      divided = true;
      html += '<li class="divider">Outside your interests, still within reach</li>';
    }
    html += ticket(e);
  }
  els.list.innerHTML = html;
  const rest = all.length - state.shown;
  els.more.hidden = rest <= 0;
  if (rest > 0) els.more.textContent = `Show ${Math.min(PAGE, rest)} more`;
}

function renderElsewhere() {
  const ready = state.view === 'results' && !state.loading && !state.error && state.prefs;
  els.elsewhere.hidden = !ready;
  if (!ready) return;
  const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const topic = (state.topics[0] || 'tech').replace(/\s*[/&]\s*/g, ' ');
  const loc = state.resultLoc;
  const city = loc?.name;
  const q1 = city ? `${topic} events in ${city}` : `${topic} online events`;
  const q2 = city ? `hackathons in ${city}` : 'online hackathons';
  const links = [
    ['Google events', q1, `https://www.google.com/search?q=${encodeURIComponent(q1)}&ibp=htl;events`],
    ['Google', q2, `https://www.google.com/search?q=${encodeURIComponent(q2)}`],
    ['Eventbrite', city ? `${topic} in ${city}` : `${topic}, online`, city ? `https://www.eventbrite.com/d/${slug(loc.country)}--${slug(city)}/${slug(topic)}/` : `https://www.eventbrite.com/d/online/${slug(topic)}/`],
    ['LinkedIn events', `${topic}${city ? ` ${city}` : ''}`, `https://www.linkedin.com/search/results/events/?keywords=${encodeURIComponent(`${topic}${city ? ` ${city}` : ''}`)}`],
    ['Kaggle', 'Open data science competitions', 'https://www.kaggle.com/competitions'],
  ];
  els.links.innerHTML = links.map(([site, text, url]) => `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(site)}</b><span>${esc(text)}</span></a></li>`).join('');
}

// ---- interactions ----------------------------------------------------------

els.form.addEventListener('submit', ev => {
  ev.preventDefault();
  clearTimeout(suggestTimer);
  suggestSeq++; // drop any city suggestions still on their way
  closeOptions();
  search();
  if (window.matchMedia('(max-width: 900px)').matches) els.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

els.reset.addEventListener('click', () => {
  els.form.reset();
  state.loc = null;
  state.locLabel = '';
  store.drop('lineup.prefs');
  search();
});

els.sort.addEventListener('change', ev => {
  state.sort = ev.target.value;
  state.shown = PAGE;
  renderList();
});

els.filter.addEventListener('click', ev => {
  const b = ev.target.closest('button[data-type]');
  if (!b) return;
  state.typeFilter = b.dataset.type || null;
  state.shown = PAGE;
  renderFilter();
  renderList();
});

els.more.addEventListener('click', () => {
  state.shown += PAGE;
  renderList();
});

els.savedToggle.addEventListener('click', () => {
  state.view = state.view === 'saved' ? 'results' : 'saved';
  state.typeFilter = null;
  state.shown = PAGE;
  render();
});

els.list.addEventListener('click', ev => {
  const b = ev.target.closest('button.save');
  if (!b) return;
  const id = b.dataset.id;
  if (saved[id]) delete saved[id];
  else {
    const e = state.events.find(x => x.id === id);
    if (e) saved[id] = e;
  }
  store.set('lineup.saved', saved);
  els.savedCount.textContent = Object.keys(saved).length;
  if (state.view === 'saved') render();
  else {
    b.setAttribute('aria-pressed', String(!!saved[id]));
    b.textContent = saved[id] ? 'Saved' : 'Save';
  }
});

// ---- start -----------------------------------------------------------------

applyPrefs(store.get('lineup.prefs', null));
search();
