# Run only in an interactive Windows session, for example an isolated scheduled
# task using the Shell user's principal. Does not stop or reconfigure the Shell.
param(
  [Parameter(Mandatory=$true)][string]$RuntimeRoot,
  [Parameter(Mandatory=$true)][string]$PersonalBotRoot,
  [Parameter(Mandatory=$true)][string]$JevKey,
  [Parameter(Mandatory=$true)][string]$Receipt,
  [switch]$GeneratedE2E,
  [switch]$ActualWidgetE2E,
  [string]$Owner,
  [string[]]$EnvFile=@()
)
$ErrorActionPreference='Stop'
if([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){throw 'Interactive session required'}
$Receipt=[IO.Path]::GetFullPath($Receipt)
$dir=[IO.Path]::GetDirectoryName($Receipt)
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$electron=Join-Path $RuntimeRoot 'node_modules\electron\dist\electron.exe'
$harness=Join-Path $PSScriptRoot 'proactive-jev-e2e.cjs'
$arguments='"'+$harness+'" --live-jev-e2e --runtime-root "'+$RuntimeRoot+'" --personal-bot-root "'+$PersonalBotRoot+'" --jev-key "'+$JevKey+'" --receipt "'+$Receipt+'"'
if($GeneratedE2E){$arguments+=' --generated-e2e'}
if($ActualWidgetE2E){
  if(-not $GeneratedE2E -or -not $Owner -or $Owner.Contains('"')){throw 'Actual Widget E2E requires GeneratedE2E and a valid owner path'}
  $arguments+=' --actual-widget-e2e --owner "'+[IO.Path]::GetFullPath($Owner)+'"'
}
foreach($file in $EnvFile){
  if($file.Contains('"')){throw 'Invalid environment file path'}
  $arguments+=' --env-file "'+[IO.Path]::GetFullPath($file)+'"'
}
$p=Start-Process -FilePath $electron -ArgumentList $arguments -PassThru -Wait -RedirectStandardOutput (Join-Path $dir 'stdout.log') -RedirectStandardError (Join-Path $dir 'stderr.log')
if(Test-Path -LiteralPath $Receipt){
  $report=Get-Content -LiteralPath $Receipt -Raw -Encoding UTF8 | ConvertFrom-Json
  $profile=[IO.Path]::GetFullPath($report.fixtureProfile)
  if([IO.Path]::GetDirectoryName($profile).TrimEnd('\') -ne $env:TEMP.TrimEnd('\') -or -not ([IO.Path]::GetFileName($profile).StartsWith('odk-jev-e2e-'))){throw 'Unexpected E2E profile path'}
  # Chromium releases profile handles only after its process has exited.
  Remove-Item -LiteralPath $profile -Recurse
  $report | Add-Member -NotePropertyName cleanupComplete -NotePropertyValue $true
  $report | Add-Member -NotePropertyName processExit -NotePropertyValue $p.ExitCode
  [IO.File]::WriteAllText($Receipt,($report | ConvertTo-Json -Depth 25),(New-Object Text.UTF8Encoding($false)))
}
exit $p.ExitCode
