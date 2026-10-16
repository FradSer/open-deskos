const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const renderer = path.join(__dirname, '../src/renderer/plugins')

// The Tile stays a display-only instrument and owns no session, so only the
// built-in view module loads. Time is a controlled clock, the way the other
// harnesses in this repository control it.
function clock(start = Date.parse('2026-01-01T00:00:00Z')) {
  let now = start
  const ControlledDate = class extends Date {
    static now() { return now }
  }
  ControlledDate.now = () => now
  return { ControlledDate, advance: (ms) => { now += ms } }
}

function setup(implementation = 'default') {
  const plugins = new Map()
  const time = clock()
  const sandbox = {
    Date: time.ControlledDate,
    console: { error() {} },
    odkPlugins: {
      register(plugin) {
        plugins.set(plugin.id, plugin)
      },
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  const file = implementation === 'default' ? path.join(renderer, 'apps.js') : path.join(__dirname, 'fixtures/builtin-view-replacements.js')
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox)
  for (const plugin of sandbox.odkBuiltinViewReplacements || []) plugins.set(plugin.id, plugin)
  vm.runInContext(fs.readFileSync(path.join(renderer, 'pomodoro.js'), 'utf8'), sandbox)
  time.plugins = plugins
  return time
}

function element() {
  const classes = new Set()
  const listeners = new Map()
  return {
    textContent: '',
    hidden: false,
    dataset: {},
    children: [],
    ownerDocument: { createElement: () => element() },
    append(...children) { this.children.push(...children) },
    querySelector(selector) {
      for (const child of this.children) {
        if (selector === `#${child.id}`) return child
        const match = child.querySelector(selector)
        if (match) return match
      }
      return null
    },
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
      toggle: (value, force) => (force ? classes.add(value) : classes.delete(value)),
    },
    addEventListener(type, handler) { listeners.set(type, handler) },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type) },
    click() { listeners.get('click')?.() },
  }
}

function mountApp(existing, implementation = 'default') {
  const time = existing ?? setup(implementation)
  const app = time.plugins.get('odk.app.pomodoro')
  assert.ok(app, 'odk.app.pomodoro must be registered')
  const nodes = new Map()
  const container = {
    ...element(),
    innerHTML: '',
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element().querySelector.call(this, selector) || element())
      return nodes.get(selector)
    },
  }
  const cleanups = []
  let tick
  const mount = app.lifecycle?.mount || app.mount
  mount(container, {
    trackCleanup(callback) { cleanups.push(callback) },
    onTick(callback) { tick = callback },
  })
  return {
    app, container, cleanups, tile: time.plugins.get('odk.tile.pomodoro'), advance: time.advance, tick: () => tick(),
    dial: container.querySelector('#pomodoro-dial'),
    state: container.querySelector('#pomodoro-state'),
    toggle: container.querySelector('#pomodoro-toggle'),
    reset: container.querySelector('#pomodoro-reset'),
    reopen: () => mountApp(time),
  }
}

for (const implementation of ['default', 'independent']) {
const mount = () => mountApp(undefined, implementation)
const scenario = (name, run) => test(`${implementation}: ${name}`, run)

scenario('the Pomodoro App starts, pauses, resumes, and resets one session', () => {
  const app = mount()

  assert.ok(app.dial)
  assert.equal(app.dial.textContent, '25:00')
  assert.equal(app.state.textContent, 'Focus')
  assert.equal(app.toggle.textContent, 'Start')
  assert.equal(app.reset.hidden, true)

  app.toggle.click()
  assert.equal(app.state.textContent, 'Focusing')
  assert.equal(app.toggle.textContent, 'Pause')
  assert.equal(app.reset.hidden, false)
  assert.equal(app.dial.classList.contains('is-running'), true)

  app.toggle.click()
  assert.equal(app.state.textContent, 'Paused')
  assert.equal(app.toggle.textContent, 'Resume')
  assert.equal(app.reset.hidden, false)
  assert.equal(app.dial.classList.contains('is-running'), false)

  app.toggle.click()
  assert.equal(app.state.textContent, 'Focusing')
  assert.equal(app.toggle.textContent, 'Pause')

  app.reset.click()
  assert.equal(app.dial.textContent, '25:00')
  assert.equal(app.state.textContent, 'Focus')
  assert.equal(app.toggle.textContent, 'Start')
  assert.equal(app.reset.hidden, true)
})

scenario('the shared Tick counts a running session down and completes it at zero', () => {
  const app = mount()
  app.toggle.click()
  assert.equal(app.dial.textContent, '25:00')

  app.advance(2000)
  app.tick()
  assert.equal(app.dial.textContent, '24:58')
  assert.equal(app.state.textContent, 'Focusing')

  app.advance(1498 * 1000)
  app.tick()
  assert.equal(app.dial.textContent, '00:00')
  assert.equal(app.state.textContent, 'Completed')
  assert.equal(app.toggle.textContent, 'Start')
  assert.equal(app.reset.hidden, false)
})

scenario('a paused session keeps its remaining time while time passes', () => {
  const app = mount()
  app.toggle.click()
  app.advance(60 * 1000)
  app.tick()
  assert.equal(app.dial.textContent, '24:00')

  app.toggle.click()
  app.advance(10 * 60 * 1000)
  app.tick()
  assert.equal(app.dial.textContent, '24:00')
  assert.equal(app.state.textContent, 'Paused')

  app.toggle.click()
  assert.equal(app.state.textContent, 'Focusing')
  app.advance(1000)
  app.tick()
  assert.equal(app.dial.textContent, '23:59')
})

scenario('a session keeps its remaining time after the App is closed and reopened', () => {
  const first = mount()
  first.toggle.click()
  first.advance(300 * 1000)
  first.tick()
  assert.equal(first.dial.textContent, '20:00')

  for (const cleanup of first.cleanups.splice(0)) cleanup()

  const reopened = first.reopen()
  assert.equal(reopened.dial.textContent, '20:00')
  assert.equal(reopened.state.textContent, 'Focusing')
  assert.equal(reopened.toggle.textContent, 'Pause')
})

scenario('a session that ended while the App was closed reads as completed', () => {
  const first = mount()
  first.toggle.click()
  first.advance(30 * 60 * 1000)
  for (const cleanup of first.cleanups.splice(0)) cleanup()

  const reopened = first.reopen()
  assert.equal(reopened.dial.textContent, '00:00')
  assert.equal(reopened.state.textContent, 'Completed')
  assert.equal(reopened.toggle.textContent, 'Start')
  assert.equal(reopened.reset.hidden, false)
})

scenario('closing the App releases its view, its Tick, and its listeners', () => {
  const app = mount()
  for (const cleanup of app.cleanups.splice(0)) cleanup()

  // The released view can no longer be written by the shared session state.
  app.app.handleAction({ action: 'start' })
  assert.equal(app.state.textContent, 'Focus')
  assert.equal(app.toggle.textContent, 'Start')
})

scenario('App actions drive the same session the controls do', () => {
  const app = mount()
  assert.equal(typeof app.app.handleAction, 'function')

  app.app.handleAction({ action: 'resume' })
  assert.equal(app.state.textContent, 'Focusing')
  assert.equal(app.toggle.textContent, 'Pause')

  app.app.handleAction({ action: 'pause' })
  assert.equal(app.state.textContent, 'Paused')
  assert.equal(app.toggle.textContent, 'Resume')

  app.app.handleAction({ action: 'start' })
  assert.equal(app.state.textContent, 'Focusing')

  app.app.handleAction({ action: 'stop' })
  assert.equal(app.dial.textContent, '25:00')
  assert.equal(app.state.textContent, 'Focus')
  assert.equal(app.reset.hidden, true)
})

scenario('repeating Start retains the original deadline', () => {
  const app = mount()
  app.app.handleAction({ action: 'start' })
  app.advance(100)
  app.app.handleAction({ action: 'start' })
  app.advance(1499900)
  app.tick()
  assert.equal(app.state.textContent, 'Completed')
  assert.equal(app.dial.textContent, '00:00')
})

scenario('Start after an unobserved completion begins a new session', () => {
  const app = mount()
  app.toggle.click()
  app.advance(26 * 60 * 1000)
  app.toggle.click()
  assert.equal(app.state.textContent, 'Focusing')
  assert.equal(app.dial.textContent, '25:00')
  assert.equal(app.toggle.textContent, 'Pause')
})

scenario('unsupported actions leave the session unchanged', () => {
  const app = mount()
  assert.equal(app.app.handleAction({ action: 'unknown' }), false)
  assert.equal(app.state.textContent, 'Focus')
  assert.equal(app.dial.textContent, '25:00')
})

scenario('the resting Home Widget makes no stale session-state claim', () => {
  const app = mount()
  app.toggle.click()
  const el = { innerHTML: '' }
  app.tile.mount(el)
  assert.equal(app.tile.state, 'App timer')
  assert.match(el.innerHTML, /pomodoro-context">Focus/)
  assert.doesNotMatch(el.innerHTML, /Not started/)
})
}
