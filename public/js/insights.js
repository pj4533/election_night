// "HOMETOWN INSIGHTS" takeover (director segment 'history', seg.town = 'pineplains' | 'stanford').
// One BIG card at a time: kicker, giant headline + number, a big simple chart, a one-liner, a source line.
// Static facts come from /geo/hometown-insights.json (scripts/build-insights.mjs); LIVE cards are computed from state.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => Math.round(n).toLocaleString();
const last = (n) => String(n || '').split(' ').filter(Boolean).pop()?.toUpperCase() || '';
const TOWNS = {
  pineplains: { race: 'pineplains', eds: ['Pine Plains ED 1'], place: 'PINE PLAINS', supv: 'Pine Plains Town Supervisor' },
  stanford: { race: 'stanford-council', eds: ['Stanford ED 1', 'Stanford ED 2'], place: 'STANFORD', supv: 'Stanford Town Supervisor' },
};
const KICK = { why: 'WHY THIS YEAR IS DIFFERENT', know: 'DID YOU KNOW', hist: 'HOMETOWN HISTORY', live: 'LIVE RIGHT NOW', then: 'THEN vs TONIGHT', story: 'LOCAL STORY', town: 'HOMETOWN' };
const SRC = 'Dutchess County BOE (Enhanced Voting) · 2026 unofficial';

export function createInsights(root) {
  root.classList.add('ins-root');
  root.innerHTML = `<div class="ins-board"><div class="ins-stage"></div>
    <div class="ins-foot"><div class="ins-dots"></div><div class="ins-place"></div></div></div>`;
  const board = root.querySelector('.ins-board'), stage = root.querySelector('.ins-stage');
  const dotsEl = root.querySelector('.ins-dots'), placeEl = root.querySelector('.ins-place');
  let imgs = null, stories = null, state = null, data = null, eday = null, hist = null, active = false, town = 'pineplains', deck = [], i = 0, timer = null, every = 9000, shows = 0; const rot = { pineplains: 0, stanford: 0 };
  const get = (u) => fetch(u).then((r) => r.json()).catch((e) => { console.error(u, e); return null; });
  Promise.all([get('/geo/hometown-insights.json'), get('/geo/hometown-eday.json'), get('/geo/hometown-history.json'), get('/geo/local-images.json'), get('/geo/local-stories.json')]).then(([a, b, c, im, st]) => {
    data = a; eday = b; hist = c; imgs = im; stories = st?.stories; if (active) start();
  });

  // ---------- data helpers ----------
  const race = (t) => state?.watch?.find((r) => r.key === TOWNS[t].race);
  function live(t) {
    const r = race(t); const eds = (r?.edResults || []).filter((e) => TOWNS[t].eds.includes(e.name));
    let D = 0, R = 0, total = 0, early = 0, edayN = 0, eD = 0, eR = 0;
    for (const e of eds) {
      total += e.total || 0;
      for (const c of e.candidates || []) {
        const ed = c.methods?.['Election Day'] || 0, ev = (c.votes || 0) - ed;
        early += ev; edayN += ed;
        if (c.party === 'DEM') { D += c.votes; eD += ev; } if (c.party === 'GOP') { R += c.votes; eR += ev; }
      }
    }
    const cands = (r?.candidates || []).filter((c) => !c.writeIn);
    return { r, D, R, total, early, eday: edayN, eD, eR, dem: cands.find((c) => c.party === 'DEM'), gop: cands.find((c) => c.party === 'GOP') };
  }
  const sumEds = (t, f) => TOWNS[t].eds.reduce((a, ed) => a + (f(ed) || 0), 0);
  const pres = (ed) => hist?.eds?.[ed]?.contests?.find((c) => c.label === 'President');

  // ---------- card builders: THEN → TONIGHT (user: old data must say something about TODAY) ----------
  // Card = { k:'then', head (≤7 words, why tonight is notable), line?, src, two:[THEN, TONIGHT] } — exactly one old value vs one live value.
  const p0 = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const mg = (d) => (d >= 0 ? `D+${fmt(d)}` : `R+${fmt(-d)}`);
  function townCards(t) {
    const T = TOWNS[t], L = live(t), H = (ed) => data?.home?.[ed], P = T.place;
    const dN = L.dem ? last(L.dem.name) : 'DEM';
    if (!(L.D + L.R > 0)) return [];
    const out = [], lead = L.D - L.R;
    const card = (head, then, now, src, extra = {}) => out.push({ k: 'then', live: true, head, two: [{ ...then, then: true }, { ...now, hot: true }], src, ...extra });
    const races = (data?.town || []).filter((x) => x.scope === t && x.year < 2026);
    const partyOf = (x, nm) => x.cands.find((c) => c.name === nm)?.party;
    // 1. the last close local race vs tonight's margin
    const close = races.map((x) => {
      const s = x.cands.filter((c) => c.party).sort((a, b) => b.votes - a.votes);
      const multi = /Council|Board/.test(x.contest) && !/Unexpired/.test(x.contest);
      if (multi || s.length < 2) return null;
      return { x, w: s[0], m: s[0].votes - s[1].votes };
    }).filter(Boolean).sort((a, b) => a.m - b.m)[0];
    if (close) {
      const thenD = close.w.party === 'DEM' ? close.m : -close.m;
      const office = /Supervisor/.test(close.x.contest) ? 'SUPERVISOR' : 'TOWN BOARD';
      const head = t === 'pineplains' && /Walsh/.test(close.w.name) && lead > 0 ? `WALSH WON BY ${close.m}. NOW HE TRAILS.`
        : `A ${close.m}-VOTE RACE IN ${close.x.year}. NOW ${fmt(Math.abs(lead))}.`;
      card(head, { label: `${close.x.year} ${office}`, txt: mg(thenD) }, { label: `${dN} TONIGHT`, txt: mg(lead) }, `${close.x.year} ${close.x.contest} margin vs 2026 counted so far`, { noBars: true });
    }
    // 2. Harris margin vs tonight's margin
    const hD = sumEds(t, (ed) => pres(ed)?.dem?.votes), hR = sumEds(t, (ed) => pres(ed)?.gop?.votes);
    if (hD + hR) card(`HARRIS ${mg(hD - hR)} HERE. ${dN} ${mg(lead)}.`, { label: 'HARRIS 2024', txt: mg(hD - hR) }, { label: `${dN} TONIGHT`, txt: mg(lead) },
      '2024 President margin vs 2026 counted so far', { noBars: true });
    // 3. Harris share vs tonight's share
    if (hD + hR) { const h = (100 * hD) / (hD + hR), n = (100 * L.D) / (L.D + L.R);
      card(`HARRIS GOT ${h.toFixed(0)}% HERE. ${dN} HAS ${n.toFixed(0)}%.`, { label: 'HARRIS 2024', v: h, txt: `${h.toFixed(0)}%` }, { label: `${dN} TONIGHT`, v: n, txt: `${n.toFixed(0)}%` }, 'Dem share of D+R votes'); }
    // 4. early votes, last year vs tonight
    const ev25 = sumEds(t, (ed) => H(ed)?.ev25);
    if (L.early && ev25) card(L.early > ev25 ? `EARLY VOTE UP ${p0(L.early - ev25, ev25)}% FROM LAST YEAR` : 'EARLY VOTES: LAST YEAR VS TONIGHT',
      { label: '2025', v: ev25, txt: fmt(ev25) }, { label: 'TONIGHT', v: L.early, txt: fmt(L.early) }, 'Early Voting + Absentee/Mail ballots');
    // 5. counted tonight vs last year's whole turnout
    const tot25 = sumEds(t, (ed) => hist?.eds?.[ed]?.turnout?.['2025']?.total);
    if (tot25 && L.total) card(L.total >= tot25 ? 'ALREADY MORE VOTES THAN ALL OF 2025' : `ALREADY ${p0(L.total, tot25)}% OF LAST YEAR’S TURNOUT`,
      { label: '2025 TOTAL', v: tot25, txt: fmt(tot25) }, { label: 'TONIGHT', v: L.total, txt: fmt(L.total) }, L.eday ? 'All votes counted so far' : 'Counted before any Election Day ballot');
    // 6. Dem share of early vote, 2024 vs tonight
    const oD = sumEds(t, (ed) => eday?.eds?.[ed]?.['2024']?.other?.DEM), oR = sumEds(t, (ed) => eday?.eds?.[ed]?.['2024']?.other?.GOP);
    if (oD + oR && L.eD + L.eR) { const a = (100 * oD) / (oD + oR), b = (100 * L.eD) / (L.eD + L.eR);
      card(b > a ? 'EARLY VOTERS ARE EVEN BLUER TONIGHT' : 'DEM SHARE OF EARLY VOTES', { label: 'HARRIS ’24', v: a, txt: `${a.toFixed(0)}%` }, { label: `${dN} TONIGHT`, v: b, txt: `${b.toFixed(0)}%` }, 'Early + mail ballots, Dem share of D+R'); }
    // 7. Election Day (only once Election Day votes exist)
    const tr = sumEds(t, (ed) => eday?.eds?.[ed]?.['2024']?.eday?.GOP), tdm = sumEds(t, (ed) => eday?.eds?.[ed]?.['2024']?.eday?.DEM);
    const edD = L.D - L.eD, edR = L.R - L.eR;
    if (tr + tdm && edD + edR > 0) { const a = (100 * tdm) / (tr + tdm), b = (100 * edD) / (edD + edR);
      card(`ELECTION DAY: HARRIS ${a.toFixed(0)}%, ${dN} ${b.toFixed(0)}%`, { label: 'HARRIS E-DAY ’24', v: a, txt: `${a.toFixed(0)}%` }, { label: `${dN} E-DAY`, v: b, txt: `${b.toFixed(0)}%` }, 'Election Day ballots only, Dem share of D+R'); }
    // 8. Dem candidate vs the top vote-getter of last year's council race
    const council = races.filter((x) => x.year === 2025 && /Council/.test(x.contest))[0];
    if (council && L.dem) {
      const self = council.cands.find((c) => last(c.name) === dN), top = council.cands[0];
      const ref = self || top;
      card(self ? (L.dem.votes >= self.votes ? `${dN} ALREADY BEAT HIS 2025 TOTAL` : (L.eday ? `${dN}: ${fmt(L.dem.votes)} VOTES SO FAR` : `${dN}: ${fmt(L.dem.votes)} VOTES BEFORE ELECTION DAY`)) : `CLOSING IN ON ${last(top.name)}’S 2025 TOTAL`,
        { label: `${last(ref.name)} 2025`, v: ref.votes, txt: fmt(ref.votes) }, { label: `${dN} TONIGHT`, v: L.dem.votes, txt: fmt(L.dem.votes) },
        `2025 ${council.contest} (top vote-getter) vs 2026 so far`);
    }
    // 9. LOCAL photo cards (freely licensed Commons photos) tied to tonight's margin
    const phot = (f) => imgs?.[f] ? { file: imgs[f].file, credit: `PHOTO: ${imgs[f].author} · ${imgs[f].license} · Wikimedia Commons` } : null;
    const winN = lead >= 0 ? dN : (L.gop ? last(L.gop.name) : 'GOP'), m = Math.abs(lead);
    const bg1 = phot(t === 'pineplains' ? 'stissing.jpg' : 'bangall-po.jpg'), bg2 = phot(t === 'pineplains' ? 'pp-townhall.jpg' : 'stanfordville-station.jpg');
    if (bg1 && close) {
      const thenD = close.w.party === 'DEM' ? close.m : -close.m;
      out.push({ k: 'town', live: true, bg: bg1, head: lead * thenD < 0 ? `${P} FLIPPED` : `${P} STAYED ${thenD > 0 ? 'BLUE' : 'RED'}`,
        two: [{ label: `${close.x.year} ${/Supervisor/.test(close.x.contest) ? 'SUPV' : 'BOARD'}`, txt: mg(thenD), then: true }, { label: `${dN} TONIGHT`, txt: mg(lead), hot: true }],
        noBars: true, src: `${close.x.year} ${close.x.contest} vs 2026 counted so far` });
    } else if (bg1) out.push({ k: 'town', live: true, bg: bg1, head: `${winN} ${lead >= 0 ? 'LEADS' : 'LEADS'} IN ${P}`, noBars: true,
      two: [{ label: dN, txt: fmt(L.dem?.votes || 0), then: true }, { label: L.gop ? last(L.gop.name) : 'GOP', txt: fmt(L.gop?.votes || 0), hot: true }], src: 'Counted so far' });
    const sts = (stories || []).filter((x) => x.town === t);
    sts.forEach((x, n) => {
      const isDem = /\(D\)/.test(x.about), tn = isDem ? dN : (L.gop ? last(L.gop.name) : 'GOP');
      const ahead = isDem ? lead : -lead;
      out.push({ k: 'story', live: true, bg: (n ? bg2 : bg1) || bg1, head: x.headline, line: x.line,
        tonight: ahead > 0 ? `TONIGHT: ${tn} WINS BY ${fmt(Math.abs(lead))}` : `TONIGHT: ${tn} TRAILS BY ${fmt(Math.abs(lead))}`,
        src: `${x.source}, ${new Date(x.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` });
    });
    // interleave: a photo card after every 2 number cards so they are mixed through the deck
    const nums = out.filter((c) => !c.bg), pics = out.filter((c) => c.bg), mixed = [];
    while (nums.length || pics.length) { mixed.push(...nums.splice(0, 2)); if (pics.length) mixed.push(pics.shift()); }
    return mixed;
  }

  function countyCards() {
    const C = data?.county; if (!C) return [];
    return [
      { k: 'then', head: 'DUTCHESS EARLY VOTE MORE THAN DOUBLED', two: [{ label: '2025', v: C.ev25, txt: fmt(C.ev25), then: true }, { label: 'TONIGHT', v: C.ev26, txt: fmt(C.ev26), hot: true }], src: `All ${C.eds} Dutchess election districts · early + mail` },
      { k: 'then', head: 'DUTCHESS EARLY VOTERS SWUNG BLUE', two: [{ label: 'HARRIS ’24', v: C.evDem24, txt: `${C.evDem24.toFixed(0)}%`, then: true }, { label: 'DEM GOV TONIGHT', v: C.evDem26, txt: `${C.evDem26.toFixed(0)}%`, hot: true }], src: 'Countywide early + mail ballots, D share of D+R' },
    ];
  }

  // ---------- rendering ----------
  function chartHtml(c) {
    if (!c.two) return '';
    const max = Math.max(1, ...c.two.map((x) => x.v || 0));
    return `<div class="ic-bars two ${c.noBars ? 'nobars' : ''}">${c.two.map((x) => `<div class="ic-col ${x.hot ? 'hot' : 'then'}">
      ${c.noBars ? `<span class="ic-lab">${esc(x.label)}</span>` : ''}<b class="ic-val ${String(x.txt).length >= 6 ? 'long' : ''}">${esc(x.txt)}</b>
      ${c.noBars ? '' : `<div class="ic-barwrap"><i style="--h:${(100 * (x.v || 0)) / max}%"></i></div><span class="ic-lab">${esc(x.label)}</span>`}</div>`).join('<em class="ic-arrow">→</em>')}</div>`;
  }
  function cardHtml(c) {
    if (c.bg) {
      const mid = c.k === 'story'
        ? `<h1 class="ic-head">${esc(c.head)}</h1><p class="ic-line">${esc(c.line)}</p><div class="ic-tonight">${esc(c.tonight)}</div>`
        : `<h1 class="ic-head">${esc(c.head)}</h1>${chartHtml(c)}`;
      return `<div class="ic-photo" style="background-image:url('${esc(c.bg.file)}')"></div><div class="ic-tint"></div>
        <div class="ic-kick ${c.k}"><span>${KICK[c.k]}</span>${c.live ? '<b class="ic-live">● LIVE</b>' : ''}</div>
        <div class="ic-pbody">${mid}</div>
        <div class="ic-src">${c.k === 'story' ? 'STORY: ' : 'SOURCE: '}${esc(c.src)} · ${esc(SRC)}</div><div class="ic-credit">${esc(c.bg.credit)}</div>`;
    }
    return `<div class="ic-kick ${c.k}"><span>${KICK[c.k]}</span>${c.live ? '<b class="ic-live">● LIVE</b>' : ''}</div>
      <div class="ic-body"><div class="ic-text"><h1 class="ic-head">${esc(c.head)}</h1>
        ${c.line ? `<p class="ic-line">${esc(c.line)}</p>` : ''}</div>
        <div class="ic-chart">${chartHtml(c)}</div></div>
      <div class="ic-src">SOURCE: ${esc(c.src)} · ${esc(SRC)}</div>`;
  }
  function buildDeck() {
    if (!data) return [];
    const cc = countyCards();
    const pick = cc.length ? [cc[shows % cc.length]] : [];
    return [...townCards(town).map((c) => ({ ...c, place: TOWNS[town].place })), ...pick.map((c) => ({ ...c, place: 'DUTCHESS COUNTY' }))];
  }
  function showCard(k, refreshOnly) {
    if (!deck.length) { stage.innerHTML = `<div class="ins-card"><div class="ic-kick know"><span>HOMETOWN INSIGHTS</span></div><h1 class="ic-head">LOADING THE NUMBERS…</h1></div>`; return; }
    i = ((k % deck.length) + deck.length) % deck.length;
    const c = deck[i];
    if (refreshOnly) { const cur = stage.querySelector('.ins-card:last-child'); if (cur) { cur.classList.toggle('photo', !!c.bg); cur.innerHTML = cardHtml(c); cur.classList.add('in'); } }
    else {
      const el = document.createElement('div');
      el.className = 'ins-card enter' + (c.bg ? ' photo' : '');
      el.innerHTML = cardHtml(c) + '<div class="ic-wipe"></div>';
      stage.append(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
      const old = [...stage.children].slice(0, -1);
      setTimeout(() => old.forEach((o) => o.remove()), 700);
    }
    placeEl.textContent = c.place;
    placeEl.className = 'ins-place ' + (c.place === 'DUTCHESS COUNTY' ? 'county' : '');
    dotsEl.innerHTML = deck.map((d, j) => `<i class="${j === i ? 'on' : ''} ${d.place === 'DUTCHESS COUNTY' ? 'county' : ''}"></i>`).join('');
  }
  function start() {
    deck = buildDeck(); clearInterval(timer); showCard(0);
    if (deck.length) timer = setInterval(() => { if (!active) return; const keep = i; deck = buildDeck(); showCard(keep + 1); }, every);
  }
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.key === 'ArrowDown') { deck = buildDeck(); showCard(i + 1); }
    if (e.key === 'ArrowUp') { deck = buildDeck(); showCard(i - 1); }
  });

  return {
    update(s) {
      state = s;
      // keep LIVE numbers fresh on the current card without re-running the wipe
      if (active && deck.length) { const keep = i; deck = buildDeck(); if (deck.length) showCard(Math.min(keep, deck.length - 1), true); }
    },
    showSegment(seg) {
      const was = active;
      active = seg?.id === 'history';
      board.classList.toggle('on', active);
      if (active) {
        town = seg.town === 'stanford' ? 'stanford' : 'pineplains';
        if (!was || seg.startedAt) { shows++; rot[town]++; }
        const n = Math.max(1, buildDeck().length || 7);
        every = Math.max(8000, Math.min(12000, (seg.durationMs || 70000) / n)); // user: ~2x slower so cards are readable
        start();
      } else clearInterval(timer);
    },
  };
}
