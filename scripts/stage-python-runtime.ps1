# Stage Windows embeddable Python + pip install into src-tauri/runtime/python for Tauri bundle.resources.
# Run from repo root: .\scripts\stage-python-runtime.ps1
# Requires network: python.org, bootstrap.pypa.io (or pre-populate .cache/python-embed)

param(
  [string]$PythonVersion = "3.12.7",
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $repoRoot "src-tauri\runtime\python"
$cacheDir = Join-Path $repoRoot ".cache\python-embed"
$embedName = "python-$PythonVersion-embed-amd64.zip"
$embedUrl = "https://www.python.org/ftp/python/$PythonVersion/$embedName"
$getPipUrl = "https://bootstrap.pypa.io/get-pip.py"

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

if ($Force -and (Test-Path $runtimeRoot)) {
  Write-Host "==> Remove old runtime: $runtimeRoot" -ForegroundColor Yellow
  Remove-Item -Recurse -Force $runtimeRoot
}

function Write-RuntimeReadmeStub {
  param([string]$Dir)
  $stub = @'
This folder is populated by scripts/stage-python-runtime.ps1 (embeddable Python + pip install).
Run that script or the full repo build (.\scripts\build.ps1) before packaging.
'@
  Set-Content -Path (Join-Path $Dir "README.txt") -Value $stub.Trim() -Encoding UTF8
}

function Download-EmbedZip {
  param(
    [string]$Url,
    [string]$TargetPath
  )
  Write-Host "==> Download embeddable: $Url" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $Url -OutFile $TargetPath -UseBasicParsing
}

function Test-ZipArchiveReadable {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $false }
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  $archive = $null
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    if ($archive.Entries.Count -lt 1) { return $false }
    return $true
  } catch {
    return $false
  } finally {
    if ($archive) { $archive.Dispose() }
  }
}

function Sync-SampleProject {
  param([string]$RepoRoot)
  $sampleSrc = Join-Path $RepoRoot "src\solaire\web\bundled_project_templates\math"
  $sampleDst = Join-Path $RepoRoot "src-tauri\runtime\sample_project"
  if (-not (Test-Path $sampleSrc)) {
    Write-Warning "Sample project source missing: $sampleSrc"
    return
  }
  Write-Host "==> Sync built-in sample project -> $sampleDst" -ForegroundColor Cyan
  if (Test-Path $sampleDst) { Remove-Item -Recurse -Force $sampleDst }
  Copy-Item -Recurse -Force $sampleSrc $sampleDst
}

if ((Test-Path $runtimeRoot) -and (Test-Path (Join-Path $runtimeRoot "python.exe")) -and -not $Force) {
  Write-Host "==> Embedded Python already exists (use -Force to rebuild): $runtimeRoot" -ForegroundColor Cyan
  Sync-SampleProject -RepoRoot $repoRoot
  exit 0
}

$zipLocal = Join-Path $cacheDir $embedName
if ($Force -and (Test-Path $zipLocal)) {
  Write-Host "==> Remove cached embeddable zip (-Force): $zipLocal" -ForegroundColor Yellow
  Remove-Item -Force $zipLocal
}
if (-not (Test-ZipArchiveReadable $zipLocal)) {
  if (Test-Path $zipLocal) {
    Write-Host "==> Cached embeddable zip is invalid, re-downloading" -ForegroundColor Yellow
    Remove-Item -Force $zipLocal
  }
  Download-EmbedZip -Url $embedUrl -TargetPath $zipLocal
  if (-not (Test-ZipArchiveReadable $zipLocal)) {
    Write-Error "下载后的嵌入式 Python 压缩包仍无法读取：$zipLocal"
  }
}

$expanded = $false
for ($attempt = 1; $attempt -le 2 -and -not $expanded; $attempt++) {
  if (Test-Path $runtimeRoot) {
    Remove-Item -Recurse -Force $runtimeRoot
  }
  New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
  Write-RuntimeReadmeStub $runtimeRoot
  Write-Host "==> Expand-Archive to $runtimeRoot (attempt $attempt/2)" -ForegroundColor Cyan
  try {
    Expand-Archive -Path $zipLocal -DestinationPath $runtimeRoot -Force
    $expanded = $true
  } catch {
    if ($attempt -eq 1) {
      Write-Host "==> Expand failed, cache zip may be corrupted. Re-downloading once..." -ForegroundColor Yellow
      if (Test-Path $zipLocal) { Remove-Item -Force $zipLocal }
      Download-EmbedZip -Url $embedUrl -TargetPath $zipLocal
      if (-not (Test-ZipArchiveReadable $zipLocal)) {
        Write-Error "重新下载后压缩包仍不可用：$zipLocal"
      }
    } else {
      throw
    }
  }
}

$pthPath = Get-ChildItem -Path $runtimeRoot -Filter "python*._pth" -File | Select-Object -First 1
if (-not $pthPath) {
  Write-Error "python*._pth not found under $runtimeRoot"
}
$pth = Get-Content -Path $pthPath.FullName -Raw
$pth = $pth -replace '#\s*import site', 'import site'
if ($pth -notmatch '(?m)^import site\s*$') {
  $pth = $pth.TrimEnd() + "`r`nimport site`r`n"
}
Set-Content -Path $pthPath.FullName -Value $pth -NoNewline

$pythonExe = Join-Path $runtimeRoot "python.exe"
$getPipPath = Join-Path $cacheDir "get-pip.py"
if (-not (Test-Path $getPipPath)) {
  Write-Host "==> Download get-pip.py" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipPath -UseBasicParsing
}

Write-Host "==> Install pip" -ForegroundColor Cyan
& $pythonExe $getPipPath --no-warn-script-location
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> pip install repo (may take a while)" -ForegroundColor Cyan
Push-Location $repoRoot
try {
  # Isolate from host machine Python environment so dependency graph
  # only reflects this embedded runtime.
  $env:PYTHONNOUSERSITE = "1"
  Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
  & $pythonExe -m pip install --no-user -U pip wheel setuptools
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $pythonExe -m pip install --no-user --no-warn-script-location .
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host "==> Freeze installed package list (for diagnostics)" -ForegroundColor Cyan
& $pythonExe -m pip list --format=freeze | Tee-Object -FilePath (Join-Path $runtimeRoot "installed-packages.txt")

Write-Host "==> Verify installed dependency graph (pip check)" -ForegroundColor Cyan
& $pythonExe -m pip check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Verify python-multipart (FastAPI form upload dependency)" -ForegroundColor Cyan
$multipartTmp = Join-Path $runtimeRoot "_verify_multipart.py"
@"
from multipart import __version__ as _mv
from starlette.formparsers import MultiPartParser
import fastapi
print('fastapi=' + fastapi.__version__ + '  python-multipart=' + _mv)
"@ | Set-Content -Path $multipartTmp -Encoding UTF8
& $pythonExe $multipartTmp
if ($LASTEXITCODE -ne 0) {
  Write-Host "==> multipart verification failed; attempting explicit install" -ForegroundColor Yellow
  & $pythonExe -m pip install --no-user python-multipart
  & $pythonExe $multipartTmp
  if ($LASTEXITCODE -ne 0) {
    Remove-Item -Force $multipartTmp -ErrorAction SilentlyContinue
    Write-Error "python-multipart is required by FastAPI but could not be installed."
  }
}
Remove-Item -Force $multipartTmp -ErrorAction SilentlyContinue

Write-Host "==> Verify chemistry rendering (rdkit)" -ForegroundColor Cyan
& $pythonExe -c "import rdkit; print('rdkit', rdkit.__version__)"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "==> Verify critical transitive dependencies" -ForegroundColor Cyan
$transitiveTmp = Join-Path $runtimeRoot "_verify_transitive.py"
@"
import sys, platform
required = ['pydantic', 'yaml', 'jinja2', 'uvicorn', 'numpy',
            'openpyxl', 'openai', 'tiktoken', 'pdfplumber', 'PIL',
            'starlette', 'httptools']
unix_only = ['uvloop']
failures = []
for mod in required:
    try:
        __import__(mod)
    except ImportError:
        failures.append(mod)
skipped = []
if platform.system() != 'Windows':
    for mod in unix_only:
        try:
            __import__(mod)
        except ImportError:
            failures.append(mod)
else:
    skipped = unix_only
if failures:
    raise SystemExit('Missing transitive deps: ' + ', '.join(failures))
msg = 'All critical transitive dependencies OK'
if skipped:
    msg += ' (skipped on Windows: ' + ', '.join(skipped) + ')'
print(msg)
"@ | Set-Content -Path $transitiveTmp -Encoding UTF8
& $pythonExe $transitiveTmp
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Remove-Item -Force $transitiveTmp -ErrorAction SilentlyContinue

# Optional: double-click to start local server (troubleshooting)
$bat = @'
@echo off
cd /d "%~dp0"
"%~dp0pythonw.exe" -m solaire.desktop_entry --port 8000
'@
Set-Content -Path (Join-Path $runtimeRoot "SolEdu-LocalServer.bat") -Value $bat -Encoding ASCII

Sync-SampleProject -RepoRoot $repoRoot

Write-Host "==> Done: $runtimeRoot" -ForegroundColor Green
