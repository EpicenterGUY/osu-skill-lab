import hashlib
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "client-update-manifest.json"
VERSION_PATH = ROOT / "version.json"


class ClientUpdateManifestTests(unittest.TestCase):
    def test_manifest_matches_current_client_files(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        version = json.loads(VERSION_PATH.read_text(encoding="utf-8"))
        self.assertEqual(manifest.get("format"), "osu-skill-lab-client-update")
        self.assertEqual(manifest.get("version"), version.get("version"))
        self.assertEqual(
            manifest.get("source"),
            "https://raw.githubusercontent.com/EpicenterGUY/osu-skill-lab/main/",
        )
        rows = manifest.get("files") or []
        self.assertGreater(len(rows), 0)
        seen = set()
        for row in rows:
            path = row["path"]
            with self.subTest(path=path):
                self.assertNotIn(path, seen)
                seen.add(path)
                self.assertNotIn("..", Path(path).parts)
                self.assertNotIn(path, {"client.json", "client.db"})
                self.assertFalse(path.startswith("data/"))
                file_path = ROOT / path
                self.assertTrue(file_path.is_file())
                blob = file_path.read_bytes()
                git_sha = hashlib.sha1(
                    b"blob " + str(len(blob)).encode() + b"\0" + blob
                ).hexdigest()
                self.assertEqual(row["size"], len(blob))
                self.assertEqual(row["git_blob_sha"], git_sha)

    def test_core_updater_files_are_published(self):
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        paths = {row["path"] for row in manifest["files"]}
        for required in ("server.py", "client-bridge.js", "index.html", "version.json", "실행.bat"):
            self.assertIn(required, paths)


if __name__ == "__main__":
    unittest.main()
