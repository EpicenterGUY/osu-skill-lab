"""Refresh one explicitly opted-in PUBLIC osu!standard user profile for static GitHub Pages.

GitHub repository variable OSU_PROFILE_USERNAME opts the owner in to publishing
their already-public osu! username, ranks, avatar URL, and public statistics.
OSU_CLIENT_ID/OSU_CLIENT_SECRET stay in Actions secrets and are never published.
The site does not implement an insecure browser-side OAuth token exchange.
"""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import osu_api

DEST = Path(__file__).resolve().parent / "data" / "osu-profile.json"
MAX_NAME_LENGTH = 60


def save(data):
    DEST.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    if not DEST.exists() or DEST.read_text(encoding="utf-8") != encoded:
        path = DEST.with_suffix(".json.tmp")
        path.write_text(encoded, encoding="utf-8")
        path.replace(DEST)


def compact_user(data):
    """Strict allowlist prevents accidentally exposing private API metadata."""
    stats = data.get("statistics") or {}
    country = data.get("country") or {}
    rank_history = stats.get("rank", {}) if isinstance(stats.get("rank"), dict) else {}
    return {
        "format": "osu-skill-lab-public-profile",
        "version": 1,
        "source": "osu! API v2",
        "mode": "osu",
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "id": data["id"],
        "username": data["username"],
        "avatar_url": data.get("avatar_url"),
        "cover_url": (data.get("cover") or {}).get("url"),
        "country_code": country.get("code") or data.get("country_code"),
        "country_name": country.get("name"),
        "join_date": data.get("join_date"),
        "is_supporter": bool(data.get("is_supporter")),
        "follower_count": data.get("follower_count"),
        "statistics": {
            "pp": stats.get("pp"),
            "global_rank": stats.get("global_rank"),
            "country_rank": stats.get("country_rank"),
            "hit_accuracy": stats.get("hit_accuracy"),
            "play_count": stats.get("play_count"),
            "play_time": stats.get("play_time"),
            "total_hits": stats.get("total_hits"),
            "maximum_combo": stats.get("maximum_combo"),
            "level": stats.get("level"),
            "ranked_score": stats.get("ranked_score"),
            "total_score": stats.get("total_score"),
            "grade_counts": stats.get("grade_counts"),
            "rank": rank_history,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-age-hours", type=float, default=12)
    args = parser.parse_args()
    username = os.environ.get("OSU_PROFILE_USERNAME", "").strip()
    if not username:
        print("No public profile configured; skipping (set repository variable OSU_PROFILE_USERNAME).")
        return
    if not 1 <= len(username) <= MAX_NAME_LENGTH or any(ch in username for ch in "\n\r\t\\/"):
        parser.error("Invalid OSU_PROFILE_USERNAME")
    if DEST.exists():
        cached = json.loads(DEST.read_text(encoding="utf-8"))
        if cached.get("username", "").casefold() == username.casefold():
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["refreshed_at"])).total_seconds()
                if 0 <= age < args.min_age_hours * 3600:
                    print("Published osu! profile is still fresh; keeping cache.")
                    return
            except (KeyError, ValueError, TypeError):
                pass
    if not osu_api.configured():
        print("No server-side osu! API credentials; public profile refresh skipped.")
        return
    data = osu_api.get("/users/" + quote(username, safe="") + "/osu", {"key": "username"})
    if not isinstance(data, dict) or not data.get("id") or not data.get("username"):
        raise ValueError("osu! API returned no valid user profile")
    result = compact_user(data)
    save(result)
    print("Published public osu! profile:", result["username"], result["id"])


if __name__ == "__main__":
    main()
