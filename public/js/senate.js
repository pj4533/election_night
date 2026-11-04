// SENATE WATCH: "have Democrats won the Senate yet?" — takeover of left column + stage window during the 'senate' segment.
import { partyColor as col, fmtPct, el } from './util.js';

const PN = { DEM: 'DEMS', GOP: 'GOP' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createSenate(root) {
  const board = el('div', 'sw-board');
  root.appendChild(board);
  let state = null, on = false;

  function races() {
    return (state?.races || []).filter((r) => r.officeId === 'S');
  }
  function render() {
    if (!on || !state) return;
    const c = state.control?.senate || {};
    const seats = c.seats || {};
    const D = seats.DEM || 0, R = seats.GOP || 0, need = seats.toWin || 51, tot = seats.total || 100;
    const all = races();
    const open = all.filter((r) => !r.candidates.some((x) => x.winner));
    const rows = open.map((r) => {
      const two = r.candidates.filter((x) => x.party === 'DEM' || x.party === 'GOP' || x.party === 'OTH').slice(0, 2);
      const lead = [...two].sort((a, b) => (b.votes - a.votes) || ((b.winProb || 0) - (a.winProb || 0)))[0];
      const dem = two.find((x) => x.party === 'DEM');
      const fav = [...two].sort((a, b) => (b.winProb ?? 0) - (a.winProb ?? 0))[0];
      return { r, two, lead, dem, fav, dProb: dem?.winProb ?? null };
    });
    const demFav = rows.filter((x) => x.fav?.party === 'DEM').length;
    const stillNeed = Math.max(0, need - D);
    const won = c.call?.by === 'AP' && c.call.party === 'DEM' || D >= need;
    const exp = c.model?.expectedSeats || {};
    const head = won ? '✓ DEMOCRATS HAVE WON THE SENATE' : `MAGIC NUMBER: ${stillNeed} <small>more seat${stillNeed === 1 ? '' : 's'} for Democratic control</small>`;
    const sub = won ? `${D} seats called` : `Favored in ${demFav} of ${open.length} uncalled races · NYT projects ${exp.DEM ?? '—'}–${exp.GOP ?? '—'}`;
    const projBadge = c.call && c.call.by !== 'AP' ? `<span class="sw-proj">PROJECTED: DEMS WIN THE SENATE</span>` : '';
    const pctD = (100 * D) / tot, pctR = (100 * R) / tot, mark = (100 * need) / tot;
    const projD = rows.filter((x) => x.fav?.party === 'DEM').length;
    const pctPD = (100 * projD) / tot;
    const closeness = (x) => Math.abs((x.fav?.winProb ?? 1) - 0.5);
    rows.sort((a, b) => closeness(a) - closeness(b)); // closest first (by favorite's NYT win chance)
    // split: IN CONTENTION (favorite < 90% per NYT) vs SAFE (≥ 90%)
    const SAFE_AT = 0.9;
    const contested = rows.filter((x) => (x.fav?.winProb ?? 0) < SAFE_AT);
    const safe = rows.filter((x) => (x.fav?.winProb ?? 0) >= SAFE_AT);
    const chip = ({ r, fav }) => `<span class="sw-chip" style="--pc:${col(fav?.party || 'OTH')}">${esc((r.stateName || r.state || '').toUpperCase())} <b>${fav ? esc((fav.last || fav.name).toUpperCase()) : ''} ${fav?.winProb != null ? Math.round(100 * fav.winProb) + '%' : ''}</b></span>`;
    const safeD = safe.filter((x) => x.fav?.party === 'DEM'), safeR = safe.filter((x) => x.fav?.party !== 'DEM');
    const info = (r) => {
      // non-GOP side = the Democrat, or the leading independent where no Democrat runs (e.g. Osborn in Nebraska)
      const d = r.candidates.find((x) => x.party === 'DEM') || r.candidates.find((x) => x.party !== 'GOP' && x.party !== 'WRI'), g = r.candidates.find((x) => x.party === 'GOP');
      const tv = (d?.votes || 0) + (g?.votes || 0);
      const dp = tv ? (100 * (d?.votes || 0)) / tv : null;
      const lead = !tv ? null : (d?.votes || 0) >= (g?.votes || 0) ? d : g;
      const trail = lead === d ? g : d;
      const pts = tv ? Math.abs((lead.pct || 0) - (trail?.pct || 0)) : 0;
      const votes = tv ? Math.abs((d?.votes || 0) - (g?.votes || 0)) : 0;
      const eevp = Math.round(r.eevp || 0);
      const L = lead ? (lead.last || lead.name).toUpperCase() : '';
      const status = !tv ? 'NO VOTES YET' : pts < 2 ? 'TOO CLOSE TO CALL' : eevp < 30 ? `EARLY · ${L} AHEAD` : pts < 6 ? `${L} SLIGHT EDGE` : `${L} PULLING AWAY`;
      const cls = !tv ? 'wait' : pts < 2 ? 'close' : pts < 6 ? 'edge' : 'away';
      return { d, g, dp, lead, pts, votes, eevp, status, cls };
    };
    const tiles = contested.map(({ r, fav }) => {
      const I = info(r);
      const dl = I.d ? (I.d.last || I.d.name).toUpperCase() : 'DEM', gl = I.g ? (I.g.last || I.g.name).toUpperCase() : 'GOP';
      const fp = fav?.winProb != null ? Math.round(100 * fav.winProb) : null;
      return `<div class="sw-t ${I.cls}" style="--pc:${col(I.lead?.party || fav?.party || 'OTH')}">
        <div class="sw-row1"><span class="sw-st">${esc((r.stateName || r.state || '').toUpperCase())}</span><span class="sw-in">${I.eevp ? I.eevp + '% IN' : 'NO VOTES'}</span></div>
        <div class="sw-mg">${I.lead ? `${esc((I.lead.last || I.lead.name).toUpperCase())} <b>+${I.pts.toFixed(1)}</b> <small>${I.votes.toLocaleString('en-US')} votes</small>` : '—'}</div>
        <div class="sw-split"><i class="d" style="width:${I.dp ?? 50}%"></i><i class="r"></i><span class="sw-mid"></span></div>
        <div class="sw-names"><span class="d">${esc(dl)}</span><span class="r">${esc(gl)}</span></div>
        <div class="sw-status">${I.status}${fp != null ? ` · <span>NYT: ${esc((fav.last || fav.name).toUpperCase())} ${fp}%</span>` : ''}${fav?.odds != null ? ` · <span>BETTORS ${Math.round(100 * fav.odds)}%</span>` : ''}</div>
      </div>`;
    }).join('');
    // derived path to 51
    const cInfo = contested.map((x) => ({ x, I: info(x.r) }));
    const dLeadClose = cInfo.filter(({ I }) => I.lead?.party === 'DEM').length;
    const needAfterSafe = Math.max(0, stillNeed - safeD.length);
    const ifHold = D + safeD.length + dLeadClose;
    const pathLine = won ? '' : `<div class="sw-path">PATH TO 51: ${safeD.length} near-certain → need <b>${needAfterSafe}</b> of these ${contested.length} close races · Dems lead in <b>${dLeadClose}</b> · if every current leader holds: <b class="${ifHold >= need ? 'ok' : 'no'}">DEMS ${ifHold}</b></div>`;
    const H = state.control?.house;
    const house = H ? `<div class="sw-house">HOUSE: ${H.call ? (H.call.by === 'AP' ? `✓ AP CALL: ${H.call.party === 'DEM' ? 'DEMOCRATS' : 'REPUBLICANS'} WIN` : `PROJECTED ${H.call.party === 'DEM' ? 'DEMOCRATS' : 'REPUBLICANS'} · effectively decided`) : 'undecided'} · D ${H.seats?.DEM ?? '—'} – R ${H.seats?.GOP ?? '—'} called of 218 needed</div>` : '';
    // LADDER TO 51: remaining seats ordered by Dem win chance; the seat that crosses 51 is the tipping seat.
    const tier = (p) => (p >= 0.95 ? ['SAFE', 'safe'] : p >= 0.75 ? ['LIKELY', 'likely'] : p >= 0.5 ? ['LEAN', 'lean'] : ['AT RISK', 'risk']);
    const ladder = rows
      .map((x) => {
        const nonG = x.r.candidates.find((c) => c.party === 'DEM');
        const p = nonG?.winProb ?? 0;
        const I = info(x.r);
        return { r: x.r, cand: nonG, p, I };
      })
      .filter((x) => x.cand)
      .sort((a, b) => b.p - a.p)
      .map((x, k) => ({ ...x, seat: D + k + 1 }));
    const tip = ladder.find((x) => x.seat === need);
    const shown = ladder.filter((x) => x.p >= 0.3 || x.seat <= need + 1).slice(0, 10);
    const slot = (x) => {
      const [w, c] = tier(x.p);
      const ln = (x.cand.last || x.cand.name).toUpperCase();
      const now = x.I.lead ? `${x.I.lead === x.cand ? 'leads' : 'trails'} by ${x.I.pts.toFixed(1)} · ${x.I.eevp}% in` : 'no votes yet';
      return `<div class="lad-s ${c} ${x.seat === need ? 'tip' : ''} ${x.seat > need ? 'cush' : ''}">
        <div class="lad-n">${x.seat === need ? '★ 51' : x.seat}</div>
        <div class="lad-st">${esc((x.r.stateName || '').toUpperCase())}</div>
        <div class="lad-w">${w}</div>
        <div class="lad-c">${esc(ln)} · ${now}${x.cand.odds != null ? ` · <b class="lad-bet">BETTORS ${Math.round(100 * x.cand.odds)}%</b>` : ''}</div>
      </div>`;
    };
    const tipTxt = won ? '✓ DEMOCRATS HAVE 51 SEATS' : tip ? `THE 51ST SEAT: ${esc((tip.r.stateName || '').toUpperCase())} · ${tier(tip.p)[0]}` : 'NO PATH TO 51 RIGHT NOW';
    const cushion = ladder.filter((x) => x.seat > need && x.p >= 0.75).length;
    const html = `
      <div class="sw-top">
        <div class="sw-kick">SENATE WATCH · 51 SEATS FOR CONTROL</div>
        <div class="sw-head ${won ? 'won' : ''}">${head}</div>
        <div class="sw-bar">
          <i class="d" style="width:${pctD}%"></i><i class="pd" style="width:${pctPD}%"></i>
          <i class="u"></i><i class="r" style="width:${pctR}%"></i>
          <span class="sw-mark" style="left:${mark}%"><em>51</em></span>
        </div>
        <div class="sw-nums"><span class="d">DEMS <b>${D}</b> called</span>${projBadge}<span class="r"><b>${R}</b> GOP</span></div>
      </div>
      <div class="lad-tip ${tip ? tier(tip.p)[1] : ''}">${tipTxt}${!won && tip ? `<small>${cushion} more likely seat${cushion === 1 ? '' : 's'} of cushion beyond 51</small>` : ''}</div>
      <div class="lad">${shown.map(slot).join('')}</div>
      <div class="lad-key"><span class="safe">SAFE 95%+</span><span class="likely">LIKELY 75–95%</span><span class="lean">LEAN 50–75%</span><span class="risk">AT RISK &lt;50%</span> · chance = NYT forecast</div>`;
    if (board.dataset.h !== html) { board.innerHTML = html; board.dataset.h = html; }
  }
  return {
    update(s) { state = s; render(); },
    showSegment(seg) { on = seg?.id === 'senate'; board.classList.toggle('on', on); render(); },
    onEvent() {},
  };
}
