// WAVE TRACKER: the night's narrative — pickups (flips) by office, and upsets vs pre-election ratings.
import { partyColor as col, el } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const OFF = { S: 'SENATE', G: 'GOVERNOR', H: 'HOUSE' };

export function createWave(root) {
  const board = el('div', 'wv-board');
  root.appendChild(board);
  let state = null, on = false;

  function render() {
    if (!on || !state) return;
    const races = state.races || [];
    const won = (r) => r.candidates.find((c) => c.winner);
    const flips = races.filter((r) => r.gained && won(r));
    const flipBy = (p, o) => flips.filter((r) => won(r).party === p && (!o || r.officeId === o)).length;
    const ctl = state.control || {};
    const hFlipD = ctl.house?.seats?.flips?.DEM || 0, hFlipR = ctl.house?.seats?.flips?.GOP || 0;
    // upset = winner's party was rated the underdog before the election (lean/likely/solid for the other party)
    const upsets = races.filter((r) => {
      const w = won(r); if (!w || !r.rating) return false;
      const favP = /dem$/.test(r.rating) ? 'DEM' : /rep$/.test(r.rating) ? 'GOP' : null;
      return favP && w.party !== favP && w.party !== 'OTH';
    });
    const dTotal = flipBy('DEM') + hFlipD, rTotal = flipBy('GOP') + hFlipR;
    const head = dTotal > rTotal * 2 && dTotal >= 3 ? 'A DEMOCRATIC WAVE' : rTotal > dTotal * 2 && rTotal >= 3 ? 'A REPUBLICAN WAVE' : 'THE NIGHT SO FAR';
    const stat = (n, label, p) => `<div class="wv-stat" style="--pc:${col(p)}"><b>${n}</b><span>${label}</span></div>`;
    const flipRow = (r) => { const w = won(r); return `<div class="wv-flip" style="--pc:${col(w.party)}"><span class="wv-st">${esc((r.stateName || '').toUpperCase())}</span><span class="wv-of">${OFF[r.officeId] || ''}</span><span class="wv-w">${esc((w.last || w.name).toUpperCase())} (${w.party === 'DEM' ? 'D' : w.party === 'GOP' ? 'R' : 'I'})</span><span class="wv-tag">FLIP</span></div>`; };
    const upRow = (r) => { const w = won(r); return `<div class="wv-flip up" style="--pc:${col(w.party)}"><span class="wv-st">${esc((r.stateName || '').toUpperCase())}</span><span class="wv-of">${OFF[r.officeId] || ''}</span><span class="wv-w">${esc((w.last || w.name).toUpperCase())}</span><span class="wv-tag">RATED ${esc(String(r.rating).replace('-', ' ').toUpperCase())}</span></div>`; };
    const html = `
      <div class="wv-kick">THE BIG PICTURE · PICKUPS & UPSETS</div>
      <div class="wv-head">${head}</div>
      <div class="wv-stats">
        ${stat(flipBy('DEM', 'S'), 'SENATE SEATS FLIPPED BY DEMS', 'DEM')}
        ${stat(flipBy('DEM', 'G'), 'GOVERNORSHIPS FLIPPED BY DEMS', 'DEM')}
        ${stat(hFlipD, 'HOUSE SEATS FLIPPED BY DEMS', 'DEM')}
        ${stat(flipBy('GOP') + hFlipR, 'FLIPPED BY GOP (ALL OFFICES)', 'GOP')}
      </div>
      <div class="wv-cols">
        <div><div class="wv-h2">FLIPPED SEATS</div>${flips.map(flipRow).join('') || '<div class="wv-none">None yet</div>'}</div>
        <div><div class="wv-h2">UPSETS · WON AS THE UNDERDOG</div>${upsets.map(upRow).join('') || '<div class="wv-none">No upsets yet</div>'}</div>
      </div>`;
    if (board.dataset.h !== html) { board.innerHTML = html; board.dataset.h = html; }
  }
  return {
    update(s) { state = s; render(); },
    showSegment(seg) { on = seg?.id === 'wave'; board.classList.toggle('on', on); render(); },
    onEvent() {},
  };
}
