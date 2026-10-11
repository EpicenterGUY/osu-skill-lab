"""Generate tiny public statistics + lazy yearly search indexes from ranked shards.

No OAuth keys are used. The public site loads only the summary on entry.
Run after sync_catalog.py and also before a direct GitHub Pages deployment.
"""
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RANKED = DATA / "ranked"
SEARCH = DATA / "ranked-search"
SUMMARY = DATA / "ranked-summary.json"
MANIFEST = DATA / "ranked-manifest.json"

FIELDS = (
    "beatmap_id", "beatmapset_id", "artist", "title", "creator",
    "version", "ranked_date", "official_sr", "bpm", "ar", "od",
    "cs", "hp", "playcount", "total_length", "status"
)


def publish(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if not path.exists() or path.read_text(encoding="utf-8") != content:
        temp = path.with_name(path.name + ".tmp")
        temp.write_text(content, encoding="utf-8")
        temp.replace(path)


def number(value):
    try:
        return float(value) if value is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def mini(entry):
    return {field: entry[field] for field in FIELDS if entry.get(field) is not None}


def date_year(entry):
    date = str(entry.get("ranked_date") or "")
    if len(date) >= 4 and date[:4].isdigit():
        return date[:4]
    return "unknown"


def simple_counter(values, reverse=False):
    return [{"label": str(k), "count": v} for k, v in
            sorted(values.items(), key=lambda kv: kv[0], reverse=reverse)]


def bucket_sr(sr):
    if sr >= 12:
        return "12★+"
    i = max(0, int(sr))
    return f"{i}–{i+1}★"


def bucket_bpm(bpm):
    if bpm < 100:
        return "<100"
    if bpm < 140:
        return "100–139"
    if bpm < 180:
        return "140–179"
    if bpm < 220:
        return "180–219"
    if bpm < 260:
        return "220–259"
    if bpm < 300:
        return "260–299"
    return "300+"


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    maps = {}
    for shard in manifest.get("shards", []):
        path = ROOT / shard["path"]
        entries = json.loads(path.read_text(encoding="utf-8"))
        for m in entries:
            if m.get("beatmap_id"):
                maps[int(m["beatmap_id"])] = m

    values = list(maps.values())
    # Optional actual-chart heuristics. Keep the original metadata independent.
    dna = {}
    for source in sorted((DATA / "chart-dna").glob("*.json")):
        try:
            for record in json.loads(source.read_text(encoding="utf-8")):
                if record.get("beatmap_id") and isinstance(record.get("skills"), dict):
                    dna[int(record["beatmap_id"])] = record
        except (ValueError, TypeError) as exc:
            print(f"Skipping damaged experimental Chart DNA shard {source.name}: {exc}", flush=True)

    def searchable(entry):
        compact = mini(entry)
        chart = dna.get(int(entry.get("beatmap_id") or 0))
        if chart:
            compact["dna"] = {
                "skills": chart.get("skills", {}),
                "objects": chart.get("objects"),
                "duration_s": chart.get("duration_s"),
                "max_stream": chart.get("max_stream"),
                "peak_density_2s": chart.get("peak_density_2s"),
                "median_gap_ms": chart.get("median_gap_ms"),
                "analysis_method": chart.get("analysis_method"),
            }
        return compact
    by_year = defaultdict(list)
    year_sets = defaultdict(set)
    month_maps = Counter()
    month_sets = defaultdict(set)
    sr_counts = Counter()
    bpm_counts = Counter()
    status_counts = Counter()
    mapper_maps = Counter()
    mapper_sets = defaultdict(set)
    sr_values = []
    bpm_values = []
    ranked_dates = []
    for m in values:
        year = date_year(m)
        month = str(m.get("ranked_date") or "")[:7] if year != "unknown" else "unknown"
        sid = m.get("beatmapset_id")
        by_year[year].append(searchable(m))
        if sid:
            year_sets[year].add(sid)
            month_sets[month].add(sid)
        month_maps[month] += 1
        status_counts[str(m.get("status") or "unknown")] += 1
        mapper = str(m.get("creator") or "Unknown")
        mapper_maps[mapper] += 1
        if sid:
            mapper_sets[mapper].add(sid)
        if m.get("official_sr") is not None:
            sr = number(m["official_sr"])
            sr_values.append(sr)
            sr_counts[bucket_sr(sr)] += 1
        if m.get("bpm") is not None:
            bpm = number(m["bpm"])
            bpm_values.append(bpm)
            bpm_counts[bucket_bpm(bpm)] += 1
        if m.get("ranked_date"):
            ranked_dates.append(str(m["ranked_date"]))

    SEARCH.mkdir(parents=True, exist_ok=True)
    search_shards = []
    for year in sorted(by_year, reverse=True):
        rows = sorted(by_year[year], key=lambda m: str(m.get("ranked_date") or ""), reverse=True)
        path = SEARCH / (year + ".json")
        publish(path, rows)
        search_shards.append({"year": year, "path": f"data/ranked-search/{year}.json", "count": len(rows)})

    stale = {p.name for p in SEARCH.glob("*.json")} - {s["year"] + ".json" for s in search_shards}
    for name in stale:
        (SEARCH / name).unlink()

    ranked_sets = {m.get("beatmapset_id") for m in values if m.get("beatmapset_id")}
    mappers = sorted(
        mapper_maps,
        key=lambda name: (-len(mapper_sets[name]), -mapper_maps[name], name.lower())
    )
    summary = {
        "format": "osu-skill-lab-summary",
        "version": 1,
        "source": "osu! API v2",
        "scope": "collected osu!standard Ranked/Approved metadata",
        "updated_at": manifest.get("updated_at"),
        "backfill_complete": bool(manifest.get("backfill_complete")),
        "counts": {
            "difficulties": len(values),
            "beatmapsets": len(ranked_sets),
            "mappers": len(mapper_maps),
            "chart_dna_analyzed": len(set(maps).intersection(dna)),
        },
        "averages": {
            "sr": round(sum(sr_values) / len(sr_values), 2) if sr_values else None,
            "bpm": round(sum(bpm_values) / len(bpm_values), 1) if bpm_values else None,
        },
        "chart_dna": {
            "method": "chart-dna-pilot-v1",
            "status": "experimental partial coverage",
            "note": "Real .osu object geometry; heuristic scores are NOT official SR/pp.",
        },
        "date_range": {
            "oldest": min(ranked_dates) if ranked_dates else None,
            "newest": max(ranked_dates) if ranked_dates else None,
        },
        "years": [
            {"year": year, "difficulties": len(by_year[year]), "beatmapsets": len(year_sets[year])}
            for year in sorted(by_year, reverse=True)
        ],
        "months": [
            {"month": month, "difficulties": count, "beatmapsets": len(month_sets[month])}
            for month, count in sorted(month_maps.items(), reverse=True)
        ],
        "sr_buckets": [
            {"label": label, "count": sr_counts[label]}
            for label in [f"{i}–{i+1}★" for i in range(12)] + ["12★+"]
        ],
        "bpm_buckets": [
            {"label": label, "count": bpm_counts[label]}
            for label in ["<100", "100–139", "140–179", "180–219", "220–259", "260–299", "300+"]
        ],
        "statuses": simple_counter(status_counts),
        "top_mappers": [
            {"name": name, "beatmapsets": len(mapper_sets[name]), "difficulties": mapper_maps[name]}
            for name in mappers[:25]
        ],
        "top_sr": [
            searchable(m) for m in sorted(values, key=lambda m: number(m.get("official_sr")), reverse=True)[:20]
        ],
        "top_playcount": [
            searchable(m) for m in sorted(values, key=lambda m: number(m.get("playcount")), reverse=True)[:20]
        ],
        "recent": [
            searchable(m) for m in sorted(values, key=lambda m: str(m.get("ranked_date") or ""), reverse=True)[:30]
        ],
        "search_shards": search_shards,
    }
    publish(SUMMARY, summary)
    print(
        f"Published summary and {len(search_shards)} yearly search indexes:"
        f" {len(values)} difficulties / {len(ranked_sets)} sets"
        " (collected catalogue only)", flush=True
    )


if __name__ == "__main__":
    main()
