import { createRequire } from 'node:module'

const loadNative = createRequire(import.meta.url)

// Bind only on Windows. Cache functions, never a path, token, or ACL judgment.
export function createWindowsPrivatePaths() {
  const koffi = loadNative('koffi')
  const kernel = koffi.load('kernel32.dll')
  const security = koffi.load('advapi32.dll')
  const bind = (library, declaration) => library.func(declaration)
  const currentProcess = bind(kernel, 'void * __stdcall GetCurrentProcess()')
  const currentThread = bind(kernel, 'void * __stdcall GetCurrentThread()')
  const lastError = bind(kernel, 'uint32_t __stdcall GetLastError()')
  const attributes = bind(kernel, 'uint32_t __stdcall GetFileAttributesW(str16 path)')
  const close = bind(kernel, 'int __stdcall CloseHandle(void *handle)')
  const free = bind(kernel, 'void * __stdcall LocalFree(void *memory)')
  const openProcess = bind(security, 'int __stdcall OpenProcessToken(void *process, uint32_t access, _Out_ void **token)')
  const openThread = bind(security, 'int __stdcall OpenThreadToken(void *thread, uint32_t access, int asSelf, _Out_ void **token)')
  const tokenInfo = bind(security, 'int __stdcall GetTokenInformation(void *token, int kind, _Out_ void *buffer, uint32_t length, _Out_ uint32_t *needed)')
  const validSid = bind(security, 'int __stdcall IsValidSid(void *sid)')
  const sidString = bind(security, 'int __stdcall ConvertSidToStringSidW(void *sid, _Out_ void **text)')
  const getNamed = bind(security, 'uint32_t __stdcall GetNamedSecurityInfoW(str16 path, int kind, uint32_t information, _Out_ void **owner, void *group, _Out_ void **dacl, void *sacl, _Out_ void **descriptor)')
  const setNamed = bind(security, 'uint32_t __stdcall SetNamedSecurityInfoW(str16 path, int kind, uint32_t information, void *owner, void *group, void *dacl, void *sacl)')
  const control = bind(security, 'int __stdcall GetSecurityDescriptorControl(void *descriptor, _Out_ uint16_t *control, _Out_ uint32_t *revision)')
  const getDacl = bind(security, 'int __stdcall GetSecurityDescriptorDacl(void *descriptor, _Out_ int *present, _Out_ void **dacl, _Out_ int *defaulted)')
  const getOwner = bind(security, 'int __stdcall GetSecurityDescriptorOwner(void *descriptor, _Out_ void **owner, _Out_ int *defaulted)')
  const validAcl = bind(security, 'int __stdcall IsValidAcl(void *acl)')
  const aclInfo = bind(security, 'int __stdcall GetAclInformation(void *acl, _Out_ void *information, uint32_t length, int kind)')
  const getAce = bind(security, 'int __stdcall GetAce(void *acl, uint32_t index, _Out_ void **ace)')
  const fromSddl = bind(security, 'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16 text, uint32_t revision, _Out_ void **descriptor, void *size)')
  const userType = koffi.struct({ sid: 'void *', attributes: 'uint32_t' })
  const aclSizeType = koffi.struct({ count: 'uint32_t', used: 'uint32_t', free: 'uint32_t' })
  const aceHeaderType = koffi.struct({ type: 'uint8_t', flags: 'uint8_t', size: 'uint16_t' })
  const unsafe = () => { throw Error('Unsafe private proactive path ACL') }
  const ok = result => { if (!result) unsafe() }

  function textSid(sid) {
    if (sid === null) unsafe()
    ok(validSid(sid))
    const text = [null]
    try { ok(sidString(sid, text)); return koffi.decode.string16(text[0]) }
    finally { if (text[0] !== null) free(text[0]) }
  }

  function currentUser() {
    const token = [null]
    if (!openThread(currentThread(), 8, 1, token)) {
      if (lastError() !== 1008) unsafe() // ERROR_NO_TOKEN only; do not bypass impersonation failures.
      ok(openProcess(currentProcess(), 8, token)) // TOKEN_QUERY
    }
    try {
      const needed = [0]
      if (tokenInfo(token[0], 1, null, 0, needed) || lastError() !== 122 || needed[0] < koffi.sizeof(userType) || needed[0] > 65536) unsafe()
      const buffer = koffi.alloc('uint8_t', needed[0])
      try {
        ok(tokenInfo(token[0], 1, buffer, needed[0], needed)) // TokenUser contains an interior pointer.
        return textSid(koffi.decode(buffer, userType).sid)
      } finally { koffi.free(buffer) }
    } finally { if (token[0] !== null) close(token[0]) }
  }

  function check(path, directory, user, container = false) {
    const owner = [null], dacl = [null], descriptor = [null]
    try {
      if (getNamed(path, 1, 5, owner, null, dacl, null, descriptor) !== 0 || descriptor[0] === null) unsafe()
      const allowed = new Set([user, 'S-1-5-18', 'S-1-5-32-544'])
      if (container ? !allowed.has(textSid(owner[0])) : textSid(owner[0]) !== user) unsafe()
      const present = [0], defaulted = [0]
      ok(getDacl(descriptor[0], present, dacl, defaulted))
      if (!present[0] || dacl[0] === null) unsafe() // A NULL DACL grants everyone access.
      ok(validAcl(dacl[0]))
      const flags = [0], revision = [0]
      ok(control(descriptor[0], flags, revision))
      if (directory && !container && !(flags[0] & 0x1000)) unsafe() // SE_DACL_PROTECTED
      const size = Buffer.alloc(koffi.sizeof(aclSizeType))
      ok(aclInfo(dacl[0], size, size.length, 2)) // AclSizeInformation
      const { count } = koffi.decode(size, aclSizeType)
      for (let index = 0; index < count; index++) {
        const ace = [null]
        ok(getAce(dacl[0], index, ace))
        if (ace[0] === null) unsafe()
        const header = koffi.decode(ace[0], aceHeaderType)
        // Ordinary Allow and Deny ACEs have a SID at offset eight. Reject other layouts.
        if (![0, 1].includes(header.type) || header.size < 16) unsafe()
        const sid = ace[0] + 8n
        const parts = koffi.decode(sid, 'uint8_t', 2)
        if (16 + 4 * parts[1] > header.size) unsafe()
        const identity = textSid(sid)
        if (header.type === 0 && !allowed.has(identity)) unsafe()
      }
    } finally { if (descriptor[0] !== null) free(descriptor[0]) }
  }

  function protect(path, directory, user) {
    const descriptor = [null], owner = [null], dacl = [null]
    try {
      const inheritance = directory ? 'OICI' : ''
      const text = `O:${user}D:P(A;${inheritance};FA;;;${user})(A;${inheritance};FA;;;SY)(A;${inheritance};FA;;;BA)`
      ok(fromSddl(text, 1, descriptor, null))
      const present = [0], defaulted = [0]
      ok(getOwner(descriptor[0], owner, defaulted))
      ok(getDacl(descriptor[0], present, dacl, defaulted))
      if (!present[0] || dacl[0] === null || owner[0] === null) unsafe()
      if (setNamed(path, 1, 0x80000005, owner[0], null, dacl[0], null) !== 0) unsafe()
    } finally { if (descriptor[0] !== null) free(descriptor[0]) }
  }

  return (operation, path, directory) => {
    try {
      const flags = attributes(path)
      if (flags === 0xffffffff || (flags & 0x400) || Boolean(flags & 0x10) !== directory) unsafe()
      const user = currentUser()
      if (operation === 'Protect') protect(path, directory, user)
      else if (operation !== 'Check' && !(operation === 'CheckContainer' && directory)) unsafe()
      check(path, directory, user, operation === 'CheckContainer')
    } catch { unsafe() }
  }
}
