# osu! Skill Lab — Rhythm Intelligence v1.1

Unofficial osu!standard beatmap metadata catalogue + local beatmap/replay analysis.
**GitHub Pages:** https://epicenterguy.github.io/osu-skill-lab/

## v1.1 fast load and browser-local profiles
- The repository contains a pre-seeded `data/ranked-summary.json` (about 25 KB at initial 5,058 difficulties), so first paint never depends on downloading every Ranked map.
- The summary lists compact month-index files under `data/ranked-search/YYYY-MM.json`. RANKED initially shows 30 recent maps, and fetching a month/year/all-years requires explicitly selecting that scope. Unchanged monthly files have stable content hashes so returning visitors can use HTTP cache.
- `profile.js` offers a local-only osu! username/ID shortcut and a dedicated profile panel. Merely saving a username is **not** osu! authentication.
- The profile nickname/ID stays **only in the current browser's localStorage**. It is not committed, uploaded, or sent to the GitHub Actions workflow. Other visitors cannot see it through the shared site.
- No public osu! user profile snapshot is generated. The former `sync_profile.py` action and profile publishing code have been removed.
- On a shared device, other people who use the same browser profile may see locally stored nicknames. The profile page includes an "이 브라우저에서 삭제" button to erase the saved shortcut.
- Because the site is static and has no user-specific OAuth session, it does not show live PP/rank statistics for a personal private-browser profile. It provides an explicit official osu! profile link instead; that link is opened only when clicked.
- Rapid GitHub UI commits now cancel older push-only deployment attempts, rather than queue dozens of redundant deploys. Hourly background sync runs remain separate.

## Web and mobile
- Desktop uses a left sidebar, mobile uses a fixed bottom dock. Official Ranked data, per-device .osu analysis and local replay header results are explicitly separated.
- HOME includes a recent Ranked feed, the public index counts, and personal chart-analysis shortcuts.
- Browser-only `.osr` support reads basic replay headers (score, judgments, combo, player, accuracy); LZMA input-frame parsing still requires the PC server.
- Browser `.osu` strain timeline now uses a sliding window rather than scanning every object for every second.
- HOME loads only the tiny precomputed `data/ranked-summary.json`: collected song/difficulty counts, official SR/BPM averages, collection date range, and backfill state.
- STATS shows year, month, SR, BPM, mapper, star-rating, and playcount leaderboards, calculated by GitHub Actions rather than every visitor's phone.
- RANKED loads lightweight `data/ranked-search/YYYY-MM.json` when the tab opens. Recent 30 maps render by default, and a selected month/year/**All years** option lets the visitor search every indexed year (larger download).
- Search by artist, title, mapper, difficulty, and beatmap ID. Sort by official SR, BPM, ranked date, and play count.
- Full monthly metadata shards are not loaded by the page on entry; only the selected month/year search index is fetched on demand. Mobile, PWA, and desktop work with no browser OAuth credentials.
- The optional **STATS → Ranked 색인 가져오기** button is only for importing additional local datasets.
- Each map's official SR/BPM/AR/OD/CS/HP is obtained from osu! API v2. Custom skill heuristics are NOT official ratings.

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
- Tries up to 10 recent actual `.osu` charts through the public osu! map-file endpoint, spaced at least 5 seconds apart. Stops on 403/429/503 and tolerates temporary unavailability. This is **experimental partial Chart DNA coverage**; no chart files are redistributed, and the resulting custom scores are NOT official SR or pp.
- Scans the newest ranked-search page independently for new maps.
- Advances up to 200 historical pages per scheduled run using `data/ranked-state.json` cursor (resuming earlier work).
- Deduplicates by beatmap ID and groups by ranking month in `data/ranked/YYYY-MM.json`.
- Publishes the shard manifest `data/ranked-manifest.json` and runs `build_ranked_views.py` to generate a tiny stats JSON + month-split compact search indexes.
- The static website reads only the stats JSON on first load; opening RANKED renders the recent 30 immediately and only fetches more when a month/year is selected.
- The same GitHub Actions workflow explicitly uploads and deploys the site after a successful sync; there is no dependency on branch-source auto-builds.

### Catalogue files
- `data/ranked-manifest.json` — public shard index, update time, counts, history pagination status.
- `data/ranked/*.json` — full official metadata by month, no client secret.
- `data/ranked-summary.json` — precomputed small public statistics.
- `data/ranked-search/*.json` — compact month-specific search indexes, downloaded on demand.
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

## Local PC chart analysis
Run `실행.bat` (Python 3.10+), or start `server.py`, then load `.osu` maps.
- Chart X-Ray, time-based strain, aim/stream/speed/stamina/flow/tech/reading heuristics
- `.osr` replay basic analysis when using the local Python server
- JSON export/import of local browser analysis; PC and phone data don't otherwise sync automatically
- Mobile PWA can analyze local `.osu` files without the Python backend.

## Scope and limits
The **catalogue currently targets osu!standard Ranked/Approved**. It does not yet index Loved, Qualified, Pending, Graveyard, or all four game modes. It began from an initial 832 difficulties and keeps growing; a pagination cursor reaching the end does not guarantee every historical beatmap or every change was captured. The published count and rankings only describe maps actually collected. No worldwide ranking, percentile, or completion claim is made.

The public catalogue contains **metadata only**. Downloading original `.osu` note/timing files and calculating full Chart DNA for all entries requires a separate pipeline, subject to source availability, bandwidth, copyright, and osu! API/rate-limit rules. Entire replay datasets are not collected.

GitHub Pages cannot safely hold osu! OAuth client secrets and cannot run Python API calls by itself. The scheduled private GitHub Actions job handles authentication; public pages load only generated JSON.

## v1.0 validation notes
The public chart pipeline depends on official map-file endpoint availability. Individual map downloads may fail because of missing files, permission, server policy, or checksum changes. Failures never produce fabricated Chart DNA and do not prevent official metadata display. An `analyzed_difficulties` count of zero is valid. API policy: https://osu.ppy.sh/docs/.
