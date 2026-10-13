"""osu! Skill Lab Windows launcher/installer. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

SOURCE_ROOT = Path(__file__).resolve().parent
HOME = Path.home() / ".osu-skill-lab"
RUNTIME = HOME / "runtime.json"
INSTALL_META = HOME / "installation.json"
LOG = HOME / "client.log"
RAW_BASE = "https://raw.githubusercontent.com/EpicenterGUY/osu-skill-lab/main/"
MANIFEST_URL = RAW_BASE + "client-update-manifest.json"
ALLOWED_FILES = (
    "server.py", "osu_api.py", "index.html", "app-shell.css", "ranked-catalog.js",
    "profile.js", "client-bridge.js", "mobile-analyzer.js", "mobile-replay.js",
    "manifest.webmanifest", "sw.js", "version.json", "실행.bat",
    "client-launcher.py", "install-client.bat", "uninstall-client.bat",
)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def local_appdata():
    raw = os.environ.get("LOCALAPPDATA")
    if raw:
        return Path(raw)
    return Path.home() / "AppData" / "Local"


def install_dir():
    return local_appdata() / "osu-skill-lab"


def appdata():
    raw = os.environ.get("APPDATA")
    if raw:
        return Path(raw)
    return Path.home() / "AppData" / "Roaming"


def start_menu_link():
    return appdata() / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "osu! Skill Lab.lnk"


def startup_link():
    return appdata() / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "osu! Skill Lab.lnk"


def desktop_dir():
    if os.name != "nt":
        return Path.home() / "Desktop"
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
             "[Environment]::GetFolderPath('Desktop')"],
            capture_output=True, text=True, timeout=8, creationflags=flags,
        )
        value = result.stdout.strip()
        if result.returncode == 0 and value:
            return Path(value)
    except Exception:
        pass
    return Path.home() / "Desktop"


def desktop_link():
    return desktop_dir() / "osu! Skill Lab.lnk"


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def fetch_bytes(url, max_bytes=8 * 1024 * 1024):
    if not str(url).startswith(RAW_BASE):
        raise RuntimeError("허용되지 않은 업데이트 출처입니다.")
    request = Request(url, headers={
        "User-Agent": "osu-skill-lab-installer/1.0",
        "Accept": "application/octet-stream",
    })
    with urlopen(request, timeout=20) as response:
        final = str(response.geturl())
        if not final.startswith(RAW_BASE):
            raise RuntimeError("허용되지 않은 주소로 리다이렉트되었습니다.")
        blob = response.read(max_bytes + 1)
    if len(blob) > max_bytes:
        raise RuntimeError("업데이트 파일이 허용 크기를 초과했습니다.")
    return blob


def git_blob_sha(blob):
    return hashlib.sha1(b"blob " + str(len(blob)).encode() + b"\0" + blob).hexdigest()


def fetch_manifest():
    try:
        manifest = json.loads(fetch_bytes(MANIFEST_URL, 512 * 1024).decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("업데이트 manifest를 읽지 못했습니다.") from exc
    if manifest.get("format") != "osu-skill-lab-client-update":
        raise RuntimeError("지원하지 않는 업데이트 manifest입니다.")
    if manifest.get("source") != RAW_BASE:
        raise RuntimeError("업데이트 출처가 공식 저장소와 일치하지 않습니다.")
    version = str(manifest.get("version") or "").strip()
    rows = manifest.get("files")
    if not version or not isinstance(rows, list) or not rows:
        raise RuntimeError("업데이트 manifest가 불완전합니다.")
    clean = []
    seen = set()
    for row in rows:
        path = str(row.get("path") or "")
        sha = str(row.get("git_blob_sha") or "").lower()
        try:
            size = int(row.get("size"))
        except Exception:
            raise RuntimeError("업데이트 파일 크기가 올바르지 않습니다: " + path)
        if path not in ALLOWED_FILES or path in seen:
            raise RuntimeError("허용되지 않은 업데이트 파일: " + path)
        if len(sha) != 40 or any(ch not in "0123456789abcdef" for ch in sha):
            raise RuntimeError("업데이트 해시가 올바르지 않습니다: " + path)
        if size < 0 or size > 8 * 1024 * 1024:
            raise RuntimeError("업데이트 파일 크기 제한 초과: " + path)
        clean.append({"path": path, "git_blob_sha": sha, "size": size})
        seen.add(path)
    for required in ("server.py", "version.json", "client-launcher.py", "install-client.bat", "uninstall-client.bat"):
        if required not in seen:
            raise RuntimeError("설치 핵심 파일 누락: " + required)
    return {"version": version, "files": clean}


def pythonw_executable():
    exe = Path(sys.executable)
    if os.name == "nt":
        candidate = exe.with_name("pythonw.exe")
        if candidate.exists():
            return candidate
    return exe


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def create_shortcut(path, args, description):
    if os.name != "nt":
        return False
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    target = pythonw_executable()
    launcher = install_dir() / "client-launcher.py"
    argument_text = f'"{launcher}" {args}'
    script = (
        "$ws=New-Object -ComObject WScript.Shell;"
        f"$s=$ws.CreateShortcut({ps_quote(path)});"
        f"$s.TargetPath={ps_quote(target)};"
        f"$s.Arguments={ps_quote(argument_text)};"
        f"$s.WorkingDirectory={ps_quote(install_dir())};"
        f"$s.Description={ps_quote(description)};"
        "$s.Save()"
    )
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        check=True, timeout=15, creationflags=flags,
    )
    return path.exists()


def remove_shortcut(path):
    try:
        Path(path).unlink(missing_ok=True)
    except Exception:
        pass


def set_autostart(enabled):
    if enabled:
        if not (install_dir() / "client-launcher.py").exists():
            raise RuntimeError("먼저 OSL Client를 설치해 주세요.")
        create_shortcut(startup_link(), "start --quiet", "osu! Skill Lab 자동 시작")
    else:
        remove_shortcut(startup_link())
    return startup_link().exists()


def runtime_status():
    data = read_json(RUNTIME, {})
    try:
        port = int(data.get("port"))
    except Exception:
        return None
    if not 1 <= port <= 65535:
        return None
    url = f"http://127.0.0.1:{port}"
    try:
        request = Request(url + "/api/client/status", headers={"User-Agent": "osu-skill-lab-launcher/1.0"})
        with urlopen(request, timeout=0.8) as response:
            payload = json.loads(response.read(1024 * 1024).decode("utf-8"))
        if payload.get("local_server"):
            return {"url": url, "pid": int(data.get("pid") or 0), "port": port, "status": payload}
    except Exception:
        pass
    return None


def process_exists(pid):
    if not pid or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def start_server(open_browser=True, quiet=False):
    running = runtime_status()
    if running:
        if open_browser and not quiet:
            webbrowser.open(running["url"])
        print("OSL Client already running:", running["url"])
        return 0
    root = install_dir() if (install_dir() / "server.py").exists() else SOURCE_ROOT
    server = root / "server.py"
    if not server.exists():
        print("server.py를 찾지 못했습니다. install-client.bat를 먼저 실행해 주세요.", file=sys.stderr)
        return 2
    HOME.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["OSL_BROWSER"] = "0"
    flags = 0
    if os.name == "nt":
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        if quiet:
            flags |= getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with LOG.open("a", encoding="utf-8") as log:
        subprocess.Popen(
            [sys.executable, str(server)],
            cwd=str(root), env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            creationflags=flags,
        )
    deadline = time.monotonic() + 10
    running = None
    while time.monotonic() < deadline:
        time.sleep(0.2)
        running = runtime_status()
        if running:
            break
    if not running:
        print("OSL Client 시작을 확인하지 못했습니다. 로그:", LOG, file=sys.stderr)
        return 3
    if open_browser and not quiet:
        webbrowser.open(running["url"])
    print("OSL Client:", running["url"])
    return 0


def wait_for_pid_exit(pid, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not process_exists(pid):
            return True
        time.sleep(0.25)
    return not process_exists(pid)


def install_client(autostart=False, desktop=False, launch=False):
    if os.name != "nt":
        raise RuntimeError("현재 Installer는 Windows용입니다.")
    manifest = fetch_manifest()
    target = install_dir()
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="osl-install-", dir=str(target.parent)))
    backup = None
    try:
        print(f"OSL Client v{manifest['version']} 다운로드/검증…")
        for index, row in enumerate(manifest["files"], 1):
            blob = fetch_bytes(RAW_BASE + row["path"])
            if len(blob) != row["size"] or git_blob_sha(blob) != row["git_blob_sha"]:
                raise RuntimeError("파일 검증 실패: " + row["path"])
            out = stage / row["path"]
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(blob)
            print(f"  {index}/{len(manifest['files'])} {row['path']}")
        if target.exists():
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            backup = HOME / "install-backups" / stamp
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(target, backup, dirs_exist_ok=True)
        target.mkdir(parents=True, exist_ok=True)
        replaced = []
        try:
            for row in manifest["files"]:
                name = row["path"]
                source = stage / name
                dest = target / name
                tmp = dest.with_name(dest.name + ".install.tmp")
                shutil.copy2(source, tmp)
                os.replace(tmp, dest)
                replaced.append(name)
        except Exception:
            if backup and backup.exists():
                shutil.rmtree(target, ignore_errors=True)
                shutil.copytree(backup, target, dirs_exist_ok=True)
            raise
        create_shortcut(start_menu_link(), "start", "osu! Skill Lab 실행")
        if desktop:
            create_shortcut(desktop_link(), "start", "osu! Skill Lab 실행")
        else:
            remove_shortcut(desktop_link())
        set_autostart(bool(autostart))
        write_json(INSTALL_META, {
            "install_dir": str(target),
            "version": manifest["version"],
            "installed_at": now(),
            "autostart": bool(autostart),
            "desktop_shortcut": bool(desktop),
        })
        print("설치 완료:", target)
        print("사용자 DB/설정은 그대로 유지됩니다:", HOME)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
    if launch:
        return start_server(open_browser=True, quiet=False)
    return 0


def uninstall_client(purge_data=False):
    if os.name != "nt":
        raise RuntimeError("현재 Uninstaller는 Windows용입니다.")
    running = runtime_status()
    if running and running.get("pid") and running["pid"] != os.getpid():
        try:
            os.kill(int(running["pid"]), signal.SIGTERM)
            wait_for_pid_exit(int(running["pid"]), 6)
        except Exception:
            pass
    remove_shortcut(startup_link())
    remove_shortcut(start_menu_link())
    remove_shortcut(desktop_link())
    target = install_dir()
    os.chdir(Path.home())
    if target.exists():
        shutil.rmtree(target, ignore_errors=False)
    try:
        INSTALL_META.unlink(missing_ok=True)
        RUNTIME.unlink(missing_ok=True)
    except Exception:
        pass
    if purge_data:
        shutil.rmtree(HOME, ignore_errors=True)
        print("OSL Client와 사용자 데이터까지 삭제했습니다.")
    else:
        print("OSL Client를 제거했습니다. 사용자 DB/설정은 보존했습니다:", HOME)
    return 0


def print_status():
    meta = read_json(INSTALL_META, {})
    running = runtime_status()
    payload = {
        "installed": (install_dir() / "server.py").exists(),
        "install_dir": str(install_dir()),
        "recorded_version": meta.get("version"),
        "autostart": startup_link().exists(),
        "start_menu": start_menu_link().exists(),
        "desktop": desktop_link().exists(),
        "running": bool(running),
        "url": running.get("url") if running else None,
        "data_dir": str(HOME),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description="osu! Skill Lab Windows launcher/installer")
    sub = parser.add_subparsers(dest="command", required=True)

    p_install = sub.add_parser("install")
    p_install.add_argument("--autostart", action="store_true")
    p_install.add_argument("--desktop", action="store_true")
    p_install.add_argument("--launch", action="store_true")

    p_start = sub.add_parser("start")
    p_start.add_argument("--quiet", action="store_true")

    p_restart = sub.add_parser("restart")
    p_restart.add_argument("--wait-pid", type=int, default=0)
    p_restart.add_argument("--quiet", action="store_true")

    p_auto = sub.add_parser("set-autostart")
    p_auto.add_argument("value", choices=("on", "off"))

    p_uninstall = sub.add_parser("uninstall")
    p_uninstall.add_argument("--purge-data", action="store_true")

    sub.add_parser("status")
    args = parser.parse_args()

    try:
        if args.command == "install":
            return install_client(args.autostart, args.desktop, args.launch)
        if args.command == "start":
            return start_server(open_browser=not args.quiet, quiet=args.quiet)
        if args.command == "restart":
            if args.wait_pid and not wait_for_pid_exit(args.wait_pid):
                raise RuntimeError("기존 OSL Client 종료를 기다리다 시간 초과되었습니다.")
            return start_server(open_browser=not args.quiet, quiet=args.quiet)
        if args.command == "set-autostart":
            enabled = set_autostart(args.value == "on")
            print("자동 시작:", "켜짐" if enabled else "꺼짐")
            return 0
        if args.command == "uninstall":
            return uninstall_client(args.purge_data)
        if args.command == "status":
            return print_status()
    except Exception as exc:
        print("OSL Client Launcher 오류:", exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
