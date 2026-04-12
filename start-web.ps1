# Solaire Web UI — 一键启动后端 + 前端（本机开发）
# 在仓库根目录执行:  .\start-web.ps1
#
# 必须使用 --app-dir src，否则 Python 可能从 site-packages 加载旧版 solaire，草稿目录仍为 UUID。

$ErrorActionPreference = "Stop"
$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
Set-Location $repoRoot

$srcDir = Join-Path $repoRoot "src"

$uvicornLine = $null
if (Get-Command py -ErrorAction SilentlyContinue) {
  $uvicornLine = "Set-Location '$repoRoot'; py -3.12 -m uvicorn solaire.web.app:app --app-dir `"$srcDir`" --host 127.0.0.1 --port 8000 --reload --reload-dir `"$srcDir`""
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $uvicornLine = "Set-Location '$repoRoot'; python -m uvicorn solaire.web.app:app --app-dir `"$srcDir`" --host 127.0.0.1 --port 8000 --reload --reload-dir `"$srcDir`""
} elseif (Get-Command python3 -ErrorAction SilentlyContinue) {
  $uvicornLine = "Set-Location '$repoRoot'; python3 -m uvicorn solaire.web.app:app --app-dir `"$srcDir`" --host 127.0.0.1 --port 8000 --reload --reload-dir `"$srcDir`""
} else {
  Write-Error "未找到 py / python / python3。请安装 Python 3.11+ 或使用 pixi run dev-backend。"
}

Write-Host "仓库: $repoRoot"
Write-Host "启动 FastAPI（--app-dir src）→ http://127.0.0.1:8000"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", $uvicornLine

Start-Sleep -Seconds 2

$viteLine = "Set-Location '$repoRoot\web'; npm run dev"
Write-Host "启动 Vite → http://127.0.0.1:5173"
Start-Process pwsh -ArgumentList "-NoExit", "-Command", $viteLine

Write-Host "已打开两个终端窗口。浏览器访问 http://127.0.0.1:5173"
Write-Host "若草稿目录仍为长串十六进制，请访问 http://127.0.0.1:8000/api/health 确认含 exam_workspace_layout=two_level。"
