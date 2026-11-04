# State election-night feeds, 2026 general (probed ~10:50 PM ET, Nov 3 2026)

STATUS: INCOMPLETE. Almost every official portal returned 403/429/connection-refused to
plain curl and WebFetch from this machine (Cloudflare / CloudFront / Akamai bot protection).
A request to spoof a browser User-Agent was blocked by the permission classifier, so I did
NOT work around it. Nothing below marked "UNVERIFIED" was confirmed live. No race IDs were
obtained for any state.

## Probe results (plain curl -sI, no UA spoofing)

| State | URL | Result |
|---|---|---|
| TX | https://results.texas-election.com/ | 403 Cloudflare (curl and WebFetch) |
| TX | .../static/data/elections.json | 403 Cloudflare |
| MI | https://mielections.us/election/results/ | curl: no response; WebFetch: ECONNREFUSED 75.75.203.153:443 |
| MI | https://mielections.us/ , /election/results/DATA/ | no response |
| IA | https://electionresults.iowa.gov/ | 301 -> /IA/ ; CloudFront. First HEAD -L returned 200 on /IA/ with `Access-Control-Allow-Origin: *`, `Cache-Control: max-age=86400` (list page only), Last-Modified 2026-10-15. Later GETs/HEADs: 403 (CloudFront bot block). WebFetch of /IA/ rendered only "List Elections" (confirms Clarity ENR shell, JS-driven) |
| ME | https://www.maine.gov/sos/cec/elec/results/index.html | 403 CloudFront |
| OH | https://www.ohiosos.gov/elections/election-results-and-data/ | 403 Cloudflare |
| OH | https://liveresults.ohiosos.gov/ | 429 Cloudflare (rate limited) |
| AK | https://www.elections.alaska.gov/results/ | 403 Apache |
| AK | https://results.elections.alaska.gov/ | no response; WebFetch TLS cert error |
| AK | https://www.elections.alaska.gov/enr26/ | 301, cache-control max-age=3600 |
| AK | /enr26/results/HD2.pdf | 404 now (search index showed it for the Aug 2026 primary) |

## Per-state notes

### Iowa (Clarity ENR, confirmed platform)
- Base: https://electionresults.iowa.gov/IA/ (Scytl/Clarity "List Elections" page).
- Standard Clarity JSON layout (UNVERIFIED for 2026, well-known pattern):
  - `/IA/{electionId}/current_ver.txt` -> latest version number (plain text)
  - `/IA/{electionId}/{ver}/json/en/summary.json` -> all contests, statewide totals
  - `/IA/{electionId}/{ver}/json/en/electionsettings.json`
  - `/IA/{electionId}/{ver}/Summary.zip` / `detailxml.zip` -> county + precinct XML/CSV
- Need electionId: read it from the list page JS (or its XHR), then poll current_ver.txt.
- CORS: `*` observed on the HTML; static JSON on CloudFront normally has no auth. Poll
  current_ver.txt (tiny) then fetch the versioned file; versioned files are immutable and cacheable.
- Extras vs AP/NYT: county and precinct (in detail zip), vote-type split (election day/absentee) in detail,
  precincts reporting counts, registered voters/turnout.
- Risk: CloudFront returns 403 to bot-looking clients; test from your server/app with a normal client.

### Texas
- results.texas-election.com is the SOS Election Night Returns portal (counties report, refresh ~5 min).
  403 from Cloudflare. Path `/static/data/...` is my guess, UNVERIFIED.
- Documented machine feed: SOS XML Newsfeed over SFTP, paid media subscription (~$250 in 2022). Not usable ad hoc.
- Tarrant County 2026 page links to "Statewide Election Night Results".

### Michigan
- mielections.us/election/results/ - unreachable (ECONNREFUSED). Historically posts downloadable
  tab-delimited result files plus county-level ENR; precinct data comes later. UNVERIFIED for 2026.
- Races known: US Senate (open, Peters seat), Governor, SoS, AG, 2 Supreme Court, 13 US House.

### Maine / Ohio / Alaska
- Maine: 403. Historically town-level results spreadsheets from the SoS; UNVERIFIED.
- Ohio: liveresults.ohiosos.gov (429). Historically offers CSV downloads of county-level results; UNVERIFIED.
- Alaska: 2026 primary used elections.alaska.gov/enr26/results/*.pdf (PDF per district, no CSV found);
  general results path unknown. Note ranked-choice general: first-round counts on election night,
  RCV tabulation later. PDF-only means low integration value.

## Example commands (to run from a machine where the portals do not block you)
```
curl -s https://electionresults.iowa.gov/IA/ | grep -oE '/IA/[0-9]+' | sort -u   # find electionId
curl -s https://electionresults.iowa.gov/IA/$ID/current_ver.txt
curl -s https://electionresults.iowa.gov/IA/$ID/$VER/json/en/summary.json | jq '.[0]'
curl -sI https://electionresults.iowa.gov/IA/$ID/current_ver.txt   # check cache-control
```

## Ranking for tonight
1. Iowa: only confirmed JSON-backed platform (Clarity), static files, CORS open. Worth trying first,
   if you can fetch it from a normal client. Get electionId from browser devtools (Network tab).
2. Michigan: likely downloadable files, but unreachable here; needs a browser check.
3. Ohio: CSV downloads likely, but rate-limited; low confidence.
4. Texas: no free machine-readable feed; skip.
5. Maine, Alaska: skip tonight (blocked / PDF only).
Recommendation: use a real browser (Chrome tools, devtools Network tab) to find the actual XHR URLs;
curl from here cannot reach them.
