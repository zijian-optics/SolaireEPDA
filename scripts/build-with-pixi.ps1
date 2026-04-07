param(
  [switch]$SkipRust,
  [switch]$SkipPythonRuntime,
  [switch]$SkipNuitka,
  [switch]$SkipTauri,
  [switch]$SkipBootstrap
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$pixiToml = Join-Path $repoRoot "pixi.toml"

Set-Location $repoRoot

if (-not (Test-Path $pixiToml)) {
  Write-Error "pixi.toml not found: $pixiToml"
}

if (-not (Get-Command pixi -ErrorAction SilentlyContinue)) {
  Write-Error "pixi not found. Install pixi, then run this script again."
}

Write-Host "==> Building with the Pixi-managed project environment" -ForegroundColor Cyan
& pixi run doctor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipBootstrap) {
  Write-Host "==> Installing project dependencies (Python / Node)" -ForegroundColor Cyan
  & pixi install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & pixi run bootstrap
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "==> Skipped bootstrap (-SkipBootstrap)" -ForegroundColor Yellow
}

if ($SkipRust) { $env:SOLAIRE_SKIP_RUST = "1" }
if ($SkipPythonRuntime) { $env:SOLAIRE_SKIP_PY_RUNTIME = "1" }
if ($SkipNuitka) { $env:SOLAIRE_SKIP_NUITKA = "1" }
if ($SkipTauri) { $env:SOLAIRE_SKIP_TAURI = "1" }

Write-Host "==> Starting package build (scripts/build.ps1)" -ForegroundColor Cyan
& pixi run build-desktop
exit $LASTEXITCODE
