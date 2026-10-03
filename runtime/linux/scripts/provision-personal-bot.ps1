# Provision the resident Personal Bot on a Windows Shell Host.
#
# The service runs in the logged-on session because a microphone opened in
# session 0 has no audio endpoint, so it is an interactive scheduled task with a
# restart loop rather than a Windows service. This script stages that task, states
# exactly what the host is missing, and installs nothing unless it is told to.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1 -Report
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1 -InstallFfmpeg
#
# Run it from an SSH session or the login session: Windows blocks a scheduled
# task from registering another task, so this must never run from inside one.
#
# Reuse rules, in the same spirit as scripts/provision-tailscale.ps1: a host that
# already has ffmpeg keeps its own, and an existing OdkPersonalBot task is updated in
# place rather than duplicated.

param(
  [string]$TaskName = 'OdkPersonalBot',
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot '..'),
  [switch]$Report,
  [switch]$InstallFfmpeg,
  [switch]$Start
)

$ErrorActionPreference = 'Stop'

# A release flattens runtime/linux to the release root and keeps integrations/
# beside it; a development checkout keeps runtime/linux as a directory and
# integrations/ at the repository root, two levels up. Both layouts are probed so
# this host reports the truth instead of one layout's path.
$personalBotCandidates = @(
  (Join-Path $RuntimeRoot 'integrations\personal-bot'),
  (Join-Path (Join-Path (Join-Path $RuntimeRoot '..') '..') 'integrations\personal-bot')
)
$personalBotRoot = $null
foreach ($candidate in $personalBotCandidates) {
  if (Test-Path -LiteralPath (Join-Path $candidate 'src\main.mjs')) { $personalBotRoot = $candidate; break }
}
if (-not $personalBotRoot) { $personalBotRoot = $personalBotCandidates[0] }

$configDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'open-deskos' } else { $env:TEMP }
$personalBotEnv = Join-Path $configDir 'personal-bot.env'
if (-not (Test-Path $personalBotEnv)) { $personalBotEnv = Join-Path $configDir 'voice-agent.env' }
$runtimeEnv = Join-Path $configDir 'runtime.env'
$launcher = Join-Path $PSScriptRoot 'windows-personal-bot.ps1'
$entryPoint = Join-Path $personalBotRoot 'src\main.mjs'
$token = Join-Path $configDir 'local-channel.token'

function Test-Command([string]$name) {
  return (Get-Command $name -ErrorAction SilentlyContinue) -ne $null
}

$problems = @()

if (-not (Test-Path -LiteralPath $entryPoint)) { $problems += "personal bot entry point missing: $entryPoint" }
if (-not (Test-Path -LiteralPath $launcher)) { $problems += "Personal Bot launcher missing: $launcher" }
if (-not (Test-Command 'node.exe')) { $problems += 'node.exe is not on PATH' }
if (-not (Test-Path -LiteralPath $runtimeEnv)) { $problems += "shared device configuration missing: $runtimeEnv (ODESK_WORKSPACE)" }
if (-not (Test-Path -LiteralPath $personalBotEnv)) { $problems += "Personal Bot configuration missing: $personalBotEnv (transcription provider, model, ALIYUNCS_TOKEN)" }
if (-not (Test-Command 'ffmpeg.exe')) { $problems += 'ffmpeg is not on PATH; Windows capture needs it for DirectShow input' }
$listening = Test-Path -LiteralPath '\\.\pipe\open-deskos-personal-bot'
"personal-bot: node=$((Test-Command 'node.exe')) ffmpeg=$((Test-Command 'ffmpeg.exe')) pipe=$listening token=$([bool](Test-Path -LiteralPath $token))"
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
  'ffmpeg is missing and was not installed; pass -InstallFfmpeg or install it yourself'
  exit 1
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
"the service reads $runtimeEnv and $personalBotEnv, and the channel token is $token"

# Retire the previous product service before admitting microphone capture.
$legacyTask = Get-ScheduledTask -TaskName OdkVoice -ErrorAction SilentlyContinue
if ($legacyTask) {
  Stop-ScheduledTask -TaskName OdkVoice
  Disable-ScheduledTask -TaskName OdkVoice | Out-Null
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine -match '[\\/]integrations[\\/]voice-agent[\\/]src[\\/]main\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
}

# Run under the installer identity before the limited interactive task.
& node.exe (Join-Path $personalBotRoot 'src\migrate-personal-bot.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Personal Bot state migration failed; task remains stopped' }

if ($Start) {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  "started $TaskName; pipe present=$([bool](Test-Path -LiteralPath '\\.\pipe\open-deskos-personal-bot'))"
}
