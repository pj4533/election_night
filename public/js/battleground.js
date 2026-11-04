// Control-of-Congress HUD (always on) + Battleground board (director segment).
import { el, tweenNumber, partyColor, fmtInt } from './util.js';

const PN = { DEM: 'Democrats', GOP: 'Republicans' };
const pct = (p) => (p == null ? null : Math.round(p * 100));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function leaderOf(odds) {
  if (!odds || odds.DEM == null || odds.GOP == null) return null;
  const p = odds.DEM >= odds.GOP ? 'DEM' : 'GOP';
  return { party: p, p: odds[p] };
}
function oddsLine(odds, what) {
  const l = leaderOf(odds);
  if (!l) return `<span class="dim">Betting odds loading…</span>`;
  const n = pct(l.p);
  const verb = 'to win';
  return `Bettors: <b class="${l.party}">${l.party === 'DEM' ? 'Dems' : 'GOP'} ${n}%</b> ${verb} control`;
}
function srcLine(c) {
  const k = c.odds?.kalshi?.DEM, p = c.odds?.polymarket?.DEM;
  const lead = leaderOf(c.odds)?.party || 'DEM';
  const g = (o) => (o ? pct(o[lead]) : null);
  const parts = [];
  if (g(c.odds?.kalshi) != null) parts.push(`Kalshi ${g(c.odds.kalshi)}`);
  if (g(c.odds?.polymarket) != null) parts.push(`Polymarket ${g(c.odds.polymarket)}`);
  if (c.model?.winProb) parts.push(`NYT forecast ${pct(c.model.winProb[lead])}`);
  return parts.join(' · ') || '&nbsp;';
}

export function createBattleground(root) {
  root.classList.add('bg-root');
  let state = null, active = false, featIdx = 0, featTimer = null, flashKey = null, flashUntil = 0;
  const prevHud = {};

  // ---------- HUD ----------
  const hud = el('div', 'cc-hud');
  const halves = {};
  for (const ch of ['senate', 'house']) {
    const h = el('div', `cc-half ${ch}`, `
      <div class="cc-row1">
        <span class="cc-name">${ch === 'senate' ? 'SENATE' : 'HOUSE'}</span>
        <span class="cc-n DEM"><i class="dn">0</i></span>
        <div class="cc-bar"><div class="d"></div><div class="u"></div><div class="g"></div><div class="tw"><em></em></div></div>
        <span class="cc-n GOP"><i class="gn">0</i></span>
        <span class="cc-called"></span>
      </div>
      <div class="cc-odds"></div>
      <div class="cc-src"></div>`);
    hud.append(h);
    halves[ch] = { h, dn: h.querySelector('.dn'), gn: h.querySelector('.gn'), d: h.querySelector('.d'), g: h.querySelector('.g'), tw: h.querySelector('.tw'),
      called: h.querySelector('.cc-called'), odds: h.querySelector('.cc-odds'), src: h.querySelector('.cc-src') };
  }
  root.append(hud);

  function flash(node) { node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash'); }

  function updateHud(s) {
    for (const ch of ['senate', 'house']) {
      const c = s.control?.[ch]; const H = halves[ch]; if (!c) continue;
      const se = c.seats || {}; const tot = se.total || (ch === 'senate' ? 100 : 435);
      const D = se.DEM ?? 0, G = se.GOP ?? 0;
      H.d.style.width = `${(D / tot) * 100}%`; H.g.style.width = `${(G / tot) * 100}%`;
      H.tw.style.left = `${((se.toWin || Math.floor(tot / 2) + 1) / tot) * 100}%`;
      H.tw.firstElementChild.textContent = `${se.toWin || ''}`;
      if (prevHud[ch + 'D'] != null && prevHud[ch + 'D'] !== D) flash(H.dn);
      if (prevHud[ch + 'G'] != null && prevHud[ch + 'G'] !== G) flash(H.gn);
      prevHud[ch + 'D'] = D; prevHud[ch + 'G'] = G;
      tweenNumber(H.dn, D, { dur: 900 }); tweenNumber(H.gn, G, { dur: 900 });
      H.called.textContent = se.winner ? `${PN[se.winner].toUpperCase()} WIN` : `${se.called ?? 0}/${ch === 'senate' ? se.openSeats || 35 : se.total || 435} called`;
      const o = oddsLine(c.odds, ch === 'senate' ? 'Senate' : 'House');
      const sig = o; if (H.odds.dataset.sig !== sig) { if (H.odds.dataset.sig) flash(H.h); H.odds.dataset.sig = sig; H.odds.innerHTML = o; }
      H.src.innerHTML = srcLine(c);
    }
  }

  // ---------- Board ----------
  const board = el('div', 'bg-board');
  board.innerHTML = `<div class="bg-head"><b>BATTLEGROUND</b><span>RACES THAT DECIDE CONTROL</span></div>
    <div class="bg-feat"><div class="bg-flip"></div></div><div class="bg-list"></div>`;
  root.append(board);
  const flipEl = board.querySelector('.bg-flip'), listEl = board.querySelector('.bg-list');

  function featHtml(r) {
    const cands = (r.candidates || []).slice(0, 2);
    const status = r.winner ? `<span class="bg-badge ${r.gained ? 'flip' : 'call'}">${r.gained ? 'FLIP' : 'CALLED'}</span>` : '';
    const rows = cands.map((c) => {
      const col = partyColor(c.party);
      return `<div class="bg-cand ${c.winner ? 'win' : ''}" style="--pc:${col}">
        <div class="nm">${esc(c.last || c.name)}${c.incumbent ? ' <small>(inc.)</small>' : ''} <small class="${c.party}">${c.party}</small>${c.winner ? ' ✔' : ''}</div>
        <div class="vt"><b>${fmtInt(c.votes)}</b> <span>${c.pct ? c.pct.toFixed(1) : '0.0'}%</span></div>
        <div class="sb"><i style="width:${Math.min(100, c.pct || 0)}%"></i></div>
        <div class="ob">${c.odds != null ? `Bettors give ${esc(c.last)} a <b>${pct(c.odds)}%</b> chance` : ''}${c.winProb != null ? ` · NYT forecast <b>${pct(c.winProb)}%</b>` : ''}</div>
      </div>`;
    }).join('');
    return `<div class="bg-title">${esc(r.title)} ${status}</div>
      <div class="bg-rating r-${esc(r.rating)}">${esc(r.ratingLabel)} · <span>${r.eevp ? Math.round(r.eevp) + '% expected vote in' : 'No votes in yet'}</span></div>
      <div class="bg-why">${esc(r.why)}</div>${rows}`;
  }

  function showFeatured(animate = true) {
    const list = state?.battleground || []; if (!list.length) { flipEl.innerHTML = ''; return; }
    featIdx = featIdx % list.length;
    const r = list[featIdx];
    flipEl.dataset.key = r.key;
    if (animate) {
      flipEl.classList.remove('in'); void flipEl.offsetWidth;
      flipEl.innerHTML = featHtml(r); flipEl.classList.add('in');
    } else flipEl.innerHTML = featHtml(r);
    renderList();
  }
  function renderList() {
    const list = state?.battleground || [];
    const cur = flipEl.dataset.key;
    listEl.innerHTML = list.map((r) => {
      const lead = (r.candidates || []).slice().sort((a, b) => (b.votes - a.votes) || ((b.odds || 0) - (a.odds || 0)))[0];
      const o = lead?.odds != null ? `${pct(lead.odds)}%` : '—';
      const cls = ['bg-li', r.key === cur ? 'cur' : '', r.key === flashKey && Date.now() < flashUntil ? 'flash' : '', r.winner ? 'done' : ''].join(' ');
      return `<div class="${cls}" data-k="${esc(r.key)}"><span class="t">${esc(r.title)}</span><span class="l" style="color:${partyColor(lead?.party)}">${esc(lead?.last || '')}</span><span class="o">${o}</span></div>`;
    }).join('');
  }
  function refreshLive() {
    // update featured numbers in place if the same race is still showing
    const list = state?.battleground || [];
    const r = list.find((x) => x.key === flipEl.dataset.key);
    if (r) { const keep = flipEl.classList.contains('in'); flipEl.innerHTML = featHtml(r); if (keep) flipEl.classList.add('in'); }
    renderList();
  }

  function start() {
    active = true; featIdx = 0; board.classList.add('on'); showFeatured(true);
    clearInterval(featTimer); featTimer = setInterval(() => { featIdx++; showFeatured(true); }, 3500);
  }
  function stop() { active = false; board.classList.remove('on'); clearInterval(featTimer); featTimer = null; }

  return {
    update(s) {
      state = s; updateHud(s);
      if (active) {
        // keep rotation pointer on same race if it moved
        refreshLive();
      }
    },
    showSegment(seg) { if (seg?.id === 'battleground') start(); else if (active) stop(); },
    onEvent(ev) {
      if (ev?.type !== 'flip') return;
      const m = /\b([A-Z]{2}-\d{2})\b/.exec(ev.text || '');
      const bg = state?.battleground || [];
      const r = bg.find((x) => (m && x.key === 'H-' + m[1]) || (ev.raceKey && x.nytId === ev.raceKey));
      flash(halves.house.h);
      if (r) { flashKey = r.key; flashUntil = Date.now() + 15000; if (active) { featIdx = bg.indexOf(r); showFeatured(true); } else renderList(); setTimeout(() => active && renderList(), 15100); }
    },
  };
}
