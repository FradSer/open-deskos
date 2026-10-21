'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { selection, runtime } = require('./helpers/app-manager')
const { SYSTEM_PORTS } = require('../src/plugins/system-channels')

test('runtime manager replacement preserves active foreground and removed catalog state', async t => {
  const selected = await selection(t)
  const definitions = await selected.load()
  const current = await runtime(t)
  current.dispatch({ type: 'open-app', appId: 'year' })
  current.dispatch({ type: 'remove-app', appId: 'pomodoro' })
  const before = current.list()
  const foreground = current.host.get(SYSTEM_PORTS.appManager).foreground()
  await current.host.replace(definitions[0])
  const after = current.host.get(SYSTEM_PORTS.appManager).foreground()
  console.log(JSON.stringify({ boundary: 'Host.replace', beforeForeground: foreground?.appId, afterForeground: after?.appId || null,
    beforeClock: before.find(app => app.appId === 'year').state,
    afterClock: current.get('year').state, removedAppReappeared: current.list().some(app => app.appId === 'pomodoro') }))
  assert.deepEqual(after, foreground)
  assert.deepEqual(current.list(), before)
})


test('failed candidate restores the previous manager state as well as its factory', async t => {
  const selected = await selection(t)
  const [definition] = await selected.load()
  const current = await runtime(t)
  current.dispatch({ type: 'open-app', appId: 'year' })
  current.dispatch({ type: 'action', appId: 'year', action: 'pause' })
  current.dispatch({ type: 'remove-app', appId: 'pomodoro' })
  const before = current.list()
  const foreground = current.host.get(SYSTEM_PORTS.appManager).foreground()
  await assert.rejects(current.host.replace({ ...definition, create() { throw Error('Controlled candidate startup failure') } }),
    /plugin replacement failed; previous factory restored/)
  assert.equal(current.host.list().find(plugin => plugin.manifest.id === definition.manifest.id).manifest.version, '1.0.0')
  const after = current.host.get(SYSTEM_PORTS.appManager).foreground()
  console.log(JSON.stringify({ boundary: 'failed-candidate-rollback', beforeForeground: foreground?.appId,
    beforeState: foreground?.state, afterForeground: after?.appId || null,
    removedAppReappeared: current.list().some(app => app.appId === 'pomodoro') }))
  assert.deepEqual(after, foreground)
  assert.deepEqual(current.list(), before)
})


test('actual native activator preserves existing manager state before reporting success', async t => {
  const selected = await selection(t)
  const current = await runtime(t)
  const id = 'odk.system.app-manager'
  const { createNativeRuntimeActivator } = require('../src/native-runtime-activation')
  const activate = createNativeRuntimeActivator({ host: current.host, env: selected.env, defaults: [current.host.definition(id)] })
  current.dispatch({ type: 'open-app', appId: 'year' })
  current.dispatch({ type: 'remove-app', appId: 'pomodoro' })
  const before = current.list()
  const foreground = current.host.get(SYSTEM_PORTS.appManager).foreground()
  const receipt = await activate(id)
  assert.equal(receipt.state, 'running')
  assert.equal(receipt.version, '2.0.0')
  const after = current.host.get(SYSTEM_PORTS.appManager).foreground()
  console.log(JSON.stringify({ boundary: 'native-runtime-activation', reportedState: receipt.state,
    beforeForeground: foreground?.appId, afterForeground: after?.appId || null,
    removedAppReappeared: current.list().some(app => app.appId === 'pomodoro') }))
  assert.deepEqual(after, foreground)
  assert.deepEqual(current.list(), before)
})


for (const [name, create] of [
  ['default', require('../src/app-manager-endpoint').createAppManagerEndpoint],
  ['independent', require('./fixtures/app-manager-replacement/manager').createAppManagerEndpoint],
]) {
  test(`${name} manager snapshots restore complete state atomically without aliases`, () => {
    const manager = create()
    manager.start('year')
    manager.pause('year')
    manager.remove('pomodoro')
    const captured = manager.captureState()
    const restored = create()
    restored.restoreState(captured)
    assert.deepEqual(restored.captureState(), captured)
    assert.equal(restored.foreground().state, 'paused')
    assert.equal(restored.get('pomodoro').state, 'removed')
    captured.states[0].state = 'removed'
    assert.equal(restored.get('weather').state, 'installed')
    const before = restored.captureState()
    for (const change of [null, { ...before, version: 2 }, { ...before, states: [] },
      { ...before, states: [...before.states, before.states[0]] },
      { ...before, states: before.states.map((row, i) => i ? row : { ...row, appId: 'missing' }) },
      { ...before, states: before.states.map((row, i) => i ? row : { ...row, state: 'invalid' }) },
      { ...before, foregroundAppId: 'missing' }]) {
      assert.throws(() => restored.restoreState(change), /invalid App Manager state/)
      assert.deepEqual(restored.captureState(), before)
    }
  })
}

test('released default and signed IPC callbacks refuse new state changes', async t => {
  const selected = await selection(t)
  for (const definitions of [[], await selected.load()]) {
    const current = await runtime(t, definitions)
    const callback = current.handlers.get('odk-app-manager-intent')
    const manager = current.host.get(SYSTEM_PORTS.appManager)
    await current.host.stop()
    assert.throws(() => callback(null, { type: 'open-app', appId: 'year' }), /App Manager unavailable/)
    assert.equal(manager.foreground(), null)
  }
})
