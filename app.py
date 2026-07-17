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
REPORT_DIR = BASE_DIR / "bili-creator-report"  # v1.6 新增
OUTPUTS_DIR = HUB_DIR / "outputs"

CST = timezone(timedelta(hours=8))


def _check_neighbors():
    missing = []
    for name, p in [
        ("biliwatch", WATCH_DIR),
        ("biliradar", RADAR_DIR),
        ("bili-comments", COMMENTS_DIR),
        ("bili-creator-report", REPORT_DIR),
    ]:
        if not p.exists():
            missing.append(f"  · {name}: 期望路径 {p}")
    if missing:
        print("⚠️  以下工具目录不存在（部分功能会失效）：")
        for m in missing:
            print(m)
        print("将四个邻居目录放到与 bili-hub 同级即可。\n")


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

# --- 后台任务系统 ---
import random as _rnd
_comment_jobs = {}  # {job_id: {status, bvid, args, started_at, finished_at, output_file, stdout, stderr, returncode}}
_jobs_lock = threading.Lock()

# v1.4: 通用后台任务（用于 watch check / refresh-names 等）
_bg_jobs = {}  # {job_id: {kind, status, started_at, finished_at, ...}}
_bg_lock = threading.Lock()


def _bg_job_start(kind: str, meta: dict, worker_fn):
    """启动一个通用后台任务。worker_fn() 返回 dict 会 merge 到 job。"""
    job_id = f"{kind}-{int(time.time() * 1000)}-{_rnd.randint(1000, 9999)}"
    with _bg_lock:
        _bg_jobs[job_id] = {
            "id": job_id,
            "kind": kind,
            "status": "queued",
            "started_at": int(time.time()),
            "finished_at": None,
            **meta,
        }

    def _run():
        with _bg_lock:
            if job_id in _bg_jobs:
                _bg_jobs[job_id]["status"] = "running"
        try:
            result = worker_fn() or {}
            with _bg_lock:
                if job_id in _bg_jobs:
                    _bg_jobs[job_id]["status"] = "done"
                    _bg_jobs[job_id]["finished_at"] = int(time.time())
                    _bg_jobs[job_id].update(result)
        except Exception as e:
            with _bg_lock:
                if job_id in _bg_jobs:
                    _bg_jobs[job_id]["status"] = "failed"
                    _bg_jobs[job_id]["finished_at"] = int(time.time())
                    _bg_jobs[job_id]["error"] = str(e)

    _prune_bg_jobs()
    threading.Thread(target=_run, daemon=True).start()
    return job_id


def _prune_bg_jobs(max_keep: int = 30):
    with _bg_lock:
        if len(_bg_jobs) <= max_keep:
            return
        sorted_ids = sorted(_bg_jobs.keys(),
                            key=lambda k: _bg_jobs[k].get("started_at", 0),
                            reverse=True)
        for k in sorted_ids[max_keep:]:
            del _bg_jobs[k]


def _make_job_id() -> str:
    return f"job-{int(time.time() * 1000)}-{_rnd.randint(1000, 9999)}"


def _run_comments_job_thread(job_id: str, args: list[str]):
    with _jobs_lock:
        if job_id in _comment_jobs:
            _comment_jobs[job_id]["status"] = "running"
    r = run_tool(COMMENTS_DIR, args, timeout=1800)
    output_file = None
    for line in (r.get("stdout") or "").splitlines():
        m = re.search(r"XLSX 已保存：(.+\.xlsx)", line)
        if m:
            output_file = m.group(1).strip()
            break
    with _jobs_lock:
        if job_id in _comment_jobs:
            _comment_jobs[job_id]["status"] = "done" if r.get("returncode") == 0 else "failed"
            _comment_jobs[job_id]["returncode"] = r.get("returncode", -1)
            _comment_jobs[job_id]["stdout"] = r.get("stdout", "")
            _comment_jobs[job_id]["stderr"] = r.get("stderr", "")
            _comment_jobs[job_id]["output_file"] = output_file
            _comment_jobs[job_id]["finished_at"] = int(time.time())


def _prune_old_jobs(max_keep: int = 20):
    """只保留最近 max_keep 个 job，防止内存无限增长。"""
    with _jobs_lock:
        if len(_comment_jobs) <= max_keep:
            return
        sorted_ids = sorted(
            _comment_jobs.keys(),
            key=lambda k: _comment_jobs[k].get("started_at", 0),
            reverse=True,
        )
        for k in sorted_ids[max_keep:]:
            del _comment_jobs[k]


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
        "report_dir": str(REPORT_DIR),
        "report_ok": REPORT_DIR.exists(),
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


def _split_batch(raw) -> list[str]:
    """接受字符串（含换行分隔）或列表，返回去空的字符串数组。"""
    if isinstance(raw, list):
        items = [str(x).strip() for x in raw]
    else:
        items = [line.strip() for line in str(raw or "").split("\n")]
    # 过滤空行 + 支持逗号分隔（一行多个）
    out = []
    for it in items:
        for sub in re.split(r"[,\s]+", it):
            sub = sub.strip()
            if sub:
                out.append(sub)
    # 去重（保持顺序）
    seen = set()
    dedup = []
    for it in out:
        if it not in seen:
            seen.add(it)
            dedup.append(it)
    return dedup


@app.post("/api/watch/subs")
def api_watch_add():
    """支持批量：JSON 中 uid_or_url 可以是数组，或字符串（换行/空格/逗号分隔）"""
    data = request.get_json(silent=True) or {}
    raw = data.get("uid_or_url", "")
    fallback_name = data.get("name", "").strip()
    items = _split_batch(raw)
    if not items:
        return jsonify({"error": "缺少 uid_or_url"}), 400

    cfg = watch_load_config()
    existing_uids = set(s["uid"] for s in (cfg.get("subscriptions") or []))
    results = []
    added_count = 0
    for it in items:
        try:
            mid = watch_parse_uid(it)
        except Exception as e:
            results.append({"input": it, "status": "error", "error": str(e)})
            continue
        if mid in existing_uids:
            results.append({"input": it, "uid": mid, "status": "duplicate"})
            continue
        existing_uids.add(mid)
        name = fallback_name if (len(items) == 1 and fallback_name) else f"UID{mid}"
        cfg.setdefault("subscriptions", []).append({"uid": mid, "name": name})
        results.append({"input": it, "uid": mid, "name": name, "status": "added"})
        added_count += 1

    if added_count:
        watch_save_config(cfg)

    return jsonify({
        "ok": True,
        "total": len(items),
        "added": added_count,
        "duplicates": sum(1 for r in results if r["status"] == "duplicate"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "results": results,
    })


@app.delete("/api/watch/subs/<int:uid>")
def api_watch_remove(uid: int):
    cfg = watch_load_config()
    before = len(cfg.get("subscriptions", []) or [])
    cfg["subscriptions"] = [s for s in cfg.get("subscriptions", []) or [] if s["uid"] != uid]
    watch_save_config(cfg)
    return jsonify({"ok": True, "removed": before - len(cfg["subscriptions"])})


@app.post("/api/watch/check")
def api_watch_check():
    """v1.4: 转为后台任务模式。立刻返回 job_id；前端应轮询 /api/jobs/<id>。"""
    if not (WATCH_DIR / "biliwatch.py").exists():
        return jsonify({"error": "biliwatch.py 不存在"}), 500

    subs_count = len(watch_load_config().get("subscriptions") or [])

    def worker():
        r = run_tool(WATCH_DIR, ["biliwatch.py", "check"], timeout=1800)
        new_videos = []
        errors = []
        for line in (r.get("stdout") or "").splitlines():
            if line.startswith("NEW | "):
                new_videos.append(line[6:])
            elif line.startswith("ERR | "):
                errors.append(line[6:])
        return {
            "returncode": r.get("returncode"),
            "stdout": r.get("stdout", ""),
            "stderr": r.get("stderr", ""),
            "new_videos": new_videos,
            "errors": errors,
        }

    job_id = _bg_job_start("watch-check", {"subs_count": subs_count}, worker)
    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "subs_count": subs_count,
        "message": f"检查 {subs_count} 个订阅的后台任务已启动",
    })


@app.post("/api/watch/refresh-names")
def api_watch_refresh_names():
    """v1.4: 批量拉真实 B 站用户名并更新 config。异步后台任务。"""
    cfg_snapshot = watch_load_config()
    subs = cfg_snapshot.get("subscriptions") or []
    if not subs:
        return jsonify({"error": "无订阅"}), 400

    def worker():
        cfg = watch_load_config()
        subs = cfg.get("subscriptions") or []
        updated = 0
        failed = 0
        details = []
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.bilibili.com/",
        }
        # 用 httpx 一次性拉取
        try:
            import httpx as _hx
        except ImportError:
            return {"error": "缺少 httpx", "updated": 0, "failed": len(subs), "total": len(subs)}
        with _hx.Client(timeout=10.0, headers=headers, follow_redirects=True) as c:
            try:
                c.get("https://www.bilibili.com/")
            except Exception:
                pass
            for s in subs:
                mid = s["uid"]
                try:
                    r = c.get("https://api.bilibili.com/x/web-interface/card",
                              params={"mid": mid})
                    data = r.json()
                    if data.get("code") == 0:
                        real_name = (data.get("data") or {}).get("card", {}).get("name") or ""
                        if real_name and s.get("name") != real_name:
                            details.append(f"{mid}: {s.get('name')} → {real_name}")
                            s["name"] = real_name
                            updated += 1
                    else:
                        failed += 1
                        details.append(f"{mid}: API code={data.get('code')}")
                except Exception as e:
                    failed += 1
                    details.append(f"{mid}: 异常 {e}")
                time.sleep(0.4)  # 防风控
        watch_save_config(cfg)
        return {
            "updated": updated,
            "failed": failed,
            "total": len(subs),
            "details": details[:50],  # 只留前 50 条日志
        }

    job_id = _bg_job_start("watch-refresh-names", {"total": len(subs)}, worker)
    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "message": f"刷新 {len(subs)} 个 UP 用户名的后台任务已启动",
    })


@app.get("/api/jobs")
def api_jobs_list():
    with _bg_lock:
        jobs = list(_bg_jobs.values())
    jobs.sort(key=lambda j: j.get("started_at", 0), reverse=True)
    return jsonify(jobs)


@app.get("/api/jobs/<job_id>")
def api_jobs_get(job_id: str):
    with _bg_lock:
        j = _bg_jobs.get(job_id)
        if not j:
            return jsonify({"error": "job 不存在或已被清理", "status": "unknown"}), 404
        result = dict(j)
    result["started_at_fmt"] = fmt_time(result.get("started_at"))
    if result.get("finished_at"):
        result["finished_at_fmt"] = fmt_time(result.get("finished_at"))
        result["duration_sec"] = result["finished_at"] - result["started_at"]
    else:
        result["duration_sec"] = int(time.time()) - result["started_at"]
    return jsonify(result)


# ================= Radar API =================
@app.get("/api/radar/tracks")
def api_radar_list():
    return jsonify(radar_list_tracks())


@app.post("/api/radar/tracks")
def api_radar_add():
    """支持批量：JSON 中 bvid 可以是数组，或字符串（换行/空格/逗号分隔）"""
    data = request.get_json(silent=True) or {}
    raw = data.get("bvid", "")
    fallback_note = data.get("note", "").strip()
    items = _split_batch(raw)
    if not items:
        return jsonify({"error": "缺少 bvid"}), 400

    results = []
    added_count = 0
    for it in items:
        args = ["biliradar.py", "add", it]
        if len(items) == 1 and fallback_note:
            args += ["--note", fallback_note]
        r = run_tool(RADAR_DIR, args, timeout=60)
        status = "added" if r.get("returncode") == 0 else "error"
        # 如果已经追踪过，biliradar 会输出"已在追踪列表中"，returncode 也是 0
        if "已在追踪列表" in (r.get("stdout") or ""):
            status = "duplicate"
        else:
            if status == "added":
                added_count += 1
        results.append({
            "input": it,
            "status": status,
            "stdout": (r.get("stdout") or "").splitlines()[-3:],  # 只留最后几行
            "stderr": r.get("stderr") if status == "error" else None,
        })

    return jsonify({
        "ok": True,
        "total": len(items),
        "added": added_count,
        "duplicates": sum(1 for r in results if r["status"] == "duplicate"),
        "errors": sum(1 for r in results if r["status"] == "error"),
        "results": results,
    })


@app.delete("/api/radar/tracks/<bvid>")
def api_radar_remove(bvid: str):
    """
    默认软删（停止采集，保留历史时序）。
    加 ?purge=1 会走 biliradar.py remove --purge：连历史数据一并删除。
    """
    purge = request.args.get("purge", "").strip().lower() in ("1", "true", "yes")
    args = ["biliradar.py", "remove", bvid]
    if purge:
        args.append("--purge")
    r = run_tool(RADAR_DIR, args, timeout=30)
    r["purge"] = purge
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
    """
    v1.1: 立刻返回 job_id，后台线程执行 subprocess。
    前端应轮询 /api/comments/jobs/<job_id> 获取状态。
    """
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

    job_id = _make_job_id()
    with _jobs_lock:
        _comment_jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "bvid": bvid,
            "args_display": " ".join(args[1:]),
            "started_at": int(time.time()),
            "finished_at": None,
            "output_file": None,
            "stdout": "",
            "stderr": "",
            "returncode": None,
        }

    t = threading.Thread(target=_run_comments_job_thread, args=(job_id, args), daemon=True)
    t.start()
    _prune_old_jobs()

    return jsonify({
        "job_id": job_id,
        "status": "queued",
        "message": "任务已在后台开始，请通过 /api/comments/jobs/<job_id> 轮询状态",
    })


@app.get("/api/comments/jobs")
def api_comments_jobs_list():
    """列出所有后台任务，按启动时间倒序。"""
    with _jobs_lock:
        jobs = list(_comment_jobs.values())
    jobs.sort(key=lambda j: j.get("started_at", 0), reverse=True)
    # 精简输出，避免 stdout/stderr 太大
    lite = []
    for j in jobs:
        lite.append({
            "id": j["id"],
            "status": j["status"],
            "bvid": j["bvid"],
            "started_at": j["started_at"],
            "started_at_fmt": fmt_time(j["started_at"]),
            "finished_at": j.get("finished_at"),
            "finished_at_fmt": fmt_time(j.get("finished_at")) if j.get("finished_at") else None,
            "duration_sec": (j.get("finished_at") or int(time.time())) - j["started_at"],
            "output_file": Path(j["output_file"]).name if j.get("output_file") else None,
            "returncode": j.get("returncode"),
        })
    return jsonify(lite)


@app.get("/api/comments/jobs/<job_id>")
def api_comments_job_status(job_id: str):
    with _jobs_lock:
        j = _comment_jobs.get(job_id)
        if not j:
            return jsonify({"error": "job 不存在或已被清理", "status": "unknown"}), 404
        result = dict(j)
    # 附上下载文件名
    if result.get("output_file"):
        result["download_name"] = Path(result["output_file"]).name
    result["started_at_fmt"] = fmt_time(result["started_at"])
    if result.get("finished_at"):
        result["finished_at_fmt"] = fmt_time(result["finished_at"])
        result["duration_sec"] = result["finished_at"] - result["started_at"]
    else:
        result["duration_sec"] = int(time.time()) - result["started_at"]
    return jsonify(result)


@app.get("/api/comments/download/<filename>")
def api_comments_download(filename: str):
    # 安全：只允许 data/ 下的 .xlsx 文件
    if not filename.endswith(".xlsx") or "/" in filename or "\\" in filename or ".." in filename:
        abort(400)
    p = COMMENTS_DIR / "data" / filename
    if not p.exists():
        abort(404)
    return send_file(str(p), as_attachment=True, download_name=filename)


@app.delete("/api/comments/download/<filename>")
def api_comments_delete_file(filename: str):
    """删除 comments/data/ 下的 xlsx 输出文件。"""
    if not filename.endswith(".xlsx") or "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "不合法的文件名"}), 400
    p = COMMENTS_DIR / "data" / filename
    if not p.exists():
        return jsonify({"error": "文件不存在"}), 404
    try:
        p.unlink()
        return jsonify({"ok": True, "deleted": filename})
    except Exception as e:
        return jsonify({"error": f"删除失败: {e}"}), 500


# ================= Home 概览 =================
@app.get("/api/summary")
def api_summary():
    watch_subs = watch_load_config().get("subscriptions", []) or []
    watch_state = watch_load_state().get("ups", {})
    radar_tracks = radar_list_tracks()
    comments_files = comments_list_outputs()
    report_files = report_list_outputs()

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
        "report": {
            "output_files": len(report_files),
            "latest_file": report_files[0]["name"] if report_files else None,
            "latest_time": report_files[0]["mtime"] if report_files else None,
        },
        "neighbors": {
            "biliwatch": WATCH_DIR.exists(),
            "biliradar": RADAR_DIR.exists(),
            "bili-comments": COMMENTS_DIR.exists(),
            "bili-creator-report": REPORT_DIR.exists(),
        }
    })


# ============================================================================
# BiliCreatorReport (v1.6 新增)
# ============================================================================
def report_list_outputs() -> list[dict]:
    """列出所有生成过的 HTML 报告。"""
    d = REPORT_DIR / "output"
    if not d.exists():
        return []
    files = []
    for f in sorted(d.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = f.stat()
        # 从文件名解析 UID（格式：{name}_{uid}_{date}.html）
        stem = f.stem
        parts = stem.rsplit("_", 2)
        uid = None
        creator_name = stem
        if len(parts) == 3:
            creator_name = parts[0]
            try:
                uid = int(parts[1])
            except Exception:
                pass
        files.append({
            "name": f.name,
            "creator_name": creator_name,
            "uid": uid,
            "size_kb": round(stat.st_size / 1024, 1),
            "mtime": fmt_time(stat.st_mtime),
            "mtime_ts": int(stat.st_mtime),
        })
    return files


@app.get("/api/report/list")
def api_report_list():
    return jsonify(report_list_outputs())


@app.post("/api/report/generate")
def api_report_generate():
    """
    支持批量：uid 可以是数组或字符串（换行分隔）。
    每个 UID 生成独立后台任务。
    """
    data = request.get_json(silent=True) or {}
    raw = data.get("uid", "")
    videos_limit = int(data.get("videos_limit") or 15)
    months = data.get("months")  # 可选

    if not (REPORT_DIR / "generate_report.py").exists():
        return jsonify({"error": "generate_report.py 不存在，请检查 bili-creator-report 目录"}), 500

    # 支持批量
    items = _split_batch(raw)
    if not items:
        return jsonify({"error": "缺少 uid"}), 400

    # 每个 UID 都必须是纯数字
    uids = []
    invalid = []
    for it in items:
        try:
            uids.append(int(it))
        except ValueError:
            invalid.append(it)
    if invalid:
        return jsonify({"error": f"以下不是合法 UID: {', '.join(invalid)}"}), 400

    # 尝试从 watch 订阅列表拉出对应曲师名（用于日志显示）
    watch_subs = {s["uid"]: s.get("name", f"UID{s['uid']}") for s in (watch_load_config().get("subscriptions") or [])}

    jobs = []
    for uid in uids:
        name = watch_subs.get(uid, f"UID{uid}")
        args = ["generate_report.py", str(uid), "--videos-limit", str(videos_limit)]
        if months:
            args += ["--months", str(int(months))]

        def make_worker(a):
            def worker():
                r = run_tool(REPORT_DIR, a, timeout=1800)
                # 从 stdout 里提取输出文件路径
                output_file = None
                for line in (r.get("stdout") or "").splitlines():
                    m = re.search(r"报告已生成：(.+\.html)", line)
                    if m:
                        output_file = m.group(1).strip()
                        break
                return {
                    "returncode": r.get("returncode"),
                    "stdout": r.get("stdout", ""),
                    "stderr": r.get("stderr", ""),
                    "output_file": output_file,
                }
            return worker

        job_id = _bg_job_start(
            "creator-report",
            {"uid": uid, "name": name, "videos_limit": videos_limit},
            make_worker(args),
        )
        jobs.append({"job_id": job_id, "uid": uid, "name": name})

    return jsonify({
        "jobs": jobs,
        "count": len(jobs),
        "status": "queued",
        "message": f"{len(jobs)} 份报告已在后台开始生成",
    })


@app.get("/api/report/download/<filename>")
def api_report_download(filename: str):
    if not filename.endswith(".html") or "/" in filename or "\\" in filename or ".." in filename:
        abort(400)
    p = REPORT_DIR / "output" / filename
    if not p.exists():
        abort(404)
    # 用 inline 让浏览器直接渲染而非下载
    return send_file(str(p), mimetype="text/html; charset=utf-8")


@app.delete("/api/report/download/<filename>")
def api_report_delete_file(filename: str):
    if not filename.endswith(".html") or "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "不合法的文件名"}), 400
    p = REPORT_DIR / "output" / filename
    if not p.exists():
        return jsonify({"error": "文件不存在"}), 404
    try:
        p.unlink()
        return jsonify({"ok": True, "deleted": filename})
    except Exception as e:
        return jsonify({"error": f"删除失败: {e}"}), 500


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
