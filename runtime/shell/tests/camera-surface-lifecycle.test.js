'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const id = 'odk.tile.camera'

async function fixture(t, independent = false, { missing = false, reject = false } = {}) {
  const nodes = new Map()
  const callbacks = []
  const active = new Set()
  const events = []
  let refuse = false
  const element = { isConnected: true, innerHTML: '', replaceChildren() { this.innerHTML = ''; nodes.clear() },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { hidden: true, textContent: '', src: '',
        removeAttribute(name) { if (name === 'src') this.src = '' } })
      return nodes.get(selector)
    } }
  const root = { odkPluginHost: require('../src/plugin-host') }
  const context = vm.createContext({ window: root, structuredClone })
  for (const file of ['core/registry.js', 'plugins/camera.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  root.odkPlugins.captureDefaults()
  let replacement
  root.odkRendererDevelopment = { define(definition) { replacement = definition } }
  if (independent) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/camera-surface-replacement/entry.js'), 'utf8'), context)
    root.odkPlugins.get(id).lifecycle.mount = () => { throw Error('Default Camera mount must not execute') }
  }
  await root.odkPlugins.start({ replacements: independent ? [replacement] : [] })
  const camera = { subscribe(callback) {
    assert.equal(active.size, 0, 'Previous Camera subscription still owns the service')
    callbacks.push(callback); active.add(callback); events.push('subscribe')
    callback({ status: 'unavailable' })
    return () => { events.push('release'); if (refuse) throw Error('Camera listener retained'); active.delete(callback) }
  }, refresh() { events.push('refresh'); return reject ? Promise.reject(Error('Controlled refresh failure')) : Promise.resolve() } }
  const ui = { onTick() {}, ...(missing ? {} : { camera }) }
  assert.equal(root.odkPlugins.activate(root.odkPlugins.get(id), element, ui), true)
  t.after(async () => { refuse = false; await root.odkPlugins.stop() })
  return { registry: root.odkPlugins, element, nodes, callbacks, active, events,
    refuse(value) { refuse = value },
    view() { return { html: element.innerHTML, nodes: [...nodes].map(([selector, node]) =>
      [selector, node.hidden, node.textContent, node.src]) } } }
}

const baseline = new Map()
for (const independent of [false, true]) {
  const label = independent ? 'independent' : 'default'
  test(`${label} Camera surface preserves current and difficult readings`, async t => {
    const f = await fixture(t, independent, { reject: true })
    const readings = [null, {}, { status: 'unavailable' }, { status: 'live', frame: null },
      { status: 'live', frame: 'data:image/png;base64,AAAA', capturedAt: new Date(2026, 8, 17, 2, 30).getTime() },
      { status: 'live', frame: '', capturedAt: 'invalid' }, { status: 'stale', frame: 'old' },
      { status: 'live', frame: 'next', capturedAt: 0 }]
    for (let index = 0; index < readings.length; index++) {
      f.callbacks[0](readings[index])
      if (independent) assert.deepEqual(f.view(), baseline.get(index))
      else baseline.set(index, f.view())
    }
    assert.deepEqual(f.events, ['subscribe', 'refresh'])
    await new Promise(setImmediate)
  })

  test(`${label} Camera release removes its listener and fences late callbacks`, async t => {
    const f = await fixture(t, independent)
    await f.registry.deactivate(f.registry.get(id), f.element)
    assert.equal(f.active.size, 0)
    const before = f.view()
    f.callbacks[0]({ status: 'live', frame: 'late', capturedAt: Date.now() })
    assert.deepEqual(f.view(), before)
  })

  test(`${label} Camera failed release blocks remount until cleanup retry`, async t => {
    const f = await fixture(t, independent)
    f.refuse(true)
    await f.registry.setEnabled(id, false)
    assert.equal(f.registry.catalog().find(plugin => plugin.manifest.id === id).state, 'cleanup-failed')
    assert.equal(f.active.size, 1)
    assert.equal(f.callbacks.length, 1)
    f.refuse(false)
    await f.registry.setEnabled(id, false)
    assert.equal(f.active.size, 0)
    await f.registry.setEnabled(id, true)
    assert.equal(f.active.size, 1)
    assert.equal(f.callbacks.length, 2)
    const before = f.view()
    f.callbacks[0]({ status: 'live', frame: 'old mount' })
    assert.deepEqual(f.view(), before)
  })

  test(`${label} Camera mounts without a service`, async t => {
    const f = await fixture(t, independent, { missing: true })
    assert.match(f.element.innerHTML, /Camera unavailable/)
    assert.equal(f.events.length, 0)
  })

  test(`${label} Camera built-in recovery retains its container and current service`, async t => {
    const f = await fixture(t, independent)
    await f.registry.restoreDefault(id)
    assert.equal(f.active.size, 1)
    assert.equal(f.callbacks.length, 2)
    assert.equal(f.registry.isActive(f.registry.get(id), f.element), true)
    f.callbacks[1]({ status: 'live', frame: 'restored' })
    assert.equal(f.nodes.get('.w-camera-frame').src, 'restored')
    assert.deepEqual(f.events, ['subscribe', 'refresh', 'release', 'subscribe', 'refresh'])
  })
}
