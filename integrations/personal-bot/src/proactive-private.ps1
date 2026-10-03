# ASCII only for Windows PowerShell 5.1. Never print file contents or ACL identities.
param(
  [Parameter(Mandatory=$true)][ValidateSet('Check','Protect')][string]$Operation,
  [Parameter(Mandatory=$true)][string]$Path
)
$ErrorActionPreference = 'Stop'
try {
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe path' }
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $system = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  $administrators = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  if ($Operation -eq 'Protect') {
    $acl = if ($item.PSIsContainer) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
    $acl.SetOwner($user)
    $acl.SetAccessRuleProtection($true, $false)
    $inheritance = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
    foreach ($sid in @($user, $system, $administrators)) {
      $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, [Security.AccessControl.PropagationFlags]::None, 'Allow')
      [void]$acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $acl
  }
  $acl = Get-Acl -LiteralPath $Path
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $user.Value) { throw 'Unsafe owner' }
  $allowed = @($user.Value, $system.Value, $administrators.Value)
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $allowed) { throw 'Broad access' }
  }
  if (-not $acl.AreAccessRulesProtected -and $item.PSIsContainer) { throw 'Inherited directory access' }
  'PRIVATE_PATH_OK'
} catch {
  [Console]::Error.WriteLine('Private proactive path is unavailable or unsafe.')
  exit 1
}
