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
  if (["home", "watch", "radar", "comments", "report"].includes(hash)) {
    switchTab(hash);
  }
  loadSummary();
  loadWatch();
  loadRadar();
  loadCommentsOutputs();
  loadCommentJobs();
  loadReportOutputs();
  loadReportJobs();
  // 恢复未完成的 job 轮询（例如页面刷新后）
  resumePollingRunningJobs();
  resumePollingReportJobs();
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
    cards.push(`<div class="stat-card">
      <div class="label">📄 曲师报告</div>
      <div class="value" style="color:#ec4899;">${(s.report && s.report.output_files) || 0}</div>
      <div class="sub">最新: ${(s.report && s.report.latest_file) || "(无)"}</div>
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
    // v1.5: 48h 内有新投稿 → 高亮标记
    const nowSec = Math.floor(Date.now() / 1000);
    const RECENT_WINDOW = 48 * 3600;
    box.innerHTML = subs.map(s => {
      const isPlaceholder = /^UID\d+$/.test(s.name || "");
      const displayName = isPlaceholder
        ? `<span style="color: var(--text-dim); font-style: italic;">${escapeHtml(s.name)}</span> <span class="badge warn" title="尚未拉取到真实用户名，请点顶部「刷新用户名」">未识别</span>`
        : escapeHtml(s.name);
      // 判断 48h 内是否有新投稿
      const isRecent = s.last_created_ts && (nowSec - s.last_created_ts) <= RECENT_WINDOW;
      const hoursAgo = s.last_created_ts ? Math.round((nowSec - s.last_created_ts) / 3600) : null;
      const recentBadge = isRecent
        ? `<span class="badge fresh" title="过去 48h 内的新投稿">🔥 ${hoursAgo}h 前</span>`
        : '';
      const itemClass = isRecent ? 'item item-recent' : 'item';
      return `
        <div class="${itemClass}">
          <div class="info">
            <div class="item-title">
              ${displayName}
              ${recentBadge}
              ${s.last_bvid ? `<a href="https://www.bilibili.com/video/${s.last_bvid}" target="_blank" class="badge success" style="text-decoration:none;">最新: ${s.last_bvid.slice(0, 12)}</a>` : ''}
            </div>
            <div class="item-sub">
              UID <a href="${s.space_url}" target="_blank">${s.uid}</a>
              · 最新投稿: ${s.last_created_fmt || '—'}
            </div>
          </div>
          <div class="item-actions">
            <button class="btn danger small" onclick="watchRemove(${s.uid})">删除</button>
          </div>
        </div>
      `;
    }).join("");
    loadSummary();
  } catch (e) {
    document.getElementById("watch-list").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

async function watchAdd() {
  const raw = document.getElementById("watch-input").value.trim();
  const name = document.getElementById("watch-name").value.trim();
  if (!raw) { toast("warn", "缺少输入", "请填 UP 主链接或 UID"); return; }
  try {
    const r = await api("/api/watch/subs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({uid_or_url: raw, name})
    });
    if (r.error) { toast("danger", "失败", r.error); return; }
    document.getElementById("watch-input").value = "";
    document.getElementById("watch-name").value = "";
    // 批量结果 toast
    if ((r.total || 0) > 1) {
      const parts = [`新增 <strong>${r.added}</strong>`];
      if (r.duplicates) parts.push(`重复 ${r.duplicates}`);
      if (r.errors) parts.push(`失败 ${r.errors}`);
      toast(r.errors ? "warn" : "success", `📥 批量添加完成 (${r.total})`, parts.join(" · "));
    } else if (r.added) {
      const item = (r.results || [])[0] || {};
      toast("success", "✓ 已添加", `UID ${item.uid || ""}`);
    } else if (r.duplicates) {
      toast("info", "已存在", "该 UP 已在订阅列表中");
    }
    loadWatch();
  } catch (e) { toast("danger", "失败", e.message); }
}

async function watchRemove(uid) {
  if (!confirm(`删除 UID ${uid} 的订阅？`)) return;
  await api(`/api/watch/subs/${uid}`, {method: "DELETE"});
  loadWatch();
}

/**
 * v1.4: 后台异步检查全部订阅。立刻返回，不阻塞界面。
 */
async function watchCheck() {
  requestNotifyPermission();
  try {
    const r = await api("/api/watch/check", {method: "POST"});
    if (r.error) { toast("danger", "启动失败", r.error); return; }
    if (r.job_id) {
      const secs = Math.round((r.subs_count || 1) * 8);
      toast(
        "info",
        "🔍 检查已开始",
        `<strong>${r.subs_count}</strong> 个订阅在后台运行中，预计约 ${secs}s 完成<br>你可以继续操作其他功能。`,
        6000,
      );
      pollBgJob(r.job_id, "watch-check");
    }
  } catch (e) {
    toast("danger", "启动失败", e.message);
  }
}

/**
 * v1.4: 刷新所有 UP 的真实 B 站用户名。异步后台。
 */
async function refreshWatchNames() {
  try {
    const r = await api("/api/watch/refresh-names", {method: "POST"});
    if (r.error) { toast("danger", "启动失败", r.error); return; }
    if (r.job_id) {
      toast("info", "🏷️ 正在拉取用户名",
        `后台运行中（约 ${Math.ceil(document.getElementById('watch-count').textContent * 0.5)}s）`,
        5000);
      pollBgJob(r.job_id, "refresh-names");
    }
  } catch (e) {
    toast("danger", "启动失败", e.message);
  }
}

/**
 * v1.4: 通用后台任务轮询器
 */
const _pollingBgJobs = new Set();
async function pollBgJob(jobId, kind) {
  if (_pollingBgJobs.has(jobId)) return;
  _pollingBgJobs.add(jobId);
  while (true) {
    try {
      await sleep(3000);
      const j = await api(`/api/jobs/${jobId}`);
      if (!j || j.status === "unknown") break;
      if (j.status === "done") {
        onBgJobDone(kind, j);
        break;
      }
      if (j.status === "failed") {
        toast("danger", "✗ 任务失败", escapeHtml((j.stderr || j.error || "").slice(0, 200) || "查看服务器日志"));
        break;
      }
    } catch (e) {
      console.error("poll bg err:", e);
      break;
    }
  }
  _pollingBgJobs.delete(jobId);
}

function onBgJobDone(kind, j) {
  if (kind === "watch-check") {
    const newVideos = j.new_videos || [];
    const errs = j.errors || [];
    if (newVideos.length > 0) {
      const list = newVideos.slice(0, 10).map(v => escapeHtml(v)).join("<br>");
      toast("success", `🎉 发现 ${newVideos.length} 个新稿件！`,
        list + (newVideos.length > 10 ? `<br>...还有 ${newVideos.length - 10} 条` : ""), 30000);
      notify("BiliWatch · 发现新稿件", `共 ${newVideos.length} 个新稿件`);
    } else {
      toast("info", "✓ 检查完成", `${j.subs_count} 个订阅均为最新，无新稿件`, 5000);
    }
    if (errs.length > 0) {
      toast("warn", `⚠️ ${errs.length} 个订阅采集失败`,
        errs.slice(0, 5).map(e => escapeHtml(e)).join("<br>") +
          (errs.length > 5 ? `<br>...还有 ${errs.length - 5} 条` : ""), 12000);
    }
    if (j.stdout) {
      showResult("watch-result", (j.stdout || "") + (j.stderr ? "\n---\nSTDERR:\n" + j.stderr : ""));
    }
    loadWatch();
  } else if (kind === "refresh-names") {
    toast("success", "🏷️ 用户名刷新完成",
      `更新 <strong>${j.updated}</strong> / ${j.total}` + (j.failed ? ` · 失败 ${j.failed}` : ""),
      8000);
    if (j.details && j.details.length > 0) {
      showResult("watch-result", "刷新用户名日志:\n" + j.details.join("\n"));
    }
    loadWatch();
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
  if (!bvid) { toast("warn", "缺少输入", "请填 bvid 或视频链接"); return; }
  const lineCount = bvid.split(/\r?\n/).filter(l => l.trim()).length;
  showLoading(lineCount > 1
    ? `正在批量添加 ${lineCount} 首曲目并采集基线（每首约 3-8s）...`
    : "正在添加追踪并采集基线...");
  try {
    const r = await api("/api/radar/tracks", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({bvid, note})
    });
    if (r.error) {
      toast("danger", "失败", r.error);
      return;
    }
    document.getElementById("radar-input").value = "";
    document.getElementById("radar-note").value = "";
    if ((r.total || 0) > 1) {
      const parts = [`新增 <strong>${r.added}</strong>`];
      if (r.duplicates) parts.push(`重复 ${r.duplicates}`);
      if (r.errors) parts.push(`失败 ${r.errors}`);
      toast(r.errors ? "warn" : "success", `📥 批量追踪完成 (${r.total})`, parts.join(" · "));
    } else if (r.added) {
      toast("success", "✓ 已开始追踪", escapeHtml(bvid));
    } else if (r.duplicates) {
      toast("info", "已在追踪", escapeHtml(bvid));
    } else if (r.errors) {
      const err = (r.results && r.results[0] && r.results[0].stderr) || "";
      toast("danger", "添加失败", escapeHtml(err.slice(0, 200) || "查看日志"));
    }
    loadRadar();
  } catch (e) {
    toast("danger", "失败", e.message);
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
    // 支持批量：后端会返回 jobs 数组
    const jobs = r.jobs || (r.job_id ? [{job_id: r.job_id, bvid}] : []);
    if (jobs.length === 0) {
      toast("warn", "未创建任务", "请检查输入");
      return;
    }
    if (jobs.length > 1) {
      toast(
        "info",
        `🚀 ${jobs.length} 个任务已提交`,
        `全部在后台并发运行，完成会一个个弹出。<br>你可以继续操作其他功能。`,
        8000,
      );
    } else {
      toast(
        "info",
        "🚀 任务已提交",
        `<strong>${escapeHtml(jobs[0].bvid)}</strong> 后台运行中，你可以继续操作其他功能。<br>完成后会弹出提示。`,
      );
    }
    for (const j of jobs) {
      pollCommentJob(j.job_id, j.bvid);
    }
    loadCommentJobs();
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
    box.innerHTML = files.slice(0, 30).map(f => `
      <div class="item">
        <div class="info">
          <div class="item-title">${escapeHtml(f.name)}</div>
          <div class="item-sub">${f.size_kb} KB · 生成于 ${f.mtime}</div>
        </div>
        <div class="item-actions">
          <a class="btn primary small" href="/api/comments/download/${encodeURIComponent(f.name)}" target="_blank">📥 下载</a>
          <button class="btn danger small" onclick="deleteCommentOutput('${f.name.replace(/'/g, "\\'")}')">🗑 删除</button>
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

/**
 * 删除评论输出的 XLSX 文件
 */
async function deleteCommentOutput(filename) {
  if (!confirm(`🗑 删除文件 ${filename}？\n\n此操作不可恢复！`)) return;
  try {
    const r = await api(`/api/comments/download/${encodeURIComponent(filename)}`, {method: "DELETE"});
    if (r.ok) {
      toast("success", "🗑 已删除", escapeHtml(filename));
      loadCommentsOutputs();
      loadSummary();
    } else {
      toast("danger", "删除失败", r.error || "");
    }
  } catch (e) {
    toast("danger", "删除失败", e.message);
  }
}

// ============================================================================
// v1.6 · Creator Report
// ============================================================================
async function reportGenerate() {
  const raw = document.getElementById("report-uid").value.trim();
  if (!raw) { toast("warn", "缺少 UID", "请填曲师 UID（一行一个）"); return; }
  requestNotifyPermission();

  const payload = {
    uid: raw,
    videos_limit: parseInt(document.getElementById("report-videos").value) || 15,
    months: document.getElementById("report-months").value || null,
  };
  try {
    const r = await api("/api/report/generate", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    if (r.error) { toast("danger", "提交失败", r.error); return; }
    const jobs = r.jobs || [];
    if (jobs.length === 0) { toast("warn", "未创建任务", "请检查输入"); return; }

    if (jobs.length > 1) {
      toast("info", `🚀 ${jobs.length} 份报告已提交`,
        `全部后台并发生成，完成会一个个弹出。<br>你可以继续操作其他功能。`, 8000);
    } else {
      const j = jobs[0];
      toast("info", "🚀 报告生成中",
        `<strong>${escapeHtml(j.name)}</strong> (UID ${j.uid})<br>约 30-90 秒后弹出通知`, 6000);
    }
    for (const j of jobs) {
      pollReportJob(j.job_id, j.uid, j.name);
    }
    loadReportJobs();
    document.getElementById("report-uid").value = "";
  } catch (e) {
    toast("danger", "提交失败", e.message);
  }
}

const _pollingReportJobs = new Set();
async function pollReportJob(jobId, uid, name) {
  if (_pollingReportJobs.has(jobId)) return;
  _pollingReportJobs.add(jobId);
  while (true) {
    try {
      await sleep(4000);
      const j = await api(`/api/jobs/${jobId}`);
      if (!j || j.status === "unknown") break;
      loadReportJobs();
      if (j.status === "done") {
        const filename = j.output_file ? j.output_file.split(/[\\/]/).pop() : null;
        toast("success", "✓ 报告已生成",
          `<strong>${escapeHtml(name)}</strong> (UID ${uid})<br>` +
          (filename
            ? `<a href="/api/report/download/${encodeURIComponent(filename)}" target="_blank" class="btn primary small" style="margin-top:6px;">🌐 在浏览器打开</a>`
            : ""),
          25000);
        notify(`✓ 曲师报告已生成 · ${name}`, filename || "");
        loadReportOutputs();
        loadSummary();
        break;
      }
      if (j.status === "failed") {
        toast("danger", `✗ ${escapeHtml(name)} 报告生成失败`,
          escapeHtml((j.stderr || j.error || "").slice(0, 200)) || "查看服务器日志",
          20000);
        break;
      }
    } catch (e) {
      console.error("poll report job err:", e);
      break;
    }
  }
  _pollingReportJobs.delete(jobId);
}

async function resumePollingReportJobs() {
  try {
    const jobs = await api("/api/jobs");
    for (const j of (jobs || [])) {
      if (j.kind === "creator-report" && (j.status === "queued" || j.status === "running")) {
        pollReportJob(j.id, j.uid, j.name || `UID${j.uid}`);
      }
    }
  } catch (e) { /* ignore */ }
}

async function loadReportJobs() {
  try {
    const jobs = await api("/api/jobs");
    const reportJobs = (jobs || []).filter(j => j.kind === "creator-report").slice(0, 8);
    const box = document.getElementById("report-jobs");
    if (!box) return;
    if (reportJobs.length === 0) {
      box.innerHTML = '<div class="empty">暂无任务。填入 UID 后点「开始生成」即可。</div>';
      return;
    }
    box.innerHTML = reportJobs.map(j => {
      const statusText = ({queued:"排队中",running:"运行中",done:"已完成",failed:"失败"})[j.status] || j.status;
      const dur = j.duration_sec ? `${j.duration_sec}s` : '';
      let action = '';
      if (j.output_file) {
        const fn = j.output_file.split(/[\\/]/).pop();
        action = `<a class="btn primary small" href="/api/report/download/${encodeURIComponent(fn)}" target="_blank">🌐 打开</a>`;
      }
      return `
        <div class="item">
          <div class="info">
            <div class="item-title">
              <span class="job-status ${j.status}">${statusText}</span>
              ${escapeHtml(j.name || 'UID' + j.uid)}
            </div>
            <div class="item-sub">
              UID ${j.uid} · ${j.videos_limit || 15} 首 · 开始 ${j.started_at_fmt || fmt_ts(j.started_at)}
              ${j.finished_at_fmt ? ` · 用时 ${dur}` : ` · 已跑 ${dur}`}
            </div>
          </div>
          <div class="item-actions">${action}</div>
        </div>
      `;
    }).join("");
  } catch (e) {
    document.getElementById("report-jobs").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

async function loadReportOutputs() {
  try {
    const files = await api("/api/report/list");
    const box = document.getElementById("report-outputs");
    if (!box) return;
    if ((files || []).length === 0) {
      box.innerHTML = '<div class="empty">暂无报告。填入 UID 后点「开始生成」即可。</div>';
      return;
    }
    box.innerHTML = files.slice(0, 30).map(f => `
      <div class="item">
        <div class="info">
          <div class="item-title">${escapeHtml(f.creator_name || f.name)}</div>
          <div class="item-sub">
            ${f.uid ? `UID ${f.uid} · ` : ''}${f.size_kb} KB · 生成于 ${f.mtime}
          </div>
        </div>
        <div class="item-actions">
          <a class="btn primary small" href="/api/report/download/${encodeURIComponent(f.name)}" target="_blank">🌐 打开</a>
          <button class="btn danger small" onclick="deleteReport('${f.name.replace(/'/g, "\\'")}')">🗑</button>
        </div>
      </div>
    `).join("");
  } catch (e) {
    document.getElementById("report-outputs").innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

async function deleteReport(filename) {
  if (!confirm(`🗑 删除报告 ${filename}？\n\n此操作不可恢复！`)) return;
  try {
    const r = await api(`/api/report/download/${encodeURIComponent(filename)}`, {method: "DELETE"});
    if (r.ok) {
      toast("success", "🗑 已删除", escapeHtml(filename));
      loadReportOutputs();
      loadSummary();
    } else {
      toast("danger", "删除失败", r.error || "");
    }
  } catch (e) {
    toast("danger", "删除失败", e.message);
  }
}

/**
 * 从订阅列表快速填入 UID
 */
async function openWatchPicker() {
  try {
    const subs = await api("/api/watch/subs");
    if (!subs || subs.length === 0) {
      toast("warn", "无订阅", "请先到 UP 主监控 tab 添加订阅");
      return;
    }
    const lines = subs.map(s => s.uid).join("\n");
    document.getElementById("report-uid").value = lines;
    toast("info", `📋 已填入 ${subs.length} 个 UID`,
      "点「开始生成」即可批量为全部签约曲师生成报告", 5000);
  } catch (e) {
    toast("danger", "读取订阅失败", e.message);
  }
}

function fmt_ts(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN');
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
