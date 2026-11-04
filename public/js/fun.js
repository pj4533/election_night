// FUN segment: meme-style text-and-graphics cards. Every punchline is computed from live data.
import { el } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const U = (s) => esc(String(s).toUpperCase());
const OFF = { S: 'SENATE', G: 'GOVERNOR' };
const won = (r) => r.candidates?.find((c) => c.winner);
const top2 = (r) => [...(r.candidates || [])].filter((c) => c.party !== 'WRI').sort((a, b) => (b.votes || 0) - (a.votes || 0)).slice(0, 2);
const isDone = (w) => w.candidates.some((c) => c.winner) || /call|decid|final/i.test(w.callStatus || '') || (w.totalUnits > 0 && w.reportingUnits >= w.totalUnits) || (w.reporting?.pollingPlaces?.length > 0 && w.reporting.pollingPlaces.every((p) => p.scannersReporting >= p.scanners));
const mv = (c, m) => c?.methods?.[m] ?? 0;

export function buildCards(state) {
  const cards = [];
  const add = (top, mid, bottom, hue = 'm') => cards.push({ top, mid, bottom, hue });
  const big = (t, cls = '') => `<div class="fn-big ${cls}">${t}</div>`;
  const watch = state.watch || [];
  const races = (state.races || []).filter((r) => r.candidates?.length);

  // local: early vote beat the Election Day winner
  const pp = watch.find((w) => w.key === 'pineplains');
  if (pp) {
    const [a, b] = top2(pp); // a leads
    if (a && b && mv(a, 'Early Voting') > mv(b, 'Early Voting') && (b.votes || 0) < a.votes) {
      const done = isDone(pp);
      add(`WHY ${done ? 'DID' : 'IS'} ${U(b.name.split(' ').pop())} ${done ? 'LOSE' : 'BEHIND'}?`,
        big(`<span class="fn-d">${mv(a, 'Early Voting')}</span><i>–</i><span class="fn-r">${mv(b, 'Early Voting')}</span>`),
        `EARLY VOTERS: ${mv(a, 'Early Voting')}–${mv(b, 'Early Voting')}`, 'c');
      if (mv(b, 'Election Day') > mv(a, 'Election Day')) add(`${U(b.name.split(' ').pop())} WON ELECTION DAY`, big(`${mv(b, 'Election Day')}–${mv(a, 'Election Day')}`), 'BUT THE EARLY VOTE SAID NO', 'y');
      add(`${U(a.name)} ${isDone(pp) ? 'WON' : 'LEADS'} BY`, big(String(a.votes - b.votes)), 'PINE PLAINS SUPERVISOR · REAL VOTES', 'm');
    }
  }
  // local: Stanford council early vs election day
  const st = watch.find((w) => w.key === 'stanford-council');
  if (st) {
    const [a, b] = top2(st);
    if (a && b && mv(b, 'Election Day') > mv(a, 'Election Day') && mv(a, 'Early Voting') > mv(b, 'Early Voting')) {
      const ln = (c) => c.name.split(' ').pop().toUpperCase();
      add(`WHY ${isDone(st) ? 'DID' : 'IS'} ${esc(ln(b))} ${isDone(st) ? 'LOSE' : 'BEHIND'}?`,
        big(`<span class="fn-r">${mv(b, 'Election Day')}–${mv(a, 'Election Day')}</span><small>ELECTION DAY</small><span class="fn-d">${mv(b, 'Early Voting')}–${mv(a, 'Early Voting')}</span><small>EARLY VOTE</small>`, 'two'),
        `${esc(ln(b))} WON ELECTION DAY… BUT THE EARLY VOTE SAID NO`, 'c');
    }
  }
  // GOP flips
  const flips = races.filter((r) => r.gained && won(r));
  const gopFlips = flips.filter((r) => won(r).party === 'GOP').length + (state.control?.house?.seats?.flips?.GOP || 0);
  const demFlips = flips.filter((r) => won(r).party === 'DEM').length + (state.control?.house?.seats?.flips?.DEM || 0);
  if (gopFlips === 0 && demFlips > 0) add('REPUBLICAN FLIPS TONIGHT:', big('0', 'zero'), 'DEMOCRATIC FLIPS: ' + demFlips, 'r');
  // TX flip
  const tx = races.find((r) => r.key === 'tx-sen' || (r.stateName === 'Texas' && r.officeId === 'S'));
  if (tx && tx.gained && won(tx)) {
    const w = won(tx), l = top2(tx).find((c) => c !== w);
    add('TEXAS SENATE:', big(`${U(w.last || w.name)} FLIPS IT`, 'txt'), `${w.votes && l ? (w.votes / 1e6).toFixed(1) + 'M TO ' + (l.votes / 1e6).toFixed(1) + 'M' : 'DEMOCRATS PICK UP A SEAT'}`, 'c');
  }
  // blowout / closest
  const margin = (r) => { const [a, b] = top2(r); return a && b && r.totalVotes ? { a, b, m: (a.votes - b.votes) / ((a.votes + b.votes) || 1) * 100 } : null; };
  const called = races.filter((r) => ['S', 'G'].includes(r.officeId) && won(r) && margin(r)).map((r) => ({ r, ...margin(r) })).filter((x) => x.a === won(x.r));
  const blow = called.sort((x, y) => y.m - x.m)[0];
  if (blow) add('BIGGEST BLOWOUT OF THE NIGHT', big(`+${blow.m.toFixed(0)}`), `${U(blow.r.stateName)} ${OFF[blow.r.officeId]} · ${U(blow.a.last || blow.a.name)}`, 'y');
  const open = races.filter((r) => ['S', 'G'].includes(r.officeId) && !won(r) && (r.eevp || 0) > 20 && margin(r) && (margin(r).a.votes > 0)).map((r) => ({ r, ...margin(r) })).sort((x, y) => x.m - y.m)[0];
  if (open) add('CLOSEST RACE STILL COUNTING', big(open.m.toFixed(1), 'pts'), `${U(open.r.stateName)} ${OFF[open.r.officeId]} · ${open.m.toFixed(1)} PTS`, 'm');
  // upset vs rating
  const up = flips.filter((r) => /rep$/.test(r.rating || '') && won(r).party === 'DEM').sort((x, y) => (/solid/.test(y.rating) ? 1 : 0) - (/solid/.test(x.rating) ? 1 : 0))[0];
  if (up) add(`RATED ${U(up.rating.replace('-', ' '))}…`, big(U(up.stateName), 'txt'), `${U(won(up).last || won(up).name)} WON ANYWAY`, 'c');
  return cards.slice(0, 10);
}

export function createFun(root) {
  const stage = el('div', 'fn-board');
  root.appendChild(stage);
  let state = null, on = false, cards = [], i = 0, timer = null, sig = '';

  function draw(first) {
    if (!on) return;
    if (!cards.length) { stage.innerHTML = '<div class="fn-card h-m"><div class="fn-top">MEANWHILE…</div><div class="fn-big txt">LOADING THE MEMES</div><div class="fn-bot">STAND BY</div></div>'; return; }
    const c = cards[i % cards.length];
    stage.innerHTML = `<div class="fn-card h-${c.hue}"><div class="fn-top">${c.top}</div>${c.mid}<div class="fn-bot">${c.bottom}</div><div class="fn-dots">${cards.map((_, k) => `<b class="${k === i % cards.length ? 'on' : ''}"></b>`).join('')}</div></div>`;
  }
  function tick() { i = (i + 1) % Math.max(cards.length, 1); draw(); }
  function recompute() {
    if (!state) return;
    try { cards = buildCards(state); } catch (e) { console.error('fun', e); cards = []; }
    const s = JSON.stringify(cards);
    if (s !== sig) { sig = s; if (i >= cards.length) i = 0; draw(); }
  }
  return {
    update(s) { state = s; recompute(); },
    showSegment(seg) {
      on = seg?.id === 'fun'; stage.classList.toggle('on', on);
      clearInterval(timer);
      if (on) { i = 0; recompute(); draw(true); timer = setInterval(tick, 7000); }
    },
    onEvent() {},
  };
}
