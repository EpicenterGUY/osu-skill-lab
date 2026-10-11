# osu! Skill Lab — Ranked Catalog v0.8

Unofficial osu!standard beatmap metadata catalogue + local beatmap/replay analysis.
**GitHub Pages:** https://epicenterguy.github.io/osu-skill-lab/

## Web and mobile
- On opening the public site, RANKED automatically loads `data/ranked-manifest.json` and the monthly JSON shards listed in it.
- Search by artist, title, mapper, difficulty, and beatmap ID. Sort by official SR, BPM, rank date, and play count.
- Data is streamed in batches with progress. No need to upload a JSON file or provide credentials on the phone.
- Until the catalogue manifest is available, the app uses the seeded `data/ranked-index.json` (832 verified difficulties).
- The optional **STATS → Ranked 색인 가져오기** button is only for importing additional local datasets.
- Each map's official SR/BPM/AR/OD/CS/HP is obtained from osu! API v2. Custom skill heuristics are NOT official ratings.

## Automated background collection (GitHub Actions)
Workflow: `.github/workflows/sync-ranked.yml`.

1. Visit **Settings → Secrets and variables → Actions → New repository secret**.
2. Create two *repository secrets*, exactly named:
   - `OSU_CLIENT_ID`
   - `OSU_CLIENT_SECRET`
   Use your already issued osu! OAuth application's values. **Never** share the secret in chat, source, README, commit history, or browser.
3. Visit **Settings → Actions → General → Workflow permissions** and enable **Read and write permissions**.
4. Visit **Actions → Sync osu Ranked catalogue → Run workflow** and select `main` to run it once.
5. Subsequent runs are scheduled every six hours (GitHub may delay or suspend scheduled runs).

Every run:
- Scans the newest two ranked-search pages independently for new maps.
- Advances up to 20 historical pages using `data/ranked-state.json` cursor (resuming earlier work).
- Deduplicates by beatmap ID and groups by ranking month in `data/ranked/YYYY-MM.json`.
- Publishes the shard manifest `data/ranked-manifest.json`; the static website reads it on the next visit.
- GitHub Pages rebuild may take a few minutes after an Actions commit.

### Catalogue files
- `data/ranked-manifest.json` — public shard index, update time, counts, history pagination status.
- `data/ranked/*.json` — individual months, no client secret.
- `data/ranked-state.json` — historical pagination cursor (non-secret).
- `data/ranked-index.json` — original 832-difficulty seed and browser fallback.
- `sync_catalog.py` — scheduled catalogue builder.
- `collect_ranked.py` — legacy single-file local collector.

Optional manual local catalogue update (Python 3.10+, env variables required):
```powershell
python sync_catalog.py --pages 20 --fresh-pages 2
```
This updates only local files unless you explicitly commit/push them.

## Local PC chart analysis
Run `실행.bat` (Python 3.10+), or start `server.py`, then load `.osu` maps.
- Chart X-Ray, time-based strain, aim/stream/speed/stamina/flow/tech/reading heuristics
- `.osr` replay basic analysis when using the local Python server
- JSON export/import of local browser analysis; PC and phone data don't otherwise sync automatically
- Mobile PWA can analyze local `.osu` files without the Python backend.

## Scope and limits
The **catalogue currently targets osu!standard Ranked/Approved**. It does not yet index Loved, Qualified, Pending, Graveyard, or all four game modes. It is growing from an initial 832 difficulties; a pagination cursor reaching the end does not guarantee every historical beatmap or every change was captured. The published count and rankings only describe maps actually collected. No worldwide ranking, percentile, or completion claim is made.

The public catalogue contains **metadata only**. Downloading original `.osu` note/timing files and calculating full Chart DNA for all entries requires a separate pipeline, subject to source availability, bandwidth, copyright, and osu! API/rate-limit rules. Entire replay datasets are not collected.

GitHub Pages cannot safely hold osu! OAuth client secrets and cannot run Python API calls by itself. The scheduled private GitHub Actions job handles authentication; public pages load only generated JSON.
