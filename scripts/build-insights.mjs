#!/usr/bin/env node
// Hometown insights data dig: per-ED (all Dutchess EDs) turnout/early vote/partisan lean by vote method, GE23..GE2026,
// plus past town races. Output: public/geo/hometown-insights.json (static facts; the browser adds LIVE insights).
// Usage: node scripts/build-insights.mjs
import { writeFileSync } from 'node:fs';
const API = 'https://app.enhancedvoting.com/results/public/api/elections';
const SLUG = { GE2026: 'DuTchess-County-NY', GE25: 'dutchess-county-ny', ge24: 'dutchess-county-ny', GE23: 'dutchess-county-ny' }; // odd casing busts CDN cache
const txt = (v) => (Array.isArray(v) ? v[0]?.text : v) ?? '';
const j = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
const PARTY = { Dem: 'DEM', DEM: 'DEM', Rep: 'GOP', REP: 'GOP', GOP: 'GOP' };
const normEd = (n) => { n = n.trim().replace(/\*/g, ' '); const m = /^(?:Town of |City of )?(.+?)\s+ED\s*(\d+)/i.exec(n.replace(/\s+/g, ' ')); return m ? `${m[1].trim()} ED ${+m[2]}` : n; };
const isEarly = (k) => k !== 'Election Day';
const cache = {};
async function contest(eid, name) {
  const data = (cache[eid] ||= await j(`${API}/${SLUG[eid]}/${eid}/data`));
  const b = data.ballotItems.find((x) => txt(x.name).trim() === name);
  if (!b) throw new Error('missing ' + eid + ' ' + name);
  const d = await j(`${API}/${SLUG[eid]}/${eid}/data/ballot-item/${b.id}`);
  const eds = {};
  for (const row of d.ballotItemWithBreakdown?.breakdownResults || []) {
    const ed = normEd(txt(row.precinct?.name));
    const c = { total: 0, D: 0, R: 0, eD: 0, eR: 0, early: 0, eday: 0, methods: {}, cands: {} };
    for (const o of row.ballotOptions || []) {
      const p = PARTY[(o.party?.abbreviation || '').trim()];
      const nm = txt(o.name).trim();
      c.cands[nm] = (c.cands[nm] || 0) + (o.voteCount || 0); if (p) (c.party ||= {})[nm] = p;
      c.total += o.voteCount || 0;
      if (p === 'DEM') c.D += o.voteCount || 0; if (p === 'GOP') c.R += o.voteCount || 0;
      for (const g of o.groupResults || []) {
        const k = txt(g.groupName), v = g.voteCount || 0;
        c.methods[k] = (c.methods[k] || 0) + v;
        if (isEarly(k)) { c.early += v; if (p === 'DEM') c.eD += v; if (p === 'GOP') c.eR += v; } else c.eday += v;
      }
    }
    eds[ed] = c;
  }
  return eds;
}
const two = (d, r) => (d + r ? +(100 * d / (d + r)).toFixed(1) : null);
const pct = (a, b) => (b ? +(100 * (a - b) / b).toFixed(0) : null);

const C = {
  gov26: await contest('GE2026', 'Governor/ Lieutenant Governor'),
  pres24: await contest('ge24', 'President of the United States of America'),
  comp25: await contest('GE25', 'Comptroller'),
  prop25: await contest('GE25', 'Statewide Proposal'),
  ce23: await contest('GE23', 'County Executive'),
};
const TOWN = [
  ['GE23', 2023, 'Pine Plains Town Supervisor', 'pineplains'], ['GE25', 2025, 'Pine Plains Town Supervisor', 'pineplains'], ['GE2026', 2026, 'Pine Plains Town Supervisor', 'pineplains'],
  ['GE25', 2025, 'Pine Plains Member of Town Council', 'pineplains'], ['GE23', 2023, 'Pine Plains Member of Town Board', 'pineplains'],
  ['GE23', 2023, 'Stanford Town Supervisor', 'stanford'], ['GE25', 2025, 'Stanford Town Supervisor', 'stanford'], ['GE2026', 2026, 'Stanford Town Supervisor', 'stanford'],
  ['ge24', 2024, 'Town of Stanford Member of Town Board- Unexpired Term', 'stanford'], ['GE25', 2025, 'Stanford Member of Town Council', 'stanford'],
  ['GE2026', 2026, 'Stanford Member of Town Council- Unexpired Term', 'stanford'],
];
const town = [];
for (const [eid, year, name, scope] of TOWN) {
  try {
    const eds = await contest(eid, name);
    const agg = { total: 0, cands: {}, party: {} };
    for (const c of Object.values(eds)) { agg.total += c.total; for (const [k, v] of Object.entries(c.cands)) agg.cands[k] = (agg.cands[k] || 0) + v; Object.assign(agg.party, c.party || {}); }
    const cands = Object.entries(agg.cands).map(([name, votes]) => ({ name, votes, party: agg.party[name] || null })).sort((a, b) => b.votes - a.votes);
    town.push({ year, scope, contest: name, total: agg.total, margin: cands.length > 1 ? cands[0].votes - cands[1].votes : null, cands: cands.slice(0, 5) });
  } catch (e) { console.log('town', e.message); }
}

// per-ED table (2026 only has early/absentee counted so far for most EDs, until Election Day scanners report)
const eds = Object.keys(C.gov26);
const rows = eds.map((ed) => {
  const g = C.gov26[ed], p = C.pres24[ed], c = C.comp25[ed], s = C.prop25[ed], ce = C.ce23[ed];
  return { ed, ev26: g.early, eday26: g.eday, ev25: s?.early ?? null, ev24: p?.early ?? null, tot24: p?.total ?? null, tot25: s?.total ?? null, tot23: ce?.total ?? null,
    evDem26: two(g.eD, g.eR), evDem24: p ? two(p.eD, p.eR) : null, evDem25: c ? two(c.eD, c.eR) : null,
    dem24: p ? two(p.D, p.R) : null, dem25: c ? two(c.D, c.R) : null, edayDem24: p ? two(p.D - p.eD, p.R - p.eR) : null };
});
const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
const county = { eds: rows.length, ev26: sum('ev26'), ev25: sum('ev25'), ev24: sum('ev24'), tot24: sum('tot24'), tot25: sum('tot25'), tot23: sum('tot23'), eday26: sum('eday26') };
// countywide two-party in each method
const ctwo = (cc, early) => { let d = 0, r = 0; for (const c of Object.values(cc)) { d += early ? c.eD : c.D - c.eD; r += early ? c.eR : c.R - c.eR; } return two(d, r); };
county.evDem26 = ctwo(C.gov26, true); county.evDem24 = ctwo(C.pres24, true); county.evDem25 = ctwo(C.comp25, true);
county.edayDem24 = ctwo(C.pres24, false); county.edayDem25 = ctwo(C.comp25, false);
county.dem24 = (() => { let d = 0, r = 0; for (const c of Object.values(C.pres24)) { d += c.D; r += c.R; } return two(d, r); })();
// EDs Trump carried in 2024 overall where Dem leads tonight's early/absentee Governor vote (estimate-ish: method mix)
county.trumpEdsDemEarly = rows.filter((r) => r.dem24 != null && r.dem24 < 50 && r.evDem26 > 50).length;
county.trumpEds = rows.filter((r) => r.dem24 != null && r.dem24 < 50).length;
county.edsDemGainEarly = rows.filter((r) => r.evDem24 != null && r.evDem26 > r.evDem24).length; county.edsMatched24 = rows.filter((r) => r.evDem24 != null).length;
county.evSwingVs24 = +(county.evDem26 - county.evDem24).toFixed(1);
// rankings
const rank = (k, ed) => { const s = rows.filter((r) => r[k] != null && isFinite(r[k])).sort((a, b) => b[k] - a[k]); return { rank: s.findIndex((r) => r.ed === ed) + 1, of: s.length }; };
for (const r of rows) { r.evGrowth25 = r.ev25 ? pct(r.ev26, r.ev25) : null; r.evShare24 = r.tot24 ? +(100 * r.ev26 / r.tot24).toFixed(0) : null; r.evSwing24 = r.evDem24 != null ? +(r.evDem26 - r.evDem24).toFixed(1) : null; }
const HOME = ['Pine Plains ED 1', 'Stanford ED 1', 'Stanford ED 2'];
const home = {};
for (const ed of HOME) {
  const r = rows.find((x) => x.ed === ed);
  home[ed] = { ...r, rankEvGrowth: rank('evGrowth25', ed), rankEvSwing: rank('evSwing24', ed), rankEvShare: rank('evShare24', ed), rankEv: rank('ev26', ed),
    methods24: C.pres24[ed]?.methods, methods25: C.prop25[ed]?.methods, methods26: C.gov26[ed]?.methods };
}
const topSwing = rows.filter((r) => r.evSwing24 != null).sort((a, b) => b.evSwing24 - a.evSwing24).slice(0, 5).map((r) => ({ ed: r.ed, v: r.evSwing24 }));
const topGrowth = rows.filter((r) => r.evGrowth25 != null && r.ev25 > 50).sort((a, b) => b.evGrowth25 - a.evGrowth25).slice(0, 5).map((r) => ({ ed: r.ed, v: r.evGrowth25, ev26: r.ev26, ev25: r.ev25 }));
const out = { generatedAt: new Date().toISOString(), note: 'early = Early Voting + Absentee/EMB (+Affidavit) in each contest. 2026 = Governor contest, unofficial, as of generation. 2025 turnout = Statewide Proposal; 2025 lean = Comptroller; 2024 = President; 2023 = County Executive (no method split). ED names matched by name across years.', county, home, town, topSwing, topGrowth };
writeFileSync(new URL('../public/geo/hometown-insights.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ county, home, topSwing, topGrowth }, null, 1));
for (const t of town) console.log(t.year, t.contest, t.total, t.margin, t.cands.map((c) => c.name + ' ' + c.party + ' ' + c.votes).join(' / '));
