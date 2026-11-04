// Dutchess County BOE via Enhanced Voting public JSON.
// Strategy: poll tiny cache-busted meta every 15s; when publishVersionId/asOf changes (or every 5min), pull full /data.
import fs from 'node:fs';
import { DUTCHESS, WATCH, DUTCHESS_TICKER } from '../config.mjs';
import { get } from '../http.mjs';
import * as L from '../log.mjs';

const txt = (arr) => (Array.isArray(arr) ? (arr.find((x) => x.languageId === 'en') || arr[0])?.text?.trim() : arr) || '';
const PARTY = { Dem: 'DEM', Rep: 'GOP', Con: 'CON', WFP: 'WFP', WOR: 'WFP', Wor: 'WFP' };

// The Enhanced Voting CDN (Akamai) ignores query strings in its cache key, so '?_=ts' does NOT bust it
// (we measured 48s detection lag). The origin is case-insensitive but the cache key is case-sensitive,
// so a randomly-cased path is a guaranteed cache MISS = fresh origin data every poll.
const randCase = (s) => s.replace(/[a-z]/gi, (c) => (Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase()));
const freshUrl = (suffix = '') => DUTCHESS.base.replace('/dutchess-county-ny/GE2026', `/${randCase('dutchess-county-ny')}/${randCase('GE2026')}`) + suffix;

export function createDutchess(store) {
  let lastVersion = null;
  let lastAsOf = null;
  let lastFull = 0;
  let lastVersionSeen = null;
  let newestPub = 0;
  let timer;
  const DD = process.env.DATA_DIR || (process.env.SIM === '1' ? 'data-sim' : 'data');
  fs.mkdirSync(`${DD}/raw`, { recursive: true });

  async function tick() {
    const t = Date.now();
    const r = await get('dutchess', freshUrl(), { label: 'meta' });
    if (r.body) {
      const m = r.body;
      const version = m.publishVersionId;
      const asOf = m.asOf;
      // The BOE origin has multiple replicas that disagree for a while after a publish (we saw 9:03 and 8:13
      // versions alternating). NEVER go backwards: only accept a publish strictly newer than the newest seen.
      const pubT = Date.parse(m.publishDate || asOf) || 0;
      if (pubT && pubT < newestPub) {
        L.poll({ src: 'dutchess', label: 'meta-stale-replica', version, publishDate: m.publishDate, newest: new Date(newestPub).toISOString() });
        store.setSourceStatus('dutchess', { ok: true, lastPoll: t });
        return;
      }
      const changed = version !== lastVersion || asOf !== lastAsOf;
      L.poll({
        src: 'dutchess', label: 'meta', status: r.status, ms: r.ms, bytes: r.bytes, cache: r.cache, changed,
        version, asOf, lastUpdated: m.lastUpdated, publishDate: m.publishDate, nextUpdateAt: m.nextUpdateAt,
        isOfficial: m.isOfficialResults, ballotsCast: m.ballotsCast, precinctsReporting: m.precinctsReporting,
        lagSec: asOf ? Math.round((t - Date.parse(asOf)) / 1000) : null,
      });
      store.setSourceStatus('dutchess', {
        ok: true, lastPoll: t, asOf, publishDate: m.publishDate, version, nextUpdateAt: m.nextUpdateAt,
        ballotsCast: m.ballotsCast, precinctsReporting: m.precinctsReporting, isOfficial: m.isOfficialResults,
      });
      if (changed || t - lastFull > DUTCHESS.fullRefreshMs) {
        const prevVersion = lastVersion;
        const ok = await full(t, version);
        // announce once, only after the new data was actually accepted (retries used to re-announce every 5s)
        if (ok && changed && prevVersion && version !== prevVersion) {
          L.event({ type: 'dutchess-publish', version, asOf, prevVersion, detectLagSec: Math.round((t - Date.parse(m.publishDate || asOf)) / 1000) });
          store.pushEvent({ type: 'boe', priority: 2, text: 'DUTCHESS COUNTY BOE POSTS NEW RESULTS', sub: `Published ${new Date(m.publishDate || asOf).toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET` });
        }
        if (ok) { lastVersion = version; lastAsOf = asOf; lastFull = t; newestPub = Math.max(newestPub, pubT); }
      }
    } else {
      store.setSourceStatus('dutchess', { ok: false, lastPoll: t, error: r.error });
    }
  }

  async function full(t, version) {
    const r = await get('dutchess', freshUrl('/data'), { label: 'data', timeoutMs: 30_000 });
    if (!r.body) return false;
    const d = r.body;
    const dPub = Date.parse(d.election?.publishDate || d.election?.asOf) || 0;
    if (dPub && dPub < newestPub) { L.poll({ src: 'dutchess', label: 'data-stale-replica', version: d.election?.publishVersionId }); return false; }
    if (version && d.election?.publishVersionId && d.election.publishVersionId !== version) { L.poll({ src: 'dutchess', label: 'data-version-mismatch', want: version, got: d.election.publishVersionId }); return false; }
    lastVersionSeen = d.election?.publishVersionId || version;
    L.poll({ src: 'dutchess', label: 'data', status: r.status, ms: r.ms, bytes: r.bytes, version, asOf: d.election?.asOf });
    try { fs.writeFileSync(`${DD}/raw/dutchess-latest.json`, JSON.stringify(d)); } catch {}
    if (version && version !== lastVersion) {
      try { fs.writeFileSync(`${DD}/raw/dutchess-${version}.json`, JSON.stringify(d)); } catch {}
    }
    const items = d.ballotItems || [];
    const byName = new Map(items.map((b) => [txt(b.name), b]));
    const precincts = d.precincts || [];

    for (const w of WATCH.filter((w) => w.kind === 'dutchess')) {
      const b = byName.get(w.contest);
      if (!b) { L.error({ src: 'dutchess', msg: `contest not found: ${w.contest}` }); continue; }
      const town = w.town || w.contest.split(' Town ')[0];
      const eds = precincts.filter((p) => txt(p.name).startsWith(town + ' ED'));
      const race = normalize(b, w, d, eds);
      race.edResults = await edBreakdown(b.id, w.key);
      race.reporting = reportingFor(d, town, eds, race);
      store.updateRace(w.key, race);
    }
    const ticker = [];
    for (const [name, label] of DUTCHESS_TICKER) {
      const b = byName.get(name);
      if (!b) continue;
      const r = normalize(b, { key: name, title: name }, d, []);
      // skip uncontested races (user: "nobody cares"); keep ballot measures (Yes/No)
      const real = r.candidates.filter((c) => !c.writeIn && c.party !== 'WRI');
      if (real.length < 2) continue;
      ticker.push({ label, ...r });
    }
    store.setDutchessTicker(ticker);
    return true;
  }

  // Per-election-district returns for one contest (Enhanced Voting ballot-item breakdown).
  // Fusion lines summed per candidate; vote methods kept. Cached per (version) so we only refetch on publish.
  const edCache = new Map();
  async function edBreakdown(ballotItemId, key) {
    const ck = `${key}|${lastVersionSeen}`;
    if (edCache.has(ck)) return edCache.get(ck);
    const r = await get('dutchess', freshUrl(`/data/ballot-item/${ballotItemId}`), { label: `eds:${key}`, timeoutMs: 30_000 });
    const br = r.body?.ballotItemWithBreakdown?.breakdownResults;
    if (!Array.isArray(br)) return edCache.get([...edCache.keys()].reverse().find((k) => k.startsWith(key + '|'))) || null;
    const out = br.map((row) => {
      const cands = new Map();
      for (const o of row.ballotOptions || []) {
        const name = txt(o.name);
        const c = cands.get(name) || { name, party: null, votes: 0, methods: {}, writeIn: !!o.isWriteIn };
        const abbr = o.party?.abbreviation?.trim();
        if (!c.party && PARTY[abbr]) c.party = PARTY[abbr];
        c.votes += o.voteCount || 0;
        for (const g of o.groupResults || []) c.methods[txt(g.groupName)] = (c.methods[txt(g.groupName)] || 0) + (g.voteCount || 0);
        cands.set(name, c);
      }
      const list = [...cands.values()].map((c) => ({ ...c, party: c.party || (c.writeIn ? 'WRI' : 'OTH') }));
      const total = list.reduce((a, c) => a + c.votes, 0);
      list.forEach((c) => (c.pct = total ? (100 * c.votes) / total : 0));
      list.sort((a, b2) => b2.votes - a.votes);
      return { name: txt(row.precinct?.name), status: row.precinct?.reportingStatus, total, candidates: list };
    });
    out.sort((a, b2) => a.name.localeCompare(b2.name, 'en', { numeric: true }));
    edCache.set(ck, out);
    L.poll({ src: 'dutchess', label: `eds:${key}`, status: r.status, ms: r.ms, eds: out.map((e) => `${e.name}:${e.total}`).join(' ') });
    return out;
  }

  // What has been counted, from the BOE's own status fields:
  //  - election.groupReportingStatus: per vote type (Early / Absentee / Election Day / Affidavit), county-wide
  //  - pollingPlaces[]: Election Day scanners (tabulatorCount / tabulatorsReporting) at the town's polling place
  //  - precinct.reportingStatus per ED (1 = none, 2 = partial, 3+ = complete; inferred)
  //  - data/hometown-baseline.json (optional): past turnout per ED → expected total / votes left (estimate)
  const STATUS = {
    'reporting-status-not-reported': 'not', 'reporting-status-partially-reported': 'partial',
    'reporting-status-fully-reported': 'full', 'reporting-status-election-night-complete': 'night',
  };
  function reportingFor(d, town, eds, race) {
    const groups = (d.election?.groupReportingStatus || []).map((g) => ({
      name: txt(g.groupName), status: STATUS[g.reportingStatusClientTextKey] || g.reportingStatusClientTextKey,
    }));
    const pp = (d.pollingPlaces || []).filter((p) => txt(p.name).toLowerCase().startsWith(town.toLowerCase()))
      .map((p) => ({ name: txt(p.name), status: p.reportingStatus, scanners: p.tabulatorCount, scannersReporting: p.tabulatorsReporting }));
    const methods = {};
    for (const c of race.candidates) for (const [k, v] of Object.entries(c.methods || {})) methods[k] = (methods[k] || 0) + v;
    let baseline = null;
    try {
      const B = JSON.parse(fs.readFileSync('data/hometown-baseline.json', 'utf8'));
      baseline = Object.fromEntries(eds.map((p) => [txt(p.name), B.eds?.[txt(p.name)] || null]));
    } catch {}
    return {
      groups, pollingPlaces: pp, methods,
      eds: eds.map((p) => ({ name: txt(p.name), status: p.reportingStatus })),
      baseline,
    };
  }

  function normalize(b, w, d, eds) {
    // Fusion voting: sum each candidate across party lines.
    const cands = new Map();
    for (const o of b.summaryResults?.ballotOptions || []) {
      const name = txt(o.name);
      const abbr = o.party?.abbreviation?.trim();
      const c = cands.get(name) || { id: name, name, party: null, color: o.party?.color, votes: 0, lines: [], methods: {}, writeIn: o.isWriteIn, winner: false };
      if (!c.party && PARTY[abbr]) { c.party = PARTY[abbr]; c.color = o.party.color; }
      c.votes += o.voteCount || 0;
      c.lines.push({ party: abbr, votes: o.voteCount || 0 });
      for (const g of o.groupResults || []) c.methods[txt(g.groupName)] = (c.methods[txt(g.groupName)] || 0) + (g.voteCount || 0);
      if (o.isWinner) c.winner = true;
      cands.set(name, c);
    }
    const list = [...cands.values()].map((c) => ({ ...c, party: c.party || (c.writeIn ? 'WRI' : 'OTH') }));
    const total = list.reduce((s, c) => s + c.votes, 0);
    list.forEach((c) => (c.pct = total ? (100 * c.votes) / total : 0));
    list.sort((a, b2) => b2.votes - a.votes || (a.writeIn ? 1 : -1));
    const rs = b.reportingStatus || {};
    return {
      key: w.key, kind: 'dutchess', title: w.title, short: w.short, place: w.place, friend: w.friend,
      source: 'Dutchess County BOE (Enhanced Voting)',
      candidates: list, totalVotes: total,
      reportingUnits: rs.reportingUnits, totalUnits: eds.length || rs.totalUnits || null, reportingEds: eds.filter((p) => p.status > 1).length,
      eds: eds.map((p) => ({ name: txt(p.name), status: p.reportingStatus })),
      updatedAt: total ? (rs.asOf || d.election?.asOf) : null, // pre-election placeholder asOf (Oct 27) is meaningless
      boeAsOf: rs.asOf || d.election?.asOf, isOfficial: d.election?.isOfficialResults,
      pollClose: w.pollClose, callStatus: list.some((c) => c.winner) ? 'called' : total ? 'counting' : 'waiting',
      ballotsCast: d.election?.ballotsCast,
    };
  }

  return {
    start() { tick(); timer = setInterval(tick, DUTCHESS.metaIntervalMs); },
    stop() { clearInterval(timer); },
  };
}
