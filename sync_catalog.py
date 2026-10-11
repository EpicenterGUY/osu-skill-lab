"""Build a sharded, resumable osu!standard Ranked metadata catalogue for GitHub Pages.

GitHub Actions usage: python sync_catalog.py --pages 20 --fresh-pages 2
Requires OSU_CLIENT_ID and OSU_CLIENT_SECRET environment variables (GitHub Secrets).
Does not download .osu, beatmap archives, or replays.
"""
import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import osu_api

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SHARD_DIR = DATA / "ranked"
STATE_FILE = DATA / "ranked-state.json"
MANIFEST_FILE = DATA / "ranked-manifest.json"
LEGACY_FILE = DATA / "ranked-index.json"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(encoded, encoding="utf-8")
    tmp.replace(path)


def month_for(item):
    date = str(item.get("ranked_date") or "")
    return date[:7] if re.fullmatch(r"\d{4}-\d{2}", date[:7]) else "unknown"


def load_catalog():
    maps = {}
    for path in sorted(SHARD_DIR.glob("*.json")):
        try:
            entries = json.loads(path.read_text(encoding="utf-8"))
            for m in entries:
                if m.get("beatmap_id"):
                    maps[int(m["beatmap_id"])] = m
        except (ValueError, TypeError, KeyError) as exc:
            raise RuntimeError(f"Invalid shard {path}: {exc}") from exc

    if STATE_FILE.exists():
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    else:
        state = {"version": 1, "backfill_cursor": None, "backfill_complete": False}

    # First migration: use the user's existing five pages as the starting point.
    if not maps and LEGACY_FILE.exists():
        old = json.loads(LEGACY_FILE.read_text(encoding="utf-8"))
        if old.get("format") == "osu-skill-lab-ranked-index" and not old.get("query"):
            for m in old.get("maps", []):
                if m.get("beatmap_id") and m.get("mode") == "osu":
                    maps[int(m["beatmap_id"])] = m
            if not STATE_FILE.exists():
                state["backfill_cursor"] = old.get("next_cursor")
                # No cursor from a successful old run means that pagination ended.
                state["backfill_complete"] = not bool(old.get("next_cursor"))
    return maps, state


def add_response(maps, data):
    added = 0
    for s in data.get("beatmapsets", []):
        for b in s.get("beatmaps", []):
            if b.get("mode") != "osu" or b.get("status") not in ("ranked", "approved"):
                continue
            item = osu_api.compact(b)
            item.update({
                "artist": s.get("artist"),
                "title": s.get("title"),
                "creator": s.get("creator"),
                "ranked_date": s.get("ranked_date"),
                "genre_id": (s.get("genre") or {}).get("id"),
                "language_id": (s.get("language") or {}).get("id"),
                "tags": s.get("tags"),
                "beatmapset_id": s.get("id"),
                "data_type": "official_metadata",
                "analysis_status": "not_analyzed",
            })
            beatmap_id = item.get("beatmap_id")
            if not beatmap_id:
                continue
            beatmap_id = int(beatmap_id)
            if beatmap_id not in maps:
                added += 1
            # Keep future separately computed fields if added to the catalogue.
            maps[beatmap_id] = {**maps.get(beatmap_id, {}), **item}
    return added


def scan(maps, pages, cursor=None, delay=1.5, label="backfill"):
    completed = False
    added_total = 0
    for page in range(pages):
        params = {"s": "ranked", "m": "0"}
        if cursor:
            params["cursor_string"] = cursor
        data = osu_api.get("/beatmapsets/search", params)
        sets = data.get("beatmapsets", [])
        added = add_response(maps, data)
        added_total += added
        next_cursor = data.get("cursor_string") or None
        print(f"{label} {page + 1}/{pages}: {len(sets)} sets, +{added} maps, total {len(maps)}", flush=True)
        if not sets or not next_cursor or next_cursor == cursor:
            completed = True
            cursor = None
            break
        cursor = next_cursor
        if page + 1 < pages:
            time.sleep(delay)
    return cursor, completed, added_total


def persist(maps, state):
    grouped = {}
    for item in maps.values():
        grouped.setdefault(month_for(item), []).append(item)
    SHARD_DIR.mkdir(parents=True, exist_ok=True)
    shards = []
    for month, values in sorted(grouped.items(), reverse=True):
        values.sort(key=lambda m: int(m["beatmap_id"]))
        path = SHARD_DIR / f"{month}.json"
        # Don't rewrite unchanged shards; important for Git history and deploy time.
        encoded = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if not path.exists() or path.read_text(encoding="utf-8") != encoded:
            temp = path.with_name(path.name + ".tmp")
            temp.write_text(encoded, encoding="utf-8")
            temp.replace(path)
        shards.append({"path": "data/ranked/" + month + ".json", "count": len(values), "month": month})

    active = {x["path"].split("/")[-1] for x in shards}
    for path in SHARD_DIR.glob("*.json"):
        if path.name not in active:
            path.unlink()

    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    state["indexed_difficulties"] = len(maps)
    write_json(STATE_FILE, state)
    write_json(MANIFEST_FILE, {
        "format": "osu-skill-lab-catalog",
        "version": 1,
        "source": "osu! API v2",
        "mode": "osu",
        "status_filter": "ranked",
        "updated_at": state["updated_at"],
        "indexed_difficulties": len(maps),
        "indexed_sets": len({m["beatmapset_id"] for m in maps.values() if m.get("beatmapset_id")}),
        "backfill_complete": bool(state.get("backfill_complete")),
        "shards": shards,
    })
    print(f"Saved manifest: {len(shards)} monthly shards / {len(maps)} difficulties", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", type=int, default=200, help="Historical pages per run, 0..500")
    parser.add_argument("--fresh-pages", type=int, default=2, help="Newest pages to rescan, 0..10")
    parser.add_argument("--delay", type=float, default=1.5)
    args = parser.parse_args()
    if not 0 <= args.pages <= 500:
        parser.error("--pages must be 0..500")
    if not 0 <= args.fresh_pages <= 10:
        parser.error("--fresh-pages must be 0..10")
    if args.delay < 1:
        parser.error("--delay must be >= 1")
    if not osu_api.configured():
        parser.error("Set OSU_CLIENT_ID and OSU_CLIENT_SECRET via environment/secrets")

    maps, state = load_catalog()
    print("Starting from", len(maps), "difficulties; backfill complete:", state.get("backfill_complete"), flush=True)
    try:
        # New Ranked maps are collected independently of the historical cursor.
        if args.fresh_pages:
            scan(maps, args.fresh_pages, delay=args.delay, label="recent")
            if args.pages and not state.get("backfill_complete"):
                time.sleep(args.delay)
        if args.pages and not state.get("backfill_complete"):
            cursor, done, _ = scan(
                maps, args.pages, cursor=state.get("backfill_cursor"),
                delay=args.delay, label="history"
            )
            state["backfill_cursor"] = cursor
            state["backfill_complete"] = done
    finally:
        # Preserve completed pages even if a subsequent page fails.
        persist(maps, state)


if __name__ == "__main__":
    main()
