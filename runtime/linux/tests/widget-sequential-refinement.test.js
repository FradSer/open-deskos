const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('recurring e2e gate requires sequential verification', () => {
  const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8')
  assert.match(source, /widget-sequential-refinement\.cjs/)
  assert.match(source, /sequential: sequential\.status/)
})

test('Clock keeps minute readings stable and exposes semantic local time', () => {
  let plugin
  let tick
  let writes = 0
  let reading = ''
  const time = {
    dateTime: '',
    get textContent() { return reading },
    set textContent(value) { writes += 1; reading = value },
  }
  const el = { innerHTML: '', querySelector: () => time }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/clock.js'), 'utf8'), {
    odkPlugins: { register(value) { plugin = value } },
  })
  plugin.mount(el, { onTick(callback) { tick = callback } })
  tick(new Date(2026, 0, 1, 23, 59, 1))
  tick(new Date(2026, 0, 1, 23, 59, 59))
  assert.equal(writes, 1, 'same-minute ticks must not replace the reading')
  assert.match(el.innerHTML, /<time class="w-clock-time"/)
  assert.doesNotMatch(el.innerHTML, /aria-live|role="status"/)
  assert.equal(time.dateTime, '23:59')
  tick(new Date(2026, 0, 2, 0, 0, 0))
  assert.equal(reading, '00:00')
  assert.equal(time.dateTime, '00:00')
  assert.equal(writes, 2)
})

test('Calendar updates only when the local calendar date changes', () => {
  let plugin
  let tick
  let writes = 0
  const nodes = new Map()
  const el = { querySelector(selector) {
    if (!nodes.has(selector)) {
      let text = ''
      nodes.set(selector, {
        get textContent() { return text },
        set textContent(value) { writes += 1; text = value },
        classList: { toggle() {} },
      })
    }
    return nodes.get(selector)
  } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/almanac.js'), 'utf8'), {
    odkPlugins: { register(value) { plugin = value } },
  })
  plugin.mount(el, { onTick(callback) { tick = callback } })
  tick(new Date(2026, 0, 31, 23, 59, 1))
  tick(new Date(2026, 0, 31, 23, 59, 59))
  assert.equal(writes, 3, 'same-date ticks must preserve all reading nodes')
  tick(new Date(2026, 1, 1, 0, 0, 0))
  assert.equal(writes, 6)
  assert.equal(nodes.get('.al-day').textContent, 1)
  assert.equal(nodes.get('.al-month').textContent, 'Feb')
  assert.equal(nodes.get('.al-weekday').textContent, 'Sun')
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
      nodes.set(key, { textContent: '', className: '', style: {}, classes,
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
  plugin.mount({ querySelector: node }, { onTick(callback) { tick = callback } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node('#hydra-plant-1 .hydra-meter-fill').style.width, '62%')
  snapshot.nodes[0].online = false
  tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node('#hydra-plant-1 .hydra-meter-fill').style.width, '0%')
  assert.equal(node('#hydra-plant-1 .hydra-plant-soil').textContent, '--')
  snapshot.nodes = []
  for (let i = 0; i < 5; i += 1) tick()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node('#hydra-plant-1 .hydra-plant-soil').classes.has('hydra-soil-watering'), false)
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
  let items = [{ name: 'Clock', appId: 'clock', kind: 'ui', version: 'builtin', source: 'builtin', state: 'installed' }]
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


test('Pomodoro mount offers no unsupported timer operation', () => {
  const plugins = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/apps.js'), 'utf8'), {
    odkPlugins: { register(value) { plugins.push(value) } },
  })
  const plugin = plugins.find(value => value.appId === 'pomodoro')
  const el = { innerHTML: '', querySelector() { return { addEventListener() {} } } }
  plugin.lifecycle.mount(el, {})
  assert.match(el.innerHTML, /Timer unavailable/)
  assert.doesNotMatch(el.innerHTML, /<button|Running|Start timer/)
  assert.equal(plugin.handleAction, null)
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

test('Calendar App displays the local date through month rollover without events', () => {
  const view = mountLocalApp('calendar')
  view.tick(new Date(2026, 0, 31, 23, 59))
  assert.equal(view.nodes.get('.runtime-date').dateTime, '2026-01-31')
  view.tick(new Date(2026, 1, 1))
  assert.equal(view.nodes.get('.runtime-date').dateTime, '2026-02-01')
  assert.match(view.nodes.get('.runtime-date').textContent, /February 1, 2026/)
  assert.match(view.el.innerHTML, /Calendar events unavailable/)
})


test('Clock App keeps minute text stable and reports semantic midnight', () => {
  const view = mountLocalApp('clock')
  const value = view.nodes.get('.runtime-value')
  let writes = 0
  let reading = ''
  Object.defineProperty(value, 'textContent', {
    get() { return reading }, set(text) { reading = text; writes += 1 },
  })
  view.tick(new Date(2026, 0, 1, 23, 59, 1))
  view.tick(new Date(2026, 0, 1, 23, 59, 59))
  assert.equal(writes, 1)
  view.tick(new Date(2026, 0, 2))
  assert.equal(value.dateTime, '00:00')
  assert.equal(reading, '00:00')
  assert.match(view.el.innerHTML, /<time class="runtime-value"/)
  assert.doesNotMatch(view.el.innerHTML, /aria-live|role="status"/)
})


test('Year App calculates local year progress and resets at new year', () => {
  const view = mountLocalApp('year')
  view.tick(new Date(2026, 11, 31, 23, 59, 59))
  assert.equal(view.nodes.get('.runtime-value').textContent, '100%')
  view.tick(new Date(2027, 0, 1))
  assert.equal(view.nodes.get('.runtime-value').textContent, '0%')
  assert.equal(view.nodes.get('.runtime-state').textContent, 'of 2027 elapsed · Local time')
  assert.doesNotMatch(view.el.innerHTML, /aria-live|role="status"/)
})
