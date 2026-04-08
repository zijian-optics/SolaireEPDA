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

# ── Start Python backend (background, inherits pixi env) ──
Start-Process -FilePath python -ArgumentList @(
  "-m", "uvicorn", "solaire.web.app:app",
  "--app-dir", (Join-Path $repoRoot "src"),
  "--host", "127.0.0.1",
  "--port", "8000",
  "--reload",
  "--reload-dir", (Join-Path $repoRoot "src"),  # 建议：只监听 src 源码目录
  "--reload-exclude", "*src-tauri*"             # 关键：彻底排除 Tauri 的所有编译产物
) -NoNewWindow
Write-Host "[dev] Python backend starting on :8000"

# ── Start Vite dev server (foreground, Tauri watches devUrl) ──
Set-Location (Join-Path $repoRoot "web")
npm run dev -- --host localhost --port 5173 --strictPort
