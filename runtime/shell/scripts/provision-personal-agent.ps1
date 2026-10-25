# Provision the resident Personal Agent on a Windows Shell Host.
#
# The service runs in the logged-on session because a microphone opened in
# session 0 has no audio endpoint, so it is an interactive scheduled task with a
# restart loop rather than a Windows service. This script stages that task, states
# exactly what the host is missing, and installs nothing unless it is told to.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-agent.ps1 -Report
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-agent.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-agent.ps1 -InstallFfmpeg
#
# Run it from an SSH session or the login session: Windows blocks a scheduled
# task from registering another task, so this must never run from inside one.
#
# Reuse rules, in the same spirit as scripts/provision-tailscale.ps1: a host that
# already has ffmpeg keeps its own, and an existing OdkPersonalAgent task is updated in
# place rather than duplicated.

param(
  [string]$TaskName = 'OdkPersonalAgent',
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot '..'),
  [switch]$Report,
  [switch]$InstallFfmpeg,
  [switch]$Start
)

$ErrorActionPreference = 'Stop'

# A release flattens runtime/shell to the release root and keeps integrations/
# beside it; a development checkout keeps runtime/shell as a directory and
# integrations/ at the repository root, two levels up. Both layouts are probed so
# this host reports the truth instead of one layout's path.
$personalAgentCandidates = @(
  (Join-Path $RuntimeRoot 'integrations\personal-agent'),
  (Join-Path (Join-Path (Join-Path $RuntimeRoot '..') '..') 'integrations\personal-agent')
)
$personalAgentRoot = $null
foreach ($candidate in $personalAgentCandidates) {
  if (Test-Path -LiteralPath (Join-Path $candidate 'src\display-client.mjs')) { $personalAgentRoot = $candidate; break }
}
if (-not $personalAgentRoot) { $personalAgentRoot = $personalAgentCandidates[0] }

$configDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'odk' } else { $env:TEMP }
$personalAgentEnv = Join-Path $configDir 'perosnal-agent.env'
if (-not (Test-Path $personalAgentEnv)) { $personalAgentEnv = Join-Path $configDir 'voice-agent.env' }
$runtimeEnv = Join-Path $configDir 'runtime.env'
$launcher = Join-Path $PSScriptRoot 'windows-personal-agent.ps1'
$entryPoint = Join-Path $personalAgentRoot 'src\display-client.mjs'
$token = Join-Path $configDir 'local-channel.token'

function Test-Command([string]$name) {
  return (Get-Command $name -ErrorAction SilentlyContinue) -ne $null
}

$problems = @()

if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) { $problems += "Personal Agent entry point missing: $entryPoint" }
if (-not (Test-Path -LiteralPath $launcher)) { $problems += "Personal Agent launcher missing: $launcher" }
if (-not (Test-Command 'ssh.exe')) { $problems += 'ssh.exe is required for the central Personal Agent' }
if (-not (Test-Command 'node.exe')) { $problems += 'node.exe is not on PATH' }
if (-not (Test-Command 'ffmpeg.exe')) { $problems += 'ffmpeg is not on PATH; Windows capture needs it for DirectShow input' }
# Read only the fixed central alias; do not import provider configuration.
$mainSsh = ''
foreach ($file in @($runtimeEnv, (Join-Path $configDir 'voice-agent.env'), (Join-Path $configDir 'perosnal-agent.env'))) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
  foreach ($line in Get-Content -LiteralPath $file -Encoding UTF8) {
    if ($line -match '^\s*ODK_PERSONAL_AGENT_MAIN_SSH\s*=(.*)$') {
      $mainSsh = $Matches[1]
      if ($mainSsh.Length -ge 2 -and $mainSsh.StartsWith('"') -and $mainSsh.EndsWith('"')) { $mainSsh = $mainSsh.Substring(1, $mainSsh.Length - 2) }
    }
  }
}
if ($mainSsh -cne 'odk-cm5-agent') { $problems += 'configure ODK_PERSONAL_AGENT_MAIN_SSH=odk-cm5-agent; no local agent fallback is available' }
$listening = Test-Path -LiteralPath '\\.\pipe\odk-personal-agent'
"personal-agent: node=$((Test-Command 'node.exe')) ffmpeg=$((Test-Command 'ffmpeg.exe')) pipe=$listening token=$([bool](Test-Path -LiteralPath $token))"
foreach ($problem in $problems) { "needs: $problem" }

if ($Report) { exit 0 }

if ($problems | Where-Object { $_ -notlike 'ffmpeg*' }) { 'nothing was installed or registered; fix the items above first'; exit 1 }

if (-not (Test-Command 'ffmpeg.exe') -and $InstallFfmpeg) {
  'installing ffmpeg for this host (machine scope)'
  if (Test-Command 'winget.exe') {
    winget.exe install --id Gyan.FFmpeg -e --scope machine --accept-package-agreements --accept-source-agreements --disable-interactivity
    if ($LASTEXITCODE -ne 0) { "ffmpeg install failed with exit $LASTEXITCODE" ; exit 1 }
  } else {
    'winget is unavailable; install ffmpeg from a trusted build and put it on PATH, then re-run with -Report'
    exit 1
  }
  'ffmpeg installed; a new session is needed before this shell sees it on PATH'
} elseif (-not (Test-Command 'ffmpeg.exe')) {
  'ffmpeg is missing; microphone capture is unavailable; display and keyboard input remain available'
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
# A handheld on battery suspends and drops Wi-Fi, which is what interrupts a long
# capture; the same settings the panel task uses.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
# The bare user name maps correctly on a Microsoft account where USERDOMAIN\USER does not.
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
"registered $TaskName (interactive logon, restart loop); launcher: $launcher"
"the service reads $runtimeEnv and $personalAgentEnv, and the channel token is $token"

# Retire the previous product service before admitting microphone capture.
$legacyTask = Get-ScheduledTask -TaskName OdkVoice -ErrorAction SilentlyContinue
if ($legacyTask) {
  Stop-ScheduledTask -TaskName OdkVoice
  Disable-ScheduledTask -TaskName OdkVoice | Out-Null
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine -match '[\\/]integrations[\\/]voice-agent[\\/]src[\\/]main\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

# Keep the old task declaration for recovery, but prevent a second display relay.
$previousAgentTask = Get-ScheduledTask -TaskName OdkPersonalBot -ErrorAction SilentlyContinue
if ($previousAgentTask -and $TaskName -ne 'OdkPersonalBot') {
  Stop-ScheduledTask -TaskName OdkPersonalBot
  Disable-ScheduledTask -TaskName OdkPersonalBot | Out-Null
}

# Existing Windows agent history stays on disk. The display does not migrate it
# into the central agent or resume old local task state.

if ($Start) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  "started $TaskName; pipe present=$([bool](Test-Path -LiteralPath '\\.\pipe\odk-personal-agent'))"
}
