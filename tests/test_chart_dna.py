"""Offline tests for Chart DNA pilot: no API keys or downloads needed."""
import unittest

from build_chart_dna import analyze_chart


class ChartDnaTests(unittest.TestCase):
    def test_real_notes_create_bounded_heuristic_scores(self):
        header = (
            "osu file format v14\n"
            "[Difficulty]\n"
            "ApproachRate:9.3\n"
            "OverallDifficulty:8.2\n"
            "[HitObjects]\n"
        )
        notes = "".join(
            f"{120 if i % 2 == 0 else 390},{190 if i % 3 else 230},{1000 + i * 95},1,0,0:0:0:0:\n"
            for i in range(180)
        )
        result = analyze_chart((header + notes).encode("utf-8"))
        self.assertEqual(result["objects"], 180)
        self.assertGreater(result["duration_s"], 10)
        self.assertEqual(result["analysis_method"], "chart-dna-pilot-v1")
        self.assertEqual(result["data_type"], "actual_osu_file_heuristic")
        for skill, number in result["skills"].items():
            with self.subTest(skill=skill):
                self.assertGreaterEqual(number, 0)
                self.assertLessEqual(number, 100)

    def test_reject_html_response(self):
        with self.assertRaises(ValueError):
            analyze_chart(b"<html><body>HTTP error</body></html>")

    def test_reject_empty_chart(self):
        with self.assertRaises(ValueError):
            analyze_chart(b"osu file format v14\n[HitObjects]\n")


if __name__ == "__main__":
    unittest.main()
