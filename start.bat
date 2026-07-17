@echo off
REM BiliHub 一键启动（Windows 双击即可）
chcp 65001 > nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
pause
