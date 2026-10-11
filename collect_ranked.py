"""Bounded osu!standard Ranked metadata collector. Requires osu_api credentials.
Usage: python collect_ranked.py --pages 5 [--query artist] [--output data/ranked-index.json]
Does not download .osu files or calculate chart skills.
"""
import argparse, json, time
from datetime import datetime, timezone
from pathlib import Path
import osu_api

def collect(pages, query, output, delay):
    output=Path(output)
    previous={}
    cursor=None
    if output.exists():
        old=json.loads(output.read_text(encoding="utf-8"))
        previous={str(x["beatmap_id"]):x for x in old.get("maps",[]) if x.get("beatmap_id")}
        cursor=old.get("next_cursor") if old.get("query","")==query else None
    print("Previously indexed:",len(previous))
    done=0
    for page in range(pages):
        params={"s":"ranked","m":"0"}
        if query: params["q"]=query
        if cursor: params["cursor_string"]=cursor
        data=osu_api.get("/beatmapsets/search",params)
        sets=data.get("beatmapsets",[])
        added=0
        for s in sets:
            for b in s.get("beatmaps",[]):
                if b.get("mode") not in ("osu",None) or b.get("status") not in ("ranked","approved"): continue
                item=osu_api.compact(b)
                item.update({"artist":s.get("artist"),"title":s.get("title"),"creator":s.get("creator"),"ranked_date":s.get("ranked_date"),"genre_id":(s.get("genre") or {}).get("id"),"language_id":(s.get("language") or {}).get("id"),"tags":s.get("tags"),"beatmapset_id":s.get("id"),"data_type":"official_metadata","analysis_status":"not_analyzed"})
                key=str(item["beatmap_id"])
                if key not in previous: added+=1
                previous[key]=item
        done+=1
        cursor=data.get("cursor_string") or None
        result={"format":"osu-skill-lab-ranked-index","version":1,"source":"osu! API v2","mode":"osu","status_filter":"ranked","query":query,"updated_at":datetime.now(timezone.utc).isoformat(),"pages_fetched_this_run":done,"indexed_difficulties":len(previous),"next_cursor":cursor,"maps":list(previous.values())}
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(result,ensure_ascii=False,separators=(",",":")),encoding="utf-8")
        print(f"Page {page+1}/{pages}: {len(sets)} sets, +{added} difficulties, total {len(previous)}")
        if not sets or not cursor:
            print("No further cursor; collection ended.")
            break
        if page+1<pages:time.sleep(delay)
    print("Saved:",output)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--pages",type=int,default=5,help="Pages per run, 1-20")
    p.add_argument("--query",default="",help="Optional ranked search term")
    p.add_argument("--output",default="data/ranked-index.json")
    p.add_argument("--delay",type=float,default=1.5)
    a=p.parse_args()
    if not 1<=a.pages<=20: p.error("--pages must be 1..20")
    if a.delay<1: p.error("--delay must be >= 1 second")
    if not osu_api.configured(): p.error("Set OSU_CLIENT_ID and OSU_CLIENT_SECRET first")
    collect(a.pages,a.query,a.output,a.delay)
