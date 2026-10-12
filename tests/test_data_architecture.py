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

    def test_similarity_index_has_resolution_hints(self):
        self.assertIn('"year":date_year(m)', BUILD)
        self.assertIn('"similarity_index": similarity_targets', BUILD)

    def test_training_pools_are_precomputed_and_published(self):
        self.assertIn('TRAINING_POOLS = DATA / "training-pools.json"', BUILD)
        self.assertIn('"format": "osu-skill-lab-training-pools"', BUILD)
        self.assertIn('"training_pool": {', BUILD)
        self.assertIn("dna_focus", BUILD)

    def test_replay_checksum_index_is_tiny_and_lazy(self):
        self.assertIn('CHECKSUM_INDEX = DATA / "checksum-index"', BUILD)
        self.assertIn('"format": "md5-prefix-v1"', BUILD)
        self.assertIn('"path_template": "data/checksum-index/{prefix}.json"', BUILD)
        self.assertIn('"prefix_length": 2', BUILD)
        self.assertIn('"replay_lookup": checksum_lookup', BUILD)
        commit_line = next(line for line in DNA_WORKFLOW.splitlines() if "git add -A --" in line)
        self.assertIn("data/checksum-index", commit_line)

    def test_dna_backfill_reports_resolved_progress(self):
        self.assertIn('"unsupported_difficulties": int(dna_state.get("terminal_failed_count") or 0)', BUILD)
        self.assertIn('"resolved_percent":', BUILD)
        self.assertIn('"successful_requests_per_minute":', BUILD)

    def test_dna_request_rate_stays_capped(self):
        self.assertIn("--delay 1", DNA_WORKFLOW)
        self.assertIn("--max-minutes 40", DNA_WORKFLOW)
        self.assertIn("2200", DNA_WORKFLOW)


if __name__ == "__main__":
    unittest.main()
