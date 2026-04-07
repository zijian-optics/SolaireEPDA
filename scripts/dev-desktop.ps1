# Tauri dev: FastAPI (8000) + Vite (5173). Invoked by src-tauri/tauri.conf.json beforeDevCommand.
# Saved as UTF-8 with BOM so Windows PowerShell parses Chinese literals correctly.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $repoRoot

function Test-SolaireBackendUp {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return ($r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Get-ListenerOnPort {
  param([int]$Port)
  try {
    return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  } catch {
    # Get-NetTCPConnection may be unavailable on some SKUs.
    return $null
  }
}

# Dev mode should always run backend from current repo source.
$listener = Get-ListenerOnPort -Port 8000
if ($listener) {
  $pid = $listener.OwningProcess
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  $cmdline = ""
  try {
    $wmi = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $pid) -ErrorAction SilentlyContinue
    if ($wmi -and $wmi.CommandLine) { $cmdline = [string]$wmi.CommandLine }
  } catch {
    # no-op
  }
  $isSolaireUvicorn = ($cmdline -match "uvicorn") -and ($cmdline -match "solaire\.web\.app:app")
  if ($isSolaireUvicorn) {
    Write-Host ("[dev-desktop] Found existing backend on 8000 (PID {0}); restarting to pick latest local code." -f $pid)
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
  } else {
    $who = if ($proc) { "PID $($proc.Id) ($($proc.ProcessName))" } else { "unknown process" }
    Write-Error ("Port 8000 is in use by {0}. Please stop that process first, then retry tauri dev." -f $who)
    exit 1
  }
}

  $exe = $null
  $argsUv = @(
    "-m", "uvicorn", "solaire.web.app:app",
    "--app-dir", (Join-Path $repoRoot "src"),
    "--host", "127.0.0.1",
    "--port", "8000"
  )
  $repoCondaPy = Join-Path $repoRoot ".conda-solaire\python.exe"
  if ($env:PIXI_PROJECT_ROOT) {
    # 在 beforeDevCommand 的子进程中，不要依赖 PATH，直接使用 pixi 环境里的 python.exe
    $pixiPython = Join-Path $repoRoot ".pixi\envs\default\python.exe"
    if (-not (Test-Path $pixiPython)) {
      Write-Error ("Pixi Python not found: {0}. Run: pixi install && pixi run bootstrap" -f $pixiPython)
      exit 1
    }
    $exe = $pixiPython
    Write-Host ("[dev-desktop] Using pixi-managed Python: {0}" -f $exe)
  } elseif (Test-Path $repoCondaPy) {
    $exe = $repoCondaPy
    Write-Host ("[dev-desktop] Using project Python: {0}" -f $repoCondaPy)
  } elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $exe = "py"
    $argsUv = @("-3.12") + $argsUv
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $exe = "python"
  } else {
    Write-Error "Python not found. Run: pixi run bootstrap"
    exit 1
  }

  # 用 WMI 创建进程，使其脱离 Node.js/npm 的 Job Object 约束。
  # 直接使用 Start-Process 在 tauri dev 上下文中会因 Job Object 导致后台 Python 被强杀。
  $uvicornCmd = "`"$exe`" " + ($argsUv | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }) -join ' '
  Write-Host ("[dev-desktop] Starting backend: {0}" -f $uvicornCmd)
  $wmiResult = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine      = $uvicornCmd
    CurrentDirectory = $repoRoot
  }
  if ($wmiResult.ReturnValue -ne 0) {
    Write-Error ("Failed to start backend via WMI (ReturnValue={0}). Cmd: {1}" -f $wmiResult.ReturnValue, $uvicornCmd)
    exit 1
  }
  $uvicornPid = $wmiResult.ProcessId
  Write-Host ("[dev-desktop] Backend started, PID {0}" -f $uvicornPid)

  # 等待后端就绪（最多 30 秒）；超时则继续，窗口会在几秒后自动可用
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-SolaireBackendUp) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    Write-Warning ("Backend PID {0} did not respond within 30s. Frontend starting; check {1} -m uvicorn ..." -f $uvicornPid, $exe)
  } else {
    Write-Host "[dev-desktop] Backend ready."
  }

Set-Location (Join-Path $repoRoot "web")
$viteListener = Get-ListenerOnPort -Port 5173
if ($viteListener) {
  $vitePid = $viteListener.OwningProcess
  $viteProc = Get-Process -Id $vitePid -ErrorAction SilentlyContinue
  $viteCmdline = ""
  try {
    $viteWmi = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $vitePid) -ErrorAction SilentlyContinue
    if ($viteWmi -and $viteWmi.CommandLine) { $viteCmdline = [string]$viteWmi.CommandLine }
  } catch {
    # no-op
  }
  $isViteProcess = ($viteCmdline -match "vite")
  if ($isViteProcess) {
    Write-Host ("[dev-desktop] Found existing Vite on 5173 (PID {0}); restarting." -f $vitePid)
    Stop-Process -Id $vitePid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 600
  } else {
    $viteWho = if ($viteProc) { "PID $($viteProc.Id) ($($viteProc.ProcessName))" } else { "unknown process" }
    Write-Error ("Port 5173 is in use by {0}. Please stop that process first, then retry tauri dev." -f $viteWho)
    exit 1
  }
}

# Keep dev URL stable for tauri.devUrl (http://localhost:5173).
npm run dev -- --host localhost --port 5173 --strictPort
