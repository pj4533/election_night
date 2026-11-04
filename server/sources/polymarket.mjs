// Polymarket (Gamma API, public): chamber control + per-race winner markets.
import { POLYMARKET, STATE_SLUGS } from '../config.mjs';
import { get } from '../http.mjs';
import { houseKey, normalizeMarkets } from '../battleground.mjs';
import * as L from '../log.mjs';

const NAME_TO_POSTAL = Object.fromEntries(Object.entries(STATE_SLUGS).map(([p, slug]) => [slug, p]));
const postalOf = (name) => NAME_TO_POSTAL[String(name).trim().toLowerCase().replace(/\s+/g, '-')];
const price = (m) => {
  try { const p = JSON.parse(m.outcomePrices || 'null'); return p ? Number(p[0]) : NaN; } catch { return NaN; }
};
const live = (m) => m.active !== false && !m.closed && m.outcomePrices;

// event title -> race key
export function polyRaceKey(title) {
  let m = /^(.+?) Senate Election Winner/i.exec(title);
  if (m) { const p = postalOf(m[1]); return p ? `S-${p}` : null; }
  m = /^(.+?) Governor Election Winner/i.exec(title);
  if (m) { const p = postalOf(m[1]); return p ? `G-${p}` : null; }
  m = /^([A-Z]{2})-(\d{1,2}|AL) House Election Winner/i.exec(title);
  if (m) return houseKey(m[1].toUpperCase(), m[2].toUpperCase());
  return null;
}
function partyOfName(n) {
  const m = /\((D|R|I)\)\s*$/.exec(n || '');
  return m ? ({ D: 'DEM', R: 'GOP' }[m[1]] || 'OTH') : 'OTH';
}

export function createPolymarket(store) {
  const timers = [];

  async function control() {
    const out = {};
    for (const [chamber, slug] of Object.entries(POLYMARKET.controlSlugs)) {
      const r = await get('polymarket', `${POLYMARKET.base}/events?slug=${slug}`, { label: `control:${chamber}` });
      const ev = r.body?.[0];
      if (!ev) continue;
      const list = (ev.markets || []).filter(live).map((m) => ({
        party: /^Democratic/i.test(m.groupItemTitle || '') ? 'DEM' : /^Republican/i.test(m.groupItemTitle || '') ? 'GOP' : 'OTH',
        name: m.groupItemTitle, price: price(m),
      })).filter((x) => x.party !== 'OTH');
      const n = normalizeMarkets(list);
      if (n) out[chamber] = { DEM: n.DEM, GOP: n.GOP };
    }
    if (Object.keys(out).length) store.setPolymarketControl(out);
    store.setSourceStatus('polymarket', { ok: Object.keys(out).length > 0, lastPoll: Date.now() });
  }

  async function races() {
    const lists = {};
    for (let offset = 0; offset < 800; offset += 100) {
      const r = await get('polymarket', `${POLYMARKET.base}/events?tag_slug=midterms&active=true&closed=false&limit=100&offset=${offset}`, { label: `races:${offset}`, timeoutMs: 30_000 });
      const evs = r.body;
      if (!Array.isArray(evs)) break;
      for (const ev of evs) {
        const key = polyRaceKey(ev.title || '');
        if (!key) continue;
        const list = (ev.markets || []).filter(live).map((m) => ({ party: partyOfName(m.groupItemTitle), name: (m.groupItemTitle || '').replace(/\s*\([DRI]\)\s*$/, ''), price: price(m) })).filter((x) => Number.isFinite(x.price) && x.price > 0.002);
        // an event can be listed twice (special + regular): keep the one with more liquidity signal
        if (list.length && (!lists[key] || list.length >= lists[key].length)) lists[key] = list;
      }
      if (evs.length < 100) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const out = {};
    for (const [k, l] of Object.entries(lists)) {
      // Polymarket winner markets are independent yes-prices; normalize across the field
      const n = normalizeMarkets(l);
      if (n) out[k] = n;
    }
    if (Object.keys(out).length) store.setRaceOdds('polymarket', out);
  }

  const safe = (fn, label) => () => fn().catch((e) => L.error({ src: 'polymarket', label, error: String(e.stack || e) }));
  return {
    start() {
      const c = safe(control, 'control'), r = safe(races, 'races');
      c(); setTimeout(r, 2000);
      timers.push(setInterval(c, POLYMARKET.controlIntervalMs), setInterval(r, POLYMARKET.racesIntervalMs));
    },
    stop() { timers.forEach(clearInterval); },
  };
}
