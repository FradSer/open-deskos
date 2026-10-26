param(
  [Parameter(Mandatory=$true)][string]$Bundle,
  [Parameter(Mandatory=$true)][string]$Python,
  [Parameter(Mandatory=$true)][string]$SerialNumber,
  [switch]$ConfirmFlash
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmFlash) { throw 'Explicit -ConfirmFlash authorization is required.' }
$plan = Get-Content -LiteralPath (Join-Path $Bundle 'firmware.json') -Raw | ConvertFrom-Json
if ($plan.board -ne 'm5stack-nanoc6' -or $plan.chip -ne 'esp32c6') { throw 'Unsupported firmware target.' }
$addresses = @{'bootloader.bin'='0x0';'partition-table.bin'='0x8000';'odk_c6_gateway.bin'='0x10000'}
$seen = @{}
foreach ($file in $plan.files) {
  if ($file.name -notin @('bootloader.bin','partition-table.bin','odk_c6_gateway.bin')) { throw 'Unexpected artifact.' }
  if ($seen.ContainsKey($file.name) -or $file.address -ne $addresses[$file.name]) { throw 'Invalid flash layout.' }
  $seen[$file.name] = $true
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $Bundle $file.name)).Hash.ToLowerInvariant()
  if ($actual -ne $file.sha256) { throw 'Firmware hash mismatch.' }
}
if ($plan.files.Count -ne 3) { throw 'Incomplete firmware bundle.' }
function Find-SelectedPort {
  $ports = & $Python -c 'import json; from serial.tools import list_ports; print(json.dumps([dict(port=p.device,serial=p.serial_number) for p in list_ports.comports() if p.vid==0x303a and p.pid==0x1001]))'
  if ($LASTEXITCODE -ne 0) { throw 'USB inventory failed.' }
  $matches = @((ConvertFrom-Json $ports) | Where-Object { $_.serial -eq $SerialNumber })
  if ($matches.Count -ne 1) { throw 'Selected USB identity is missing or ambiguous.' }
  return $matches[0].port
}
function Invoke-EspTool([string[]]$Arguments) {
  & $Python -m esptool @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Firmware tool failed.' }
}
$port = Find-SelectedPort
Invoke-EspTool @('--chip','esp32c6','--port',$port,'chip-id')
$backupRoot = Join-Path $env:LOCALAPPDATA ('odk\firmware-backups\'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backupRoot | Out-Null
& icacls.exe $backupRoot /inheritance:r /grant:r ($env:USERNAME+':(OI)(CI)F') 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot protect firmware backup.' }
$backup = Join-Path $backupRoot 'previous-flash.bin'
$port = Find-SelectedPort
Invoke-EspTool @('--chip','esp32c6','--port',$port,'--baud','460800','read-flash','0','0x400000',$backup)
if ((Get-Item -LiteralPath $backup).Length -ne 4194304) { throw 'Firmware backup is incomplete.' }
$backupHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backup).Hash.ToLowerInvariant()
$port = Find-SelectedPort
$arguments = @('--chip','esp32c6','--port',$port,'--baud','460800','write-flash','--flash-mode','dio','--flash-size','4MB','--flash-freq','80m')
foreach ($file in $plan.files) { $arguments += @([string]$file.address, (Join-Path $Bundle $file.name)) }
Invoke-EspTool $arguments
@{backup=$backup;backupSha256=$backupHash;serial=$SerialNumber;firmware=$plan.firmware;result='FLASH_OK'} | ConvertTo-Json -Compress
