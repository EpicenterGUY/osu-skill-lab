"""Regression checks for osu! Ranked API cursor integrity and durable checkpoints."""
import unittest
from unittest.mock import patch

import sync_catalog


def page(map_id, next_cursor):
    return {
        "beatmapsets": [{
            "id": map_id,
            "artist": "Test",
            "title": "Cursor Test",
            "creator": "Mapper",
            "ranked_date": "2026-10-11T00:00:00Z",
            "beatmaps": [{
                "id": map_id,
                "beatmapset_id": map_id,
                "mode": "osu",
                "status": "ranked",
                "version": "Test",
                "difficulty_rating": 4.0,
            }],
        }],
        "cursor_string": next_cursor,
    }


class CatalogCursorTests(unittest.TestCase):
    def test_regular_pages_checkpoint_latest_cursor(self):
        updates = []
        data = [page(100, "first"), page(101, "second"), page(102, None)]
        with patch.object(sync_catalog.osu_api, "get", side_effect=data), patch.object(sync_catalog.time, "sleep"):
            maps = {}
            cursor, complete, count = sync_catalog.scan(
                maps, pages=10, delay=1.0, checkpoint=lambda c, done: updates.append((c, done)),
                checkpoint_every=1,
            )
        self.assertEqual(len(maps), 3)
        self.assertEqual((cursor, complete, count), (None, True, 3))
        self.assertEqual(updates, [("first", False), ("second", False), (None, True)])

    def test_stalled_cursor_is_not_false_completion(self):
        with patch.object(sync_catalog.osu_api, "get", return_value=page(101, "same")):
            with self.assertRaisesRegex(RuntimeError, "stopped advancing"):
                sync_catalog.scan({}, pages=3, cursor="same", delay=1.0)

    def test_checkpoint_survives_followup_api_failure(self):
        updates = []
        with patch.object(sync_catalog.osu_api, "get", side_effect=[page(102, "saved"), ValueError("timeout")]):
            with patch.object(sync_catalog.time, "sleep"):
                with self.assertRaisesRegex(ValueError, "timeout"):
                    sync_catalog.scan(
                        {}, pages=5, delay=1.0,
                        checkpoint=lambda c, done: updates.append((c, done)),
                        checkpoint_every=1,
                    )
        self.assertEqual(updates, [("saved", False)])

    def test_invalid_response_does_not_advance(self):
        with patch.object(sync_catalog.osu_api, "get", return_value={"error": "rate limited"}):
            with self.assertRaisesRegex(RuntimeError, "malformed"):
                sync_catalog.scan({}, pages=1, delay=1.0)


if __name__ == "__main__":
    unittest.main()
