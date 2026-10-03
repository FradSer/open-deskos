# Provision the resident Desk Link Service on a Windows Shell Host.
#
# The service is what lets another machine's Pi sessions reach this desk, and what
# gives this desk the reported sessions and their events. It is staged as its own
# interactive task with a restart loop, the counterpart of the systemd unit on a
# Unix host; nothing here starts unless it is asked to.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-desk-link.ps1 -Report
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-desk-link.ps1 -Start
#
# Run it from an SSH session or the login session: a task cannot register a task.

param(
  [string]$TaskName = 'OdkDeskLink',
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot '..'),
  [switch]$Report,
  [switch]$Start
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::ASCII

$launcher = Join-Path $PSScriptRoot 'windows-desk-link.ps1'
$entryPoint = Join-Path $RuntimeRoot 'scripts\desk-link-service.js'
$envFile = Join-Path $RuntimeRoot '.env.local'
$configDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'open-deskos' } else { $env:TEMP }
$tokenFile = Join-Path $env:USERPROFILE '.config\open-deskos\desk-link.token'
$controlFile = Join-Path $env:USERPROFILE '.config\open-deskos\desk-link-control.credential'
$pipe = '\\.\pipe\open-deskos-desk-link'

$needs = @()
# A zero-byte file reads as null rather than as an empty string, so every read of a
# credential file goes through one helper rather than being trimmed in place.
function File-Value([string]$file) {
  if (-not (Test-Path -LiteralPath $file)) { return '' }
  $raw = Get-Content -LiteralPath $file -Raw -ErrorAction SilentlyContinue
  if ($null -eq $raw) { return '' }
  return $raw.Trim()
}

if (-not (Test-Path -LiteralPath $entryPoint)) { $needs += "service entry point missing: $entryPoint" }
if (-not (Test-Path -LiteralPath $launcher)) { $needs += "launcher missing: $launcher" }
if (-not (Test-Path -LiteralPath $envFile)) { $needs += "device configuration missing: $envFile" }
if (-not (Test-Path -LiteralPath $tokenFile)) { $needs += "reporting token missing: $tokenFile" }
elseif ((File-Value $tokenFile).Length -eq 0) { $needs += "reporting token file holds no value: $tokenFile" }
# An empty control credential is not fatal: the desk then accepts reporting only,
# which is a truthful state, but the operator should hear it once.
$controlOnly = (Test-Path -LiteralPath $controlFile) -and (File-Value $controlFile).Length -eq 0
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if ($null -eq $node) { $needs += 'node.exe is not on PATH' }

"desk-link: node=$($null -ne $node) pipe=$([bool](Test-Path -LiteralPath $pipe)) token=$([bool](Test-Path -LiteralPath $tokenFile)) control-credential=$(if ($controlOnly) { 'empty' } else { 'present' })"
foreach ($need in $needs) { "needs: $need" }
if ($controlOnly) { "note: an empty control credential means this desk accepts reporting only; another machine cannot drive its Hosted Pi sessions" }

if ($Report) { exit 0 }
if ($needs.Count -gt 0) { 'nothing was installed or registered; fix the items above first'; exit 1 }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`" -RuntimeRoot `"$RuntimeRoot`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
"registered $TaskName (interactive logon, restart loop); launcher: $launcher"

if ($Start) {
  Start-ScheduledTask -TaskName $TaskName
  for ($i = 0; $i -lt 30; $i++) { if (Test-Path -LiteralPath $pipe) { break }; Start-Sleep -Seconds 1 }
  "started $TaskName; pipe present=$([bool](Test-Path -LiteralPath $pipe))"
}
