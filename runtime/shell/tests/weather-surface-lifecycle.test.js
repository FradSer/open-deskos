'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

test('independent Weather surface shares only the declared visual stylesheet snapshot', () => {
  assert.deepEqual(fs.readFileSync(path.join(__dirname, 'fixtures/weather-surface-replacement/weather.css')),
    fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/weather.css')))
})

const live = { status: 'live', place: 'Controlled place', updatedAt: 1700000000000,
  current: { temperature: 25, unit: '°C', condition: 'Clear sky', sky: 'sun' }, daily: { high: 31, low: 24 } }

async function fixture(t, replacement = false) {
  const nodes = new Map()
  const ticks = new Set()
  const operations = []
  const staleTicks = []
  const element = { dataset: {}, attributes: {}, isConnected: true, innerHTML: '',
    setAttribute(name, value) { this.attributes[name] = value },
    replaceChildren() { nodes.clear(); this.innerHTML = '' },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '', attributes: {},
        setAttribute(name, value) { this.attributes[name] = value }, replaceChildren(...children) { this.children = children } })
      return nodes.get(selector)
    } }
  const root = { odkPluginHost: { createPluginHost }, odkIcons: { apply() {} },
    document: { querySelector: () => ({}), createElement: () => ({}), head: { appendChild() {} },
      createElementNS: () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value }, innerHTML: '' }) },
    odkPlatform: { getWeatherStatus(request) {
      return new Promise((resolve, reject) => operations.push({ request, resolve, reject }))
    } } }
  const context = vm.createContext({ window: root, structuredClone, document: root.document, console, AbortController })
  for (const file of ['core/registry.js', 'plugins/weather.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  let selected
  if (replacement) {
    root.odkRendererDevelopment = { define(definition) { selected = definition } }
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/weather-surface-replacement/entry.js'), 'utf8'), context)
    assert.ok(selected)
  }
  await root.odkPlugins.start({ replacements: selected ? [selected] : [] })
  const ui = { onTick(callback) { ticks.add(callback); staleTicks.push(callback); return () => ticks.delete(callback) } }
  const definition = root.odkPlugins.get('odk.tile.weather')
  assert.equal(root.odkPlugins.activate(definition, element, ui), true)
  t.after(async () => {
    await root.odkPlugins.stop()
    for (const operation of operations) operation.resolve(live)
    await new Promise(setImmediate)
  })
  return { root, element, nodes, ticks, operations, staleTicks,
    settle: () => new Promise(setImmediate),
    snapshot: () => JSON.stringify({ dataset: element.dataset, attributes: element.attributes,
      nodes: [...nodes].map(([selector, node]) => [selector, node.textContent, node.className, node.hidden, node.innerHTML, node.children]) }) }
}

const displayBaseline = new Map()
for (const replacement of [false, true]) {
for (const outcome of ['success', 'rejection']) {
  for (const phase of ['cached', 'forced']) {
    test(`${replacement ? 'independent' : 'default'} Weather released ${phase} ${outcome} cannot mutate or continue requests`, async t => {
      const f = await fixture(t, replacement)
      if (phase === 'forced') { f.operations[0].resolve(live); await f.settle() }
      const pending = f.operations.at(-1)
      const count = f.operations.length
      await f.root.odkPlugins.deactivate(f.root.odkPlugins.get('odk.tile.weather'), f.element)
      assert.equal(f.ticks.size, 0)
      const before = f.snapshot()
      for (let index = 0; index < 5; index++) f.staleTicks[0]()
      if (outcome === 'success') pending.resolve({ ...live, place: 'Late place' })
      else pending.reject(Error('Late IPC failure'))
      await f.settle()
      assert.equal(f.snapshot(), before)
      assert.equal(f.operations.length, count)
    })
  }
}

test(`${replacement ? 'independent' : 'default'} Weather enable restores a fresh mount isolated from its released response`, async t => {
  const f = await fixture(t, replacement)
  const old = f.operations[0]
  await f.root.odkPlugins.setEnabled('odk.tile.weather', false)
  assert.equal(f.ticks.size, 0)
  await f.root.odkPlugins.setEnabled('odk.tile.weather', true)
  assert.equal(f.operations.length, 2)
  f.operations[1].resolve({ ...live, place: 'New mount' })
  await f.settle()
  f.operations[2].resolve({ ...live, place: 'New mount' })
  await f.settle()
  const before = f.snapshot()
  old.resolve({ ...live, place: 'Old mount' })
  await f.settle()
  assert.equal(f.snapshot(), before)
  assert.equal(f.operations.length, 3)
  assert.equal(f.nodes.get('.w-weather-place').textContent, 'New mount')
})


test(`${replacement ? 'independent' : 'default'} Weather preserves difficult display states and tick cadence`, async t => {
  const cases = [null, false, 0, '', live, { ...live, status: 'stale', error: 'Controlled failure' },
    { status: 'unavailable', unit: '°C' }, { status: 'unconfigured', unit: '°F' },
    { status: 'live', current: null }, { status: 'unexpected' },
    { status: 'live', current: { get temperature() { throw Error('Malformed temperature') } } },
    { ...live, place: 'English 与中文地点', current: { ...live.current, temperature: -100, sky: 'unknown' } }]
  for (let index = 0; index < cases.length; index++) {
    const f = await fixture(t, replacement)
    f.operations[0].resolve(cases[index])
    await f.settle()
    f.operations[1].resolve(cases[index])
    await f.settle()
    const view = { state: f.element.dataset.state, length: f.element.dataset.readingLength, title: f.element.attributes.title,
      text: Object.fromEntries(['.w-weather-place', '.w-weather-badge', '.w-weather-number', '.w-weather-unit',
        '.w-weather-condition', '.w-weather-detail', '#w-weather-high', '#w-weather-low'].map(selector => [selector, f.nodes.get(selector).textContent])),
      badgeHidden: f.nodes.get('.w-weather-badge').hidden, badgeClass: f.nodes.get('.w-weather-badge').className }
    if (replacement) assert.deepEqual(view, displayBaseline.get(index))
    else displayBaseline.set(index, view)
    assert.equal(f.operations[0].request.force, false)
    assert.equal(f.operations[1].request.force, true)
    for (let tick = 0; tick < 4; tick++) f.staleTicks[0]()
    assert.equal(f.operations.length, 2)
    f.staleTicks[0]()
    assert.equal(f.operations.length, 3)
    assert.equal(f.operations[2].request.force, false)
    f.operations[2].resolve(cases[index])
    await f.settle()
    await f.root.odkPlugins.stop()
  }
})

test(`${replacement ? 'independent' : 'default'} Weather active IPC rejection shows unavailable and remains refreshable`, async t => {
  const f = await fixture(t, replacement)
  f.operations[0].reject(Error('Cached request failed'))
  await f.settle()
  assert.equal(f.element.dataset.state, 'unavailable')
  assert.equal(f.nodes.get('.w-weather-badge').textContent, 'Unavailable')
  assert.equal(f.operations.length, 2)
  assert.equal(f.operations[1].request.force, true)
  f.operations[1].reject(Error('Forced request failed'))
  await f.settle()
  assert.equal(f.element.dataset.state, 'unavailable')
  assert.equal(f.element.attributes.title, 'Weather source: status channel unavailable')
  for (let tick = 0; tick < 5; tick++) f.staleTicks[0]()
  f.operations[2].resolve(live)
  await f.settle()
  assert.equal(f.element.dataset.state, 'live')
  assert.equal(f.element.attributes.title, '')
})
}
