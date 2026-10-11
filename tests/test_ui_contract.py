import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "index.html").read_text(encoding="utf-8")
RANKED = (ROOT / "ranked-catalog.js").read_text(encoding="utf-8")


class UiContractTests(unittest.TestCase):
    def test_dashboard_tabs_are_wired(self):
        for attr in ("data-dna-view", "data-stats-view", "data-training-view"):
            self.assertIn(attr, HTML, f"{attr} controls missing from index.html")
            self.assertIn(f'[{attr}]', RANKED, f"{attr} has no JS binding")

    def test_research_targets_have_real_hosts(self):
        for element_id in ("eraResearch", "mapperResearch", "oddityResearch", "twinResearch",
                           "dnaGlobalRanking", "dnaSkillLeaderboard", "skillLadder", "weaknessRadar"):
            self.assertRegex(HTML, rf'id="{re.escape(element_id)}"')
            self.assertIn(f'$("{"%s" % element_id}")', RANKED)
        self.assertNotIn("oddResearch", RANKED)

    def test_optional_ranked_controls_cannot_abort_startup(self):
        fragile = re.findall(r'\$\("[^"]+"\)\.addEventListener', RANKED)
        self.assertEqual([], fragile, "Direct listener on a possibly missing element can abort the module")

    def test_dynamic_result_actions_are_delegated(self):
        for attr in ("data-ranked-detail", "data-mapper-search", "data-local-chart", "data-year-link"):
            self.assertIn(attr, RANKED)
        self.assertIn('document.addEventListener("click"', RANKED)

    def test_modal_controls_exist(self):
        self.assertIn('id="chartModal"', HTML)
        self.assertIn('id="chartModalClose"', HTML)
        self.assertIn('id="chartModalBody"', HTML)


if __name__ == "__main__":
    unittest.main()
