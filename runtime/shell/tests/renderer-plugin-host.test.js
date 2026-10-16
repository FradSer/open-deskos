'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

function fixture() {
  const root = { odkPluginHost: { createPluginHost } }
  const errors = []
  vm.runInNewContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), { window: root, structuredClone, console: { error: (...args) => errors.push(args) } })
  return { registry: root.odkPlugins, errors }
}
const tile = (id, extra = {}) => ({ id, kind: 'tile', manifest: { schemaVersion: 1 }, mount() {}, ...extra })

test('legacy surfaces register on the common host and keep their existing definitions', async () => {
  const { registry } = fixture()
  const def = tile('odk.tile.fixture')
  registry.register(def)
  await registry.start()
  assert.equal(registry.get(def.id), def)
  assert.equal(registry.catalog()[0].manifest.host, 'electron-renderer')
  assert.equal(registry.catalog()[0].manifest.kind, 'surface')
  assert.equal(registry.catalog()[0].state, 'running')
  assert.equal(registry.port(`odk:surface/${def.id}/v1`), def)
  await registry.stop()
})

test('declared ports order creation and reach only the declared consumers', async () => {
  const { registry } = fixture()
  const events = []
  const port = 'odk:renderer/fixture/v1'
  registry.register(tile('odk.tile.consumer', {
    manifest: { schemaVersion: 1, requires: [{ interface: port }] },
    create(ctx) { events.push('consumer'); assert.equal(ctx.get(port), 42); return {} },
    mount(_el, ctx) { assert.equal(ctx.getPort(port), 42); assert.throws(() => ctx.getPort('odk:undeclared/v1'), /undeclared port/) },
  }))
  registry.register(tile('odk.tile.provider', {
    manifest: { schemaVersion: 1, provides: [{ interface: port }] },
    create() { events.push('provider'); return { ports: { [port]: 42 } } },
  }))
  await registry.start()
  assert.deepEqual(events, ['provider', 'consumer'])
  assert.equal(registry.activate(registry.get('odk.tile.consumer'), {}, {}), true)
  await registry.stop()
})

test('a failed provider prevents its consumer mount while unrelated surfaces remain usable', async () => {
  const { registry } = fixture()
  const port = 'odk:renderer/fixture/v1'
  let mounted = 0
  registry.register(tile('odk.tile.consumer', { manifest: { schemaVersion: 1, requires: [{ interface: port }] }, mount() { mounted++ } }))
  registry.register(tile('odk.tile.provider', { manifest: { schemaVersion: 1, provides: [{ interface: port }] }, create() { throw Error('provider failed') } }))
  registry.register(tile('odk.tile.good'))
  await registry.start()
  assert.equal(registry.activate(registry.get('odk.tile.consumer'), {}, {}), false)
  assert.equal(mounted, 0)
  assert.equal(registry.activate(registry.get('odk.tile.good'), {}, {}), true)
  await registry.stop()
})

test('stop retains failed callbacks and does not repeat successful releases', async () => {
  const { registry } = fixture()
  const released = []
  let fail = true
  const def = tile('odk.tile.fixture', {
    mount(el, ctx) {
      ctx.trackCleanup(() => { released.push(`broken:${el.id}`); if (fail) throw Error('cleanup failed') })
      ctx.trackCleanup(() => released.push(`good:${el.id}`))
    }, unmount(el) { released.push(`unmount:${el.id}`) },
  })
  registry.register(def)
  await registry.start()
  registry.activate(def, { id: 'one' }, {})
  registry.activate(def, { id: 'two' }, {})
  await registry.stop()
  assert.equal(registry.catalog()[0].state, 'cleanup-failed')
  fail = false
  await registry.stop()
  assert.deepEqual(released.sort(), ['broken:one', 'broken:two', 'broken:one', 'broken:two', 'good:one', 'good:two', 'unmount:one', 'unmount:two'].sort())
})

test('partial mount failure releases every cleanup even if one callback throws', async () => {
  const { registry } = fixture()
  let released = 0
  const def = tile('odk.tile.broken', { mount(_el, ctx) {
    ctx.trackCleanup(() => { throw Error('cleanup failed') })
    ctx.trackCleanup(() => { released++ })
    throw Error('mount failed')
  } })
  registry.register(def)
  const el = { replaceChildren() {} }
  assert.equal(registry.activate(def, el, {}), false)
  await assert.rejects(registry.deactivate(def, el, {}), /surface release failed/)
  assert.equal(released, 1)
})

test('surfaces release before factory resources and await asynchronous cleanup', async () => {
  const { registry } = fixture()
  const events = []
  let fail = true
  const def = tile('odk.tile.fixture', {
    create() { return { stop() { events.push('stop') }, destroy() { events.push('destroy') } } },
    mount(_el, ctx) {
      ctx.trackCleanup(async () => { await Promise.resolve(); events.push('cleanup'); if (fail) throw Error('async cleanup failed') })
    },
    unmount() { events.push('unmount') },
  })
  registry.register(def)
  await registry.start()
  registry.activate(def, {}, {})
  await registry.stop()
  assert.deepEqual(events, ['unmount', 'cleanup'])
  assert.equal(registry.catalog()[0].state, 'cleanup-failed')
  fail = false
  await registry.stop()
  assert.deepEqual(events, ['unmount', 'cleanup', 'cleanup', 'stop', 'destroy'])
})

test('stop cancels startup while disabled plugin configuration is pending', async () => {
  const { registry } = fixture()
  let created = 0
  registry.register(tile('odk.tile.disabled'))
  registry.register(tile('odk.tile.live', { create() { created++; return {} } }))
  const starting = registry.start({ disabled: ['odk.tile.disabled'] })
  const stopping = registry.stop()
  await Promise.all([starting, stopping])
  assert.equal(created, 0)
  assert.equal(registry.port('odk:surface/odk.tile.live/v1'), null)
})

for (const failed of [false, true]) {
  test(`factory shutdown waits for pending cleanup after ${failed ? 'failed mount' : 'manual unmount'}`, async () => {
    const { registry } = fixture()
    let release
    const barrier = new Promise((resolve) => { release = resolve })
    const events = []
    const def = tile('odk.tile.fixture', {
      create() { return { stop() { events.push('stop') } } },
      mount(_el, ctx) {
        ctx.trackCleanup(async () => { await barrier; events.push('cleanup') })
        if (failed) throw Error('mount failed')
      },
    })
    registry.register(def)
    await registry.start()
    const el = {}
    registry.activate(def, el, {})
    if (!failed) registry.deactivate(def, el, {})
    const stopping = registry.stop()
    await new Promise(setImmediate)
    const beforeRelease = [...events]
    release()
    await stopping
    assert.deepEqual(beforeRelease, [])
    assert.deepEqual(events, ['cleanup', 'stop'])
  })
}

test('startup selects a compatible renderer replacement and releases its resources', async () => {
  const { registry } = fixture()
  const events = []
  const original = tile('odk.tile.fixture', { create() { throw Error('original must not execute') }, mount() { throw Error('original must not mount') } })
  const replacement = tile(original.id, { create() { events.push('create'); return { stop() { events.push('stop') } } },
    mount(_el, ctx) { events.push('mount'); ctx.trackCleanup(() => events.push('cleanup')) }, unmount() { events.push('unmount') },
  })
  registry.register(original)
  await registry.start({ replacements: [replacement] })
  assert.equal(registry.get(original.id), replacement)
  assert.equal(registry.activate(replacement, {}, {}), true)
  await registry.stop()
  assert.deepEqual(events, ['create', 'mount', 'unmount', 'cleanup', 'stop'])
})

test('renderer replacements validate atomically before factories and preserve the original composition on rejection', async () => {
  for (const change of [
    { id: 'odk.tile.unknown' }, { kind: 'page' }, { manifest: { schemaVersion: 1, provides: [{ interface: 'odk:extra/v1' }] } },
    { manifest: { schemaVersion: 1, minCell: 300 } },
    { manifest: { schemaVersion: 1, requires: [{ interface: 'odk:missing/v1' }] } },
    { manifest: { schemaVersion: 1, requires: [{ interface: 'odk:surface/odk.tile.fixture/v1' }] } },
  ]) {
    const { registry } = fixture()
    let factories = 0
    const original = tile('odk.tile.fixture', { create() { factories++; return {} } })
    registry.register(original)
    await assert.rejects(registry.start({ replacements: [tile(original.id, { ...change, create() { factories++; return {} } })] }))
    assert.equal(factories, 0)
    assert.equal(registry.get(original.id), original)
    await registry.start()
    assert.equal(factories, 1)
    await registry.stop()
  }
})

test('disabled replacement never executes and active composition cannot be replaced', async () => {
  const { registry } = fixture()
  let created = 0
  const original = tile('odk.tile.fixture')
  const replacement = tile(original.id, { create() { created++; return {} } })
  registry.register(original)
  await registry.start({ disabled: [original.id], replacements: [replacement] })
  assert.equal(created, 0)
  assert.equal(registry.catalog()[0].state, 'disabled')
  await assert.rejects(registry.start({ replacements: [original] }), /startup/)
  assert.equal(registry.get(original.id), replacement)
  await registry.stop()
})

test('renderer replacement preserves status slots, App identity, permissions, and unique selection', async () => {
  for (const [original, candidate] of [
    [tile('odk.status.fixture', { kind: 'status', slot: 'left' }), tile('odk.status.fixture', { kind: 'status', slot: 'right' })],
    [tile('odk.app.fixture', { kind: 'app', appId: 'fixture', appKind: 'tool' }), tile('odk.app.fixture', { kind: 'app', appId: 'other', appKind: 'tool' })],
    [tile('odk.page.fixture', { kind: 'page', surface: 'app' }), tile('odk.page.fixture', { kind: 'page', surface: 'display' })],
    [tile('odk.tile.fixture'), tile('odk.tile.fixture', { manifest: { schemaVersion: 1, permissions: ['ipc'] } })],
  ]) {
    const { registry } = fixture()
    registry.register(original)
    await assert.rejects(registry.start({ replacements: [candidate] }), /external contract/)
    assert.equal(registry.get(original.id), original)
    await assert.rejects(registry.start({ replacements: [original, original] }), /identity/)
    await registry.start()
    await registry.stop()
  }
})

test('a pending unmount retains its element until release completes', async () => {
  const { registry } = fixture()
  let release
  const barrier = new Promise(resolve => { release = resolve })
  const el = { text: '' }
  const def = tile('odk.tile.fixture', { mount(element) { element.text = 'mounted' },
    async unmount(element) { await barrier; element.text = '' },
  })
  registry.register(def)
  await registry.start()
  registry.activate(def, el, {})
  const pending = registry.deactivate(def, el, {})
  assert.equal(registry.activate(def, el, {}), false)
  release()
  await pending
  assert.equal(registry.activate(def, el, {}), true)
  await registry.stop()
})

for (const phase of ['unmount', 'cleanup']) {
  test(`failed ${phase} retains ownership until an explicit shutdown retry`, async () => {
    const { registry } = fixture()
    const events = []
    let fail = true
    const el = {}
    const def = tile('odk.tile.retained', {
      create() { return { stop() { events.push('stop') }, destroy() { events.push('destroy') } } },
      mount(_el, ctx) {
        ctx.trackCleanup(() => { events.push('good') })
        ctx.trackCleanup(() => { events.push('cleanup'); if (phase === 'cleanup' && fail) throw Error('retry cleanup') })
      },
      unmount() { events.push('unmount'); if (phase === 'unmount' && fail) throw Error('retry unmount') },
    })
    registry.register(def)
    await registry.start()
    registry.activate(def, el, {})
    await registry.stop()
    assert.equal(registry.catalog()[0].state, 'cleanup-failed')
    assert.equal(events.includes('stop'), false)
    assert.equal(events.includes('destroy'), false)
    assert.equal(registry.activate(def, el, {}), false)
    fail = false
    await registry.stop()
    assert.equal(registry.catalog()[0].state, 'stopped')
    assert.equal(events.filter(event => event === 'good').length, 1)
    assert.equal(events.filter(event => event === phase).length, 2)
    assert.equal(events.filter(event => event === (phase === 'unmount' ? 'cleanup' : 'unmount')).length, 1)
    assert.deepEqual(events.slice(-2), ['stop', 'destroy'])
  })
}


test('concurrent deactivation shares the pending release and retains asynchronous failures', async () => {
  const { registry } = fixture()
  let reject
  let calls = 0
  let fail = true
  const def = tile('odk.tile.pending', {
    unmount() { calls++; return fail ? new Promise((_resolve, rejected) => { reject = rejected }) : undefined },
  })
  registry.register(def)
  await registry.start()
  const el = {}
  registry.activate(def, el, {})
  const first = registry.deactivate(def, el, {})
  assert.equal(registry.deactivate(def, el, {}), first)
  assert.equal(registry.activate(def, el, {}), false)
  await Promise.resolve()
  assert.equal(calls, 1)
  reject(Error('asynchronous unmount failed'))
  await assert.rejects(first, /surface release failed/)
  fail = false
  await registry.deactivate(def, el, {})
  assert.equal(calls, 2)
  assert.equal(registry.activate(def, el, {}), true)
  await registry.stop()
})

test('a failed mount retains cleanup without unmounting an incomplete surface', async () => {
  const { registry } = fixture()
  let fail = true
  let cleaned = 0
  let unmounts = 0
  let factories = 0
  const def = tile('odk.tile.partial', {
    create() { return { stop() { factories++ } } },
    mount(_el, ctx) {
      ctx.trackCleanup(async () => { cleaned++; if (fail) throw Error('partial cleanup failed') })
      throw Error('partial mount failed')
    },
    unmount() { unmounts++ },
  })
  registry.register(def)
  await registry.start()
  const el = { replaceChildren() {} }
  assert.equal(registry.activate(def, el, {}), false)
  await assert.rejects(registry.deactivate(def, el, {}), /surface release failed/)
  await registry.stop()
  assert.equal(registry.catalog()[0].state, 'cleanup-failed')
  assert.equal(factories, 0)
  fail = false
  await registry.stop()
  assert.equal(factories, 1)
  assert.equal(unmounts, 0)
  assert.equal(cleaned, 3)
})

test('a retained surface failure does not stop independent factory cleanup', async () => {
  const { registry } = fixture()
  const released = []
  for (const id of ['broken', 'good']) {
    const def = tile(`odk.tile.${id}`, {
      create() { return { stop() { released.push(id) } } },
      mount(_el, ctx) { ctx.trackCleanup(() => { if (id === 'broken') throw Error('retained') }) },
    })
    registry.register(def)
  }
  await registry.start()
  for (const id of registry.ids()) registry.activate(registry.get(id), {}, {})
  await registry.stop()
  assert.deepEqual(released, ['good'])
  assert.equal(registry.catalog().find(plugin => plugin.manifest.id === 'odk.tile.broken').state, 'cleanup-failed')
})


test('failed mount publishes pending ownership before a reentrant cleanup', async () => {
  const { registry } = fixture()
  const el = { replaceChildren() {} }
  let calls = 0
  let reentrant
  const def = tile('odk.tile.reentrant', {
    mount(_el, ctx) {
      ctx.trackCleanup(() => { calls++; reentrant = registry.deactivate(def, el, {}) })
      throw Error('mount failed')
    },
  })
  registry.register(def)
  await registry.start()
  assert.equal(registry.activate(def, el, {}), false)
  const release = registry.deactivate(def, el, {})
  await release
  assert.equal(reentrant, release)
  assert.equal(calls, 1)
  await registry.stop()
})


test('runtime renderer disable releases consumers first and enable supplies fresh contexts', async () => {
  const { registry } = fixture()
  const events = []
  const signals = []
  const port = 'odk:renderer/runtime-source/v1'
  const provider = tile('odk.tile.provider', {
    manifest: { schemaVersion: 1, provides: [{ interface: port }] },
    create() { events.push('provider-create'); return { ports: { [port]: {} }, stop() { events.push('provider-stop') } } },
  })
  const consumer = tile('odk.tile.consumer', {
    manifest: { schemaVersion: 1, requires: [{ interface: port }] },
    create() { events.push('consumer-create'); return { stop() { events.push('consumer-stop') } } },
    mount(_el, ctx) { signals.push(ctx.signal); ctx.trackCleanup(() => events.push('surface-cleanup')) },
    unmount() { events.push('surface-unmount') },
  })
  registry.register(consumer)
  registry.register(provider)
  registry.register(tile('odk.tile.independent'))
  await registry.start()
  const el = {}
  registry.activate(consumer, el, {})
  events.length = 0
  await registry.setEnabled(provider.id, false)
  assert.deepEqual(events, ['surface-unmount', 'surface-cleanup', 'consumer-stop', 'provider-stop'])
  assert.equal(registry.catalog().find(plugin => plugin.manifest.id === provider.id).state, 'disabled')
  assert.equal(registry.catalog().find(plugin => plugin.manifest.id === consumer.id).state, 'blocked')
  assert.equal(registry.catalog().find(plugin => plugin.manifest.id === 'odk.tile.independent').state, 'running')
  assert.equal(registry.activate(consumer, el, {}), false)
  assert.equal(signals[0].aborted, true)
  await registry.setEnabled(provider.id, true)
  assert.equal(signals.length, 2)
  assert.notEqual(signals[1], signals[0])
  assert.equal(signals[1].aborted, false)
  await registry.stop()
})

test('runtime renderer cleanup failure retains dependent factories until a same-value retry', async () => {
  const { registry } = fixture()
  const port = 'odk:renderer/runtime-source/v1'
  let fail = true
  let creates = 0
  const provider = tile('odk.tile.provider', { manifest: { schemaVersion: 1, provides: [{ interface: port }] },
    create() { creates++; return { ports: { [port]: {} } } },
  })
  const consumer = tile('odk.tile.consumer', { manifest: { schemaVersion: 1, requires: [{ interface: port }] },
    mount(_el, ctx) { ctx.trackCleanup(() => { if (fail) throw Error('retained') }) },
  })
  registry.register(provider)
  registry.register(consumer)
  await registry.start()
  const el = {}
  registry.activate(consumer, el, {})
  await registry.setEnabled(provider.id, false)
  assert.equal(registry.catalog().find(plugin => plugin.manifest.id === consumer.id).state, 'cleanup-failed')
  assert.equal(registry.catalog().find(plugin => plugin.manifest.id === provider.id).state, 'cleanup-blocked')
  await registry.setEnabled(provider.id, true)
  assert.equal(creates, 1)
  fail = false
  await registry.setEnabled(provider.id, false)
  await registry.setEnabled(provider.id, true)
  assert.equal(creates, 2)
  assert.equal(consumer.__lifecycleTrace.filter(phase => phase === 'mount').length, 2)
  await registry.stop()
})

test('runtime lifecycle changes refuse an affected active App before aborting resources', async () => {
  const { registry } = fixture()
  const port = 'odk:renderer/runtime-source/v1'
  const provider = tile('odk.tile.provider', { manifest: { schemaVersion: 1, provides: [{ interface: port }] },
    create() { return { ports: { [port]: {} } } },
  })
  let signal
  const app = tile('odk.app.fixture', { kind: 'app', manifest: { schemaVersion: 1, requires: [{ interface: port }] },
    mount(_el, ctx) { signal = ctx.signal },
  })
  registry.register(provider)
  registry.register(app)
  await registry.start()
  const el = {}
  registry.activate(app, el, {})
  for (const id of [provider.id, app.id]) {
    await assert.rejects(registry.setEnabled(id, false), /App surface must close/)
    assert.equal(signal.aborted, false)
    assert.equal(registry.catalog().find(plugin => plugin.manifest.id === id).state, 'running')
  }
  await registry.deactivate(app, el, {})
  await registry.setEnabled(provider.id, false)
  assert.equal(signal.aborted, true)
  await registry.stop()
})

test('runtime enable starts the selected disabled replacement without switching definitions', async () => {
  const { registry } = fixture()
  let creates = 0
  const original = tile('odk.tile.fixture', { create() { throw Error('unselected') } })
  const replacement = tile(original.id, { create() { creates++; return {} } })
  registry.register(original)
  await registry.start({ disabled: [original.id], replacements: [replacement] })
  await registry.setEnabled(original.id, true)
  assert.equal(creates, 1)
  assert.equal(registry.get(original.id), replacement)
  await registry.setEnabled(original.id, false)
  assert.equal(registry.activate(replacement, {}, {}), false)
  await registry.stop()
})


test('runtime transitions block affected mounts while optional consumers restart', async () => {
  const { registry } = fixture()
  const port = 'odk:renderer/runtime-source/v1'
  let entered
  let release
  const stopped = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const provider = tile('odk.tile.provider', { manifest: { schemaVersion: 1, provides: [{ interface: port }] },
    create() { return { ports: { [port]: {} } } },
  })
  const app = tile('odk.app.optional', { kind: 'app', manifest: { schemaVersion: 1, requires: [{ interface: port, optional: true }] },
    create() { return { stop() { entered(); return gate } } },
  })
  registry.register(provider)
  registry.register(app)
  const independent = tile('odk.tile.independent')
  registry.register(independent)
  await registry.start({ disabled: [provider.id] })
  const enabling = registry.setEnabled(provider.id, true)
  assert.equal(registry.activate(app, {}, {}), false)
  assert.equal(registry.activate(independent, {}, {}), true)
  await stopped
  assert.equal(registry.activate(app, {}, {}), false)
  release()
  await enabling
  const el = {}
  assert.equal(registry.activate(app, el, {}), true)
  await registry.deactivate(app, el, {})
  await registry.stop()
})

test('runtime management validates requests before mutation and refuses a stopped registry', async () => {
  const { registry } = fixture()
  const def = tile('odk.tile.fixture')
  registry.register(def)
  await assert.rejects(registry.setEnabled(def.id, false), /active startup/)
  await registry.start()
  await assert.rejects(registry.setEnabled('odk.tile.unknown', false), /unknown plugin/)
  await assert.rejects(registry.setEnabled(def.id, 'false'), /boolean/)
  assert.equal(registry.catalog()[0].state, 'running')
  await registry.stop()
  await assert.rejects(registry.setEnabled(def.id, true), /active startup/)
  assert.equal(registry.catalog()[0].state, 'stopped')
})


test('repeated startup preferences cannot bypass the active App runtime boundary', async () => {
  const { registry } = fixture()
  let signal
  const app = tile('odk.app.fixture', { kind: 'app', mount(_el, ctx) { signal = ctx.signal } })
  registry.register(app)
  await registry.start()
  const el = {}
  registry.activate(app, el, {})
  await assert.rejects(registry.start({ disabled: [app.id] }), /App surface must close/)
  assert.equal(signal.aborted, false)
  assert.equal(registry.catalog()[0].state, 'running')
  await registry.deactivate(app, el, {})
  await registry.stop()
})


test('an App mount cannot reentrantly bypass runtime release protection', async () => {
  const { registry } = fixture()
  let attempt
  let signal
  const app = tile('odk.app.fixture', { kind: 'app', mount(_el, ctx) {
    signal = ctx.signal
    attempt = registry.setEnabled(app.id, false)
    void attempt.catch(() => {})
  } })
  registry.register(app)
  await registry.start()
  const el = {}
  assert.equal(registry.activate(app, el, {}), true)
  await assert.rejects(attempt, /App surface must close/)
  assert.equal(signal.aborted, false)
  assert.equal(registry.catalog()[0].state, 'running')
  await registry.deactivate(app, el, {})
  await registry.stop()
})


for (const kind of ['tile', 'page', 'status']) {
  test(`runtime management restores the owned ${kind} container with a fresh context`, async () => {
    const { registry } = fixture()
    const signals = []
    const marker = {}
    const element = { content: '', dataset: { placement: 'preserved' }, replaceChildren() { this.content = '' } }
    const def = tile(`odk.${kind}.restored`, { kind, ...(kind === 'status' ? { slot: 'left' } : {}),
      mount(el, ctx) { assert.equal(ctx.marker, marker); signals.push(ctx.signal); el.content = `mount-${signals.length}` },
    })
    registry.register(def)
    await registry.start()
    registry.activate(def, element, { marker })
    await registry.setEnabled(def.id, false)
    assert.equal(element.content, '')
    assert.equal(element.dataset.placement, 'preserved')
    await registry.setEnabled(def.id, true)
    assert.equal(element.content, 'mount-2')
    assert.notEqual(signals[0], signals[1])
    assert.equal(signals[0].aborted, true)
    assert.equal(signals[1].aborted, false)
    await registry.stop()
  })
}

test('manual surface removal does not resurrect a detached placement during management', async () => {
  const { registry } = fixture()
  let mounts = 0
  const def = tile('odk.tile.removed', { mount() { mounts++ } })
  registry.register(def)
  await registry.start()
  const element = { replaceChildren() {} }
  registry.activate(def, element, {})
  await registry.deactivate(def, element, {})
  await registry.setEnabled(def.id, false)
  await registry.setEnabled(def.id, true)
  assert.equal(mounts, 1)
  await registry.stop()
})


test('restoration failure does not prevent other affected surfaces from recovering', async () => {
  const { registry } = fixture()
  const port = 'odk:renderer/recovery/v1'
  registry.register(tile('odk.tile.provider', { manifest: { schemaVersion: 1, provides: [{ interface: port }] },
    create() { return { ports: { [port]: {} } } },
  }))
  let fail = false
  const elements = new Map()
  for (const name of ['broken', 'good']) {
    const def = tile(`odk.tile.${name}`, { manifest: { schemaVersion: 1, requires: [{ interface: port }] },
      mount(el) { if (name === 'broken' && fail) throw Error('mount failed'); el.content = name },
    })
    registry.register(def)
    elements.set(name, { content: '', replaceChildren() { this.content = '' } })
  }
  await registry.start()
  for (const [name, el] of elements) registry.activate(registry.get(`odk.tile.${name}`), el, {})
  await registry.setEnabled('odk.tile.provider', false)
  fail = true
  await assert.rejects(registry.setEnabled('odk.tile.provider', true), /restoration failed/)
  assert.equal(elements.get('good').content, 'good')
  fail = false
  await registry.setEnabled('odk.tile.provider', true)
  assert.equal(elements.get('broken').content, 'broken')
  await registry.stop()
})

test('retained failed mount cannot certify successful restoration', async () => {
  const { registry } = fixture()
  let fail = true
  const def = tile('odk.tile.partial', { mount(_el, ctx) {
    ctx.trackCleanup(() => { if (fail) throw Error('retained partial cleanup') })
    throw Error('partial mount')
  } })
  registry.register(def)
  await registry.start()
  const el = { replaceChildren() {} }
  assert.equal(registry.activate(def, el, {}), false)
  await new Promise(setImmediate)
  await assert.rejects(registry.setEnabled(def.id, true), /restoration failed/)
  fail = false
  await registry.stop()
})


test('failed release preserves placement content until a successful retry', async () => {
  const { registry } = fixture()
  let fail = true
  const el = { content: '', replaceChildren() { this.content = '' } }
  const def = tile('odk.tile.retained-content', { mount(element, ctx) {
    element.content = 'owned'
    ctx.trackCleanup(() => { if (fail) throw Error('retained resource') })
  } })
  registry.register(def)
  await registry.start()
  registry.activate(def, el, {})
  await registry.setEnabled(def.id, false)
  assert.equal(el.content, 'owned')
  assert.equal(registry.catalog()[0].state, 'cleanup-failed')
  fail = false
  await registry.setEnabled(def.id, false)
  assert.equal(el.content, '')
  await registry.setEnabled(def.id, true)
  assert.equal(el.content, 'owned')
  await registry.stop()
})

test('shutdown during factory recovery prevents placement resurrection', async () => {
  const { registry } = fixture()
  let entered
  let release
  let creates = 0
  let mounts = 0
  const waiting = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const def = tile('odk.tile.cancelled-recovery', {
    async create() { creates++; if (creates === 2) { entered(); await gate }; return {} },
    mount() { mounts++ },
  })
  registry.register(def)
  await registry.start()
  registry.activate(def, {}, {})
  await registry.setEnabled(def.id, false)
  const enabling = registry.setEnabled(def.id, true)
  await waiting
  const stopping = registry.stop()
  release()
  await Promise.all([enabling, stopping])
  assert.equal(mounts, 1)
  assert.equal(registry.catalog()[0].state, 'stopped')
})

test('a disconnected released element cannot receive a new mount', async () => {
  const { registry } = fixture()
  let mounts = 0
  const def = tile('odk.tile.disconnected', { mount() { mounts++ } })
  registry.register(def)
  await registry.start()
  const el = { isConnected: true, replaceChildren() {} }
  registry.activate(def, el, {})
  await registry.setEnabled(def.id, false)
  el.isConnected = false
  await registry.setEnabled(def.id, true)
  assert.equal(mounts, 1)
  await registry.stop()
})
