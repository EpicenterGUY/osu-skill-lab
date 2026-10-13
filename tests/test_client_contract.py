import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVER = (ROOT / "server.py").read_text(encoding="utf-8")
CLIENT = (ROOT / "client-bridge.js").read_text(encoding="utf-8")
SW = (ROOT / "sw.js").read_text(encoding="utf-8")
LAUNCHER = (ROOT / "client-launcher.py").read_text(encoding="utf-8")
INSTALL_BAT = (ROOT / "install-client.bat").read_text(encoding="utf-8")
UNINSTALL_BAT = (ROOT / "uninstall-client.bat").read_text(encoding="utf-8")
RUN_BAT = (ROOT / "실행.bat").read_text(encoding="utf-8")


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

    def test_replay_inbox_uses_local_sqlite_and_md5_map_matching(self):
        for token in ("CREATE TABLE IF NOT EXISTS replays", "idx_replays_map_hash",
                      "client_scan_replay_worker", "client_replay_list", "client_replay_analyze",
                      "LEFT JOIN maps m ON m.md5=r.map_hash"):
            self.assertIn(token, SERVER)

    def test_replay_inbox_api_contract_exists(self):
        for endpoint in ("/api/client/replays", "/api/client/replays/scan",
                         "/api/client/replays/config", "/api/client/replays/analyze"):
            self.assertIn(endpoint, SERVER)
        self.assertIn("Replay 폴더 밖의 파일은 읽지 않습니다.", SERVER)

    def test_background_dna_queue_is_local_and_bounded(self):
        for token in ("CREATE TABLE IF NOT EXISTS dna_cache", "client_dna_worker", "client_start_dna",
                      "client_stop_dna", "client_dna_counts", "min(5000"):
            self.assertIn(token, SERVER)
        for endpoint in ("/api/client/dna/status", "/api/client/dna/start", "/api/client/dna/stop"):
            self.assertIn(endpoint, SERVER)
        self.assertIn("root not in path.parents", SERVER)
        self.assertIn("summary_json", SERVER)

    def test_always_on_watcher_is_persistent_and_change_driven(self):
        for token in ("CLIENT_WATCH", "client_tree_signature", "client_watch_loop",
                      "client_watch_config", "client_start_watch_thread", "watch_enabled",
                      "watch_interval_s", "triggered_scans"):
            self.assertIn(token, SERVER)
        for endpoint in ("/api/client/watch/status", "/api/client/watch/config"):
            self.assertIn(endpoint, SERVER)
        self.assertIn("client_start_watch_thread()", SERVER)
        self.assertIn("CLIENT_WATCH_WAKE.set()", SERVER)

    def test_songs_config_preserves_other_client_settings(self):
        self.assertIn("cfg=client_json_read(CLIENT_CONFIG,{})", SERVER)
        self.assertIn("cfg.pop('songs_path',None)", SERVER)
        self.assertNotIn("client_json_write(CLIENT_CONFIG,{})", SERVER)

    def test_verified_self_updater_is_restricted_and_recoverable(self):
        for token in ("UPDATE_RAW_BASE='https://raw.githubusercontent.com/EpicenterGUY/osu-skill-lab/main/'",
                      "UPDATE_FILES=", "client_fetch_update_manifest", "client_git_blob_sha",
                      "client_update_worker", "client_prune_backups", "os.replace(temp_target,target)",
                      "업데이트 실패 · 기존 파일 유지/복구"):
            self.assertIn(token, SERVER)
        for endpoint in ("/api/client/update/status", "/api/client/update/check", "/api/client/update/apply"):
            self.assertIn(endpoint, SERVER)
        self.assertIn("if path not in UPDATE_FILES", SERVER)
        self.assertIn("client_git_blob_sha(blob)!=row['git_blob_sha']", SERVER)
        self.assertIn("restart_required", SERVER)

    def test_windows_installer_launcher_is_single_instance_and_data_safe(self):
        ast.parse(LAUNCHER)
        for token in ("RAW_BASE = \"https://raw.githubusercontent.com/EpicenterGUY/osu-skill-lab/main/\"",
                      "def install_client(", "def set_autostart(", "def runtime_status(",
                      "def start_server(", "def process_exists(", "OpenProcess",
                      "install_dir() / \"osu-skill-lab\"" if False else "return local_appdata() / \"osu-skill-lab\""):
            self.assertIn(token, LAUNCHER)
        self.assertIn(".osu-skill-lab", INSTALL_BAT)
        self.assertIn("사용자 DB/설정", INSTALL_BAT)
        self.assertIn("client-launcher.py install", INSTALL_BAT)
        self.assertIn("client-launcher.py uninstall", UNINSTALL_BAT)
        self.assertNotIn("--purge-data", UNINSTALL_BAT)
        self.assertIn("client-launcher.py start", RUN_BAT)

    def test_server_exposes_installed_runtime_and_restart_controls(self):
        for token in ("CLIENT_RUNTIME=CLIENT_HOME/'runtime.json'", "client_install_status",
                      "client_set_autostart", "client_restart_request", "OSL_BROWSER",
                      "client_json_write(CLIENT_RUNTIME"):
            self.assertIn(token, SERVER)
        for endpoint in ("/api/client/install/status", "/api/client/install/startup",
                         "/api/client/restart"):
            self.assertIn(endpoint, SERVER)

    def test_browser_replay_watch_is_explicitly_tab_open_only(self):
        for token in ("osl-client-replay-watch", "scheduleReplayWatch",
                      "panel?.classList.contains(\"active\")", "12000",
                      "OSLReplayBridge.record"):
            self.assertIn(token, CLIENT)

    def test_browser_client_is_hosted_safe(self):
        self.assertIn('location.hostname.endsWith(".github.io")', CLIENT)
        self.assertIn("GitHub Pages · OSL Client Bridge 비활성", CLIENT)
        self.assertIn("OSLClientAcceptMap", CLIENT)
        for token in ("renderDnaStatus", "startDna", "stopDna", "dominantDna",
                      "/api/client/dna/start", "/api/client/dna/stop"):
            self.assertIn(token, CLIENT)
        for token in ("renderWatcherStatus", "saveWatcher", "/api/client/watch/config",
                      "lastStatus?.watch?.enabled"):
            self.assertIn(token, CLIENT)

    def test_pwa_shell_includes_client_bridge(self):
        self.assertIn("./client-bridge.js", SW)


if __name__ == "__main__":
    unittest.main()
