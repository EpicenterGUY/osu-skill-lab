# osu! Skill Lab — Ranked Catalog v0.9

Unofficial osu!standard beatmap metadata catalogue + local beatmap/replay analysis.
**GitHub Pages:** https://epicenterguy.github.io/osu-skill-lab/

## Web and mobile
- HOME loads only the tiny precomputed `data/ranked-summary.json`: collected song/difficulty counts, official SR/BPM averages, collection date range, and backfill state.
- STATS shows year, month, SR, BPM, mapper, star-rating, and playcount leaderboards, calculated by GitHub Actions rather than every visitor's phone.
- RANKED loads lightweight `data/ranked-search/YYYY.json` when the tab opens. The newest available year loads by default, and the **All years** selection lets the visitor search every indexed year (larger download).
- Search by artist, title, mapper, difficulty, and beatmap ID. Sort by official SR, BPM, ranked date, and play count.
- Full monthly metadata shards are not loaded by the page on entry; only the selected year search index is fetched on demand. Mobile, PWA, and desktop work with no browser OAuth credentials.
- The optional **STATS → Ranked 색인 가져오기** button is only for importing additional local datasets.
- Each map's official SR/BPM/AR/OD/CS/HP is obtained from osu! API v2. Custom skill heuristics are NOT official ratings.

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
- Scans the newest ranked-search page independently for new maps.
- Advances up to 200 historical pages per scheduled run using `data/ranked-state.json` cursor (resuming earlier work).
- Deduplicates by beatmap ID and groups by ranking month in `data/ranked/YYYY-MM.json`.
- Publishes the shard manifest `data/ranked-manifest.json` and runs `build_ranked_views.py` to generate a tiny stats JSON + year-split compact search indexes.
- The static website reads only the stats JSON on first load; opening RANKED lazily fetches the chosen year.
- The same GitHub Actions workflow explicitly uploads and deploys the site after a successful sync; there is no dependency on branch-source auto-builds.

### Catalogue files
- `data/ranked-manifest.json` — public shard index, update time, counts, history pagination status.
- `data/ranked/*.json` — full official metadata by month, no client secret.
- `data/ranked-summary.json` — precomputed small public statistics.
- `data/ranked-search/*.json` — compact year-specific search indexes, downloaded on demand.
- `build_ranked_views.py` — stats/index generator requiring no API secrets, run by sync and Pages deployments.
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
