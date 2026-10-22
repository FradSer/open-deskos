param([string]$Launcher)
$ErrorActionPreference = 'Stop'
$tree = [Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$null, [ref]$null)
$function = $tree.Find({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Import-DeviceEnv'
}, $true)
Invoke-Expression $function.Extent.Text
$file = Join-Path $env:TEMP ('odk-env-test-' + [guid]::NewGuid() + '.env')
# Keep this script ASCII so Windows PowerShell 5.1 can parse it on any code page.
$value = ([char]0x9ea6).ToString() + ([char]0x514b) + ([char]0x98ce) + ' (Realtek High Definition Audio)'
$previous = $env:ODK_TEST_MIC
try {
  [IO.File]::WriteAllText($file, "ODK_TEST_MIC=$value`n", (New-Object Text.UTF8Encoding($false)))
  Import-DeviceEnv $file | Out-Null
  if ($env:ODK_TEST_MIC -cne $value) { throw 'UTF8 microphone name changed during Import-DeviceEnv' }
  $filter = $tree.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Clear-DisplayEnvironment' }, $true)
  Invoke-Expression $filter.Extent.Text
  $oldPath = $env:PATH
  $env:ODK_TEST_PROVIDER_SECRET = 'synthetic-not-a-real-key'
  $env:NODE_OPTIONS = '--trace-warnings'
  Clear-DisplayEnvironment
  if ($env:ODK_TEST_PROVIDER_SECRET -or $env:NODE_OPTIONS) { throw 'Display inherited provider or Node configuration' }
  if ($env:PATH -cne $oldPath) { throw 'Windows PATH changed' }
  [IO.File]::WriteAllText($file, "ODK_PERSONAL_AGENT_MAIN_SSH=odk-cm5-agent`nODK_TEST_PROVIDER_SECRET=synthetic`nODK_PERSONAL_AGENT_AUDIO_DEVICE=$value`n", (New-Object Text.UTF8Encoding($false)))
  Import-DeviceEnv $file -AllowedNames @('ODK_PERSONAL_AGENT_MAIN_SSH', 'ODK_PERSONAL_AGENT_AUDIO_DEVICE') | Out-Null
  if ($env:ODK_TEST_PROVIDER_SECRET) { throw 'Display imported provider configuration' }
  if ($env:ODK_PERSONAL_AGENT_MAIN_SSH -cne 'odk-cm5-agent' -or $env:ODK_PERSONAL_AGENT_AUDIO_DEVICE -cne $value) { throw 'Display configuration changed' }
  'UTF8_ENV_REGRESSION_PASS'
} finally {
  Remove-Item $file -Force
  [Environment]::SetEnvironmentVariable('ODK_TEST_MIC', $previous, 'Process')
}
