'use strict'
const { integrationURL, findRepositoryRoot } = require('./helpers/repo-root')

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { resolveShellHost } = require('../src/platform')

// Keep the retired spelling assembled so the namespace scan can reject aliases.
const retiredData = ['desk', 'data'].join('-')

test('host state and data channels use the ODK namespace without aliases', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    const host = resolveShellHost({
      platform, arch: 'x64', homedir: '/home/test',
      env: { XDG_RUNTIME_DIR: '/run/user/1000', LOCALAPPDATA: 'C:\\Local' },
    })
    assert.match(host.stateDir, /[/\\]odk$/)
    assert.equal(host.endpoint(retiredData), null)
    assert.equal(host.endpoint('odk-data'), platform === 'win32'
      ? '\\\\.\\pipe\\odk-data' : path.join('/run/user/1000', 'odk-data', 'service.sock'))
  }
})

test('Personal Bot and Shell resolve the same default data endpoints', async () => {
  const { odkDataEndpoint } = await import(integrationURL('personal-bot/src/odk-data.mjs'))
  for (const platform of ['linux', 'win32']) {
    const env = { XDG_RUNTIME_DIR: '/run/user/1000', LOCALAPPDATA: 'C:\\Local' }
    const host = resolveShellHost({ platform, arch: 'x64', env, homedir: '/home/test' })
    assert.equal(odkDataEndpoint(env, platform), host.endpoint('odk-data'))
  }
})

test('only the canonical data environment variable overrides an endpoint', async () => {
  const { odkDataEndpoint } = await import(integrationURL('personal-bot/src/odk-data.mjs'))
  const oldVariable = ['ODES', 'K_DESK_DATA_SOCKET'].join('')
  const env = { XDG_RUNTIME_DIR: '/run/user/1000', [oldVariable]: '/tmp/retired.sock' }
  assert.equal(odkDataEndpoint(env, 'linux'), path.join('/run/user/1000', 'odk-data', 'service.sock'))
  assert.equal(odkDataEndpoint({ ...env, ODK_DATA_SOCKET: '/tmp/current.sock' }, 'linux'), '/tmp/current.sock')
})

test('active sources and launchers contain no retired technical prefixes', () => {
  const fs = require('node:fs')
  const root = findRepositoryRoot(__dirname)
  const shell = fs.existsSync(path.join(root, 'runtime/shell/src')) ? 'runtime/shell/' : ''
  const retired = new RegExp(['ODES' + 'K_', 'OPEN_' + 'DESKOS', 'open-' + 'deskos', 'odes' + 'k-'].join('|'))
  for (const directory of [
    shell + 'src', shell + 'scripts', shell + 'systemd',
    'integrations/personal-bot/src', 'integrations/personal-bot/scripts',
    'integrations/personal-bot/systemd', 'integrations/personal-bot/launchd',
    'integrations/futu-poller', 'integrations/remote-bridge/lib',
    'integrations/remote-bridge/systemd', 'integrations/local-stt-bridge',
  ]) {
    const base = path.join(root, directory)
    for (const entry of fs.readdirSync(base, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:js|mjs|cjs|py|ps1|sh|service|plist)$/.test(entry.name)) continue
      const file = path.join(entry.parentPath, entry.name)
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), retired, path.relative(root, file))
    }
  }
})

test('the Personal Bot data tool uses the ODK tool namespace', async () => {
  const { createOdkDataTool } = await import(integrationURL('personal-bot/src/odk-data.mjs'))
  const tool = createOdkDataTool()
  assert.equal(tool.name, 'odk_data')
  assert.equal(tool.namespace.name, 'odk')
})
