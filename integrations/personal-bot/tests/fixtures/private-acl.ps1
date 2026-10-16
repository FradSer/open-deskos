# Test fixtures only. Never print owner identities, paths, or file content.
param(
  [Parameter(Mandatory=$true)][ValidateSet('NullDacl','Unprotected','CallbackAllow')][string]$Mode,
  [Parameter(Mandatory=$true)][string]$Path
)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PrivateAclFixture {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
  public static extern uint SetNamedSecurityInfoW(string path, int kind, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
  public static extern uint GetNamedSecurityInfoW(string path, int kind, uint info, IntPtr owner, IntPtr group, out IntPtr dacl, IntPtr sacl, out IntPtr descriptor);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LocalFree(IntPtr pointer);
  public static void Unprotect(string path) {
    IntPtr dacl, descriptor;
    if(GetNamedSecurityInfoW(path,1,4,IntPtr.Zero,IntPtr.Zero,out dacl,IntPtr.Zero,out descriptor)!=0) throw new Exception("Fixture failed");
    try {
      if(SetNamedSecurityInfoW(path,1,0x20000004,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero)!=0) throw new Exception("Fixture failed");
    } finally { LocalFree(descriptor); }
  }
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode)]
  public static extern bool SetFileSecurityW(string path, uint info, byte[] descriptor);
}
'@
if($Mode -eq 'NullDacl'){
 if([PrivateAclFixture]::SetNamedSecurityInfoW($Path,1,4,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero) -ne 0){throw 'Fixture failed'}
} elseif($Mode -eq 'Unprotected'){
 [PrivateAclFixture]::Unprotect($Path)
} else {
 $acl=Get-Acl -LiteralPath $Path
 $raw=New-Object Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(),0)
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $ace=New-Object Security.AccessControl.CommonAce([Security.AccessControl.AceFlags]::None,[Security.AccessControl.AceQualifier]::AccessAllowed,1,$sid,$true,([byte[]]@()))
 $raw.DiscretionaryAcl.InsertAce($raw.DiscretionaryAcl.Count,$ace)
 $bytes=New-Object byte[] $raw.BinaryLength
 $raw.GetBinaryForm($bytes,0)
 if(-not [PrivateAclFixture]::SetFileSecurityW($Path,4,$bytes)){throw 'Fixture failed'}
}
'APPLIED'
