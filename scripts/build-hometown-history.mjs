#!/usr/bin/env node
// Hometown history: per ED turnout + method split + D-vs-R baselines for GE23/GE24/GE25.
// Usage: node scripts/build-hometown-history.mjs  -> data/hometown-history.json + public/geo/hometown-history.json
import { writeFileSync } from 'node:fs';
const API = 'https://app.enhancedvoting.com/results/public/api/elections/dutchess-county-ny';
const EDS = ['Pine Plains ED 1', 'Stanford ED 1', 'Stanford ED 2'];
// [year, electionId, contest name, short label, role]
const CONTESTS = [
  [2024, 'ge24', 'President of the United States of America', 'President', 'pres'],
  [2024, 'ge24', 'United States Senator', 'US Senate', 'base'],
  [2024, 'ge24', 'Representative in Congress- 17th Congressional District', 'Congress', 'base'],
  [2024, 'ge24', 'Representative in Congress- 18th Congressional District', 'Congress', 'base'],
  [2025, 'GE25', 'Comptroller', 'Comptroller', 'base'],
  [2025, 'GE25', 'Pine Plains Town Supervisor', 'Town Supervisor', 'town'],
  [2025, 'GE25', 'Stanford Town Supervisor', 'Town Supervisor', 'town'],
  [2023, 'GE23', 'County Executive', 'County Exec', 'base'],
  [2023, 'GE23', 'County Clerk', 'County Clerk', 'base'],
  [2023, 'GE23', 'Pine Plains Town Supervisor', 'Town Supervisor', 'town'],
  [2023, 'GE23', 'Stanford Town Supervisor', 'Town Supervisor', 'town'],
];
const PARTY = { Dem: 'DEM', DEM: 'DEM', D: 'DEM', Rep: 'GOP', REP: 'GOP', R: 'GOP', GOP: 'GOP' };
const txt = (v) => (Array.isArray(v) ? v[0]?.text : v) ?? '';
const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
const edName = (n) => { const m = /(Pine Plains|Stanford).*?ED\s*(\d+)/i.exec(n); return m ? `${m[1]} ED ${+m[2]}` : null; };

function summarize(row) {
  const cands = new Map();
  for (const o of row.ballotOptions || []) {
    const name = txt(o.name).trim();
    const c = cands.get(name) || { name, party: null, votes: 0, methods: {} };
    const ab = (o.party?.abbreviation || '').trim();
    if (!c.party && PARTY[ab]) c.party = PARTY[ab];
    c.votes += o.voteCount || 0;
    for (const g of o.groupResults || []) c.methods[txt(g.groupName)] = (c.methods[txt(g.groupName)] || 0) + (g.voteCount || 0);
    cands.set(name, c);
  }
  const list = [...cands.values()];
  const total = list.reduce((a, c) => a + c.votes, 0);
  const methods = {};
  for (const c of list) for (const [k, v] of Object.entries(c.methods)) methods[k] = (methods[k] || 0) + v;
  return { total, methods: Object.keys(methods).length ? methods : null,
    candidates: list.sort((a, b) => b.votes - a.votes).map((c) => ({ name: c.name, party: c.party || 'OTH', votes: c.votes, pct: total ? +(100 * c.votes / total).toFixed(1) : 0 })) };
}

const out = { generatedAt: new Date().toISOString(), note: 'pct = share of all votes cast in contest in that ED (fusion lines summed). dem/gop = two-party view precomputed.', eds: {} };
for (const e of EDS) out.eds[e] = { turnout: {}, contests: [] };
const cache = {};
for (const [year, eid, cname, label, role] of CONTESTS) {
  try {
    const data = (cache[eid] ||= await j(`${API}/${eid}/data`));
    const b = data.ballotItems.find((x) => txt(x.name).trim() === cname);
    if (!b) { console.log('missing', eid, cname); continue; }
    const d = await j(`${API}/${eid}/data/ballot-item/${b.id}`);
    for (const row of d.ballotItemWithBreakdown?.breakdownResults || []) {
      const ed = edName(txt(row.precinct?.name));
      if (!ed || !out.eds[ed]) continue;
      const s = summarize(row);
      if (!s.total) continue;
      if (role === 'pres') out.eds[ed].turnout[year] = { contest: cname, total: s.total, methods: s.methods };
      const D = s.candidates.find((c) => c.party === 'DEM'), R = s.candidates.find((c) => c.party === 'GOP');
      if (!D || !R) { if (role === 'town') continue; }
      out.eds[ed].contests.push({ year, label, role, contest: cname, total: s.total, dem: D || null, gop: R || null,
        demTwoParty: D && R ? +(100 * D.votes / (D.votes + R.votes)).toFixed(1) : null, candidates: s.candidates.slice(0, 4) });
    }
  } catch (e) { console.log('ERR', cname, e.message); }
}
// turnout for 2025 / 2023 come from the existing baseline (statewide proposal / county exec) so every year is covered
try {
  const base = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/hometown-baseline.json', import.meta.url), 'utf8'));
  for (const e of EDS) for (const y of ['2025', '2024', '2023']) if (base.eds?.[e]?.[y]) out.eds[e].turnout[y] = base.eds[e][y];
} catch (e) { console.log('baseline', e.message); }
const s = JSON.stringify(out, null, 1);
writeFileSync(new URL('../data/hometown-history.json', import.meta.url), s);
writeFileSync(new URL('../public/geo/hometown-history.json', import.meta.url), s);
for (const e of EDS) console.log(e, Object.keys(out.eds[e].turnout), out.eds[e].contests.map((c) => `${c.year} ${c.label} D${c.dem?.pct}/R${c.gop?.pct}`).join(' | '));
