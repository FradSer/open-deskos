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
  return { ownerDocument: document, dataset: {}, attributes: {}, setAttribute(name, value) { this.attributes[name] = value }, hidden: false, className: '', classList: { contains: () => false }, children,
    clientWidth: 600, scrollWidth: 600, scrollHeight: 20,
    getBoundingClientRect: () => ({ top: 0 }), style: { setProperty() {} },
    get textContent() { return literal + children.map(child => child.textContent).join('') },
    set textContent(value) { literal = String(value); children.length = 0 },
    append(...values) { children.push(...values) },
    replaceChildren(...values) { literal = ''; children.splice(0, children.length, ...values) },
  }
}

async function fixture(t, { failUnsubscribe = false, fit = false } = {}) {
  const root = { odkPluginHost: { createPluginHost }, odkPersonalBotReply: { render(target, text) { target.textContent = text } } }
  const fitResources = { observers: new Set(), callbacks: [], frames: new Map(), fontListeners: new Set() }
  if (fit) {
    const observer = class {
      constructor(callback) { fitResources.observers.add(this); fitResources.callbacks.push(callback) }
      observe() {}
      disconnect() { fitResources.observers.delete(this) }
    }
    root.ResizeObserver = observer; root.MutationObserver = observer
    root.getComputedStyle = () => ({ paddingBottom: '0px' })
    let frameId = 0
    root.requestAnimationFrame = callback => { fitResources.frames.set(++frameId, callback); return frameId }
    root.cancelAnimationFrame = id => fitResources.frames.delete(id)
  }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  for (const file of ['core/registry.js', 'plugins/dashboard-page.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  await root.odkPlugins.start()
  t.after(() => root.odkPlugins.stop())
  const document = { createElement: () => node(document), createTextNode: text => {
    const value = node(document); value.textContent = text; return value
  } }
  if (fit) {
    document.documentElement = {}
    document.fonts = { ready: Promise.resolve(),
      addEventListener(_name, callback) { fitResources.fontListeners.add(callback) },
      removeEventListener(_name, callback) { fitResources.fontListeners.delete(callback) } }
  }
  const nodes = new Map()
  let markup = ''
  const element = { ownerDocument: document, isConnected: true,
    closest() { return fit ? { clientHeight: 300, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) } : null },
    set innerHTML(value) { markup = value; nodes.clear() },
    get innerHTML() { return markup },
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
  return { registry: root.odkPlugins, element, nodes, briefings, ticks, activeBriefings, activeTicks, frame, snapshot, fitResources }
}

test('Dashboard releases fitting observers, fonts and queued frames', async t => {
  const f = await fixture(t, { fit: true })
  assert.equal(f.fitResources.observers.size, 2)
  assert.equal(f.fitResources.fontListeners.size, 1)
  assert.equal(f.fitResources.frames.size, 1)
  await f.registry.deactivate(f.registry.get(id), f.element)
  assert.equal(f.fitResources.observers.size, 0)
  assert.equal(f.fitResources.fontListeners.size, 0)
  assert.equal(f.fitResources.frames.size, 0)
  for (const callback of f.fitResources.callbacks) callback()
  assert.equal(f.fitResources.frames.size, 0, 'late observer delivery cannot schedule work after release')
})

test('Dashboard omits attribution, update metadata and Sources controls', async t => {
  const f = await fixture(t)
  assert.doesNotMatch(f.element.innerHTML, /dash-foot|dash-agent-status|dash-provenance|dash-source-list|<details|<summary/)
  assert.match(f.element.innerHTML, /id="dash-narrative"[^>]*role="status"[^>]*aria-live="polite"/)
})

test('Dashboard reports retained-reading failures only through its indicator', async t => {
  const f = await fixture(t)
  const item = { text: 'Retained desk reading.', segments: [{ text: 'Retained desk reading.' }], sources: [] }
  for (const state of ['stale', 'error', 'unavailable']) {
    f.briefings[0]({ ...f.frame(state), items: [item] })
    const narrative = f.nodes.get('#dash-narrative')
    assert.equal(narrative.textContent, item.text)
    assert.match(f.nodes.get('.dash-presence').attributes['aria-label'], /retry|reconnect/i)
    assert.ok(narrative.textContent.endsWith(item.text))
    assert.equal(narrative.dataset.state, state)
  }
  f.briefings[0]({ ...f.frame('live'), items: [item] })
  assert.equal(f.nodes.get('#dash-narrative').textContent, item.text)
})

test('Overview loading keeps retained text and uses only the existing busy indicator', async t => {
  const f = await fixture(t)
  const item = { text: 'Retained desk reading.', segments: [{ text: 'Retained desk reading.' }], sources: [] }
  f.briefings[0]({ ...f.frame('live'), items: [item] })
  const narrative = f.nodes.get('#dash-narrative')
  const before = narrative.textContent
  f.briefings[0]({ ...f.frame('loading'), items: [item] })
  assert.equal(narrative.textContent, before)
  assert.equal(narrative.attributes['aria-busy'], 'true')
  f.briefings[0](f.frame('loading'))
  assert.equal(narrative.textContent, 'Personal Agent has no new desk briefing.')
  f.briefings[0](f.frame('error'))
  assert.equal(narrative.attributes['aria-busy'], 'false')
  assert.equal(narrative.textContent, '')
  assert.match(f.nodes.get('.dash-presence').attributes['aria-label'], /failed.*retry/)
})

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
  assert.equal(f.nodes.get('#dash-narrative').textContent, '')
  assert.match(f.nodes.get('.dash-presence').attributes['aria-label'], /reconnect/)
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
  const status = f.nodes.get('#dash-narrative')
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
