// Kalshi public market data: live odds for watched races, chamber control, and
// every competitive-looking Senate / Governor / House-district market we can discover.
import fs from 'node:fs';
import { KALSHI } from '../config.mjs';
import { get } from '../http.mjs';
import { houseKey, usePrice } from '../battleground.mjs';
import * as L from '../log.mjs';

const CACHE = `${process.env.DATA_DIR || (process.env.SIM === '1' ? 'data-sim' : 'data')}/kalshi-races.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// event ticker -> our race key (shared with NYT / Polymarket), or null to ignore
export function kalshiRaceKey(ev) {
  let m = /^SENATE(OH|FL)S-26$/.exec(ev) || /^SENATE([A-Z]{2})-26$/.exec(ev); // OHS / FLS specials collapse onto the state's only 2026 Senate race
  if (m) return `S-${m[1]}`;
  m = /^GOVPARTY-?([A-Z]{2})-26$/.exec(ev);
  if (m) return `G-${m[1]}`;
  m = /^HOUSE([A-Z]{2})(\d{1,2}|AL)-26$/.exec(ev) || /^HOUSEPARTY-([A-Z]{2})(\d{2})-26$/.exec(ev);
  if (m) return houseKey(m[1], m[2]);
  return null;
}
const partyFromTicker = (t) => (/-D$/.test(t) ? 'DEM' : /-R$/.test(t) ? 'GOP' : 'OTH');

export function createKalshi(store) {
  let timer, raceTimer, discTimer;
  let races = {}; // raceKey -> { event, tickers: [..] }

  async function tick() {
    const out = {};
    await Promise.all(KALSHI.events.map(async (ev) => {
      const r = await get('kalshi', `${KALSHI.base}/markets?event_ticker=${ev}`, { label: ev });
      if (!r.body) return;
      out[ev] = (r.body.markets || []).map((m) => ({
        ticker: m.ticker, name: m.yes_sub_title || m.no_sub_title,
        price: Number(m.last_price_dollars ?? (m.last_price != null ? m.last_price / 100 : NaN)),
        bid: Number(m.yes_bid_dollars ?? NaN), ask: Number(m.yes_ask_dollars ?? NaN),
      }));
    }));
    store.setOdds(out);
    store.setSourceStatus('kalshi', { ok: Object.keys(out).length > 0, lastPoll: Date.now() });
  }

  async function discover() {
    const sr = await get('kalshi', `${KALSHI.base}/series?category=Elections`, { label: 'series', timeoutMs: 30_000 });
    if (!sr.body?.series) return;
    const tickers = sr.body.series.map((s) => s.ticker).filter((t) => /^(SENATE(?:[A-Z]{2}|OHS|FLS)|GOVPARTY-?[A-Z]{2}|HOUSE[A-Z]{2}(?:\d{1,2}|AL)|HOUSEPARTY-[A-Z]{2}\d\d)$/.test(t));
    const found = {};
    for (const series of [...new Set(tickers)]) {
      const r = await get('kalshi', `${KALSHI.base}/events?series_ticker=${series}&status=open&with_nested_markets=true`, { label: `disc:${series}` });
      for (const e of r.body?.events || []) {
        const key = kalshiRaceKey(e.event_ticker);
        if (!key) continue;
        const ms = (e.markets || []).filter((m) => m.status !== 'finalized' && m.status !== 'settled');
        if (ms.length < 2) continue;
        found[key] = { event: e.event_ticker, tickers: ms.map((m) => m.ticker) };
      }
      await sleep(KALSHI.discoverSpacingMs);
    }
    if (Object.keys(found).length) {
      races = found;
      try { fs.mkdirSync(CACHE.replace(/\/[^/]+$/, ''), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify({ at: Date.now(), races })); } catch {}
      L.event({ type: 'kalshi-discovery', races: Object.keys(found).length });
    }
  }

  async function pollRaces() {
    const keys = Object.keys(races);
    if (!keys.length) return;
    const all = keys.flatMap((k) => races[k].tickers.map((t) => [k, t]));
    const byTicker = new Map(all.map(([k, t]) => [t, k]));
    const lists = {};
    for (let i = 0; i < all.length; i += 80) {
      const chunk = all.slice(i, i + 80).map((x) => x[1]);
      const r = await get('kalshi', `${KALSHI.base}/markets?tickers=${chunk.join(',')}&limit=100`, { label: `races:${i / 80}` });
      for (const m of r.body?.markets || []) {
        const key = byTicker.get(m.ticker);
        if (!key) continue;
        (lists[key] ||= []).push({
          party: partyFromTicker(m.ticker), name: m.yes_sub_title || m.no_sub_title,
          price: usePrice({ bid: m.yes_bid_dollars, ask: m.yes_ask_dollars, price: m.last_price_dollars }),
        });
      }
      await sleep(400);
    }
    store.setRaceOdds('kalshi', lists);
  }

  return {
    start() {
      tick(); timer = setInterval(tick, KALSHI.intervalMs);
      let seeded = false;
      for (const f of [CACHE, 'data/kalshi-races.json']) { // second path = bundled seed (Vercel)
        try { const c = JSON.parse(fs.readFileSync(f, 'utf8')); if (c.races) { races = c.races; seeded = true; break; } } catch {}
      }
      const run = () => discover().catch((e) => L.error({ src: 'kalshi', label: 'discover', error: String(e.stack || e) }));
      if (seeded) setTimeout(run, 10 * 60_000); else run();
      discTimer = setInterval(run, KALSHI.discoverEveryMs);
      let busy = false;
      const poll = async () => {
        if (busy) return;
        busy = true;
        try { await pollRaces(); } catch (e) { L.error({ src: 'kalshi', label: 'races', error: String(e.stack || e) }); }
        busy = false;
      };
      setTimeout(poll, 3000);
      raceTimer = setInterval(poll, KALSHI.raceIntervalMs);
    },
    stop() { clearInterval(timer); clearInterval(raceTimer); clearInterval(discTimer); },
  };
}
