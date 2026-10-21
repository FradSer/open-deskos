const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('recurring gates require sequential and shared-grid verification', () => {
  const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8')
  assert.match(source, /widget-sequential-refinement\.cjs/)
  assert.match(source, /sequential: sequential\.status/)
  assert.match(source, /runFixture\('home-preview\.cjs', \['--widget-grid'\]/)
  assert.match(source, /widgetGrid: widgetGrid\.status/)
  const scripts = require('../package.json').scripts
  assert.match(scripts.geometry, /electron tests\/home-preview\.cjs --widget-grid/)
})

test('Year progress preserves unchanged text and meter readings', () => {
  let plugin
  let tick
  let writes = 0
  let text = ''
  let width = ''
  const pct = {
    get textContent() { return text },
    set textContent(value) { writes += 1; text = value },
    classList: { toggle() {} },
  }
  const fill = { style: {
    get width() { return width },
    set width(value) { writes += 1; width = value },
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/year.js'), 'utf8'), {
    odkPlugins: { register(value) { plugin = value } },
  })
  plugin.mount({ querySelector: selector => selector === '.year-pct' ? pct : fill }, {
    onTick(callback) { tick = callback },
  })
  tick(new Date(2026, 0, 1, 0, 0, 1))
  tick(new Date(2026, 0, 1, 0, 0, 2))
  assert.equal(writes, 2)
  tick(new Date(2026, 11, 31, 23, 59, 59))
  assert.equal(text, '100%')
  tick(new Date(2027, 0, 1, 0, 0, 0))
  assert.equal(text, '0%')
  assert.equal(width, '0.00%')
})

test('Hydra clears live plant visuals after offline and missing snapshots', async () => {
  let plugin
  let tick
  let snapshot = { configured: true, connected: true, env: null, nodes: [{ id: 1, online: true, pump: true, soilPercent: 62 }] }
  const nodes = new Map()
  function node(key) {
    if (!nodes.has(key)) {
      const classes = new Set()
      nodes.set(key, { textContent: '', className: '', style: {}, classes, dataset: {},
        querySelector(selector) { return node(key + ' ' + selector) },
        classList: {
          add(value) { classes.add(value) },
          remove(value) { classes.delete(value) },
          toggle(value, enabled) { enabled ? classes.add(value) : classes.delete(value) },
        },
      })
    }
    return nodes.get(key)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/hydra.js'), 'utf8'), {
    odkPlugins: { register(value) { plugin = value } },
    odkPlatform: { async getHydraStatus() { return snapshot } },
  })
  // The tile composes from the cell it is drawn in, so the host it is mounted into
  // has to answer with one: a 186x400 cell is the handheld's tall slot.
  plugin.mount({ querySelector: node, getBoundingClientRect: () => ({ width: 186, height: 400 }) }, { onTick(callback) { tick = callback } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node('.hydra-body').dataset.shape, 'tall')
  assert.equal(node('#hydra-plant-1 .hydra-meter-fill').style.transform, 'scaleX(0.62)')
  snapshot.nodes[0].online = false
  tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node('#hydra-plant-1 .hydra-meter-fill').style.transform, 'scaleX(0)')
  assert.equal(node('#hydra-plant-1 .hydra-plant-soil').textContent, '--')
  assert.equal(node('#hydra-plant-1 .hydra-plant-state').textContent, 'Offline')
  assert.equal(node('#hydra-plant-1 .hydra-meter-fill').style.width, undefined)
  snapshot.nodes = []
  for (let i = 0; i < 5; i += 1) tick()
  await new Promise(resolve => setImmediate(resolve))
  // A plant with no reading carries no condition either: the row states neither a
  // reading nor a state it was never told.
  assert.equal(node('#hydra-plant-1 .hydra-plant-state').textContent, '')
})

test('Built-in views explains empty search and catalog states', async () => {
  const plugins = []
  const nodes = new Map()
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', textContent: '', innerHTML: '', addEventListener(event, handler) { this[event] = handler } })
    return nodes.get(selector)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/apps.js'), 'utf8'), {
    odkPlugins: { register(value) { plugins.push(value) } },
  })
  const plugin = plugins.find(value => value.appId === 'app-manager')
  let items = [{ name: 'Clock', appId: 'year', kind: 'ui', version: 'builtin', source: 'builtin', state: 'installed' }]
  const mount = () => plugin.lifecycle.mount({ querySelector: node }, { platform: {
    async listApps() { return items }, subscribeAppState() {},
  } })
  mount()
  await new Promise(resolve => setImmediate(resolve))
  node('.app-search').value = 'missing'
  node('.app-search').input()
  assert.equal(node('.app-manager-status').textContent, 'No matching built-in views. Clear search to see all views.')
  node('.app-search').value = ''
  node('.app-search').input()
  assert.equal(node('.app-manager-status').textContent, '')
  assert.match(node('.app-list').innerHTML, /Clock/)
  items = []
  mount()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node('.app-manager-status').textContent, 'No built-in views available.')
})


for (const phase of ['pending', 'failure']) test(`Catalog search preserves ${phase} state until reload recovery`, async () => {
  const plugins = []
  const nodes = new Map()
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', textContent: '', innerHTML: '', hidden: false,
      replaceChildren() { this.innerHTML = '' },
      addEventListener(event, handler) { this[event] = handler },
    })
    return nodes.get(selector)
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/apps.js'), 'utf8'), {
    odkPlugins: { register(value) { plugins.push(value) } },
  })
  let reject
  let request = new Promise((resolve, fail) => { reject = fail })
  plugins.find(value => value.appId === 'app-manager').lifecycle.mount({ querySelector: node }, { platform: {
    listApps() { return request }, subscribeAppState() {},
  } })
  const search = node('.app-search')
  const status = node('.app-manager-status')
  search.value = 'clock'
  search.input()
  if (phase === 'pending') assert.equal(status.textContent, 'Loading built-in views.')
  reject(new Error('Catalog unavailable'))
  await new Promise(resolve => setImmediate(resolve))
  search.value = 'year'
  search.input()
  assert.equal(status.textContent, 'Unable to load built-in views: Catalog unavailable')
  assert.equal(node('.app-manager-retry').hidden, false)
  request = Promise.resolve([{ name: 'Year progress', appId: 'year' }])
  await node('.app-manager-retry').click()
  assert.equal(status.textContent, '')
  assert.equal(node('.app-manager-retry').hidden, true)
  assert.match(node('.app-list').innerHTML, /Year progress/)
})


function mountLocalApp(id) {
  const plugins = []
  const nodes = new Map()
  let tick
  const el = { innerHTML: '', querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', dateTime: '' })
    return nodes.get(selector)
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/apps.js'), 'utf8'), {
    odkPlugins: { register(value) { plugins.push(value) } },
  })
  plugins.find(value => value.appId === id).lifecycle.mount(el, { onTick(callback) { tick = callback } })
  return { el, nodes, tick: now => tick(now) }
}

test('Year App calculates local year progress and resets at new year', () => {
  const view = mountLocalApp('year')
  view.tick(new Date(2026, 11, 31, 23, 59, 59))
  assert.equal(view.nodes.get('.runtime-value').textContent, '100%')
  view.tick(new Date(2027, 0, 1))
  assert.equal(view.nodes.get('.runtime-value').textContent, '0%')
  assert.equal(view.nodes.get('.runtime-state').textContent, 'of 2027 elapsed · Local time')
  assert.doesNotMatch(view.el.innerHTML, /aria-live|role="status"/)
})

test('Year details count leap-year calendar days and reset with the year', () => {
  const view = mountLocalApp('year')
  view.tick(new Date(2024, 1, 29))
  assert.equal(view.nodes.get('.year-days-completed').textContent, '59')
  assert.equal(view.nodes.get('.year-days-left').textContent, '307')
  assert.ok(view.nodes.get('.year-meter').value > 16)
  view.tick(new Date(2025, 0, 1))
  assert.equal(view.nodes.get('.year-days-completed').textContent, '0')
  assert.equal(view.nodes.get('.year-days-left').textContent, '365')
  assert.equal(view.nodes.get('.year-meter').value, 0)
})
