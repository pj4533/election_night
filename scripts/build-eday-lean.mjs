// Election-Day vs early/absentee partisan split per hometown ED, from past elections (Enhanced Voting breakdowns).
// Used to judge whether the trailing candidate can still catch up with the Election Day vote still out.
import fs from 'node:fs';
const B = 'https://app.enhancedvoting.com/results/public/api/elections/dutchess-county-ny';
const EDS = ['Pine Plains ED 1', 'Stanford ED 1', 'Stanford ED 2'];
const T = (a) => (Array.isArray(a) ? (a.find((x) => x.languageId === 'en') || a[0])?.text : a || '').trim();
const norm = (s) => s.replace(/^Town of /, '').replace(/\*ED /, ' ED ').replace(/\*$/, '').replace(/\s+/g, ' ').trim();
const PARTY = { Dem: 'DEM', DEM: 'DEM', Rep: 'GOP', REP: 'GOP' };
const out = {};
for (const [year, id, match] of [['2024', 'ge24', /President/i], ['2025', 'GE25', /Comptroller/i]]) {
  const d = await (await fetch(`${B}/${id}/data`)).json();
  const item = d.ballotItems.find((b) => match.test(T(b.name)));
  if (!item) { console.log('no contest', year); continue; }
  const bi = await (await fetch(`${B}/${id}/data/ballot-item/${item.id}`)).json();
  for (const row of bi.ballotItemWithBreakdown?.breakdownResults || []) {
    const ed = norm(T(row.precinct?.name));
    if (!EDS.includes(ed)) continue;
    const by = {}; // method -> {DEM, GOP}
    for (const o of row.ballotOptions || []) {
      const p = PARTY[o.party?.abbreviation?.trim()]; if (!p) continue;
      for (const g of o.groupResults || []) {
        const m = /election day/i.test(T(g.groupName)) ? 'eday' : 'other';
        (by[m] ||= { DEM: 0, GOP: 0 })[p] += g.voteCount || 0;
      }
    }
    const share = (x) => (x && x.DEM + x.GOP ? Math.round((1000 * x.DEM) / (x.DEM + x.GOP)) / 10 : null);
    (out[ed] ||= {})[year] = { contest: T(item.name), edayDem: share(by.eday), otherDem: share(by.other), eday: by.eday, other: by.other };
  }
}
fs.writeFileSync('public/geo/hometown-eday.json', JSON.stringify({ generatedAt: new Date().toISOString(), eds: out }, null, 1));
console.log(JSON.stringify(out, null, 1));
