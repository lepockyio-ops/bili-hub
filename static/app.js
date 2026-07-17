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
          <button class="btn danger small" onclick="radarRemove('${t.bvid}')">停止</button>
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

async function radarRemove(bvid) {
  if (!confirm(`停止追踪 ${bvid}？（保留历史数据）`)) return;
  showLoading("正在停止追踪...");
  try {
    await api(`/api/radar/tracks/${bvid}`, {method: "DELETE"});
    loadRadar();
  } finally { hideLoading(); }
}

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
// Comments
// ============================================================================
async function commentsExtract() {
  const bvid = document.getElementById("comm-bvid").value.trim();
  if (!bvid) { alert("请填 bvid 或视频链接"); return; }
  const payload = {
    bvid,
    max_pages: parseInt(document.getElementById("comm-pages").value) || 1,
    sort: document.getElementById("comm-sort").value,
    target_lang: document.getElementById("comm-lang").value,
    include_replies: document.getElementById("comm-replies").checked,
    no_translate: document.getElementById("comm-no-trans").checked,
    no_reply: document.getElementById("comm-no-reply").checked,
  };
  showLoading("正在提取评论（含 AI 翻译，可能需要 1-3 分钟）...");
  try {
    const r = await api("/api/comments/extract", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    let text = r.stdout + (r.stderr ? "\n---\nSTDERR:\n" + r.stderr : "");
    if (r.output_file) {
      const filename = r.output_file.split(/[\\/]/).pop();
      text += `\n\n📥 [点击下载](/api/comments/download/${encodeURIComponent(filename)})`;
      // 提示一下
      setTimeout(() => {
        if (confirm(`✓ 提取完成！是否立刻下载 ${filename}？`)) {
          window.open(`/api/comments/download/${encodeURIComponent(filename)}`, "_blank");
        }
      }, 100);
    }
    showResult("comm-result", text);
    loadCommentsOutputs();
  } catch (e) {
    alert("失败: " + e.message);
  } finally { hideLoading(); }
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
