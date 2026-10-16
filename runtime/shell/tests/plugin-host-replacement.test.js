'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const SOURCE = 'odk:data/source/v1'
const VIEW = 'odk:surface/view/v1'
const providerId = 'odk.test.source'
const definition = (id, options = {}) => ({
  manifest: { schemaVersion: 1, id, name: id, version: options.version || '1.0.0', kind: 'service', host: 'electron-main',
    provides: options.provides || [], requires: options.requires || [], permissions: options.permissions || [] },
  create: options.create || (() => ({})),
})
const deferred = () => {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return { promise, resolve }
}
function fixture({ oldStop = () => {}, disabled = [] } = {}) {
  const events = []
  const signals = []
  const host = createPluginHost({ disabled })
  let peerCreates = 0
  const provider = (version, { start = () => {}, stop = () => {}, cleanup = () => {} } = {}) => definition(providerId, {
    version, provides: [{ interface: SOURCE }], create(ctx) {
      events.push('create:' + version)
      signals.push(ctx.signal)
      ctx.onCleanup(() => { events.push('cleanup:' + version); return cleanup() })
      return { ports: { [SOURCE]: { version, value: 42 } },
        start() { events.push('start:' + version); return start() },
        stop() { events.push('stop:' + version); return stop() } }
    },
  })
  const original = provider('1.0.0', { stop: oldStop })
  host.register(original)
  host.register(definition('odk.test.consumer', { provides: [{ interface: VIEW }], requires: [{ interface: SOURCE }],
    create(ctx) {
      const value = ctx.get(SOURCE)
      events.push('consumer:create:' + value.version)
      return { ports: { [VIEW]: { source: value } }, stop() {
        assert.equal(ctx.get(SOURCE), value)
        events.push('consumer:stop:' + value.version)
      } }
    },
  }))
  host.register(definition('odk.test.peer', { create() { peerCreates++; return {} } }))
  return { host, events, signals, original, provider, peerCreates: () => peerCreates }
}

test('runtime replacement releases consumers first and retains independent factories', async () => {
  const f = fixture()
  await f.host.start()
  const peer = f.host.list().find(record => record.manifest.id === 'odk.test.peer')
  await f.host.replace(f.provider('2.0.0'))
  assert.deepEqual(f.events, ['create:1.0.0', 'start:1.0.0', 'consumer:create:1.0.0',
    'consumer:stop:1.0.0', 'stop:1.0.0', 'cleanup:1.0.0', 'create:2.0.0', 'start:2.0.0', 'consumer:create:2.0.0'])
  assert.equal(f.signals[0].aborted, true)
  assert.equal(f.signals[1].aborted, false)
  assert.deepEqual(f.host.get(VIEW), { source: { version: '2.0.0', value: 42 } })
  assert.deepEqual(f.host.list().find(record => record.manifest.id === 'odk.test.peer'), peer)
  assert.equal(f.peerCreates(), 1)
  await f.host.stop()
})

test('runtime replacement refuses changed contracts before releasing live resources', async () => {
  const f = fixture()
  await f.host.start()
  const baseline = [...f.events]
  for (const changed of [{ host: 'electron-renderer' }, { kind: 'system' }, { permissions: ['ipc'] },
    { provides: [{ interface: VIEW }] }, { requires: [{ interface: VIEW, optional: true }] }]) {
    const next = f.provider('2.0.0')
    Object.assign(next.manifest, changed)
    await assert.rejects(f.host.replace(next), /external contract/)
  }
  await assert.rejects(f.host.replace(definition('odk.test.unknown')), /unknown plugin/)
  assert.deepEqual(f.events, baseline)
  assert.equal(f.signals[0].aborted, false)
  await f.host.stop()
})

test('runtime replacement retains failed old release and permits a later retry', async () => {
  let refuse = true
  const f = fixture({ oldStop() { if (refuse) throw Error('retained old source') } })
  await f.host.start()
  await assert.rejects(f.host.replace(f.provider('2.0.0')), /retains resources/)
  assert.equal(f.host.get(SOURCE), null)
  assert.equal(f.host.list()[0].manifest.version, '1.0.0')
  assert.equal(f.events.includes('create:2.0.0'), false)
  refuse = false
  await f.host.replace(f.provider('2.0.0'))
  assert.equal(f.host.get(VIEW).source.version, '2.0.0')
  assert.equal(f.peerCreates(), 1)
  await f.host.stop()
})

test('failed replacement startup restores the previous factory after candidate release', async () => {
  const f = fixture()
  await f.host.start()
  await assert.rejects(f.host.replace(f.provider('2.0.0', { start() { throw Error('candidate startup') } })), /replacement failed/)
  assert.equal(f.host.list()[0].manifest.version, '1.0.0')
  assert.equal(f.host.get(VIEW).source.version, '1.0.0')
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 2)
  assert.ok(f.events.indexOf('cleanup:2.0.0') < f.events.lastIndexOf('create:1.0.0'))
  assert.equal(f.peerCreates(), 1)
  await f.host.stop()
})

test('failed candidate cleanup blocks rollback and remains owned for explicit recovery', async () => {
  let refuse = true
  const f = fixture()
  await f.host.start()
  await assert.rejects(f.host.replace(f.provider('2.0.0', {
    start() { throw Error('candidate startup') }, cleanup() { if (refuse) throw Error('candidate retained') },
  })), /retains resources/)
  assert.equal(f.host.list()[0].manifest.version, '2.0.0')
  assert.equal(f.host.get(SOURCE), null)
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 1)
  refuse = false
  await f.host.replace(f.original)
  assert.equal(f.host.get(VIEW).source.version, '1.0.0')
  await f.host.stop()
})

test('shutdown during old release cancels replacement without constructing a new factory', async () => {
  const release = deferred()
  const entered = deferred()
  const f = fixture({ oldStop() { entered.resolve(); return release.promise } })
  await f.host.start()
  const replace = f.host.replace(f.provider('2.0.0'))
  const rejection = assert.rejects(replace, /cancelled/)
  await entered.promise
  const stopped = f.host.stop()
  release.resolve()
  await rejection
  await stopped
  assert.equal(f.events.includes('create:2.0.0'), false)
  assert.equal(f.host.get(SOURCE), null)
  assert.equal(f.host.list()[0].manifest.version, '1.0.0')
})

test('queued replacements execute serially and keep disabled peers disabled', async () => {
  const f = fixture({ disabled: ['odk.test.consumer'] })
  await f.host.start()
  await Promise.all([f.host.replace(f.provider('2.0.0')), f.host.replace(f.provider('3.0.0'))])
  assert.equal(f.host.get(SOURCE).version, '3.0.0')
  assert.equal(f.host.get(VIEW), null)
  assert.equal(f.host.list().find(record => record.manifest.id === 'odk.test.consumer').state, 'disabled')
  assert.equal(f.peerCreates(), 1)
  assert.ok(f.events.indexOf('cleanup:2.0.0') < f.events.indexOf('create:3.0.0'))
  await f.host.stop()
})

test('disabled target replacement changes selection without constructing its factory', async () => {
  const f = fixture({ disabled: [providerId] })
  await f.host.start()
  await f.host.replace(f.provider('2.0.0'))
  assert.equal(f.events.length, 0)
  assert.equal(f.host.list()[0].manifest.version, '2.0.0')
  assert.equal(f.host.list()[0].enabled, false)
  await f.host.setEnabled(providerId, true)
  assert.equal(f.host.get(VIEW).source.version, '2.0.0')
  await f.host.stop()
})

test('runtime replacement requires a running Host', async () => {
  const f = fixture()
  await assert.rejects(f.host.replace(f.provider('2.0.0')), /running Host/)
  await f.host.start()
  await f.host.stop()
  await assert.rejects(f.host.replace(f.provider('2.0.0')), /running Host/)
})

test('shutdown during candidate construction drains the candidate and suppresses consumer restart', async () => {
  const entered = deferred()
  const finish = deferred()
  const f = fixture()
  await f.host.start()
  const next = f.provider('2.0.0')
  const create = next.create
  next.create = async ctx => { entered.resolve(); await finish.promise; return create(ctx) }
  const replacement = f.host.replace(next)
  const rejection = assert.rejects(replacement, /cancelled/)
  await entered.promise
  const stopped = f.host.stop()
  finish.resolve()
  await rejection
  await stopped
  assert.equal(f.signals[1].aborted, true)
  assert.equal(f.events.includes('consumer:create:2.0.0'), false)
  assert.equal(f.events.filter(event => event === 'cleanup:2.0.0').length, 1)
  assert.equal(f.host.get(SOURCE), null)
})

test('consumer startup failure rolls back the provider and optional transitive consumers', async () => {
  const f = fixture()
  const optional = 'odk:data/optional/v1'
  const seen = []
  f.host.register(definition('odk.test.optional', { requires: [{ interface: SOURCE, optional: true }],
    provides: [{ interface: optional }], create(ctx) {
      const source = ctx.get(SOURCE)
      seen.push(source.version)
      return { ports: { [optional]: source } }
    },
  }))
  f.host.register(definition('odk.test.transitive', { requires: [{ interface: optional }], create(ctx) {
    if (ctx.get(optional).version === '2.0.0') throw Error('consumer refused candidate')
    return {}
  } }))
  await f.host.start()
  await assert.rejects(f.host.replace(f.provider('2.0.0')), /replacement failed/)
  assert.deepEqual(seen, ['1.0.0', '2.0.0', '1.0.0'])
  assert.equal(f.host.get(SOURCE).version, '1.0.0')
  assert.ok(f.host.list().every(record => record.state === 'running'))
  assert.equal(f.peerCreates(), 1)
  await f.host.stop()
})

test('replacement captures declaration and factory before queued caller mutation', async () => {
  const entered = deferred()
  const finish = deferred()
  const f = fixture({ oldStop() { entered.resolve(); return finish.promise } })
  await f.host.start()
  const next = f.provider('2.0.0')
  const replaced = f.host.replace(next)
  await entered.promise
  next.manifest.version = '9.0.0'
  next.manifest.permissions.push('secrets')
  next.create = () => { throw Error('mutated caller factory') }
  finish.resolve()
  await replaced
  assert.equal(f.host.list()[0].manifest.version, '2.0.0')
  assert.deepEqual(f.host.list()[0].manifest.permissions, [])
  assert.equal(f.host.get(SOURCE).version, '2.0.0')
  await f.host.stop()
})

test('queued disable suppresses candidate allocation and retains its selection for later enable', async () => {
  const entered = deferred()
  const finish = deferred()
  const f = fixture({ oldStop() { entered.resolve(); return finish.promise } })
  await f.host.start()
  const replaced = f.host.replace(f.provider('2.0.0'))
  await entered.promise
  const disabled = f.host.setEnabled(providerId, false)
  finish.resolve()
  await replaced
  await disabled
  assert.equal(f.events.includes('create:2.0.0'), false)
  assert.equal(f.host.list()[0].manifest.version, '2.0.0')
  assert.equal(f.host.list()[0].state, 'disabled')
  await f.host.setEnabled(providerId, true)
  assert.equal(f.host.get(VIEW).source.version, '2.0.0')
  await f.host.stop()
})

test('shutdown cancels queued disable and enable allocation behind replacement release', async () => {
  const entered = deferred()
  const finish = deferred()
  const f = fixture({ oldStop() { entered.resolve(); return finish.promise } })
  await f.host.start()
  const replaced = f.host.replace(f.provider('2.0.0'))
  const rejected = assert.rejects(replaced, /cancelled/)
  await entered.promise
  const disabled = f.host.setEnabled(providerId, false)
  const enabled = f.host.setEnabled(providerId, true)
  const stopped = f.host.stop()
  finish.resolve()
  await rejected
  await Promise.all([disabled, enabled, stopped])
  assert.equal(f.events.filter(event => event.startsWith('create:')).length, 1)
  assert.equal(f.host.get(SOURCE), null)
  await f.host.start()
  assert.equal(f.host.get(SOURCE).version, '1.0.0')
  await f.host.stop()
})

test('selected definition inspection copies metadata and identifies factory without execution', async () => {
  const f = fixture()
  const selected = f.host.definition(providerId)
  assert.equal(selected.create, f.original.create)
  selected.manifest.permissions.push('private-data')
  selected.manifest.version = '9.0.0'
  assert.equal(f.host.definition(providerId).manifest.version, '1.0.0')
  assert.deepEqual(f.host.definition(providerId).manifest.permissions, [])
  assert.equal(f.events.length, 0)
  assert.throws(() => f.host.definition('odk.test.unknown'), /unknown plugin/)
  await f.host.start()
  const next = f.provider('2.0.0')
  await f.host.replace(next)
  assert.equal(f.host.definition(providerId).create, next.create)
  await f.host.stop()
})

test('explicit recomposition restores changed ports dependencies and capabilities with fresh optional consumers', async () => {
  const events = []
  const extra = 'odk:data/extra/v1'
  const host = createPluginHost({ capabilities: { fixture: {} } })
  host.register(definition('odk.test.dependency', { provides: [{ interface: VIEW }], create: () => ({ ports: { [VIEW]: {} } }) }))
  host.register(definition(providerId, { provides: [{ interface: SOURCE }], requires: [{ interface: VIEW }],
    create: () => ({ ports: { [SOURCE]: { version: 2 } } }) }))
  host.register(definition('odk.test.optional', { requires: [{ interface: extra, optional: true }], create(ctx) {
    events.push(ctx.get(extra)?.version || null); return {}
  } }))
  await host.start()
  const restored = definition(providerId, { provides: [{ interface: SOURCE }, { interface: extra }], permissions: ['fixture'],
    create(ctx) { ctx.capability('fixture'); return { ports: { [SOURCE]: { version: 1 }, [extra]: { version: 1 } } } } })
  await assert.rejects(host.replace(restored), /external contract/)
  await host.replace(restored, { recompose: true })
  assert.equal(host.get(SOURCE).version, 1)
  assert.deepEqual(events, [null, 1])
  await host.stop()
})

test('recomposition validates required ports duplicate providers and cycles before aborting old resources', async () => {
  const f = fixture()
  await f.host.start()
  const before = [...f.events]
  for (const change of [
    { requires: [{ interface: 'odk:missing/provider/v1' }] },
    { requires: [{ interface: VIEW }] },
    { provides: [{ interface: SOURCE }, { interface: VIEW }] },
  ]) {
    const candidate = f.provider('2.0.0')
    Object.assign(candidate.manifest, change)
    await assert.rejects(f.host.replace(candidate, { recompose: true }), /missing required port|dependency cycle|duplicate port/)
    assert.deepEqual(f.events, before)
    assert.equal(f.signals[0].aborted, false)
  }
  await f.host.stop()
})

test('failed recomposition restores the previous dependency graph after candidate cleanup', async () => {
  const f = fixture()
  await f.host.start()
  const candidate = f.provider('2.0.0', { start() { throw Error('candidate failed') } })
  candidate.manifest.requires = [{ interface: 'odk:optional/new/v1', optional: true }]
  await assert.rejects(f.host.replace(candidate, { recompose: true }), /previous factory restored/)
  assert.equal(f.host.get(SOURCE).version, '1.0.0')
  assert.deepEqual(f.host.definition(providerId).manifest.requires, [])
  assert.equal(f.host.get(VIEW).source.version, '1.0.0')
  await f.host.stop()
})

test('queued disable uses the recomposed graph when a restored plugin adds a dependency', async () => {
  const entered = deferred()
  const released = deferred()
  const host = createPluginHost()
  host.register(definition('odk.test.other-provider', { provides: [{ interface: VIEW }], create: () => ({ ports: { [VIEW]: {} } }) }))
  host.register(definition(providerId, { provides: [{ interface: SOURCE }], create: () => ({ ports: { [SOURCE]: {} },
    async stop() { entered.resolve(); await released.promise } }) }))
  await host.start()
  const replacement = host.replace(definition(providerId, { provides: [{ interface: SOURCE }], requires: [{ interface: VIEW }],
    create: () => ({ ports: { [SOURCE]: {} } }) }), { recompose: true })
  await entered.promise
  const disabled = host.setEnabled('odk.test.other-provider', false)
  released.resolve()
  await replacement
  await disabled
  assert.equal(host.list().find(plugin => plugin.manifest.id === providerId).state, 'blocked')
  assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.test.other-provider').state, 'disabled')
  assert.equal(host.get(SOURCE), null)
  await host.setEnabled('odk.test.other-provider', true)
  assert.equal(host.list().find(plugin => plugin.manifest.id === providerId).state, 'running')
  await host.stop()
})

test('cancelled queued replacement preserves the selected factory without another release', async () => {
  const entered = deferred(); const finish = deferred()
  const f = fixture({ oldStop() { entered.resolve(); return finish.promise } })
  await f.host.start()
  const first = f.host.replace(f.provider('2.0.0'))
  await entered.promise
  const controller = new AbortController()
  const second = f.host.replace(f.provider('3.0.0'), { signal: controller.signal })
  const rejected = assert.rejects(second, /abort|cancel/i)
  controller.abort()
  finish.resolve()
  await first; await rejected
  assert.equal(f.host.definition(providerId).manifest.version, '2.0.0')
  assert.equal(f.events.includes('create:3.0.0'), false)
  assert.equal(f.events.includes('stop:2.0.0'), false)
  await f.host.stop()
})
