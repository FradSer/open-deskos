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
$previous = $env:ODESK_TEST_MIC
try {
  [IO.File]::WriteAllText($file, "ODESK_TEST_MIC=$value`n", (New-Object Text.UTF8Encoding($false)))
  Import-DeviceEnv $file | Out-Null
  if ($env:ODESK_TEST_MIC -cne $value) { throw 'UTF8 microphone name changed during Import-DeviceEnv' }
  'UTF8_ENV_REGRESSION_PASS'
} finally {
  Remove-Item $file -Force
  [Environment]::SetEnvironmentVariable('ODESK_TEST_MIC', $previous, 'Process')
}
