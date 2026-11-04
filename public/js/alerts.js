import { el } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function kickerFor(ev) {
  if (ev.raceKey === 'pineplains') return '★ HOMETOWN ALERT ★';
  switch (ev.type) {
    case 'call': return ev.priority >= 4 ? 'PROJECTION' : 'BREAKING';
    case 'polls': return 'POLLS CLOSED';
    case 'lead': return 'LEAD CHANGE';
    case 'first': return 'FIRST RESULTS';
    case 'boe': case 'votes': return 'BREAKING';
    default: return 'BREAKING';
  }
}

export function createAlerts(root) {
  root.innerHTML = '';
  const seen = new Set();
  const queue = [];
  let showing = false;
  let state = null;
  const started = Date.now();

  function particles(host, party) {
    const cols = party === 'GOP' ? ['#ff2e55', '#ffd23f', '#fff'] : ['#2d8cff', '#00f0ff', '#ffd23f', '#ff2bd6', '#fff'];
    for (let burst = 0; burst < 5; burst++) {
      const ox = (Math.random() - 0.5) * 60, oy = (Math.random() - 0.5) * 30, bd = burst * 0.8;
      for (let i = 0; i < 34; i++) {
        const p = el('div', 'al-part');
        const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 30;
        const c = cols[(Math.random() * cols.length) | 0];
        p.style.cssText = `--x:${ox + Math.cos(a) * r}vw;--y:${oy + Math.sin(a) * r * 0.8}vh;--d:${bd + Math.random() * 0.15}s;--t:${1.8 + Math.random()}s;background:${c};box-shadow:0 0 1vh ${c};left:${50}%;top:${50}%`;
        host.append(p);
      }
    }
  }

  function play(ev) {
    showing = true;
    const dur = ev.priority >= 4 ? 10000 : 7000;
    const pine = ev.raceKey === 'pineplains';
    const text = (ev.text || '').toString();
    const wrap = el('div', 'al' + (ev.party === 'DEM' ? ' dem' : ev.party === 'GOP' ? ' gop' : '') + (pine ? ' pine' : '') + (ev.priority >= 4 ? ' b4 shake' : ''));
    wrap.style.setProperty('--dur', dur + 'ms');
    const cls = text.length > 90 ? 'xl' : text.length > 44 ? 'long' : '';
    wrap.innerHTML = `<div class="al-bg"></div>
      <div class="al-edge t"></div><div class="al-edge b"></div>
      <div class="al-bar" style="top:22vh"></div><div class="al-bar r" style="top:78vh;animation-delay:.25s"></div>
      <div class="al-bar" style="top:40vh;animation-delay:.5s;height:.6vh"></div><div class="al-bar r" style="top:62vh;animation-delay:.7s;height:.6vh"></div>
      <div class="al-ring"></div>
      <div class="al-stage">
        ${pine ? '<div class="al-star">★ ★ ★</div>' : ''}
        <div class="al-kick">${esc(kickerFor(ev))}</div>
        <div class="al-title ${cls}"><span class="t">${esc(text)}</span><span class="g1">${esc(text)}</span><span class="g2">${esc(text)}</span></div>
        ${ev.sub ? `<div class="al-sub">${esc(ev.sub)}</div>` : ''}
      </div>
      ${pine ? '<div class="al-pp">PINE PLAINS · TOWN SUPERVISOR</div>' : ''}
      <div class="al-flash"></div>`;
    root.append(wrap);
    const celebrate = pine && (ev.party === 'DEM' || /roush/i.test(text)) && ev.type !== 'polls';
    if (celebrate || (pine && ev.priority >= 4)) particles(wrap, ev.party || 'DEM');
    setTimeout(() => {
      // calm the glitch toward the end
      wrap.querySelector('.al-title')?.classList.add('calm');
    }, dur * 0.5);
    setTimeout(() => { wrap.remove(); showing = false; next(); }, dur + 100);
  }

  function next() {
    if (showing) return;
    // drop stale queued entries (>2 min old at show time)
    while (queue.length) {
      const ev = queue.shift();
      if (Date.now() - (ev.ts || Date.now()) > 120000) continue;
      play(ev);
      return;
    }
  }

  // Flood protection: dedupe by CONTENT (ids reset on server restarts / new Vercel instances), suppress the same
  // story within 15 min (e.g. 5 networks each "projecting" the House), and never queue more than 3 takeovers.
  const recent = new Map();
  const storyKey = (ev) => String(ev.text || '').toUpperCase().replace(/^[^:]*:\s*/, '').replace(/\s+/g, ' ').trim();
  function enqueue(ev) {
    if (!ev || ev.id == null) return;
    const uid = `${ev.id}|${ev.ts}|${ev.text}`;
    if (seen.has(uid) || seen.has(ev.id + '|' + ev.ts)) return;
    seen.add(uid);
    const k = storyKey(ev), now = Date.now();
    if (k && recent.has(k) && now - recent.get(k) < 15 * 60_000) return;
    if (k) recent.set(k, now);
    if (ev.priority < 3) return;
    if (ev.ts && Date.now() - ev.ts > 120000) return;
    // higher priority first, stable otherwise
    let i = queue.length;
    while (i > 0 && queue[i - 1].priority < ev.priority) i--;
    queue.splice(i, 0, ev);
    while (queue.length > 3) queue.pop(); // lowest priority / newest-of-equal dropped
    next();
  }

  return {
    update(s) {
      state = s;
      // mark history as seen so a reconnect never replays it
      // history in a state push (page load / reconnect) is NEVER replayed as takeovers — only live 'event' messages are
      for (const e of s?.events || []) { seen.add(`${e.id}|${e.ts}|${e.text}`); const k = storyKey(e); if (k && !recent.has(k)) recent.set(k, e.ts || Date.now()); }
    },
    onEvent(ev) { enqueue(ev); },
  };
}
