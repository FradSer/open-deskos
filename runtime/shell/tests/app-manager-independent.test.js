'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const original = require('../src/app-manager-endpoint').createAppManagerEndpoint
const independent = require('./fixtures/app-manager-replacement/manager').createAppManagerEndpoint
const { selection, runtime } = require('./helpers/app-manager')

test('independent manager preserves malformed intent responses and action type checks', () => {
  const a = original(), b = independent()
  for (const intent of [null, undefined, {}, {appId: 1}, {appId: 'clock', type: 'action', action: ['start']}]) {
    assert.deepEqual(b.dispatch(intent), a.dispatch(intent))
  }
})

test('independent manager preserves deterministic lifecycle and recovery sequences', () => {
  let seed = 5713
  const sampled = new Map()
  const choose = values => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = values[(seed >>> 8) % values.length]
    const key = JSON.stringify(values)
    if (!sampled.has(key)) sampled.set(key, new Set())
    sampled.get(key).add(JSON.stringify(value))
    return value
  }
  for (let sequence = 0; sequence < 30; sequence++) {
    const a = original(), b = independent()
    for (let step = 0; step < 300; step++) {
      const appId = choose(['clock', 'pomodoro', 'year', 'missing'])
      const operation = choose(['dispatch','install','remove','start','pause','resume','stop'])
      const intent = { appId, type: choose(['open-app','action','install-app','remove-app','rollback-open','rollback-action','unknown']),
        action: choose(['start','pause','resume','stop','unknown',null,['start']]),
        expectedState: choose(['running','paused','stopped',null]), expectedTargetState: choose(['running','paused','stopped',null]),
        targetState: choose(['installed','running','paused','stopped','invalid']), previousState: choose(['installed','running','paused','stopped','invalid']),
        previousAppId: choose(['clock','pomodoro','missing',null]), previousForegroundAppId: choose(['clock','pomodoro','missing',null]) }
      const argument = operation === 'dispatch' ? intent : appId
      assert.deepEqual(b[operation](argument), a[operation](argument), JSON.stringify({sequence,step,operation,argument}))
      assert.deepEqual(b.list(), a.list())
      assert.deepEqual(b.foreground(), a.foreground())
      assert.deepEqual(b.captureState(), a.captureState())
      if (step % 50 === 0) {
        const restoredOriginal = original(), restoredIndependent = independent()
        restoredOriginal.restoreState(b.captureState())
        restoredIndependent.restoreState(a.captureState())
        assert.deepEqual(restoredOriginal.captureState(), a.captureState())
        assert.deepEqual(restoredIndependent.captureState(), a.captureState())
        assert.deepEqual(restoredOriginal.foreground(), a.foreground())
        assert.deepEqual(restoredIndependent.foreground(), a.foreground())
      }
      for (const id of ['clock','pomodoro','year','missing']) assert.deepEqual(b.get(id), a.get(id))
    }
  }
  for (const [values, seen] of sampled) {
    assert.deepEqual([...seen].sort(), JSON.parse(values).map(value => JSON.stringify(value)).sort(), `Sequence omitted values: ${values}`)
  }
})

test('signed independent manager runs from captured own modules through actual CLI and Host', async t => {
  const selected = await selection(t)
  const definitions = await selected.load()
  await fs.writeFile(path.join(selected.stored.root, 'manager.js'), 'throw Error("Stored module mutated after capture")')
  const a = await runtime(t)
  const b = await runtime(t, definitions)
  assert.equal(b.creates(), 0)
  for (const intent of [{type:'open-app',appId:'clock'},{type:'open-app',appId:'pomodoro'},
    {type:'rollback-open',appId:'pomodoro',expectedTargetState:'running',targetState:'installed',previousAppId:'clock',previousState:'running'},
    {type:'action',appId:'clock',action:'pause'},{type:'action',appId:'clock',action:'resume'},{type:'action',appId:'clock',action:'stop'}]) {
    assert.deepEqual(b.dispatch(intent), a.dispatch(intent))
    assert.deepEqual(b.list(), a.list())
  }
})

for (const [name, create] of [['default', original], ['independent', independent]]) {
  test(`${name} manager preserves product navigation, recovery, and service rules`, () => {
    const apps = [
      { appId: 'a', kind: 'ui', capabilities: ['open'] },
      { appId: 'b', kind: 'ui', capabilities: [] },
      { appId: 'service', kind: 'service' },
    ]
    const manager = create({ apps })
    manager.get('a').capabilities.push('changed')
    assert.deepEqual(manager.get('a').capabilities, ['open'])
    assert.equal(manager.start('a').ok, true)
    assert.deepEqual(manager.start('b'), { ok: false, error: 'foreground-busy' })
    assert.equal(manager.foreground().appId, 'a')
    assert.equal(manager.get('b').state, 'installed')
    assert.equal(manager.start('service').ok, true)
    assert.equal(manager.foreground().appId, 'a')
    const opened = manager.dispatch({ type: 'open-app', appId: 'b' })
    assert.equal(opened.ok, true)
    assert.equal(manager.get('a').state, 'stopped')
    assert.equal(manager.foreground().appId, 'b')
    const recovery = { type: 'rollback-open', appId: 'b', expectedTargetState: 'running', ...opened.transition }
    const before = manager.list()
    assert.equal(manager.dispatch({ ...recovery, previousState: 'invalid' }).error, 'invalid-state')
    assert.deepEqual(manager.list(), before)
    assert.equal(manager.foreground().appId, 'b')
    assert.equal(manager.dispatch(recovery).ok, true)
    assert.equal(manager.get('b').state, 'installed')
    assert.equal(manager.foreground().appId, 'a')
    assert.equal(manager.foreground().state, 'running')
    assert.equal(manager.pause('a').app.state, 'paused')
    assert.equal(manager.foreground().appId, 'a')
    assert.equal(manager.resume('a').app.state, 'running')
    assert.equal(manager.stop('service').ok, true)
    assert.equal(manager.foreground().appId, 'a')
    assert.equal(manager.install('a').app.state, 'installed')
    assert.equal(manager.foreground().appId, 'a')
    assert.equal(manager.dispatch({ type: 'open-app', appId: 'service' }).ok, true)
    assert.equal(manager.foreground(), null)
    assert.equal(manager.get('a').state, 'stopped')
    assert.equal(manager.remove('b').app.state, 'removed')
    assert.equal(manager.list().some(app => app.appId === 'b'), false)
    assert.equal(manager.start('b').error, 'not-installed')
    assert.equal(manager.start('missing').error, 'not-found')
  })
}

test('signed replacement packages only independent code and declared static metadata', async t => {
  const selected = await selection(t)
  const source = await fs.readFile(path.join(selected.stored.root, 'manager.js'), 'utf8')
  assert.doesNotMatch(source, /app-manager-endpoint|system\.app-manager|createAppManagerEndpoint.*require/)
  assert.deepEqual([...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1]), ['./catalog.json'])
  const actualCatalog = JSON.parse(await fs.readFile(path.join(selected.stored.root, 'catalog.json'), 'utf8'))
  assert.deepEqual(actualCatalog, require('../src/app-manager-endpoint').BUILTIN_APPS)
})


test('development independent manager loads through actual CLI and releases public Host handlers', async t => {
  const { SYSTEM_PORTS } = require('../src/plugins/system-channels')
  const { ID, CHANNELS } = require('./helpers/app-manager')
  const selected = await selection(t, { mode: 'development' })
  const definitions = await selected.load()
  assert.equal(definitions.length, 1)
  const originalRuntime = await runtime(t)
  const replacement = await runtime(t, definitions)
  assert.equal(replacement.creates(), 0)
  for (const appId of ['clock', 'pomodoro']) {
    const intent = { type: 'open-app', appId }
    assert.deepEqual(replacement.dispatch(intent), originalRuntime.dispatch(intent))
  }
  const manager = replacement.host.get(SYSTEM_PORTS.appManager)
  await replacement.host.setEnabled(ID, false)
  assert.equal(replacement.handlers.size, 0)
  assert.equal(replacement.host.get(SYSTEM_PORTS.appManager), null)
  await replacement.host.setEnabled(ID, true)
  assert.notEqual(replacement.host.get(SYSTEM_PORTS.appManager), manager)
  assert.equal(replacement.host.get(SYSTEM_PORTS.appManager).foreground(), null)
  assert.equal(replacement.get('clock').state, 'installed')
  assert.deepEqual([...replacement.handlers.keys()].sort(), [...CHANNELS].sort())
})
