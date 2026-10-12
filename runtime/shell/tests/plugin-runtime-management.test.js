'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveRuntimeManagement } = require('../src/plugin-runtime-management')
const { createPluginControl } = require('../src/plugin-control')

const host = { endpoint: name => name, platform: 'linux', localChannelTokenFile: '/fixture/token' }
const id = 'odk.fixture.managed'
const entry = scope => ({ ok: true, scope, plugins: [{ pluginId: id, host: scope }] })

test('runtime ownership uses authenticated inventory and tolerates absent independent runtimes', async () => {
  const calls = []
  const result = await resolveRuntimeManagement(host, id, async options => {
    calls.push(options)
    if (options.endpoint !== 'remote-plugin-control') throw Error('connect ENOENT')
    return entry('remote-bridge')
  })
  assert.deepEqual(result, { scope: 'remote-bridge', endpoint: 'remote-plugin-control' })
  assert.equal(calls.length, 6)
  assert.ok(calls.every(call => call.request.command === 'inventory' && call.tokenFile === host.localChannelTokenFile))
})

test('duplicate ownership refuses runtime selection', async () => {
  await assert.rejects(resolveRuntimeManagement(host, id, async options => {
    if (options.endpoint === 'plugin-control') return entry('electron-main')
    if (options.endpoint === 'remote-plugin-control') return entry('remote-bridge')
    throw Error('connect ENOENT')
  }), /ambiguous/)
})

test('renderer identity ownership selects its independent management endpoint', async () => {
  const result = await resolveRuntimeManagement(host, id, async options => {
    if (options.endpoint === 'renderer-plugin-control') return entry('electron-renderer')
    throw Error('connect ENOENT')
  })
  assert.deepEqual(result, { scope: 'electron-renderer', endpoint: 'renderer-plugin-control' })
})

for (const malformed of [
  { ...entry('remote-bridge'), scope: 'electron-main' },
  { ...entry('remote-bridge'), plugins: [{ pluginId: id, host: 'electron-main' }] },
  { ...entry('remote-bridge'), plugins: [entry('remote-bridge').plugins[0], entry('remote-bridge').plugins[0]] },
  { ...entry('remote-bridge'), plugins: [{ ...entry('remote-bridge').plugins[0], privateError: 'secret' }] },
  { ...entry('remote-bridge'), plugins: [] },
]) {
  test('invalid independent inventory prevents selection even when a valid owner exists', async () => {
    await assert.rejects(resolveRuntimeManagement(host, id, async options => {
      if (options.endpoint === 'plugin-control') return entry('electron-main')
      if (options.endpoint === 'remote-plugin-control') return malformed
      throw Error('connect ENOENT')
    }), /invalid management inventory/)
  })
}

test('management inventory is read-only and excludes private component data', async () => {
  let mutations = 0
  const control = createPluginControl({ snapshot: () => [{ manifest: { id, host: 'electron-main', name: 'private name' }, error: 'private failure', state: 'running' }],
    setEnabled: () => { mutations++ } })
  assert.deepEqual(await control.dispatch({ command: 'inventory' }), entry('electron-main'))
  assert.equal(mutations, 0)
  assert.equal((await control.dispatch({ command: 'inventory', pluginId: id })).error, 'invalid-command')
})

test('an oversized independent inventory prevents selection', async () => {
  await assert.rejects(resolveRuntimeManagement(host, id, async options => {
    if (options.endpoint === 'plugin-control') return entry('electron-main')
    if (options.endpoint === 'remote-plugin-control') throw Error('plugin management inventory response too large; operation outcome unknown')
    throw Error('connect ENOENT')
  }), /invalid management inventory/)
})

test('a rejected asynchronous inventory is consumed and refused', async () => {
  const control = createPluginControl({ snapshot: () => Promise.reject(Error('private asynchronous failure')), setEnabled() {} })
  assert.deepEqual(await control.dispatch({ command: 'inventory' }), { ok: false, error: 'inventory-unavailable' })
  await new Promise(resolve => setImmediate(resolve))
})

test('an online inventory failure prevents selection', async () => {
  await assert.rejects(resolveRuntimeManagement(host, id, async options => {
    if (options.endpoint === 'plugin-control') return entry('electron-main')
    if (options.endpoint === 'remote-plugin-control') throw Error('inventory-unavailable')
    throw Error('connect ENOENT')
  }), /invalid management inventory/)
})
