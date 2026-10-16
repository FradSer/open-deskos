'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { resolveShellHost, LINK_ENDPOINTS } = require('../src/platform')

const prefix = '\\\\.\\pipe\\odk-camera-' + 'a'.repeat(32) + '-'
const file = path.join(__dirname, 'helpers/camera-private-host.cjs')
const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
function load(platform, value) {
  const module = { resolveShellHost }
  vm.runInNewContext(source, {
    process: { platform, env: value === undefined ? {} : { ODK_CAMERA_PRIVATE_PIPE_PREFIX: value } },
    require(name) { assert.equal(name, '../../src/platform'); return module },
  })
  return module.resolveShellHost
}

test('Camera private host preserves native Windows facts and isolates every endpoint', () => {
  const env = { LOCALAPPDATA: 'C:\\private-camera\\state' }
  const options = { platform: 'win32', arch: 'x64', env, homedir: 'C:\\private-camera\\home' }
  const original = resolveShellHost(options)
  const selected = load('win32', prefix)(options)
  for (const name of Object.keys(LINK_ENDPOINTS)) {
    assert.equal(selected.endpoint(name), prefix + name)
    assert.notEqual(selected.endpoint(name), original.endpoint(name))
  }
  assert.equal(selected.endpoint('unknown-channel'), null)
  assert.equal(selected.odkDataEndpoint, selected.endpoint('odk-data'))
  for (const name of ['platform', 'arch', 'id', 'supported', 'stateDir', 'localChannelTokenFile', 'provisionsUserAppControl', 'provisionsOdkData']) {
    assert.equal(selected[name], original[name], name)
  }
})

for (const value of [undefined, '', '\\\\.\\pipe\\odk-', prefix + 'extra', '/tmp/camera']) {
  test(`Camera Windows fixture refuses invalid isolation prefix ${JSON.stringify(value)}`, () => {
    assert.throws(() => load('win32', value), /private Camera pipe prefix/)
  })
}
for (const platform of ['darwin', 'linux']) {
  test(`Camera private host preserves ${platform} host resolution`, () => {
    assert.equal(load(platform), resolveShellHost)
  })
}

test('Camera Main source bootstrap uses the private host without a Windows skip', () => {
  const sourceParent = fs.readFileSync(path.join(__dirname, 'camera-main-bootstrap.test.js'), 'utf8')
  const child = fs.readFileSync(path.join(__dirname, 'camera-main-bootstrap.cjs'), 'utf8')
  assert.match(sourceParent, /ODK_CAMERA_PRIVATE_PIPE_PREFIX/)
  assert.match(child, /require\('\.\/helpers\/camera-private-host\.cjs'\)/)
  assert.ok(child.indexOf('camera-private-host.cjs') < child.indexOf("require('../src/main')"))
  assert.doesNotMatch(sourceParent, /camera-main-surface|CAMERA_SURFACE/)
})
