"""Conservative opt-in-sized Chart DNA pilot for recent osu!standard Ranked maps.

Only fetches individual .osu files from osu!'s public endpoint, at a slow rate.
Publishes derived numeric heuristics only (never beatmap note/timing files).
This experiment is NOT official osu! star rating, strain or pp.
If the source blocks requests, stop gently and keep the metadata site working.
"""
import argparse
import hashlib
import json
import math
import statistics
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
SHARDS = DATA / "ranked"
DNA_DIR = DATA / "chart-dna"
DNA_STATE = DATA / "chart-dna-state.json"
DNA_MANIFEST = DATA / "chart-dna-manifest.json"
API_URL = "https://old.ppy.sh/osu/"
USER_AGENT = "osu-skill-lab/1.0 (public research project https://github.com/EpicenterGUY/osu-skill-lab)"


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if not path.exists() or path.read_text(encoding="utf-8") != payload:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(payload, encoding="utf-8")
        temporary.replace(path)


def limit_score(score):
    return round(max(0.0, min(100.0, score)), 1)


def avg(values):
    return sum(values) / len(values) if values else 0.0


def sd(values):
    return statistics.pstdev(values) if len(values) > 1 else 0.0


def analyze_chart(raw):
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("cp1252", errors="replace")
    if not content.lstrip().startswith("osu file format v"):
        raise ValueError("not a readable osu! difficulty")
    section = ""
    ar = 8.0
    od = 8.0
    objects = []
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("//"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
            continue
        if section == "Difficulty" and ":" in line:
            key, value = (x.strip() for x in line.split(":", 1))
            if key in ("ApproachRate", "OverallDifficulty"):
                try:
                    if key == "ApproachRate":
                        ar = float(value)
                    else:
                        od = float(value)
                except ValueError:
                    pass
        if section != "HitObjects":
            continue
        fields = line.split(",", 5)
        if len(fields) < 4:
            continue
        try:
            x, y, t, object_type = (int(fields[i]) for i in range(4))
        except ValueError:
            continue
        if object_type & 8:
            continue  # Spinner is not a click/aim coordinate pattern.
        if not object_type & (1 | 2):
            continue
        if not 0 <= x <= 512 or not 0 <= y <= 384:
            continue
        objects.append((x, y, t, object_type))
    if len(objects) < 30:
        raise ValueError("too few playable hit objects for Chart DNA")
    objects.sort(key=lambda x: x[2])
    gaps, dists, angles = [], [], []
    streams = []
    current_run = 0
    max_run = 0
    recent_density = 0
    density_start = 0
    for i, (x, y, t, _) in enumerate(objects):
        while density_start < i and objects[density_start][2] < t - 2000:
            density_start += 1
        recent_density = max(recent_density, i - density_start + 1)
        if i == 0:
            continue
        px, py, pt, _ = objects[i - 1]
        gap = t - pt
        dist = math.hypot(x - px, y - py)
        if gap > 0:
            gaps.append(gap)
        dists.append(dist)
        if 45 <= gap <= 180 and dist < 150:
            current_run += 1
        else:
            if current_run >= 3:
                streams.append(current_run + 1)
            max_run = max(max_run, current_run + 1)
            current_run = 0
        if i >= 2:
            ax, ay, _, _ = objects[i - 2]
            ux, uy, vx, vy = px - ax, py - ay, x - px, y - py
            nu, nv = math.hypot(ux, uy), math.hypot(vx, vy)
            if nu > 0 and nv > 0:
                cos = max(-1, min(1, (ux * vx + uy * vy) / (nu * nv)))
                angles.append(math.degrees(math.acos(cos)))
    if current_run >= 3:
        streams.append(current_run + 1)
    max_run = max(max_run, current_run + 1)
    duration = max(1.0, (objects[-1][2] - objects[0][2]) / 1000)
    median_gap = statistics.median(gaps) if gaps else 0.0
    run_bpm = 15000 / statistics.median([g for g in gaps if 45 <= g <= 180]) if any(45 <= g <= 180 for g in gaps) else 0
    jump_rate = sum(d > 170 for d in dists) / max(1, len(dists))
    fast_rate = sum(0 < g < 110 for g in gaps) / max(1, len(gaps))
    aim = limit_score(avg(dists) / 2.2 + jump_rate * 39)
    stream = limit_score(max_run * 1.45 + max(0, run_bpm - 140) * .27)
    speed = limit_score(max(0, 15000 / max(45, median_gap) - 120) * .58 + fast_rate * 58)
    stamina = limit_score(stream * .48 + max(0, duration - 90) / 6 + len(streams) * .85)
    tech = limit_score(sd(angles) * .58 + sd([g for g in gaps if g < 600]) * .15)
    reading = limit_score(len(objects) / duration * 8.5 + ar * 4.6 + od * .8)
    flow = limit_score(stream * .5 + avg([d for d in dists if d < 170]) * .28)
    axes = {"aim": aim, "stream": stream, "speed": speed, "stamina": stamina,
            "tech": tech, "reading": reading, "flow": flow}
    axes["overall"] = limit_score(avg(list(axes.values())))
    return {
        "skills": axes,
        "objects": len(objects),
        "duration_s": round(duration, 1),
        "max_stream": max_run,
        "peak_density_2s": recent_density,
        "median_gap_ms": round(median_gap, 1),
        "analysis_method": "chart-dna-pilot-v1",
        "data_type": "actual_osu_file_heuristic",
    }


def read_json(path, default):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100, help="max individual .osu files to request per run")
    parser.add_argument("--checkpoint-every", type=int, default=25, help="persist derived metrics every N attempts")
    parser.add_argument("--delay", type=float, default=5.0, help="minimum seconds between chart fetch attempts")
    args = parser.parse_args()
    if not 0 <= args.limit <= 500 or args.delay < 1:
        parser.error("--limit must be 0..500 and --delay >= 1")
    if not 1 <= args.checkpoint_every <= 100:
        parser.error("--checkpoint-every must be 1..100")
    meta = read_json(DATA / "ranked-manifest.json", {"shards": []})
    candidates = {}
    for shard in meta.get("shards", []):
        for row in read_json(ROOT / shard["path"], []):
            if row.get("mode") == "osu" and row.get("status") in ("ranked", "approved") and row.get("beatmap_id"):
                candidates[int(row["beatmap_id"])] = row
    dna = {}
    for path in sorted(DNA_DIR.glob("*.json")):
        for row in read_json(path, []):
            dna[int(row["beatmap_id"])] = row
    state = read_json(DNA_STATE, {"version": 1, "failed": {}})
    failed = state.setdefault("failed", {})
    now = datetime.now(timezone.utc)
    ordered = sorted(candidates.values(), key=lambda m: str(m.get("ranked_date") or ""), reverse=True)
    attempted = succeeded = 0
    blocked = False
    def persist(current_now, current_blocked=False):
        groups = {}
        for entry in dna.values():
            year = str(entry.get("ranked_date") or "unknown")[:4]
            if not year.isdigit():
                year = "unknown"
            groups.setdefault(year, []).append(entry)
        shards = []
        for year in sorted(groups, reverse=True):
            values = sorted(groups[year], key=lambda x: x["beatmap_id"])
            dump(DNA_DIR / (year + ".json"), values)
            shards.append({"year": year, "path": f"data/chart-dna/{year}.json", "count": len(values)})
        state["updated_at"] = current_now.isoformat()
        state["blocked_on_last_run"] = current_blocked
        state["succeeded_last_run"] = succeeded
        state["attempted_last_run"] = attempted
        dump(DNA_STATE, state)
        dump(DNA_MANIFEST, {"format":"osu-skill-lab-chart-dna","version":2,
            "analyzed_difficulties":len(dna),"candidate_difficulties":len(candidates),
            "coverage_percent":round(len(dna)/max(1,len(candidates))*100,4),
            "method":"chart-dna-pilot-v1","status":"experimental partial coverage",
            "source":"official public osu! beatmap text; derived metrics only",
            "updated_at":current_now.isoformat(),"shards":shards})
    for item in ordered:
        if attempted >= args.limit:
            break
        beatmap_id = int(item["beatmap_id"])
        if beatmap_id in dna:
            continue
        prior = failed.get(str(beatmap_id))
        if prior:
            try:
                retry_at = datetime.fromisoformat(prior["retry_after"])
                if now < retry_at:
                    continue
            except (TypeError, ValueError, KeyError):
                pass
        if attempted:
            time.sleep(args.delay)
        attempted += 1
        try:
            request = Request(API_URL + str(beatmap_id), headers={"User-Agent": USER_AGENT, "Accept": "text/plain"})
            with urlopen(request, timeout=18) as response:
                if response.status != 200:
                    raise ValueError("non-200 status")
                raw = response.read(2_500_001)
                if len(raw) > 2_500_000:
                    raise ValueError("oversized beatmap file")
            official_checksum = item.get("checksum")
            if official_checksum and hashlib.md5(raw).hexdigest().lower() != str(official_checksum).lower():
                raise ValueError("MD5 mismatch with official metadata")
            entry = analyze_chart(raw)
            entry.update({
                "beatmap_id": beatmap_id,
                "beatmapset_id": item.get("beatmapset_id"),
                "ranked_date": item.get("ranked_date"),
                "analyzed_at": now.isoformat(),
            })
            dna[beatmap_id] = entry
            failed.pop(str(beatmap_id), None)
            succeeded += 1
            print(f"Chart DNA {beatmap_id}: analyzed {entry['objects']} objects", flush=True)
        except HTTPError as exc:
            print(f"Chart DNA {beatmap_id}: HTTP {exc.code}; retaining metadata only", flush=True)
            if exc.code in (403, 429, 503):
                blocked = True
            retry_hours = 72 if exc.code in (403, 404) else 24
            failed[str(beatmap_id)] = {"retry_after": (now + timedelta(hours=retry_hours)).isoformat(),
                                       "reason": f"HTTP {exc.code}"}
        except (OSError, ValueError, URLError) as exc:
            print(f"Chart DNA {beatmap_id}: unavailable ({type(exc).__name__})", flush=True)
            failed[str(beatmap_id)] = {"retry_after": (now + timedelta(hours=24)).isoformat(),
                                       "reason": type(exc).__name__}
        if attempted % args.checkpoint_every == 0:
            persist(datetime.now(timezone.utc), blocked)
            print(f"Checkpoint: {len(dna)}/{len(candidates)} DNA charts stored.", flush=True)
        if blocked:
            print("Source requested a pause; stopping the pilot for this run.", flush=True)
            break

    # Final checkpoint. Raw .osu content is never written to disk.
    persist(datetime.now(timezone.utc), blocked)
    print(f"Chart DNA pilot: {succeeded}/{attempted} newly analyzed, {len(dna)} stored. No raw charts published.", flush=True)


if __name__ == "__main__":
    main()
