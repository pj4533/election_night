export const PARTY_COLOR = { DEM: '#2d8cff', GOP: '#ff2e55', LIB: '#ffab2e', GRN: '#3dff8a', WRI: '#8b8aa3', OTH: '#ffab2e' };
export const partyColor = (p) => PARTY_COLOR[p] || PARTY_COLOR.OTH;
export const fmtInt = (n) => (n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
export const fmtPct = (n, d = 1) => (n == null || isNaN(n) ? '—' : `${n.toFixed(d)}%`);
export const fmtProb = (p) => (p == null ? '—' : `${Math.round(p * 100)}%`);
export const etTime = (t, sec = false) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
export function ago(t, now = Date.now()) {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - (typeof t === 'number' ? t : Date.parse(t))) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}
export function countdown(target, now = Date.now()) {
  const ms = Math.max(0, Date.parse(target) - now);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return { ms, h, m, s, text: `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` };
}
export const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
export const roush = (race) => race?.candidates?.find((c) => c.name.includes('Roush'));
export const majorTwo = (race) => (race?.candidates || []).filter((c) => !['WRI'].includes(c.party)).slice(0, 2);
// animate a number in an element: tween from previous value
export function tweenNumber(elm, to, { dur = 900, format = fmtInt } = {}) {
  const from = Number(elm.dataset.v ?? to);
  elm.dataset.v = to;
  if (from === to) { elm.textContent = format(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    elm.textContent = format(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// betting odds label for any candidate that has a market (Kalshi + Polymarket avg, 0-1)
export const betTxt = (c) => (c?.odds != null && !isNaN(c.odds) ? `BETTORS ${Math.round(c.odds * 100)}%` : '');
