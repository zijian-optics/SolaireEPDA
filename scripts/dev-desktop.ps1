# Tauri dev: Python backend (:8000) + Vite (:5173)
# Called by tauri.conf.json beforeDevCommand via pixi run dev.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

# ── Clean up leftover backend from previous session ──
try {
  $conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue |
          Select-Object -First 1
  if ($conn) {
    Write-Host "[dev] Stopping leftover backend on :8000 (PID $($conn.OwningProcess))"
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
} catch {}

# ── Start Python backend（与 `pixi run dev-backend` 完全一致，避免 Tauri 子进程 PATH 下误用系统 Python / site-packages 旧包）──
$pixiCmd = Get-Command pixi -ErrorAction SilentlyContinue
if (-not $pixiCmd) {
  Write-Error "[dev] 未在 PATH 中找到 pixi。请从仓库根用 `pixi run dev` 启动，或先安装 Pixi。"
  exit 1
}
Start-Process -FilePath "pixi" -WorkingDirectory $repoRoot -ArgumentList @("run", "dev-backend") -NoNewWindow
Write-Host "[dev] Python backend (pixi run dev-backend) starting on :8000"

$deadline = (Get-Date).AddSeconds(45)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2 -ErrorAction Stop
    if ($h.status -eq "ok" -and $h.exam_workspace_layout -eq "two_level") {
      $healthy = $true
      break
    }
  } catch {
    # 后端尚未监听或仍在 import
  }
  Start-Sleep -Milliseconds 200
}
if (-not $healthy) {
  Write-Error "[dev] :8000 在 45s 内未通过 /api/health（需 exam_workspace_layout=two_level）。请检查是否被其它进程占用或 Pixi 环境异常。"
  exit 1
}
Write-Host "[dev] Backend health OK"

# ── Start Vite dev server (foreground, Tauri watches devUrl) ──
Set-Location (Join-Path $repoRoot "web")
npm run dev -- --host localhost --port 5173 --strictPort
