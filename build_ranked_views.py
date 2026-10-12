"""Generate tiny public statistics + lazy yearly search indexes from ranked shards.

No OAuth keys are used. The public site loads only the summary on entry.
Run after sync_catalog.py and also before a direct GitHub Pages deployment.
"""
import argparse
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
TRAINING_POOLS = DATA / "training-pools.json"
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-search", action="store_true",
                        help="reuse committed search shard descriptors; useful for DNA-only rebuilds")
    args = parser.parse_args()
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
    dna_shards = []
    for source in sorted((DATA / "chart-dna").glob("*.json")):
        try:
            records = json.loads(source.read_text(encoding="utf-8"))
            valid = 0
            for record in records:
                if record.get("beatmap_id") and isinstance(record.get("skills"), dict):
                    dna[int(record["beatmap_id"])] = record
                    valid += 1
            digest = hashlib.sha256(source.read_bytes()).hexdigest()[:12]
            dna_shards.append({
                "year": source.stem,
                "path": f"data/chart-dna/{source.name}",
                "count": valid,
                "version": digest,
            })
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
    mapper_rows = defaultdict(list)
    sr_values = []
    bpm_values = []
    ar_values, od_values, cs_values, length_values = [], [], [], []
    ranked_dates = []
    for m in values:
        year = date_year(m)
        month = str(m.get("ranked_date") or "")[:7] if year != "unknown" else "unknown"
        sid = m.get("beatmapset_id")
        # Search shards are metadata-only. Chart DNA is a separate lazy overlay so
        # hourly DNA growth does not rewrite every historical search JSON.
        by_year[year].append(mini(m))
        by_month[month].append(mini(m))
        year_counts[year] += 1
        if sid:
            year_sets[year].add(sid)
            month_sets[month].add(sid)
        month_maps[month] += 1
        status_counts[str(m.get("status") or "unknown")] += 1
        mapper = str(m.get("creator") or "Unknown")
        mapper_maps[mapper] += 1
        mapper_rows[mapper].append(m)
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

    # Small independent monthly metadata files. DNA is intentionally excluded and
    # overlaid lazily from data/chart-dna/<year>.json in the browser.
    if args.skip_search:
        previous = {}
        if SUMMARY.exists():
            try:
                previous = json.loads(SUMMARY.read_text(encoding="utf-8"))
            except (ValueError, TypeError):
                previous = {}
        search_shards = previous.get("search_shards") or []
        if not search_shards:
            raise RuntimeError("--skip-search requested but no committed search shard manifest exists")
    else:
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
                "payload": "metadata-only-v2",
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

    # Practice Route pools: precompute a small, diverse set of DNA-analyzed maps per
    # skill and official SR band. Browsers can build useful sessions without scanning
    # the entire DNA corpus or downloading every year overlay.
    training_bands = (
        ("all", 0.0, 99.0),
        ("3-4", 3.0, 4.0),
        ("4-5", 4.0, 5.0),
        ("5-6", 5.0, 6.0),
        ("6-7", 6.0, 7.0),
        ("7-8", 7.0, 8.0),
        ("8-99", 8.0, 99.0),
    )
    training_pools = {}
    training_coverage = {}
    for skill in skill_names:
        skill_pools = {}
        for band, lo, hi in training_bands:
            candidates = [
                r for r in dna_rows
                if lo <= number(r.get("official_sr")) < hi
            ]
            training_coverage[f"{skill}:{band}"] = len(candidates)
            candidates.sort(
                key=lambda r: (
                    number((r.get("dna") or {}).get("skills", {}).get(skill)),
                    number((r.get("dna") or {}).get("skills", {}).get("overall")),
                    number(r.get("official_sr")),
                ),
                reverse=True,
            )
            picked, set_seen, mapper_seen = [], set(), Counter()
            for r in candidates:
                sid = str(r.get("beatmapset_id") or "")
                mapper = str(r.get("creator") or "Unknown")
                if sid and sid in set_seen:
                    continue
                if mapper_seen[mapper] >= 3:
                    continue
                row = mini(r)
                skills = (r.get("dna") or {}).get("skills", {})
                row["dna_focus"] = round(number(skills.get(skill)), 1)
                row["dna"] = {"skills": {k: round(number(skills.get(k)), 1) for k in skill_names}}
                picked.append(row)
                if sid:
                    set_seen.add(sid)
                mapper_seen[mapper] += 1
                if len(picked) >= 48:
                    break
            skill_pools[band] = picked
        training_pools[skill] = skill_pools
    training_payload = {
        "format": "osu-skill-lab-training-pools",
        "version": 1,
        "method": "chart-dna-pilot-v1",
        "status": "experimental partial coverage",
        "note": "Practice exposure candidates only; not a player skill or pass-probability model.",
        "skills": list(skill_names),
        "bands": [band for band, _, _ in training_bands],
        "coverage": training_coverage,
        "pools": training_pools,
    }
    publish(TRAINING_POOLS, training_payload)
    training_pool_version = hashlib.sha256(TRAINING_POOLS.read_bytes()).hexdigest()[:12]
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
    # Global similarity neighborhoods: precompute candidates so phones do not need the full catalogue.
    # Use normalized metadata dimensions; enrich with DNA distance when both sides have it.
    sim_pool = sorted(values, key=lambda m: str(m.get("ranked_date") or ""), reverse=True)
    def sim_vector(m):
        return (number(m.get("official_sr"))/1.5, number(m.get("bpm"))/80, number(m.get("ar"))/2,
                number(m.get("od"))/2, number(m.get("cs"))/1.5, number(m.get("total_length"))/180)
    def sim_dist(a,b):
        va,vb=sim_vector(a),sim_vector(b)
        base=(sum((x-y)**2 for x,y in zip(va,vb))/len(va))**.5
        da,db=dna.get(int(a.get("beatmap_id") or 0)),dna.get(int(b.get("beatmap_id") or 0))
        if da and db:
            ka=("aim","stream","speed","stamina","tech","reading","flow")
            dd=(sum(((number(da.get("skills",{}).get(k))-number(db.get("skills",{}).get(k)))/25)**2 for k in ka)/len(ka))**.5
            return base*.55+dd*.45
        return base
    # Keep a compact neighborhood for featured/recent/DNA charts; search shards can expose these IDs lazily.
    similarity_targets = {}
    targets=[]
    seen=set()
    for m in list(sim_pool[:120]) + [maps[x] for x in dna if x in maps]:
        bid=int(m.get("beatmap_id") or 0)
        if bid and bid not in seen:
            seen.add(bid);targets.append(m)
    # Bounded candidate windows across SR bands avoids quadratic 144k x 144k work.
    sr_sorted=sorted(values,key=lambda m:number(m.get("official_sr")))
    import bisect
    sr_axis=[number(m.get("official_sr")) for m in sr_sorted]
    for target in targets[:1200]:
        tsr=number(target.get("official_sr"))
        lo=bisect.bisect_left(sr_axis,tsr-.8); hi=bisect.bisect_right(sr_axis,tsr+.8)
        candidates=[m for m in sr_sorted[lo:hi] if m.get("beatmap_id")!=target.get("beatmap_id")]
        if len(candidates)>1800:
            step=max(1,len(candidates)//1800);candidates=candidates[::step][:1800]
        nearest=sorted(((sim_dist(target,m),m) for m in candidates),key=lambda x:x[0])[:8]
        similarity_targets[str(target["beatmap_id"])]=[
            {"beatmap_id":m.get("beatmap_id"),"year":date_year(m),"distance":round(d,3)}
            for d,m in nearest
        ]
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
    for name in mappers[:250]:
        rows = mapper_rows.get(name, [])
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

    dna_year_counts = Counter()
    for beatmap_id in dna:
        meta_row = maps.get(beatmap_id)
        if meta_row:
            dna_year_counts[date_year(meta_row)] += 1
    dna_coverage_by_year = [
        {
            "year": year,
            "analyzed": dna_year_counts.get(year, 0),
            "candidates": len(by_year[year]),
            "coverage_percent": round(dna_year_counts.get(year, 0) / max(1, len(by_year[year])) * 100, 3),
        }
        for year in sorted(by_year, reverse=True) if year != "unknown"
    ]
    dna_state = {}
    dna_state_path = DATA / "chart-dna-state.json"
    if dna_state_path.exists():
        try:
            dna_state = json.loads(dna_state_path.read_text(encoding="utf-8"))
        except (ValueError, TypeError):
            dna_state = {}

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
            "coverage_percent": round(len(set(maps).intersection(dna)) / max(1, len(values)) * 100, 4),
            "coverage_by_year": dna_coverage_by_year,
            "selection_strategy": "coverage-balanced by ranked year; newest first within year",
            "overlay": "lazy year shard keyed by beatmap_id",
            "shards": dna_shards,
            "last_batch": {
                "attempted": int(dna_state.get("attempted_last_run") or 0),
                "succeeded": int(dna_state.get("succeeded_last_run") or 0),
                "elapsed_seconds": number(dna_state.get("elapsed_seconds_last_run")),
                "blocked": bool(dna_state.get("blocked_on_last_run")),
            },
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
        "training_pool": {
            "path": "data/training-pools.json",
            "version": training_pool_version,
            "rows": sum(len(rows) for skill in training_pools.values() for rows in skill.values()),
            "status": "experimental partial Chart DNA coverage",
        },
        "research": {
            "dna_rankings": dna_rankings,
            "difficulty_twins": twin_pairs,
            "oddities": oddities,
            "mapper_fingerprints": mapper_fingerprints,
            "era_trends": era_trends,
            "similarity_index": similarity_targets,
            "similarity_scope": {"targets": len(similarity_targets), "candidate_catalog": len(values), "dimensions": ["sr","bpm","ar","od","cs","length","dna_when_available"]},
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
        "search_payload": "metadata-only-v2",
        "search_shards": search_shards,
    }
    publish(SUMMARY, summary)
    print(
        f"Published summary and {len(search_shards)} monthly metadata indexes:"
        f" {len(values)} difficulties / {len(ranked_sets)} sets"
        " (collected catalogue only)", flush=True
    )


if __name__ == "__main__":
    main()
