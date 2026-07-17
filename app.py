#!/usr/bin/env python3
"""
BiliHub — 三合一 B 站 Vocaloid 运营控制台
==========================================
把 BiliWatch（UP 监控）+ BiliRadar（数据雷达）+ BiliComments（评论收集）
整合成一个本地 Web 应用，浏览器界面操作全部功能。

启动：
    python app.py
自动打开 http://127.0.0.1:5678

依赖：flask
需要邻居目录存在：../biliwatch, ../biliradar, ../bili-comments
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    from flask import Flask, render_template, request, jsonify, send_file, abort
except ImportError:
    print("缺少 flask。请先运行：pip install flask pyyaml", file=sys.stderr)
    sys.exit(1)

try:
    import yaml
except ImportError:
    print("缺少 pyyaml。请先运行：pip install flask pyyaml", file=sys.stderr)
    sys.exit(1)


# ============================================================================
# 路径配置
# ============================================================================
HUB_DIR = Path(__file__).parent.resolve()
BASE_DIR = HUB_DIR.parent
WATCH_DIR = BASE_DIR / "biliwatch"
RADAR_DIR = BASE_DIR / "biliradar"
COMMENTS_DIR = BASE_DIR / "bili-comments"
OUTPUTS_DIR = HUB_DIR / "outputs"

CST = timezone(timedelta(hours=8))


def _check_neighbors():
    missing = []
    for name, p in [
        ("biliwatch", WATCH_DIR),
        ("biliradar", RADAR_DIR),
        ("bili-comments", COMMENTS_DIR),
    ]:
        if not p.exists():
            missing.append(f"  · {name}: 期望路径 {p}")
    if missing:
        print("⚠️  以下工具目录不存在（部分功能会失效）：")
        for m in missing:
            print(m)
        print("将 BiliWatch/BiliRadar/BiliComments 三个目录放到与 bili-hub 同级即可。\n")


# ============================================================================
# 工具函数
# ============================================================================
def fmt_time(ts):
    if not ts:
        return "—"
    if isinstance(ts, str):
        return ts
    return datetime.fromtimestamp(int(ts), CST).strftime("%Y-%m-%d %H:%M")


def get_py():
    """返回 Python 启动器路径。Windows 用 py，其他用 python3。"""
    if sys.platform == "win32":
        # 优先系统 py.exe，避免被 VIRTUAL_ENV 劫持
        for p in [r"C:\Windows\py.exe", r"C:\Python313\python.exe", "py"]:
            if shutil.which(p) or Path(p).exists():
                return p
        return "py"
    return sys.executable or "python3"


def _clean_env():
    """清除可能污染的 VIRTUAL_ENV 环境变量。"""
    env = os.environ.copy()
    for k in ["VIRTUAL_ENV", "PYTHONHOME"]:
        env.pop(k, None)
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def run_tool(cwd: Path, args: list[str], timeout: int = 300) -> dict:
    """在指定目录跑 python 脚本，返回 {stdout, stderr, returncode}"""
    py = get_py()
    env = _clean_env()
    try:
        proc = subprocess.run(
            [py, "-X", "utf8", *args],
            cwd=str(cwd),
            env=env,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return {
            "returncode": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
        }
    except subprocess.TimeoutExpired:
        return {"returncode": -1, "stdout": "", "stderr": f"执行超时（{timeout}s）"}
    except Exception as e:
        return {"returncode": -1, "stdout": "", "stderr": f"启动失败: {e}"}


# ============================================================================
# BiliWatch 数据访问（直接读取，不 shell out）
# ============================================================================
def watch_load_config():
    cfg_path = WATCH_DIR / "config.yaml"
    if not cfg_path.exists():
        return {"subscriptions": []}
    try:
        with cfg_path.open(encoding="utf-8-sig") as f:
            return yaml.safe_load(f) or {"subscriptions": []}
    except Exception:
        return {"subscriptions": []}


def watch_save_config(cfg):
    cfg_path = WATCH_DIR / "config.yaml"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    with cfg_path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)


def watch_load_state():
    state_path = WATCH_DIR / "data" / "state.json"
    if not state_path.exists():
        return {"ups": {}}
    # utf-8-sig 兼容可能存在的 BOM（Windows 一些编辑器会加）
    try:
        with state_path.open(encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception:
        return {"ups": {}}


def watch_parse_uid(raw: str) -> int:
    raw = raw.strip()
    m = re.search(r"space\.bilibili\.com/(\d+)", raw)
    if m:
        return int(m.group(1))
    return int(raw)


# ============================================================================
# BiliRadar 数据访问
# ============================================================================
def radar_db():
    db = RADAR_DIR / "data" / "metrics.db"
    if not db.exists():
        return None
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    return conn


def radar_list_tracks():
    conn = radar_db()
    if not conn:
        return []
    rows = conn.execute(
        """
        SELECT t.*,
               (SELECT COUNT(*) FROM metrics m WHERE m.bvid = t.bvid) AS point_count,
               (SELECT MAX(collected_at) FROM metrics m WHERE m.bvid = t.bvid) AS last_at,
               (SELECT view FROM metrics m WHERE m.bvid = t.bvid ORDER BY collected_at DESC LIMIT 1) AS latest_view,
               (SELECT `like` FROM metrics m WHERE m.bvid = t.bvid ORDER BY collected_at DESC LIMIT 1) AS latest_like,
               (SELECT coin FROM metrics m WHERE m.bvid = t.bvid ORDER BY collected_at DESC LIMIT 1) AS latest_coin
        FROM tracks t
        ORDER BY t.active DESC, t.added_at DESC
        """
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ============================================================================
# BiliComments 输出扫描
# ============================================================================
def comments_list_outputs():
    d = COMMENTS_DIR / "data"
    if not d.exists():
        return []
    files = []
    for f in sorted(d.glob("*.xlsx"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        files.append({
            "name": f.name,
            "size_kb": round(stat.st_size / 1024, 1),
            "mtime": fmt_time(stat.st_mtime),
            "mtime_ts": int(stat.st_mtime),
        })
    return files


# ============================================================================
# Flask 应用
# ============================================================================
app = Flask(__name__, template_folder="templates", static_folder="static")

# --- 全局任务状态（简单单进程内存管理）---
_task_status = {"running": False, "kind": "", "started_at": 0, "log": []}
_task_lock = threading.Lock()


def _task_start(kind: str):
    with _task_lock:
        _task_status["running"] = True
        _task_status["kind"] = kind
        _task_status["started_at"] = int(time.time())
        _task_status["log"] = []


def _task_append(line: str):
    with _task_lock:
        _task_status["log"].append(line)


def _task_end():
    with _task_lock:
        _task_status["running"] = False


# --- Pages ---
@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return jsonify({
        "ok": True,
        "watch_dir": str(WATCH_DIR),
        "watch_ok": WATCH_DIR.exists(),
        "radar_dir": str(RADAR_DIR),
        "radar_ok": RADAR_DIR.exists(),
        "comments_dir": str(COMMENTS_DIR),
        "comments_ok": COMMENTS_DIR.exists(),
    })


# ================= Watch API =================
@app.get("/api/watch/subs")
def api_watch_list():
    cfg = watch_load_config()
    state = watch_load_state().get("ups", {})
    subs = []
    for s in cfg.get("subscriptions", []) or []:
        mid = s["uid"]
        st = state.get(str(mid), {})
        subs.append({
            "uid": mid,
            "name": s.get("name") or f"UID{mid}",
            "last_bvid": st.get("last_bvid", ""),
            "last_created_ts": st.get("last_created_ts", 0),
            "last_created_fmt": fmt_time(st.get("last_created_ts")),
            "checked_at_fmt": fmt_time(st.get("checked_at")),
            "space_url": f"https://space.bilibili.com/{mid}",
        })
    return jsonify(subs)


@app.post("/api/watch/subs")
def api_watch_add():
    data = request.get_json(silent=True) or {}
    raw = data.get("uid_or_url", "").strip()
    name = data.get("name", "").strip()
    if not raw:
        return jsonify({"error": "缺少 uid_or_url"}), 400
    try:
        mid = watch_parse_uid(raw)
    except Exception as e:
        return jsonify({"error": f"解析失败: {e}"}), 400
    cfg = watch_load_config()
    for s in cfg.get("subscriptions") or []:
        if s["uid"] == mid:
            return jsonify({"error": "已在订阅列表", "uid": mid}), 400
    cfg.setdefault("subscriptions", []).append({"uid": mid, "name": name or f"UID{mid}"})
    watch_save_config(cfg)
    return jsonify({"ok": True, "uid": mid, "name": name})


@app.delete("/api/watch/subs/<int:uid>")
def api_watch_remove(uid: int):
    cfg = watch_load_config()
    before = len(cfg.get("subscriptions", []) or [])
    cfg["subscriptions"] = [s for s in cfg.get("subscriptions", []) or [] if s["uid"] != uid]
    watch_save_config(cfg)
    return jsonify({"ok": True, "removed": before - len(cfg["subscriptions"])})


@app.post("/api/watch/check")
def api_watch_check():
    if not (WATCH_DIR / "biliwatch.py").exists():
        return jsonify({"error": "biliwatch.py 不存在"}), 500
    r = run_tool(WATCH_DIR, ["biliwatch.py", "check"], timeout=600)
    # 提取 NEW | 行
    new_videos = []
    for line in r["stdout"].splitlines():
        if line.startswith("NEW | "):
            new_videos.append(line[6:])
    return jsonify({
        "returncode": r["returncode"],
        "stdout": r["stdout"],
        "stderr": r["stderr"],
        "new_videos": new_videos,
    })


# ================= Radar API =================
@app.get("/api/radar/tracks")
def api_radar_list():
    return jsonify(radar_list_tracks())


@app.post("/api/radar/tracks")
def api_radar_add():
    data = request.get_json(silent=True) or {}
    bvid = data.get("bvid", "").strip()
    note = data.get("note", "").strip()
    if not bvid:
        return jsonify({"error": "缺少 bvid"}), 400
    args = ["biliradar.py", "add", bvid]
    if note:
        args += ["--note", note]
    r = run_tool(RADAR_DIR, args, timeout=60)
    return jsonify({
        "returncode": r["returncode"],
        "stdout": r["stdout"],
        "stderr": r["stderr"],
    })


@app.delete("/api/radar/tracks/<bvid>")
def api_radar_remove(bvid: str):
    r = run_tool(RADAR_DIR, ["biliradar.py", "remove", bvid], timeout=30)
    return jsonify(r)


@app.post("/api/radar/collect")
def api_radar_collect():
    r = run_tool(RADAR_DIR, ["biliradar.py", "collect"], timeout=600)
    return jsonify(r)


@app.post("/api/radar/dashboard")
def api_radar_dashboard():
    r = run_tool(RADAR_DIR, ["biliradar.py", "dashboard"], timeout=60)
    return jsonify(r)


@app.get("/api/radar/dashboard.html")
def api_radar_view_dashboard():
    p = RADAR_DIR / "data" / "dashboard.html"
    if not p.exists():
        # 先生成一遍
        run_tool(RADAR_DIR, ["biliradar.py", "dashboard"], timeout=60)
    if not p.exists():
        return "看板未生成。请先添加追踪曲目并 collect 一次。", 404
    return send_file(str(p))


@app.post("/api/radar/alerts")
def api_radar_alerts():
    r = run_tool(RADAR_DIR, ["biliradar.py", "alerts"], timeout=60)
    return jsonify(r)


# ================= Comments API =================
@app.get("/api/comments/outputs")
def api_comments_outputs():
    return jsonify(comments_list_outputs())


@app.post("/api/comments/extract")
def api_comments_extract():
    data = request.get_json(silent=True) or {}
    bvid = data.get("bvid", "").strip()
    if not bvid:
        return jsonify({"error": "缺少 bvid"}), 400

    max_pages = data.get("max_pages")
    sort = data.get("sort", "hot")
    include_replies = bool(data.get("include_replies"))
    no_translate = bool(data.get("no_translate"))
    no_reply = bool(data.get("no_reply"))
    target_lang = data.get("target_lang", "ja")

    args = ["collect_comments.py", bvid]
    if max_pages:
        args += ["--max-pages", str(int(max_pages))]
    if sort and sort != "hot":
        args += ["--sort", sort]
    if include_replies:
        args += ["--include-replies"]
    if no_translate:
        args += ["--no-translate"]
    if no_reply:
        args += ["--no-reply"]
    if target_lang and target_lang != "ja":
        args += ["--target-lang", target_lang]

    r = run_tool(COMMENTS_DIR, args, timeout=1200)
    # 提取输出文件名
    output_file = None
    for line in r["stdout"].splitlines():
        m = re.search(r"XLSX 已保存：(.+\.xlsx)", line)
        if m:
            output_file = m.group(1).strip()
            break

    return jsonify({
        "returncode": r["returncode"],
        "stdout": r["stdout"],
        "stderr": r["stderr"],
        "output_file": output_file,
    })


@app.get("/api/comments/download/<filename>")
def api_comments_download(filename: str):
    # 安全：只允许 data/ 下的 .xlsx 文件
    if not filename.endswith(".xlsx") or "/" in filename or "\\" in filename or ".." in filename:
        abort(400)
    p = COMMENTS_DIR / "data" / filename
    if not p.exists():
        abort(404)
    return send_file(str(p), as_attachment=True, download_name=filename)


# ================= Home 概览 =================
@app.get("/api/summary")
def api_summary():
    watch_subs = watch_load_config().get("subscriptions", []) or []
    watch_state = watch_load_state().get("ups", {})
    radar_tracks = radar_list_tracks()
    comments_files = comments_list_outputs()

    return jsonify({
        "watch": {
            "subs_count": len(watch_subs),
            "last_run": fmt_time(watch_load_state().get("last_run_at")),
        },
        "radar": {
            "tracks_count": len([t for t in radar_tracks if t.get("active")]),
            "total_tracks": len(radar_tracks),
            "data_points": sum(t.get("point_count") or 0 for t in radar_tracks),
        },
        "comments": {
            "output_files": len(comments_files),
            "latest_file": comments_files[0]["name"] if comments_files else None,
            "latest_time": comments_files[0]["mtime"] if comments_files else None,
        },
        "neighbors": {
            "biliwatch": WATCH_DIR.exists(),
            "biliradar": RADAR_DIR.exists(),
            "bili-comments": COMMENTS_DIR.exists(),
        }
    })


# ============================================================================
# 启动
# ============================================================================
def open_browser(port: int, delay: float = 1.5):
    def _open():
        time.sleep(delay)
        webbrowser.open(f"http://127.0.0.1:{port}/")
    threading.Thread(target=_open, daemon=True).start()


def main():
    _check_neighbors()
    port = int(os.environ.get("BILIHUB_PORT", "5678"))
    no_browser = os.environ.get("BILIHUB_NO_BROWSER", "").strip().lower() in ("1", "true", "yes")

    print(f"""
╔══════════════════════════════════════════════╗
║           BiliHub 已启动 🚀                   ║
║   http://127.0.0.1:{port}/                     ║
╚══════════════════════════════════════════════╝

功能页：
  · 首页概览       http://127.0.0.1:{port}/#home
  · UP 主监控      http://127.0.0.1:{port}/#watch
  · 数据雷达       http://127.0.0.1:{port}/#radar
  · 评论收集       http://127.0.0.1:{port}/#comments

按 Ctrl+C 停止服务。
""")

    if not no_browser:
        open_browser(port)

    # 关掉 werkzeug 的 warning 信息
    import logging
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.WARNING)

    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    main()
