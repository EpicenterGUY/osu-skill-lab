import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = (ROOT / "mobile-replay.js").read_text(encoding="utf-8")
SERVER = (ROOT / "server.py").read_text(encoding="utf-8")


class ReplayContractTests(unittest.TestCase):
    def test_pc_server_source_is_valid_python(self):
        ast.parse(SERVER)

    def test_browser_parser_is_honest_header_only(self):
        self.assertIn("header_only:true", MOBILE)
        self.assertIn("replay_data_analyzed:false", MOBILE)
        self.assertIn("replay_timestamp", MOBILE)
        self.assertIn("miss_rate", MOBILE)
        self.assertIn("non300_rate", MOBILE)

    def test_pc_parser_exposes_detailed_but_non_judgement_timing_signals(self):
        self.assertIn("'header_only':False", SERVER)
        self.assertIn("'replay_data_analyzed':True", SERVER)
        self.assertIn("'burst_std_median'", SERVER)
        self.assertIn("'median_gap'", SERVER)
        self.assertIn("'replay_timestamp'", SERVER)
        self.assertIn("'miss_rate'", SERVER)

    def test_local_pc_server_serves_replay_alignment_frontend(self):
        for token in ("'/ranked-catalog.js'", "'/mobile-replay.js'", "'/app-shell.css'", "p.startswith('/data/')"):
            self.assertIn(token, SERVER)

    def test_map_features_keep_coordinates_for_pc_alignment(self):
        self.assertIn("'x':o['x'],'y':o['y']", SERVER)

    def test_pc_parser_handles_replays_without_compressed_frame_payload(self):
        self.assertIn("if size>0:", SERVER)
        self.assertIn("raw=''", SERVER)


if __name__ == "__main__":
    unittest.main()
