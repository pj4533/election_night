# Election Night Data Sources: Report (Nov 3 2026, written 7:22 PM ET)

## 1. TL;DR and recommendation

**Yes, you can build the dashboard tonight, and it can be free.** There is no cheap paid real-time API that you can sign up for. Two free, unauthenticated JSON feeds do the job, and I checked both myself at 7:22 PM ET.

1. **Dutchess County: the BOE's own results backend (Enhanced Voting).** It returns clean JSON down to each election district (ED, the NY term for a precinct). Responses are cached for 60 seconds and any browser can fetch them (CORS is open). The BOE homepage links to this app as "General Election 2026 Unofficial Election Results". Right now it holds a pre-election placeholder with every count at 0.
2. **Statewide and national: the NYT's undocumented results JSON.** The data comes from AP and includes county rows. Files refresh every few seconds (`max-age=5`) and CORS is open. The NY governor file has a Dutchess row: 156 precincts, 0 votes so far.
3. **Optional extra: live odds from the Kalshi and Polymarket public APIs.** These are free with no key. They give probabilities, not vote counts.

**The stack I recommend:** a small poller (Node or Python) that reads the Enhanced Voting feed for Dutchess and the NYT feed for state and House races, plus Kalshi for odds. It writes everything into one cache and serves a static frontend. Neither results feed is a documented or sanctioned API, so keep fallbacks (see section 7).

**Biggest risk:** NY polls close at 9:00 PM ET. Neither feed had real votes when I checked, so nobody has yet measured how often numbers actually change tonight. The county says results post "slowly throughout the evening and next day".

**Contradictions between the research slices, resolved:** the NY-state and vendor slices said Dutchess has no API and only PDFs. That is wrong. They looked only at the WordPress BOE site. The Dutchess slice found the Enhanced Voting JSON backend, and I re-verified it returns HTTP 200 JSON. The context slice saw "enhancedvoting.com 307", which is just the vendor's root domain redirecting and doesn't matter. AP returning 401 in one probe and 403 in another means the same thing: you need a key.

## 2. All sources

| Source | Type | Cost | Latency | Granularity | Live-verified? |
|---|---|---|---|---|---|
| Dutchess BOE via Enhanced Voting JSON | Official county backend, undocumented | Free, no auth, CORS * | Cached 60s; real cadence set by BOE batch uploads (unmeasured) | County, contest, ED (158), vote-method and party-line splits | **Yes**: HTTP 200 at 7:22 PM, pre-election zeros. Full precinct schema confirmed on GE25 |
| NYT results JSON (`static01.nyt.com/.../2026-11-03/results-*.json`) | Media mirror of AP, undocumented | Free, CORS * | `max-age=5`, file modified about 5 min before my probe | State, county; race calls | **Yes**: HTTP 200 at 7:22 PM, Dutchess row present with zeros |
| civicAPI.org | Third-party aggregator, has docs page | Free (claimed) | Claims "up-to-the-minute" | Race, precinct option, CSV/JSON, map PNG | **Partial**: `/api/v2/status` and `/getElectionDates` work (38,697 races listed for Nov 3); `/race/search` timed out and `/race` returned 502 |
| Kalshi market data | Official exchange API | Free | Near real time, websocket offered | Race and chamber odds only | **Yes**: HTTP 200 |
| Polymarket Gamma | Official API | Free | Near real time | Race and chamber odds only | Yes (research slice) |
| AP Elections API | Paid, official | Sales-gated, no public price | Seconds to minutes (industry standard) | Down to precinct, with calls | Endpoint alive (401/403 without key) |
| Decision Desk HQ API | Paid, official | Contact sales, no price | Not stated | Race, chamber control, vote history | Docs up; API needs OAuth |
| Reuters / Edison | Paid, enterprise | Not researched | n/a | n/a | No |
| NYS BOE ENR (`nyenr.elections.ny.gov`) | Official | Free | After 9 PM; cadence unknown | State, county | **Blocked**: Cloudflare 403 to curl (I re-confirmed) |
| NYC BOE ENR (`enr.boenyc.gov`) | Official, NYC only | Free | Unknown | NYC down to ED | Redirect page only; no JSON |
| Dutchess BOE WordPress (PDF/CSV, `/wp-json`, `/feed`) | Official | Free | Certified PDFs days to weeks later | County, ED (PDF) | Yes (HTTP 200) |
| Neighbor counties on Enhanced Voting (Orange, Putnam, Ulster, Columbia, Rockland, Westchester) | Official backends, undocumented | Free | 60s cache | County and precinct | Yes, all GE2026 `/data` returned 200 with zeros (research slice) |
| CNN, Politico, WaPo, NBC, Fox feeds | Media, undocumented | Free if found | Unknown | Unknown | **No**: 2026 paths not found (404 or bot blocks) |
| Clarity/Scytl ENR + `clarify` library | Vendor feeds, undocumented | Free | Minutes | Precinct (XML) | Not used by Dutchess or NY (404). Useful only for GA/CO-style counties |
| NC SBE S3 bulk files | Official | Free | Refreshed in place | Precinct, statewide NC | Bucket is live; results file still pre-election |
| GA SOS CDN export | Official, undocumented | Free | 60s cache | Precinct | 2024 export works; 2026 election ID not found |
| CA SOS JSON API | Official, documented | Free | Unknown | State, county | Docs PDF found; no API call made |
| WA SOS exports, FL, PA, TX, AZ, MO, IA, OH, MI, VA | Official | Free | Unknown | State, county | Not confirmed (404, bot block or no connection) |
| Google Civic Info (elections/divisions) | Official | Free with key | n/a: no vote counts | Ballot, divisions | Service is up |
| FEC OpenFEC | Official | Free (DEMO_KEY works) | n/a: campaign finance | Candidate | Yes (NY-18 query works) |
| OpenElections NY, MIT MEDSL / Dataverse | Open data | Free | Weeks to months after the election | Precinct (historical) | Yes |
| Wikipedia | Crowd-edited | Free | Minutes to hours | Race | Yes |
| Cicero | Paid, self-serve | About $40 minimum credit pack | n/a: address-to-district lookup | Address | Pricing page loads |
| Ballotpedia API | Commercial | Unknown | Not live | Candidates | No |
| `elex` (NYT's AP client) | Open-source code | Free code, needs a paid AP key | n/a | n/a | Archived in 2022 |

## 3. Dutchess County specifics

**Is it an API?** Yes in practice. It is the JSON backend behind the official results page that the BOE links to: `https://app.enhancedvoting.com/results/public/dutchess-county-ny/GE2026`, an Angular single-page app. It is undocumented, has no published terms, and is not a supported public API.

All paths below start with `https://app.enhancedvoting.com/results/public/api`.

| Endpoint | Size | Use |
|---|---|---|
| `GET /elections/dutchess-county-ny/GE2026` | ~4 KB | Cheap change detection. Returns `asOf`, `lastUpdated`, `publishDate`, `publishVersionId`, `isOfficialResults`, `ballotsCast`, `precinctsReporting`, `groupReportingStatus` and count groups. **Verified at 7:22 PM:** `asOf=2026-10-27T13:43:52Z`, `isOfficialResults=false`, `isProduction=true`. |
| `GET /elections/dutchess-county-ny/GE2026/data` | 450,398 bytes (verified) | All 101 contests: `ballotItems[].summaryResults.ballotOptions[]` with `name`, `party` (including hex color), `voteCount`, `groupResults[]`, plus `isWinner`, precincts, polling places and turnout. |
| `GET /elections/dutchess-county-ny/GE2026/data/ballot-item/{ballotItemId}` | ~1.2 MB each | ED-level `breakdownResults[]` for one contest, 158 EDs. Schema confirmed on GE25, not yet on GE2026. |
| `GET /jurisdictions/dutchess-county-ny` | small | Lists election IDs. A junk slug also returns 200, so check that `.elections[]` is non-empty. |
| `/closeraces`, `/stats`, `/turnout`, `/vr`, `/localities` | n/a | Return empty for Dutchess. |

- **Format:** JSON, CORS `*`, `cache-control: public, max-age=60`.
- **Vote-method split:** Election Day, Early Voting, Absentee/EMB, Affidavit. These group names are verified in the live metadata.
- **Fusion voting:** each party line is a separate row (for example Hochul on Dem and on WFP). Sum the rows by candidate name to get a candidate's total.
- **Cadence:** a fetch can be at most 60 seconds stale. How often the BOE uploads a new batch tonight is not known. Watch `publishVersionId` and `asOf` change after 9 PM to measure it.
- **Notable contests:** Governor (Hochul/Adams vs Blakeman/Hood), Comptroller, AG, NY-17 (Conley vs Lawler), NY-18 (Ryan vs Auringer), SD39, SD41, AD103 to AD106, Sheriff, 25 County Legislature districts, Supreme Court, about 50 town races and about 10 propositions. This list comes from the research slice's read of the `/data` feed. There is no US Senate race in NY this year.
  - Correction to the context slice: it guessed the County Legislature was not on the ballot. The live feed lists it.
- **Precinct counts differ:** Enhanced Voting lists 158 EDs and NYT/AP lists 156 precincts for Dutchess. The cause is not verified (possibly virtual precincts). Don't join the two sources at precinct level without checking.
- **What is not an API:** the `elections.dutchessny.gov` WordPress site only has PDFs, a few old CSV/XLS files, a `/wp-json/` page API and `/feed/`. The `/feed/` is useful only to spot when the BOE posts a new PDF. The legacy county site `dutchessny.gov` has no results data.
- **Contact:** Dutchess BOE, 845-486-2473, 112 Delafield St, Poughkeepsie.

## 4. NY State specifics

- **NYS BOE ENR (`nyenr.elections.ny.gov`)** and `elections.ny.gov` both sit behind a Cloudflare challenge. I re-confirmed the 403 at 7:22 PM. No JSON endpoint was found. A real browser (Playwright or Chrome) with the network tab open, after 9 PM, is the only way to find one, and that is unverified. Results there are unofficial and assembled from county reports.
- **NYC BOE (`enr.boenyc.gov`)** is currently a static redirect to `vote.nyc`. It is probably populated only after the polls close, and it isn't relevant to Dutchess.
- **Best statewide source tonight is the NYT feed:**
  - `results-new-york-governor.json` (about 308 KB, 63 units: state plus 62 counties)
  - `results-new-york.json` (about 1.4 MB, all NY races)
- **The Enhanced Voting adapter also covers most of the Hudson Valley:** Orange, Putnam, Ulster, Columbia, Rockland and Westchester. Election IDs differ by county, for example Ulster `GE2026_20261019155937`, Putnam `GE2026_20261028103950` (its `GE2026` alias returns 204), and Westchester `2026GeneralElection`. Look each one up via `/jurisdictions/{slug}`. No statewide aggregate exists on this platform.
- **Timing:** polls 6 AM to 9 PM ET. Early-vote and Election Day totals come first. Absentees are counted later, and mail ballots received by Nov 10 count. Certified results arrive weeks later.

## 5. Ranked options

**Real-time, freshest first:**
1. **Kalshi and Polymarket:** sub-second to seconds, websocket available. Odds only.
2. **AP API:** seconds to minutes. Paid, and you can't get it tonight.
3. **NYT JSON:** `max-age=5`, AP-sourced, includes race calls. Free and undocumented.
4. **Enhanced Voting (Dutchess and neighbors):** 60-second cache, but bounded by county batch uploads. Free and undocumented.
5. **civicAPI:** claims up-to-the-minute data. Free, but its race endpoints were failing (502 and timeouts) at 7:22 PM.
6. **DDHQ API:** cadence unknown. Paid.
7. **NYS ENR:** unknown and bot-blocked.
8. **Wikipedia:** minutes to hours.
9. **BOE PDFs, OpenElections, MIT:** days to months.

**Paid, cheapest first:**
1. **Cicero:** about $40 minimum. Address-to-district lookup only, no results.
2. **DDHQ:** contact sales, no published price, no hobby tier found.
3. **AP Elections API:** contact sales, aimed at newsrooms. Keys are issued by AP support.
4. **Reuters/Edison:** enterprise, not researched.

**Verdict on paying:** nothing cheap and self-serve with live results exists. You don't need it for a personal dashboard tonight.

## 6. Dashboard architecture

```
[poller: Node/Python, one process]
   |- Dutchess meta    GET .../api/elections/dutchess-county-ny/GE2026          every 60s
   |      if publishVersionId changed -> GET .../GE2026/data                    (450 KB)
   |      optional: GET .../data/ballot-item/{id} for 3-5 key contests          (on change only)
   |- NYT               GET static01.nyt.com/.../2026-11-03/results-new-york-governor.json  every 20-30s, If-None-Match ETag
   |                    GET .../results-new-york.json                           every 30-60s, ETag
   |- Kalshi            GET api.elections.kalshi.com/trade-api/v2/markets?event_ticker=CONTROLH-2026  every 15-30s
   v
[cache: in-memory or SQLite; store every snapshot with timestamp -> time series]
   v
[tiny HTTP server: /api/state (normalized JSON) + SSE or websocket push on change]
   v
[frontend: static HTML/JS]
   - Dutchess tiles: Gov, NY-17, NY-18, SD39/41, AD103-106 (fusion lines summed; method split bar)
   - ED-level choropleth (Enhanced Voting precinct breakdown; boundaries via Mapbox tiles in the app
     or a public ED shapefile - boundary source not verified)
   - Statewide governor county map from NYT reporting_units
   - "% reporting / eevp", last-updated stamps per source, House-control odds sparkline
```

- **Why a server-side poller:** both feeds allow browser fetches (CORS `*`), but a single poller keeps load on the sources at one client no matter how many tabs you open, and it gives you a time series.
- **Interval limits:**
  - Enhanced Voting: never more often than every 60s; full `/data` only when the version changes.
  - NYT: every 10 to 30s with ETag; use the state-scoped files, not the 9 MB House file.
  - Kalshi: every 15 to 30s, or its websocket.
- **Test before 9 PM:** replay the finished Dutchess GE25 data (`/elections/dutchess-county-ny/GE25/data`) and NYT 2024 (`pages/data/2024-11-05/results-president.json`, 200 per the research slice) to build the UI against real numbers.
- **Sanity check after 9:15 PM:** confirm `publishVersionId` changes and that NYT Dutchess `precincts_reporting` rises above 0.

## 7. Caveats

- **Terms of service:**
  - The NYT feed is undocumented, and NYT's terms prohibit scraping and reuse. Keep it personal and non-commercial, credit NYT/AP, and expect it could change or be blocked.
  - Enhanced Voting has no published terms. Poll gently and identify yourself in the User-Agent.
  - Kalshi and Polymarket reads are permitted.
- **Rate limits:** none are published for the undocumented feeds; stay within the intervals above. GitHub's unauthenticated limit is 60 requests per hour if you pull OpenElections. Google Civic and FEC need keys for real volume.
- **Unofficial results:** everything tonight is unofficial. Absentee and affidavit ballots shift totals later. Certification takes weeks. Write-ins appear only in official results.
- **Not yet verified:**
  - Live vote counts in any NY feed (polls still open when I checked).
  - Dutchess batch cadence.
  - The Enhanced Voting ED breakdown on GE2026 specifically.
  - civicAPI reliability and data source.
  - NYS ENR's internal feed.
  - CNN, Politico and NBC feeds.
  - The 156 vs 158 precinct difference.
- **Single points of failure:** if Enhanced Voting changes, fall back to NYT county rows for Dutchess (state and federal races only, no town races). If NYT changes, fall back to civicAPI, then NYS ENR through a browser.

Verification snapshot: `research/samples/nyt-new-york-governor-2026-11-03-1922.json` (NYT governor feed at 7:22 PM, pre-poll-close).