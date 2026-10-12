'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

async function fixture(t, kind, independent = false) {
  const id = `odk.status.${kind}`
  const connections = new Set(), events = new Set(), operations = []
  const root = { odkPluginHost: { createPluginHost },
    addEventListener(name, callback) { assert.equal(name, 'odk-gamepad-state'); events.add(callback); operations.push('acquire') },
    removeEventListener(name, callback) { assert.equal(name, 'odk-gamepad-state'); events.delete(callback); operations.push('release') } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/registry.js'), 'utf8'), context)
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/renderer/plugins/status-${kind}.js`), 'utf8'), context)
  root.odkPlugins.captureDefaults()
  let replacement
  root.odkRendererDevelopment = { define(value) { replacement = value } }
  vm.runInContext(fs.readFileSync(path.join(__dirname, `fixtures/${kind}-status-surface-replacement/entry.js`), 'utf8'), context)
  if (independent) root.odkPlugins.get(id).lifecycle.mount = () => { throw Error('Default status delegation refused') }
  await root.odkPlugins.start({ replacements: independent ? [replacement] : [] })
  t.after(() => root.odkPlugins.stop())
  const mounts = []
  let indicator
  const element = { isConnected: true, set innerHTML(value) {
    const nodes = new Map()
    const node = selector => {
      if (!nodes.has(selector)) nodes.set(selector, { attrs: {}, dataset: {}, querySelector: node,
        setAttribute(name, value) { this.attrs[name] = value }, removeAttribute(name) { delete this.attrs[name] } })
      return nodes.get(selector)
    }
    indicator = node(kind === 'connection' ? '#sb-net' : '#sb-pad')
    if (value.includes('role="img" hidden')) indicator.setAttribute('hidden', '')
    mounts.push(nodes)
  }, querySelector() { return indicator }, replaceChildren() {} }
  const ui = { connection: { labelFor: online => online ? 'Connected fixture' : 'Offline fixture', subscribe(callback) {
    connections.add(callback); operations.push('acquire'); callback(true)
    return () => { connections.delete(callback); operations.push('release') }
  } } }
  assert.equal(root.odkPlugins.activate(root.odkPlugins.get(id), element, ui), true)
  const callbacks = kind === 'connection' ? connections : events
  const invoke = (callback, input) => callback(kind === 'connection' ? input : { detail: input })
  return { id, registry: root.odkPlugins, replacement, element, callbacks, operations, invoke,
    emit(value) { for (const callback of callbacks) invoke(callback, value) },
    snapshot(index = mounts.length - 1) {
      return [...mounts[index]].map(([selector, node]) => ({ selector, attrs: { ...node.attrs }, dataset: { ...node.dataset } }))
    } }
}

for (const kind of ['connection', 'gamepad']) {
  test(`independent ${kind} status preserves state projection`, async t => {
    const baseline = await fixture(t, kind), independent = await fixture(t, kind, true)
    const states = kind === 'connection' ? [true, false, true] : [null,
      { connected: true, readable: true, id: 'Fixture pad' }, { connected: true, readable: false, id: 'Unreadable pad' },
      { connected: false, readable: true, id: 'Released pad' }, { connected: true, readable: true, id: '<script> inert fixture 输入' }]
    for (const value of states) {
      baseline.emit(value); independent.emit(value)
      assert.deepEqual(independent.snapshot(), baseline.snapshot())
      assert.equal(independent.callbacks.size, 1)
    }
  })

  for (const independent of [false, true]) test(`${independent ? 'independent' : 'default'} ${kind} status suppresses captured callbacks after replacement`, async t => {
    const f = await fixture(t, kind, independent)
    const previous = [...f.callbacks][0]
    const old = f.snapshot()
    await f.registry.replace(f.replacement)
    assert.deepEqual(f.operations, ['acquire', 'release', 'acquire'])
    assert.equal(f.callbacks.size, 1)
    const current = f.snapshot()
    f.invoke(previous, kind === 'connection' ? false : { connected: true, readable: true, id: 'Late old pad' })
    assert.deepEqual(f.snapshot(0), old)
    assert.deepEqual(f.snapshot(), current)
    await f.registry.setEnabled(f.id, false)
    assert.equal(f.callbacks.size, 0)
    await f.registry.setEnabled(f.id, true)
    assert.equal(f.callbacks.size, 1)
    await f.registry.stop()
    assert.equal(f.callbacks.size, 0)
  })
}
