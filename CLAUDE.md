# election_night

Project for building live US election-results dashboards/visualizations. Started on election night, Nov 3 2026 (US midterms). The user lives in **Dutchess County, NY** and cares about local results as well as national ones.

## Layout

- `research/` — source research on election-results APIs and feeds
  - `research/REPORT.md` — the main synthesized report: every source, its cost, how fresh its data is, how detailed it is, and a recommended architecture. **Read this first before building anything.**
  - `research/sources.md` — per-category source tables (paid, free, media feeds, NY State, Dutchess, ENR vendors, ballot context)
  - `research/raw/*.json` — raw structured findings from each research agent (one file per category)
  - `research/samples/` — saved snapshots of real feed responses, for testing parsers offline
- `server/` — a Node 24 server with no framework. Pollers write into one store, and the store pushes updates to the browser over SSE (`/events`).
  - `config.mjs` — the watched races (`WATCH`), endpoints and poll intervals. Start here to add or change races.
  - `sources/{dutchess,nyt,kalshi,news}.mjs` — one adapter per source. Each converts its data to the normalized race shape.
  - `store.mjs` — compares each update with the previous one and generates events (first results, lead change, call, new votes, BOE publish, polls closed). It also picks the spotlight race and records history to `data/history.jsonl`.
  - `index.mjs` — HTTP server, static files and these endpoints: `/api/state`, `/api/health`, `/api/clientlog`, `/api/test-event`.
- `public/` — the broadcast frontend: plain ES modules plus Three.js through an importmap from `/vendor/` (served from node_modules). There is no build step. The module interfaces and data shape are in `docs/FRONTEND_CONTRACT.md`.
- `public/js/` — one module per broadcast piece, each with `update(state)` / `showSegment(seg)` / `onEvent(ev)`:
  - `main.js` — loads every module independently.
  - `director.js` — the PLAYLIST rotation. It handles ad-hoc jumps for clicks and keys, skips decided races, and maps takeover segments to safe scene/overlay segments.
  - `overlay.js` — top bar, left race card (with the wide hometown layout, OUTLOOK, district splits and "What to watch"), right watchlist, and the Control of Congress panel.
  - `chyron.js` / `alerts.js` — the ticker, and full-screen takeovers with flood protection.
  - Takeover boards over the left column + stage:
    - `senate.js` — Senate Watch, the ladder to 51.
    - `wave.js` — the Big Picture: flips and upsets.
    - `ahead.js` — Ahead of the News: data-derived predictions.
    - `insights.js` — Hometown Insights: then-vs-tonight cards, local stories and photos.
    - `battleground.js`
    - `fun.js` — meme stat cards.
  - `scene/` — Three.js: synthwave world, county maps, hometown terrain (`hometownTerrain.js` + `public/geo/hometown*.{json,bin}`), and the balance arcs.
  - `fit.js` — auto-fits stacked columns.
- `public/geo/` — prebuilt static data. Rebuild it with the `scripts/build-*.mjs` scripts: hometown terrain, history, insights, Election Day lean, local stories, and CC-licensed photos with credits in `local-images.json`.
- `logs/` — JSON-lines logs: `poll.log` (every fetch), `events.log`, `error.log`, and `client.log` (browser errors and heartbeats). `scripts/watch.sh` filters these down to the lines worth acting on.

## Deploy (Vercel)

- The 2026 Vercel project was deleted after election night. To deploy again, run `vercel link` to create or link a project, then `vercel deploy --prod --yes`. This builds `dist/` via `scripts/build-static.mjs` (public plus vendor libs).
- `api/index.mjs` runs the whole app (`server/app.mjs`: pollers, SSE, API) inside one Fluid Compute function. Its config: `maxDuration` 300, SSE reconnects automatically, and `DATA_DIR`/`LOG_DIR` point at /tmp. `vercel.json` rewrites `/events` and `/api/*` to that function with `?p=`.
- On Vercel, `/api/test-event` is disabled.
- **Any data file the server reads at runtime must be listed in `vercel.json` `functions.includeFiles`.** Otherwise it silently doesn't exist on Vercel. Missing `data/hometown-baseline.json` made the public site show a false "DONE · can't be caught" for Pine Plains. The outlook code also refuses to call DONE while Election Day is out or the baseline is missing.
- The local server (`npm start`) runs the same app and is what the log monitor watches.

## Shipping rule

Every change goes live in BOTH places: run `npm run ship`. It syntax-checks, restarts local :4173 by PID, and deploys Vercel prod if the folder is linked (`.vercel/project.json`). Never fix locally only. Never restart with `pkill` either, because that kills agents' test servers too.

## Layout and sizing

All screen zones and the **Sizing rules** are in `docs/FRONTEND_CONTRACT.md`. Short version: stacked panels don't flex-shrink, fixed-height columns are registered in `public/js/fit.js`, nothing covers the 3D stage window, and every layout change is tested at 1920×1080, 1512×945 and 2000×810.

## Commands

- `npm start` — the live server on :4173.
- `npm run sim` — simulated results on :4174, with logs going to `logs-sim/`.
- `npm run check` — syntax check.
- `curl localhost:4173/api/health` — feed freshness.

## Working with election data

- Treat the research files as a snapshot taken on 2026-11-03. Endpoints for undocumented feeds (media JSON, ENR vendor URLs) change often, so before relying on one, run `curl -sI <url>` against it.
- Election-night numbers are **unofficial** results. Label them that way in any UI, and show "last updated" timestamps from the source, not just from our poller.
- Be polite to sources: put a cache between pollers and the frontend, and never let the browser hit upstream endpoints directly. Poll roughly every 30–120s depending on the source (see REPORT.md), and back off on errors or 429s. County BOE sites upload in batches, so there's no point polling them faster than every minute or two.
- Prefer official sources (state/county BOE, AP) over scraped media feeds. Media feeds carry ToS risk, so keep them optional and swappable behind one adapter interface.
- Normalize every source into one internal shape (race → candidates → votes, plus reporting % and timestamp), so the frontend never has to care where the data came from.

## Primary data sources (verified 2026-11-03)

All of these are free and need no auth. The first two are undocumented, so treat them as fragile. Full details are in `research/REPORT.md`.

1. **Dutchess County BOE, via Enhanced Voting JSON.** Base URL: `https://app.enhancedvoting.com/results/public/api`
   - `GET /elections/dutchess-county-ny/GE2026` — small metadata. Poll every 60s and compare `publishVersionId` / `asOf` to detect changes.
   - `GET /elections/dutchess-county-ny/GE2026/data` — all ~101 contests, ~450 KB. Fetch only when the version changes.
   - `GET /elections/dutchess-county-ny/GE2026/data/ballot-item/{ballotItemId}` — per-election-district breakdown (158 EDs), ~1.2 MB.
   - `GET /jurisdictions/{slug}` — lists election IDs. Neighboring counties (orange, putnam, ulster, columbia, rockland, westchester) use the same platform with different election IDs.
   - NY has **fusion voting**: one candidate appears on multiple party lines, so sum the rows by candidate name. Results are also split by vote method (Election Day / Early / Absentee / Affidavit).
   - For testing against real numbers, use the completed 2025 election: `GE25`.
2. **NYT results JSON (AP-sourced).** URL pattern: `https://static01.nyt.com/elections-assets/pages/data/2026-11-03/results-{new-york-governor|new-york|governor|senate|house}.json`
   - Poll every 20–30s with ETag. Avoid the ~9 MB house file; use the state-scoped files instead.
   - These files include county rows. NYT/AP lists 156 precincts for Dutchess vs Enhanced Voting's 158, so don't join the two at precinct level.
   - NYT's terms forbid scraping, so this is for personal use only.
3. **Kalshi odds** (probabilities, not votes): `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=CONTROLH-2026`. Polymarket's Gamma API also works.

What doesn't work:
- The NYS BOE ENR site (`nyenr.elections.ny.gov`) blocks scripted requests with Cloudflare.
- The Dutchess WordPress site only has PDFs.
- Cheap self-serve paid APIs don't exist: AP and DDHQ require going through sales.

## Conventions

- Always build or run the project after making changes, to check for errors.
- Never commit API keys (AP, DDHQ, etc.). Keep them in `.env.local`, which must be in `.gitignore`.

## Election-night 2026 notes (for next time)

- **Dutchess Enhanced Voting:**
  - The CDN ignores query strings, so bypass its cache with a randomly cased path.
  - The origin replicas disagree for a while after each publish. Never accept a publish older than the newest one seen.
- **Hometown "expected vote":** max(2024 × 0.75, 2025 total). Election Day leans GOP in Pine Plains and Stanford, and early votes lean Dem.
- **Network chamber calls are detected from headlines**, with strict wording, only after polls close, and AP excluded. AP calls come only from the data feed.
- **Lessons from the user:**
  - Ship fast.
  - Deploy to both local and Vercel.
  - No ellipses; minimum text size .7vw.
  - Only interesting, then-vs-tonight content.
  - Follow the news narrative.
  - Fix bugs from the logs proactively.

## Reusing this for a future election

The current setup is tuned to the 2026-11-03 narrative: Senate-first, then Michigan and Maine after the Senate was called. To reuse it:
- **`server/config.mjs`:**
  - `WATCH`: the races you care about. For hometown races, set `contest` names from the BOE `/data` and `town` for the ED matching.
  - Kalshi event tickers.
  - The NYT date path (`NYT_BASE`).
  - The Enhanced Voting election id (`GE2026`).
- **`public/js/director.js` `PLAYLIST`:** rebalance the segments for the night's story. Ad-hoc jumps (clicks and keys) work for any segment id.
- **`server/store.mjs`:** `POLLS_FIRST_CLOSE`, and the hard-coded `pollClose` values in `WATCH`.
- **Rerun the `scripts/build-*.mjs` prebakes** for new towns: terrain bbox, history, Election Day lean, insights, local stories and images.
