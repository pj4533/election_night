// "HOMETOWN BY THE NUMBERS": turnout vs past years + partisan shift vs past D-vs-R baselines (director segment 'history').
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ED_DEFS = [
  { ed: 'Pine Plains ED 1', race: 'pineplains', town: 'Pine Plains' },
  { ed: 'Stanford ED 1', race: 'stanford-council', town: 'Stanford' },
  { ed: 'Stanford ED 2', race: 'stanford-council', town: 'Stanford' },
];
const MCOL = { 'Early Voting': 'var(--cyan)', 'Absentee/EMB': 'var(--magenta)', 'Election Day': 'var(--yellow)', Affidavit: '#fff' };
const sumM = (cands) => { const m = {}; for (const c of cands || []) for (const [k, v] of Object.entries(c.methods || {})) m[k] = (m[k] || 0) + v; return m; };
const sgn = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toFixed(1);

export function createHistory(root) {
  root.classList.add('hist-root');
  const board = document.createElement('div');
  board.className = 'hist-board';
  root.append(board);
  let state = null, hist = null, active = false;
  fetch('/geo/hometown-history.json').then((r) => r.json()).then((j) => { hist = j; if (active) render(); }).catch((e) => console.error('history json', e));

  function countedLine(race) {
    const g = race?.reporting?.groups || [];
    const w = { full: 'COUNTED', night: 'PARTIAL', not: 'NOT YET' };
    const parts = g.filter((x) => x.name !== 'Affidavit').map((x) => `<span class="st-${x.status}">${esc(x.name.replace('Absentee/EMB', 'Absentee'))}: ${w[x.status] || x.status}</span>`);
    return parts.join(' &middot; ') || 'waiting for results';
  }

  function turnoutHtml(h, ed, tonight) {
    const t = h.turnout || {};
    const rows = [['2023', t['2023']], ['2024', t['2024']], ['2025', t['2025']]].filter((r) => r[1]);
    const nowM = tonight ? sumM(tonight.candidates) : {};
    const now = tonight?.total || 0;
    const max = Math.max(1, now, ...rows.map((r) => r[1].total));
    const bar = (total, m) => {
      const keys = ['Early Voting', 'Absentee/EMB', 'Election Day', 'Affidavit'];
      let segs = '';
      if (m && Object.values(m).some((v) => v)) for (const k of keys) { const v = m[k] || 0; if (v) segs += `<i style="width:${(100 * v) / max}%;background:${MCOL[k]}"></i>`; }
      else segs = `<i style="width:${(100 * total) / max}%;background:var(--purple)"></i>`;
      return `<div class="hb-bar">${segs}</div>`;
    };
    let html = rows.map(([y, d]) => `<div class="hb-row"><span class="hb-y">${y}</span>${bar(d.total, d.methods)}<span class="hb-n">${d.total.toLocaleString()}</span></div>`).join('');
    html += `<div class="hb-row now"><span class="hb-y">2026</span>${bar(now, nowM)}<span class="hb-n">${now.toLocaleString()}</span></div>`;
    const b24 = t['2024']?.total;
    const pct = b24 ? Math.round((100 * now) / b24) : null;
    return html.replace(/(<span class="hb-n">[^<]*<\/span><\/div>)$/, `<span class="hb-n">${now.toLocaleString()} <b>${pct != null ? pct + '% of \u201924' : ''}</b></span></div>`);
  }

  function partisanHtml(h, tonight) {
    const dem = tonight?.candidates?.find((c) => c.party === 'DEM'), gop = tonight?.candidates?.find((c) => c.party === 'GOP');
    if (!dem || !gop || dem.votes + gop.votes === 0) return `<div class="hb-cap">PARTISAN SHIFT: waiting for first votes</div>`;
    const nowD = (100 * dem.votes) / (dem.votes + gop.votes);
    const bases = (h.contests || []).filter((c) => c.demTwoParty != null && c.role !== 'town' && (c.label !== 'Congress' || true));
    const pick = [];
    const want = [['President', 'HARRIS ’24'], ['US Senate', 'SEN ’24'], ['Congress', 'REP ’24'], ['Comptroller', 'COMPT ’25'], ['County Exec', 'CE ’23']];
    for (const [lab, short] of want) { const c = bases.find((x) => x.label === lab); if (c) pick.push({ short, v: c.demTwoParty, lab }); }
    const all = [nowD, ...pick.map((p) => p.v)];
    const lo = Math.floor((Math.min(...all) - 5) / 10) * 10, hi = Math.ceil((Math.max(...all) + 5) / 10) * 10;
    const x = (v) => `${((v - lo) / (hi - lo)) * 100}%`;
    const harris = pick.find((p) => p.lab === 'President');
    const dots = pick.map((p, i) => `<div class="dp-dot base lo" style="left:${x(p.v)}">${p.lab === 'President' ? `<em>HARRIS ${p.v.toFixed(0)}</em>` : ''}<i></i></div>`).join('');
    const fifty = lo < 50 && hi > 50 ? `<div class="dp-50" style="left:${x(50)}"></div>` : '';
    const arrow = harris ? `<div class="dp-arrow" style="left:${x(Math.min(nowD, harris.v))};width:${Math.abs(x(nowD).slice(0, -1) - x(harris.v).slice(0, -1))}%"></div>` : '';
    const deltas = pick.filter((p) => p.lab !== 'President').slice(0, 2).map((p) => `<span class="${nowD - p.v >= 0 ? 'up' : 'dn'}">${sgn(nowD - p.v)} ${p.short.split(' ')[0]}</span>`).join(' ');
    return `<div class="dp"><div class="dp-axis"></div>${fifty}${arrow}${dots}
      <div class="dp-dot now" style="left:${x(nowD)}"><em>TONIGHT ${nowD.toFixed(0)}</em><i></i></div></div>
      
      <div class="hb-cap deltas">${harris ? `<b class="${nowD - harris.v >= 0 ? 'up' : 'dn'}">${sgn(nowD - harris.v)} pts vs Harris</b> ` : ''}${deltas}</div>`;
  }

  function card(def) {
    const race = state?.watch?.find((r) => r.key === def.race);
    const tonight = race?.edResults?.find((e) => e.name === def.ed);
    const h = hist?.eds?.[def.ed];
    const c = (race?.candidates || []).filter((x) => !x.writeIn).slice(0, 2);
    const names = c.map((x) => `<b class="${x.party}">${esc((x.name || '').split(' ').pop())}</b>`).join(' <small>vs</small> ');
    return `<div class="hist-card"><div class="hist-ed"><b>${def.ed.toUpperCase()}</b><span>${names}</span></div>
      ${h ? turnoutHtml(h, def.ed, tonight) + partisanHtml(h, tonight) : '<div class="hb-cap">loading history&hellip;</div>'}</div>`;
  }

  function render() {
    const pp = state?.watch?.find((r) => r.key === 'pineplains');
    board.innerHTML = `<div class="hist-head"><b>HOMETOWN BY THE NUMBERS</b><span>vs 2023 / 2024 / 2025 &middot; UNOFFICIAL</span></div>
      <div class="hist-note">${countedLine(pp)}</div>
      <div class="hist-legend"><i style="background:var(--cyan)"></i>Early<i style="background:var(--magenta)"></i>Absentee<i style="background:var(--yellow)"></i>Elec Day<i style="background:var(--purple)"></i>2023 n/a</div>
      ${ED_DEFS.map(card).join('')}`;
  }

  return {
    update(s) { state = s; if (active) render(); },
    showSegment(seg) { active = seg?.id === 'history'; board.classList.toggle('on', active); if (active) render(); },
  };
}
