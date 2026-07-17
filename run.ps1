# BiliHub 启动脚本（Windows PowerShell）
# 用法：右键 → 用 PowerShell 运行  或者双击 start.bat

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 清除可能被 Claude Cowork 污染的 venv 环境变量
Remove-Item Env:VIRTUAL_ENV -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue

Set-Location $PSScriptRoot

# 检查邻居目录
$parent = Split-Path $PSScriptRoot -Parent
$missing = @()
foreach ($name in @("biliwatch", "biliradar", "bili-comments")) {
    if (-not (Test-Path (Join-Path $parent $name))) {
        $missing += $name
    }
}
if ($missing.Count -gt 0) {
    Write-Host "⚠️  以下工具目录不存在（部分功能会失效）：" -ForegroundColor Yellow
    foreach ($m in $missing) {
        Write-Host "  · $m" -ForegroundColor Yellow
    }
    Write-Host ""
}

# 检查 Python
try {
    $ver = py --version 2>&1
    Write-Host "✓ Python: $ver" -ForegroundColor Green
} catch {
    Write-Host "❌ 未找到 Python（py 命令）。请先安装 Python 3.10+" -ForegroundColor Red
    Write-Host "   下载: https://www.python.org/downloads/"
    Pause
    exit 1
}

# 检查依赖
$check = py -c "import flask, yaml" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "首次运行，正在安装依赖..." -ForegroundColor Yellow
    py -m pip install -r requirements.txt --quiet --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 依赖安装失败" -ForegroundColor Red
        Pause
        exit 1
    }
    Write-Host "✓ 依赖已安装" -ForegroundColor Green
}

# 启动
Write-Host ""
py -X utf8 app.py
