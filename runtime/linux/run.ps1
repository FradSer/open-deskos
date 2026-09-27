# Windows Shell Host entry point for the Display Shell.
#
# The CM5 entry point is run.sh. This one exists because a Windows host has no
# bash, while .env.local stays the place device-local values live.
#
#   pwsh -File run.ps1
#   pwsh -File run.ps1 -Kiosk
#   pwsh -File run.ps1 -SkipStyles --disable-gpu

[CmdletBinding()]
param(
  [switch]$Kiosk,
  [switch]$SkipStyles,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ShellArgs
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

# Secrets stay outside version control and out of releases, exactly as on the
# CM5 host: KEY=VALUE per line, comments and blank lines ignored.
$envFile = Join-Path $PSScriptRoot '.env.local'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) { continue }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
    Set-Item -Path "Env:$name" -Value $value
  }
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Error 'dependencies not installed; run: pnpm install'
  exit 1
}

if (-not $SkipStyles) {
  $unocss = Join-Path $PSScriptRoot 'node_modules\@unocss\cli\bin\unocss.mjs'
  if (Test-Path -LiteralPath $unocss) {
    # No new window: a kiosk desk must not flash a console while it builds styles.
    $styles = Start-Process -FilePath 'node' -ArgumentList @($unocss, 'src/renderer/**/*.html', 'src/renderer/**/*.js', '-c', 'uno.config.mjs', '-o', 'src/renderer/uno.css', '--minify') -NoNewWindow -Wait -PassThru
    if ($styles.ExitCode -ne 0) { exit $styles.ExitCode }
  }
}

# The electron package records the path to its own binary. Reading that file
# avoids spawning `node`, which is a console program and would flash a window on
# a kiosk desk where nothing may appear over the shell.
$pathFile = Join-Path $PSScriptRoot 'node_modules\electron\path.txt'
$electron = ''
if (Test-Path -LiteralPath $pathFile) {
  $binary = (Get-Content -LiteralPath $pathFile -Raw).Trim()
  $electron = Join-Path $PSScriptRoot "node_modules\electron\dist\$binary"
}
if (-not $electron -or -not (Test-Path -LiteralPath $electron)) {
  $electron = (& node -e "process.stdout.write(String(require('electron')))")
}
if (-not $electron -or -not (Test-Path -LiteralPath $electron)) {
  Write-Error 'the Electron binary is missing; run: pnpm install'
  exit 1
}

if ($Kiosk) { $env:ODESK_SHELL_KIOSK = '1' }
# A kiosk panel is always on; the platform's own idle blanking is not the desk's.
if ($Kiosk -and $ShellArgs -notcontains '--kiosk') { $ShellArgs = @('--kiosk') + $ShellArgs }

$arguments = @('.') + $ShellArgs
& $electron @arguments
exit $LASTEXITCODE