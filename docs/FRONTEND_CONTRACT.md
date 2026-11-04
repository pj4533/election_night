# Frontend contract

The frontend is a full-screen **24-hour-news election broadcast with no people**: a 3D synthwave/cyberpunk stage (Three.js), broadcast graphics laid over it, a two-tier chyron, and full-screen "BREAKING / PROJECTION" takeovers. It is designed for 1920×1080, scales with `vw`/`vh`, and is meant to be left running on a TV.

## Files and owners

| File | Owner | Purpose |
|---|---|---|
| `public/index.html` | shared (base) | DOM roots, importmap, fonts, CSS links. Don't restructure; add only what you need. |
| `public/css/theme.css` | shared (base) | Color/font tokens. Use the variables; don't redefine them. |
| `public/js/main.js` | shared (base) | Wires the data client, director and modules together. |
| `public/js/data.js` | shared (base) | SSE client. Calls `onState(state)` and `onEvent(ev)`. |
| `public/js/director.js` | shared (base) | Broadcast playlist that picks the current segment and calls `showSegment` everywhere. |
| `public/js/util.js` | shared (base) | Formatting helpers and party colors. |
| `public/js/scene/*.js`, `public/css/scene.css` | 3D agent | `createScene(canvas)` |
| `public/js/overlay.js`, `public/css/overlay.css` | overlay agent | `createOverlay(rootEl)` |
| `public/js/chyron.js`, `public/js/alerts.js`, `public/css/chyron.css`, `public/css/alerts.css` | chyron agent | `createChyron(rootEl)`, `createAlerts(rootEl)` |

## Module interfaces (all ES modules, named exports)

```js
// scene/scene.js
export function createScene(canvas) → {
  update(state),            // called on every state push (~every few seconds). Must be cheap and idempotent.
  showSegment(seg),         // camera fly-to + build or show that segment's 3D content
  onEvent(ev),              // e.g. flash or pulse the scene on calls, new votes, lead changes
}
// overlay.js
export function createOverlay(root) → { update(state), showSegment(seg), onEvent(ev) }
// chyron.js
export function createChyron(root) → { update(state), onEvent(ev) }
// alerts.js
export function createAlerts(root) → { update(state), onEvent(ev) }   // queues takeovers for priority >= 3
```

DOM roots: `#stage` (canvas, full screen, z 0), `#overlay` (z 10), `#chyron` (z 20, bottom), `#alerts` (z 30, full screen, pointer-events none).

**Layout zones (v2, the user's request: the 3D must have its own clear window that the chrome frames, not covers):**

```
 0vh ┌──────────────────────── TOP BAR (overlay) 0–7vh ───────────────────────┐
 8vh │ LEFT COLUMN   │        3D STAGE WINDOW           │  WATCHLIST            │
     │ race card     │   26vw–71vw  x  8vh–79vh         │  72vw–99.2vw          │
     │ 0.8vw–25vw    │   (nothing opaque covers it)     │  8vh–79vh             │
79vh │               │                                  │                       │
80vh ├──────────────────────── CHYRON 80–100vh ───────────────────────────────┤
```

- **3D canvas:** it stays full-screen so the synthwave sky, grid and glow continue behind the translucent panels. The camera uses `camera.setViewOffset` so the projection center sits at the stage window's center (48.5vw, 43.5vh). Each segment's subject (state map, Pine Plains towers and beacon, Senate hemicycle) is framed to fill that window, recomputed on resize. Scene exports `STAGE_RECT = {x0:.26, x1:.71, y0:.08, y1:.79}` as viewport fractions.
- **Stage frame:** the overlay draws only thin neon corner brackets and edge ticks around the stage window, plus a small segment label in its top-left corner like "LIVE 3D // MICHIGAN COUNTIES". It must not fill the window.
- **Race card:** a vertical left-column layout. The title is on top. Candidates are stacked, each with a big rolling number and a share bar. Below them are the meters (expected vote in, model %, Kalshi), the trend sparkline and the updated-time. The Pine Plains hero version uses the full column height (8–79vh), with the countdown or awaiting state at the top.
- **Alerts and chyron:** unchanged. Alerts may still cover everything briefly.

## Segments (from director.js)

```js
seg = { id: 'pineplains'|'mi-sen'|'tx-sen'|'ia-gov'|'spotlight'|'balance', race, durationMs, index, startedAt }
```

- `race` is the normalized race object (see below). It is `null` for `'balance'`.
- `'spotlight'` is the auto-picked most important race right now (`state.spotlight[0]`). It can be any state's Senate or Governor race.
- Default playlist: `pineplains`(22s) → `mi-sen`(15s) → `tx-sen`(15s) → `pineplains`(22s) → `ia-gov`(15s) → `spotlight`(15s) → `balance`(12s). Repeats.
- Keys: 1–7 jump to a segment, Space pauses rotation.

## State object (SSE `state` event)

There's a real sample at `research/samples/state-snapshot.json`; read it.

```
state.now, state.startedAt
state.watch[]      // ordered: pineplains, mi-sen, tx-sen, ia-gov (normalized races)
state.spotlight[]  // top 3 auto-picked races (normalized, may include counties)
state.races[]      // all ~71 Senate+Gov races, state-level (no counties)
state.partyControl // { S: {...}, H: {...} } NYT party-control data: party_balance.DEM.seats, to_win, num_races_called, current_control, nyt_model_estimates[]
state.pollClosings[] // { poll_closing_time (ISO), poll_closing_time_display_et, reporting_unit.state_postal }
state.insights[]   // { text, race, kind, at } AP/NYT auto-written race insights (great for the chyron)
state.news[]       // { title, source, date(ms), tag ('mi-sen'|'tx-sen'|'ia-gov'|'pineplains'|'local'|null), fresh }
state.odds         // { 'SENATEMI-26': [{name, price(0-1)}], 'CONTROLS-2026': [...], 'CONTROLH-2026': [...], ... }
state.dutchessTicker[] // other Dutchess contests: { label, candidates[], totalVotes }
state.events[]     // newest first, same shape as the SSE `event` events
state.sources      // { dutchess:{lastPoll, asOf, publishDate, version, nextUpdateAt}, nyt:{lastPoll, resultsUpdatedAt}, kalshi, news }
state.history      // { [raceKey]: [{t, total, eevp, v:{candId:votes}}] } time series for trend lines
```

**Normalized race:**

```
{ key, kind:'nyt'|'dutchess', title, short, state, stateName, officeId,
  rating, callStatus ('too_early'|'called'|...|'waiting'|'counting'),
  candidates: [{ id, name, last, party ('DEM'|'GOP'|'LIB'|'GRN'|'OTH'|'WRI'), votes, pct, winProb (NYT model 0-1|null),
                 odds (Kalshi 0-1|undefined), winner, incumbent, img, methods }],   // sorted by votes desc
  totalVotes, eevp (% expected vote in, 0-100), expectedVote, precinctsReporting, precinctsTotal, updatedAt (ISO),
  counties?: [{ fips (5-digit), name, eevp, total, expected, votes:{candId:n} }],
  history2024?: { pct_dem, pct_rep, margin },
  // dutchess-only: friend, place, eds:[{name,status}], totalUnits, reportingUnits, pollClose (ISO), ballotsCast
}
```

- **Pine Plains** (`key: 'pineplains'`) is THE hero race. The user's friend **Trevor Roush (DEM)** is running against Brian Walsh (GOP). There is one election district (ED 1), and polls close at 9:00 PM ET (`pollClose`).
  - Before results: show a countdown to poll close, then an "AWAITING DUTCHESS BOE" state with the BOE feed's last check time (`sources.dutchess.lastPoll`) and `nextUpdateAt` if it isn't null.
  - The candidate order is by votes, so find Roush by `name.includes('Roush')`, not by array index.

**Event** (SSE `event` and `state.events`):

```
{ id, ts, type: 'first'|'lead'|'call'|'votes'|'boe'|'polls'|'insight'|'news', priority 1-4, text, sub, raceKey, party? }
```

- **Priority 4:** a watched race was called. Do a full takeover.
- **Priority 3:** first results or a lead change in a watched race, Pine Plains votes, or poll closings. Do a big takeover.
- **Priority 2:** other race calls, or a BOE publish. Use the chyron's BREAKING bar.
- **Priority 1:** ticker or headline rotation.

## Look and feel

The style is synthwave / cyberpunk broadcast: deep night-purple background, a neon grid floor, a striped setting sun, magenta and cyan glow, scanlines, chromatic aberration on alerts, glitch transitions, and monospace number displays with rolling digits.

- Party colors:
  - DEM: neon blue `--dem` (#2d8cff)
  - GOP: neon red `--gop` (#ff2e55)
  - Others: amber
  - Write-in: gray

It should feel like CNN or Bloomberg on election night with all the people removed: constantly moving, information-dense, never static. Every number that changes should animate. Use `util.js` helpers.

**Performance:** 60fps on a MacBook. Avoid layout thrash; for animation, use `requestAnimationFrame` and CSS transforms only.

## Testing

- Run `SIM=1 npm start` to get simulated, steadily-growing results for the watched races, plus fake events.
- `curl 'localhost:4173/api/test-event?type=call&priority=4&text=...&race=pineplains&party=DEM'` injects an alert.
- Browser errors are reported to `POST /api/clientlog`, and `main.js` already does this.

## Control odds + battleground (snapshot fields `control`, `battleground`)

Both are additive; all earlier snapshot fields are unchanged.

### `state.control`
```
control = { senate: Chamber, house: Chamber }
Chamber = {
  seats: { total, called, openSeats, toWin, DEM, GOP, OTH, flips:{DEM,GOP}, current:{DEM,GOP,OTH}, winner:'DEM'|'GOP'|null, isReporting },
         // DEM/GOP = seats secured so far (NYT party_balance); current = seats held entering the election
  model: { winProb:{DEM,GOP}, expectedSeats:{DEM,GOP}, seatRange:{DEM:[lo,hi],GOP:[lo,hi]}, noControl } | null,   // NYT forecast
  odds:  { DEM, GOP,                       // average of the sources below, 0-1, DEM+GOP = 1
           kalshi: {DEM,GOP}|null, polymarket: {DEM,GOP}|null },
  races?: { total, called, competitiveUncalled, tossupsUncalled }   // house only
}
```
Any value can be `null` before a source has answered. Kalshi polls every 20s, Polymarket every 30s.

### `state.battleground`
Ranked array (highest `score` first, about 14 items) of the races that matter most for control right now: uncalled
Senate / House / (max 3) Governor races mixing rating, betting odds, NYT model, and live margin, plus freshly called
races (about 6 min) with flips ranked highest. Recomputed whenever results or odds change.
```
{ key: 'S-ME' | 'H-PA-07' | 'G-AZ',  nytId, office: 'S'|'H'|'G', title: 'PA-07 HOUSE' | 'MAINE SENATE',
  state: 'PA', rating, ratingLabel: 'Toss-up'|'Leans Dem'|..., 
  candidates: [ { id, name, last, party, incumbent, img, votes, pct, winProb, winner,
                  odds,                       // 0-1 chance to win: avg of sources
                  oddsBy: { kalshi, polymarket } } ],   // top two by votes
  eevp, totalVotes, callStatus, winner (candidate id|null), winnerParty, gained (flip), calledAt (ms|null),
  odds: { DEM, GOP, kalshi:{DEM,GOP}|null, polymarket:{DEM,GOP}|null },   // race-level, party based
  why: 'Toss-up · 41% in · Taylor leads by 0.8 pts · bettors favor Taylor 63%'  |  'FLIP: Democrats pick up seat',
  score }
```
A new `flip` event (priority 3, e.g. `DEMOCRATS FLIP PA-07`) is pushed when a House seat is called as a party pickup.

## Sizing rules (must hold at ANY window aspect ratio: 16:9, 16:10, ultrawide or short browser windows)

The incident on election night: everything is sized in vw/vh. On a wide-short window (about 2000×810), vw-sized text and padding stayed large while vh-sized column heights shrank. Panels in the right column overflowed and drew over each other, with Control of Congress covering the IA/TX tiles, and the left card hid its candidates.

1. **Stacked panels in a fixed-height column must not flex-shrink.** Give children `flex: 0 0 auto` so they keep their natural height. Squeezing makes contents overflow into the next panel.
2. **Every fixed-height stacked container must be registered in `public/js/fit.js` `TARGETS`.** fit.js measures the natural height every second and on resize, and uniformly `zoom`s the children down until they fit. Current targets: `.ov-right`, `.bg-board`.
3. **Inside a single card (the left race card), only the low-priority bottom block may shrink or clip.** Primary content (title, candidates, numbers) is `flex: 0 0 auto` and never clipped. The meters, trend and updated block use `flex: 1 1 0; min-height: 0; overflow: hidden`.
4. **Never put a panel over the 3D stage window** (26–71vw × 8–79vh). Alerts are the only exception, and they are temporary.
5. **Test at least 1920×1080, 1512×945 and 2000×810** before shipping a layout change.
6. **Minimum text size is .7vw.** The user said the current small text is "probably the smallest you should use." Use high-contrast colors (white, yellow, party colors), never low-contrast gray. Prefer graphics (bars, splits, donuts) over more text. When content doesn't fit, give the hometown data more screen area, for example the wide hometown layout. Don't shrink the text.
7. **No truncation, ever.** No `text-overflow: ellipsis`, no cut-off names, titles or labels. The user explicitly rejected "TREV…" and "PINE PLAINS TOW…". Design around long text instead: wrap to two lines, use abbreviations defined in code (e.g. "PINE PLAINS SUPV"), or give the element more width. Verify with a check that no text element has scrollWidth > clientWidth.
8. **Never reallocate render targets outside a real window resize.** Calling `renderer.setSize` or `post.setSize` (EffectComposer, bloom) blanks the glow chain for a frame and reads as a flash. Segment and stage-window changes must use `reframe()` in scene.js, which updates only the camera. `resize()` is a no-op unless the size or pixel ratio changed. Keep screen-wide `post.flash` and `post.glitch` for real moments only (calls, first results, flips), never for routine events.
9. **Alerts must never flood.** Full-screen takeovers come only from live SSE `event` messages, never from `state.events` history (page load and reconnects). Dedupe by content, not id, because ids reset on server restarts and on new Vercel instances. Suppress the same story within 15 minutes, for example several networks each projecting the House. Keep at most 3 takeovers queued. The server announces a chamber's network projection only for the FIRST network; later networks only update the panel badge.
