# BiliHub

> B 站 Vocaloid 运营三合一控制台。把 **BiliWatch**（UP 监控）+ **BiliRadar**（数据雷达）+ **BiliComments**（评论收集）整合到一个本地 Web 界面，双击启动，浏览器操作。

[![Python](https://img.shields.io/badge/python-3.10+-blue.svg)]()
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## 特性

- 🎯 **三合一** — 一个界面统一管理 UP 订阅、曲目追踪、评论收集
- 🖱️ **零命令行** — 全部功能网页操作，无需记 CLI
- 🚀 **一键启动** — Windows 双击 `start.bat`，自动开浏览器
- 🔗 **数据互通** — 复用现有三个工具的 SQLite / YAML / XLSX 输出
- 🌙 **暗色主题** — 长时间盯屏也不累
- 📥 **XLSX 下载** — 提取的评论直接在浏览器点击下载

## 目录结构（推荐）

```
MCN创业/
├── biliwatch/           ← 前置：https://github.com/lepockyio-ops/biliwatch
├── biliradar/           ← 前置：https://github.com/lepockyio-ops/biliradar
├── bili-comments/       ← 前置：https://github.com/lepockyio-ops/bili-comments
└── bili-hub/            ← 本仓库
    ├── app.py           # Flask 服务器
    ├── templates/
    ├── static/
    ├── run.ps1          # Windows 启动
    ├── start.bat        # Windows 双击启动
    └── run.sh           # Mac/Linux 启动
```

**三个前置工具必须在 bili-hub 同级目录**，否则对应功能会显示"缺少工具"。

## 快速开始

### 1. 前置准备

先把三个工具 clone 到同一个父目录：

```bash
mkdir MCN创业 && cd MCN创业
git clone https://github.com/lepockyio-ops/biliwatch.git
git clone https://github.com/lepockyio-ops/biliradar.git
git clone https://github.com/lepockyio-ops/bili-comments.git
git clone https://github.com/lepockyio-ops/bili-hub.git
```

各自安装依赖（每个工具目录里跑一次）：

```bash
cd biliwatch      && pip install -r requirements.txt && cd ..
cd biliradar      && pip install -r requirements.txt && cd ..
cd bili-comments  && pip install -r requirements.txt && cd ..
```

（可选）给 `bili-comments/.env` 填 SESSDATA（详见其 README），否则只能拿到 3-5 条评论。

### 2. 启动 BiliHub

**Windows**：直接双击 `bili-hub/start.bat`

**Mac / Linux**：
```bash
cd bili-hub
bash run.sh
```

**手动**：
```bash
cd bili-hub
pip install -r requirements.txt
python app.py
```

启动后自动打开 http://127.0.0.1:5678

## 使用说明

### 🏠 首页概览

- 三大工具的状态一栏（订阅数、追踪数、评论文件数）
- 邻居工具是否就绪
- 使用建议

### 👀 UP 主监控

- **添加订阅**：粘贴 B 站空间链接或 UID，一键加入
- **立即检查**：点按钮 → 后端跑 BiliWatch → 有新稿件立即弹窗
- **删除订阅**：每行右侧的"删除"按钮

### 📊 数据雷达

- **添加追踪**：粘贴 bvid 或视频链接 → 立即采基线
- **立即采集**：一次性刷新所有追踪曲目的最新数据
- **生成看板**：自动生成暗色主题 HTML 看板
- **打开最新看板**：新窗口预览可视化曲线
- **检查预警**：识别 HOT/WARN/GOOD 三类信号

### 💬 评论收集

- 提交视频 bvid + 选项（页数/排序/翻译语言/是否含楼中楼）
- 后端跑 BiliComments v2（AI 翻译 + 意图 + 回复推荐）
- 完成后弹窗提示 → 一键下载 XLSX
- 「历史输出」列出所有生成过的文件供再次下载

## 端口 & 环境变量

- 默认端口 `5678`。用别的端口：`BILIHUB_PORT=8080 python app.py`
- 不自动开浏览器：`BILIHUB_NO_BROWSER=1 python app.py`
- 只对本机开放（默认 `127.0.0.1`），不对外暴露

## 常见问题

### Q1: 启动后浏览器提示"无法访问"

- 检查是否真的启动成功（PowerShell 窗口应显示 `BiliHub 已启动 🚀`）
- 检查端口是否被占用：`netstat -ano | findstr 5678`
- 换端口：`$env:BILIHUB_PORT="8080"; py app.py`

### Q2: 首页显示"缺少工具"

- 确认 biliwatch/biliradar/bili-comments 三个目录与 bili-hub **同级**
- 目录名不能改（区分大小写在部分系统上）

### Q3: 点"立即采集"很久没反应

- 后端在同步执行，页面会一直转圈到完成
- 如果追踪了很多首曲，耗时可能 1-3 分钟
- 完成后会自动关闭 loading 遮罩

### Q4: 评论抓完显示 3-5 条

- 是 B 站反爬限制，见 bili-comments/README.md 配置 SESSDATA
- 配置好 `.env` 后无需重启 hub，直接重新提取即可

### Q5: 端口 5678 不喜欢

- Windows: `$env:BILIHUB_PORT="8080"; py app.py`
- Linux/Mac: `BILIHUB_PORT=8080 python app.py`

## 技术架构

- **后端**：Flask + Python 3.10
- **数据存储**：直接读写三个前置工具的原生存储（yaml / SQLite / json）
- **命令执行**：subprocess 调用现有 `.py` 脚本（不复制代码，永远和上游同步）
- **前端**：原生 HTML + CSS + JS（无框架、无构建）
- **样式**：暗色主题、单页应用、响应式布局

## 迭代路线

- [x] v1：三合一 Web UI，基本 CRUD + 触发操作
- [ ] v2：实时进度条（SSE / WebSocket）替换 loading 遮罩
- [ ] v3：内嵌 BiliRadar 看板到 iframe（不用新窗口）
- [ ] v4：任务队列 + 定时调度（不依赖 Claude scheduled task）
- [ ] v5：多用户 / 多曲师隔离（每个曲师一个 workspace）

## License

MIT © 2026 Pocky

## 相关项目

- [BiliWatch](https://github.com/lepockyio-ops/biliwatch) — UP 主投稿监控
- [BiliRadar](https://github.com/lepockyio-ops/biliradar) — 曲目数据雷达
- [BiliComments](https://github.com/lepockyio-ops/bili-comments) — 评论收集 + AI 翻译 + 回复推荐
