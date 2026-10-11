import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = (ROOT / "build_ranked_views.py").read_text(encoding="utf-8")
DNA_WORKFLOW = (ROOT / ".github/workflows/backfill-chart-dna.yml").read_text(encoding="utf-8")


class DataArchitectureTests(unittest.TestCase):
    def test_ranked_search_is_metadata_only(self):
        self.assertIn("by_month[month].append(mini(m))", BUILD)
        self.assertIn('"payload": "metadata-only-v2"', BUILD)
        self.assertNotIn("by_month[month].append(searchable(m))", BUILD)

    def test_dna_has_lazy_overlay_manifest(self):
        self.assertIn('"overlay": "lazy year shard keyed by beatmap_id"', BUILD)
        self.assertIn('"shards": dna_shards', BUILD)

    def test_dna_backfill_does_not_rebuild_search_shards(self):
        self.assertIn("build_ranked_views.py --skip-search", DNA_WORKFLOW)
        commit_line = next(line for line in DNA_WORKFLOW.splitlines() if "git add -A --" in line)
        self.assertNotIn("data/ranked-search", commit_line)

    def test_dna_request_rate_stays_capped(self):
        self.assertIn("--delay 1", DNA_WORKFLOW)
        self.assertIn("--max-minutes 32", DNA_WORKFLOW)


if __name__ == "__main__":
    unittest.main()
