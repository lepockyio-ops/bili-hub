/* BiliHub 前端逻辑 */

// ------------- Tab 切换 -------------
function switchTab(name) {
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
  const nav = document.querySelector(`.nav-item[data-tab="${name}"]`);
  const tab = document.getElementById(name);
  if (nav) nav.classList.add("active");
  if (tab) tab.classList.add("active");
  window.location.hash = name;
}

document.querySelectorAll(".nav-item").forEach(el => {
  el.addEventListener("click", e => {
    e.preventDefault();
    switchTab(el.dataset.tab);
  });
});

// 支持初始 hash 定位
window.addEventListener("load", () => {
  const hash = (window.location.hash || "#home").slice(1);
  if (["home", "watch", "radar", "comments"].includes(hash)) {
    switchTab(hash);
  }
  loadSummary();
  loadWatch();
  loadRadar();
  loadCommentsOutputs();
  loadCommentJobs();
  // 恢复未完成的 job 轮询（例如页面刷新后）
  resumePollingRunningJobs();
});

// ------------- Loading 遮罩 -------------
function showLoading(text) {
  document.getElementById("loading-text").textContent = text || "处理中...";
  document.getElementById("loading").style.display = "flex";
}
function hideLoading() {
  document.getElementById("loading").style.display = "none";
}

// ------------- 通用 API 调用 -------------
async function api(url, opts = {}) {
  const resp = await fetch(url, opts);
  if (!resp.ok && resp.status >= 500) {
    throw new Error(`服务器错误 ${resp.status}`);
  }
  return await resp.json();
}

// ------------- Home 概览 -------------
async function loadSummary() {
  try {
    const s = await api("/api/summary");
    const cards = [];
    cards.push(`<div class="stat-card">
      <div class="label">👀 订阅 UP 主</div>
      <div class="value">${s.watch.subs_count}</div>
      <div class="sub">最近检查: ${s.watch.last_run}</div>
    </div>`);
    cards.push(`<div class="stat-card">
      <div class="label">📊 追踪曲目</div>
      <div class="value success">${s.radar.tracks_count}</div>
      <div class="sub">数据点累计: ${s.radar.data_points}</div>
    </div>`);
    cards.push(`<div class="stat-card">
      <div class="label">💬 评论文件</div>
      <div class="value warn">${s.comments.output_files}</div>
      <div class="sub">最新: ${s.comments.latest_file || "(无)"}</div>
    </div>`);
    // 邻居状态
    const missing = Object.entries(s.neighbors).filter(([_, ok]) => !ok).map(([k]) => k);
    if (missing.length > 0) {
      cards.push(`<div class="stat-card">
        <div class="label danger">⚠️ 缺少工具</div>
        <div class="value danger" style="font-size: 16px;">${missing.join(", ")}</div>
        <div class="sub">应与 bili-hub 同级</div>
      </div>`);
    } else {
      cards.push(`<div class="stat-card">
        <div class="label">✅ 邻居工具</div>
        <div class="value success" style="font-size: 16px;">全部就绪</div>
        <div class="sub">watch / radar / comments</div>
      </div>`);
    }
    document.getElementById("summary-cards").innerHTML = cards.join("");
  } catch (e) {
    console.error("loadSummary:", e);
  }
}

// ============================================================================
// Watch
// ============================================================================
async function loadWatch() {
  try {
    const subs = await api("/api/watch/subs");
    document.getElementById("watch-count").textContent = subs.length;
    const box = document.getElementById("watch-list");
    if (subs.length === 0) {
      box.innerHTML = '<div class="empty">暂无订阅。用上方表单添加你的第一个 UP 主。</div>';
      return;
    }
    box.innerHTML = subs.map(s => `
      <div class="item">
        <div class="info">
          <div class="item-title">
            ${escapeHtml(s.name)}
            ${s.last_bvid ? `<span class="badge success">最新: ${s.last_bvid.slice(0, 12)}</span>` : ''}
          </div>
          <div class="item-sub">
            UID ${s.uid} · <a href="${s.space_url}" target="_blank">B站空间</a>
            · 最新投稿: ${s.last_created_fmt || '—'}
            · 上次检查: ${s.checked_at_fmt || '—'}
          </div>
        </div>
        <div class="item-actions">
          <button class="btn danger small" onclick="watchRemove(${s.uid})">删除</button>
        </div>
      </div>
    `).join("");
    loadSummary();
  } catch (e) {
    document.getElementById("watch-list").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

async function watchAdd() {
  const raw = document.getElementById("watch-input").value.trim();
  const name = document.getElementById("watch-name").value.trim();
  if (!raw) { alert("请填 UP 主链接或 UID"); return; }
  try {
    const r = await api("/api/watch/subs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({uid_or_url: raw, name})
    });
    if (r.error) { alert("失败: " + r.error); return; }
    document.getElementById("watch-input").value = "";
    document.getElementById("watch-name").value = "";
    loadWatch();
  } catch (e) { alert("失败: " + e.message); }
}

async function watchRemove(uid) {
  if (!confirm(`删除 UID ${uid} 的订阅？`)) return;
  await api(`/api/watch/subs/${uid}`, {method: "DELETE"});
  loadWatch();
}

async function watchCheck() {
  showLoading("正在检查所有订阅（约 30-90s）...");
  try {
    const r = await api("/api/watch/check", {method: "POST"});
    document.getElementById("watch-result-content").textContent = r.stdout + (r.stderr ? "\n---\nSTDERR:\n" + r.stderr : "");
    document.getElementById("watch-result").style.display = "block";
    if (r.new_videos && r.new_videos.length > 0) {
      alert(`🎉 发现 ${r.new_videos.length} 个新稿件！\n\n` + r.new_videos.slice(0, 5).join("\n"));
    }
    loadWatch();
  } catch (e) {
    alert("检查失败: " + e.message);
  } finally {
    hideLoading();
  }
}

// ============================================================================
// Radar
// ============================================================================
async function loadRadar() {
  try {
    const tracks = await api("/api/radar/tracks");
    document.getElementById("radar-count").textContent = tracks.length;
    const box = document.getElementById("radar-list");
    if (tracks.length === 0) {
      box.innerHTML = '<div class="empty">暂无追踪曲目。用上方表单添加。</div>';
      return;
    }
    box.innerHTML = tracks.map(t => {
      const status = t.active ? '<span class="badge success">追踪中</span>' : '<span class="badge">已停止</span>';
      const ageDays = t.pubdate ? Math.round((Date.now()/1000 - t.pubdate) / 86400 * 10) / 10 : '?';
      const view = fmtNum(t.latest_view);
      const like = fmtNum(t.latest_like);
      const coin = fmtNum(t.latest_coin);
      // 追踪中显示"停止"（软删），已停止/所有状态都显示"删除"（硬删）
      const stopBtn = t.active
        ? `<button class="btn small" title="停止采集，保留历史时序" onclick="radarStop('${t.bvid}')">⏸ 停止</button>`
        : '';
      return `
      <div class="item">
        <div class="info">
          <div class="item-title">
            ${status}
            <a href="https://www.bilibili.com/video/${t.bvid}" target="_blank">${escapeHtml(t.title || t.bvid)}</a>
          </div>
          <div class="item-sub">
            ${t.bvid} · UP ${escapeHtml(t.up_name || '')}
            · 已 ${ageDays} 天 · 数据点 ${t.point_count}
            · ▶${view} ❤${like} 💰${coin}
          </div>
        </div>
        <div class="item-actions">
          ${stopBtn}
          <button class="btn danger small" title="彻底删除，含历史时序（不可恢复）" onclick="radarDelete('${t.bvid}', '${escapeHtml(t.title || t.bvid).replace(/'/g, '&#39;')}', ${t.point_count})">🗑 删除</button>
        </div>
      </div>
      `;
    }).join("");
    loadSummary();
  } catch (e) {
    document.getElementById("radar-list").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

async function radarAdd() {
  const bvid = document.getElementById("radar-input").value.trim();
  const note = document.getElementById("radar-note").value.trim();
  if (!bvid) { alert("请填 bvid 或视频链接"); return; }
  showLoading("正在添加追踪并采集基线...");
  try {
    const r = await api("/api/radar/tracks", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({bvid, note})
    });
    if (r.returncode !== 0) {
      alert("失败:\n" + (r.stderr || r.stdout));
      return;
    }
    document.getElementById("radar-input").value = "";
    document.getElementById("radar-note").value = "";
    loadRadar();
  } catch (e) {
    alert("失败: " + e.message);
  } finally {
    hideLoading();
  }
}

/**
 * 软删：停止采集，保留历史时序数据（可以将来手动重启追踪）
 */
async function radarStop(bvid) {
  if (!confirm(`⏸ 停止追踪 ${bvid}？\n\n历史数据会保留。将来可用 CLI 手动恢复：\n  biliradar.py add ${bvid}`)) return;
  showLoading("正在停止追踪...");
  try {
    const r = await api(`/api/radar/tracks/${bvid}`, {method: "DELETE"});
    if (r.returncode === 0) {
      toast("info", "⏸ 已停止追踪", `${escapeHtml(bvid)}<br>历史时序数据已保留`);
    } else {
      toast("danger", "停止失败", escapeHtml((r.stderr || r.stdout || "").slice(0, 200)));
    }
    loadRadar();
  } finally { hideLoading(); }
}

/**
 * 硬删（purge）：彻底删除记录 + 所有历史时序，不可恢复
 * 双重确认，输入 bvid 才能删
 */
async function radarDelete(bvid, title, pointCount) {
  const line1 = `🗑 彻底删除以下曲目？`;
  const line2 = `《${title}》\n(${bvid} · ${pointCount} 个历史数据点)`;
  const line3 = `⚠️ 此操作不可恢复！\n历史时序数据会一起清除。`;
  if (!confirm(`${line1}\n\n${line2}\n\n${line3}`)) return;
  // 二次确认
  const typed = prompt(`⚠️ 请输入 bvid 确认删除：\n${bvid}`);
  if (typed !== bvid) {
    toast("warn", "取消删除", "bvid 未匹配");
    return;
  }
  showLoading("正在彻底删除...");
  try {
    const r = await api(`/api/radar/tracks/${bvid}?purge=1`, {method: "DELETE"});
    if (r.returncode === 0) {
      toast("success", "🗑 已彻底删除", `${escapeHtml(bvid)} 及所有历史数据已清除`);
    } else {
      toast("danger", "删除失败", escapeHtml((r.stderr || r.stdout || "").slice(0, 200)));
    }
    loadRadar();
  } finally { hideLoading(); }
}

/* 旧兼容名（防止 hash 里遗留引用） */
async function radarRemove(bvid) { return radarStop(bvid); }

async function radarCollect() {
  showLoading("正在采集所有追踪曲目数据（每首约 5-8s）...");
  try {
    const r = await api("/api/radar/collect", {method: "POST"});
    showResult("radar-result", r.stdout + (r.stderr ? "\n---\nSTDERR:\n" + r.stderr : ""));
    loadRadar();
  } finally { hideLoading(); }
}

async function radarDashboard() {
  showLoading("正在生成看板...");
  try {
    const r = await api("/api/radar/dashboard", {method: "POST"});
    showResult("radar-result", r.stdout + "\n\n看板已生成，点击 [📖 打开最新看板] 查看");
  } finally { hideLoading(); }
}

async function radarAlerts() {
  showLoading("正在检查预警...");
  try {
    const r = await api("/api/radar/alerts", {method: "POST"});
    showResult("radar-result", r.stdout || "无预警");
  } finally { hideLoading(); }
}

// ============================================================================
// Comments — v1.1 后台任务模式
// ============================================================================
const _pollingJobs = new Set();

async function commentsExtract() {
  const bvid = document.getElementById("comm-bvid").value.trim();
  if (!bvid) { toast("warn", "缺少视频", "请填 bvid 或视频链接"); return; }

  // 首次点击顺便请求桌面通知权限
  requestNotifyPermission();

  const payload = {
    bvid,
    max_pages: parseInt(document.getElementById("comm-pages").value) || 1,
    sort: document.getElementById("comm-sort").value,
    target_lang: document.getElementById("comm-lang").value,
    include_replies: document.getElementById("comm-replies").checked,
    no_translate: document.getElementById("comm-no-trans").checked,
    no_reply: document.getElementById("comm-no-reply").checked,
  };
  try {
    const r = await api("/api/comments/extract", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    if (r.error) {
      toast("danger", "提交失败", r.error);
      return;
    }
    if (r.job_id) {
      toast(
        "info",
        "🚀 任务已提交",
        `<strong>${escapeHtml(bvid)}</strong> 后台运行中，你可以继续操作其他功能。<br>完成后会弹出提示。`,
      );
      pollCommentJob(r.job_id, bvid);
      loadCommentJobs();
    }
    // 清空输入方便下一个
    document.getElementById("comm-bvid").value = "";
  } catch (e) {
    toast("danger", "提交失败", e.message);
  }
}

async function pollCommentJob(jobId, bvid) {
  if (_pollingJobs.has(jobId)) return;
  _pollingJobs.add(jobId);

  while (true) {
    try {
      await sleep(3000);
      const j = await api(`/api/comments/jobs/${jobId}`);
      if (!j || j.status === "unknown") break;
      loadCommentJobs(); // 更新任务列表状态
      if (j.status === "done") {
        const filename = j.download_name || (j.output_file || "").split(/[\\/]/).pop();
        toast(
          "success",
          "✓ 评论抓取完成",
          `<strong>${escapeHtml(bvid)}</strong> 已就绪<br>` +
            (filename ? `<a href="/api/comments/download/${encodeURIComponent(filename)}" class="btn primary small" style="margin-top:6px;">📥 下载 ${escapeHtml(filename)}</a>` : ""),
          20000,
        );
        showResult("comm-result", (j.stdout || "") + (j.stderr ? "\n---\nSTDERR:\n" + j.stderr : ""));
        // 桌面通知
        notify(`✓ 评论抓取完成 · ${bvid}`, filename ? `文件: ${filename}` : "");
        loadCommentsOutputs();
        break;
      }
      if (j.status === "failed") {
        toast("danger", "✗ 评论抓取失败", `<strong>${escapeHtml(bvid)}</strong><br>${escapeHtml((j.stderr || "").slice(0, 200) || "查看日志了解详情")}`, 30000);
        showResult("comm-result", (j.stdout || "") + (j.stderr ? "\n---\nSTDERR:\n" + j.stderr : ""));
        notify(`✗ 评论抓取失败 · ${bvid}`, "查看 BiliHub 页面详情");
        break;
      }
    } catch (e) {
      console.error("poll error:", e);
      await sleep(5000);
    }
  }
  _pollingJobs.delete(jobId);
}

async function resumePollingRunningJobs() {
  try {
    const jobs = await api("/api/comments/jobs");
    for (const j of jobs) {
      if (j.status === "queued" || j.status === "running") {
        pollCommentJob(j.id, j.bvid);
      }
    }
  } catch (e) { /* ignore */ }
}

async function loadCommentJobs() {
  try {
    const jobs = await api("/api/comments/jobs");
    const box = document.getElementById("comments-jobs");
    const running = jobs.filter(j => j.status === "queued" || j.status === "running");
    const recent = jobs.slice(0, 8);
    if (recent.length === 0) {
      box.innerHTML = '<div class="empty">暂无任务。提交上方表单即可开始。</div>';
      return;
    }
    box.innerHTML = recent.map(j => {
      const statusText = ({queued:"排队中",running:"运行中",done:"已完成",failed:"失败"})[j.status] || j.status;
      const dur = j.duration_sec ? `${j.duration_sec}s` : '';
      const dlBtn = j.output_file
        ? `<a class="btn primary small" href="/api/comments/download/${encodeURIComponent(j.output_file)}" target="_blank">📥</a>`
        : '';
      return `
        <div class="item">
          <div class="info">
            <div class="item-title">
              <span class="job-status ${j.status}">${statusText}</span>
              ${escapeHtml(j.bvid)}
            </div>
            <div class="item-sub">
              ${escapeHtml(j.id.slice(-8))} · 开始于 ${j.started_at_fmt}
              ${j.finished_at_fmt ? ` · 结束于 ${j.finished_at_fmt}` : ''}
              · 耗时 ${dur}
            </div>
          </div>
          <div class="item-actions">${dlBtn}</div>
        </div>
      `;
    }).join("");
  } catch (e) {
    document.getElementById("comments-jobs").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

async function loadCommentsOutputs() {
  try {
    const files = await api("/api/comments/outputs");
    const box = document.getElementById("comments-outputs");
    if (files.length === 0) {
      box.innerHTML = '<div class="empty">暂无输出。用上方表单提取第一个视频的评论。</div>';
      return;
    }
    box.innerHTML = files.slice(0, 20).map(f => `
      <div class="item">
        <div class="info">
          <div class="item-title">${escapeHtml(f.name)}</div>
          <div class="item-sub">${f.size_kb} KB · 生成于 ${f.mtime}</div>
        </div>
        <div class="item-actions">
          <a class="btn primary small" href="/api/comments/download/${encodeURIComponent(f.name)}" target="_blank">📥 下载</a>
        </div>
      </div>
    `).join("");
    loadSummary();
  } catch (e) {
    document.getElementById("comments-outputs").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

// ============================================================================
// 工具
// ============================================================================
function escapeHtml(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNum(n) {
  if (n == null) return "—";
  if (n >= 10000) return (n/10000).toFixed(1) + "w";
  return n.toString();
}

function showResult(id, text) {
  const el = document.getElementById(id);
  document.getElementById(id + "-content").textContent = text;
  el.style.display = "block";
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================================
// Toast 通知（右下角）
// ============================================================================
let _toastId = 0;
function toast(level, title, msgHtml, durationMs) {
  const id = "toast-" + (++_toastId);
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${level}`;
  el.id = id;
  const iconMap = { info: "🔔", success: "✓", warn: "⚠️", danger: "✗" };
  el.innerHTML = `
    <button class="toast-close" onclick="dismissToast('${id}')">×</button>
    <div class="toast-title">
      <span>${iconMap[level] || ""}</span>
      <span>${escapeHtml(title)}</span>
    </div>
    <div class="toast-msg">${msgHtml || ""}</div>
  `;
  container.appendChild(el);
  const dur = durationMs || (level === "danger" ? 15000 : 6000);
  setTimeout(() => dismissToast(id), dur);
}
function dismissToast(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("exiting");
  setTimeout(() => el.remove(), 260);
}

// ============================================================================
// 桌面通知
// ============================================================================
function requestNotifyPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}
function notify(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/static/favicon.ico" });
  } catch (e) { /* ignore */ }
}
