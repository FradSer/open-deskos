const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

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

test('Face presence distinguishes observation states from offline service', () => {
  let plugin
  let update
  const el = { innerHTML: '' }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/face-presence.js'), 'utf8'), {
    odkPlugins: { register(value) { plugin = value } },
  })
  plugin.mount(el, { faceAgent: { subscribe(callback) { update = callback } } })
  for (const [state, reading] of [['no-face', 'No face'], ['unknown-face', 'Unknown'], ['starting', 'Starting'], ['no-frame', 'No frame'], ['camera-unavailable', 'Offline'], ['unavailable', 'Offline']]) {
    update({ state, unlocked: false, facesCount: 0 })
    assert.ok(el.innerHTML.includes(`<span class="w-vision-value">${reading}</span>`), state)
  }
  update({ state: 'online', unlocked: true, facesCount: 1 })
  assert.match(el.innerHTML, /w-vision-value">1<\/span>/)
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
