// Central configuration: which races we watch, where data comes from, how often we poll.

export const PORT = Number(process.env.PORT || 4173);
export const UA = 'election-night-dashboard/1.0 (personal, non-commercial; polite polling)';

export const DUTCHESS = {
  base: 'https://app.enhancedvoting.com/results/public/api/elections/dutchess-county-ny/GE2026',
  // meta is ~4KB; cache-busted so we bypass the 60s CDN cache and see BOE publishes within seconds
  metaIntervalMs: 5_000, // random-case path → origin fetch (4KB); see dutchess.mjs
  // safety net: refetch full /data even if version looks unchanged
  fullRefreshMs: 5 * 60_000,
};

export const NYT_BASE = 'https://static01.nyt.com/elections-assets/pages/data/2026-11-03';
export const NYT = {
  nationalFiles: ['senate', 'governor'], // all Senate + Governor races, state-level, + party control + insights + poll closings
  nationalIntervalMs: 5_000, // max-age=5 on CDN; ETag → 304 when unchanged
  stateIntervalMs: 12_000, // county-level files, staggered
};

export const KALSHI = {
  base: 'https://api.elections.kalshi.com/trade-api/v2',
  intervalMs: 20_000,
  raceIntervalMs: 25_000, // battleground race markets (batched by ticker)
  discoverEveryMs: 30 * 60_000,
  discoverSpacingMs: 450,
  events: ['SENATEMI-26', 'SENATETX-26', 'GOVPARTYIA-26', 'CONTROLS-2026', 'CONTROLH-2026'],
};

export const NEWS = {
  intervalMs: 60_000,
  feeds: [
    { name: 'Google News', url: gnews('election results when:2h') },
    { name: 'Google News', url: gnews('projects control of the House OR Senate when:6h'), tag: 'control' },
    { name: 'Google News', url: gnews('"El-Sayed" Michigan Senate when:1d'), tag: 'mi-sen' },
    { name: 'Google News', url: gnews('Talarico Paxton when:1d'), tag: 'tx-sen' },
    { name: 'Google News', url: gnews('Iowa governor "Rob Sand" when:1d'), tag: 'ia-gov' },
    { name: 'Google News', url: gnews('"Pine Plains" OR "Dutchess County" election'), tag: 'pineplains' },
    { name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml' },
    { name: 'NPR', url: 'https://feeds.npr.org/1014/rss.xml' },
    { name: 'Politico', url: 'https://rss.politico.com/politics-news.xml' },
    { name: 'NBC', url: 'https://feeds.nbcnews.com/nbcnews/public/politics' },
    { name: 'CBS', url: 'https://www.cbsnews.com/latest/rss/politics' },
    { name: 'The Hill', url: 'https://thehill.com/homenews/campaign/feed/' },
    { name: 'Fox', url: 'https://moxie.foxnews.com/google-publisher/politics.xml' },
    { name: 'HudsonValleyOne', url: 'https://hudsonvalleyone.com/feed/', tag: 'local' },
  ],
};
function gnews(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

// The races the user cares about, in priority order.
export const WATCH = [
  {
    key: 'pineplains', kind: 'dutchess', contest: 'Pine Plains Town Supervisor',
    title: 'Pine Plains Town Supervisor', short: 'PINE PLAINS SUPV', place: 'Dutchess County, NY',
    friend: 'Trevor Roush', pollClose: '2026-11-04T02:00:00Z',
  },
  {
    key: 'stanford-council', kind: 'dutchess', contest: 'Stanford Member of Town Council- Unexpired Term', town: 'Stanford',
    title: 'Stanford Town Council', short: 'STANFORD COUNCIL', place: 'Dutchess County, NY',
    pollClose: '2026-11-04T02:00:00Z',
  },
  {
    key: 'mi-sen', kind: 'nyt', nytId: 'MI-G-S-2026-11-03', stateFile: 'michigan', state: 'MI', fips: '26',
    title: 'Michigan U.S. Senate', short: 'MI SENATE', focus: 'elsayed-a', kalshi: 'SENATEMI-26',
  },
  {
    key: 'tx-sen', kind: 'nyt', nytId: 'TX-G-S-2026-11-03', stateFile: 'texas', state: 'TX', fips: '48',
    title: 'Texas U.S. Senate', short: 'TX SENATE', focus: 'talarico-j', kalshi: 'SENATETX-26',
  },
  {
    key: 'ia-gov', kind: 'nyt', nytId: 'IA-G-G-2026-11-03', stateFile: 'iowa', state: 'IA', fips: '19',
    title: 'Iowa Governor', short: 'IA GOVERNOR', focus: 'sand-r', kalshi: 'GOVPARTYIA-26',
  },
];

// Other Dutchess contests surfaced in the ticker
export const DUTCHESS_TICKER = [
  ['Governor/ Lieutenant Governor', 'DUTCHESS GOV'],
  ['Representative in Congress for Congressional District 18', 'NY-18 (DUTCHESS)'],
  ['Representative in Congress for Congressional District 17', 'NY-17 (DUTCHESS)'],
  ['County Sheriff', 'DUTCHESS SHERIFF'],
  ['Pine Plains Town Justice', 'PINE PLAINS JUSTICE'],
  ['Town of Pine Plains Proposition', 'PINE PLAINS PROP'],
];

export const STATE_SLUGS = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan',
  MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new-hampshire',
  NJ: 'new-jersey', NM: 'new-mexico', NY: 'new-york', NC: 'north-carolina', ND: 'north-dakota', OH: 'ohio',
  OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode-island', SC: 'south-carolina', SD: 'south-dakota',
  TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west-virginia',
  WI: 'wisconsin', WY: 'wyoming',
};

// Pine Plains, NY projected into us-atlas albers space (geoAlbersUsa scale 1300, translate [487.5,305])
export const PINE_PLAINS_XY = [868.78, 186.18];

export const POLYMARKET = {
  base: 'https://gamma-api.polymarket.com',
  controlIntervalMs: 30_000,
  racesIntervalMs: 60_000,
  controlSlugs: { senate: 'which-party-will-win-the-senate-in-2026', house: 'which-party-will-win-the-house-in-2026' },
};

export const NYT_HOUSE = { intervalMs: 20_000 };
