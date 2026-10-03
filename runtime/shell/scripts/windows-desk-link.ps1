# Runs the Open DeskOS Desk Link Service on a Windows Shell Host.
#
# The service accepts package-initiated Desk Links from other machines and serves
# the runtime's own snapshot over its local channel. It is the counterpart of the
# systemd unit on a Unix host, with the same restart loop, and it is the thing that
# was previously kept alive by a hand-written loop script.
#
# It runs in the logged-on session because a scheduled task is the only way to run
# a long-lived process there; the service itself needs no desktop, but a task that
# cannot start in session 0 is not a task this host can keep.
#
# ASCII only: PowerShell 5.1 reads a BOM-less .ps1 in the system code page, so a
# non-ASCII character here is a syntax error rather than a display glitch.

param(
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot '..'),
  [string]$NodeBin = 'node.exe',
  [int]$RestartDelaySeconds = 10,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'

$configDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'open-deskos' } else { $env:TEMP }
$log = Join-Path $configDir 'desk-link.log'
$entryPoint = Join-Path $RuntimeRoot 'scripts\desk-link-service.js'
$envFile = Join-Path $RuntimeRoot '.env.local'
$pipe = '\\.\pipe\open-deskos-desk-link'

$script:logFailures = 0
function Write-DeskLinkLog([string]$message) {
  try {
    New-Item -ItemType Directory -Force -Path $configDir -ErrorAction Stop | Out-Null
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $message" -ErrorAction Stop
  } catch {
    $script:logFailures += 1
  }
}

function Import-DeviceEnv([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  foreach ($line in Get-Content -LiteralPath $file) {
    $text = $line.Trim()
    if (-not $text -or $text.StartsWith('#')) { continue }
    $index = $text.IndexOf('=')
    if ($index -lt 1) { continue }
    $value = $text.Substring($index + 1)
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
    [Environment]::SetEnvironmentVariable($text.Substring(0, $index).Trim(), $value, 'Process')
  }
  return $true
}

if ($Status) {
  $listening = [bool](Get-NetTCPConnection -LocalPort $(if ($env:ODK_DESK_LINK_PORT) { $env:ODK_DESK_LINK_PORT } else { 8765 }) -State Listen -ErrorAction SilentlyContinue)
  "desk-link: entry=$(Test-Path -LiteralPath $entryPoint) pipe=$([bool](Test-Path -LiteralPath $pipe)) listening=$listening log=$log"
  if (-not (Test-Path -LiteralPath $entryPoint)) { exit 1 }
  if (-not (Test-Path -LiteralPath $pipe)) { exit 1 }
  exit 0
}

Write-DeskLinkLog "desk link loop starting (log: $log)"
while ($true) {
  $envFileLoaded = Import-DeviceEnv $envFile
  Write-DeskLinkLog "starting desk link service from $entryPoint (env: $envFileLoaded)"
  # A service that writes a note to standard error is reporting, not failing, and
  # PowerShell turns native stderr into an error record: with Stop it would take the
  # loop down over one informational line, which is what an empty control credential
  # file produces on a report-only desk.
  $strict = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $NodeBin $entryPoint 2>&1 | ForEach-Object { Write-DeskLinkLog "desk-link: $_" }
  } catch {
    Write-DeskLinkLog "desk link service failed to start: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $strict
  }
  Write-DeskLinkLog "desk link service exited; restarting in ${RestartDelaySeconds}s (log failures: $script:logFailures)"
  Start-Sleep -Seconds $RestartDelaySeconds
}
