# Runs the Open DeskOS Personal Bot as a resident service on a Windows Shell Host.
#
# Windows owns display, input, and microphone capture. The central CM5 Personal
# Agent owns transcription, inference, memory, and task coordination. This launcher
# never starts the local agent or falls back to a local model.
#
# Run it from the kiosk user's own interactive session (a scheduled task with
# -LogonType Interactive), never from an SSH session: a microphone opened in
# session 0 has no audio endpoint. A *task* cannot register another task, so
# scripts\provision-personal-bot.ps1 must be run from an SSH session or the login
# session, not from inside this one.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-personal-bot.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-personal-bot.ps1 -Status
#
# ASCII only: PowerShell 5.1 reads a BOM-less .ps1 in the system code page, so a
# non-ASCII character here is a syntax error rather than a display glitch.

param(
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot '..'),
  [string]$PersonalBotRoot = '',
  [string]$NodeBin = 'node.exe',
  [int]$RestartDelaySeconds = 10,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'

# The voice package is not inside the runtime tree in both layouts. A release
# flattens runtime/shell to the release root and keeps integrations/ beside it; a
# development checkout keeps runtime/shell as a directory and integrations/ at the
# repository root, two levels up. Both are probed and the one that actually holds
# the entry point is used, rather than one layout being assumed.
$personalBotCandidates = @(
  (Join-Path $RuntimeRoot 'integrations\personal-bot'),
  (Join-Path (Join-Path (Join-Path $RuntimeRoot '..') '..') 'integrations\personal-bot')
)
if (-not $PersonalBotRoot) {
  foreach ($candidate in $personalBotCandidates) {
    if (Test-Path -LiteralPath (Join-Path $candidate 'src\display-client.mjs')) { $PersonalBotRoot = $candidate; break }
  }
  if (-not $PersonalBotRoot) { $PersonalBotRoot = $personalBotCandidates[0] }
}

$configDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'odk' } else { $env:TEMP }
$log = Join-Path $configDir 'personal-bot.log'
$entryPoint = Join-Path $PersonalBotRoot 'src\display-client.mjs'

# A log write must never take the service down: a personal bot service that stopped
# because its log file could not be appended is worse than one with no log.
$script:logFailures = 0

function Write-PersonalBotLog([string]$message) {
  try {
    New-Item -ItemType Directory -Force -Path $configDir -ErrorAction Stop | Out-Null
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $message" -ErrorAction Stop
  } catch {
    $script:logFailures += 1
  }
}

# The same KEY=VALUE format with # comments the Shell's .env.local uses. Values are
# set into this process only: nothing is written back, so a file that is a
# directory, unreadable or missing changes what the service reports rather than
# what an operator's configuration looks like afterwards.
function Import-DeviceEnv([string]$file, [string[]]$AllowedNames) {
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  # PowerShell 5.1 defaults to the host code page; device names may be UTF-8.
  foreach ($line in Get-Content -LiteralPath $file -Encoding UTF8) {
    $text = $line.Trim()
    if (-not $text -or $text.StartsWith('#')) { continue }
    $index = $text.IndexOf('=')
    if ($index -lt 1) { continue }
    $name = $text.Substring(0, $index).Trim()
    if ($AllowedNames -and $name -notin $AllowedNames) { continue }
    $value = $text.Substring($index + 1)
    if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
  return $true
}

# The relay receives OS and microphone configuration, not inherited provider keys.
$displayNames = @('ODK_PERSONAL_AGENT_MAIN_SSH', 'ODK_PERSONAL_BOT_AUDIO_DEVICE')
function Clear-DisplayEnvironment {
  $platformNames = @('PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'TEMP', 'TMP', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'HOMEDRIVE', 'HOMEPATH', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS')
  foreach ($item in Get-ChildItem Env:) {
    if ($item.Name -notin $platformNames) { [Environment]::SetEnvironmentVariable($item.Name, $null, 'Process') }
  }
}
function Read-DisplayConfiguration {
  Clear-DisplayEnvironment
  foreach ($file in @((Join-Path $configDir 'runtime.env'), (Join-Path $configDir 'voice-agent.env'), (Join-Path $configDir 'personal-bot.env'))) {
    Import-DeviceEnv $file -AllowedNames $displayNames | Out-Null
  }
  if ($env:ODK_PERSONAL_AGENT_MAIN_SSH -cne 'odk-cm5-agent') { throw 'Configure ODK_PERSONAL_AGENT_MAIN_SSH=odk-cm5-agent before starting the display client' }
}
if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) { throw 'Personal Agent display entry point is missing' }
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw 'ssh.exe is required for the central Personal Agent' }
Read-DisplayConfiguration

if ($Status) {
  $listening = Test-Path -LiteralPath '\\.\pipe\odk-personal-bot'
  $ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -ne $null
  "personal-bot: entry=$entryPoint exists=$(Test-Path -LiteralPath $entryPoint) pipe=$listening ffmpeg=$ffmpeg log=$log"
  if (-not (Test-Path -LiteralPath $entryPoint)) { exit 1 }
  if (-not $listening) { exit 1 }
  exit 0
}

Write-PersonalBotLog "personal bot service loop starting (log: $log)"
while ($true) {
  # The recorder spawns ffmpeg by name. A logon session's PATH is the one it was
  # started with, so a host that provisioned ffmpeg afterwards would run a service
  # that cannot hear anything; the provisioned copy is found and put on PATH here.
  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  if (-not $ffmpeg) {
    $provisioned = Join-Path $configDir 'tools\ffmpeg\bin\ffmpeg.exe'
    if (Test-Path -LiteralPath $provisioned) {
      $env:PATH = "$env:PATH;$([IO.Path]::GetDirectoryName($provisioned))"
      $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    }
  }
  if (-not $ffmpeg) { Write-PersonalBotLog 'ffmpeg is not on PATH and no provisioned copy was found; captures will report the microphone as unavailable' }
  Read-DisplayConfiguration
  Write-PersonalBotLog "starting Personal Agent display from $entryPoint (ffmpeg=$($ffmpeg.Source))"
  # A service that writes a note to standard error is reporting, not failing, and
  # PowerShell turns native stderr into an error record: with Stop it would take the
  # loop down over one informational line.
  $strict = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    # The service's own output is a convenience, not a channel it depends on.
    & $NodeBin $entryPoint 2>&1 | ForEach-Object { Write-PersonalBotLog "personal-bot: $_" }
  } catch {
    Write-PersonalBotLog "personal bot service failed to start: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $strict
  }
  Write-PersonalBotLog "personal bot service exited; restarting in ${RestartDelaySeconds}s (log failures: $script:logFailures)"
  Start-Sleep -Seconds $RestartDelaySeconds
}
