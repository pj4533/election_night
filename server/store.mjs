// In-memory state + change detection → broadcast events (chyron/alerts) + history time series.
import fs from 'node:fs';
import { WATCH } from './config.mjs';
import * as L from './log.mjs';
import { buildControl, computeBattleground, houseSummary, normalizeMarkets, raceKeyOf } from './battleground.mjs';

const RATING_W = (r) => (r = r || '', r === 'tossup' ? 1 : r.startsWith('lean') ? 0.8 : r.startsWith('likely') ? 0.45 : r.startsWith('solid') ? 0.15 : 0.3);
const ET = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
const PNAME = { DEM: 'Democrat', GOP: 'Republican', LIB: 'Libertarian', GRN: 'Green', OTH: 'Independent' };
const who = (c) => (c ? `${c.name} (${{ DEM: 'D', GOP: 'R', LIB: 'L', GRN: 'G', OTH: 'I' }[c.party] || '?'})` : '');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const DATA_DIR = process.env.DATA_DIR || (process.env.SIM === '1' ? 'data-sim' : 'data');
const HISTORY_FILE = `${DATA_DIR}/history.jsonl`;

const normalizeAll = (l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, Array.isArray(v) ? normalizeMarkets(v) : v]).filter(([, v]) => v));

export function createStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  let simActive = false; // SIM mode: ignore real updates for watched keys
  const s = {
    startedAt: Date.now(),
    watch: {}, // key -> race
    races: {}, // nytId -> state-level race (Senate + Gov)
    countyRaces: {}, // nytId -> race with counties
    partyControl: {}, pollClosings: [], insights: [], news: [], odds: {},
    dutchessTicker: [], events: [], sources: {}, history: {}, spotlight: [],
    house: {}, raceOdds: { kalshi: {}, polymarket: {} }, polyControl: {}, battleground: [],
  };
  const flipSeen = new Set();
  let housePrimed = false, bgT = null, bgLastLog = 0, bgLastTop = '';
  const seenInsights = new Set();
  const calledAt = {};
  const lastChangeAt = {};
  let insightsPrimed = false, newsPrimed = false;
  const seenNews = new Set();
  // Network chamber calls detected from headlines (NBC / DDHQ / CNN / ABC / CBS / Fox / AP)
  s.networkCalls = {};
  const NET = [['NBC', /\bNBC\b|MSNBC/i], ['Decision Desk HQ', /Decision Desk|DDHQ/i], ['CNN', /\bCNN\b/i], ['ABC', /\bABC\b/i], ['CBS', /\bCBS\b/i], ['Fox', /\bFox\b/i]]; // AP excluded: AP chamber calls come only from the data feed
  function detectNetworkCalls(items, announce) {
    const POLLS_FIRST_CLOSE = Date.parse('2026-11-03T23:00:00Z'); // a 'call' published before any poll closed is not a call
    for (const it of items) {
      if (!it.date || it.date < POLLS_FIRST_CLOSE) continue;
      const t = `${it.title} ${it.source || ''}`;
      // STRICT: must be about CHAMBER CONTROL, not a single race ("wins Texas Senate race, AP calls" is NOT control).
      const ctl = it.title.match(/(?:control of(?: the)?|majority in the|flips?(?: of)? the|flip of|win(?:s|ning)? the|take(?:s)? the|keep(?:s)? the|hold(?:s)? the)\s+(House|Senate)\b(?!\s+(?:race|seat|term|primary|bid|contest))|\b(House|Senate)\s+(?:control|majority)\b/i);
      if (!ctl) continue;
      if (/\b(race|seat|term)s?\b/i.test(it.title) && !/control|majority/i.test(it.title)) continue;
      const ch = (ctl[1] || ctl[2]).toLowerCase() === 'house' ? 'house' : 'senate';
      if (/(could|may|might|would|if |poll|forecast|odds|chance|race to|battle for|path to|need|closer|lead in|on track|within reach)/i.test(it.title)) continue;
      if (!/(project|projects|projected|calls?|wins?|won|flips?|takes?|keeps?|holds?)/i.test(it.title)) continue;
      const party = /Democrat/i.test(it.title) ? 'DEM' : /Republican|GOP/i.test(it.title) ? 'GOP' : null;
      if (!party) continue;
      const nets = NET.filter(([, re]) => re.test(t)).map(([n]) => n);
      if (!nets.length) continue;
      const cur = (s.networkCalls[ch] ||= { party, sources: [], first: it.date || Date.now() });
      if (cur.party !== party) continue;
      for (const n of nets) if (!cur.sources.includes(n)) {
        const firstNet = cur.sources.length === 0;
        cur.sources.push(n);
        if (announce && firstNet && (!it.date || Date.now() - it.date < 30 * 60_000)) {
          pushEvent({ type: 'call', priority: 3, party, text: `${n.toUpperCase()} PROJECTS: ${party === 'DEM' ? 'DEMOCRATS' : 'REPUBLICANS'} WIN THE ${ch.toUpperCase()}`, sub: 'Network projection · AP has not called yet' });
        }
      }
    }
  }
  const listeners = new Set();
  let flushT = null, evId = 0;

  // restore history
  try {
    for (const line of fs.readFileSync(HISTORY_FILE, 'utf8').split('\n')) {
      if (!line) continue;
      const p = JSON.parse(line);
      (s.history[p.key] ||= []).push(p);
    }
  } catch {}

  function broadcast() {
    clearTimeout(flushT);
    flushT = setTimeout(() => { const snap = snapshot(); for (const fn of listeners) fn('state', snap); }, 250);
  }
  function pushEvent(e) {
    const ev = { id: ++evId, ts: Date.now(), priority: 1, ...e };
    s.events.unshift(ev);
    s.events.length = Math.min(s.events.length, 150);
    L.event(ev);
    for (const fn of listeners) fn('event', ev);
    broadcast();
  }

  function recordHistory(key, race) {
    const pt = { key, t: Date.now(), total: race.totalVotes, eevp: race.eevp ?? null, v: Object.fromEntries(race.candidates.map((c) => [c.id, c.votes])) };
    const arr = (s.history[key] ||= []);
    const last = arr[arr.length - 1];
    if (last && last.total === pt.total && JSON.stringify(last.v) === JSON.stringify(pt.v)) return;
    arr.push(pt);
    if (arr.length > 2000) arr.shift();
    fs.appendFile(HISTORY_FILE, JSON.stringify(pt) + '\n', () => {});
  }

  // compare prev vs next race; emit events
  function diff(prev, next, { watched, label }) {
    const name = label || next.short || next.title;
    const lead = next.candidates[0];
    const second = next.candidates[1];
    if (!prev) return;
    const pv = prev.totalVotes || 0, nv = next.totalVotes || 0;
    if (nv !== pv) lastChangeAt[next.key] = Date.now();
    if (pv === 0 && nv > 0) {
      pushEvent({
        type: 'first', priority: watched ? 3 : 1, raceKey: next.key,
        text: `FIRST RESULTS: ${name}`,
        sub: `${who(lead)} ${lead.pct.toFixed(1)}% · ${second ? `${who(second)} ${second.pct.toFixed(1)}%` : ''} · ${fmt(nv)} votes`,
      });
    }
    const prevLead = prev.candidates?.[0];
    if (pv > 0 && nv > 0 && prevLead && lead && prevLead.id !== lead.id && !lead.writeIn && (watched || nv >= 10000)) {
      pushEvent({ type: 'lead', priority: watched ? 3 : 2, raceKey: next.key, text: `LEAD CHANGE: ${name}`, sub: `${who(lead)} moves ahead of ${who(prevLead)}` });
    }
    const winner = next.candidates.find((c) => c.winner);
    const prevWinner = prev.candidates?.find((c) => c.winner);
    if (winner && !prevWinner) {
      calledAt[next.key] = Date.now();
      // Senate is the story now: every Senate call is a full alert and carries the seat math toward 51
      let seatLine = null;
      if (next.officeId === 'S') {
        const pb = s.partyControl?.S?.party_balance || {};
        const won = (p) => (pb[p]?.no_election || 0) + Object.values(s.races).filter((r) => r.officeId === 'S' && r.nytId !== next.nytId && r.candidates.some((c) => c.winner && c.party === p)).length + (winner.party === p ? 1 : 0);
        const d = won('DEM'), g = won('GOP'), toWin = s.partyControl?.S?.to_win?.DEM || 51;
        seatLine = d >= toWin ? (winner.party === 'DEM' && d === toWin ? `DEMS NOW ${d} · SENATE CONTROL CLINCHED` : `DEMS HOLD ${d} · GOP ${g}`) : `DEMS NOW ${d} · NEED ${toWin - d} MORE · GOP ${g}`;
      }
      pushEvent({
        type: 'call', priority: watched ? 4 : next.officeId === 'S' ? 3 : (String(next.rating || '').startsWith('solid') ? 2 : 3), raceKey: next.key, party: winner.party,
        text: `${next.kind === 'dutchess' ? 'WINNER' : 'AP PROJECTS'}: ${winner.name.toUpperCase()} (${PNAME[winner.party] ? PNAME[winner.party].toUpperCase() : winner.party}) WINS ${name}`,
        sub: [seatLine, next.gained ? `${next.gained === true ? (winner.party === 'DEM' ? 'DEM' : winner.party === 'GOP' ? 'GOP' : '') : next.gained} PICKUP`.trim() : null, winner.votes ? `${winner.pct.toFixed(1)}% · ${fmt(winner.votes)} votes` : 'PROJECTED AT POLL CLOSE'].filter(Boolean).join(' · '),
      });
    }
    if (watched && pv > 0 && nv > pv) {
      const deltas = next.candidates.slice(0, 2).map((c) => {
        const p = prev.candidates.find((x) => x.id === c.id);
        return `${c.last || c.name} +${fmt(c.votes - (p?.votes || 0))}`;
      });
      pushEvent({ type: 'votes', priority: ['pineplains', 'stanford-supv', 'stanford-council'].includes(next.key) ? 3 : 1, raceKey: next.key, text: `NEW VOTES: ${name}`, sub: deltas.join(' · ') + (next.eevp != null ? ` · ${Math.round(next.eevp)}% in` : '') });
    }
  }

  function attachOdds(race) {
    if (!race.kalshi || !s.odds[race.kalshi]) return race;
    for (const c of race.candidates) {
      const m = s.odds[race.kalshi].find((m) => m.name && c.last && m.name.toLowerCase().includes(c.last.toLowerCase()));
      if (m) c.odds = m.price;
    }
    return race;
  }

  function mergeWatched(w) {
    if (simActive) return;
    const st = s.races[w.nytId];
    const co = s.countyRaces[w.nytId];
    if (!st && !co) return;
    // prefer whichever is fresher for top-level; always keep counties
    let base = st;
    if (co && (!st || Date.parse(co.updatedAt) > Date.parse(st.updatedAt))) base = co;
    const next = attachOdds({ ...base, counties: co?.counties || base.counties, story: co?.story || base.story, title: w.title, short: w.short, focus: w.focus, kalshi: w.kalshi });
    const prev = s.watch[w.key];
    diff(prev, next, { watched: true });
    s.watch[w.key] = next;
    recordHistory(w.key, next);
  }

  function computeSpotlight() {
    const now = Date.now();
    const watchedIds = new Set(WATCH.map((w) => w.nytId).filter(Boolean));
    const scored = Object.values(s.races)
      .filter((r) => !watchedIds.has(r.nytId) && r.candidates.length >= 2 && r.officeId === 'S') // Senate-only spotlight (Senate control is the story)
      .map((r) => {
        const rw = RATING_W(r.rating);
        const [a, b] = r.candidates;
        let score;
        if (r.callStatus === 'called' || r.candidates.some((c) => c.winner)) {
          const t = calledAt[r.key];
          score = t && now - t < 4 * 60_000 ? 2 : 0.05 * rw;
        } else if (!r.totalVotes) score = 0.25 * rw;
        else {
          const margin = Math.abs(a.pct - b.pct);
          const closeness = Math.max(0, 1 - margin / 25);
          const wp = a.winProb ?? null;
          const probClose = wp == null ? closeness : 1 - Math.abs(wp - 0.5) * 2;
          const recent = lastChangeAt[r.key] && now - lastChangeAt[r.key] < 120_000 ? 0.25 : 0;
          score = rw * 0.6 + closeness * 0.25 + probClose * 0.15 + recent + Math.min(r.eevp, 90) / 900;
        }
        return { id: r.nytId, score, state: r.state };
      })
      .sort((x, y) => y.score - x.score);
    const top = scored.slice(0, 3).map((x) => x.id);
    if (JSON.stringify(top) !== JSON.stringify(s.spotlight)) {
      L.event({ type: 'spotlight', top: scored.slice(0, 5) });
      s.spotlight = top;
    }
  }

  // Chamber-control projection: AP official call (NYT party_balance winner) vs our projection when the NYT model
  // AND the betting markets are both near-certain. Projection is clearly labeled as NOT an AP call.
  const prevAp = { senate: undefined, house: undefined };
  function projectControl(control) {
    const NAME = { senate: 'SENATE', house: 'HOUSE' }, PN = { DEM: 'DEMOCRATS', GOP: 'REPUBLICANS' };
    for (const ch of ['senate', 'house']) {
      const c = control?.[ch]; if (!c) continue;
      const P = s.partyControl?.[ch === 'senate' ? 'S' : 'H']?.party_balance || {};
      const apWinner = ['DEM', 'GOP'].find((p) => P[p]?.winner);
      const m = c.model?.winProb || {}, o = c.odds || {};
      const proj = ['DEM', 'GOP'].find((p) => (m[p] ?? 0) >= 0.99 && (o[p] ?? 0) >= 0.97);
      c.networkCall = s.networkCalls?.[ch] || null;
      c.call = apWinner ? { party: apWinner, by: 'AP' } : proj ? { party: proj, by: 'projection', model: m[proj], odds: o[proj] } : null;
      // Only the AP call is announced as an alert, and only on a transition seen by THIS process
      // (otherwise every restart / fresh Vercel instance would re-announce it). The projection is a persistent badge.
      if (prevAp[ch] === null && apWinner) {
        pushEvent({ type: 'call', priority: 4, party: apWinner, text: `AP: ${PN[apWinner]} WIN CONTROL OF THE ${NAME[ch]}`, sub: `${c.seats?.[apWinner] ?? ''} seats` });
      }
      if (s.partyControl?.[ch === 'senate' ? 'S' : 'H']) prevAp[ch] = apWinner || null;
    }
    return control;
  }

  // Betting odds on EVERY race card (user: "in every possible place"): Kalshi + Polymarket race markets,
  // averaged; non-GOP independents (e.g. Osborn, NE) take the non-GOP side of the market.
  function withRaceOdds(r) {
    if (!r) return r;
    const key = raceKeyOf(r); if (!key) return r;
    const kal = s.raceOdds?.kalshi?.[key], pol = s.raceOdds?.polymarket?.[key];
    if (!kal && !pol) return r;
    const hasDem = r.candidates.some((c) => c.party === 'DEM');
    const pick = (m, c) => (m ? (m[c.party] ?? (!hasDem && c.party !== 'GOP' ? m.DEM : undefined)) : undefined);
    const candidates = r.candidates.map((c) => {
      if (c.odds != null) return c;
      const v = [pick(kal, c), pick(pol, c)].filter((x) => x != null);
      return v.length ? { ...c, odds: v.reduce((a, x) => a + x, 0) / v.length } : c;
    });
    return { ...r, candidates };
  }

  function snapshot() {
    const spot = s.spotlight.map((id) => {
      const st = s.races[id];
      const co = s.countyRaces[id];
      return st ? withRaceOdds({ ...st, counties: co?.counties, story: co?.story }) : null;
    }).filter(Boolean);
    return {
      now: Date.now(), startedAt: s.startedAt,
      watch: WATCH.map((w) => s.watch[w.key]).filter(Boolean).map((r) => (r.kind === 'nyt' ? withRaceOdds(r) : r)),
      spotlight: spot,
      races: Object.values(s.races).map(({ counties, description, story, ...r }) => withRaceOdds(r)),
      partyControl: s.partyControl, pollClosings: s.pollClosings,
      insights: s.insights.slice(0, 30), news: s.news.filter((n) => !n.date || Date.now() - n.date < 3 * 3600_000).slice(0, 60), odds: s.odds, // only fresh headlines (no stale narrative)
      dutchessTicker: s.dutchessTicker, events: s.events.filter((e) => Date.now() - e.ts < 45 * 60_000).slice(0, 40), sources: s.sources,
      history: Object.fromEntries(Object.entries(s.history).map(([k, v]) => [k, v.slice(-300)])),
      control: projectControl(buildControl({ partyControl: s.partyControl, kalshiOdds: s.odds, polyControl: s.polyControl, houseSummary: houseSummary(s.house) })),
      battleground: s.battleground,
    };
  }

  // --- battleground ranking: debounce, log reorderings sparingly -------------
  function scheduleBattleground() {
    if (bgT) return;
    bgT = setTimeout(() => {
      bgT = null;
      try {
        s.battleground = computeBattleground({ races: s.races, house: s.house, raceOdds: s.raceOdds });
        const top = s.battleground.slice(0, 6).map((b) => b.key).join(',');
        if (top !== bgLastTop && Date.now() - bgLastLog > 60_000) {
          bgLastTop = top; bgLastLog = Date.now();
          L.event({ type: 'battleground', top: s.battleground.slice(0, 8).map((b) => ({ key: b.key, score: b.score, why: b.why })) });
        }
      } catch (e) { L.error({ src: 'battleground', error: String(e.stack || e) }); }
      broadcast();
    }, 600);
  }

  // poll-closing announcer
  let lastCloseCheck = Date.now() - 10_000; // don't re-announce on restart
  setInterval(() => {
    const now = Date.now();
    const closing = s.pollClosings.filter((p) => {
      const t = Date.parse(p.poll_closing_time);
      return t > lastCloseCheck && t <= now;
    });
    lastCloseCheck = now;
    if (closing.length) {
      const states = closing.map((p) => p.reporting_unit?.state_postal).filter(Boolean);
      pushEvent({ type: 'polls', priority: 3, text: `POLLS NOW CLOSED: ${states.join(' · ')}`, sub: `${ET(now)} ET — first results expected shortly`, states });
    }
  }, 5000);

  return {
    snapshot, pushEvent,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setSourceStatus(name, st) { s.sources[name] = { ...(s.sources[name] || {}), ...st }; broadcast(); },
    setSim(on) { simActive = !!on; },
    // sim-only: bypasses the simActive guard and can clear history
    simUpdateRace(key, race) {
      const prev = s.watch[key];
      diff(prev, race, { watched: true });
      s.watch[key] = race;
      recordHistory(key, race);
      broadcast();
    },
    getWatch(key) { return s.watch[key]; },
    updateRace(key, race) {
      if (simActive) return;
      const prev = s.watch[key];
      diff(prev, race, { watched: true });
      s.watch[key] = race;
      recordHistory(key, race);
      broadcast();
    },
    updateNationalRaces(file, races) {
      for (const r of races) {
        const prev = s.races[r.nytId];
        const watched = WATCH.some((w) => w.nytId === r.nytId);
        if (!watched) diff(prev, r, { watched: false, label: `${r.stateName?.toUpperCase()} ${r.officeId === 'S' ? 'SENATE' : 'GOVERNOR'}` });
        s.races[r.nytId] = r;
      }
      for (const w of WATCH.filter((w) => w.nytId)) mergeWatched(w);
      computeSpotlight();
      scheduleBattleground();
      for (const id of s.spotlight) if (s.races[id]) recordHistory(id, s.races[id]);
      broadcast();
    },
    updateCountyRace(r) {
      s.countyRaces[r.nytId] = r;
      const w = WATCH.find((w) => w.nytId === r.nytId);
      if (w) mergeWatched(w);
      broadcast();
    },
    setRaceOdds(source, lists) {
      s.raceOdds[source] = normalizeAll(lists);
      scheduleBattleground();
    },
    setPolymarketControl(c) { s.polyControl = { ...s.polyControl, ...c }; broadcast(); },
    updateHouseRaces(list) {
      const now = Date.now();
      for (const r of list) {
        const prev = s.house[r.nytId];
        if (prev && prev.totalVotes !== r.totalVotes) r.lastChangeAt = now;
        else if (prev?.lastChangeAt) r.lastChangeAt = prev.lastChangeAt;
        const winner = r.candidates.find((c) => c.winner);
        const prevWinner = prev?.candidates?.find((c) => c.winner);
        if (winner && r.gained && !flipSeen.has(r.nytId) && !prevWinner) {
          flipSeen.add(r.nytId);
          const recent = r.winnerAcceptedAt && now - r.winnerAcceptedAt < 3 * 60_000;
          if (housePrimed || recent) {
            const nm = winner.party === 'DEM' ? 'DEMOCRATS' : winner.party === 'GOP' ? 'REPUBLICANS' : 'INDEPENDENT';
            const label = (raceKeyOf(r) || r.nytId).replace(/^H-/, '');
            pushEvent({ type: 'flip', priority: 3, raceKey: r.nytId, party: winner.party, text: `${nm} FLIP ${label}`, sub: `${winner.name} defeats incumbent party in ${r.state} House seat` });
          }
        } else if (winner && r.gained) flipSeen.add(r.nytId);
        s.house[r.nytId] = r;
      }
      housePrimed = true;
      scheduleBattleground();
    },
    updatePartyControl(offices) { s.partyControl = { ...s.partyControl, ...offices }; broadcast(); },
    setPollClosings(p) { s.pollClosings = p; },
    addInsights(list) {
      const fresh = [];
      for (const i of list) {
        if (i.hidden || seenInsights.has(i.id)) continue;
        seenInsights.add(i.id);
        const item = { id: i.id, text: i.text || (i.sentence_parts || []).map((p) => p.text).join(''), race: i.nyt_race_id, kind: i.race_insight, at: Date.parse(i.created_at) };
        s.insights.push(item);
        fresh.push(item);
      }
      s.insights.sort((a, b) => b.at - a.at);
      s.insights.length = Math.min(s.insights.length, 80);
      if (insightsPrimed) for (const i of fresh.slice(0, 5)) pushEvent({ type: 'insight', priority: i.kind?.includes('call') ? 2 : 1, text: i.text, raceKey: i.race });
      if (Date.now() - s.startedAt > 45_000) insightsPrimed = true;
    },
    setNews(items) {
      const byTitle = new Map();
      for (const it of items) {
        const k = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
        if (!byTitle.has(k) || it.tag) byTitle.set(k, { ...it, k });
      }
      const list = [...byTitle.values()].filter((x) => !x.date || Date.now() - x.date < 36 * 3600_000)
        .sort((a, b) => (b.date || 0) - (a.date || 0));
      for (const it of list) {
        it.fresh = newsPrimed && !seenNews.has(it.k);
        seenNews.add(it.k);
      }
      if (newsPrimed) {
        const fresh = list.filter((x) => x.fresh && x.tag);
        for (const f of fresh.slice(0, 3)) pushEvent({ type: 'news', priority: 1, text: f.title, sub: f.source, raceKey: f.tag });
      }
      const wasPrimed = newsPrimed; // first scan after a restart records network calls silently (no re-announce on every ship)
      if (Date.now() - s.startedAt > 45_000) newsPrimed = true;
      s.news = list;
      try { detectNetworkCalls(list, wasPrimed); } catch (e) { L.error({ src: 'store', label: 'networkCalls', error: String(e) }); }
      broadcast();
    },
    setOdds(o) {
      s.odds = { ...s.odds, ...o };
      for (const w of WATCH) if (s.watch[w.key]) attachOdds(s.watch[w.key]);
      broadcast();
    },
    setDutchessTicker(t) { s.dutchessTicker = t; broadcast(); },
    spotlightStates() { return s.spotlight.map((id) => s.races[id]?.state).filter(Boolean); },
  };
}
