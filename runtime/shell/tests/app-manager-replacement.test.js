'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { SYSTEM_PORTS } = require('../src/plugins/system-channels')
const { selection, runtime, ID, CHANNELS } = require('./helpers/app-manager')

test('signed App Manager owns construction and preserves IPC transitions from captured modules', async t => {
  const selected = await selection(t)
  const plugins = await selected.load()
  assert.equal(plugins.length, 1)
  await fs.writeFile(selected.stored.entry, 'throw Error("mutated entry")')
  await fs.writeFile(path.join(selected.stored.root, 'manager.js'), 'throw Error("mutated manager")')
  const original = await runtime(t)
  const replacement = await runtime(t, plugins)
  assert.equal(replacement.creates(), 0)
  assert.equal(replacement.host.list().find(plugin => plugin.manifest.id === ID).manifest.version, '2.0.0')
  assert.deepEqual(replacement.list(), original.list())
  assert.deepEqual(replacement.list().map(app => app.name), ['Futu holdings', 'Weather', 'Hydra plants', 'WeRead', 'Pre-order', 'Calendar', 'Clock', 'Pomodoro', 'Year progress', 'Built-in views', 'Pi Sessions'])
  replacement.list()[0].capabilities.push('mutated')
  assert.deepEqual(replacement.get('calendar').capabilities, [])
  const cases = [
    [null, 'invalid-intent'],
    [{ type: 'action', appId: 'missing', action: 'start' }, 'not-found'],
    [{ type: 'unknown', appId: 'clock' }, 'unsupported-intent'],
    [{ type: 'action', appId: 'clock', action: 'unknown' }, 'unsupported-action'],
    [{ type: 'action', appId: 'clock', action: 'pause' }, 'invalid-state'],
    [{ type: 'open-app', appId: 'clock' }],
    [{ type: 'action', appId: 'pomodoro', action: 'start' }, 'foreground-busy'],
    [{ type: 'remove-app', appId: 'clock' }, 'foreground-busy'],
    [{ type: 'action', appId: 'clock', action: 'pause' }],
    [{ type: 'action', appId: 'clock', action: 'resume' }],
    [{ type: 'open-app', appId: 'pomodoro' }],
    [{ type: 'rollback-open', appId: 'pomodoro', expectedTargetState: 'paused', targetState: 'installed', previousAppId: 'clock', previousState: 'running' }, 'stale-transition'],
    [{ type: 'rollback-open', appId: 'pomodoro', expectedTargetState: 'running', targetState: 'invalid' }, 'invalid-state'],
    [{ type: 'rollback-open', appId: 'pomodoro', expectedTargetState: 'running', targetState: 'installed', previousAppId: 'clock', previousState: 'running' }],
    [{ type: 'action', appId: 'clock', action: 'stop' }],
    [{ type: 'rollback-action', appId: 'clock', expectedState: 'running', previousState: 'running', previousForegroundAppId: 'clock' }, 'stale-transition'],
    [{ type: 'rollback-action', appId: 'clock', expectedState: 'stopped', previousState: 'running', previousForegroundAppId: 'missing' }, 'not-found'],
    [{ type: 'rollback-action', appId: 'clock', expectedState: 'stopped', previousState: 'running', previousForegroundAppId: 'clock' }],
    [{ type: 'action', appId: 'clock', action: 'stop' }],
    [{ type: 'remove-app', appId: 'clock' }],
    [{ type: 'open-app', appId: 'clock' }, 'not-installed'],
    [{ type: 'action', appId: 'clock', action: 'stop' }, 'not-installed'],
    [{ type: 'install-app', appId: 'clock' }],
    [{ type: 'open-app', appId: 'clock' }],
  ]
  for (const [intent, error] of cases) {
    const actual = replacement.dispatch(intent)
    assert.deepEqual(actual, original.dispatch(intent), JSON.stringify(intent))
    assert.equal(actual.ok, !error, JSON.stringify(intent))
    if (error) assert.equal(actual.error, error)
    assert.deepEqual(replacement.list(), original.list())
    assert.deepEqual(replacement.host.get(SYSTEM_PORTS.appManager).foreground(), original.host.get(SYSTEM_PORTS.appManager).foreground())
  }
  assert.equal(replacement.get('clock').state, 'running')
  assert.equal(replacement.get('pomodoro').state, 'installed')
})

test('default and signed App Managers withdraw handlers and restart fresh state', async t => {
  const selected = await selection(t)
  for (const plugins of [[], await selected.load()]) {
    const f = await runtime(t, plugins)
    const manager = f.host.get(SYSTEM_PORTS.appManager)
    f.dispatch({ type: 'open-app', appId: 'clock' })
    await f.host.setEnabled(ID, false)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.host.get(SYSTEM_PORTS.appManager), null)
    await f.host.setEnabled(ID, true)
    assert.deepEqual([...f.handlers.keys()].sort(), [...CHANNELS].sort())
    assert.notEqual(f.host.get(SYSTEM_PORTS.appManager), manager)
    assert.equal(f.get('clock').state, 'installed')
    assert.equal(f.host.get(SYSTEM_PORTS.appManager).foreground(), null)
    await f.host.stop()
    assert.equal(f.handlers.size, 0)
  }
})

test('corrupt and removed App Manager selections start the actual default composition', async t => {
  const selected = await selection(t)
  await fs.writeFile(selected.stored.entry, 'throw Error("corrupt entry")')
  const errors = []
  const rejected = await selected.load({ report: id => errors.push(id) })
  assert.deepEqual(errors, [ID])
  assert.deepEqual(rejected, [])
  const f = await runtime(t, rejected)
  assert.equal(f.creates(), 1)
  assert.equal(f.dispatch({ type: 'open-app', appId: 'clock' }).ok, true)
  await selected.invoke(['remove', ID])
  assert.deepEqual(await selected.load(), [])
  const restored = await runtime(t, await selected.load())
  assert.equal(restored.dispatch({ type: 'open-app', appId: 'pomodoro' }).app.state, 'running')
  assert.equal(restored.creates(), 1)
  assert.equal((await fs.stat(selected.stored.root)).isDirectory(), true)
})
