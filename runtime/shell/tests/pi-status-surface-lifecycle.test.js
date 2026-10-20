'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')
const id = 'odk.status.pi-sessions'
const live = { ok: true, source: { label: 'Fixture Pi source' }, summary: { running: 2, settled: 1, workspacesCount: 1 } }

async function fixture(t, independent = false) {
  const pending = []
  const focused = []
  const root = { odkPluginHost: { createPluginHost }, odkPlatform: { getPiSessions() {
    const request = Promise.withResolvers(); pending.push(request); return request.promise
  } } }
  root.document = { querySelector(selector) { assert.match(selector, /odk\.tile\.pi-sessions/); return { focus() { focused.push('pi-widget') } } } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  for (const file of ['core/registry.js', 'plugins/status-pi-sessions.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  root.odkPlugins.captureDefaults()
  let replacement
  root.odkRendererDevelopment = { define(value) { replacement = value } }
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/pi-status-surface-replacement/entry.js'), 'utf8'), context)
  if (independent) {
    root.odkPlugins.get(id).lifecycle.mount = () => { throw Error('Default Pi status delegation refused') }
  }
  await root.odkPlugins.start({ replacements: independent ? [replacement] : [] })
  t.after(() => root.odkPlugins.stop())
  const nodes = new Map()
  const element = { isConnected: true, innerHTML: '', querySelector(selector) {
    if (!nodes.has(selector)) {
      const classes = new Set(), listeners = new Map()
      nodes.set(selector, { textContent: '', className: '', attrs: {}, listeners,
        classes, classList: { add(name) { classes.add(name) }, remove(name) { classes.delete(name) } },
        setAttribute(name, value) { this.attrs[name] = value },
        addEventListener(name, listener) { listeners.set(name, listener) },
        removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name) },
      })
    }
    return nodes.get(selector)
  }, replaceChildren() {} }
  const ticks = new Set(), contributions = [], navigation = []
  const ui = { onTick(callback) { ticks.add(callback); callback(); return () => ticks.delete(callback) },
    navigateToPage(page) { navigation.push(page) }, briefing: { contribute(value) { contributions.push(structuredClone(value)) } } }
  assert.equal(root.odkPlugins.activate(root.odkPlugins.get(id), element, ui), true)
  const settle = () => new Promise(setImmediate)
  return { registry: root.odkPlugins, replacement, element, pending, nodes, ticks, contributions, navigation, focused, settle, tick(count = 1) { for (let index = 0; index < count; index++) for (const callback of ticks) callback() },
    snapshot() { return [...nodes].map(([selector, node]) => ({ selector, text: node.textContent, className: node.className, classes: [...node.classes].sort(), attrs: { ...node.attrs } })) } }
}

for (const independent of [false, true]) for (const outcome of ['success', 'rejection']) test(`${independent ? 'independent' : 'default'} released Pi status ignores a pending scan ${outcome}`, async t => {
  const f = await fixture(t, independent)
  assert.equal(f.pending.length, 1)
  assert.equal(f.ticks.size, 1)
  await f.registry.setEnabled(id, false)
  assert.equal(f.ticks.size, 0)
  const before = f.snapshot(), count = f.contributions.length
  if (outcome === 'success') f.pending[0].resolve(live)
  else f.pending[0].reject(Error('Controlled late scan rejection'))
  await f.settle()
  assert.deepEqual(f.snapshot(), before)
  assert.equal(f.contributions.length, count)
})

for (const outcome of ['success', 'rejection']) test(`replacement Pi status retains its reading after a late default scan ${outcome}`, async t => {
  const f = await fixture(t)
  await f.registry.replace(f.replacement)
  assert.equal(f.pending.length, 2)
  assert.equal(f.ticks.size, 1)
  assert.equal(f.registry.isActive(f.registry.get(id), f.element), true)
  f.pending[1].resolve({ ...live, summary: { running: 1, settled: 0, workspacesCount: 1 } })
  await f.settle()
  assert.equal(f.nodes.get('#sb-pi-count').textContent, '1')
  const before = f.snapshot(), contributions = structuredClone(f.contributions)
  if (outcome === 'success') f.pending[0].resolve(live)
  else f.pending[0].reject(Error('Controlled previous implementation rejection'))
  await f.settle()
  assert.deepEqual(f.snapshot(), before)
  assert.deepEqual(f.contributions, contributions)
})

for (const independent of [false, true]) test(`${independent ? 'independent' : 'default'} released Pi status removes its navigation listener`, async t => {
  const f = await fixture(t, independent)
  const button = f.nodes.get('#sb-pi-status')
  const capturedClick = button.listeners.get('click')
  capturedClick()
  assert.deepEqual(f.navigation, ['home'])
  assert.deepEqual(f.focused, ['pi-widget'])
  await f.registry.setEnabled(id, false)
  assert.equal(button.listeners.has('click'), false)
  button.listeners.get('click')?.()
  capturedClick()
  assert.deepEqual(f.navigation, ['home'])
  assert.deepEqual(f.focused, ['pi-widget'])
  f.pending[0].resolve(live)
  await f.settle()
})


test('independent Pi status preserves cadence readings labels and briefing content', async t => {
  const baseline = await fixture(t), independent = await fixture(t, true)
  const states = [live, { ...live, summary: { running: 1, settled: 0, workspacesCount: 1 } },
    ...[0, 1, 2].map(settled => ({ ...live, summary: { running: 0, settled, workspacesCount: 0 } })),
    { ok: false, source: { label: 'Failed fixture source' } }, null, { ok: true }, Error('Controlled scan rejection')]
  for (const value of states) {
    for (const f of [baseline, independent]) {
      if (f.pending.length > 1 || f.pending[0].settled) f.tick(3)
      const pending = f.pending.at(-1)
      if (value instanceof Error) pending.reject(value)
      else pending.resolve(value)
      pending.settled = true
      await f.settle()
    }
    assert.deepEqual(independent.snapshot(), baseline.snapshot())
    assert.deepEqual(independent.contributions, baseline.contributions)
  }
  for (const f of [baseline, independent]) {
    const before = f.pending.length
    f.tick(1)
    assert.equal(f.pending.length, before)
    f.tick(1)
    assert.equal(f.pending.length, before + 1)
    f.pending.at(-1).resolve(live)
    await f.settle()
  }
})
