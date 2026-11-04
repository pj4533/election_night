// Broadcast graphics layer: top bar, race card, watchlist, feeds.
import { partyColor, fmtInt, fmtPct, fmtProb, etTime, ago, countdown, el, roush, tweenNumber } from './util.js';

const WATCH = ['pineplains', 'stanford-council', 'mi-sen', 'tx-sen', 'ia-gov'];
const HOMETOWN = new Set(['pineplains', 'stanford-supv', 'stanford-council']);
const WATCH_LABEL = { 'pineplains': '★ TREVOR ROUSH', 'stanford-supv': '★ JULIA DESCOTEAUX', 'stanford-council': '★ STANFORD COUNCIL', 'mi-sen': 'MI SEN', 'tx-sen': 'TX SEN', 'ia-gov': 'IA GOV' };
const WATCH_SUB = { 'pineplains': 'PINE PLAINS SUPERVISOR', 'stanford-supv': 'STANFORD SUPERVISOR', 'stanford-council': 'STANFORD TOWN COUNCIL', 'mi-sen': 'MICHIGAN SENATE', 'tx-sen': 'TEXAS SENATE', 'ia-gov': 'IOWA GOVERNOR' };
const FRIEND_TAG = 'HOMETOWN WATCH';
const pctW = (n) => `${Math.max(0, Math.min(100, n || 0)).toFixed(2)}%`;
const qs = (root, s) => root.querySelector(s);
const setText = (e, t) => { if (e && e.textContent !== t) e.textContent = t; };
const col = (p) => partyColor(p);

function statusOf(race) {
  if (!race) return { txt: '—', cls: '' };
  const winner = race.candidates?.find((c) => c.winner);
  if (winner || race.callStatus === 'called') return { txt: 'PROJECTED WINNER ✓', cls: 'called', winner };
  if (race.callStatus === 'waiting') return { txt: 'AWAITING RESULTS', cls: 'wait' };
  if (race.callStatus === 'counting') return { txt: 'COUNTING', cls: 'count' };
  return { txt: 'TOO EARLY TO CALL', cls: 'early' };
}
function orderCands(race) {
  const cs = (race?.candidates || []).filter((c) => c.party !== 'WRI' && !c.writeIn && !/write-?ins?/i.test(c.name) && c.id !== 'total_writeins');
  const arr = cs.slice();
  arr.sort((a, b) => (b.votes - a.votes) || ((b.winProb || 0) - (a.winProb || 0)) || (a.name.includes('Roush') ? -1 : b.name.includes('Roush') ? 1 : 0));
  return arr;
}
function raceNode(state, key) {
  if (!state) return null;
  return state.watch?.find((r) => r.key === key) || state.spotlight?.find((r) => r.key === key) || state.races?.find((r) => r.key === key) || null;
}
function sparkline(svg, pts, getter) {
  // pts: [{t,..}], getter -> {id: value}; draws one polyline per series
  if (!pts || pts.length < 2) { svg.innerHTML = ''; return; }
  const W = 200, H = 50;
  const series = {};
  pts.forEach((p, i) => { const g = getter(p); for (const k in g) (series[k] ||= []).push([i, g[k]]); });
  let lo = Infinity, hi = -Infinity;
  for (const k in series) for (const [, v] of series[k]) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-6) { hi = lo + 1; }
  const n = pts.length - 1;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  let out = '';
  for (const k in series) {
    const d = series[k].map(([i, v]) => `${(i / n * W).toFixed(1)},${(H - 3 - (v - lo) / (hi - lo) * (H - 6)).toFixed(1)}`).join(' ');
    out += `<polyline points="${d}" fill="none" stroke="${k.startsWith('#') ? k : '#fff'}" stroke-width="1.8" stroke-linejoin="round" style="filter:drop-shadow(0 0 2px ${k})"/>`;
  }
  svg.innerHTML = out;
}


// "WHAT'S BEEN COUNTED" for hometown races: vote type status (BOE groupReportingStatus), Election Day scanners
// at the town polling place, and an estimate of votes left from past turnout (data/hometown-baseline.json).
const GROUP_LABEL = { 'Early Voting': 'EARLY VOTING', 'Absentee/EMB': 'ABSENTEE', 'Election Day': 'ELECTION DAY', 'Affidavit': 'AFFIDAVIT' };
const STATUS_TXT = { full: 'ALL IN', night: 'IN FOR TONIGHT', partial: 'PARTIAL', not: 'NOT YET' };
function expectedTotal(rep) {
  // per ED: midterm estimate = 2024 presidential turnout × 0.75, floored at 2025's (record off-year) turnout
  const B = rep?.baseline; if (!B) return null;
  let sum = 0, n = 0;
  for (const yrs of Object.values(B)) {
    if (!yrs) continue;
    const e = Math.max((yrs['2024']?.total || 0) * 0.75, yrs['2025']?.total || 0);
    if (e) { sum += e; n++; }
  }
  return n ? Math.round(sum) : null;
}
// COUNT PROGRESS for hometown races: how much is counted, what's left, which districts/polling places are in.
function progressOf(race) {
  const rep = race.reporting || {};
  const exp = expectedTotal(rep);
  const tot = race.totalVotes || 0;
  const pct = exp ? Math.min(99, Math.round((100 * tot) / exp)) : null;
  const eday = (rep.groups || []).find((g) => g.name === 'Election Day');
  // Election Day is in for THIS race when its town polling place scanners all reported or E-day votes exist
  // (the county-wide group status stays 'partial' until every polling place in Dutchess reports)
  const ppAll = (rep.pollingPlaces || []).length && (rep.pollingPlaces || []).every((p) => p.scanners && p.scannersReporting >= p.scanners);
  const edayIn = ppAll || (rep.methods?.['Election Day'] || 0) > 0 || (eday && (eday.status === 'full' || eday.status === 'night'));
  const pps = rep.pollingPlaces || [];
  const scan = pps.reduce((a, p) => [a[0] + (p.scannersReporting || 0), a[1] + (p.scanners || 0)], [0, 0]);
  const eds = race.edResults || [];
  const edsDone = eds.filter((e) => e.status >= 3).length;
  const done = edsDone === eds.length && eds.length > 0 && edayIn;
  return { exp, tot, pct: done ? 100 : pct, edayIn, scan, pps, eds, edsDone, done, methods: rep.methods || {} };
}
function progressBlock(race) {
  const P = progressOf(race);
  if (!P.tot) return '';
  const w = (v) => (P.exp ? Math.min(100, (100 * v) / Math.max(P.exp, P.tot)) : 0);
  const m = P.methods;
  const seg = [['Early Voting', 'var(--cyan)'], ['Absentee/EMB', 'var(--magenta)'], ['Election Day', 'var(--yellow)'], ['Affidavit', '#3dff8a']]
    .map(([k, c]) => (m[k] ? `<i style="width:${w(m[k])}%;background:${c}"></i>` : '')).join('');
  const head = P.done ? 'ALL VOTES COUNTED' : P.pct != null ? `ABOUT ${P.pct}% COUNTED` : `${fmtInt(P.tot)} VOTES COUNTED`;
  const left = P.done ? 'Every district and vote type is in.'
    : !P.edayIn ? `STILL TO COME: <b>ELECTION DAY VOTES</b>${P.exp ? ` · about ${fmtInt(Math.max(0, P.exp - P.tot))} more expected` : ''}`
    : 'Election Day is in · late absentees & affidavits still to come';
  const pp = P.pps.map((p) => `<span class="pg-chip ${p.scannersReporting >= p.scanners ? 'in' : p.scannersReporting ? 'part' : 'out'}">${p.name.replace(/^.*? - /, '').toUpperCase()} POLLS: ${p.scannersReporting || 0} OF ${p.scanners} SCANNERS IN</span>`).join('');
  const eds = P.eds.map((e) => `<span class="pg-chip ${e.status >= 3 ? 'in' : e.total ? 'part' : 'out'}">${e.name.toUpperCase()}: ${e.status >= 3 ? 'FULLY IN' : e.total ? 'PARTIAL · E-DAY OUT' : 'NOTHING YET'}</span>`).join('');
  return `<div class="pg"><div class="pg-head">${head}</div><div class="pg-bar">${seg}</div><div class="pg-left">${left}</div><div class="pg-chips">${eds}${pp}</div></div>`;
}
function countedPanel(race, d, now) {
  const rep = race.reporting || {};
  const order = ['Early Voting', 'Absentee/EMB', 'Election Day', 'Affidavit'];
  const groups = order.map((g) => (rep.groups || []).find((x) => x.name === g) || { name: g, status: 'not' });
  const pp = (rep.pollingPlaces || [])[0];
  const rows = groups.map((g) => {
    const v = rep.methods?.[g.name] || 0;
    const done = g.status === 'full' || g.status === 'night';
    let note = '';
    if (g.name === 'Election Day' && pp) note = `${pp.name.replace(/^.*? - /, '').toUpperCase()} · ${pp.scannersReporting || 0} OF ${pp.scanners || '?'} SCANNERS IN`;
    if (g.name === 'Affidavit' && !done) note = 'COUNTED AFTER ELECTION NIGHT';
    return `<div class="wc-row ${done ? 'done' : g.status === 'partial' ? 'part' : 'wait'}"><span class="wc-ic">${done ? '✓' : g.status === 'partial' ? '◐' : '○'}</span><span class="wc-n">${GROUP_LABEL[g.name] || g.name}</span><span class="wc-s">${STATUS_TXT[g.status] || g.status}</span><b class="wc-v">${done || v ? fmtInt(v) : '—'}</b>${note ? `<div class="wc-note">${note}</div>` : ''}</div>`;
  }).join('');
  const exp = expectedTotal(rep);
  const tot = race.totalVotes || 0;
  const est = exp ? `<div class="wc-est"><div class="wc-est-t">EST. VOTES STILL OUT <b>${fmtInt(Math.max(0, exp - tot))}</b> <small>${Math.min(99, Math.round(100 * tot / exp))}% OF EXPECTED ${fmtInt(exp)} COUNTED</small></div><div class="wc-bar"><u style="width:${Math.min(100, 100 * tot / exp)}%"></u></div><div class="wc-src">estimate: 75% of 2024 turnout (min. 2025) in these districts</div></div>` : '';
  return `<div class="wc"><div class="wc-h">WHAT'S BEEN COUNTED <small>· BOE LAST CHECK ${d.lastPoll ? ago(d.lastPoll, now) : '—'}</small></div>${rows}${est}</div>`;
}

// ---------- WIDE HOMETOWN LAYOUT (pineplains / stanford-council): headline column + district-splits graphics column ----------
const WIDE = new Set(['pineplains', 'stanford-council']);
const MORDER = [['Early Voting', 'EARLY', '#00f0ff'], ['Absentee/EMB', 'ABSENTEE', '#ff2bd6'], ['Election Day', 'ELECTION DAY', '#ffd23f'], ['Affidavit', 'AFFIDAVIT', '#3dff8a']];
const realCands = (cs) => (cs || []).filter((c) => c.party !== 'WRI' && !c.writeIn);
const lastName = (n) => (String(n || '').split(' ').pop() || '').toUpperCase();
function stackBar(methods, scale) {
  const s = scale || 1;
  return `<div class="w-stack">${MORDER.map(([k, l, c]) => { const v = methods?.[k] || 0; return v ? `<i style="width:${(100 * v / s).toFixed(2)}%;background:${c};box-shadow:0 0 .4vw ${c}"></i>` : ''; }).join('')}</div>`;
}
function methodText(methods) {
  return MORDER.filter(([k]) => methods?.[k]).map(([k, l, c]) => `<span style="color:${c}">${l} <b>${fmtInt(methods[k])}</b></span>`).join('');
}
function edExpected(yrs) {
  if (!yrs) return null;
  const e = Math.max((yrs['2024']?.total || 0) * 0.75, yrs['2025']?.total || 0);
  return e ? Math.round(e) : null;
}
function donut(methods) {
  const tot = MORDER.reduce((s, [k]) => s + (methods?.[k] || 0), 0);
  let off = 25, segs = '';
  for (const [k, , c] of MORDER) {
    const v = methods?.[k] || 0; if (!v) continue;
    const p = 100 * v / tot;
    segs += `<circle r="15.9155" cx="21" cy="21" fill="none" stroke="${c}" stroke-width="6" stroke-dasharray="${p.toFixed(3)} ${(100 - p).toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}" style="filter:drop-shadow(0 0 1px ${c})"/>`;
    off -= p;
  }
  return `<svg class="w-donut" viewBox="0 0 42 42"><circle r="15.9155" cx="21" cy="21" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="6"/>${segs}<text x="21" y="21" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="7" font-family="monospace">${fmtInt(tot)}</text><text x="21" y="27.5" text-anchor="middle" fill="#ffd23f" font-size="3.2" font-family="sans-serif">VOTES</text></svg>`;
}
function mixPanel(race) {
  const many = (race.edResults?.length || 0) > 1;
  const m = race.reporting?.methods || {};
  const tot = MORDER.reduce((s, [k]) => s + (m[k] || 0), 0) || 1;
  const legend = MORDER.map(([k, l, c]) => `<div class="w-leg"><i style="background:${c};box-shadow:0 0 .4vw ${c}"></i><span>${l}</span><b>${m[k] ? fmtInt(m[k]) : '—'}</b><em>${m[k] ? Math.round(100 * m[k] / tot) + '%' : ''}</em></div>`).join('');
  const cs = realCands(race.candidates);
  const mx = Math.max(1, ...cs.map((c) => c.votes || 0));
  const rows = cs.map((c) => `<div class="w-cm"><div class="w-cm-t"><span style="color:${col(c.party)}">${lastName(c.name)}</span><b>${fmtInt(c.votes)}</b></div>${stackBar(c.methods, mx)}</div>`).join('');
  return `<div class="w-h">WHERE THE VOTES CAME FROM</div><div class="w-mix-g">${donut(m)}<div class="w-legs">${legend}</div></div>${many ? '' : `<div class="w-cms">${rows}</div>`}`;
}
function edCards(race) {
  const eds = race.edResults?.length ? race.edResults : (race.eds || []).map((e) => ({ name: e.name, total: 0, candidates: [] }));
  const B = race.reporting?.baseline || {};
  return `<div class="w-h">DISTRICT SPLITS <small>${eds.length} DISTRICT${eds.length === 1 ? '' : 'S'}</small></div>` + eds.map((e) => {
    const cs = realCands(e.candidates);
    const rep = (e.total || 0) > 0;
    const sorted = cs.slice().sort((a, b) => b.votes - a.votes);
    const marg = rep && sorted.length > 1 ? `<span class="w-marg" style="color:${col(sorted[0].party)}">${lastName(sorted[0].name)} +${(sorted[0].pct - sorted[1].pct).toFixed(0)} PTS</span>` : '';
    const split = cs.map((c) => `<i style="width:${rep ? c.pct.toFixed(2) : 0}%;background:${col(c.party)};box-shadow:0 0 .6vw ${col(c.party)}">${rep && c.pct >= 12 ? `<span>${c.pct.toFixed(1)}%</span>` : ''}</i>`).join('');
    const mx = Math.max(1, ...cs.map((c) => c.votes || 0));
    const crow = cs.map((c) => `<div class="w-ec"><div class="w-ec-t"><span style="color:${col(c.party)}">${lastName(c.name)}</span><b>${fmtInt(c.votes)}</b></div>${stackBar(c.methods, mx)}<div class="w-ec-m">${methodText(c.methods) || '<span>NO VOTES YET</span>'}</div></div>`).join('');
    const yrs = B[e.name];
    const exp = edExpected(yrs);
    const cnt = exp ? `<div class="w-exp"><div class="w-exp-t"><span>COUNTED</span><b>${fmtInt(e.total || 0)}</b><em>OF EST. ${fmtInt(exp)} EXPECTED · ${Math.min(999, Math.round(100 * (e.total || 0) / exp))}%</em></div><div class="w-exp-bar"><u style="width:${Math.min(100, 100 * (e.total || 0) / exp).toFixed(1)}%"></u></div></div>` : '';
    let hist = '';
    if (yrs && eds.length === 1) {
      const ys = [['2023', 'COUNTY EXEC'], ['2024', 'PRESIDENT'], ['2025', 'PROPOSALS']].filter(([y]) => yrs[y]?.total).map(([y, l]) => [y, l, yrs[y].total]);
      ys.push(['2026', 'SO FAR', e.total || 0]);
      const hm = Math.max(1, ...ys.map((x) => x[2]));
      hist = `<div class="w-hist"><div class="w-hist-h">TURNOUT IN THIS DISTRICT</div>${ys.map(([y, l, v]) => `<div class="w-hr ${y === '2026' ? 'now' : ''}"><span>${y}</span><div class="w-hb"><u style="width:${(100 * v / hm).toFixed(1)}%"></u></div><b>${fmtInt(v)}</b></div>`).join('')}</div>`;
    }
    return `<div class="w-ed ${rep ? 'in' : ''}"><div class="w-ed-top"><span class="w-ed-n">${e.name.toUpperCase()}</span>${marg}<span class="w-ed-s">${rep ? fmtInt(e.total) + ' VOTES' : 'AWAITING'}</span></div><div class="w-split">${split}</div><div class="w-ecs">${crow}</div>${cnt}${hist}</div>`;
  }).join('');
}
// ---------- OUTLOOK: what's left vs counted, projected final, can the trailer catch up ----------
let EDAY = null;
fetch('/geo/hometown-eday.json').then((r) => r.json()).then((j) => { EDAY = j.eds || {}; }).catch((e) => console.error('eday json', e));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function computeOutlook(race) {
  if (!EDAY) return null;
  const cs = realCands(race.candidates);
  const D = cs.find((c) => c.party === 'DEM'), R = cs.find((c) => c.party === 'GOP');
  if (!D || !R) return null;
  const B = race.reporting?.baseline || {};
  const edG = (race.reporting?.groups || []).find((g) => g.name === 'Election Day');
  const edsSrc = race.edResults?.length ? race.edResults : (race.eds || []).map((e) => ({ name: e.name, total: 0, candidates: [] }));
  let out = 0, projD = 0, projR = 0;
  const eds = edsSrc.map((e) => {
    const ec = realCands(e.candidates);
    const d = ec.find((c) => c.party === 'DEM'), r = ec.find((c) => c.party === 'GOP');
    const dv = d?.votes || 0, rv = r?.votes || 0;
    const counted = e.total || 0;
    const expected = edExpected(B[e.name]) || counted;
    const o = Math.max(0, expected - counted);
    const hist = EDAY[e.name] || {};
    const y25 = hist['2025'] || hist['2024'] || {};
    const oth = (c) => (c?.methods?.['Early Voting'] || 0) + (c?.methods?.['Absentee/EMB'] || 0) + (c?.methods?.['Affidavit'] || 0);
    const od = oth(d), orr = oth(r);
    const tonightOther = od + orr > 0 ? 100 * od / (od + orr) : (y25.otherDem ?? 50);
    const share = clamp((y25.edayDem ?? 50) + (tonightOther - (y25.otherDem ?? tonightOther)), 5, 95);
    const edayIn = ec.some((c) => (c.methods?.['Election Day'] || 0) > 0) || edG?.status === 'full' || edG?.status === 'night';
    const pd = dv + o * share / 100, pr = rv + o * (100 - share) / 100;
    out += o; projD += pd; projR += pr;
    return { name: e.name, counted, expected, out: o, dv, rv, share, edayIn, pd, pr, lead: dv === rv ? null : dv > rv ? D : R };
  });
  const lead = D.votes >= R.votes ? D : R, trail = lead === D ? R : D;
  const margin = lead.votes - trail.votes;
  const need = out > 0 ? (out + margin) / (2 * out) : Infinity;
  // trailer's best Election Day share in these EDs (any year)
  let best = -1, bestYr = '';
  for (const e of edsSrc) for (const [yr, h] of Object.entries(EDAY[e.name] || {})) {
    const v = trail.party === 'GOP' ? 100 - h.edayDem : h.edayDem;
    if (v > best) { best = v; bestYr = yr; }
  }
  const needPct = need * 100;
  let status, cls;
  const L = lastName(lead.name);
  // SAFETY: never declare DONE while any district's Election Day vote is still out or the expected-turnout
  // baseline is missing (missing baseline made 'expected' = counted → '0 left' → a false DONE on Vercel).
  const anyEdayOut = eds.some((e) => !e.edayIn);
  const noBaseline = eds.some((e) => !edExpected(B[e.name]));
  if ((out <= 0 || need > 1) && !anyEdayOut && !noBaseline) { status = `✓ DONE: ${L} HAS IT · CAN'T BE CAUGHT`; cls = 'done'; }
  else if (noBaseline && anyEdayOut) { status = 'WAITING ON ELECTION DAY'; cls = 'play'; }
  else if (need > 1) { status = `SAFE ${L}`; cls = 'safe'; }
  else if (best >= 0 && needPct > best + 12) { status = `SAFE ${L}`; cls = 'safe'; }
  else if (best >= 0 && needPct > best + 3) { status = `LIKELY ${L}`; cls = 'likely'; }
  else { status = 'STILL IN PLAY'; cls = 'play'; }
  return { D, R, lead, trail, margin, out, need, needPct, best, bestYr, status, cls, eds, projD, projR, total: race.totalVotes || 0 };
}
// "WHAT TO WATCH" for statewide key races: where the votes are left, what the trailer needs, swing vs 2024.
const fmtK = (n) => (n >= 995_000 ? `${(n / 1e6).toFixed(n >= 9.95e6 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));
const lean24 = (l) => (l == null ? '' : l === 0 ? 'EVEN IN 2024' : `<em style="color:${col(l > 0 ? 'DEM' : 'GOP')}">${l > 0 ? 'HARRIS' : 'TRUMP'} +${Math.abs(l)}</em> IN 2024`);
const pName = (s) => String(s || '').toUpperCase();
const coName = (s) => { const n = pName(s); return / (CO\.|COUNTY|CITY|PARISH|BOROUGH)$/.test(n) ? n : n + ' CO.'; }; // 'HARRIS' alone read as Kamala Harris
function watchBlock(race) {
  const S = race?.story; if (!S || !race.totalVotes) return '';
  const rows = [];
  const [L0] = S.left || [];
  if (L0) {
    const more = S.left.slice(1).map((c) => `${coName(c.name)} ${fmtK(c.remaining)}`).join(' · ');
    rows.push(`<div class="w-row"><span class="w-k">VOTES LEFT</span><span class="w-v"><b>${coName(L0.name)}</b> · ${L0.eevp}% IN · <b>~${fmtK(L0.remaining)}</b> LEFT${L0.l24 != null ? ' · ' + lean24(L0.l24) : ''}${more ? `<small>NEXT: ${more}</small>` : ''}</span></div>`);
  }
  const N = S.need;
  if (N) {
    const tc = col(N.party);
    const verdict = N.pct > 100 ? 'CAN\'T CATCH UP' : `NEEDS <b style="color:${tc}">${N.pct.toFixed(1)}%</b> OF ~${fmtK(N.remaining)} LEFT`;
    rows.push(`<div class="w-row"><span class="w-k">CATCH-UP MATH</span><span class="w-v"><b style="color:${tc}">${pName(N.trail)}</b> ${verdict}${N.model != null && N.pct <= 100 ? ` · MODEL SEES <b>${Math.round(N.model)}%</b>` : ''}</span></div>`);
  }
  const W = S.swing;
  if (W && W.n >= 3) {
    const b = W.big; const dir = b.d >= 0 ? 'BLUER' : 'REDDER';
    rows.push(`<div class="w-row"><span class="w-k">SWING VS 2024</span><span class="w-v"><b style="color:${col('DEM')}">${W.bluer}</b> BLUER · <b style="color:${col('GOP')}">${W.redder}</b> REDDER OF ${W.n} COUNTIES · <b>${coName(b.name)}</b> <b style="color:${col(b.d >= 0 ? 'DEM' : 'GOP')}">${Math.abs(b.d)} PTS ${dir}</b></span></div>`);
  }
  if (!rows.length) return '';
  const M = S.model;
  const head = M ? `<div class="w-h">WHAT TO WATCH<span>MODEL FINAL: <b style="color:${col(M.party)}">${pName(M.lead)} +${M.margin.toFixed(1)}</b></span></div>` : '<div class="w-h">WHAT TO WATCH</div>';
  return head + rows.join('');
}

// Short windows: drop whole WHAT TO WATCH lines (never cut text) from the bottom until the card body fits.
function trimWatch() {
  const w = document.querySelector('.ov-card .c-watch.on'); if (!w) return;
  const body = w.closest('.c-body'); if (!body) return;
  const parts = [...w.querySelectorAll('.w-v small'), ...[...w.querySelectorAll('.w-row')].reverse()];
  parts.forEach((p) => { p.style.display = ''; });
  for (const p of parts) {
    if (body.scrollHeight <= body.clientHeight + 1) break;
    if (w.querySelectorAll('.w-row:not([style*="none"])').length <= 1 && p.classList.contains('w-row')) break;
    p.style.display = 'none';
  }
}
if (typeof window !== 'undefined') window.addEventListener('resize', () => requestAnimationFrame(trimWatch));

function fitBox(box) {
  const kids = [...box.children];
  if (!kids.length || !box.clientHeight) return;
  kids.forEach((k) => (k.style.zoom = ''));
  for (let i = 0; i < 3; i++) {
    const need = box.scrollHeight, avail = box.clientHeight;
    if (need <= avail + 1) return;
    const cur = Number(kids[0].style.zoom || 1);
    const z = Math.max(0.5, cur * (avail / need) * 0.98);
    kids.forEach((k) => (k.style.zoom = String(z)));
  }
}

export function createOverlay(root) {
  let state = null, seg = null, refs = null, built = null;
  const prevSig = {};
  root.classList.add('ov-root');

  // ---------- skeleton ----------
  root.innerHTML = `
  <div class="ov-top">
    <div class="ov-bug"><span class="ov-logo" data-text="ELECTION NIGHT 2026">ELECTION NIGHT <b>2026</b></span><span class="ov-live"><i></i>LIVE</span></div>
    <div class="ov-seg"><span class="ov-seg-title"></span></div>
    <div class="ov-next"><div class="ov-next-lbl">NEXT POLLS CLOSE</div><div class="ov-next-val">—</div></div>
    <div class="ov-clock"><span class="ov-clock-t">--:--:--</span><span class="ov-clock-z">ET</span></div>
  </div>
  <div class="ov-stage"><i class="tk t"></i><i class="tk b"></i><i class="tk l"></i><i class="tk r"></i><i class="br tl"></i><i class="br tr"></i><i class="br bl"></i><i class="br br"></i><i class="xh"></i>
    <div class="lbl">LIVE 3D // <i class="st-lbl">—</i></div><div class="rec"><i>●</i> REC · <b class="st-co">--</b></div></div>
  <div class="ov-card-host"></div>
  <div class="ov-right">
    <div class="ov-watch"></div>
    <div class="ov-ctrl panel"><div class="ov-h">CONTROL OF CONGRESS</div>
      <div class="cg-row" data-ch="senate"><div class="cg-head"><span class="cg-name">SENATE</span><span class="cg-bet">Bettors: —</span></div>
        <div class="ov-ctrl-bar"><div class="d"></div><div class="u"></div><div class="r"></div></div>
        <div class="ov-ctrl-nums"><span class="d">D <b>—</b></span><span class="u">— TO WIN</span><span class="r"><b>—</b> R</span></div>
        <div class="cg-src">—</div></div>
      <div class="cg-row" data-ch="house"><div class="cg-head"><span class="cg-name">HOUSE</span><span class="cg-bet">Bettors: —</span></div>
        <div class="ov-ctrl-bar"><div class="d"></div><div class="u"></div><div class="r"></div></div>
        <div class="ov-ctrl-nums"><span class="d">D <b>—</b></span><span class="u">— TO WIN</span><span class="r"><b>—</b> R</span></div>
        <div class="cg-src">—</div></div></div>
    <div class="ov-feeds panel"><div class="ov-h">DATA FEEDS</div>
      <div class="ov-feeds-grid">
      <div class="ov-feed" data-f="dutchess"><i></i><span>DUTCHESS BOE</span><em>—</em></div>
      <div class="ov-feed" data-f="nyt"><i></i><span>AP via NYT</span><em>—</em></div>
      <div class="ov-feed" data-f="kalshi"><i></i><span>BETTING ODDS</span><em>—</em></div>
      <div class="ov-feed" data-f="news"><i></i><span>NEWS</span><em>—</em></div></div>
      <div class="ov-boe">BOE LAST PUBLISH <b>—</b></div></div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const segTitle = $('.ov-seg-title'), nextVal = $('.ov-next-val'), clockT = $('.ov-clock-t');
  const host = $('.ov-card-host'), watchEl = $('.ov-watch');
  // Control of Congress: Senate row → SENATE WATCH, House row → BALANCE OF POWER (House arc). Flash = click registered.
  $('.ov-ctrl')?.addEventListener('click', (e) => {
    const row = e.target.closest?.('.cg-row') || [...$('.ov-ctrl').querySelectorAll('.cg-row')].find((r) => { const b = r.getBoundingClientRect(); return e.clientY >= b.top && e.clientY <= b.bottom; });
    const ch = row?.dataset.ch || 'senate';
    const p = $('.ov-ctrl'); p.classList.remove('clicked'); void p.offsetWidth; p.classList.add('clicked');
    window.dispatchEvent(new CustomEvent('broadcast:jump', { detail: ch === 'house' ? 'balance' : 'senate' }));
  });

  // ---------- watchlist ----------
  const tiles = {};
  for (const k of WATCH) {
    const t = el('div', 'ov-tile panel' + (HOMETOWN.has(k) ? ' hero' : '') + (k !== 'pineplains' && HOMETOWN.has(k) ? ' hero2' : ''));
    t.dataset.key = k;
    t.addEventListener('click', () => window.dispatchEvent(new CustomEvent('broadcast:jump', { detail: k })));
    t.dataset.k = k;
    t.innerHTML = `
      <div class="t-head"><span class="t-name">${WATCH_LABEL[k]}</span><span class="t-call"></span></div>
      <div class="t-sub">${WATCH_SUB[k]}</div>
      <div class="t-row a"><span class="t-n"></span><span class="t-p"></span><div class="t-bar"><u></u></div></div>
      <div class="t-row b"><span class="t-n"></span><span class="t-p"></span><div class="t-bar"><u></u></div></div>
      <div class="t-foot"><span class="t-ee">EEVP —</span><span class="t-odds">—</span></div>`;
    watchEl.appendChild(t);
    tiles[k] = {
      root: t, call: qs(t, '.t-call'), a: { n: qs(t, '.a .t-n'), p: qs(t, '.a .t-p'), u: qs(t, '.a u') },
      b: { n: qs(t, '.b .t-n'), p: qs(t, '.b .t-p'), u: qs(t, '.b u') }, ee: qs(t, '.t-ee'), odds: qs(t, '.t-odds'),
    };
  }
  function updateTile(k, race) {
    const T = tiles[k]; if (!T) return;
    if (!race) return;
    let cs = orderCands(race);
    if (k === 'pineplains') { const r = roush(race); const o = cs.find((c) => c !== r); cs = [r, o].filter(Boolean).sort((a, b) => (b.votes - a.votes) || (a === r ? -1 : 1)); }
    const [a, b] = cs;
    for (const [row, c] of [[T.a, a], [T.b, b]]) {
      if (!c) { setText(row.n, '—'); setText(row.p, ''); continue; }
      const nm = (c.last || c.name.split(' ').pop()).toUpperCase();
      setText(row.n, nm + (c.winner ? ' ✓' : ''));
      setText(row.p, race.totalVotes ? fmtPct(c.pct) : '—');
      row.u.style.width = pctW(race.totalVotes ? c.pct : 0);
      row.u.style.background = col(c.party);
      row.u.style.boxShadow = `0 0 .5vw ${col(c.party)}`;
      row.n.style.color = col(c.party);
    }
    const st = statusOf(race);
    setText(T.call, st.cls === 'called' ? '✓ CALLED' : '');
    T.root.classList.toggle('is-called', st.cls === 'called');
    setText(T.ee, HOMETOWN.has(k) ? (() => { const P = progressOf(race); return !P.tot ? 'NO VOTES YET' : P.done ? '100% IN' : `${P.pct != null ? P.pct + '% IN' : fmtInt(P.tot) + ' IN'} · ${P.edayIn ? 'E-DAY IN' : 'E-DAY OUT'}`; })() : `EEVP ${race.eevp != null ? Math.round(race.eevp) + '%' : '—'}`);
    const lead = a;
    if (lead && a.odds != null) setText(T.odds, `Bettors give ${a.last || a.name.split(' ').pop()} a ${Math.round(a.odds * 100)}% chance`);
    else if (HOMETOWN.has(k)) {
      // hometown tiles carry the OUTLOOK verdict so a decided race is obvious at a glance
      const o = race.totalVotes ? computeOutlook(race) : null;
      const called = race.candidates?.find((c) => c.winner);
      const last = (c) => (c.last || c.name.split(' ').pop()).toUpperCase();
      let txt = race.totalVotes ? fmtInt(race.totalVotes) + ' VOTES' : 'HOMETOWN', cls = '';
      if (called) { txt = `✓ ${last(called)} WINS`; cls = 'done'; }
      else if (o) {
        const L = last(o.lead);
        txt = o.cls === 'done' ? `✓ ${L} WINS · CAN'T BE CAUGHT` : o.cls === 'safe' ? `PROJECTED: ${L} (SAFE)` : o.cls === 'likely' ? `PROJECTED: ${L} (LIKELY)` : `TOSS-UP · ${L} AHEAD SO FAR`;
        cls = o.cls;
      }
      setText(T.odds, txt);
      T.root.dataset.outlook = cls;
      setText(T.call, cls === 'done' ? '✓ DECIDED' : (st.cls === 'called' ? '✓ CALLED' : ''));
    }
    else setText(T.odds, '—');
    const sig = `${race.totalVotes}|${race.eevp}|${race.callStatus}|${race.candidates?.map((c) => c.votes).join(',')}`;
    if (prevSig[k] !== undefined && prevSig[k] !== sig) {
      T.root.classList.remove('flash'); void T.root.offsetWidth; T.root.classList.add('flash');
    }
    prevSig[k] = sig;
  }
  function markActiveTile() {
    for (const k of WATCH) tiles[k].root.classList.toggle('active', !!seg && seg.id === k);
  }

  // ---------- race card build ----------
  function buildCard(sg) {
    host.innerHTML = '';
    const id = sg.id;
    const card = el('div', 'ov-card panel in');
    refs = { id, cands: {} };
    if (id === 'balance') {
      card.classList.add('balance');
      card.innerHTML = `
        <div class="c-head"><span class="c-tag">BALANCE OF POWER</span><span class="c-title">CONTROL OF CONGRESS</span></div>
        <div class="bal-grid">
          ${['S', 'H'].map((ch) => `
          <div class="bal" data-ch="${ch}">
            <div class="bal-name">${ch === 'S' ? 'U.S. SENATE' : 'U.S. HOUSE'}</div>
            <div class="bal-seats"><span class="d"><b>—</b><small>DEM</small></span><span class="mid"><small>TO WIN</small><b class="tw">—</b></span><span class="r"><b>—</b><small>GOP</small></span></div>
            <div class="bal-bar"><div class="d"></div><div class="u"></div><div class="r"></div><i class="mark"></i></div>
            <div class="bal-meta"><span class="called">RACES CALLED <b>—</b></span><span class="odds">BETTING ODDS —</span></div>
            <div class="bal-model">NYT MODEL <span></span></div>
          </div>`).join('')}
        </div>`;
      host.appendChild(card);
      refs.card = card;
      return;
    }
    const hero = HOMETOWN.has(id);
    const wide = WIDE.has(id);
    card.classList.toggle('hero', hero);
    card.classList.toggle('wide', wide);
    const race = raceNode(state, id === 'spotlight' ? (sg.race?.key) : id) || sg.race;
    const cands = hero ? (() => { const o = orderCands(race); const r = roush(race); return [r, ...o.filter((c) => c !== r)].filter(Boolean); })() : orderCands(race).slice(0, 2);
    card.innerHTML = `
      <div class="c-head">
        <span class="c-tag ${hero ? 'hero' : ''}">${hero ? FRIEND_TAG : (id === 'spotlight' ? 'SPOTLIGHT' : 'KEY RACE')}</span>
        <span class="c-title">${(race?.title || '').toUpperCase()}</span>
        <span class="c-place">${hero ? 'DUTCHESS COUNTY, NY' : (race?.stateName || '').toUpperCase()}</span>
        <span class="c-status"></span>
      </div>
      ${wide ? `<div class="w-out"><div class="wo-l"><div class="wo-k">MY PREDICTION FOR THE FINAL RESULT <small>counted so far + expected Election Day votes</small></div><div class="wo-win">—</div><div class="wo-nums"></div><div class="wo-badge">—</div></div>
          <div class="wo-r"><div class="wo-say"></div><div class="wo-gauge"><div class="wo-g-bar"><u></u><i class="wo-best"></i></div><div class="wo-g-lbl"><span class="wo-need-l"></span><span class="wo-best-l"></span></div></div><div class="wo-eds"></div></div></div>
      <div class="w-grid"><div class="w-col w-a"><div class="c-cands"></div><div class="w-share"></div><div class="c-await"></div>
        <div class="c-side"><div class="c-meter"><div class="m-lbl">ELECTION DISTRICTS FULLY IN</div><div class="m-val">—</div><div class="m-bar"><u></u></div></div><div class="c-spark"><svg preserveAspectRatio="none"></svg></div><div class="c-upd">UPDATED <b>—</b></div></div></div>
        <div class="w-col w-b"><div class="w-eds"></div><div class="w-mix"></div></div></div>` : `
      ${hero ? '<div class="c-await"></div>' : ''}
      <div class="c-body">
        <div class="c-cands"></div>
        ${hero ? '<div class="c-eds"></div>' : '<div class="c-watch"></div>'}
        <div class="c-side">
          <div class="c-meter"><div class="m-lbl">${hero ? 'ELECTION DISTRICTS' : 'EXPECTED VOTE IN'}</div><div class="m-val">—</div><div class="m-bar"><u></u></div></div>
          <div class="c-spark"><div class="m-lbl">VOTE TREND</div><svg preserveAspectRatio="none"></svg></div>
          <div class="c-upd">UPDATED <b>—</b></div>
        </div>
      </div>`}`;
    const cwrap = qs(card, '.c-cands');
    for (const c of cands) {
      const row = el('div', 'c-cand');
      row.style.setProperty('--pc', col(c.party));
      row.innerHTML = `
        <div class="cc-slab"></div>
        <div class="cc-img"><img alt="" /><span class="cc-ini"></span></div>
        <div class="cc-main">
          <div class="cc-top"><span class="cc-name"></span><span class="cc-party"></span><span class="cc-win"></span></div>
          <div class="cc-bar"><u></u></div>
          ${hero ? '<div class="cc-methods"></div>' : ''}
        </div>
        <div class="cc-nums"><div class="cc-votes">0</div><div class="cc-pct">—</div></div>
        ${hero ? '' : '<div class="cc-prob"><div><small>NYT FORECAST<i>chance to win</i></small><b class="pm">—</b></div><div><small>BETTORS SAY<i>chance to win</i></small><b class="ko">—</b></div></div>'}`;
      const img = qs(row, 'img');
      if (c.img) { img.src = c.img; img.onerror = () => { img.style.display = 'none'; }; } else img.style.display = 'none';
      if (!c.img) setText(qs(row, '.cc-ini'), c.name.split(' ').map((w) => w[0]).slice(0, 2).join(''));
      setText(qs(row, '.cc-name'), c.name.toUpperCase());
      setText(qs(row, '.cc-party'), { DEM: 'DEM', GOP: 'GOP', LIB: 'LIB', GRN: 'GRN' }[c.party] || c.party);
      cwrap.appendChild(row);
      refs.cands[c.id] = {
        row, votes: qs(row, '.cc-votes'), pct: qs(row, '.cc-pct'), bar: qs(row, '.cc-bar u'), win: qs(row, '.cc-win'),
        pm: qs(row, '.pm'), ko: qs(row, '.ko'), methods: qs(row, '.cc-methods'),
      };
    }
    refs.card = card; refs.status = qs(card, '.c-status'); refs.await = qs(card, '.c-await');
    refs.mval = qs(card, '.m-val'); refs.mbar = qs(card, '.m-bar u'); refs.spark = qs(card, 'svg');
    refs.upd = qs(card, '.c-upd b'); refs.sparkBox = qs(card, '.c-spark'); refs.hero = hero; refs.wide = wide; refs.key = race?.key;
    refs.watch = qs(card, '.c-watch'); refs.share = qs(card, '.w-share'); refs.weds = qs(card, '.w-eds'); refs.wmix = qs(card, '.w-mix'); refs.wout = qs(card, '.w-out');
    host.appendChild(card);
  }

  function updateCard() {
    if (!refs || !seg) return;
    if (refs.id === 'balance') return updateBalance();
    const race = raceNode(state, refs.key) || seg.race;
    if (!race) return;
    const st = statusOf(race);
    setText(refs.status, st.txt);
    refs.status.className = 'c-status ' + st.cls;
    const hasVotes = (race.totalVotes || 0) > 0;
    const lead = Math.max(...race.candidates.map((c) => c.votes || 0));
    for (const c of race.candidates) {
      const R = refs.cands[c.id]; if (!R) continue;
      tweenNumber(R.votes, c.votes || 0, { dur: 1200 });
      setText(R.pct, hasVotes ? fmtPct(c.pct) : '—');
      R.bar.style.width = pctW(hasVotes ? c.pct : 0);
      R.row.classList.toggle('leading', hasVotes && c.votes === lead);
      R.row.classList.toggle('winner', !!c.winner);
      setText(R.win, c.winner ? 'WINNER ✓' : (c.incumbent ? 'INCUMBENT' : ''));
      if (R.pm) { setText(R.pm, c.winProb != null ? fmtProb(c.winProb) : '—'); }
      if (R.ko) { setText(R.ko, c.odds != null ? `${Math.round(c.odds * 100)}%` : '—'); }
      if (R.methods && c.methods) {
        const m = c.methods;
        const parts = [['ELECTION DAY', m['Election Day']], ['EARLY VOTING', m['Early Voting']], ['ABSENTEE', m['Absentee/EMB']], ['AFFIDAVIT', m['Affidavit']]];
        const html = refs.wide ? stackBar(m, Math.max(1, ...race.candidates.map((x) => x.votes || 0))) + `<div class="w-ec-m">${methodText(m) || '<span>NO VOTES YET</span>'}</div>` : parts.map(([l, v]) => `<span><small>${l}</small><b>${fmtInt(v || 0)}</b></span>`).join('');
        if (R.methods.dataset.h !== html) { R.methods.innerHTML = html; R.methods.dataset.h = html; }
      }
    }
    if (refs.wide && refs.share) {
      const cs = realCands(race.candidates);
      const html = `<div class="w-share-bar">${cs.map((c) => `<i style="width:${hasVotes ? c.pct.toFixed(2) : 100 / cs.length}%;background:${col(c.party)};box-shadow:0 0 .8vw ${col(c.party)}">${c.pct >= 15 || !hasVotes ? `<span>${hasVotes ? c.pct.toFixed(1) + '%' : lastName(c.name)}</span>` : ''}</i>`).join('')}<b class="w-mid"></b></div>` +
        (hasVotes && cs.length > 1 ? (() => { const so = cs.slice().sort((a, b) => b.votes - a.votes); return `<div class="w-lead" style="color:${col(so[0].party)}">${lastName(so[0].name)} LEADS BY <b>${fmtInt(so[0].votes - so[1].votes)}</b> VOTES · ${(so[0].pct - so[1].pct).toFixed(1)} PTS</div>`; })() : '');
      if (refs.share.dataset.h !== html) { refs.share.innerHTML = html; refs.share.dataset.h = html; }
    }
    if (refs.hero) {
      setText(refs.mval, `${race.reportingUnits || 0} OF ${race.totalUnits || 1}`);
      refs.mbar.style.width = pctW(race.totalUnits ? 100 * (race.reportingUnits || 0) / race.totalUnits : 0);
      const r = roush(race);
      if (r && !hasVotes) refs.cands[r.id]?.row.classList.add('star');
    } else {
      setText(refs.mval, race.eevp != null ? `${Math.round(race.eevp)}%` : '—');
      refs.mbar.style.width = pctW(race.eevp);
    }
    // sparkline
    const h = state.history?.[race.key];
    if (h && h.length > 1) {
      refs.sparkBox.classList.remove('empty');
      const top = race.candidates.filter((c) => !c.writeIn && c.party !== 'WRI').slice(0, 2);
      sparkline(refs.spark, h, (p) => {
        const o = {}; const tot = Object.values(p.v || {}).reduce((s, x) => s + x, 0) || 1;
        for (const c of top) o[col(c.party)] = 100 * (p.v?.[c.id] || 0) / tot; return o;
      });
    } else { refs.sparkBox.classList.add('empty'); refs.spark.innerHTML = ''; }
    if (refs.watch) {
      const html = watchBlock(race);
      if (refs.watch.dataset.h !== html) { refs.watch.innerHTML = html; refs.watch.dataset.h = html; }
      refs.watch.classList.toggle('on', !!html);
      // the WHAT TO WATCH block replaces an empty VOTE TREND area
      refs.sparkBox.classList.toggle('gone', !!html && refs.sparkBox.classList.contains('empty'));
      trimWatch();
    }
    tickCard();
  }

  function tickCard() {
    if (!refs || !state) return;
    if (refs.id === 'balance') return;
    const race = raceNode(state, refs.key) || seg?.race; if (!race) return;
    const now = Date.now();
    const t = race.updatedAt;
    setText(refs.upd, t ? ago(t, now) : '—');
    if (refs.wide) {
      const flash = (box, html) => { if (box && box.dataset.h !== html) { const first = !box.dataset.h; box.innerHTML = html; box.dataset.h = html; if (!first) { box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); } } };
      flash(refs.weds, edCards(race));
      flash(refs.wmix, mixPanel(race));
      updateOutlook(race);
    }
    if (refs.hero && !refs.wide) {
      const box = qs(refs.card, '.c-eds');
      const eds = race.edResults || [];
      if (box && eds.length) {
        const pcol = (p) => col(p);
        const html = '<div class="ed-h">DISTRICT RETURNS</div>' + eds.map((e) => {
          const cs = (e.candidates || []).filter((c) => c.party !== 'WRI');
          const rep = e.total > 0;
          const bars = cs.map((c) => `<i style="width:${rep ? c.pct : 0}%;background:${pcol(c.party)}"></i>`).join('');
          const nums = cs.map((c) => `<span style="color:${pcol(c.party)}">${(c.name.split(' ').pop() || '').toUpperCase()} <b>${fmtInt(c.votes)}</b>${rep ? ` <em>${c.pct.toFixed(0)}%</em>` : ''}</span>`).join('');
          const meth = rep ? cs.map((c) => `<span style="color:${pcol(c.party)}">${Object.entries(c.methods || {}).filter(([, v]) => v).map(([k, v]) => `${k.replace('Election Day', 'E-Day').replace('Early Voting', 'Early').replace('Absentee/EMB', 'Abs')} ${v}`).join(' · ')}</span>`).join('') : '';
          return `<div class="ed-row ${rep ? 'in' : ''}"><div class="ed-top"><span class="ed-n">${e.name.toUpperCase()}</span><span class="ed-s">${rep ? fmtInt(e.total) + ' VOTES' : 'AWAITING'}</span></div><div class="ed-bar">${bars}</div><div class="ed-nums">${nums}</div>${meth ? `<div class="ed-m">${meth}</div>` : ''}</div>`;
        }).join('');
        if (box.dataset.h !== html) { box.innerHTML = html; box.dataset.h = html; box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash'); }
      }
    }
    if (refs.hero && refs.await) {
      const hasVotes = (race.totalVotes || 0) > 0;
      const d = state.sources?.dutchess || {};
      let html;
      if (hasVotes) {
        html = progressBlock(race) + countedPanel(race, d, now);
      } else if (race.pollClose && Date.parse(race.pollClose) > now) {
        const c = countdown(race.pollClose, now);
        html = `<div class="aw-cd"><small>POLLS CLOSE IN</small><b>${c.text}</b><small>9:00 PM ET · ${(race.eds || []).map((e) => e.name.trim()).join(' · ').toUpperCase() || 'DUTCHESS COUNTY'}</small></div>`;
      } else {
        html = `<div class="aw-scan"><div class="aw-sweep"></div><div class="aw-t">AWAITING DUTCHESS COUNTY BOE</div><div class="aw-s">CHECKING EVERY 5s · LAST CHECK ${d.lastPoll ? ago(d.lastPoll, now) : '—'} · BOE LAST PUBLISHED ${d.publishDate ? etTime(d.publishDate, true) : '—'}${d.nextUpdateAt ? ' · NEXT ' + etTime(d.nextUpdateAt, true) : ''}</div><div class="aw-ed">${race.reportingUnits || 0} OF ${race.totalUnits || (race.eds || []).length || 1} ED${(race.totalUnits || 1) === 1 ? '' : 'S'} REPORTING</div></div>`;
      }
      if (refs.await.dataset.h !== html) {
        // keep sweep animation stable: only replace when the kind of panel changes or text changes
        refs.await.innerHTML = html; refs.await.dataset.h = html;
      }
      refs.card.classList.toggle('has-await', !hasVotes);
    }
  }

  function updateOutlook(race) {
    const W = refs.wout; if (!W) return;
    const o = computeOutlook(race);
    W.classList.toggle('pending', !o || !o.total);
    if (!o) return;
    if (!o.total) { setText(qs(W, '.wo-badge'), 'WAITING FOR FIRST RESULTS'); return; }
    const badge = qs(W, '.wo-badge');
    if (badge.dataset.c !== o.cls) { badge.dataset.c = o.cls; badge.className = 'wo-badge ' + o.cls; void badge.offsetWidth; W.classList.remove('flash'); void W.offsetWidth; W.classList.add('flash'); }
    badge.style.setProperty('--lc', col(o.lead.party));
    const T = lastName(o.trail.name), tc = col(o.trail.party), pn = o.trail.party === 'GOP' ? 'GOP' : 'DEM';
    const pt = o.projD + o.projR || 1, dp = 100 * o.projD / pt;
    const win = dp >= 50 ? o.D : o.R;
    const we = qs(W, '.wo-win'); setText(we, o.cls === 'done' ? `${lastName(win.name)} WINS` : o.cls === 'safe' ? `${lastName(win.name)} WILL WIN` : o.cls === 'likely' ? `${lastName(win.name)} LIKELY` : `${lastName(win.name)} SLIGHT EDGE`); we.style.color = col(win.party); we.style.textShadow = `0 0 1vw ${col(win.party)}`;
    const nums = `<span style="color:${col('DEM')}">${dp.toFixed(0)}%</span><i>–</i><span style="color:${col('GOP')}">${(100 - dp).toFixed(0)}%</span><small>MY ESTIMATE WHEN ALL VOTES ARE IN · NOW ${(100 * o.D.votes / ((o.D.votes + o.R.votes) || 1)).toFixed(0)}–${(100 * o.R.votes / ((o.D.votes + o.R.votes) || 1)).toFixed(0)} WITH EARLY + ABSENTEE ONLY</small>`;
    const ne = qs(W, '.wo-nums'); if (ne.dataset.h !== nums) { ne.innerHTML = nums; ne.dataset.h = nums; }
    const conf = { done: '✓ DONE · CAN\'T BE CAUGHT', safe: 'CONFIDENCE: SAFE', likely: 'CONFIDENCE: LIKELY', play: 'CONFIDENCE: TOSS-UP' }[o.cls];
    setText(badge, conf);
    const say = o.out <= 0 ? `All expected votes counted · lead ${fmtInt(o.margin)}`
      : o.need > 1 ? `${T} can't catch up: needs over 100% of the ${fmtInt(o.out)} votes left`
      : `<b style="color:${tc}">${T}</b> needs <b class="hl">${o.needPct.toFixed(0)}%</b> of the ${fmtInt(o.out)} votes left · best ${pn} Election Day here <b class="hl">${o.best.toFixed(0)}%</b> (${o.bestYr})`;
    const sayEl = qs(W, '.wo-say'); if (sayEl.dataset.h !== say) { sayEl.innerHTML = say; sayEl.dataset.h = say; }
    const g = qs(W, '.wo-g-bar u'); g.style.width = pctW(Math.min(100, o.needPct)); g.style.background = tc; g.style.boxShadow = `0 0 .8vw ${tc}`;
    qs(W, '.wo-best').style.left = pctW(o.best);
    setText(qs(W, '.wo-need-l'), o.need > 1 ? `${T} NEEDS OVER 100%` : `${T} NEEDS ${o.needPct.toFixed(0)}%`);
    setText(qs(W, '.wo-best-l'), `BEST EVER ${o.best.toFixed(0)}%`);
    // per-ED rows: build once, then update in place so bars animate
    const box = qs(W, '.wo-eds');
    if (box.childElementCount !== o.eds.length) {
      box.innerHTML = o.eds.map(() => `<div class="wo-ed"><div class="wo-ed-t"></div><div class="wo-ed-bar"><u></u><i></i></div><span class="pl"></span></div>`).join('');
    }
    o.eds.forEach((e, i) => {
      const row = box.children[i];
      const t = `<b>${e.name.replace(/^.*ED/i, 'ED').toUpperCase()}</b> ${fmtInt(e.counted)} in · ${fmtInt(e.out)} left <em class="${e.edayIn ? 'in' : 'pend'}">E-DAY ${e.edayIn ? 'IN' : 'OUT'}</em>`;
      const te = qs(row, '.wo-ed-t'); if (te.dataset.h !== t) { te.innerHTML = t; te.dataset.h = t; row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
      const den = Math.max(1, e.counted + e.out), lc = e.lead ? col(e.lead.party) : '#ffd23f';
      const cu = qs(row, '.wo-ed-bar u'); cu.style.width = pctW(100 * e.counted / den); cu.style.background = lc; cu.style.boxShadow = `0 0 .6vw ${lc}`;
      qs(row, '.wo-ed-bar i').style.width = pctW(100 * e.out / den);
      const ppt = e.pd + e.pr || 1, d = 100 * e.pd / ppt;
      const pl = qs(row, '.pl'); setText(pl, `→ ${d.toFixed(0)}–${(100 - d).toFixed(0)}`); pl.style.color = d >= 50 ? col('DEM') : col('GOP');
    });
  }

  function updateBalance() {
    const pc = state.partyControl || {};
    for (const ch of ['S', 'H']) {
      const B = qs(refs.card, `.bal[data-ch="${ch}"]`); const d = pc[ch]; if (!B || !d) continue;
      const D = d.party_balance?.DEM?.seats || 0, R = d.party_balance?.GOP?.seats || 0, O = d.party_balance?.OTH?.seats || 0;
      const tot = d.total || 100;
      const dn = qs(B, '.bal-seats .d b'), rn = qs(B, '.bal-seats .r b');
      tweenNumber(dn, D, { dur: 900 }); tweenNumber(rn, R, { dur: 900 });
      setText(qs(B, '.tw'), String(d.to_win?.DEM ?? '—'));
      qs(B, '.bal-bar .d').style.width = pctW(100 * D / tot);
      qs(B, '.bal-bar .r').style.width = pctW(100 * R / tot);
      qs(B, '.bal-bar .u').style.width = pctW(100 * (tot - D - R) / tot);
      qs(B, '.mark').style.left = pctW(100 * (d.to_win?.DEM || 0) / tot);
      setText(qs(B, '.called b'), String(d.num_races_called ?? 0));
      const od = state.odds?.[ch === 'S' ? 'CONTROLS-2026' : 'CONTROLH-2026'];
      const dd = od?.find((o) => /Democrat/i.test(o.name)), rr = od?.find((o) => /Republican/i.test(o.name));
      setText(qs(B, '.odds'), dd ? `Bettors give Dems a ${Math.round(dd.price * 100)}% chance to control, GOP ${Math.round((rr?.price || 0) * 100)}%` : 'BETTING ODDS —');
      const est = d.nyt_model_estimates || [];
      const ed = est.find((e) => e.nyt_party_id === 'DEM'), er = est.find((e) => e.nyt_party_id === 'GOP');
      setText(qs(B, '.bal-model span'), ed ? `D ${fmtProb(ed.win_probability)} · R ${er ? fmtProb(er.win_probability) : '—'}` : '—');
    }
  }

  // ---------- top & side ----------
  function segTitleFor(sg) {
    if (!sg) return 'ELECTION NIGHT';
    if (sg.titleOverride) return sg.titleOverride;
    if (sg.id === 'balance') return 'BALANCE OF POWER';
    if (sg.id === 'pineplains') return 'HOMETOWN WATCH: PINE PLAINS';
    if (sg.id === 'stanford-supv') return 'HOMETOWN WATCH: STANFORD SUPERVISOR';
    if (sg.id === 'stanford-council') return 'HOMETOWN WATCH: STANFORD TOWN COUNCIL';
    const r = sg.race;
    const nm = r ? `${r.stateName || ''} ${r.office || (r.officeId === 'G' ? 'Governor' : 'Senate')}`.replace('U.S. ', '').trim() : '';
    if (sg.id === 'spotlight') return `SPOTLIGHT: ${(nm || r?.title || '').toUpperCase()}`;
    return `KEY RACE: ${nm.toUpperCase()}`;
  }
  function stageLabel(sg) {
    if (!sg) return 'STANDBY';
    if (sg.id === 'pineplains') return 'PINE PLAINS, NY';
    if (String(sg.id).startsWith('stanford')) return 'STANFORD, NY';
    if (sg.id === 'balance') return 'U.S. SENATE';
    const r = sg.race; const st = (r?.stateName || '').toUpperCase();
    return st ? `${st} ${r?.officeId === 'G' || /gov/i.test(sg.id) ? 'COUNTIES' : 'COUNTIES'}` : 'COUNTIES';
  }
  function updateControl() {
    const c = $('.ov-ctrl'); if (!c) return;
    const pc = state.partyControl || {};
    for (const [ch, code, name] of [['senate', 'S', 'Senate'], ['house', 'H', 'House']]) {
      const row = qs(c, `.cg-row[data-ch="${ch}"]`); if (!row) continue;
      const ctl = state.control?.[ch] || {};
      const P = pc[code] || {};
      const D = ctl.seats?.DEM ?? P.party_balance?.DEM?.seats ?? 0;
      const R = ctl.seats?.GOP ?? P.party_balance?.GOP?.seats ?? 0;
      const tot = ctl.seats?.total || P.total || (code === 'S' ? 100 : 435);
      const toWin = ctl.seats?.toWin?.DEM ?? ctl.seats?.toWin ?? P.to_win?.DEM ?? (code === 'S' ? 51 : 218);
      qs(row, '.ov-ctrl-bar .d').style.width = pctW(100 * D / tot);
      qs(row, '.ov-ctrl-bar .r').style.width = pctW(100 * R / tot);
      qs(row, '.ov-ctrl-bar .u').style.width = pctW(100 * Math.max(0, tot - D - R) / tot);
      setText(qs(row, '.ov-ctrl-nums .d b'), String(D));
      setText(qs(row, '.ov-ctrl-nums .r b'), String(R));
      setText(qs(row, '.ov-ctrl-nums .u'), `${typeof toWin === 'number' ? toWin : ''} TO WIN`);
      const o = ctl.odds || {};
      const dem = o.DEM, gop = o.GOP;
      const bet = qs(row, '.cg-bet');
      if (dem != null) {
        const fav = dem >= gop ? ['Dems', dem, 'd'] : ['GOP', gop, 'r'];
        const html = `Bettors: <em class="${fav[2]}">${fav[0]} ${Math.round(fav[1] * 100)}%</em> to win the ${name}`;
        if (bet.innerHTML !== html) { bet.innerHTML = html; row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }
      }
      const src = [];
      if (o.kalshi?.DEM != null) src.push(`Kalshi D ${Math.round(o.kalshi.DEM * 100)}%`);
      if (o.polymarket?.DEM != null) src.push(`Polymarket D ${Math.round(o.polymarket.DEM * 100)}%`);
      const m = ctl.model?.DEM ?? ctl.model?.winProb?.DEM;
      if (m != null) src.push(`NYT forecast D ${Math.round((m > 1 ? m / 100 : m) * 100)}%`);
      setText(qs(row, '.cg-src'), src.join(' · ') || 'odds loading…');
      let cb = qs(row, '.cg-call');
      if (!cb) { cb = el('div', 'cg-call'); row.insertBefore(cb, row.children[1]); }
      const call = ctl.call, PNM = { DEM: 'DEMOCRATS', GOP: 'REPUBLICANS' };
      const nc = ctl.networkCall && (!call || call.by !== 'AP') ? `${ctl.networkCall.sources.join(' & ').toUpperCase()} PROJECT${ctl.networkCall.sources.length > 1 ? '' : 'S'}: ${PNM[ctl.networkCall.party]} WIN THE ${name.toUpperCase()} · AP not yet` : '';
      const ct = nc || (call ? (call.by === 'AP' ? `✓ AP CALL: ${PNM[call.party]} WIN THE ${name.toUpperCase()}` : `PROJECTION: ${PNM[call.party]} WILL WIN THE ${name.toUpperCase()} · not yet called by AP`) : '');
      setText(cb, ct); cb.style.display = ct ? '' : 'none'; cb.dataset.p = call?.party || ''; cb.classList.toggle('ap', call?.by === 'AP');
    }
  }
  function tickTop() {
    const now = Date.now();
    setText(clockT, etTime(now, true).replace(/ ?[AP]M$/, '') + ' ' + (new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true }).slice(-2)));
    let txt = 'ALL POLLS CLOSED';
    const pcs = state?.pollClosings;
    if (Array.isArray(pcs)) {
      const tm = (p) => Date.parse(p.poll_closing_time || p.pollClosingTime || '');
      let best = Infinity;
      for (const p of pcs) { const t = tm(p); if (Number.isFinite(t) && t > now && t < best) best = t; }
      if (best < Infinity) {
        const sts = [...new Set(pcs.filter((p) => tm(p) === best).map((p) => p.reporting_unit?.state_postal || p.state).filter(Boolean))];
        const c = countdown(new Date(best).toISOString(), now);
        const more = sts.length > 4 ? ` +${sts.length - 4}` : '';
        txt = `${sts.slice(0, 4).join(' · ')}${more} in ${c.text}`;
      }
    }
    setText(nextVal, txt);
    if (state) {
      const s = state.sources || {};
      const lv = (age, g, a) => (age == null ? 'bad' : age < g ? 'ok' : age < a ? 'warn' : 'bad');
      const fm = {
        dutchess: [s.dutchess?.lastPoll, 45e3, 120e3], nyt: [s.nyt?.lastPoll, 60e3, 180e3],
        kalshi: [s.kalshi?.lastPoll, 90e3, 300e3], news: [s.news?.lastPoll, 300e3, 900e3],
      };
      for (const k in fm) {
        const [t, g, a] = fm[k]; const row = qs(root, `.ov-feed[data-f="${k}"]`);
        const age = t ? now - t : null; const lvl = (s[k]?.ok === false) ? 'bad' : lv(age, g, a);
        row.className = 'ov-feed ' + lvl;
        setText(qs(row, 'em'), t ? ago(t, now).replace(' ago', '') : '—');
      }
      setText(qs(root, '.ov-boe b'), s.dutchess?.publishDate ? etTime(s.dutchess.publishDate, true) : '—');
    }
    tickCard();
  }
  setInterval(tickTop, 1000);
  const fitWide = () => root.querySelectorAll('.w-col').forEach(fitBox);
  setInterval(fitWide, 1000);
  window.addEventListener('resize', fitWide);

  // ---------- public API ----------
  return {
    update(s) {
      state = s;
      for (const k of WATCH) updateTile(k, raceNode(s, k));
      updateControl();
      if (seg && !refs) buildCard(seg);
      if (seg) {
        if (seg.id !== 'balance' && seg.id === 'spotlight') {
          const nk = s.spotlight?.[0]?.key;
          if (refs && nk && nk !== refs.key && !seg.locked) { /* keep current spotlight until next segment */ }
        }
        updateCard();
      }
      tickTop();
    },
    showSegment: showSegment,
    __x: 0,
    onEvent(ev) {
      const k = ev?.raceKey; const T = tiles[k];
      if (T) { T.root.classList.remove('flash'); void T.root.offsetWidth; T.root.classList.add('flash'); }
    },
  };
  function showSegment(sg) {
      seg = sg;
      root.classList.toggle('ov-wide', WIDE.has(sg?.id));
      setText(segTitle, segTitleFor(sg));
      const st = $('.ov-seg');
      st.classList.remove('glitch'); void st.offsetWidth; st.classList.add('glitch');
      markActiveTile();
      setText($('.st-lbl'), stageLabel(sg));
      setText($('.st-co'), ({ pineplains: '41.82N 73.65W', 'stanford-supv': '41.90N 73.67W', 'stanford-council': '41.90N 73.67W', balance: 'WASHINGTON DC' })[sg.id] || ((sg.race?.stateName || 'USA').toUpperCase()));
      // wipe out old card, then build the new one
      const old = host.firstElementChild;
      const tok = (showSegment.tok = (showSegment.tok || 0) + 1);
      const go = () => { if (tok !== showSegment.tok) return; buildCard(sg); if (state) updateCard(); if (refs?.wide) { fitWide(); setTimeout(fitWide, 700); } };
      if (old) { old.classList.remove('in'); old.classList.add('out'); setTimeout(go, 280); } else go();
  }
}
