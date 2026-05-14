# Spore Code — npm/npx installer for Windows.
#
#   irm https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.ps1 | iex
#
# Local checkout / downloaded zip:
#   .\install.cmd
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#
# Optional overrides:
#   $env:SPORE_CODE_VERSION = 'beta'
#   $env:SPORE_CODE_PACKAGE = '@vibe-coalition/spore-code'
#   $env:SPORE_CODE_PREFIX  = "$env:LOCALAPPDATA\spore-code-npm"
#
# Re-running upgrades the npm package in place.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Package = if ($env:SPORE_CODE_PACKAGE) { $env:SPORE_CODE_PACKAGE } else { '@vibe-coalition/spore-code' }
$Version = if ($env:SPORE_CODE_VERSION) { $env:SPORE_CODE_VERSION } else { 'beta' }
$Prefix = if ($env:SPORE_CODE_PREFIX) { $env:SPORE_CODE_PREFIX } else { '' }
$MinNodeMajor = 22

function Write-Step([string]$msg) { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok  ([string]$msg) { Write-Host "OK $msg" -ForegroundColor Green }
function Write-Hint([string]$msg) { Write-Host "   $msg" -ForegroundColor DarkGray }
function Die       ([string]$msg) { Write-Host "ERR $msg" -ForegroundColor Red; exit 1 }

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Die "$Name is required. $InstallHint"
  }
}

Require-Command 'node' 'Install Node.js 22+ from https://nodejs.org/ and rerun this installer.'
Require-Command 'npm' 'Install Node.js 22+ from https://nodejs.org/ and rerun this installer.'

$nodeVersionText = (& node --version).TrimStart('v')
$nodeMajor = [int]($nodeVersionText.Split('.')[0])
if ($nodeMajor -lt $MinNodeMajor) {
  Die "Node.js $MinNodeMajor+ is required; found v$nodeVersionText."
}

$Spec = if ($Version) { "$Package@$Version" } else { $Package }
$NpmArgs = @('install', '-g')
if ($Prefix) {
  [void](New-Item -ItemType Directory -Path $Prefix -Force)
  $NpmArgs += @('--prefix', $Prefix)
}
$NpmArgs += $Spec

Write-Step "Installing $Spec with npm"
& npm @NpmArgs
if ($LASTEXITCODE -ne 0) { Die 'npm install failed' }

if ($Prefix) {
  $BinDir = $Prefix
} else {
  $BinDir = ''
  try {
    $npmPrefix = (& npm prefix -g 2>$null).Trim()
    if ($npmPrefix) { $BinDir = $npmPrefix }
  } catch {}
}

$sporeCmd = Get-Command spore -ErrorAction SilentlyContinue
if ($sporeCmd) {
  Write-Ok "Installed spore at $($sporeCmd.Source)"
} else {
  Write-Ok 'Installed package'
  if ($BinDir) {
    Write-Hint "$BinDir is where npm should place the spore command."
    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $UserPath) { $UserPath = '' }
    $onPath = ($UserPath -split ';' | Where-Object { $_ -ieq $BinDir }).Count -gt 0
    if (-not $onPath) {
      try {
        $newPath = if ($UserPath.TrimEnd(';')) { "$($UserPath.TrimEnd(';'));$BinDir" } else { $BinDir }
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
        Write-Ok "Added $BinDir to your user PATH"
        Write-Hint 'Open a new terminal for the change to take effect.'
      } catch {
        Write-Hint "$BinDir is not in your PATH and could not be added automatically."
        Write-Hint 'Add it manually in System Properties -> Environment Variables -> User Path.'
      }
    }
  }
}

$sporeCmd = Get-Command spore -ErrorAction SilentlyContinue
if ($sporeCmd) {
  try { & spore --version } catch {}
}

Write-Host ''
Write-Host 'Run ' -NoNewline -ForegroundColor DarkGray
Write-Host 'spore setup' -NoNewline -ForegroundColor White
Write-Host ' to connect to Spore Core, then ' -NoNewline -ForegroundColor DarkGray
Write-Host 'spore' -NoNewline -ForegroundColor White
Write-Host ' in a project directory.' -ForegroundColor DarkGray
