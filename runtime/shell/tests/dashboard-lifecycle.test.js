'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')
const id = 'odk.page.dashboard'

function node(document) {
  let literal = ''
  const children = []
  return { ownerDocument: document, dataset: {}, hidden: false, className: '', children,
    get textContent() { return literal + children.map(child => child.textContent).join('') },
    set textContent(value) { literal = String(value); children.length = 0 },
    append(...values) { children.push(...values) },
    replaceChildren(...values) { literal = ''; children.splice(0, children.length, ...values) },
  }
}

async function fixture(t, { failUnsubscribe = false } = {}) {
  const root = { odkPluginHost: { createPluginHost } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  for (const file of ['core/registry.js', 'plugins/dashboard-page.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  await root.odkPlugins.start()
  t.after(() => root.odkPlugins.stop())
  const document = { createElement: () => node(document), createTextNode: text => {
    const value = node(document); value.textContent = text; return value
  } }
  const nodes = new Map()
  const element = { ownerDocument: document, isConnected: true,
    set innerHTML(_value) { nodes.clear() },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node(document))
      return nodes.get(selector)
    },
    replaceChildren() { nodes.clear() },
  }
  const briefings = [], ticks = [], activeBriefings = new Set(), activeTicks = new Set()
  let releases = 0
  const frame = state => ({ state, items: [], generatedAt: 0, omittedSources: 0 })
  const ui = { homeBriefing: { snapshot: () => frame('empty'), subscribe(callback) {
    briefings.push(callback); activeBriefings.add(callback); callback(frame('empty'))
    return () => {
      releases++
      if (failUnsubscribe && releases === 1) throw Error('Controlled Dashboard unsubscribe failure')
      activeBriefings.delete(callback)
    }
  } }, onTick(callback) {
    ticks.push(callback); activeTicks.add(callback); callback(new Date(2026, 0, 1))
    return () => activeTicks.delete(callback)
  } }
  assert.equal(root.odkPlugins.activate(root.odkPlugins.get(id), element, ui), true)
  const snapshot = () => Object.fromEntries([...nodes].map(([name, value]) => [name,
    { text: value.textContent, dataset: { ...value.dataset }, hidden: value.hidden }]))
  return { registry: root.odkPlugins, element, nodes, briefings, ticks, activeBriefings, activeTicks, frame, snapshot }
}

test('released Dashboard briefing cannot overwrite the next placement in the same container', async t => {
  const f = await fixture(t)
  const oldBriefing = f.briefings[0]
  await f.registry.setEnabled(id, false)
  assert.equal(f.activeBriefings.size, 0)
  assert.equal(f.activeTicks.size, 0)
  await f.registry.setEnabled(id, true)
  assert.equal(f.registry.isActive(f.registry.get(id), f.element), true)
  assert.equal(f.briefings.length, 2)
  f.briefings[1](f.frame('live'))
  const before = f.snapshot()
  oldBriefing(f.frame('error'))
  assert.deepEqual(f.snapshot(), before)
  f.briefings[1](f.frame('unavailable'))
  assert.equal(f.nodes.get('#dash-agent-status').textContent, 'Personal Agent is unavailable.')
  f.ticks[1](new Date(2027, 1, 2))
  assert.equal(f.nodes.get('#dash-md').textContent, 'February 2')
  assert.equal(f.nodes.get('#dash-y').textContent, '2027')
})

test('released Dashboard Tick cannot change the former date nodes', async t => {
  const f = await fixture(t)
  const year = f.nodes.get('#dash-y')
  await f.registry.setEnabled(id, false)
  f.ticks[0](new Date(2099, 0, 1))
  assert.equal(year.textContent, '2026')
})

test('individual Dashboard placement release fences callbacks while the plugin stays enabled', async t => {
  const f = await fixture(t)
  await f.registry.deactivate(f.registry.get(id), f.element)
  assert.equal(f.registry.catalog().find(plugin => plugin.manifest.id === id).state, 'running')
  assert.equal(f.registry.activate(f.registry.get(id), f.element, {
    homeBriefing: { snapshot: () => f.frame('unavailable'), subscribe: () => () => {} },
    onTick(callback) { callback(new Date(2028, 2, 3)); return () => {} },
  }), true)
  const before = f.snapshot()
  f.briefings[0](f.frame('error'))
  f.ticks[0](new Date(2099, 0, 1))
  assert.deepEqual(f.snapshot(), before)
})

test('failed Dashboard unsubscribe fences old updates while cleanup remains owned', async t => {
  const f = await fixture(t, { failUnsubscribe: true })
  const status = f.nodes.get('#dash-agent-status')
  await f.registry.setEnabled(id, false)
  assert.equal(f.registry.catalog().find(plugin => plugin.manifest.id === id).state, 'cleanup-failed')
  assert.equal(f.activeBriefings.size, 1)
  const before = f.snapshot()
  f.briefings[0](f.frame('error'))
  assert.deepEqual(f.snapshot(), before)
  assert.equal(status.textContent, 'Personal Agent has no new desk briefing.')
  await f.registry.setEnabled(id, false)
  assert.equal(f.activeBriefings.size, 0)
  await f.registry.setEnabled(id, true)
  assert.equal(f.activeBriefings.size, 1)
  assert.equal(f.activeTicks.size, 1)
})
