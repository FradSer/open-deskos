const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { resolveUserAppSurface } = require('../src/user-app-system')
const { resolveShellHost } = require('../src/platform')

// Every case states its host: the surface resolves the running host otherwise,
// which would make these assertions test the machine that runs them instead of
// the host under test.
const UNIX_ENV = { XDG_STATE_HOME: '/home/desk/.local/state', XDG_RUNTIME_DIR: '/run/user/1000' }
const UNIX_HOST = resolveShellHost({ platform: 'linux', arch: 'arm64', env: UNIX_ENV, homedir: '/home/desk' })
const BARE_UNIX_ENV = {}
const BARE_UNIX_HOST = resolveShellHost({ platform: 'linux', arch: 'arm64', env: BARE_UNIX_ENV, homedir: '/home/desk' })

test('a Unix host keeps its state directory and control endpoint', () => {
  const surface = resolveUserAppSurface({ env: UNIX_ENV, host: UNIX_HOST })

  assert.equal(surface.stateDir, path.join('/home/desk/.local/state', 'open-deskos', 'user-apps'))
  assert.equal(surface.controlEndpoint, path.join('/run/user/1000', 'open-deskos-apps', 'control.sock'))
})

test('a Windows host keeps its state under Windows application data and reaches its control endpoint by pipe', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\desk\\AppData\\Local', XDG_RUNTIME_DIR: '/run/user/1000' }
  const surface = resolveUserAppSurface({
    env,
    host: resolveShellHost({ platform: 'win32', arch: 'x64', env, homedir: 'C:\\Users\\desk' }),
  })

  assert.equal(surface.stateDir, 'C:\\Users\\desk\\AppData\\Local\\open-deskos\\user-apps')
  // The endpoint exists for an external agent on this machine too. A named pipe
  // has no owner to authenticate with, so the channel token does it instead.
  assert.equal(surface.controlEndpoint, '\\\\.\\pipe\\open-deskos-user-app-control')
})

test('a Unix host without a runtime directory provisions no control endpoint', () => {
  const surface = resolveUserAppSurface({ env: BARE_UNIX_ENV, host: BARE_UNIX_HOST })

  assert.equal(surface.stateDir, path.join('/home/desk', '.local/state', 'open-deskos', 'user-apps'))
  assert.equal(surface.controlEndpoint, null)
})