// AHEAD OF THE NEWS: data-derived predictions — what gets called next, what clinches the Senate,
// where the current leader is likely to lose (reversals), live upsets, and news-vs-data.
import { partyColor as col, el } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const OFF = { S: 'SENATE', G: 'GOVERNOR' };
const L = (c) => (c?.last || c?.name || '').toUpperCase();

export function derive(state) {
  const out = [];
  const races = (state?.races || []).filter((r) => (r.officeId === 'S' || r.officeId === 'G') && !r.candidates.some((c) => c.winner));
  const fav = (r) => [...r.candidates].filter((c) => c.winProb != null).sort((a, b) => b.winProb - a.winProb)[0];
  const lead = (r) => (r.totalVotes ? [...r.candidates].sort((a, b) => b.votes - a.votes)[0] : null);
  // 1) NEXT CALL: high certainty × high % in
  const ready = races.map((r) => ({ r, f: fav(r) })).filter((x) => x.f && x.r.eevp > 0)
    .map((x) => ({ ...x, score: x.f.winProb * Math.min(1, x.r.eevp / 90) }))
    .sort((a, b) => b.score - a.score);
  if (ready[0] && ready[0].f.winProb >= 0.9) {
    const { r, f } = ready[0];
    out.push({ k: 'NEXT CALL LIKELY', big: `${(r.stateName || '').toUpperCase()} ${OFF[r.officeId]}`, line: `${L(f)} (${f.party === 'DEM' ? 'D' : f.party === 'GOP' ? 'R' : 'I'}) · forecast ${Math.round(100 * f.winProb)}% · ${Math.round(r.eevp)}% counted`, p: f.party });
  }
  // 2) SENATE CLINCHER
  const sen = state?.control?.senate?.seats || {};
  const need = (sen.toWin || 51) - (sen.DEM || 0);
  if (need > 0) {
    const dS = races.filter((r) => r.officeId === 'S').map((r) => ({ r, d: r.candidates.find((c) => c.party === 'DEM') })).filter((x) => x.d?.winProb != null)
      .sort((a, b) => (b.d.winProb * (0.4 + (b.r.eevp || 0) / 166)) - (a.d.winProb * (0.4 + (a.r.eevp || 0) / 166)));
    if (dS[need - 1]) {
      const { r, d } = dS[need - 1];
      out.push({ k: need === 1 ? 'THE SENATE CLINCHER' : `SEAT 51 MOST LIKELY FROM`, big: `${(r.stateName || '').toUpperCase()}`, line: `${L(d)} · forecast ${Math.round(100 * d.winProb)}% · ${Math.round(r.eevp || 0)}% counted · Dems need ${need}`, p: 'DEM' });
    }
  }
  // 3) REVERSAL WATCH: current leader ≠ forecast favorite (≥ 70%)
  for (const r of races) {
    const f = fav(r), l = lead(r);
    if (f && l && f.party !== l.party && f.winProb >= 0.7 && r.eevp < 90) {
      out.push({ k: 'REVERSAL WATCH', big: `${(r.stateName || '').toUpperCase()} ${OFF[r.officeId]}`, line: `${L(l)} leads now, but the vote still out favors ${L(f)} (${Math.round(100 * f.winProb)}%)`, p: f.party });
      if (out.filter((x) => x.k === 'REVERSAL WATCH').length >= 3) break;
    }
  }
  // 4) UPSET ALERT: underdog (pre-election rating) leading with ≥ 30% counted
  for (const r of races) {
    const l = lead(r); if (!l || !r.rating || r.eevp < 30) continue;
    const favP = /dem$/.test(r.rating) ? 'DEM' : /rep$/.test(r.rating) ? 'GOP' : null;
    if (favP && l.party !== favP && (l.winProb ?? 0) >= 0.5) { // forecast must agree the underdog is now favored
      const t = [...r.candidates].sort((a, b) => b.votes - a.votes);
      out.push({ k: 'UPSET ALERT', big: `${(r.stateName || '').toUpperCase()} ${OFF[r.officeId]}`, line: `${L(l)} leads by ${(t[0].pct - t[1].pct).toFixed(1)} · race was rated ${String(r.rating).replace('-', ' ')} · ${Math.round(r.eevp)}% in`, p: l.party });
      if (out.filter((x) => x.k === 'UPSET ALERT').length >= 2) break;
    }
  }
  // 5) NEWS vs DATA (chamber control)
  for (const ch of ['senate', 'house']) {
    const c = state?.control?.[ch]; if (!c) continue;
    const net = c.networkCall, seats = c.seats || {};
    if (net && c.call?.by !== 'AP') {
      const gap = (seats.toWin || 0) - (seats[net.party] || 0);
      out.push({ k: 'NEWS vs DATA', big: `${ch.toUpperCase()}: CALLED BY ${net.sources.length} NETWORK${net.sources.length > 1 ? 'S' : ''}`, line: `AP count: ${seats[net.party] ?? '—'} of ${seats.toWin} needed${gap > 0 ? ` · ${gap} to go` : ''} · bettors ${Math.round(100 * (c.odds?.[net.party] ?? 0))}%`, p: net.party });
    }
  }
  return out;
}

export function createAhead(root) {
  const board = el('div', 'ah-board');
  root.appendChild(board);
  let state = null, on = false;
  function render() {
    if (!on || !state) return;
    const items = derive(state);
    const html = `<div class="ah-kick">AHEAD OF THE NEWS · what the data says is coming</div>
      <div class="ah-grid">${items.map((x) => `<div class="ah-c" style="--pc:${col(x.p || 'OTH')}"><div class="ah-k">${esc(x.k)}</div><div class="ah-big">${esc(x.big)}</div><div class="ah-line">${esc(x.line)}</div></div>`).join('') || '<div class="ah-none">Nothing pending — everything major is called.</div>'}</div>
      <div class="ah-foot">Predictions from the NYT/AP live forecast + current count · not official calls</div>`;
    if (board.dataset.h !== html) { board.innerHTML = html; board.dataset.h = html; }
  }
  return {
    update(s) { state = s; render(); },
    showSegment(seg) { on = seg?.id === 'ahead'; board.classList.toggle('on', on); render(); },
    onEvent() {},
  };
}
