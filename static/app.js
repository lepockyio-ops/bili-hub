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
  if (["home", "watch", "radar", "comments", "report", "piracy"].includes(hash)) {
    switchTab(hash);
  }
  loadSummary();
  loadMemo();
  loadWatch();
  loadRadar();
  loadCommentsOutputs();
  loadCommentJobs();
  loadSessdataStatus();
  loadReportOutputs();
  loadReportJobs();
  loadPiracyList();
  loadSchedulerStatus();
  // 恢复未完成的 job 轮询（例如页面刷新后）
  resumePollingRunningJobs();
  resumePollingReportJobs();
  resumeActiveProgress();
  // 调度器状态每 15s 自动刷新
  setInterval(loadSchedulerStatus, 15000);
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
// ============================================================================
// v1.9: 备忘录（首页）
// ============================================================================
let _memoDirty = false;
let _memoLastSaved = "";

async function loadMemo() {
  try {
    const m = await api("/api/memo");
    const ta = document.getElementById("memo-content");
    if (!ta) return;
    ta.value = m.content || "";
    _memoLastSaved = ta.value;
    _memoDirty = false;
    updateMemoStatus(m.updated_at_fmt ? `已加载 · 最后保存 ${m.updated_at_fmt}` : "尚未保存过");
    // 监听变更
    ta.oninput = () => {
      _memoDirty = ta.value !== _memoLastSaved;
      if (_memoDirty) updateMemoStatus("⚠️ 有未保存的修改");
    };
  } catch (e) {
    updateMemoStatus(`加载失败: ${e.message}`);
  }
}

async function saveMemo() {
  const ta = document.getElementById("memo-content");
  if (!ta) return;
  const content = ta.value;
  try {
    const r = await api("/api/memo", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({content})
    });
    if (r.error) { toast("danger", "保存失败", r.error); return; }
    _memoLastSaved = content;
    _memoDirty = false;
    updateMemoStatus(`✓ 已保存 · ${r.updated_at_fmt} · ${r.length} 字`);
    toast("success", "💾 备忘录已保存", `${r.length} 字`, 3000);
  } catch (e) {
    toast("danger", "保存失败", e.message);
  }
}

function updateMemoStatus(text) {
  const el = document.getElementById("memo-status");
  if (el) el.textContent = text;
}

// 页面离开前提示未保存
window.addEventListener("beforeunload", (e) => {
  if (_memoDirty) {
    e.preventDefault();
    e.returnValue = "备忘录有未保存的修改，确定离开？";
  }
});

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
      <div class="label">📄 UP 主月报告</div>
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
    // v2.5: 72h 内有新投稿 → 高亮标记
    const nowSec = Math.floor(Date.now() / 1000);
    const RECENT_WINDOW = 72 * 3600;
    box.innerHTML = subs.map(s => {
      const isPlaceholder = /^UID\d+$/.test(s.name || "");
      const displayName = isPlaceholder
        ? `<span style="color: var(--text-dim); font-style: italic;">${escapeHtml(s.name)}</span> <span class="badge warn" title="尚未拉取到真实用户名，请点顶部「刷新用户信息」">未识别</span>`
        : escapeHtml(s.name);
      const isRecent = s.last_created_ts && (nowSec - s.last_created_ts) <= RECENT_WINDOW;
      const hoursAgo = s.last_created_ts ? Math.round((nowSec - s.last_created_ts) / 3600) : null;
      const recentBadge = isRecent
        ? `<span class="badge fresh" title="过去 72h 内的新投稿">🔥 ${hoursAgo}h 前</span>`
        : '';
      const itemClass = isRecent ? 'item item-recent' : 'item';

      // v2.3: 每位 UP 都显示 4 大字段（未填充时显示 —）
      const hasAnyStat = s.fans != null || s.video_count != null || s.avg_view != null || s.avg_like != null;
      const statsLine = `
        <div class="creator-stats">
          <span class="stat-chip" title="总粉丝数">👥 粉丝 <strong>${s.fans != null ? fmtNum(s.fans) : '—'}</strong></span>
          <span class="stat-chip" title="总投稿视频数">🎬 视频 <strong>${s.video_count != null ? s.video_count : '—'}</strong></span>
          <span class="stat-chip" title="近期作品平均播放">▶ 均播 <strong>${s.avg_view != null ? fmtNum(s.avg_view) : '—'}</strong></span>
          <span class="stat-chip" title="近期作品平均点赞">❤ 均赞 <strong>${s.avg_like != null ? fmtNum(s.avg_like) : '—'}</strong></span>
          ${!hasAnyStat ? '<span class="hint" style="padding:0;">→ 点顶部「🏷️ 刷新用户信息」填充</span>' : ''}
        </div>
      `;

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
            ${statsLine}
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

/**
 * v2.2: 全部订阅总览面板 - 聚合 4 个 KPI + 48h 新投稿数
 */
function renderWatchSummary(subs) {
  const panel = document.getElementById("watch-summary-panel");
  if (!panel) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const RECENT = 48 * 3600;

  // 聚合
  const withStats = subs.filter(s => s.fans != null || s.video_count != null);
  let totalFans = 0, totalVideos = 0, sumAvgView = 0, sumAvgLike = 0;
  let cntView = 0, cntLike = 0;
  for (const s of withStats) {
    if (s.fans != null) totalFans += s.fans;
    if (s.video_count != null) totalVideos += s.video_count;
    if (s.avg_view != null) { sumAvgView += s.avg_view; cntView++; }
    if (s.avg_like != null) { sumAvgLike += s.avg_like; cntLike++; }
  }
  const avgViewAcross = cntView > 0 ? Math.round(sumAvgView / cntView) : null;
  const avgLikeAcross = cntLike > 0 ? Math.round(sumAvgLike / cntLike) : null;
  const recentCount = subs.filter(s => s.last_created_ts && (nowSec - s.last_created_ts) <= RECENT).length;

  if (withStats.length === 0) {
    panel.innerHTML = `
      <div class="stat-card" style="grid-column: 1 / -1; text-align: center;">
        <div class="label">⚠️ 未拉取到统计数据</div>
        <div class="value" style="font-size: 14px; color: var(--warn);">请点上方「🏷️ 刷新用户信息」按钮</div>
        <div class="sub">首次约 1-2 分钟，之后本地缓存</div>
      </div>
    `;
    return;
  }

  panel.innerHTML = `
    <div class="stat-card">
      <div class="label">👥 合计粉丝</div>
      <div class="value">${fmtNum(totalFans)}</div>
      <div class="sub">${withStats.length}/${subs.length} 位 UP 有数据</div>
    </div>
    <div class="stat-card">
      <div class="label">🎬 合计视频</div>
      <div class="value success">${fmtNum(totalVideos)}</div>
      <div class="sub">全平台历史累计</div>
    </div>
    <div class="stat-card">
      <div class="label">▶ 平均播放（人均）</div>
      <div class="value">${avgViewAcross != null ? fmtNum(avgViewAcross) : '—'}</div>
      <div class="sub">每位 UP 的均播再平均</div>
    </div>
    <div class="stat-card">
      <div class="label">❤ 平均点赞（人均）</div>
      <div class="value">${avgLikeAcross != null ? fmtNum(avgLikeAcross) : '—'}</div>
      <div class="sub">${cntLike === 0 ? '暂未采集' : '每位 UP 均赞再平均'}</div>
    </div>
    <div class="stat-card">
      <div class="label">🔥 48h 内新投稿</div>
      <div class="value warn">${recentCount}</div>
      <div class="sub">下方橙色高亮的 UP</div>
    </div>
  `;
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
        `<strong>${r.subs_count}</strong> 个订阅在后台运行中，预计约 ${secs}s 完成<br>右下角进度条可查看状态。`,
        6000,
      );
      pollBgJob(r.job_id, "watch-check");
      trackProgressJob(r.job_id);  // v2.4: 右下角进度浮层
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
      toast("info", "🏷️ 正在拉取用户信息",
        `后台运行 · 右下角进度条可查看当前处理哪位曲师`,
        5000);
      pollBgJob(r.job_id, "refresh-names");
      trackProgressJob(r.job_id);  // v2.4
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
    // v2.2: 强化反馈 —— 无论有无新稿件都强提示 + 展示 stdout
    const summary = `检查完毕 · 订阅 ${j.subs_count || '?'} 位 · 新稿件 ${newVideos.length} 个 · 错误 ${errs.length} 个`;
    if (newVideos.length > 0) {
      const list = newVideos.slice(0, 10).map(v => escapeHtml(v)).join("<br>");
      toast("success", `🎉 发现 ${newVideos.length} 个新稿件！`,
        list + (newVideos.length > 10 ? `<br>...还有 ${newVideos.length - 10} 条` : ""), 30000);
      notify("BiliWatch · 发现新稿件", `共 ${newVideos.length} 个新稿件`);
    } else {
      // v2.2 改进：无新稿件时也醒目提示（用户之前反馈"不反映结果"）
      toast("success", `✓ ${summary}`,
        `所有订阅都是最新，暂无新稿件 · 下方列表已刷新最新数据`, 8000);
    }
    if (errs.length > 0) {
      toast("warn", `⚠️ ${errs.length} 个订阅采集失败`,
        errs.slice(0, 5).map(e => escapeHtml(e)).join("<br>") +
          (errs.length > 5 ? `<br>...还有 ${errs.length - 5} 条` : ""), 12000);
    }
    // 始终显示结果面板
    const resultText = `【${summary}】\n\n` + (j.stdout || "") + (j.stderr ? "\n---\nSTDERR:\n" + j.stderr : "");
    showResult("watch-result", resultText);
    loadWatch();  // 刷新列表反映新时间戳/bvid
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
// v1.7: 内置调度器控制
// ============================================================================
let _schedulerCache = null;

async function loadSchedulerStatus() {
  try {
    const s = await api("/api/scheduler/status");
    _schedulerCache = s;
    const box = document.getElementById("scheduler-status");
    if (!box) return;

    const enabled = s.enabled;
    const badgeCls = enabled ? "on" : "off";
    const badgeText = enabled ? "已启用" : "已关闭";

    let nextStr = "—";
    if (enabled && s.next_run_at) {
      const secs = s.next_run_in_sec || 0;
      if (secs <= 0) {
        nextStr = `<span class="countdown">即将运行</span>`;
      } else if (secs < 60) {
        nextStr = `<span class="countdown">${secs}s 后</span>`;
      } else if (secs < 3600) {
        nextStr = `<span class="countdown">${Math.floor(secs/60)}m ${secs%60}s 后</span> · ${s.next_run_at_fmt}`;
      } else {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        nextStr = `<span class="countdown">${h}h ${m}m 后</span> · ${s.next_run_at_fmt}`;
      }
    }

    box.className = "scheduler-status " + (enabled ? "" : "disabled");
    let lastRun = "";
    if (s.last_run_at) {
      const rc = s.last_result?.returncode;
      const ok = rc === 0 ? "✓" : "✗";
      lastRun = `<div class="kv">上次运行 <strong>${s.last_run_at_fmt}</strong> ${ok} · 累计跑了 <strong>${s.run_count || 0}</strong> 次</div>`;
    }
    box.innerHTML = `
      <div class="kv">状态 <span class="status-badge ${badgeCls}">${badgeText}</span></div>
      <div class="kv">周期 <strong>${s.interval_hours} 小时</strong></div>
      <div class="kv">下次 ${nextStr}</div>
      ${lastRun}
    `;

    // 同步 UI 控件
    const sel = document.getElementById("scheduler-interval");
    if (sel && parseInt(sel.value) !== s.interval_hours) {
      sel.value = String(s.interval_hours);
    }
    const btn = document.getElementById("scheduler-toggle-btn");
    if (btn) {
      btn.textContent = enabled ? "⏸ 关闭自动采集" : "▶️ 启用自动采集";
      btn.className = enabled ? "btn" : "btn primary";
    }
  } catch (e) {
    const box = document.getElementById("scheduler-status");
    if (box) box.innerHTML = `<span style="color: var(--danger);">状态加载失败: ${e.message}</span>`;
  }
}

async function schedulerToggle() {
  const current = _schedulerCache?.enabled ?? true;
  try {
    await api("/api/scheduler/config", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({enabled: !current})
    });
    toast(!current ? "success" : "info",
      !current ? "▶️ 自动采集已启用" : "⏸ 自动采集已关闭",
      !current ? "下次将按周期自动跑 collect" : "关闭后不再自动执行 collect");
    loadSchedulerStatus();
  } catch (e) { toast("danger", "操作失败", e.message); }
}

async function schedulerSetInterval() {
  const hours = parseInt(document.getElementById("scheduler-interval").value);
  try {
    await api("/api/scheduler/config", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({interval_hours: hours})
    });
    toast("info", "⏰ 周期已更新", `每 ${hours} 小时自动采集一次`);
    loadSchedulerStatus();
  } catch (e) { toast("danger", "操作失败", e.message); }
}

async function schedulerTrigger() {
  try {
    const r = await api("/api/scheduler/trigger", {method: "POST"});
    toast("info", "⚡ 已触发", "10 秒内会开始 collect，稍后刷新看板查看新数据点");
    loadSchedulerStatus();
    // 30 秒后再刷新一次，让"上次运行"更新
    setTimeout(() => { loadSchedulerStatus(); loadRadar(); }, 40000);
  } catch (e) { toast("danger", "触发失败", e.message); }
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
      trackProgressJob(j.job_id, `💬 抓取评论 · ${j.bvid}`);  // v2.4
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

// ============================================================================
// v2.4: 后台任务进度浮层
// ============================================================================
const KIND_LABELS = {
  "watch-check": "🔍 检查订阅",
  "watch-refresh-names": "🏷️ 刷新用户信息",
  "piracy-scan": "🛡️ 侵权扫描",
  "creator-report": "📄 生成月报告",
  "comments-extract": "💬 抓取评论",
};
const _trackedJobs = new Set();

function trackProgressJob(jobId, titleOverride) {
  if (_trackedJobs.has(jobId)) return;
  _trackedJobs.add(jobId);
  _pollJobProgress(jobId, titleOverride);
}

async function _pollJobProgress(jobId, titleOverride) {
  const tray = document.getElementById("progress-tray");
  if (!tray) return;
  let card = document.getElementById("prog-" + jobId);
  if (!card) {
    card = document.createElement("div");
    card.className = "progress-card";
    card.id = "prog-" + jobId;
    tray.appendChild(card);
  }
  const startedAt = Math.floor(Date.now() / 1000);

  while (true) {
    try {
      const j = await api(`/api/jobs/${jobId}`);
      if (!j || j.status === "unknown") {
        removeProgressCard(jobId);
        break;
      }
      const cur = j.progress_current || 0;
      const tot = j.progress_total || 0;
      const msg = j.progress_message || "";
      const elapsed = (j.duration_sec != null) ? j.duration_sec :
                      (Math.floor(Date.now() / 1000) - startedAt);
      const title = titleOverride
        || (j.name ? `${KIND_LABELS[j.kind] || j.kind} · ${j.name}` : (KIND_LABELS[j.kind] || j.kind));
      const pct = (tot > 0) ? Math.min(100, Math.round(cur / tot * 100)) : null;
      renderProgressCard(card, {
        title, status: j.status, current: cur, total: tot, pct,
        message: msg, elapsed, kind: j.kind, jobId
      });
      if (j.status === "done" || j.status === "failed") {
        // 3 秒后自动淡出
        setTimeout(() => removeProgressCard(jobId), 3500);
        break;
      }
    } catch (e) {
      console.error("progress poll err:", e);
      break;
    }
    await sleep(2000);
  }
}

function renderProgressCard(card, s) {
  card.classList.remove("done", "failed");
  if (s.status === "done") card.classList.add("done");
  else if (s.status === "failed") card.classList.add("failed");

  const barInner = (s.pct != null)
    ? `<div class="progress-bar-inner" style="width: ${s.pct}%;"></div>`
    : `<div class="progress-bar-inner indeterminate"></div>`;
  const statusText = ({queued: "排队中", running: "运行中", done: "已完成", failed: "失败"})[s.status] || s.status;
  const pctText = s.pct != null ? ` · ${s.pct}%` : '';
  const countText = (s.current && s.total) ? `${s.current} / ${s.total}` : '';

  card.innerHTML = `
    <div class="progress-header">
      <div class="progress-title">${escapeHtml(s.title)}</div>
      <button class="progress-close" onclick="removeProgressCard('${s.jobId}')" title="关闭">×</button>
    </div>
    <div class="progress-bar-outer">${barInner}</div>
    <div class="progress-msg">${s.message ? escapeHtml(s.message) : (statusText + (countText ? ` · ${countText}` : ''))}</div>
    <div class="progress-meta">
      <span>${statusText}${pctText}</span>
      <span>⏱ ${s.elapsed}s</span>
    </div>
  `;
}

function removeProgressCard(jobId) {
  _trackedJobs.delete(jobId);
  const card = document.getElementById("prog-" + jobId);
  if (!card) return;
  card.classList.add("exiting");
  setTimeout(() => card.remove(), 300);
}

// 页面加载时恢复正在运行的进度
async function resumeActiveProgress() {
  try {
    const jobs = await api("/api/jobs/active");
    for (const j of (jobs || [])) {
      trackProgressJob(j.id);
    }
  } catch (e) { /* ignore */ }
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
    videos_limit: 30,  // v2.0 固定 30，不再让用户选
    months: document.getElementById("report-months").value || null,
    language: document.getElementById("report-language").value || "both",
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
      trackProgressJob(j.job_id, `📄 月报告 · ${j.name}`);  // v2.4
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
 * v2.0: 弹窗形式选择要生成报告的 UP 主（复选）
 */
async function openReportPicker() {
  try {
    const subs = await api("/api/watch/subs");
    if (!subs || subs.length === 0) {
      toast("warn", "无订阅", "请先到 UP 主监控 tab 添加订阅");
      return;
    }
    showReportPickerModal(subs);
  } catch (e) {
    toast("danger", "读取订阅失败", e.message);
  }
}

function showReportPickerModal(subs) {
  // 移除已存在的
  const old = document.getElementById("report-picker-modal");
  if (old) old.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.id = "report-picker-modal";
  backdrop.onclick = (e) => { if (e.target === backdrop) closeReportPicker(); };

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.onclick = (e) => e.stopPropagation();

  modal.innerHTML = `
    <div class="modal-title">📋 选择要生成报告的 UP 主 · 共 ${subs.length} 位</div>
    <div class="form-row" style="margin-bottom: 10px; align-items: center;">
      <button class="btn small" onclick="reportPickerSelectAll(true)">✓ 全选</button>
      <button class="btn small" onclick="reportPickerSelectAll(false)">✗ 清空</button>
      <input type="text" id="report-picker-search" placeholder="搜索曲师名或 UID..." oninput="reportPickerFilter()" style="flex:1;">
    </div>
    <div class="modal-body" id="report-picker-list">
      ${subs.map(s => `
        <label class="modal-creator-item" data-search="${escapeHtml((s.name||'') + ' ' + s.uid)}">
          <input type="checkbox" value="${s.uid}" class="report-picker-cb">
          <div class="name">${escapeHtml(s.name)}</div>
          <div class="uid">UID ${s.uid}</div>
        </label>
      `).join("")}
    </div>
    <div class="modal-footer">
      <span class="hint" id="report-picker-count" style="padding: 0; margin-right: auto;">已选 0 位</span>
      <button class="btn" onclick="closeReportPicker()">取消</button>
      <button class="btn primary" onclick="reportPickerConfirm()">➕ 添加选中项</button>
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // 监听勾选数量变化
  modal.querySelectorAll(".report-picker-cb").forEach(cb => {
    cb.onchange = updateReportPickerCount;
  });
}

function reportPickerSelectAll(checked) {
  document.querySelectorAll("#report-picker-list .modal-creator-item:not([style*='display: none']) .report-picker-cb")
    .forEach(cb => cb.checked = checked);
  updateReportPickerCount();
}

function reportPickerFilter() {
  const q = document.getElementById("report-picker-search").value.trim().toLowerCase();
  document.querySelectorAll("#report-picker-list .modal-creator-item").forEach(el => {
    const s = el.dataset.search.toLowerCase();
    el.style.display = (!q || s.includes(q)) ? "flex" : "none";
  });
}

function updateReportPickerCount() {
  const n = document.querySelectorAll("#report-picker-list .report-picker-cb:checked").length;
  const el = document.getElementById("report-picker-count");
  if (el) el.textContent = `已选 ${n} 位`;
}

function reportPickerConfirm() {
  const uids = Array.from(
    document.querySelectorAll("#report-picker-list .report-picker-cb:checked")
  ).map(cb => cb.value);
  if (uids.length === 0) {
    toast("warn", "未选择", "请至少勾选 1 位曲师");
    return;
  }
  const existing = (document.getElementById("report-uid").value || "").trim();
  const merged = [...new Set([...(existing ? existing.split(/\s+/) : []), ...uids])];
  document.getElementById("report-uid").value = merged.join("\n");
  closeReportPicker();
  toast("info", `📋 已添加 ${uids.length} 位到输入框`, "点「🚀 开始生成」即可批量生成", 4000);
}

function closeReportPicker() {
  const m = document.getElementById("report-picker-modal");
  if (m) m.remove();
}

// 旧的兼容名（避免其他地方引用出错）
async function openWatchPicker() { return openReportPicker(); }

function fmt_ts(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

// ============================================================================
// v2.1: SESSDATA 管理
// ============================================================================
async function loadSessdataStatus() {
  const box = document.getElementById("sessdata-status");
  if (!box) return;
  box.innerHTML = '<span class="subtle">检测中...</span>';
  try {
    const s = await api("/api/sessdata/status");
    if (!s.configured) {
      box.innerHTML = `
        <div class="alert warn" style="margin: 0;">
          <strong>未设置 SESSDATA</strong><br>
          评论收集只能抓 3-5 条热门评论 · 无法抓全量
        </div>`;
      return;
    }
    const d = s.detail || {};
    if (s.valid) {
      const vipBadge = d.vip ? '<span class="badge success" style="margin-left:8px;">大会员</span>' : '';
      box.innerHTML = `
        <div class="alert success" style="margin: 0;">
          <strong>✓ SESSDATA 有效</strong> ${vipBadge}<br>
          账号：<strong>${escapeHtml(d.uname || '')}</strong> · UID ${d.mid || '-'} · Lv${d.level || 0}<br>
          <span class="subtle">已保存 ${s.length || 0} 字符 · 前缀 <code>${escapeHtml(s.masked || '')}</code></span>
        </div>`;
    } else {
      box.innerHTML = `
        <div class="alert danger" style="margin: 0;">
          <strong>✗ SESSDATA 已失效</strong>（${escapeHtml(d.reason || '未登录')}）<br>
          <span class="subtle">前缀 <code>${escapeHtml(s.masked || '')}</code> · 长度 ${s.length}</span><br>
          请到 B 站重新登录后拿新的 SESSDATA 填入下方
        </div>`;
    }
  } catch (e) {
    box.innerHTML = `<div class="alert danger">状态检查失败: ${e.message}</div>`;
  }
}

async function saveSessdata() {
  const ta = document.getElementById("sessdata-input");
  const val = (ta?.value || "").trim();
  if (!val) { toast("warn", "缺少输入", "请粘贴 SESSDATA"); return; }
  if (val.length < 20) {
    toast("warn", "疑似格式错误", `SESSDATA 长度通常 > 100 字符，你只输入了 ${val.length} 字符`);
    return;
  }
  showLoading("测试中（正在向 B 站验证）...");
  try {
    // 用 /api/sessdata/save（后端已实现）
    const r = await api("/api/sessdata/save", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({sessdata: val})
    });
    if (r.error) {
      toast("danger", "保存失败", r.error, 15000);
      return;
    }
    ta.value = "";
    const d = r.detail || {};
    if (d.valid) {
      toast("success", "✓ SESSDATA 已保存",
        `账号：<strong>${escapeHtml(d.uname || '')}</strong> · UID ${d.mid} · Lv${d.level || 0}<br>` +
        `现在评论收集可以抓全量评论了`, 8000);
    } else {
      toast("warn", "已保存但未通过验证",
        `原因: ${escapeHtml(d.reason || '未登录')}<br>可能需要更新一次`, 12000);
    }
    loadSessdataStatus();
  } catch (e) {
    toast("danger", "保存失败", e.message);
  } finally {
    hideLoading();
  }
}

async function clearSessdata() {
  if (!confirm("🗑 确定清除 SESSDATA？\n\n清除后评论收集只能抓 3-5 条热门评论。")) return;
  try {
    await api("/api/sessdata", {method: "DELETE"});
    toast("info", "已清除 SESSDATA", "评论收集现在处于匿名模式");
    loadSessdataStatus();
  } catch (e) { toast("danger", "清除失败", e.message); }
}

// ============================================================================
// v2.1: SESSDATA 设置
// ============================================================================
async function loadSessdataStatus() {
  const badge = document.getElementById("sessdata-badge");
  const info = document.getElementById("sessdata-info");
  if (!badge || !info) return;
  try {
    const s = await api("/api/sessdata/status");
    if (!s.configured) {
      badge.className = "status-badge off";
      badge.textContent = "未配置";
      info.className = "scheduler-status disabled";
      info.innerHTML = `
        <div class="kv">${escapeHtml(s.message || "未配置 SESSDATA")}</div>
        <div class="kv" style="color: var(--warn);">⚠️ 未登录时 B 站只返回 3 条热门评论</div>
      `;
    } else if (s.valid) {
      badge.className = "status-badge on";
      badge.textContent = "有效";
      const d = s.detail || {};
      info.className = "scheduler-status running";
      info.innerHTML = `
        <div class="kv">当前值 <strong>${escapeHtml(s.masked)}</strong> (${s.length} 字符)</div>
        <div class="kv">用户 <strong>${escapeHtml(d.uname || "")}</strong> (UID ${d.mid || "—"})</div>
        <div class="kv">Lv ${d.level || 0} ${d.vip ? "· 大会员" : ""}</div>
      `;
    } else {
      badge.className = "status-badge off";
      badge.textContent = "已失效";
      info.className = "scheduler-status";
      info.innerHTML = `
        <div class="kv" style="color: var(--danger);">⚠️ ${escapeHtml((s.detail || {}).reason || "SESSDATA 已过期")}</div>
        <div class="kv">当前值 <strong>${escapeHtml(s.masked)}</strong> (${s.length} 字符)</div>
        <div class="kv">请到 bilibili.com 重新登录后复制新的 SESSDATA 粘贴保存</div>
      `;
    }
  } catch (e) {
    info.innerHTML = `<span style="color: var(--danger);">加载失败: ${e.message}</span>`;
  }
}

async function sessdataTest() {
  const val = document.getElementById("sessdata-input").value.trim();
  if (!val) { toast("warn", "请先粘贴 SESSDATA", ""); return; }
  showLoading("测试中...");
  try {
    const r = await api("/api/sessdata/test", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({sessdata: val})
    });
    hideLoading();
    if (r.valid) {
      toast("success", "✓ SESSDATA 有效",
        `用户 <strong>${escapeHtml(r.uname || "")}</strong> (UID ${r.mid}) · Lv ${r.level} ${r.vip ? "· 大会员" : ""}`,
        8000);
    } else {
      toast("danger", "✗ SESSDATA 无效", escapeHtml(r.reason || "未知原因"), 10000);
    }
  } catch (e) {
    hideLoading();
    toast("danger", "测试失败", e.message);
  }
}

async function sessdataSave() {
  const val = document.getElementById("sessdata-input").value.trim();
  if (!val) { toast("warn", "请先粘贴 SESSDATA", ""); return; }
  if (val.length < 30) {
    if (!confirm("SESSDATA 长度看起来不对（少于 30 字符）。仍要保存吗？")) return;
  }
  showLoading("保存中...");
  try {
    const r = await api("/api/sessdata/save", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({sessdata: val})
    });
    hideLoading();
    if (r.error) { toast("danger", "保存失败", r.error); return; }
    const d = r.detail || {};
    if (d.valid) {
      toast("success", "💾 已保存 · 凭证有效",
        `用户 <strong>${escapeHtml(d.uname || "")}</strong> (UID ${d.mid}) · 下次评论收集立即生效`,
        10000);
    } else {
      toast("warn", "💾 已保存 · 但凭证无效",
        `原因: ${escapeHtml(d.reason || "")}<br>建议重新登录 B 站获取新 SESSDATA`,
        15000);
    }
    document.getElementById("sessdata-input").value = "";
    loadSessdataStatus();
  } catch (e) {
    hideLoading();
    toast("danger", "保存失败", e.message);
  }
}

function sessdataToggleShow() {
  const input = document.getElementById("sessdata-input");
  const btn = document.getElementById("sessdata-toggle");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "🙈 隐藏";
  } else {
    input.type = "password";
    btn.textContent = "👁 显示";
  }
}


// ============================================================================
// v1.8: BiliAntiPiracy 侵权监测
// ============================================================================
const _expandedPiracyRows = new Set();
const _pollingPiracyJobs = new Set();

async function loadPiracyList() {
  try {
    const creators = await api("/api/piracy/creators");
    document.getElementById("piracy-count").textContent = creators.length;
    const box = document.getElementById("piracy-creators");
    if (!box) return;
    if (!creators || creators.length === 0) {
      box.innerHTML = '<div class="empty">暂无订阅曲师。请先到「👀 UP 主监控」添加订阅。</div>';
      return;
    }
    box.innerHTML = creators.map(c => renderPiracyCreator(c)).join("");
    // 重新展开之前打开的行
    for (const uid of _expandedPiracyRows) {
      togglePiracyExpand(uid, false);  // 打开但不 toggle
    }
  } catch (e) {
    document.getElementById("piracy-creators").innerHTML =
      `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

function renderPiracyCreator(c) {
  const badges = [];
  if (c.pending > 0) badges.push(`<span class="piracy-badge pending">待审阅 ${c.pending}</span>`);
  if (c.confirmed > 0) badges.push(`<span class="piracy-badge confirmed">确认侵权 ${c.confirmed}</span>`);
  if (c.whitelisted > 0) badges.push(`<span class="piracy-badge whitelisted">白名单 ${c.whitelisted}</span>`);
  if (c.false_positive > 0) badges.push(`<span class="piracy-badge false_positive">误判 ${c.false_positive}</span>`);
  if (badges.length === 0) badges.push(`<span class="piracy-badge none">未扫描</span>`);

  const totalDetected = c.pending + c.confirmed + c.whitelisted + c.false_positive;
  const expandable = totalDetected > 0;
  const scanBtnLabel = c.last_scan ? "🔄 重新扫描" : "🔍 查询";

  return `
    <div class="piracy-creator" id="piracy-c-${c.uid}">
      <div class="row1">
        <div class="name">
          <a href="${c.space_url}" target="_blank" style="color: inherit; text-decoration: none;">
            ${escapeHtml(c.name)}
          </a>
          <span class="subtle" style="font-weight: 400; margin-left: 6px;">UID ${c.uid}</span>
        </div>
        <div class="badges">${badges.join("")}</div>
        <div class="last-scan">${c.last_scan_fmt ? '扫于 ' + c.last_scan_fmt : ''}</div>
        <div class="item-actions">
          ${expandable ? `<button class="btn small" onclick="togglePiracyExpand(${c.uid})">📋 展开</button>` : ''}
          <button class="btn primary small" onclick="piracyScan(${c.uid}, '${escapeHtml(c.name).replace(/'/g, "\\'")}')">${scanBtnLabel}</button>
        </div>
      </div>
      <div class="piracy-findings" id="piracy-findings-${c.uid}"></div>
    </div>
  `;
}

async function togglePiracyExpand(uid, toggle = true) {
  const box = document.getElementById(`piracy-findings-${uid}`);
  if (!box) return;
  const isOpen = box.classList.contains("open");
  if (toggle) {
    if (isOpen) {
      box.classList.remove("open");
      _expandedPiracyRows.delete(uid);
      return;
    }
    _expandedPiracyRows.add(uid);
  }
  box.classList.add("open");
  box.innerHTML = '<div class="subtle" style="padding: 8px;">加载中...</div>';
  try {
    const findings = await api(`/api/piracy/findings/${uid}`);
    if (!findings || findings.length === 0) {
      box.innerHTML = '<div class="subtle" style="padding: 8px;">该曲师暂无 findings（扫过但没发现）</div>';
      return;
    }
    box.innerHTML = findings.map(f => renderPiracyFinding(f, uid)).join("");
  } catch (e) {
    box.innerHTML = `<div class="alert danger">加载失败: ${e.message}</div>`;
  }
}

function renderPiracyFinding(f, uid) {
  return `
    <div class="piracy-finding-row ${f.review_status}">
      <div class="piracy-finding-title">
        <a href="${f.url}" target="_blank">${escapeHtml(f.title)}</a>
        <span class="piracy-badge none" style="margin-left:6px; font-family: 'SFMono-Regular', Consolas, monospace;">${f.bvid}</span>
      </div>
      <div class="piracy-finding-meta">
        发布者 <a href="${f.author_url}" target="_blank" style="color: var(--text-dim);">${escapeHtml(f.author)}</a> (UID ${f.author_mid})
        · 播放 ${fmtNum(f.play)}
        · 发布 ${f.pubdate_fmt || '—'}
        · 状态 <span class="piracy-badge ${f.review_status}">${f.review_status}</span>
      </div>
      ${f.review_status === "pending" ? `
        <div class="piracy-finding-actions">
          <button class="btn danger" onclick="piracyReview('${f.bvid}', ${uid}, 'confirmed')">✓ 确认侵权</button>
          <button class="btn" onclick="piracyReview('${f.bvid}', ${uid}, 'false_positive')">✗ 误判</button>
          <button class="btn" onclick="piracyReview('${f.bvid}', ${uid}, 'whitelisted')">🛡️ 加白名单</button>
          <button class="btn small" onclick="piracyDelete('${f.bvid}', ${uid})" style="opacity: 0.6;">🗑</button>
        </div>
      ` : `
        <div class="piracy-finding-actions">
          <button class="btn small" onclick="piracyReview('${f.bvid}', ${uid}, 'pending')">↩ 重置为待审阅</button>
          <button class="btn small" onclick="piracyDelete('${f.bvid}', ${uid})" style="opacity: 0.6;">🗑</button>
        </div>
      `}
    </div>
  `;
}

async function piracyScan(uid, name) {
  try {
    const r = await api("/api/piracy/scan", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({uid: String(uid)})
    });
    if (r.error) { toast("danger", "启动失败", r.error); return; }
    if (r.jobs && r.jobs.length > 0) {
      toast("info", "🔍 扫描已开始",
        `<strong>${escapeHtml(name)}</strong> · 约 15-40 秒完成<br>完成后自动展开结果`, 5000);
      pollPiracyJob(r.jobs[0].job_id, uid, name);
      trackProgressJob(r.jobs[0].job_id, `🛡️ 侵权扫描 · ${name}`);  // v2.4
    }
  } catch (e) {
    toast("danger", "启动失败", e.message);
  }
}

async function pollPiracyJob(jobId, uid, name) {
  if (_pollingPiracyJobs.has(jobId)) return;
  _pollingPiracyJobs.add(jobId);
  while (true) {
    try {
      await sleep(3000);
      const j = await api(`/api/jobs/${jobId}`);
      if (!j || j.status === "unknown") break;
      if (j.status === "done") {
        const n = j.findings_count || 0;
        if (n > 0) {
          toast("warn", `⚠️ ${escapeHtml(name)} 发现 ${n} 条疑似侵权`,
            `点击行内「📋 展开」审阅每一条`, 15000);
        } else {
          toast("success", `✓ ${escapeHtml(name)} 无异常`,
            "本次搜索未发现疑似侵权作品", 5000);
        }
        loadPiracyList();
        // 自动展开该行
        setTimeout(() => {
          if (n > 0) {
            _expandedPiracyRows.add(uid);
            togglePiracyExpand(uid, false);
          }
        }, 500);
        break;
      }
      if (j.status === "failed") {
        toast("danger", `✗ 扫描失败 · ${escapeHtml(name)}`,
          escapeHtml((j.stderr || j.error || "").slice(0, 200)), 15000);
        break;
      }
    } catch (e) {
      console.error("poll piracy err:", e);
      break;
    }
  }
  _pollingPiracyJobs.delete(jobId);
}

async function piracyReview(bvid, uid, status) {
  const statusText = {
    confirmed: "确认侵权",
    false_positive: "误判",
    whitelisted: "加入白名单",
    pending: "重置为待审阅",
  }[status];
  try {
    const r = await api("/api/piracy/review", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({bvid, creator_uid: uid, status})
    });
    if (r.ok) {
      toast("success", `✓ ${statusText}`, escapeHtml(bvid), 3000);
      loadPiracyList();
      // 保持展开状态
      setTimeout(() => togglePiracyExpand(uid, false), 300);
    } else {
      toast("danger", "标记失败", r.error || "");
    }
  } catch (e) {
    toast("danger", "标记失败", e.message);
  }
}

async function piracyDelete(bvid, uid) {
  if (!confirm(`🗑 从数据库删除该 finding？\n${bvid}\n\n下次扫描如果还匹配到会重新出现。`)) return;
  try {
    const r = await api(`/api/piracy/findings/${uid}/${bvid}`, {method: "DELETE"});
    if (r.ok) {
      toast("info", "已删除", escapeHtml(bvid), 3000);
      loadPiracyList();
      setTimeout(() => togglePiracyExpand(uid, false), 300);
    }
  } catch (e) { toast("danger", "删除失败", e.message); }
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
