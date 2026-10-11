"""osu! API v2 client for local Skill Lab. Credentials never leave this computer except to osu.ppy.sh."""
import json, os, time, threading
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

BASE = "https://osu.ppy.sh"
LOCK = threading.Lock()
_token = {"value": None, "expires": 0}
_cache = {}
CACHE_SECONDS = 900

def credentials():
    # Use environment variables only. Never store or transmit secrets via GitHub.
    return os.environ.get("OSU_CLIENT_ID", "").strip(), os.environ.get("OSU_CLIENT_SECRET", "").strip()

def configured():
    client_id, secret = credentials()
    return bool(client_id and secret)

def _request(url, method="GET", payload=None, bearer=None):
    """Use modest retries for transient errors, respecting Retry-After and osu! service health."""
    headers = {"Accept": "application/json", "User-Agent": "osu-skill-lab/1.2 (Ranked metadata catalogue)"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if bearer:
        headers["Authorization"] = "Bearer " + bearer

    for attempt in range(6):
        req = Request(url, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read(5_000_000))
        except HTTPError as exc:
            code = exc.code
            body = exc.read(512).decode("utf-8", "replace")
            if code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise ValueError(f"osu! API HTTP {code}: {body[:180]}") from exc
            retry_after = exc.headers.get("Retry-After", "")
            try:
                seconds = max(1.0, min(180.0, float(retry_after)))
            except (TypeError, ValueError):
                seconds = min(90.0, 3.0 * (2 ** attempt))
            print(f"osu! API {code}; retry {attempt + 1}/5 after {seconds:.0f}s", flush=True)
            time.sleep(seconds)
        except (URLError, TimeoutError) as exc:
            if attempt == 5:
                raise ValueError(f"osu! API connection failed after retries: {exc}") from exc
            seconds = min(90.0, 3.0 * (2 ** attempt))
            print(f"osu! API connection retry {attempt + 1}/5 after {seconds:.0f}s", flush=True)
            time.sleep(seconds)
    raise RuntimeError("unreachable osu! API retry state")

def token():
    if not configured():
        raise ValueError("OSU_CLIENT_ID / OSU_CLIENT_SECRET 환경변수를 설정하세요.")
    with LOCK:
        if _token["value"] and time.time() < _token["expires"] - 60:
            return _token["value"]
        client_id, secret = credentials()
        d = _request(BASE + "/oauth/token", "POST", {
            "client_id": client_id, "client_secret": secret,
            "grant_type": "client_credentials", "scope": "public"
        })
        _token["value"] = d["access_token"]
        _token["expires"] = time.time() + int(d.get("expires_in", 3600))
        return _token["value"]

def get(path, params=None):
    if not path.startswith("/") or "://" in path:
        raise ValueError("Invalid API path")
    url = BASE + "/api/v2" + path
    if params:
        url += "?" + urlencode(params)
    key = url
    with LOCK:
        cached = _cache.get(key)
        if cached and cached[0] > time.time():
            return cached[1]
    result = _request(url, bearer=token())
    with LOCK:
        _cache[key] = (time.time() + CACHE_SECONDS, result)
        if len(_cache) > 300:
            for k in list(_cache)[:100]:
                del _cache[k]
    return result

def compact(b):
    return {
        "beatmap_id": b.get("id"),
        "beatmapset_id": b.get("beatmapset_id"),
        "status": b.get("status", "unknown"),
        "official_sr": b.get("difficulty_rating"),
        "playcount": b.get("playcount"),
        "passcount": b.get("passcount"),
        "checksum": b.get("checksum"),
        "mode": b.get("mode"),
        "version": b.get("version"),
        "bpm": b.get("bpm"),
        "ar": b.get("ar"), "od": b.get("accuracy"),
        "cs": b.get("cs"), "hp": b.get("drain"),
        "url": b.get("url"),
        "total_length": b.get("total_length"),
        "last_updated": b.get("last_updated"),
        "source": "osu! API v2"
    }

def lookup_md5(checksum):
    if len(checksum) != 32 or any(c not in "0123456789abcdefABCDEF" for c in checksum):
        raise ValueError("32자리 MD5 체크섬이 필요합니다.")
    b = get("/beatmaps/lookup", {"checksum": checksum.lower()})
    if not isinstance(b, dict) or not b.get("id"):
        return {"found": False}
    return {"found": True, "beatmap": compact(b)}

def search_ranked(query, page=1):
    page = max(1, min(int(page), 100))
    query = str(query)[:100]
    d = get("/beatmapsets/search", {"q": query, "s": "ranked", "m": 0, "page": page})
    results = []
    for s in d.get("beatmapsets", [])[:50]:
        maps = [compact(b) for b in s.get("beatmaps", []) if b.get("mode") in ("osu", None) and b.get("status") in ("ranked", "approved")]
        if not maps:
            continue
        results.append({
            "beatmapset_id": s.get("id"), "artist": s.get("artist"),
            "title": s.get("title"), "creator": s.get("creator"),
            "ranked_date": s.get("ranked_date"), "maps": maps
        })
    return {"query": query, "page": page, "beatmapsets": results,
            "cursor": d.get("cursor_string"), "source": "osu! API v2"}
