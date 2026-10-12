'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')
const id = 'odk.tile.fixture'
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept }); return { promise, resolve } }
function fixture(overrides = {}) {
  const root = { odkPluginHost: { createPluginHost } }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), { window: root, structuredClone, console: { error() {} } })
  const registry = root.odkPlugins
  const events = []
  const signals = []
  const context = { onTick() { return () => {} }, label: 'original UI context' }
  const el = { isConnected: true, text: '', replaceChildren() { this.text = '' } }
  const tile = (version, overrides = {}) => ({ id, kind: 'tile', manifest: { schemaVersion: 1, version, minCell: 120 },
    create() { events.push('create:' + version); return { stop() { events.push('stop:' + version) } } },
    mount(element, ctx) { events.push('mount:' + version); signals.push(ctx.signal); assert.equal(ctx.label, context.label); element.text = version },
    unmount() { events.push('unmount:' + version) }, ...overrides })
  const original = tile('1.0.0', overrides)
  registry.register(original)
  return { registry, events, signals, context, el, tile, original,
    async start() { await registry.start(); assert.equal(registry.activate(original, el, context), true) } }
}

test('runtime surface replacement retains placement context and isolates other factories', async () => {
  const f = fixture()
  let peers = 0
  f.registry.register({ id: 'odk.tile.peer', kind: 'tile', manifest: { schemaVersion: 1 }, create() { peers++; return {} }, mount() {} })
  await f.start()
  const next = f.tile('2.0.0')
  await f.registry.replace(next)
  assert.equal(f.registry.get(id).manifest.version, next.manifest.version)
  assert.equal(f.el.text, '2.0.0')
  assert.equal(f.registry.isActive(f.registry.get(id), f.el), true)
  assert.equal(f.signals[0].aborted, true)
  assert.equal(f.signals[1].aborted, false)
  assert.equal(peers, 1)
  assert.deepEqual(f.events, ['create:1.0.0', 'mount:1.0.0', 'unmount:1.0.0', 'stop:1.0.0', 'create:2.0.0', 'mount:2.0.0'])
  await f.registry.stop()
})

test('runtime surface replacement validates layout and stylesheet contracts before release', async () => {
  const f = fixture(); await f.start()
  const baseline = [...f.events]
  for (const override of [{ kind: 'page' }, { manifest: { schemaVersion: 1, minCell: 121 } }, { css: 'new.css' }]) {
    await assert.rejects(f.registry.replace(f.tile('2.0.0', override)), /contract|stylesheet/)
  }
  assert.deepEqual(f.events, baseline)
  assert.equal(f.signals[0].aborted, false)
  await f.registry.stop()
})

test('pending unmount blocks replacement construction and stop suppresses remount', async () => {
  const f = fixture()
  const entered = deferred(); const finish = deferred()
  f.original.lifecycle.unmount = () => { entered.resolve(); return finish.promise }
  await f.start()
  const replacing = f.registry.replace(f.tile('2.0.0'))
  const rejected = assert.rejects(replacing, /cancelled|shutting down/)
  await entered.promise
  assert.equal(f.el.text, '1.0.0')
  assert.equal(f.events.includes('create:2.0.0'), false)
  const stopped = f.registry.stop()
  finish.resolve()
  await rejected; await stopped
  assert.equal(f.events.includes('create:2.0.0'), false)
  assert.equal(f.registry.isActive(f.original, f.el), false)
})

test('failed old surface release retains its element until replacement retry succeeds', async () => {
  const f = fixture(); let refuse = true
  f.original.lifecycle.unmount = () => { if (refuse) throw Error('old surface retained') }
  await f.start()
  const next = f.tile('2.0.0')
  await assert.rejects(f.registry.replace(next), /retains resources/)
  assert.equal(f.registry.get(id), f.original)
  assert.equal(f.el.text, '1.0.0')
  assert.equal(f.events.includes('create:2.0.0'), false)
  refuse = false
  await f.registry.replace(next)
  assert.equal(f.el.text, '2.0.0')
  await f.registry.stop()
})

test('candidate factory failure restores the original definition and retained placement', async () => {
  const f = fixture(); await f.start()
  await assert.rejects(f.registry.replace(f.tile('2.0.0', { create() { throw Error('candidate factory') } })), /replacement failed/)
  assert.equal(f.registry.get(id), f.original)
  assert.equal(f.el.text, '1.0.0')
  assert.equal(f.registry.isActive(f.original, f.el), true)
  await f.registry.stop()
})

test('candidate mount failure rolls back after its surface cleanup', async () => {
  const f = fixture(); await f.start()
  await assert.rejects(f.registry.replace(f.tile('2.0.0', { mount(_el, ctx) {
    ctx.trackCleanup(() => f.events.push('candidate:cleanup'))
    throw Error('candidate mount')
  } })), /restoration failed/)
  assert.equal(f.registry.get(id), f.original)
  assert.equal(f.el.text, '1.0.0')
  assert.ok(f.events.indexOf('candidate:cleanup') < f.events.lastIndexOf('create:1.0.0'))
  await f.registry.stop()
})

test('candidate cleanup failure retains selected definition and blocks rollback until explicit recovery', async () => {
  const f = fixture(); await f.start(); let refuse = true
  const next = f.tile('2.0.0', { mount(_el, ctx) {
    ctx.trackCleanup(() => { if (refuse) throw Error('candidate retained') })
    throw Error('candidate mount')
  } })
  await assert.rejects(f.registry.replace(next), /retains resources/)
  assert.equal(f.registry.get(id).manifest.version, next.manifest.version)
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 1)
  refuse = false
  await f.registry.replace(f.original)
  assert.equal(f.el.text, '1.0.0')
  await f.registry.stop()
})

test('active dependent App refuses runtime replacement before cancellation', async () => {
  const port = 'odk:renderer/source/v1'
  const f = fixture({ manifest: { schemaVersion: 1, minCell: 120, provides: [{ interface: port }] }, create: () => ({ ports: { [port]: 42 } }) })
  const app = { id: 'odk.app.fixture', kind: 'app', manifest: { schemaVersion: 1, requires: [{ interface: port }] }, mount() {} }
  f.registry.register(app)
  await f.start()
  const appElement = {}
  assert.equal(f.registry.activate(app, appElement, {}), true)
  const next = f.tile('2.0.0', { manifest: { ...f.original.manifest, version: '2.0.0' }, create: f.original.create })
  await assert.rejects(f.registry.replace(next), /App surface must close/)
  assert.equal(f.signals[0].aborted, false)
  await f.registry.deactivate(app, appElement)
  await f.registry.replace(next)
  assert.equal(f.el.text, '2.0.0')
  await f.registry.stop()
})

test('queued surface replacements restore each selection before the next transition', async () => {
  const f = fixture(); await f.start()
  const second = f.tile('2.0.0'); const third = f.tile('3.0.0')
  await Promise.all([f.registry.replace(second), f.registry.replace(third)])
  assert.equal(f.el.text, '3.0.0')
  assert.equal(f.registry.get(id).manifest.version, third.manifest.version)
  assert.ok(f.events.indexOf('mount:2.0.0') < f.events.indexOf('create:3.0.0'))
  await f.registry.stop()
})

test('controller shutdown fences registry replacement before delayed unmount settles', async () => {
  const f = fixture()
  const entered = deferred(); const finish = deferred()
  f.original.lifecycle.unmount = () => { entered.resolve(); return finish.promise }
  await f.start()
  const root = {}
  vm.runInNewContext(fs.readFileSync('src/renderer/core/runtime-controller.js', 'utf8'), { window: root })
  const controller = root.odkRendererRuntimeController.create({ registry: f.registry,
    composer: { reconcile() {}, reconcileStatus() {} }, layout: {}, track: {}, context: {}, onPlacementsChanged() {} })
  const replacing = controller.replace(f.tile('2.0.0'))
  const rejected = assert.rejects(replacing, /cancelled|shutting down/)
  await entered.promise
  const stopped = controller.stop()
  finish.resolve()
  await rejected; await stopped
  assert.equal(f.events.includes('create:2.0.0'), false)
  assert.equal(f.events.includes('mount:2.0.0'), false)
})

test('dependent placements remount with fresh provider ports while preserving their containers', async () => {
  const port = 'odk:renderer/source/v1'
  const f = fixture({ manifest: { schemaVersion: 1, minCell: 120, provides: [{ interface: port }] },
    create: () => ({ ports: { [port]: 1 } }) })
  const consumed = []
  const consumer = { id: 'odk.tile.consumer', kind: 'tile', manifest: { schemaVersion: 1, requires: [{ interface: port }] },
    mount(el, ctx) { el.value = ctx.getPort(port); consumed.push(ctx.signal) } }
  f.registry.register(consumer)
  await f.start()
  const element = { isConnected: true, replaceChildren() {} }
  f.registry.activate(consumer, element, {})
  await f.registry.replace(f.tile('2.0.0', { manifest: { ...f.original.manifest, version: '2.0.0' },
    create: () => ({ ports: { [port]: 2 } }) }))
  assert.equal(element.value, 2)
  assert.equal(consumed[0].aborted, true)
  assert.equal(consumed[1].aborted, false)
  assert.equal(f.registry.isActive(consumer, element), true)
  await f.registry.stop()
})

test('runtime admission captures identity styles factory and lifecycle before caller mutation', async () => {
  const f = fixture({ css: 'original.css' })
  const entered = deferred(); const finish = deferred()
  f.original.lifecycle.unmount = () => { entered.resolve(); return finish.promise }
  await f.start()
  const next = f.tile('2.0.0', { css: 'original.css' })
  const admittedMount = next.mount
  const replacing = f.registry.replace(next)
  next.css = 'changed.css'
  next.manifest.version = '9.0.0'
  await entered.promise
  next.id = 'odk.tile.changed'
  next.create = () => { throw Error('changed factory must not execute') }
  next.mount = () => { throw Error('changed mount must not execute') }
  finish.resolve()
  await replacing
  const selected = f.registry.get(id)
  assert.equal(selected.id, id)
  assert.equal(selected.css, 'original.css')
  assert.equal(selected.manifest.version, '2.0.0')
  assert.equal(selected.lifecycle.mount, admittedMount)
  assert.equal(f.el.text, '2.0.0')
  await f.registry.stop()
})

test('built-in restoration captures packaged lifecycle before external mutation and preserves placements', async () => {
  const f = fixture()
  f.registry.captureDefaults()
  f.original.manifest.version = '9.0.0'
  f.original.lifecycle.mount = () => { throw Error('modified default must not execute') }
  f.original.create = () => { throw Error('modified default factory must not execute') }
  const replacement = f.tile('2.0.0')
  await f.registry.start({ replacements: [replacement] })
  f.registry.activate(f.registry.get(id), f.el, f.context)
  const result = await f.registry.restoreDefault(id)
  assert.equal(result.implementation, 'built-in')
  assert.equal(result.version, '1.0.0')
  assert.equal(result.state, 'running')
  assert.equal(f.el.text, '1.0.0')
  assert.equal(f.registry.get(id).manifest.version, '1.0.0')
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 1)
  await f.registry.stop()
})

test('built-in restoration refuses disabled and uncaptured identities without constructing factories', async () => {
  const f = fixture()
  f.registry.captureDefaults()
  f.registry.register({ id: 'odk.tile.extension', kind: 'tile', manifest: { schemaVersion: 1 }, mount() {} })
  await f.registry.start({ disabled: [id] })
  await assert.rejects(f.registry.restoreDefault(id), /enabled/)
  await assert.rejects(f.registry.restoreDefault('odk.tile.extension'), /built-in default/)
  assert.equal(f.events.length, 0)
  await f.registry.stop()
})

test('built-in restoration checks enable state again after queued disable', async () => {
  const f = fixture()
  f.registry.captureDefaults()
  await f.start()
  const disabled = f.registry.setEnabled(id, false)
  const restored = f.registry.restoreDefault(id)
  const rejected = assert.rejects(restored, /enabled/)
  await disabled
  await rejected
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 1)
  assert.equal(f.registry.catalog().find(plugin => plugin.manifest.id === id).state, 'disabled')
  await f.registry.stop()
})

test('built-in startup failure restores the independent factory without returning successful recovery', async () => {
  let refuse = false
  const f = fixture({ create() { if (refuse) throw Error('default unavailable'); return {} } })
  f.registry.captureDefaults()
  await f.start()
  await f.registry.replace(f.tile('2.0.0'))
  refuse = true
  await assert.rejects(f.registry.restoreDefault(id), /replacement failed/)
  assert.equal(f.registry.get(id).manifest.version, '2.0.0')
  assert.equal(f.el.text, '2.0.0')
  await f.registry.stop()
})

test('built-in restoration retains failed old cleanup and retries without duplicate default construction', async () => {
  const f = fixture()
  f.registry.captureDefaults()
  await f.start()
  let refuse = true
  await f.registry.replace(f.tile('2.0.0', { unmount() { if (refuse) throw Error('retained external surface') } }))
  await assert.rejects(f.registry.restoreDefault(id), /retains resources/)
  assert.equal(f.registry.get(id).manifest.version, '2.0.0')
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 1)
  refuse = false
  await f.registry.restoreDefault(id)
  assert.equal(f.el.text, '1.0.0')
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 2)
  await f.registry.stop()
})

test('shutdown while built-in restoration drains external surfaces suppresses default construction and remount', async () => {
  const f = fixture()
  f.registry.captureDefaults()
  await f.start()
  const entered = deferred(); const finish = deferred()
  await f.registry.replace(f.tile('2.0.0', { unmount() { entered.resolve(); return finish.promise } }))
  const restored = f.registry.restoreDefault(id)
  const rejected = assert.rejects(restored, /cancelled|shutting down/)
  await entered.promise
  const stopped = f.registry.stop()
  finish.resolve()
  await rejected; await stopped
  assert.equal(f.events.filter(event => event === 'create:1.0.0').length, 1)
  assert.equal(f.registry.isActive(f.registry.get(id), f.el), false)
})

test('built-in restoration accepts the captured stylesheet binding without broadening ordinary replacement', async () => {
  const f = fixture()
  f.registry.captureDefaults()
  const replacement = f.tile('2.0.0', { css: 'external.css', manifest: { schemaVersion: 1, version: '2.0.0', minCell: 120, css: 'external.css' } })
  f.registry.prepareDevelopmentStylesheet(replacement, 'file:///fixture/external.css')
  await f.registry.start({ replacements: [replacement] })
  f.registry.activate(f.registry.get(id), f.el, f.context)
  await assert.rejects(f.registry.replace(f.original), /stylesheet contract/)
  await f.registry.restoreDefault(id)
  assert.equal(f.el.text, '1.0.0')
  assert.equal(f.registry.get(id).css, undefined)
  assert.equal(f.signals[0].aborted, true)
  await f.registry.stop()
})
