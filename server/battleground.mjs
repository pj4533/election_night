// Control-of-Congress summaries and the "races that matter right now" ranking.
// Pure functions: the store feeds in current state, gets plain objects back.

const PARTY_NAME = { DEM: 'Democrats', GOP: 'Republicans' };
const RATING_LABEL = {
  tossup: 'Toss-up', 'lean-dem': 'Leans Dem', 'lean-rep': 'Leans GOP', 'likely-dem': 'Likely Dem',
  'likely-rep': 'Likely GOP', 'solid-dem': 'Safe Dem', 'solid-rep': 'Safe GOP',
};
const RATING_W = { tossup: 1, lean: 0.8, likely: 0.4, solid: 0.05 };
const OFFICE_W = { S: 1, H: 0.6, G: 0.4 };
const FRESH_CALL_MS = 6 * 60_000;

const ratingW = (r) => (!r ? 0.3 : r === 'tossup' ? 1 : RATING_W[r.split('-')[0]] ?? 0.3);

// Stable key shared by NYT races, Kalshi events and Polymarket events.
export function raceKeyOf(r) {
  const id = r.nytId || r.nyt_id || '';
  let m = /^([A-Z]{2})-[A-Z_]+-S-/.exec(id);
  if (m) return `S-${m[1]}`;
  m = /^([A-Z]{2})-[A-Z_]+-G-/.exec(id);
  if (m) return `G-${m[1]}`;
  m = /^([A-Z]{2})-[A-Z_]+-H-(\w+?)-\d{4}-/.exec(id);
  if (m) return houseKey(m[1], m[2]);
  return null;
}
export function houseKey(st, d) {
  const n = /^\d+$/.test(String(d)) ? String(d).padStart(2, '0') : 'AL';
  return `H-${st}-${n}`;
}

const partyOf = (p) => (p === 'DEM' || p === 'GOP' ? p : 'OTH');

// Normalize a list of {party,name,price} (mutually exclusive outcomes) into probabilities.
export function normalizeMarkets(list) {
  const ok = (list || []).filter((m) => Number.isFinite(m.price));
  const sum = ok.reduce((s, m) => s + m.price, 0);
  if (!ok.length || sum <= 0) return null;
  const out = { DEM: null, GOP: null, markets: [] };
  for (const m of ok) {
    const p = Math.round((m.price / sum) * 1000) / 1000;
    out.markets.push({ party: m.party, name: m.name, p });
    if (m.party === 'DEM' || m.party === 'GOP') out[m.party] = (out[m.party] || 0) + p;
  }
  for (const k of ['DEM', 'GOP']) if (out[k] != null) out[k] = Math.round(out[k] * 1000) / 1000;
  return out;
}

function modelOf(office) {
  const est = office?.nyt_model_estimates || [];
  const f = (id) => est.find((e) => e.nyt_party_id === id);
  const d = f('DEM'), g = f('GOP');
  if (!d && !g) return null;
  return {
    winProb: { DEM: d?.win_probability ?? null, GOP: g?.win_probability ?? null },
    expectedSeats: { DEM: d?.seats ?? null, GOP: g?.seats ?? null },
    seatRange: { DEM: d?.seats_quantile ? [d.seats_quantile[0], d.seats_quantile[4]] : null, GOP: g?.seats_quantile ? [g.seats_quantile[0], g.seats_quantile[4]] : null },
    noControl: office.nyt_model_chamber?.no_control ?? null,
  };
}

function seatsOf(office) {
  if (!office) return null;
  const pb = office.party_balance || {};
  const seat = (k) => pb[k]?.seats ?? null;
  return {
    total: office.total, called: office.num_races_called ?? 0, openSeats: office.open_seats,
    toWin: office.to_win?.DEM ?? null,
    DEM: seat('DEM'), GOP: seat('GOP'), OTH: seat('OTH'),
    flips: { DEM: pb.DEM?.flip_count ?? 0, GOP: pb.GOP?.flip_count ?? 0 },
    current: office.current_control || null, // seats held entering the election
    winner: ['DEM', 'GOP'].find((k) => pb[k]?.winner) || null,
    isReporting: !!office.is_reporting,
  };
}

export function buildControl({ partyControl, kalshiOdds, polyControl, houseSummary }) {
  const mk = (office, kalKey, polKey) => ({
    seats: seatsOf(partyControl?.[office]),
    model: modelOf(partyControl?.[office]),
    odds: {
      kalshi: normalizeMarkets((kalshiOdds?.[kalKey] || []).map((m) => ({ party: /-D$/.test(m.ticker) ? 'DEM' : /-R$/.test(m.ticker) ? 'GOP' : 'OTH', name: m.name, price: usePrice(m) }))),
      polymarket: polyControl?.[polKey] || null,
    },
  });
  const senate = mk('S', 'CONTROLS-2026', 'senate');
  const house = mk('H', 'CONTROLH-2026', 'house');
  if (houseSummary) house.races = houseSummary;
  for (const c of [senate, house]) {
    const o = c.odds;
    const ds = [o.kalshi?.DEM, o.polymarket?.DEM].filter((x) => x != null);
    o.DEM = ds.length ? Math.round((ds.reduce((a, b) => a + b, 0) / ds.length) * 1000) / 1000 : null;
    o.GOP = o.DEM == null ? null : Math.round((1 - o.DEM) * 1000) / 1000;
    // flatten for the simplest consumers
    if (o.kalshi) o.kalshi = { DEM: o.kalshi.DEM, GOP: o.kalshi.GOP };
  }
  return { senate, house };
}

export function usePrice(m) {
  const bid = Number(m.bid), ask = Number(m.ask), last = Number(m.price);
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0 && ask - bid <= 0.1) return (bid + ask) / 2;
  return last;
}

function oddsFor(list, cand) {
  if (!list) return null;
  const last = (cand.last || '').toLowerCase();
  let m = last && list.markets.find((x) => x.name && x.name.toLowerCase().includes(last));
  if (!m && (cand.party === 'DEM' || cand.party === 'GOP')) m = list.markets.find((x) => x.party === cand.party);
  return m ? m.p : null;
}

const fmtPct = (p) => `${Math.round(p * 100)}%`;
const pts = (x) => `${x.toFixed(1)} pt${x.toFixed(1) === '1.0' ? '' : 's'}`;

function describe(r, ctx) {
  const [a, b] = r.candidates;
  const rl = RATING_LABEL[r.rating] || null;
  const parts = [];
  if (ctx.winner) {
    const w = r.candidates.find((c) => c.winner);
    if (ctx.flip) return `FLIP: ${PARTY_NAME[w?.party] || w?.party || 'Party'} pick up seat`;
    return `${w?.name || 'Winner'} wins${rl ? ` · was ${rl.toLowerCase()}` : ''}`;
  }
  if (rl) parts.push(rl);
  if (r.totalVotes > 0 && r.eevp != null) {
    parts.push(r.eevp < 1 ? '<1% in' : `${Math.round(r.eevp)}% in`);
    if (r.eevp < 3) parts.push('very early');
    else if (a && b) {
      const m = Math.abs(a.pct - b.pct);
      parts.push(m < 0.05 ? 'dead even' : `${a.last || a.name} leads by ${pts(m)}`);
    }
  } else parts.push('no votes yet');
  const fav = (ctx.top || []).filter((c) => c.odds != null).sort((x, y) => y.odds - x.odds)[0];
  if (fav) parts.push(`bettors favor ${fav.last || fav.name} ${fmtPct(fav.odds)}`);
  return parts.join(' · ');
}

export function computeBattleground({ races, house, raceOdds, now = Date.now(), limit = 14 }) {
  const all = [...Object.values(races || {}), ...Object.values(house || {})];
  const items = [];
  for (const r of all) {
    if (!r.candidates || r.candidates.length < 2) continue;
    if (!['S', 'H', 'G'].includes(r.officeId)) continue;
    const key = raceKeyOf(r);
    if (!key) continue;
    const kal = raceOdds?.kalshi?.[key] || null;
    const pol = raceOdds?.polymarket?.[key] || null;
    const winnerC = r.candidates.find((c) => c.winner);
    const called = !!winnerC || r.callStatus === 'called';
    const ow = OFFICE_W[r.officeId];
    const rw = ratingW(r.rating);
    const [a, b] = r.candidates;
    const demOdds = [kal?.DEM, pol?.DEM].filter((x) => x != null);
    const demP = demOdds.length ? demOdds.reduce((s, x) => s + x, 0) / demOdds.length : null;
    const odds = { DEM: demP, GOP: demP == null ? null : 1 - demP, kalshi: kal ? { DEM: kal.DEM, GOP: kal.GOP } : null, polymarket: pol ? { DEM: pol.DEM, GOP: pol.GOP } : null };
    let score = 0, flip = false;
    if (called) {
      const age = r.winnerAcceptedAt ? now - r.winnerAcceptedAt : Infinity;
      flip = !!r.gained && !!winnerC;
      if (age < FRESH_CALL_MS && (flip || rw >= 0.4)) score = ow * (flip ? 1.3 : 0.7) * (1 - age / FRESH_CALL_MS * 0.6);
      else continue;
    } else {
      // blend of pre-election signals and live margin; skip signals we don't have
      const sig = [[rw, 0.35]];
      if (demP != null) sig.push([1 - Math.abs(demP - 0.5) * 2, 0.3]);
      const wp = a.winProb;
      if (wp != null) sig.push([1 - Math.abs(wp - 0.5) * 2, 0.15]);
      if (r.totalVotes > 0) {
        const margin = Math.abs(a.pct - b.pct);
        if ((r.eevp || 0) >= 3) sig.push([Math.max(0, 1 - margin / 20), 0.15 + 0.25 * Math.min(1, (r.eevp || 0) / 70)]);
      }
      const tw = sig.reduce((s, x) => s + x[1], 0);
      const base = sig.reduce((s, x) => s + x[0] * x[1], 0) / tw;
      // lopsided race with nothing close about it: drop
      if (rw <= 0.4 && (demP == null || Math.abs(demP - 0.5) > 0.3) && !(r.totalVotes > 0 && Math.abs(a.pct - b.pct) < 6)) continue;
      const recent = r.lastChangeAt && now - r.lastChangeAt < 120_000 ? 0.06 : 0;
      score = ow * base + recent + (r.eevp > 95 ? -0.1 * ow : 0);
    }
    if (score <= 0.08) continue;
    const top = r.candidates.slice(0, 2).map((c) => {
      const ok = oddsFor(kal, c), op = oddsFor(pol, c);
      const vals = [ok, op].filter((x) => x != null);
      return {
        id: c.id, name: c.name, last: c.last, party: c.party, incumbent: c.incumbent, img: c.img,
        votes: c.votes, pct: c.pct, winProb: c.winProb, winner: c.winner,
        odds: vals.length ? Math.round((vals.reduce((s, x) => s + x, 0) / vals.length) * 1000) / 1000 : null,
        oddsBy: { kalshi: ok, polymarket: op },
      };
    });
    const label = r.officeId === 'H' ? `${key.slice(2)} HOUSE` : `${(r.stateName || r.state || '').toUpperCase()} ${r.officeId === 'S' ? 'SENATE' : 'GOVERNOR'}`;
    items.push({
      key, nytId: r.nytId, office: r.officeId, title: label, state: r.state, rating: r.rating, ratingLabel: RATING_LABEL[r.rating] || null,
      candidates: top, eevp: r.eevp, totalVotes: r.totalVotes, callStatus: r.callStatus, winner: winnerC?.id || null,
      winnerParty: winnerC?.party || null, gained: !!r.gained, calledAt: r.winnerAcceptedAt || null, odds,
      why: describe(r, { winner: !!winnerC, flip, odds, top }), score: Math.round(score * 1000) / 1000,
    });
  }
  items.sort((x, y) => y.score - x.score);
  // keep a mix: at most 3 governor races
  const out = [];
  let g = 0;
  for (const it of items) {
    if (it.office === 'G' && ++g > 3) continue;
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export function houseSummary(house) {
  const rs = Object.values(house || {});
  const open = rs.filter((r) => !(r.callStatus === 'called' || r.candidates.some((c) => c.winner)));
  const comp = (r) => r.rating === 'tossup' || r.rating?.startsWith('lean');
  return {
    total: rs.length, called: rs.length - open.length,
    competitiveUncalled: open.filter(comp).length,
    tossupsUncalled: open.filter((r) => r.rating === 'tossup').length,
  };
}
