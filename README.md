# osu! Skill Lab — Rhythm Intelligence v2.19

Unofficial osu!standard beatmap metadata catalogue + local beatmap/replay analysis.
**GitHub Pages:** https://epicenterguy.github.io/osu-skill-lab/

## Project milestones / 이정표

- **M1 · Public Ranked Catalogue — DONE**  
  Public osu!standard Ranked/Approved metadata catalogue, fast summary-first loading, monthly lazy search shards, mobile/PWA UI, profile-local storage, and automated GitHub Pages deployment.
- **M2 · Chart DNA Coverage — IN PROGRESS**  
  Real `.osu`-based Aim / Stream / Speed / Stamina / Tech / Reading / Flow heuristics are being backfilled separately from metadata. DNA is published as a lazy overlay so search stays fast while coverage grows.
- **M3 · Mirror-class Explorer & Observatory — IN PROGRESS**  
  Advanced filters, multi-map comparison, random discovery, era comparison, mapper fingerprints, oddities, similarity neighborhoods, Difficulty Twins, and richer statistics.
- **M4 · OSL Client — BUILDING**  
  Phase 1–3 are now live in the local Python client bridge. The Client tab can auto-detect or configure a Songs folder, maintain an incremental SQLite metadata/MD5 index, search the local library, analyze indexed .osu maps without a file picker, maintain a local **Replay Inbox** for .osr files, and run a bounded **Background Chart DNA** queue. Background DNA stores only compact derived summaries in the local SQLite DB, invalidates stale entries when MD5/mtime no longer match, and never uploads local charts. Replay Inbox entries are matched back to the active Songs library by MD5 and can feed Replay Signals / PC Timeline Alignment with one click. The optional tab-open watch only rescans the configured .osr folder while the Client tab is open; it does not claim to capture every osu! play.
- **M5 · Personal Rhythm Intelligence — EARLY PREVIEW**  
  Practice Route Builder, the browser-local Training Journal, period-comparison Training Insights, Replay Failure Signals, same-map Replay Trends/Profile, PC Timeline Alignment, repeated-region consensus, local Region Fingerprints, and a cross-map Failure Structure Profile now connect user-controlled Chart-DNA practice exposure with imported replay outcomes while explicitly avoiding pass/skill claims. Exact miss-location reconstruction, stronger replay/map alignment, confidence models, and long-term performance modeling remain future work.

> OSL Client is now an active local bridge, but it is still **not** a packaged installer or direct osu! process integration. The current implementation runs through `server.py` / `실행.bat` and reads only explicitly configured local folders.

## v1.1 fast load and browser-local profiles
- The repository contains a pre-seeded `data/ranked-summary.json` (about 25 KB at initial 5,058 difficulties), so first paint never depends on downloading every Ranked map.
- The summary lists compact month-index files under `data/ranked-search/YYYY-MM.json`. RANKED initially shows 30 recent maps, and fetching a month/year/all-years requires explicitly selecting that scope. Unchanged monthly files have stable content hashes so returning visitors can use HTTP cache.
- `profile.js` offers a local-only osu! username/ID shortcut and a dedicated profile panel. Merely saving a username is **not** osu! authentication.
- The profile nickname/ID stays **only in the current browser's localStorage**. It is not committed, uploaded, or sent to the GitHub Actions workflow. Other visitors cannot see it through the shared site.
- No public osu! user profile snapshot is generated. The former `sync_profile.py` action and profile publishing code have been removed.
- On a shared device, other people who use the same browser profile may see locally stored nicknames. The profile page includes an "이 브라우저에서 삭제" button to erase the saved shortcut.
- With no Worker configured, the profile is a local-only shortcut plus optional manual JSON stats import. A user-deployed secret-backed Worker can fetch public osu! stats on demand without putting the data into the public site or repository.
- Rapid GitHub UI commits now cancel older push-only deployment attempts, rather than queue dozens of redundant deploys. Hourly background sync runs remain separate.

## Web and mobile
- Desktop uses a left sidebar, mobile uses a fixed bottom dock. Official Ranked data, per-device .osu analysis and local replay header results are explicitly separated.
- HOME includes a recent Ranked feed, the public index counts, and personal chart-analysis shortcuts.
- Browser-only `.osr` support reads basic replay headers (score, judgments, combo, player, accuracy); LZMA input-frame parsing still requires the PC server.
- Browser `.osu` strain timeline now uses a sliding window rather than scanning every object for every second.
- HOME loads only the tiny precomputed `data/ranked-summary.json`: collected song/difficulty counts, official SR/BPM averages, collection date range, and backfill state.
- STATS shows year, month, SR, BPM, mapper, star-rating, and playcount leaderboards, calculated by GitHub Actions rather than every visitor's phone.
- RANKED loads lightweight `data/ranked-search/YYYY-MM.json` when the tab opens. Recent 30 maps render by default, and a selected month/year/**All years** option lets the visitor search every indexed year (larger download).
- Search by artist, title, mapper, difficulty, and beatmap/beatmapset ID. Normal month/year scope stays lightweight; an explicit **전체 DB 검색** scans all monthly shards progressively without keeping all 144k+ rows in memory.
- Ranked Explorer supports advanced SR/BPM/AR/OD/length/status filters, four-map comparison, browser-local favorites/recent history, random discovery, and shareable deep links that reopen a map by ID/year.
- **Similarity Explorer** promotes “similar maps” into a dedicated workflow: choose any loaded/result map as a seed, then search by balanced metadata+DNA, metadata structure, Chart DNA pattern, same mapper, or same era. Current-scope results are instant; explicit global searches stream monthly shards progressively, while featured/DNA targets can use precomputed global neighborhoods first.
- **Chart Relation Graph** visualizes one seed map as a network of same-set, same-mapper, DNA-similar, metadata-similar, and same-era relationships. Nodes are clickable, inspectable, comparable, and can be expanded as a new graph focus.
- Whole-catalog search also works with a blank text query: choose only SR/BPM/AR/OD/length/status/DNA filters and the scanner keeps every matching map rather than requiring a keyword.
- **Search Workspace** saves up to 20 named filter/search presets locally, keeps recent whole-catalog searches, restores shared filter URLs, and exports the currently filtered result set as CSV or JSON.
- **Practice Route Builder** uses precomputed, diverse Chart DNA candidate pools by target skill and official SR band. It can auto-select the least-exposed local DNA dimension, creates 5/8/12-map sessions, persists completion locally, and is explicitly an exposure planner rather than a player-skill/pass-probability model.
- **Training Journal** stores finished sessions only in the current browser, records per-map completion timestamps plus optional session feel/notes, shows 7/14/28-day activity and DNA-exposure summaries, and supports JSON export/import. Its adaptive SR-band option moves at most one band from the most relevant prior session using explicit user feedback; it is not a skill estimate.
- **Training Insights** compares the latest 7/28/90-day window with the immediately preceding window of the same length. It summarizes completed-map count, activity days, recorded sessions, average official SR, Chart-DNA exposure composition, SR-band mix, target-skill mix and explicit session-feel mix. All deltas describe practice-record composition only, not performance improvement.
- **Replay Failure Signals** stores imported .osr outcome headers locally, links replays back to Ranked maps through a lazy two-hex MD5 checksum index, and summarizes accuracy, judgement mix, misses, and available Chart-DNA demand context. Browser-only replay parsing stays header-only; the local PC server can add key-input timing proxies, but neither path claims exact miss timestamps or failure locations.
- **Replay Trend Lab** groups repeated replays of the same beatmap, filters same-map trends by Mods, plots accuracy/miss/non-300/combo history, compares replay samples before/after the first recorded Practice Route completion only within the same Mods combination, and summarizes repeated outcome samples by the map's dominant base Chart-DNA axis. These are temporal/sample comparisons, not causal training-effect or weakness claims.
- **Replay Profile** summarizes the currently selected same-map/Mods replay window with descriptive sample standard deviation, observed ranges, per-Mod technical statistics, timestamp provenance, map-link state, and an A–D **data sufficiency** grade. That grade only reflects sample quantity/metadata quality and never claims skill, training effect, statistical significance, or causal confidence.
- **PC Timeline Alignment** is an experimental local-only bridge between a checksum-matching selected .osu and PC-decoded .osr keydown frames. It greedily aligns circle/slider-head timestamps to one keydown each, estimates a small global offset, summarizes timing/cursor residuals, and ranks 10-second anomaly-candidate windows. It does **not** recreate osu!'s judgement engine or identify exact miss locations; DT/NC/HT are intentionally excluded until clock-rate alignment is validated.
- **Repeat Region Consensus** compares multiple supported PC alignments of the same beatmap and exact Mods combination. It reports which fixed 10-second windows repeatedly reappear in each replay's top anomaly candidates, plus recurrence, longest consecutive appearance and averaged candidate signals. Absence from a replay means only “not in that replay's saved top candidate set”, never “confirmed clean” or “no miss”.
- **Region Fingerprint** stores a structural snapshot for each newly aligned 10-second window from the matching local .osu: tap-head density, gap mean/variation, spacing mean/variation, angle variation, fast-gap share, large-jump share, close-spacing share, slider share, local strain and overlapping stream/burst context. It assigns descriptive labels such as Stream/Burst, Jump, Tech/Rhythm, Slider-heavy, Dense/Reading, Flow or Mixed and lets Repeat Region results be filtered by those labels. These are local heuristics, not official difficulty types or player-skill diagnoses.
- **Failure Structure Profile** aggregates only 10-second windows that reappeared at least twice in the saved top anomaly candidates of the same checksum+Mods alignment group, then summarizes their structural fingerprint mix across maps. It reports candidate-window composition, average recurrence and alignment signals, but its denominator is not total play time or all map regions; it therefore never labels a structure as a personal weakness or failure probability.
- Sort by official SR, BPM, ranked date, play count, length, AR/OD, and available Chart DNA dimensions.
- Full monthly metadata shards are not loaded by the page on entry; only the selected month/year search index is fetched on demand. Mobile, PWA, and desktop work with no browser OAuth credentials.
- The optional **STATS → Ranked 색인 가져오기** button is only for importing additional local datasets.
- Each map's official SR/BPM/AR/OD/CS/HP is obtained from osu! API v2. Custom skill heuristics are NOT official ratings.

## Private-browser osu! profile auto-refresh (opt-in)

**Important:** The Cloudflare Worker code is provided in [worker/osu-profile-worker.mjs](worker/osu-profile-worker.mjs), but it is **not deployed automatically**. The GitHub Pages site cannot read osu! API data without a secret-backed service, and the browser cannot safely hold the osu! OAuth Client Secret.

Deployment setup:
1. Create a Cloudflare Worker and paste/upload the module source from `worker/osu-profile-worker.mjs`. Publish it at your own HTTPS workers.dev or custom domain.
2. In the Worker settings, add **encrypted secrets** `OSU_CLIENT_ID` and `OSU_CLIENT_SECRET` from an osu! OAuth application. **Never** put these values in public GitHub files, GitHub Pages HTML/JS, or the profile input.
3. Set the Worker variable `SITE_ORIGIN` to `https://epicenterguy.github.io` (no trailing slash). The Worker only permits browser requests with this Origin header.
4. Open Skill Lab → My osu! Profile, save your username in the browser, then paste the HTTPS Worker **base URL** into the Worker field and click Connect/Refresh. Only the endpoint URL and allowlisted profile stats are saved in the current browser's localStorage.
5. The browser refreshes on profile visit / tab return if the local snapshot is over six hours old. Manual Refresh forces a request. There is no timer continuously polling in the background. Existing JSON import remains available.

**Privacy limitations:** This approach does not publish a username or statistics to the GitHub repository or a public database. A profile lookup necessarily transmits the requested username to the Worker and osu!; the Worker returns public osu! statistics to the requesting browser. The Worker source does not persist profile requests or responses, but Cloudflare and osu! may maintain their own infrastructure/access logs. The Worker endpoint is publicly reachable and is **not** a private account authentication system; never send sensitive/private user data through it. An Origin check reduces casual browser cross-site access but is not proof of user identity or protection against non-browser callers. For production use, configure Cloudflare rate limiting/abuse protection and review provider logging settings.

## Fast full-history Ranked backfill
**Automatic workflow:** [Fast osu! Ranked history backfill](.github/workflows/fast-ranked-backfill.yml)
- Starts automatically from the workflow-file push and can also be started manually in Actions → Fast osu! Ranked history backfill → Run workflow.
- Runs batches of 150 cursor-paginated official osu! API search pages. Pages typically contain 50 beatmapsets. Requests are sequential with at least 1 second between page requests, with Retry-After/backoff on HTTP 429/5xx.
- Checkpoints the history cursor every 50 API pages inside each batch. Each complete batch commits its new Ranked month shards, public search views and state back to main, so restarts do not require starting from scratch.
- Runs for up to ~3h35m per attempt, automatically resuming every three hours while the search cursor remains unfinished. GitHub's schedule can be delayed; no exact completion time is guaranteed.
- The hourly sync and fast backfill share a data-writer lock, and the backfill also checks the newest Ranked search page. At the end of a run with changes, the GitHub Pages site is rebuilt and deployed.
- Scope: osu!standard Ranked/Approved metadata. This does NOT download all original .osu charts or replay files; Chart DNA is separate. An exhausted API cursor is not a guarantee that every deleted or unavailable historical item was recovered.
- Progress appears in [data/ranked-manifest.json](data/ranked-manifest.json), with indexed counts and backfill_complete.

## Automated background collection (GitHub Actions)
Workflow: `.github/workflows/sync-ranked.yml`.

1. Visit **Settings → Secrets and variables → Actions → New repository secret**.
2. Create two *repository secrets*, exactly named:
   - `OSU_CLIENT_ID`
   - `OSU_CLIENT_SECRET`
   Use your already issued osu! OAuth application's values. **Never** share the secret in chat, source, README, commit history, or browser.
3. Visit **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**. This is required: pushes made by GitHub's Actions token do **not** trigger branch-source Pages rebuilds.
4. Visit **Settings → Actions → General → Workflow permissions** and enable **Read and write permissions** if offered (the workflow also requests its required permissions explicitly).
5. Visit **Actions → Sync osu Ranked catalogue + publish Pages → Run workflow** and select `main` to run it once.
6. Subsequent syncs are scheduled hourly (GitHub may delay or suspend scheduled runs). The same workflow deploys the refreshed site; code pushes also deploy it.

Every run:
- The dedicated Chart DNA backfill remains capped at **one request start per second**. Its hourly work budget is adaptive: blocked/low-success runs cool down, while a healthy previous batch can target up to 2,200 charts and use at most 40 minutes of the 50-minute job.
- Charts that cannot satisfy the current DNA method because they contain too few playable tap/slider-head objects are recorded as method-unsupported and skipped on future runs instead of being re-requested forever. The summary distinguishes analyzed coverage from resolved progress.
- The normal metadata sync still tries only a small recent actual-`.osu` pilot batch. All published DNA is derived numeric data; raw chart files are never committed, and custom scores are NOT official SR or pp.
- Scans the newest ranked-search page independently for new maps.
- Advances up to 200 historical pages per scheduled run using `data/ranked-state.json` cursor (resuming earlier work).
- Deduplicates by beatmap ID and groups by ranking month in `data/ranked/YYYY-MM.json`.
- Publishes the shard manifest `data/ranked-manifest.json` and runs `build_ranked_views.py` to generate a tiny stats JSON + month-split compact search indexes.
- The static website reads only the stats JSON on first load; opening RANKED renders the recent 30 immediately and only fetches more when a month/year is selected.
- The same GitHub Actions workflow explicitly uploads and deploys the site after a successful sync; there is no dependency on branch-source auto-builds.

### Catalogue files
- `data/ranked-manifest.json` — public shard index, update time, counts, history pagination status.
- `data/ranked/*.json` — full official metadata by month, no client secret.
- `data/ranked-summary.json` — precomputed small public statistics and descriptors for lazy derived datasets.
- `data/ranked-search/*.json` — compact month-specific metadata search indexes, downloaded on demand.
- `data/training-pools.json` — on-demand, diverse Chart-DNA practice candidates grouped by skill and official SR band; not a player-skill model.
- `data/checksum-index/*.json` — 256 tiny MD5-prefix shards used only when an imported replay needs to resolve its beatmap checksum back to the collected Ranked catalogue.
- `build_ranked_views.py` — stats/index generator requiring no API secrets, run by sync and Pages deployments.
- `build_chart_dna.py` — optional small, rate-limited pilot analysis of real `.osu` object geometry, retaining only derived metrics.
- `data/chart-dna/*.json` — experimental derived scores (not original `.osu` charts).
- `app-shell.css` — adaptive desktop/sidebar and mobile/dock UI.
- `mobile-replay.js` — browser-only `.osr` header reader.
- `ranked-catalog.js` — browser-side summary and lazy search UI.
- `data/ranked-state.json` — historical pagination cursor (non-secret).
- `data/ranked-index.json` — original 832-difficulty seed and browser fallback.
- `sync_catalog.py` — scheduled catalogue builder.
- `collect_ranked.py` — legacy single-file local collector.

Optional manual local catalogue update (Python 3.10+, env variables required):
```powershell
python sync_catalog.py --pages 200 --fresh-pages 1
python build_ranked_views.py
```
This updates only local files unless you explicitly commit/push them.

## Local PC chart analysis / OSL Client Bridge
Run `실행.bat` (Python 3.10+), or start `server.py`. The **OSL Client** tab is the first desktop-client phase.
- It checks common osu! stable `Songs` locations and allows a manual Songs path when osu! is installed elsewhere.
- **Library Scan** builds `~/.osu-skill-lab/client.db` with local-only SQLite metadata + MD5. Unchanged files are reused by mtime/size instead of being reparsed.
- **Local Library Search** searches artist/title/mapper/difficulty/Beatmap ID, then **분석 열기** reads only that indexed .osu and sends the result into the existing Chart X-Ray/Skill DNA browser state.
- **Replay Inbox** auto-detects the sibling `Replays` folder when present (or accepts another explicit folder), incrementally indexes actual `.osr` files, and joins each replay to the active Songs index by beatmap MD5.
- **Replay 분석** decodes the selected local .osr, loads the matching local .osu when available, and sends both into Replay Signals / PC Timeline Alignment without a manual file picker.
- **Background Chart DNA** processes a user-selected bounded batch (up to 5,000 maps per run) in a background thread and caches compact Aim/Stream/Speed/Stamina/Tech/Reading/Flow summaries in `~/.osu-skill-lab/client.db`. It checks the indexed MD5 + mtime before reusing a cache entry and can be stopped from the Client tab.
- The optional **tab-open watch** asks the local server to rescan about every 12 seconds only while the Client tab is open. It watches stored/exported `.osr` files; it is not an always-on process watcher and does not guarantee capture of every play.
- The server binds only to `127.0.0.1`; configured file analysis verifies the indexed file still lives under the configured Songs root.
- GitHub Pages/PWA displays the Client tab but does not attempt to access the local file system.

Existing local analysis also supports:
- Chart X-Ray, time-based strain, aim/stream/speed/stamina/flow/tech/reading heuristics
- `.osr` replay analysis when using the local Python server, including experimental checksum-matched tap-head/key-down timeline alignment for NM/non-rate-changing Mods
- JSON export/import of local browser analysis; PC and phone data don't otherwise sync automatically
- Mobile PWA can analyze local `.osu` files without the Python backend.
- The local PC server serves the same Ranked/Training frontend assets and local `data/*.json` files, so Replay Signals/Trends/Profile/Timeline Alignment work from `실행.bat` instead of silently losing those frontend modules.

## Scope and limits
The **catalogue currently targets osu!standard Ranked/Approved**. It does not yet index Loved, Qualified, Pending, Graveyard, or all four game modes. It began from an initial 832 difficulties and keeps growing; a pagination cursor reaching the end does not guarantee every historical beatmap or every change was captured. The published count and rankings only describe maps actually collected. No worldwide ranking, percentile, or completion claim is made.

The public catalogue contains **metadata only**. Downloading original `.osu` note/timing files and calculating full Chart DNA for all entries requires a separate pipeline, subject to source availability, bandwidth, copyright, and osu! API/rate-limit rules. Entire replay datasets are not collected.

GitHub Pages cannot safely hold osu! OAuth client secrets and cannot run Python API calls by itself. The scheduled private GitHub Actions job handles authentication; public pages load only generated JSON.

## v1.0 validation notes
The public chart pipeline depends on official map-file endpoint availability. Individual map downloads may fail because of missing files, permission, server policy, or checksum changes. Failures never produce fabricated Chart DNA and do not prevent official metadata display. An `analyzed_difficulties` count of zero is valid. API policy: https://osu.ppy.sh/docs/.
