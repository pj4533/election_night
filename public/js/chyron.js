import { el, partyColor, fmtPct, etTime, countdown } from './util.js';

const WATCH = ['pineplains', 'mi-sen', 'tx-sen', 'ia-gov'];
const PFX = { 'mi-sen': 'MI SEN', 'tx-sen': 'TX SEN', 'ia-gov': 'IA GOV', pineplains: 'PINE PLAINS', local: 'LOCAL' };
const pc = (p) => (p === 'DEM' ? 'dem' : p === 'GOP' ? 'gop' : 'oth');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffleKey = (i) => (i * 2654435761) >>> 0;

export function createChyron(root) {
  root.innerHTML = '';
  const t1 = el('div', 'cy-t1');
  const tag = el('div', 'cy-tag latest'); tag.innerHTML = '<span>LATEST</span>';
  const head = el('div', 'cy-head');
  const flash = el('div', 'cy-flash'), sweep = el('div', 'cy-sweep'), prog = el('div', 'cy-prog');
  head.append(el('div', 'cy-line in'));
  t1.append(tag, head, sweep, flash, prog);
  const t2 = el('div', 'cy-t2');
  const t2lbl = el('div', 'cy-t2-lbl', 'RESULTS');
  const view = el('div', 'cy-t2-view'); const track = el('div', 'cy-track'); view.append(track);
  t2.append(t2lbl, view);
  const t3 = el('div', 'cy-t3');
  t3.innerHTML = '<div><span class="cy-dot"></span><b>DATA:</b> AP via NYT · Dutchess BOE · Kalshi betting markets</div><div class="mid">UNOFFICIAL RESULTS · NOT A PROJECTION UNLESS STATED</div><div class="cy-clock"></div>';
  root.append(t1, t2, t3);
  const clock = t3.querySelector('.cy-clock');

  let state = null;
  const seenEv = new Set();
  const pending = []; // priority events {tag, cls, html, hold}
  let cur = { until: 0 };
  let rot = 0, pineToggle = 0;

  // ---------- helpers
  const byKey = (k) => state?.races?.find((r) => r.key === k) || state?.watch?.find((r) => r.key === k);
  const candSpan = (c, withPct = true) => `<span class="${pc(c.party)}">${esc(c.last || c.name.split(' ').pop())} (${PL(c.party)})</span>` + (withPct ? ` <span class="num">${fmtPct(c.pct)}</span>` : '');
  const PL = (p) => ({ DEM: 'D', GOP: 'R', LIB: 'L', GRN: 'G', OTH: 'I', WRI: 'W' }[p] || (p || '?')[0]);
  const top2 = (r) => (r.candidates || []).filter((c) => c.party !== 'WRI').slice(0, 2);
  const eevpTxt = (r) => (r.eevp != null && r.kind === 'nyt' ? ` <span class="dim">${Math.round(r.eevp)}% IN</span>` : '');

  function tagFor(ev) {
    const t = ev.type;
    if (ev.raceKey === 'pineplains') return ['HOMETOWN', 'hometown'];
    if (t === 'call') return ev.priority >= 3 ? ['PROJECTION', 'projection'] : ['BREAKING', 'breaking'];
    if (t === 'polls') return ['POLLS CLOSED', 'closed'];
    return ['BREAKING', 'breaking'];
  }

  function pineItem() {
    const r = byKey('pineplains');
    if (!r) return null;
    const [a, b] = [r.candidates.find((c) => c.name.includes('Roush')), r.candidates.find((c) => c.name.includes('Walsh'))];
    const matchup = a && b ? `Trevor Roush <span class="dem">(D)</span> vs Brian Walsh <span class="gop">(R)</span>` : 'Town Supervisor';
    if (r.totalVotes > 0 && a && b) {
      const lead = a.votes === b.votes ? 'TIED' : a.votes > b.votes ? 'ROUSH LEADS' : 'WALSH LEADS';
      return `PINE PLAINS SUPERVISOR: <span class="${a.votes >= b.votes ? 'dem' : 'gop'}">${lead}</span> <span class="dem">${a.votes}</span>–<span class="gop">${b.votes}</span> · ${r.reportingUnits || 0}/${r.totalUnits || 1} ED REPORTING`;
    }
    const cd = r.pollClose ? countdown(r.pollClose) : null;
    if (cd && cd.ms > 0) return `PINE PLAINS: Polls close at 9 PM · ${matchup} · <span class="num">${cd.text}</span> to go`;
    const nu = state?.sources?.dutchess?.nextUpdateAt;
    return `PINE PLAINS: Polls closed — awaiting Dutchess BOE · ${matchup}${nu ? ' · next update ' + etTime(nu) : ''}`;
  }

  // ---------- tier 1
  function buildPool() {
    const out = [];
    const ins = (state?.insights || []).slice(0, 25);
    const news = state?.news || [];
    const watchedNews = news.filter((n) => n.tag && WATCH.includes(n.tag) || n.tag === 'local').slice(0, 12);
    const otherNews = news.filter((n) => !watchedNews.includes(n)).slice(0, 14);
    const pi = pineItem();
    const evs = (state?.events || []).filter((e) => e.priority === 2 && Date.now() - e.ts < 10 * 60e3).slice(0, 4);
    const projs = (state?.races || []).filter((r) => r.callStatus === 'called').slice(0, 6)
      .map((r) => { const w = r.candidates.find((c) => c.winner); return w ? { tag: 'PROJECTION', cls: 'projection', html: `${esc(r.short)}: <span class="${pc(w.party)}">${esc(w.name)} (${PL(w.party)})</span> projected winner` } : null; }).filter(Boolean);
    evs.forEach((e) => { const [t, c] = tagFor(e); out.push({ tag: t, cls: c, html: esc(e.text) + (e.sub ? ` · <span class="lbl">${esc(e.sub)}</span>` : '') }); });
    const closed = (state?.pollClosings || []).filter((p) => { const t = Date.parse(p.poll_closing_time); return t < Date.now() && Date.now() - t < 45 * 60e3; });
    if (closed.length) out.push({ tag: 'POLLS CLOSED', cls: 'closed', html: `POLLS NOW CLOSED IN ${esc([...new Set(closed.map((p) => p.reporting_unit?.state_postal))].filter(Boolean).slice(0, 8).join(', '))}` });
    const wn = watchedNews.map((n) => ({ tag: 'LATEST', cls: 'latest', html: `${n.tag && PFX[n.tag] ? `<span class="lbl">${PFX[n.tag]}:</span> ` : ''}${esc(n.title)} <span class="dim">— ${esc(n.source)}</span>` }));
    const insi = ins.map((i) => ({ tag: 'LATEST', cls: 'latest', html: esc(i.text) }));
    const on = otherNews.map((n) => ({ tag: 'LATEST', cls: 'latest', html: `${esc(n.title)} <span class="dim">— ${esc(n.source)}</span>` }));
    out.push(...projs);
    // interleave: pine, watched news, insight, other news
    const a = [wn, insi, on]; let i = 0, more = true;
    while (more) { more = false; for (const L of a) if (L[i]) { out.push(L[i]); more = true; } if (i % 2 === 0 && pi) out.push({ tag: 'HOMETOWN', cls: 'hometown', html: pi }); i++; if (i > 30) break; }
    if (!out.length) out.push({ tag: 'HOMETOWN', cls: 'hometown', html: pi || 'ELECTION NIGHT 2026 — LIVE' });
    return out;
  }
  let pool = [], poolIdx = 0, poolBuilt = 0;

  function show(item, hold) {
    // retire every existing line (rapid interrupts used to leave several stacked on top of each other)
    head.querySelectorAll('.cy-line').forEach((old) => {
      if (old.classList.contains('out')) { old.remove(); return; }
      old.classList.remove('in'); old.classList.add('out'); setTimeout(() => old.remove(), 360);
    });
    const ln = el('div', 'cy-line in', item.html);
    head.append(ln);
    if (tag.firstChild?.textContent !== item.tag) {
      tag.className = 'cy-tag ' + item.cls; tag.innerHTML = `<span>${esc(item.tag)}</span>`;
    }
    prog.style.transition = 'none'; prog.style.transform = 'scaleX(1)'; void prog.offsetWidth;
    prog.style.transition = `transform ${hold}ms linear`; prog.style.transform = 'scaleX(0)';
    cur = { until: performance.now() + hold };
  }

  function tick1() {
    const now = performance.now();
    if (now < cur.until) return;
    if (pending.length) { const p = pending.shift(); show(p, 12000); return; }
    if (!pool.length || poolIdx >= pool.length || now - poolBuilt > 60000) { pool = buildPool(); poolIdx = 0; poolBuilt = now; }
    let it = pool[poolIdx++];
    if (it.cls === 'hometown' && it.html.startsWith('PINE')) { const pi = pineItem(); if (pi) it = { ...it, html: pi }; }
    show(it, 7000);
  }

  // ---------- tier 2
  function tickerItems() {
    const items = [];
    const sep = (cls, h) => items.push(`<span class="cy-item ${cls || ''}">${h}</span>`);
    const raceHtml = (r, hero) => {
      const t = top2(r);
      if (!t.length) return '';
      const win = t.find((c) => c.winner);
      const label = `<span class="rk ${hero ? 'hero' : ''}">${esc(r.short || r.title)}</span>`;
      if (r.totalVotes > 0 || win) {
        const body = t.map((c) => candSpan(c)).join(' <span class="dim">·</span> ');
        return `${label}${win ? '<span class="win">✓</span>' : ''} ${body}${win ? '' : eevpTxt(r)}`;
      }
      return `${label}${t.map((c) => candSpan(c, false)).join(' <span class="dim">vs</span> ')} <span class="dim">NO VOTES YET</span>`;
    };
    const watched = (state?.watch || []);
    for (const r of watched) { const h = raceHtml(r, r.key === 'pineplains'); if (h) sep(r.key === 'pineplains' ? 'pine' : '', h); }
    // control
    const pcS = state?.partyControl?.S?.party_balance;
    if (pcS?.DEM) sep('', `<span class="rk">SENATE</span><span class="dem">DEM ${pcS.DEM.seats}</span> <span class="dim">·</span> <span class="gop">GOP ${pcS.GOP?.seats ?? '—'}</span> <span class="dim">${pcS.DEM.to_win ?? 51} TO WIN</span>`);
    const pcH = state?.partyControl?.H?.party_balance;
    if (pcH?.DEM) sep('', `<span class="rk">HOUSE</span><span class="dem">DEM ${pcH.DEM.seats}</span> <span class="dim">·</span> <span class="gop">GOP ${pcH.GOP?.seats ?? '—'}</span> <span class="dim">${pcH.DEM.to_win ?? 218} TO WIN</span>`);
    // all races with votes, most reported first
    const live = (state?.races || []).filter((r) => (r.totalVotes > 0 || r.candidates?.some((c) => c.winner)) && !WATCH.includes(r.key))
      .sort((a, b) => (b.eevp || 0) - (a.eevp || 0));
    for (const r of live.slice(0, 40)) { const h = raceHtml(r); if (h) sep('', h); }
    // dutchess
    for (const d of (state?.dutchessTicker || []).slice(0, 8)) {
      const t = top2(d);
      const body = d.totalVotes > 0 ? t.map((c) => candSpan({ ...c, last: c.name.split(/[ /]/).filter(Boolean).pop() })).join(' <span class="dim">·</span> ') : '<span class="dim">AWAITING RESULTS</span>';
      sep('', `<span class="rk">${esc(d.label)}</span>${body}`);
    }
    // odds
    const o = state?.odds || {};
    const fmtO = (arr) => (arr || []).slice().sort((a, b) => b.price - a.price).slice(0, 2).map((x) => `${esc(x.name.replace('Democratic Party', 'Democrats').replace('Republican Party', 'Republicans').split(' ').slice(-1)[0])} <span class="num">${Math.round(x.price * 100)}% chance</span>`).join(' <span class="dim">vs</span> ');
    if (o['CONTROLS-2026']) sep('', `<span class="src">BETTORS SAY</span>WHO CONTROLS THE SENATE: ${fmtO(o['CONTROLS-2026'])}`);
    if (o['CONTROLH-2026']) sep('', `<span class="src">BETTORS SAY</span>WHO CONTROLS THE HOUSE: ${fmtO(o['CONTROLH-2026'])}`);
    for (const [k, arr] of Object.entries(o)) { if (/^CONTROL/.test(k) || !arr?.length) continue; sep('', `<span class="src">BETTORS SAY</span><span class="rk">${esc({ 'SENATEMI-26': 'MI SEN', 'SENATETX-26': 'TX SEN', 'GOVPARTYIA-26': 'IA GOV' }[k] || k.replace(/-26$/, ''))}</span>${fmtO(arr)}`); if (items.length > 80) break; }
    // news
    for (const n of (state?.news || []).slice(0, 12)) sep('news', `<span class="src">${esc((n.source || 'NEWS').toUpperCase())}</span>${esc(n.title)}`);
    if (!items.length) sep('', '<span class="rk">ELECTION NIGHT 2026</span> LIVE COVERAGE');
    return items.join('');
  }
  let x = 0, loopW = 0, lastT = performance.now(), dirtyTicker = true, tickerBuilt = false;
  const SPEED = 110; // px/s
  function buildTicker(first) {
    const base = tickerItems();
    track.innerHTML = base;
    const vw = view.clientWidth || 1200;
    let w = track.scrollWidth; if (!w) return;
    const baseW = w; let n = 0;
    while (w < baseW + vw + 50 && n++ < 8) { track.insertAdjacentHTML('beforeend', base); w = track.scrollWidth; }
    loopW = baseW; dirtyTicker = false; tickerBuilt = true;
    if (first) x = vw;
  }
  function frame(t) {
    const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    if (!tickerBuilt) { if (state) buildTicker(true); }
    else {
      x -= SPEED * dt;
      if (-x >= loopW) { const old = loopW; buildTicker(false); x += old; }
      track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
    }
    tick1();
    requestAnimationFrame(frame);
  }
  const updClock = () => { clock.textContent = etTime(Date.now(), true) + ' ET'; };
  setInterval(updClock, 1000); updClock();
  requestAnimationFrame(frame);

  return {
    update(s) {
      state = s;
      if (!tickerBuilt) { dirtyTicker = true; }
      if (!cur.until) cur.until = 0;
    },
    onEvent(ev) {
      if (!ev || seenEv.has(ev.id)) return; seenEv.add(ev.id);
      if (ev.priority >= 2) {
        const [t, c] = tagFor(ev);
        const item = { tag: t, cls: c, html: esc(ev.text) + (ev.sub ? ` · <span class="lbl">${esc(ev.sub)}</span>` : '') };
        flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
        show(item, 12000);
      }
    },
  };
}
