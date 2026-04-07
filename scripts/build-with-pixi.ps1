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
  Write-Error "未找到 pixi.toml：$pixiToml"
}

if (-not (Get-Command pixi -ErrorAction SilentlyContinue)) {
  Write-Error "未检测到 pixi。请先安装 pixi，再运行本脚本。"
}

Write-Host "==> 使用 pixi 项目内环境构建" -ForegroundColor Cyan
& pixi run doctor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipBootstrap) {
  Write-Host "==> 初始化项目内依赖（Python / Node）" -ForegroundColor Cyan
  & pixi install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & pixi run bootstrap
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  Write-Host "==> 已跳过 bootstrap（-SkipBootstrap）" -ForegroundColor Yellow
}

if ($SkipRust) { $env:SOLAIRE_SKIP_RUST = "1" }
if ($SkipPythonRuntime) { $env:SOLAIRE_SKIP_PY_RUNTIME = "1" }
if ($SkipNuitka) { $env:SOLAIRE_SKIP_NUITKA = "1" }
if ($SkipTauri) { $env:SOLAIRE_SKIP_TAURI = "1" }

Write-Host "==> 开始打包（scripts/build.ps1）" -ForegroundColor Cyan
& pixi run build-desktop
exit $LASTEXITCODE
