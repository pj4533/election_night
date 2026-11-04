// NYT House results (~9 MB, all 435 districts). Polled with ETag; kept state-level only.
import { NYT_BASE, NYT_HOUSE } from '../config.mjs';
import { get } from '../http.mjs';
import { normalizeNytRace } from './nyt.mjs';
import * as L from '../log.mjs';

export function createNytHouse(store) {
  let timer, busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const r = await get('nyt', `${NYT_BASE}/results-house.json`, { etag: true, label: 'house', timeoutMs: 40_000 });
      if (r.notModified || !r.body) return;
      const d = r.body;
      L.poll({ src: 'nyt', label: 'house', status: r.status, ms: r.ms, bytes: r.bytes, changed: true, resultsUpdatedAt: d.resultsMeta?.resultsUpdatedAt, races: d.races?.length });
      const races = [];
      for (const race of d.races || []) {
        if (race.office_id !== 'H' || !/^[A-Z]{2}-/.test(race.nyt_id)) continue; // skips the US-national aggregate
        const n = normalizeNytRace({ ...race, reporting_units: undefined, precincts: undefined });
        delete n.counties; delete n.description; delete n.history2024; delete n.focus; delete n.kalshi;
        n.candidates = n.candidates.map((c) => ({ ...c, methods: undefined, quantiles: undefined }));
        races.push(n);
      }
      store.updateHouseRaces(races);
      if (d.partyControlData?.results?.[0]?.offices) store.updatePartyControl(d.partyControlData.results[0].offices);
    } catch (e) {
      L.error({ src: 'nyt', label: 'house', error: String(e.stack || e) });
    } finally { busy = false; }
  }
  return { start() { tick(); timer = setInterval(tick, NYT_HOUSE.intervalMs); }, stop() { clearInterval(timer); } };
}
