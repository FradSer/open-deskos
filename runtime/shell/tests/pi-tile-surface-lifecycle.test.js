'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')
const id = 'odk.tile.pi-sessions'

async function fixture(t, independent) {
  const pending = [], observers = [], ticks = new Set(), nodes = new Map(), classes = new Set()
  const box = { width: 300, height: 300 }
  let failDisconnect = false, disconnects = 0
  const root = { odkPluginHost: { createPluginHost }, odkGridPlacement: { meetsMinCell: (w, h, min) => Math.min(w, h) >= min },
    odkPlatform: { getPiSessions() { const request = Promise.withResolvers(); pending.push(request); return request.promise } } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} }, ResizeObserver: class {
    constructor(callback) { observers.push(callback) } observe() {} disconnect() { disconnects++; if (failDisconnect) throw Error('Observer retained') }
  } })
  for (const file of ['core/registry.js', 'plugins/pi-sessions.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  root.odkPlugins.captureDefaults()
  let replacement
  root.odkRendererDevelopment = { define(value) { replacement = value } }
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/pi-tile-surface-replacement/entry.js'), 'utf8'), context)
  if (independent) root.odkPlugins.get(id).lifecycle.mount = () => { throw Error('Default Widget delegation refused') }
  await root.odkPlugins.start({ replacements: independent ? [replacement] : [] })
  t.after(async () => { failDisconnect = false; await root.odkPlugins.stop() })
  const element = { isConnected: true, innerHTML: '', classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', className: '', hidden: false })
      return nodes.get(selector)
    }, replaceChildren() {}, getBoundingClientRect: () => box }
  const ui = { onTick(callback) { ticks.add(callback); callback(); return () => ticks.delete(callback) } }
  assert.equal(root.odkPlugins.activate(root.odkPlugins.get(id), element, ui), true)
  return { registry: root.odkPlugins, replacement, element, nodes, box, pending, observers, ticks,
    failDisconnect(value) { failDisconnect = value }, disconnects: () => disconnects,
    settle: () => new Promise(setImmediate),
    snapshot: () => JSON.stringify([...nodes].map(([selector, node]) => [selector, { ...node }])),
  }
}

for (const independent of [false, true]) {
  test(`${independent ? 'independent' : 'default'} released Pi Widget ignores retained resize callback`, async t => {
    const f = await fixture(t, independent)
    assert.equal(f.observers.length, 1)
    assert.equal(f.ticks.size, 1)
    assert.equal(f.nodes.get('.pi-widget-summary').hidden, false)
    await f.registry.setEnabled(id, false)
    assert.equal(f.ticks.size, 0)
    assert.equal(f.disconnects(), 1)
    const before = f.snapshot()
    f.box.width = 100
    f.observers[0]()
    assert.equal(f.snapshot(), before)
  })
  test(`${independent ? 'independent' : 'default'} failed observer release revokes writes and retains cleanup retry`, async t => {
    const f = await fixture(t, independent)
    const tick = [...f.ticks][0]
    f.failDisconnect(true)
    await f.registry.setEnabled(id, false)
    assert.equal(f.registry.catalog().find(plugin => plugin.manifest.id === id).state, 'cleanup-failed')
    const before = f.snapshot(), requests = f.pending.length
    f.box.width = 100; f.observers[0]()
    for (let count = 0; count < 6; count++) tick()
    f.pending[0].resolve({ ok: true, summary: { running: 99 } })
    await f.settle()
    assert.equal(f.snapshot(), before)
    assert.equal(f.pending.length, requests)
    f.failDisconnect(false)
    await f.registry.setEnabled(id, false)
    assert.equal(f.disconnects(), 2)
    assert.equal(f.ticks.size, 0)
  })
}

test('Pi Widget replacement keeps the same placement safe from old reads and size callbacks', async t => {
  const f = await fixture(t, false)
  await f.registry.replace(f.replacement)
  assert.equal(f.registry.isActive(f.registry.get(id), f.element), true)
  assert.equal(f.pending.length, 2)
  assert.equal(f.ticks.size, 1)
  f.pending[1].resolve({ ok: true, sessions: [], summary: { running: 0, workspacesCount: 0 } })
  await f.settle()
  const before = f.snapshot()
  f.box.width = 100; f.observers[0]()
  f.pending[0].reject(Error('Old implementation failed'))
  await f.settle()
  assert.equal(f.snapshot(), before)
})
