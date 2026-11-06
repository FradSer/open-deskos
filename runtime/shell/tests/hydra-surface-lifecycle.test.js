'use strict'

const nodeTest = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

const live = { configured: true, connected: true, mainOnline: true,
  env: { stale: false, tempC: 24, humidity: 60, pressureHpa: 1013, lux: 1200 },
  nodes: [{ id: 1, online: true, soilPercent: 62 }, { id: 2, online: true, soilPercent: 44, pump: true }] }

const baselines = new Map()
for (const independent of [false, true]) {
const test = (name, ...args) => nodeTest(`${independent ? 'independent' : 'default'} ${name}`, ...args)

async function fixture(t, failDisconnect = false) {
  function node() {
    const children = new Map()
    const classes = new Set()
    return { textContent: '', hidden: false, style: {}, dataset: {}, className: '', title: '',
      classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        toggle(value, on) { if (on) classes.add(value); else classes.delete(value) } }, classes,
      querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector) }, children }
  }
  const element = node()
  element.isConnected = true
  element.replaceChildren = () => {}
  let box = { width: 186, height: 400 }
  element.getBoundingClientRect = () => box
  const operations = []
  const ticks = new Set()
  const staleTicks = []
  const observers = []
  class Observer {
    constructor(callback) { this.callback = callback; this.calls = 0; observers.push(this) }
    observe(target) { assert.equal(target, element) }
    disconnect() { if (++this.calls === 1 && failDisconnect) throw Error('Controlled disconnect failure') }
  }
  const root = { odkPluginHost: { createPluginHost }, document: { querySelector: () => ({}),
    createElement: () => ({}), head: { appendChild() {} } },
    odkPlatform: { getHydraStatus() { return new Promise((resolve, reject) => operations.push({ resolve, reject })) } } }
  const context = vm.createContext({ window: root, structuredClone, document: root.document, console, AbortController, ResizeObserver: Observer })
  for (const file of ['core/registry.js', 'plugins/hydra.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  let selected
  if (independent) {
    root.odkRendererDevelopment = { define(definition) { selected = definition } }
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/hydra-surface-replacement/entry.js'), 'utf8'), context)
    root.odkPlugins.get('odk.tile.hydra').lifecycle.mount = () => { throw Error('Default Hydra mount refused') }
  }
  await root.odkPlugins.start({ replacements: selected ? [selected] : [] })
  const ui = { onTick(callback) { ticks.add(callback); staleTicks.push(callback); return () => ticks.delete(callback) } }
  const definition = root.odkPlugins.get('odk.tile.hydra')
  assert.equal(root.odkPlugins.activate(definition, element, ui), true)
  const settle = () => new Promise(setImmediate)
  const encode = node => ({ text: node.textContent, hidden: node.hidden, style: node.style, dataset: node.dataset,
    className: node.className, classes: [...node.classes].sort(), title: node.title,
    children: [...node.children].sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, encode(child)]) })
  t.after(async () => {
    await root.odkPlugins.stop()
    operations.forEach(operation => operation.resolve(live))
    await settle()
  })
  return { root, element, definition, ui, operations, ticks, staleTicks, observers, settle,
    resize(value) { box = value }, snapshot: () => JSON.stringify(encode(element)),
    read: selector => element.querySelector(selector) }
}

for (const outcome of ['resolve', 'reject']) {
  test(`released Hydra ${outcome} cannot change a remounted Widget`, async t => {
    const f = await fixture(t)
    const pending = f.operations[0]
    await f.root.odkPlugins.deactivate(f.definition, f.element)
    assert.equal(f.ticks.size, 0)
    assert.equal(f.observers.length, 1)
    assert.equal(f.root.odkPlugins.activate(f.definition, f.element, f.ui), true)
    f.operations[1].resolve(live)
    await f.settle()
    assert.equal(f.read('#hydra-badge').textContent, 'Live')
    const before = f.snapshot()
    if (outcome === 'resolve') pending.resolve({ configured: false })
    else pending.reject(Error('Released IPC rejected'))
    await f.settle()
    assert.equal(f.snapshot(), before)
    const calls = f.operations.length
    for (let index = 0; index < 10; index++) f.staleTicks[0]()
    assert.equal(f.operations.length, calls)
  })
}


test('released Hydra resize callbacks cannot change shape or labels', async t => {
  const f = await fixture(t)
  f.operations[0].resolve(live)
  await f.settle()
  await f.root.odkPlugins.deactivate(f.definition, f.element)
  const before = f.snapshot()
  f.resize({ width: 116, height: 120 })
  f.observers[0].callback()
  assert.equal(f.snapshot(), before)
  assert.equal(f.observers[0].calls, 1)
})

test('Hydra failed observer release remains retryable and blocks late callbacks', async t => {
  const f = await fixture(t, true)
  await assert.rejects(f.root.odkPlugins.deactivate(f.definition, f.element), /release failed/)
  assert.equal(f.ticks.size, 0)
  const before = f.snapshot()
  f.resize({ width: 116, height: 120 })
  f.observers[0].callback()
  f.operations[0].resolve(live)
  for (let index = 0; index < 10; index++) f.staleTicks[0]()
  await f.settle()
  assert.equal(f.snapshot(), before)
  assert.equal(f.operations.length, 1)
  await f.root.odkPlugins.deactivate(f.definition, f.element)
  assert.equal(f.observers[0].calls, 2)
})


test('Hydra uses the wide Desk composition and restores smaller shapes', async t => {
  const f = await fixture(t)
  f.operations[0].resolve(live)
  await f.settle()
  for (const [width, height, shape] of [[1103, 730, 'wide'], [1103, 357, 'wide-short'], [619, 196, 'wide-short'], [560, 186, 'wide-short'], [480, 300, 'wide'],
    [479, 300, 'compact'], [480, 299, 'compact'], [186, 400, 'tall'], [116, 120, 'plants'], [1103, 730, 'wide']]) {
    f.resize({ width, height })
    f.observers[0].callback()
    assert.equal(f.read('.hydra-body').dataset.shape, shape)
    assert.equal(f.read('.hydra-hint').hidden, shape !== 'plants')
    assert.equal(f.read('#hydra-plant-2').querySelector('.hydra-plant-state').textContent, 'Watering')
  }
})

test('Hydra preserves display states and cell shapes through the selected factory', async t => {
  const states = [null, { configured: false }, live, { ...live, connected: false }, { ...live, mainOnline: false },
    { ...live, env: { ...live.env, stale: true } }, { ...live, env: null, nodes: [] },
    { ...live, env: { ...live.env, tempC: -10.2, lux: 0.25, humidity: 0, pressureHpa: 1013.6 },
      nodes: [{ id: 2, online: false, soilPercent: 77, pump: true }, { id: 1, stale: true, soilPercent: 49.4, pump: true }] },
    { ...live, nodes: [{ id: 1, online: true, soilPercent: null }, { id: 2, online: true, soilPercent: 0 }] }]
  const sizes = [{ width: 619, height: 196 }, { width: 1103, height: 730 }, { width: 480, height: 300 }, { width: 186, height: 400 }, { width: 130, height: 180 },
    { width: 116, height: 120 }, { width: 100, height: 100 }]
  for (const [index, state] of states.entries()) {
    const f = await fixture(t)
    f.operations[0].resolve(state)
    await f.settle()
    const views = []
    for (const size of sizes) {
      f.resize(size)
      f.observers[0].callback()
      views.push(f.snapshot())
    }
    if (independent) assert.deepEqual(views, baselines.get(index))
    else baselines.set(index, views)
    const body = f.read('.hydra-body')
    assert.equal(body.dataset.shape, 'small')
    assert.equal(f.read('.hydra-hint').textContent, 'Too small')
    f.staleTicks[0]()
    assert.equal(f.operations.length, 2)
    f.operations[1].resolve(state)
    await f.settle()
    for (let tick = 0; tick < 4; tick++) f.staleTicks[0]()
    assert.equal(f.operations.length, 2)
    f.staleTicks[0]()
    assert.equal(f.operations.length, 3)
    f.operations[2].resolve(state)
    await f.settle()
  }
})

test('Hydra restores readings and full labels after state and shape transitions', async t => {
  const f = await fixture(t)
  const sequence = [live, { ...live, env: { ...live.env, stale: true }, nodes: [{ id: 1, soilPercent: 23, stale: true, pump: true }] },
    { ...live, mainOnline: false, nodes: [{ id: 2, online: false, soilPercent: 88, pump: true }] },
    { configured: false }, live]
  const views = []
  for (const [index, state] of sequence.entries()) {
    if (index > 0) {
      const requests = f.operations.length
      for (let tick = 0; tick < 5 && f.operations.length === requests; tick++) f.staleTicks[0]()
      assert.equal(f.operations.length, requests + 1)
    }
    f.operations.at(-1).resolve(state)
    await f.settle()
    for (const size of [{ width: 186, height: 400 }, { width: 116, height: 120 },
      { width: 100, height: 100 }, { width: 130, height: 180 }, { width: 186, height: 400 }]) {
      f.resize(size)
      f.observers[0].callback()
      views.push(f.snapshot())
    }
    assert.equal(f.read('.hydra-body').dataset.shape, 'tall')
    assert.equal(f.read('.hydra-hint').textContent, '')
    assert.equal(f.read('.hydra-hint').hidden, true)
    assert.equal(f.read('#hydra-plant-1').querySelector('.hydra-plant-name').textContent, 'Plant 1')
    assert.equal(f.read('#hydra-plant-2').querySelector('.hydra-plant-name').textContent, 'Plant 2')
  }
  assert.equal(f.read('#hydra-badge').textContent, 'Live')
  assert.equal(f.read('.hydra-body').classes.has('hydra-unconfigured'), false)
  assert.equal(f.read('.hydra-body').classes.has('hydra-stale'), false)
  assert.equal(f.read('#hydra-plant-2').querySelector('.hydra-plant-soil').textContent, '44%')
  // The running pump is stated in words, not only by the rail's colour.
  assert.equal(f.read('#hydra-plant-2').querySelector('.hydra-plant-state').textContent, 'Watering')
  assert.equal(f.read('#hydra-plant-1').querySelector('.hydra-plant-state').textContent, '')
  if (independent) assert.deepEqual(views, baselines.get('transitions'))
  else baselines.set('transitions', views)
})

test('Hydra fits a full moisture reading and clears its width state with new telemetry', async t => {
  const f = await fixture(t)
  const states = [
    { ...live, nodes: [{ id: 1, online: true, soilPercent: 100 }] },
    live,
    { ...live, nodes: [{ id: 1, online: true, soilPercent: 100, stale: true }] },
    { ...live, nodes: [{ id: 1, online: false, soilPercent: 100 }] },
    { configured: false },
  ]
  for (const [index, state] of states.entries()) {
    if (index > 0) {
      const requests = f.operations.length
      for (let tick = 0; tick < 5 && f.operations.length === requests; tick++) f.staleTicks[0]()
      assert.equal(f.operations.length, requests + 1)
    }
    f.operations.at(-1).resolve(state)
    await f.settle()
    const soil = f.read('#hydra-plant-1').querySelector('.hydra-plant-soil')
    assert.equal(soil.textContent, ['100%', '62%', '100%', '--', '--'][index])
    assert.equal(soil.classes.has('hydra-plant-soil-wide'), index === 0 || index === 2)
    if (index === 2) assert.equal(f.read('#hydra-plant-1').querySelector('.hydra-plant-state').textContent, 'Stale')
  }
})

test('Hydra active IPC rejection shows Waiting and remains refreshable', async t => {
  const f = await fixture(t)
  f.operations[0].reject(Error('Controlled IPC failure'))
  await f.settle()
  assert.equal(f.read('#hydra-badge').textContent, 'Waiting')
  f.staleTicks[0]()
  f.operations[1].resolve(live)
  await f.settle()
  assert.equal(f.read('#hydra-badge').textContent, 'Live')
})
}

nodeTest('independent Hydra shares only the static visual layout', () => {
  const layout = source => source.split('innerHTML = `')[1].split('`')[0]
  assert.equal(layout(fs.readFileSync(path.join(__dirname, 'fixtures/hydra-surface-replacement/entry.js'), 'utf8')),
    layout(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/hydra.js'), 'utf8')))
})

nodeTest('Desk declares the three-by-one Hydra card with the same App continuation', () => {
  const root = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), { window: root })
  const desk = root.DESKTOP_LAYOUT.pages.find(page => page.id === 'desk')
  assert.equal(desk.gridRows, 3)
  assert.equal(desk.widgets.length, 1)
  assert.equal(desk.widgets[0].id, 'odk.tile.hydra')
  assert.equal(desk.widgets[0].col, '1 / 4')
  assert.equal(desk.widgets[0].row, '1')
  assert.equal(desk.widgets[0].opensApp, 'hydra')
  assert.equal(root.DESKTOP_LAYOUT.pages.find(page => page.id === 'home').widgets.length, 6)
})
