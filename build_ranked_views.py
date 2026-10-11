"""Generate tiny public statistics + lazy yearly search indexes from ranked shards.

No OAuth keys are used. The public site loads only the summary on entry.
Run after sync_catalog.py and also before a direct GitHub Pages deployment.
"""
import json
import hashlib
import re
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
    by_month = defaultdict(list)
    year_counts = Counter()
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
    ar_values, od_values, cs_values, length_values = [], [], [], []
    ranked_dates = []
    for m in values:
        year = date_year(m)
        month = str(m.get("ranked_date") or "")[:7] if year != "unknown" else "unknown"
        sid = m.get("beatmapset_id")
        by_year[year].append(searchable(m))
        by_month[month].append(searchable(m))
        year_counts[year] += 1
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
        for field, target in (("ar", ar_values), ("od", od_values), ("cs", cs_values), ("total_length", length_values)):
            if m.get(field) is not None:
                target.append(number(m[field]))
        if m.get("ranked_date"):
            ranked_dates.append(str(m["ranked_date"]))

    # Small independent monthly search files; unchanged months keep their content hash.
    # A visitor loads only a selected month by default (not a whole year).
    SEARCH.mkdir(parents=True, exist_ok=True)
    search_shards = []
    for month in sorted(by_month, reverse=True):
        rows = sorted(by_month[month], key=lambda m: str(m.get("ranked_date") or ""), reverse=True)
        safe_month = month if re.fullmatch(r"\d{4}-\d{2}", month) else "unknown"
        path = SEARCH / (safe_month + ".json")
        publish(path, rows)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
        search_shards.append({
            "month": month,
            "year": month[:4] if safe_month != "unknown" else "unknown",
            "path": f"data/ranked-search/{safe_month}.json",
            "count": len(rows),
            "version": digest,
        })

    active = {sh["path"].split("/")[-1] for sh in search_shards}
    for stale in SEARCH.glob("*.json"):
        if stale.name not in active:
            stale.unlink()

    ranked_sets = {m.get("beatmapset_id") for m in values if m.get("beatmapset_id")}
    mappers = sorted(
        mapper_maps,
        key=lambda name: (-len(mapper_sets[name]), -mapper_maps[name], name.lower())
    )
    # v2 research layer: every result below is derived only from collected metadata / actual Chart DNA.
    skill_names = ("aim","stream","speed","stamina","tech","reading","flow","overall")
    dna_rows = []
    for bid, chart in dna.items():
        meta_row = maps.get(bid)
        if not meta_row:
            continue
        row = searchable(meta_row)
        row["dna"] = row.get("dna") or {"skills": chart.get("skills", {})}
        dna_rows.append(row)
    dna_rankings = {}
    for skill in skill_names:
        dna_rankings[skill] = sorted(
            dna_rows, key=lambda r: number((r.get("dna") or {}).get("skills", {}).get(skill)), reverse=True
        )[:20]
    # Nearest-neighbour pairs in the current analyzed sample. Limit work to a recent/representative window.
    pair_pool = dna_rows[:1500]
    twin_pairs = []
    for i, a in enumerate(pair_pool):
        sa = (a.get("dna") or {}).get("skills", {})
        best = None
        for b in pair_pool[i+1:min(len(pair_pool), i+180)]:
            sb = (b.get("dna") or {}).get("skills", {})
            if not sa or not sb:
                continue
            dist = sum((number(sa.get(k))-number(sb.get(k)))**2 for k in skill_names[:-1]) ** .5
            sr_gap = abs(number(a.get("official_sr"))-number(b.get("official_sr")))
            score = dist + sr_gap * 2
            if best is None or score < best[0]:
                best = (score, dist, sr_gap, b)
        if best:
            twin_pairs.append({"a":a,"b":best[3],"dna_distance":round(best[1],2),"sr_gap":round(best[2],2)})
    twin_pairs = sorted(twin_pairs, key=lambda x:(x["dna_distance"],x["sr_gap"]))[:20]
    # Metadata oddities are useful before full DNA coverage exists.
    oddities = []
    for m in values:
        sr, bpm, length = number(m.get("official_sr")), number(m.get("bpm")), number(m.get("total_length"))
        score = max(0,bpm-240)/20 + max(0,sr-7)*1.4 + max(0,length-420)/120
        if score > 0:
            oddities.append((score, searchable(m)))
    oddities = [m for _,m in sorted(oddities,key=lambda x:x[0],reverse=True)[:30]]
    # Mapper fingerprints from metadata; DNA averages are added whenever analyzed charts exist.
    mapper_fingerprints = []
    dna_by_mapper = defaultdict(list)
    for r in dna_rows:
        dna_by_mapper[str(r.get("creator") or "Unknown")].append(r)
    for name in mappers[:60]:
        rows = [m for m in values if str(m.get("creator") or "Unknown") == name]
        drows = dna_by_mapper.get(name, [])
        skill_avg = {}
        for skill in skill_names[:-1]:
            vals=[number((r.get("dna") or {}).get("skills",{}).get(skill)) for r in drows]
            vals=[v for v in vals if v]
            if vals: skill_avg[skill]=round(sum(vals)/len(vals),1)
        mapper_fingerprints.append({
            "name":name,"beatmapsets":len(mapper_sets[name]),"difficulties":mapper_maps[name],
            "avg_sr":round(sum(number(x.get("official_sr")) for x in rows)/max(1,len(rows)),2),
            "avg_bpm":round(sum(number(x.get("bpm")) for x in rows)/max(1,len(rows)),1),
            "dna_sample":len(drows),"skills":skill_avg,
        })
    # Era averages make long-term meta shifts visible without loading every search shard.
    era_trends=[]
    for year, rows in sorted(by_year.items()):
        if year=="unknown": continue
        def av(field):
            vals=[number(x.get(field)) for x in rows if x.get(field) is not None]
            return round(sum(vals)/len(vals),2) if vals else None
        era_trends.append({"year":year,"count":len(rows),"sr":av("official_sr"),"bpm":av("bpm"),"ar":av("ar"),"od":av("od"),"cs":av("cs")})

    summary = {
        "format": "osu-skill-lab-summary",
        "version": 2,
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
        "attribute_buckets": {
            "ar": [{"label": f"{i}–{i+1}", "count": sum(1 for v in ar_values if i <= v < i+1)} for i in range(0, 11)],
            "od": [{"label": f"{i}–{i+1}", "count": sum(1 for v in od_values if i <= v < i+1)} for i in range(0, 11)],
            "cs": [{"label": f"{i}–{i+1}", "count": sum(1 for v in cs_values if i <= v < i+1)} for i in range(0, 10)],
            "length": [
                {"label":"<1m","count":sum(1 for v in length_values if v < 60)},
                {"label":"1–2m","count":sum(1 for v in length_values if 60 <= v < 120)},
                {"label":"2–3m","count":sum(1 for v in length_values if 120 <= v < 180)},
                {"label":"3–5m","count":sum(1 for v in length_values if 180 <= v < 300)},
                {"label":"5m+","count":sum(1 for v in length_values if v >= 300)},
            ],
        },
        "extremes": {
            "highest_sr": [searchable(m) for m in sorted(values, key=lambda m:number(m.get("official_sr")), reverse=True)[:8]],
            "highest_bpm": [searchable(m) for m in sorted(values, key=lambda m:number(m.get("bpm")), reverse=True)[:8]],
            "longest": [searchable(m) for m in sorted(values, key=lambda m:number(m.get("total_length")), reverse=True)[:8]],
        },
        "research": {
            "dna_rankings": dna_rankings,
            "difficulty_twins": twin_pairs,
            "oddities": oddities,
            "mapper_fingerprints": mapper_fingerprints,
            "era_trends": era_trends,
        },
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
        f"Published summary and {len(search_shards)} monthly search indexes:"
        f" {len(values)} difficulties / {len(ranked_sets)} sets"
        " (collected catalogue only)", flush=True
    )


if __name__ == "__main__":
    main()
