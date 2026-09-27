# Provision Tailscale for a desk on a Windows Shell Host.
#
# The reuse rule is the point of this script: a host that already has Tailscale
# keeps its installation, its login, and its configuration, and this script only
# reports it. Only a host with no installation gets one.
#
#   powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1 -Report
#
# -Report never installs anything, which is what a diagnostic or an automated
# check wants. The login is deliberately not automated: it is the host owner's
# act (the CLI prints a login URL, or the tray application offers one), and no
# credential is stored by this script.

param(
  [string]$Command = (Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'),
  [switch]$Report
)

$ErrorActionPreference = 'Stop'

function Get-TailscaleState([string]$binary) {
  if (-not (Test-Path -LiteralPath $binary)) { return 'absent' }
  try {
    $json = & $binary status --json 2>$null | Out-String
    if (-not $json.Trim()) { return 'installed-unreadable' }
    $status = $json | ConvertFrom-Json
    if ($status.BackendState -eq 'Running') { return 'connected' }
    if ($status.BackendState -eq 'NeedsLogin') { return 'needs-login' }
    if ($status.BackendState -eq 'Stopped') { return 'installed-stopped' }
    return "installed-$($status.BackendState)"
  } catch {
    return 'installed-unreadable'
  }
}

$state = Get-TailscaleState $Command
"tailscale: $state ($Command)"

if ($state -ne 'absent') {
  # Reuse: an installation of the host's own is used as it is.
  "reused the host installation; nothing was installed, changed, or logged in"
  if ($state -eq 'needs-login') {
    "complete the login on the desk: run `"$Command up`" and open the URL it prints, or use the Tailscale tray application"
  }
  exit 0
}

if ($Report) {
  "absent: Tailscale is not installed on this host"
  exit 0
}

"installing Tailscale for this host (machine scope)"
if (Get-Command winget.exe -ErrorAction SilentlyContinue) {
  winget.exe install --id Tailscale.Tailscale -e --scope machine --accept-package-agreements --accept-source-agreements --disable-interactivity
} else {
  $msi = Join-Path $env:TEMP 'tailscale-setup-amd64.msi'
  Invoke-WebRequest -Uri 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' -OutFile $msi -UseBasicParsing
  Start-Process msiexec.exe -ArgumentList @('/i', $msi, '/quiet', '/norestart') -Wait
}

$after = Get-TailscaleState $Command
"tailscale: $after"
if ($after -eq 'needs-login') {
  "complete the login on the desk: run `"$Command up`" and open the URL it prints, or use the Tailscale tray application"
}