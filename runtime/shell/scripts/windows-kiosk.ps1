# Runs the desk as a panel on a Windows Shell Host.
#
# Two things the cross-platform launcher does not do:
#   * the desk restarts after an exit, the way scripts/start-kiosk.sh does on the
#     reference host.
#   * one log records every start and every line the shell printed, so a remote
#     operator can see what happened without a console window on the desk.
#
# It deliberately does **not** hide the taskbar. This is a machine that runs other
# applications: the desk is fullscreen while it is the active window (Windows hides
# the taskbar for a fullscreen window itself), and switching to another window
# brings that window and the taskbar back. Hiding the shell would make the other
# applications unreachable.
#
# Run it from the kiosk user's own interactive session (a scheduled task with
# `-LogonType Interactive`), never from an SSH session: a GUI started in session 0
# has no desktop to appear on. A *task* cannot register another task, so anything
# that creates tasks must run outside the task scheduler.

param(
  [string]$RuntimeRoot = (Join-Path $PSScriptRoot '..'),
  [int]$RestartDelaySeconds = 3
)

$ErrorActionPreference = 'Stop'

# A log write must never take the panel down: a desk that stops because its log
# file could not be appended is worse than a desk with no log. Failures are
# counted so an operator still learns that logging is impaired.
$script:logFailures = 0

$fallbackLogDir = if ($env:TEMP) { Join-Path $env:TEMP 'open-deskos' } else { $PSScriptRoot }
$logDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'open-deskos' } else { $fallbackLogDir }
try {
  New-Item -ItemType Directory -Force -Path $logDir -ErrorAction Stop | Out-Null
} catch {
  $logDir = $fallbackLogDir
}
$log = Join-Path $logDir 'kiosk.log'

function Write-KioskLog([string]$message) {
  try {
    Add-Content -LiteralPath $log -Value "$(Get-Date -Format s) $message" -ErrorAction Stop
  } catch {
    $script:logFailures += 1
  }
}

Write-KioskLog "panel loop starting (log: $log)"
while ($true) {
  Write-KioskLog "starting kiosk shell from $RuntimeRoot"
  # The shell's own output is a convenience, not a channel the panel depends on.
  try {
    & powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File (Join-Path $RuntimeRoot 'run.ps1') -Kiosk -SkipStyles 2>&1 |
      ForEach-Object { Write-KioskLog "shell: $_" }
  } catch {
    Write-KioskLog "shell failed to start: $($_.Exception.Message)"
  }
  Write-KioskLog "shell exited; restarting in ${RestartDelaySeconds}s (log failures: $script:logFailures)"
  Start-Sleep -Seconds $RestartDelaySeconds
}