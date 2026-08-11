# Model Ferry Windows installer (Windows 10 and Windows 11)
# Quick install: irm https://ferry.designxdevelop.com/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repoUrl = "https://github.com/designxdevelop/model-ferry.git"
$installDir = if ($env:MODELFERRY_DIR) { $env:MODELFERRY_DIR } else { Join-Path $HOME ".modelferry" }
$binDir = if ($env:MODELFERRY_BIN_DIR) { $env:MODELFERRY_BIN_DIR } else { Join-Path $HOME ".local\bin" }

function Say([string]$message) { Write-Host "modelferry $message" -ForegroundColor Blue }
function Die([string]$message) { throw "modelferry: $message" }
function Assert-NativeSuccess([string]$action) {
  if ($null -ne $LASTEXITCODE -and $LASTEXITCODE -ne 0) {
    Die "$action failed (exit $LASTEXITCODE)."
  }
}

function Assert-ModelFerryRemote([string]$dir) {
  $remote = git -C $dir remote get-url origin 2>$null
  Assert-NativeSuccess "Reading git remote for $dir"
  $normalized = ($remote -replace '\.git$', '').TrimEnd('/').ToLowerInvariant()
  $expected = ($repoUrl -replace '\.git$', '').TrimEnd('/').ToLowerInvariant()
  $expectedSsh = "git@github.com:designxdevelop/model-ferry"
  if ($normalized -ne $expected -and $normalized -ne $expectedSsh) {
    Die "$dir origin is '$remote', expected $repoUrl. Remove it or set MODELFERRY_DIR, then re-run."
  }
}

if ($PSVersionTable.PSVersion.Major -lt 5) { Die "PowerShell 5.1 or later is required." }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die "git is required. Install it from https://git-scm.com and re-run." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js 22 or later is required. Install it from https://nodejs.org and re-run." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Die "npm is required. Install Node.js 22 or later from https://nodejs.org and re-run." }

$nodeMajorText = node -p "process.versions.node.split('.')[0]"
Assert-NativeSuccess "Querying Node.js version"
$nodeMajor = [int]$nodeMajorText
if ($nodeMajor -lt 22) { Die "Node.js 22 or later is required (found $(node --version))." }

if (Test-Path $installDir) {
  if (-not (Test-Path (Join-Path $installDir ".git"))) { Die "$installDir already exists and is not a Model Ferry checkout. Remove it or set MODELFERRY_DIR, then re-run." }
  Assert-ModelFerryRemote $installDir
  Say "Updating existing install in $installDir"
  git -C $installDir pull --ff-only
  Assert-NativeSuccess "Updating $installDir"
} else {
  Say "Cloning Model Ferry into $installDir"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installDir) | Out-Null
  git clone $repoUrl $installDir
  Assert-NativeSuccess "Cloning Model Ferry"
}

Say "Installing dependencies"
Push-Location $installDir
try {
  npm install
  Assert-NativeSuccess "npm install"
} finally { Pop-Location }

Say "Linking modelferry onto your PATH"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$shim = Join-Path $binDir "modelferry.cmd"
@"
@echo off
node "$installDir\src\cli.mjs" %*
"@ | Set-Content -Path $shim -Encoding ascii

if (-not (($env:Path -split ";") -contains $binDir)) {
  Say "Add $binDir to your User PATH to use modelferry from a new terminal."
}

Say "Scanning installed agent harnesses; OpenCode, Pi, and Hermes have automatic provider setup"
Say "Running setup with Windows Task Scheduler - a browser window may open for Cursor sign-in"
Push-Location $installDir
try {
  npm run setup
  Assert-NativeSuccess "npm run setup"
} finally { Pop-Location }

Write-Host ""
Write-Host "modelferry: installed. Next steps:"
Write-Host "  1. Review the configured and detected harness list printed by setup above."
Write-Host "  2. Pick Cursor in OpenCode or Model Ferry in Pi/Hermes, then choose a model and variant."
Write-Host "  3. For another local OpenAI-compatible client, follow the manual connection instructions in $installDir\README.md."
Write-Host "  4. Run modelferry agents to rescan, or modelferry status to check bridge health."
