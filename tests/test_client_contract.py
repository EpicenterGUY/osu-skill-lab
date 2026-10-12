import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "server.py").read_text(encoding="utf-8")
CLIENT = (ROOT / "client-bridge.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


class ClientContractTests(unittest.TestCase):
    def test_server_source_is_valid_python(self):
        ast.parse(SERVER)

    def test_client_uses_local_sqlite_index(self):
        for token in ("CLIENT_DB=CLIENT_HOME/'client.db'", "sqlite3.connect", "CREATE TABLE IF NOT EXISTS maps",
                      "idx_maps_md5", "scan_token", "client_scan_worker"):
            self.assertIn(token, SERVER)

    def test_client_scan_is_incremental_and_standard_only(self):
        self.assertIn("mtime_ns", SERVER)
        self.assertIn("CLIENT_SCAN['reused']", SERVER)
        self.assertIn("if m['mode']!=0:continue", SERVER)
        self.assertIn("DELETE FROM maps WHERE root=? AND scan_token<>?", SERVER)

    def test_client_analysis_cannot_read_outside_configured_songs_root(self):
        self.assertIn("if root not in path.parents", SERVER)
        self.assertIn("Songs 폴더 밖의 파일은 분석하지 않습니다.", SERVER)

    def test_client_api_contract_exists(self):
        for endpoint in ("/api/client/status", "/api/client/library", "/api/client/config",
                         "/api/client/scan", "/api/client/analyze"):
            self.assertIn(endpoint, SERVER)

    def test_browser_client_is_hosted_safe(self):
        self.assertIn('location.hostname.endsWith(".github.io")', CLIENT)
        self.assertIn("GitHub Pages · OSL Client Bridge 비활성", CLIENT)
        self.assertIn("OSLClientAcceptMap", CLIENT)

    def test_pwa_shell_includes_client_bridge(self):
        self.assertIn("./client-bridge.js", SW)


if __name__ == "__main__":
    unittest.main()
