# BiliHub launcher (Windows PowerShell)
# All messages in English/ASCII to avoid encoding issues when
# double-clicking start.bat on Chinese Windows systems.
# (This file must be saved as ASCII or UTF-8 without BOM
#  to work reliably across PowerShell 5 and 7.)

$ErrorActionPreference = "Stop"
$env:PYTHONIOENCODING = "utf-8"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Clear venv env vars that may leak from other tools (Claude Cowork etc.)
Remove-Item Env:VIRTUAL_ENV -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONHOME -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue

# Robust script dir detection (handles empty $PSScriptRoot)
$scriptDir = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptDir)) {
    if ($MyInvocation.MyCommand.Path) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
}
if ([string]::IsNullOrEmpty($scriptDir)) {
    $scriptDir = (Get-Location).Path
}
Set-Location $scriptDir

# Check neighbor tool directories
$parent = Split-Path -Parent $scriptDir
if (-not [string]::IsNullOrEmpty($parent)) {
    $missing = @()
    foreach ($name in @("biliwatch", "biliradar", "bili-comments", "bili-creator-report")) {
        $p = Join-Path -Path $parent -ChildPath $name
        if (-not (Test-Path $p)) {
            $missing += $name
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host "[!] Missing neighbor tool directories (some features will be disabled):" -ForegroundColor Yellow
        foreach ($m in $missing) {
            Write-Host "    - $m"
        }
        Write-Host ""
    }
}

# Check Python
try {
    $ver = & py --version 2>&1
    Write-Host "[OK] Python: $ver" -ForegroundColor Green
} catch {
    Write-Host "[X] Python not found (py command missing). Install Python 3.10+" -ForegroundColor Red
    Write-Host "    Download: https://www.python.org/downloads/"
    Pause
    exit 1
}

# Check dependencies
$null = & py -c "import flask, yaml" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[i] First run - installing dependencies..." -ForegroundColor Yellow
    & py -m pip install -r requirements.txt --quiet --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Dependency installation failed" -ForegroundColor Red
        Pause
        exit 1
    }
    Write-Host "[OK] Dependencies installed" -ForegroundColor Green
}

# Launch
Write-Host ""
Write-Host "[i] Starting BiliHub server on http://127.0.0.1:5678/" -ForegroundColor Cyan
Write-Host "[i] Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host ""
& py -X utf8 app.py
