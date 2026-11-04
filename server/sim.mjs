// SIM=1 mode: scripted fake results for the watched races, looped every ~6 min, so the UI can be tested
// without waiting for real returns. Real sources still run (news, odds, other races); the store ignores
// real updates for watched keys while sim is active (store.setSim(true)).
import fs from 'node:fs';
import * as L from './log.mjs';

const TICK_MS = 5000;
const LOOP_TICKS = 72; // 72 * 5s = 6 min
const PRE_TICKS = 6; // ~30s of pre-results

// deterministic pseudo-random helpers
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; }
const gauss = (k) => (hash(k + 'a') + hash(k + 'b') + hash(k + 'c') - 1.5) * 2; // ~ -3..3
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const iso = () => new Date().toISOString();

// per-race scenario: finalDem = target dem 2-party share, early = early-count shift against dem (creates lead flips)
const SCEN = {
  'mi-sen': { dem: 0.525, early: 0.05, curve: 1.0 },
  'tx-sen': { dem: 0.508, early: 0.075, curve: 0.9 },
  'ia-gov': { dem: 0.515, early: 0.06, curve: 1.1 },
};

// Pine Plains scripted batches [tick, method, Roush, Walsh, write-in]
const PP_BATCHES = [
  [PRE_TICKS, 'Early Voting', 165, 100, 2],
  [PRE_TICKS + 8, 'Early Voting', 50, 33, 1],
  [PRE_TICKS + 16, 'Election Day', 62, 150, 1],
  [PRE_TICKS + 24, 'Election Day', 60, 100, 2],
  [PRE_TICKS + 32, 'Election Day', 80, 72, 1],
  [PRE_TICKS + 42, 'Election Day', 110, 52, 1],
  [PRE_TICKS + 50, 'Absentee/EMB', 28, 17, 0],
];
const PP_CALL_TICK = PRE_TICKS + 54;

function loadTemplates(store) {
  let sample = null;
  try { sample = JSON.parse(fs.readFileSync('research/samples/state-snapshot.json', 'utf8')); } catch {}
  const t = {};
  for (const key of ['pineplains', 'mi-sen', 'tx-sen', 'ia-gov']) {
    const base = store.getWatch(key) || sample?.watch?.find((w) => w.key === key);
    if (base) t[key] = JSON.parse(JSON.stringify(base));
    if (t[key] && key !== 'pineplains' && !t[key].counties?.length) {
      const sc = sample?.watch?.find((w) => w.key === key)?.counties;
      if (sc?.length) t[key].counties = JSON.parse(JSON.stringify(sc));
    }
  }
  return t;
}

function blankCandidate(c) {
  return { ...c, votes: 0, pct: 0, winner: false, leader: false, methods: Object.fromEntries(Object.keys(c.methods || {}).map((k) => [k, 0])) };
}

// ---------------- Pine Plains ----------------
function pineRace(tpl, tick, scale, state) {
  const cands = tpl.candidates.map(blankCandidate);
  const by = (n) => cands.find((c) => c.name === n || c.id === n) || null;
  const roush = cands.find((c) => /roush/i.test(c.name));
  const walsh = cands.find((c) => /walsh/i.test(c.name));
  const wri = cands.find((c) => c.writeIn);
  let edDone = 0;
  for (const [bt, method, r, w, o] of PP_BATCHES) {
    if (tick < bt) continue;
    edDone++;
    for (const [c, n] of [[roush, r], [walsh, w], [wri, o]]) {
      if (!c) continue;
      const v = Math.round(n * scale);
      c.votes += v;
      c.methods[method] = (c.methods[method] || 0) + v;
      if (c.lines?.[0]) c.lines[0].votes += v;
    }
  }
  const total = cands.reduce((a, c) => a + c.votes, 0);
  cands.forEach((c) => { c.pct = total ? (c.votes / total) * 100 : 0; });
  cands.sort((a, b) => b.votes - a.votes || Number(a.writeIn) - Number(b.writeIn));
  const called = tick >= PP_CALL_TICK;
  if (total && cands[0].votes !== cands[1].votes) cands[0].leader = true;
  if (called) cands[0].winner = true;
  return {
    ...tpl, candidates: cands, totalVotes: total, ballotsCast: total + (total ? 4 : 0),
    reportingUnits: called ? 1 : 0, eds: (tpl.eds || []).map((e) => ({ ...e, status: called ? 1 : total ? 0 : -1 })),
    callStatus: called ? 'called' : total ? 'counting' : 'waiting', isOfficial: false, updatedAt: iso(),
  };
}

// ---------------- NYT-style statewide with counties ----------------
function nytRace(key, tpl, tick, st) {
  const sc = SCEN[key];
  const raw = clamp((tick - PRE_TICKS) / (PP_CALL_TICK + 4 - PRE_TICKS), 0, 1); // 0..1 across scenario
  const p = tick < PRE_TICKS ? 0 : Math.pow(raw, sc.curve);
  const callTick = PRE_TICKS + 50 + (hash(key) * 8 | 0);
  const called = tick >= callTick;
  const dem = tpl.candidates.find((c) => c.party === 'DEM');
  const gop = tpl.candidates.find((c) => c.party === 'GOP');
  const others = tpl.candidates.filter((c) => c !== dem && c !== gop);
  const demShare = sc.dem - sc.early * Math.pow(1 - p, 2.2);
  const ids = tpl.candidates.map((c) => c.id);
  const prevCounties = st.counties || {};
  const nextCounties = {};
  const counties = (tpl.counties || []).map((co) => {
    // small counties report earlier; each county has its own start offset and lean
    const size = clamp(Math.log10(co.expected + 10) / 6, 0.3, 1);
    const start = (size - 0.3) * 0.2 + hash(co.fips) * 0.05;
    const cp = p === 0 ? 0 : clamp((p * 1.15 - (1 - p) * 0 - start * (1 - p) * 0.9) / 1, 0, 1) * (called ? 1 : 0.97);
    const lean = gauss(co.fips) * 0.07 + (size - 0.6) * 0.12; // bigger counties lean dem
    const d2 = clamp(demShare + lean, 0.12, 0.88);
    const turnout = co.expected * (0.97 + hash(co.fips + 'x') * 0.06);
    const total = Math.round(turnout * cp);
    const otherShare = 0.015 * others.length;
    const major = total * (1 - otherShare);
    const votes = {};
    votes[dem.id] = Math.round(major * d2);
    votes[gop.id] = Math.round(major * (1 - d2));
    others.forEach((c, i) => { votes[c.id] = Math.round(total * 0.015 * (1 + hash(co.fips + c.id) * 0.4)); });
    // monotonic
    const pc = prevCounties[co.fips];
    if (pc) for (const id of ids) votes[id] = Math.max(votes[id], pc[id] || 0);
    nextCounties[co.fips] = votes;
    const tot = ids.reduce((a, id) => a + votes[id], 0);
    return { ...co, votes, total: tot, eevp: Math.round(cp * 95 * 10) / 10 };
  });
  st.counties = nextCounties;
  const candVotes = Object.fromEntries(ids.map((id) => [id, counties.reduce((a, c) => a + (c.votes[id] || 0), 0)]));
  const total = ids.reduce((a, id) => a + candVotes[id], 0);
  const eevp = total === 0 ? 0 : Math.round((called ? 96 + hash(key + 'e') * 2.5 : Math.min(total / (tpl.expectedVote || 1) * 100, 95)) * 10) / 10;
  const demV = candVotes[dem.id], gopV = candVotes[gop.id];
  const marginPct = total ? (demV - gopV) / total * 100 : 0;
  // win prob drifts with margin and certainty (eevp)
  const certainty = clamp(eevp / 100, 0, 1);
  let demWin = total ? 1 / (1 + Math.exp(-(marginPct / 100) * (6 + 70 * certainty * certainty))) : (tpl.candidates.find((c) => c.id === dem.id)?.winProb ?? 0.55);
  if (called) demWin = demV > gopV ? 1 : 0;
  const cands = tpl.candidates.map((c) => {
    const votes = candVotes[c.id];
    const wp = c === dem ? demWin : c === gop ? 1 - demWin : 0;
    return {
      ...blankCandidate(c), votes, pct: total ? (votes / total) * 100 : 0,
      methods: { ...Object.fromEntries(Object.keys(c.methods || { total: 0 }).map((k) => [k, 0])), total: votes },
      winProb: total || c.winProb != null || true ? Math.round(wp * 10000) / 10000 : null,
      shareRemaining: null, quantiles: c.quantiles ?? null,
    };
  });
  cands.sort((a, b) => b.votes - a.votes || (b.winProb || 0) - (a.winProb || 0));
  if (total) cands[0].leader = true;
  if (called) cands[0].winner = true;
  const expected = tpl.expectedVote || 1;
  const remaining = Math.max(0, Math.round(expected - total));
  return {
    ...tpl, candidates: cands, counties, totalVotes: total, eevp, eevpMax: 99,
    precinctsReporting: Math.round((tpl.precinctsTotal || 0) * (eevp / 100)),
    callStatus: called ? 'called' : total ? 'counting' : 'waiting', calledBy: called ? 'AP' : tpl.calledBy ?? null,
    model: { status: total ? 'active' : 'inactive', votesRemaining: remaining, votesEstimated: Math.max(total, Math.round(expected)) },
    updatedAt: iso(),
  };
}

export function startSim(store) {
  let templates = null, tick = 0;
  const state = {};
  const waitStart = Date.now();

  const begin = () => {
    store.setSim(true);
    L.event({ type: 'sim', text: 'SIM MODE ACTIVE', keys: Object.keys(templates) });
    console.log('[sim] started; loop every', (LOOP_TICKS * TICK_MS) / 1000, 's');
    let scale = 1;
    const reset = () => {
      tick = 0;
      for (const k of Object.keys(state)) delete state[k];
      // randomize Pine Plains turnout around ~1100 total
      const base = PP_BATCHES.reduce((a, b) => a + b[2] + b[3] + b[4], 0);
      scale = (1080 + Math.random() * 50) / base;
    };
    reset();
    const step = () => {
      if (tick >= LOOP_TICKS) reset();
      try {
        for (const key of Object.keys(templates)) {
          const st = (state[key] ||= {});
          const race = key === 'pineplains' ? pineRace(templates[key], tick, scale, st) : nytRace(key, templates[key], tick, st);
          store.simUpdateRace(key, race);
        }
        if (tick === 1) store.pushEvent({ type: 'polls', priority: 3, text: 'POLLS NOW CLOSED: MI · TX · IA · NY', sub: 'SIM - first results expected shortly', states: ['MI', 'TX', 'IA', 'NY'] });
        if (tick === PRE_TICKS + 1) store.pushEvent({ type: 'boe', priority: 2, text: 'DUTCHESS COUNTY BOE POSTS NEW RESULTS', sub: 'SIM - early voting totals published' });
        if (tick === PRE_TICKS + 33) store.pushEvent({ type: 'boe', priority: 2, text: 'DUTCHESS COUNTY BOE POSTS NEW RESULTS', sub: 'SIM - election day ED totals published' });
        if (tick === PRE_TICKS + 51) store.pushEvent({ type: 'boe', priority: 2, text: 'DUTCHESS COUNTY BOE POSTS NEW RESULTS', sub: 'SIM - absentee totals published' });
      } catch (e) { L.error({ src: 'sim', msg: String(e?.stack || e) }); }
      tick++;
    };
    step();
    setInterval(step, TICK_MS);
  };

  const tryStart = () => {
    templates = loadTemplates(store);
    const have = ['mi-sen', 'tx-sen', 'ia-gov'].every((k) => templates[k]);
    const live = ['mi-sen', 'tx-sen', 'ia-gov'].every((k) => store.getWatch(k)) && store.getWatch('pineplains');
    if (templates.pineplains && have && (live || Date.now() - waitStart > 20_000)) return begin();
    if (Date.now() - waitStart > 60_000) { console.error('[sim] templates unavailable:', Object.keys(templates)); if (Object.keys(templates).length) return begin(); }
    setTimeout(tryStart, 1000);
  };
  tryStart();
}
