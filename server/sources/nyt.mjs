// NYT election results JSON (AP-sourced). National Senate/Governor files every 10s (ETag),
// state files (county-level) for watched + spotlight states every 20s.
import { NYT_BASE, NYT, WATCH, STATE_SLUGS } from '../config.mjs';
import { get } from '../http.mjs';
import * as L from '../log.mjs';

// "A rural county where Donald Trump won by 42 pts. in 2024." -> Dem margin -42 (NYT demographicSentences)
export function lean2024(sentences) {
  const out = {};
  for (const x of sentences || []) {
    const m = /(Kamala Harris|Donald Trump) won (?:here )?by (less than 1|[\d.]+) pts?\. in 2024/.exec(x.string_value || '');
    if (!m) continue;
    const n = m[2] === 'less than 1' ? 0.5 : Number(m[2]);
    out[x.nyt_reporting_unit_id] = m[1] === 'Kamala Harris' ? n : -n;
  }
  return out;
}

// Race-level "what to watch" facts derived from the county rows + NYT model.
function raceStory({ cands, counties, tru, pa, pb }) {
  const total = cands.reduce((s, c) => s + c.votes, 0);
  const me = tru.nyt_model_estimates || {};
  const remaining = me.votes_remaining ?? Math.max(0, (tru.total_expected_vote || 0) - (tru.total_votes || total));
  const left = counties.filter((c) => c.remaining > 0).sort((a, b) => b.remaining - a.remaining).slice(0, 3)
    .map((c) => ({ name: c.name, eevp: Math.round(c.eevp), remaining: c.remaining, l24: c.l24 }));
  let need = null;
  const [L, T] = cands;
  if (L && T && total && remaining > 0 && L.votes > T.votes) {
    const gap = L.votes - T.votes;
    need = { trail: T.last, party: T.party, lead: L.last, gap, remaining, pct: Math.round(1000 * (1 + gap / remaining) / 2) / 10, model: T.shareRemaining ?? null };
  }
  let swing = null;
  if (pa && pb && pa.party === 'DEM') {
    // only MOSTLY-COUNTED counties: partial counts skew toward whichever vote type is counted first (overstated swing)
    const minEevp = 75;
    const sw = counties.filter((c) => c.l24 != null && c.m != null && c.eevp >= minEevp && c.total >= 300).map((c) => ({ name: c.name, d: Math.round(c.m - c.l24), eevp: Math.round(c.eevp) }));
    if (sw.length) {
      const big = sw.reduce((a, b) => (Math.abs(b.d) > Math.abs(a.d) ? b : a));
      if (sw.length >= 5) swing = { n: sw.length, bluer: sw.filter((x) => x.d > 0).length, redder: sw.filter((x) => x.d < 0).length, big };
    }
  }
  let model = null;
  const qa = L?.quantiles, qb = T?.quantiles;
  if (qa?.length >= 3 && qb?.length >= 3) model = { lead: L.last, party: L.party, trail: T.last, margin: Math.round(1000 * (qa[2] - qb[2])) / 10 };
  return { left, need, swing, model, remaining };
}

export function normalizeNytRace(r, w = {}, lean = null) {
  const tru = r.top_reporting_unit || {};
  const meta = r.candidate_metadata || {};
  const won = new Set(r.outcome?.won || []);
  const cands = (tru.candidates || []).map((c) => {
    const m = meta[c.nyt_id] || {};
    return {
      id: c.nyt_id,
      name: [m.first_name, m.last_name].filter(Boolean).join(' ') || c.nyt_id,
      last: m.last_name || c.nyt_id,
      party: m.party?.nyt_id || 'OTH',
      incumbent: !!m.incumbent,
      img: m.img_url,
      votes: c.votes?.total || 0,
      methods: c.votes || {},
      winProb: c.nyt_model_estimates?.win_probability ?? null,
      shareRemaining: c.nyt_model_estimates?.share_remaining ?? null,
      quantiles: c.nyt_model_estimates?.voteshare_quantile ?? null,
      leader: !!c.leader,
      winner: won.has(c.nyt_id),
    };
  });
  const total = cands.reduce((s, c) => s + c.votes, 0);
  cands.forEach((c) => (c.pct = total ? (100 * c.votes) / total : 0));
  cands.sort((a, b) => b.votes - a.votes || (b.winProb || 0) - (a.winProb || 0));
  // keep the payload small: only the top-2 candidates' votes per county
  const top2 = cands.slice(0, 2);
  const dem = top2.find((c) => c.party === 'DEM'), gop = top2.find((c) => c.party === 'GOP');
  const [pa, pb] = dem && gop ? [dem, gop] : top2; // signed margin: + = DEM (or top candidate)
  const counties = (r.reporting_units || [])
    .filter((u) => u.level === 'county' || u.level === 'township')
    .map((u) => {
      const v = {};
      for (const c of u.candidates || []) if (top2.some((t) => t.id === c.nyt_id)) v[c.nyt_id] = c.votes?.total || 0;
      const total = u.total_votes || 0, expected = u.total_expected_vote || 0;
      const me = u.nyt_model_estimates || {};
      const est = me.votes_remaining != null ? total + me.votes_remaining : me.votes_estimated;
      const remaining = Math.max(0, Math.round(est && est > 0 ? est - total : expected - total));
      const fips = (u.fips_state || '') + (u.fips_county || '');
      const m = total && pa && pb ? Math.round(1000 * ((v[pa.id] || 0) - (v[pb.id] || 0)) / total) / 10 : null;
      const l24 = lean?.[u.nyt_id] ?? lean?.[fips] ?? null;
      return { fips, name: u.name, level: u.level, eevp: u.eevp || 0, total, expected, remaining, m, l24, votes: v };
    });
  const story = counties.length ? raceStory({ cands, counties, tru, pa, pb }) : null;
  return {
    key: w.key || r.nyt_id, kind: 'nyt', nytId: r.nyt_id, title: w.title || `${tru.name} ${r.office}`,
    short: w.short || `${tru.state_postal || ''} ${r.office_id === 'S' ? 'SEN' : r.office_id === 'G' ? 'GOV' : r.office}`,
    state: tru.state_postal, stateName: tru.name, office: r.office, officeId: r.office_id,
    rating: r.rating, callStatus: r.race_call_status, calledBy: r.outcome?.called_by || [],
    gained: r.outcome?.gained || null,
    winnerAcceptedAt: (r.outcome?.winner_accepted_at || []).map((t) => Date.parse(t)).filter(Boolean).sort().pop() || null,
    inPartyControl: r.in_party_control,
    description: r.long_description, source: 'AP via NYT',
    candidates: cands, totalVotes: total, eevp: tru.eevp || 0, eevpMax: tru.eevp_max,
    expectedVote: tru.total_expected_vote, precinctsReporting: tru.precincts_reporting, precinctsTotal: tru.precincts_total,
    updatedAt: tru.provider_updated_at || r.updated_at,
    model: tru.nyt_model_estimates ? {
      status: r.model_settings?.model_status, votesRemaining: tru.nyt_model_estimates.votes_remaining,
      votesEstimated: tru.nyt_model_estimates.votes_estimated,
    } : null,
    history2024: tru.historical_comparison_race_data ? Object.values(tru.historical_comparison_race_data)[0] : null,
    counties: counties.length ? counties : undefined, story,
    focus: w.focus, kalshi: w.kalshi,
  };
}

export function createNyt(store) {
  const timers = [];
  const lastUpdatedNational = {};

  async function national(file) {
    const url = `${NYT_BASE}/results-${file}.json`;
    const r = await get('nyt', url, { etag: true, label: file, timeoutMs: 20_000 });
    const t = Date.now();
    if (r.notModified) { store.setSourceStatus('nyt', { ok: true, lastPoll: t }); return; }
    if (!r.body) { store.setSourceStatus('nyt', { ok: false, lastPoll: t, error: r.error }); return; }
    const d = r.body;
    const resultsUpdatedAt = d.resultsMeta?.resultsUpdatedAt;
    L.poll({
      src: 'nyt', label: file, status: r.status, ms: r.ms, bytes: r.bytes, changed: true, resultsUpdatedAt,
      lastModified: r.lastModified, lagSec: resultsUpdatedAt ? Math.round((t - Date.parse(resultsUpdatedAt)) / 1000) : null,
      races: d.races?.length,
    });
    lastUpdatedNational[file] = resultsUpdatedAt;
    store.setSourceStatus('nyt', { ok: true, lastPoll: t, lastChange: t, resultsUpdatedAt });
    const races = (d.races || []).map((race) => {
      const w = WATCH.find((x) => x.nytId === race.nyt_id);
      return normalizeNytRace(race, w);
    });
    store.updateNationalRaces(file, races);
    if (d.partyControlData?.results?.[0]?.offices) store.updatePartyControl(d.partyControlData.results[0].offices);
    if (d.pollClosingTimes) store.setPollClosings(d.pollClosingTimes);
    if (d.raceInsights) store.addInsights(d.raceInsights);
  }

  async function stateFile(postal) {
    const slug = STATE_SLUGS[postal];
    if (!slug) return;
    const url = `${NYT_BASE}/results-${slug}.json`;
    const r = await get('nyt', url, { etag: true, label: `state:${slug}`, timeoutMs: 30_000 });
    if (!r.body) return;
    const d = r.body;
    L.poll({ src: 'nyt', label: `state:${slug}`, status: r.status, ms: r.ms, bytes: r.bytes, changed: true, resultsUpdatedAt: d.resultsMeta?.resultsUpdatedAt });
    const lean = lean2024(d.demographicSentences);
    for (const race of d.races || []) {
      // we want county units for Senate/Governor races in this state
      if (!['S', 'G'].includes(race.office_id) || race.race_type_id !== 'G') continue;
      const w = WATCH.find((x) => x.nytId === race.nyt_id);
      store.updateCountyRace(normalizeNytRace(race, w, lean));
    }
    if (d.raceInsights) store.addInsights(d.raceInsights);
  }

  function statesToPoll() {
    const s = new Set(WATCH.filter((w) => w.state).map((w) => w.state));
    s.add('NY');
    for (const st of store.spotlightStates()) s.add(st);
    return [...s];
  }

  let stateIdx = 0;
  async function stateTick() {
    // stagger: one state file every (interval / n) so we never burst
    const states = statesToPoll();
    const st = states[stateIdx++ % states.length];
    await stateFile(st);
  }

  return {
    start() {
      for (const f of NYT.nationalFiles) {
        national(f);
        timers.push(setInterval(() => national(f), NYT.nationalIntervalMs));
      }
      const per = Math.max(3000, Math.floor(NYT.stateIntervalMs / 5));
      stateTick();
      timers.push(setInterval(stateTick, per));
    },
    stop() { timers.forEach(clearInterval); },
  };
}
