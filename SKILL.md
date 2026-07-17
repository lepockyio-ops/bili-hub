---
name: bili-hub
description: 启动 BiliHub 本地 Web 控制台（三合一 UI）。当用户说"启动 bili hub""打开 bili 控制台""开 web 界面""所有工具一起用"等意图时使用。
---

# BiliHub — B 站运营三合一 Web 控制台

## 何时使用

- 用户想在浏览器界面统一操作三个工具（不用分别打 PowerShell 命令）
- 用户问"能不能一起管理所有 UP 和视频"
- 用户想给团队/日方合作方一个易用的界面

## 启动方式

```powershell
Set-Location "C:\Users\何\Documents\Claude\Projects\MCN创业\bili-hub"
.\run.ps1
```

或双击 `start.bat`。

启动后自动开浏览器到 http://127.0.0.1:5678。

按 Ctrl+C 停止服务。

## 功能面板

- 🏠 首页概览：三工具状态卡
- 👀 UP 主监控：订阅管理 + 立即检查
- 📊 数据雷达：曲目追踪 + 采集 + 看板 + 预警
- 💬 评论收集：提取 + AI 翻译 + 回复推荐 + 下载 XLSX

## 上下文

- 项目：日本 Vocaloid 音乐 IP 运营
- 三个前置工具必须在 bili-hub 同级目录（biliwatch / biliradar / bili-comments）
- 服务器只监听本机 127.0.0.1，不对外暴露
