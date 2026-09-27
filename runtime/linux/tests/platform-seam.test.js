const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveShellHost } = require('../src/platform')

const WINDOWS = { platform: 'win32', arch: 'x64' }
const REFERENCE = { platform: 'linux', arch: 'arm64' }

test('the reference host keeps the Linux state directory and socket endpoints', () => {
  const host = resolveShellHost({
    ...REFERENCE,
    env: { XDG_STATE_HOME: '/home/desk/.local/state', XDG_RUNTIME_DIR: '/run/user/1000' },
    homedir: '/home/desk',
  })

  assert.equal(host.id, 'linux-arm64')
  assert.equal(host.isReference, true)
  assert.equal(host.supported, true)
  assert.equal(host.isWindows, false)
  assert.equal(host.stateDir, path.join('/home/desk/.local/state', 'open-deskos'))
  assert.equal(host.runtimeDir, '/run/user/1000')
  assert.equal(host.endpoint('user-app-control'), path.join('/run/user/1000', 'open-deskos-apps', 'control.sock'))
  assert.equal(host.endpoint('remote-bridge'), path.join('/run/user/1000', 'open-deskos-remote', 'bridge.sock'))
  assert.equal(host.endpoint('voice-agent'), path.join('/run/user/1000', 'open-deskos-voice', 'agent.sock'))
  assert.equal(host.endpoint('desk-link'), path.join('/run/user/1000', 'open-deskos-desk-link', 'service.sock'))
  assert.equal(host.provisionsUserAppControl, true)
})

test('a Unix host without an absolute runtime directory provisions nothing', () => {
  const host = resolveShellHost({ ...REFERENCE, env: {}, homedir: '/home/desk' })

  assert.equal(host.runtimeDir, null)
  assert.equal(host.endpoint('user-app-control'), null)
  assert.equal(host.provisionsUserAppControl, false)
  assert.equal(host.stateDir, path.join('/home/desk', '.local/state', 'open-deskos'))
})

test('a Windows host resolves Windows state and pipe endpoints', () => {
  const host = resolveShellHost({
    ...WINDOWS,
    env: { LOCALAPPDATA: 'C:\\Users\\desk\\AppData\\Local', XDG_RUNTIME_DIR: '/run/user/1000' },
    homedir: 'C:\\Users\\desk',
  })

  assert.equal(host.id, 'win32-x64')
  assert.equal(host.isReference, false)
  assert.equal(host.supported, true)
  assert.equal(host.isWindows, true)
  assert.equal(host.stateDir, 'C:\\Users\\desk\\AppData\\Local\\open-deskos')
  assert.equal(host.runtimeDir, null)
  assert.equal(host.endpoint('user-app-control'), '\\\\.\\pipe\\open-deskos-user-app-control')
  assert.equal(host.endpoint('remote-bridge'), '\\\\.\\pipe\\open-deskos-remote-bridge')
  assert.equal(host.endpoint('voice-agent'), '\\\\.\\pipe\\open-deskos-voice-agent')
  assert.equal(host.endpoint('desk-link'), '\\\\.\\pipe\\open-deskos-desk-link')
  assert.equal(host.localChannelTokenFile, 'C:\\Users\\desk\\AppData\\Local\\open-deskos\\local-channel.token')
  // The pipe exists for an external agent; it is bound, and the channel token is
  // what authenticates a client there, because a pipe carries no owner to check.
  assert.equal(host.provisionsUserAppControl, true)
})

test('a Windows host without a local application data root still resolves one', () => {
  const host = resolveShellHost({ ...WINDOWS, env: {}, homedir: 'C:\\Users\\desk' })

  assert.equal(host.stateDir, 'C:\\Users\\desk\\AppData\\Local\\open-deskos')
})

test('a host outside the supported set is reported as unsupported', () => {
  const darwin = resolveShellHost({ platform: 'darwin', arch: 'arm64', env: {}, homedir: '/Users/desk' })
  assert.equal(darwin.supported, false)
  assert.equal(darwin.isWindows, false)

  const windowsArm = resolveShellHost({ platform: 'win32', arch: 'arm64', env: {}, homedir: 'C:\\Users\\desk' })
  assert.equal(windowsArm.supported, false)
  assert.equal(windowsArm.isWindows, true, 'the platform is still Windows; only the architecture is unsupported')

  const linuxX64 = resolveShellHost({ platform: 'linux', arch: 'x64', env: {}, homedir: '/home/desk' })
  assert.equal(linuxX64.supported, true)
  assert.equal(linuxX64.isReference, false)
})

test('an unknown logical name has no endpoint on either host', () => {
  const unix = resolveShellHost({ ...REFERENCE, env: { XDG_RUNTIME_DIR: '/run/user/1000' }, homedir: '/home/desk' })
  const windows = resolveShellHost({ ...WINDOWS, env: {}, homedir: 'C:\\Users\\desk' })

  assert.equal(unix.endpoint('not-a-link'), null)
  assert.equal(windows.endpoint('not-a-link'), null)
})

test('the resolved host defaults to the running host', () => {
  const host = resolveShellHost()

  assert.equal(host.platform, process.platform)
  assert.equal(host.arch, process.arch)
  assert.equal(host.id, `${process.platform}-${process.arch}`)
})