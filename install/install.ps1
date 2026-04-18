$ErrorActionPreference = "Stop"

$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# ── prereqs: node ─────────────────────────────────────────────────────────────
$NodeBin = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeBin) {
  Write-Error @"
node not found on PATH. Install Node 20+ first:
  winget install OpenJS.NodeJS.LTS
Then restart PowerShell and re-run this installer.
"@
}

# ── build the bridge binary ──────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $RepoDir "dist\index.js"))) {
  Write-Host "Building recall-bridge..."
  Push-Location $RepoDir
  npm install
  npm run build
  Pop-Location
}

$BinDir = Join-Path $RepoDir "bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$Shim = Join-Path $BinDir "recall-bridge.cmd"
@"
@echo off
"$NodeBin" "$RepoDir\dist\index.js" %*
"@ | Set-Content -Path $Shim -Encoding ASCII

# ── write native messaging host manifest ─────────────────────────────────────
$ExtensionId = $env:RECALL_EXTENSION_ID
if (-not $ExtensionId) {
  $ExtensionId = Read-Host "Chrome extension ID for Recall (leave empty to fill in later)"
}
if (-not $ExtensionId) { $ExtensionId = "PLACEHOLDER_EXTENSION_ID" }

$ManifestTemplate = Get-Content (Join-Path $RepoDir "install\com.recall.bridge.json") -Raw
$Manifest = $ManifestTemplate.Replace("PLACEHOLDER_BINARY_PATH", $Shim.Replace("\", "\\")).Replace("PLACEHOLDER_EXTENSION_ID", $ExtensionId)

$ManifestDir = Join-Path $env:APPDATA "Google\Chrome\NativeMessagingHosts"
New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null
$ManifestPath = Join-Path $ManifestDir "com.recall.bridge.json"
$Manifest | Set-Content -Path $ManifestPath -Encoding UTF8

$RegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.recall.bridge"
New-Item -Path $RegPath -Force | Out-Null
Set-ItemProperty -Path $RegPath -Name "(Default)" -Value $ManifestPath

Write-Host "wrote $ManifestPath"

# ── backend bootstrap helpers ────────────────────────────────────────────────
function Confirm-Proceed($Prompt) {
  $yn = Read-Host "$Prompt [y/N]"
  return ($yn -match '^[yY]')
}

function Bootstrap-MemPalace {
  if (Get-Command mempalace -ErrorAction SilentlyContinue) {
    $ver = (mempalace --version 2>&1) | Select-Object -First 1
    Write-Host "mempalace already installed: $ver"
    return
  }

  Write-Host ""
  Write-Host "MemPalace (Python) is not installed."

  if (-not (Get-Command python -ErrorAction SilentlyContinue) -and -not (Get-Command python3 -ErrorAction SilentlyContinue)) {
    Write-Error @"
python not found. Install Python 3.9+ first:
  winget install Python.Python.3.12
Then restart PowerShell and re-run this installer.
"@
  }

  $cmd = $null
  if (Get-Command pipx -ErrorAction SilentlyContinue) {
    $cmd = "pipx install mempalace"
  } elseif (Get-Command pip3 -ErrorAction SilentlyContinue) {
    $cmd = "pip3 install --user mempalace"
  } elseif (Get-Command pip -ErrorAction SilentlyContinue) {
    $cmd = "pip install --user mempalace"
  } else {
    Write-Error @"
neither pipx nor pip found. Install pipx first:
  python -m pip install --user pipx
  python -m pipx ensurepath
Then restart PowerShell and re-run this installer.
"@
  }

  Write-Host "Proposed install command:"
  Write-Host "    $cmd"
  if (-not (Confirm-Proceed "Proceed?")) {
    Write-Error "Skipped. Either re-run and choose Mock, or install MemPalace manually."
  }

  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) { Write-Error "MemPalace install failed" }

  if (-not (Get-Command mempalace -ErrorAction SilentlyContinue)) {
    Write-Error @"
MemPalace installed but 'mempalace' is not on PATH.
Try 'pipx ensurepath' or add the pip Scripts dir to PATH, then re-run this installer.
"@
  }

  $ver = (mempalace --version 2>&1) | Select-Object -First 1
  Write-Host "mempalace installed: $ver"
}

function Bootstrap-GBrain {
  if (Get-Command gbrain -ErrorAction SilentlyContinue) {
    $ver = (gbrain --version 2>&1) | Select-Object -First 1
    Write-Host "gbrain already installed: $ver"
    return
  }

  Write-Host ""
  Write-Host "GBrain (TypeScript, via Bun) is not installed."

  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Error @"
bun not found. Install the Bun runtime first:
  powershell -c "irm bun.sh/install.ps1 | iex"
Then restart PowerShell and re-run this installer.
"@
  }

  $cmd = "bun add -g github:garrytan/gbrain"
  Write-Host "Proposed install command:"
  Write-Host "    $cmd"
  if (-not (Confirm-Proceed "Proceed?")) {
    Write-Error "Skipped. Either re-run and choose Mock, or install GBrain manually."
  }

  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) { Write-Error "GBrain install failed" }

  if (-not (Get-Command gbrain -ErrorAction SilentlyContinue)) {
    Write-Error @"
GBrain installed but 'gbrain' is not on PATH.
Bun installs globals under %USERPROFILE%\.bun\bin — add it to PATH and re-run.
"@
  }

  $ver = (gbrain --version 2>&1) | Select-Object -First 1
  Write-Host "gbrain installed: $ver"
}

# ── backend selection ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Select retrieval backend:"
Write-Host "  1) MemPalace   (Python, auto-installs via pipx)"
Write-Host "  2) GBrain      (TypeScript, auto-installs via Bun)"
Write-Host "  3) Mock        (no external tool, canned results)"
$Choice = Read-Host "Choice [1-3]"
switch ($Choice) {
  "1" { $Backend = "mempalace"; Bootstrap-MemPalace }
  "2" { $Backend = "gbrain"; Bootstrap-GBrain }
  default { $Backend = "mock"; Write-Host "Using mock backend." }
}

# ── write bridge config ──────────────────────────────────────────────────────
$ExportDir = Read-Host "Absolute path to Recall raw export dir"

$ConfigDir = Join-Path $env:APPDATA "recall-bridge"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
$Config = @{
  version = 1
  backend = $Backend
  exportDir = $ExportDir
  lastIngestedAt = 0
} | ConvertTo-Json
$Config | Set-Content -Path (Join-Path $ConfigDir "config.json") -Encoding UTF8

Write-Host ""
Write-Host "Install complete. Reload the Recall extension in chrome://extensions."
