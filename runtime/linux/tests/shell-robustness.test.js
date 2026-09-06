const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer')

function loadSource(relative, root) {
  const source = fs.readFileSync(path.join(RENDERER_DIR, relative), 'utf8')
  vm.runInContext(source, vm.createContext({ window: root, globalThis: root, console: { error() {} } }))
}

function createShellRoot() {
  const root = {}
  loadSource('core/registry.js', root)
  return root
}

test('a throwing mount is contained: activate returns false and cleans the element', () => {
  const root = createShellRoot()
  const cleanups = []
  const ctx = { onTick: (cb) => { cleanups.push(() => {}); return () => {} } }
  const el = { children: [], replaceChildren() { this.children = [] } }
  const def = {
    id: 'odk.tile.broken',
    kind: 'tile',
    manifest: { schemaVersion: 1 },
    mount(element, scoped) {
      element.children.push('partial')
      scoped.onTick(() => {})
      throw new Error('boom')
    },
  }
  root.odkPlugins.register(def)
  assert.equal(root.odkPlugins.activate(def, el, ctx), false)
  assert.deepEqual(el.children, [], 'partial markup is cleared after a failed mount')
  assert.equal(root.odkPlugins.has('odk.tile.broken'), true)
})

test('a throwing unmount does not break teardown and still runs cleanups', () => {
  const root = createShellRoot()
  const cleaned = []
  const el = {}
  const def = {
    id: 'odk.tile.breaking-unmount',
    kind: 'tile',
    manifest: { schemaVersion: 1 },
    mount(element, scoped) {
      scoped.trackCleanup(() => cleaned.push('cleanup'))
    },
    unmount() {
      throw new Error('unmount boom')
    },
  }
  root.odkPlugins.register(def)
  assert.equal(root.odkPlugins.activate(def, el, {}), true)
  assert.doesNotThrow(() => root.odkPlugins.deactivate(def, el, {}))
  assert.deepEqual(cleaned, ['cleanup'])
})

test('one widget throwing in the shared tick does not starve the others', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const root = {}
  vm.runInContext(
    fs.readFileSync(path.join(RENDERER_DIR, 'core/services.js'), 'utf8'),
    vm.createContext({
      window: root,
      globalThis: root,
      console: { error() {} },
      navigator: { onLine: true },
      setInterval,
    }),
  )
  const seen = []
  const unsubscribe = root.odkServices.onTick(() => seen.push('healthy'))
  root.odkServices.onTick(() => {
    throw new Error('broken widget tick')
  })
  t.mock.timers.tick(1000)
  assert.equal(seen.length, 2, 'healthy subscriber received the tick after a throwing one')
  t.mock.timers.tick(1000)
  assert.equal(seen.length, 3, 'tick continues every second')
  unsubscribe()
})

test('filterLayout removes only the disabled plugins from the declared layout', () => {
  const root = createShellRoot()
  const tile = { id: 'odk.tile.a', kind: 'tile', manifest: { schemaVersion: 1 }, mount() {} }
  const brokenTile = { id: 'odk.tile.b', kind: 'tile', manifest: { schemaVersion: 1 }, mount() {} }
  const page = { id: 'odk.page.a', kind: 'page', manifest: { schemaVersion: 1 }, surface: 'app', mount() {} }
  for (const def of [tile, brokenTile, page]) root.odkPlugins.register(def)
  vm.runInContext(
    fs.readFileSync(path.join(RENDERER_DIR, 'core/composer.js'), 'utf8'),
    vm.createContext({ window: root, globalThis: root }),
  )
  const layout = {
    pages: [
      { id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [
        { id: 'odk.tile.a', col: '1', row: '1' },
        { id: 'odk.tile.b', col: '2', row: '1' },
      ] },
      { id: 'extra', name: 'Extra', kind: 'page', surface: 'app', plugin: 'odk.page.a' },
    ],
  }

  const filtered = root.odkComposer.filterLayout(layout, new Set(['odk.tile.b', 'odk.page.a', 'odk.tile.unknown']))
  assert.deepEqual(filtered.pages[0].widgets.map((widget) => widget.id), ['odk.tile.a'])
  assert.equal(filtered.pages.length, 1, 'disabled page plugin removes its page')
  assert.deepEqual(layout.pages[0].widgets.map((widget) => widget.id), ['odk.tile.a', 'odk.tile.b'], 'declared layout stays untouched')
  assert.equal(root.odkComposer.validate(filtered), true)
  assert.equal(root.odkComposer.filterLayout(layout, new Set()), layout, 'empty exclusion list keeps the declared layout')
})

function fakeElement(tag) {
  return {
    tagName: tag,
    children: [],
    dataset: {},
    style: {},
    className: '',
    append(child) { this.children.push(child) },
    setAttribute() {},
  }
}

function fakeTrack() {
  const track = fakeElement('div')
  track.replaceChildren = () => { track.children = [] }
  return track
}

test('composer build contains a broken tile and still builds every other widget', () => {
  const root = createShellRoot()
  const good = { id: 'odk.tile.good', kind: 'tile', manifest: { schemaVersion: 1 }, app: 'Good', state: 'Ready', mount() {} }
  const bad = { id: 'odk.tile.bad', kind: 'tile', manifest: { schemaVersion: 1 }, app: 'Bad', state: 'Pending', mount() { throw new Error('boom') } }
  root.odkPlugins.register(good)
  root.odkPlugins.register(bad)
  vm.runInContext(
    fs.readFileSync(path.join(RENDERER_DIR, 'core/composer.js'), 'utf8'),
    vm.createContext({ window: root, globalThis: root, document: { createElement: fakeElement } }),
  )
  const track = fakeTrack()
  root.odkComposer.build({
    pages: [
      { id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [
        { id: 'odk.tile.bad', col: '1', row: '1' },
        { id: 'odk.tile.good', col: '2', row: '1' },
      ] },
    ],
  }, track, { onTick: () => () => {} })

  const section = track.children[0]
  const grid = section.children[0]
  assert.equal(grid.children.length, 2, 'both tiles are built')
  const broken = grid.children[0]
  assert.equal(broken.dataset.state, 'Error')
  assert.equal(broken.children[0].className, 'widget-error')
  assert.equal(broken.children[0].textContent, 'Widget error')
  const healthy = grid.children[1]
  assert.equal(healthy.dataset.state, 'Ready')
  assert.equal(healthy.children.length, 0)
})

test('resolveDisabledPlugins parses the launch parameter list', () => {
  const main = require(path.join(__dirname, '..', 'src', 'main.js'))
  assert.deepEqual(
    main.resolveDisabledPlugins({ ODESK_DISABLED_PLUGINS: 'odk.tile.hydra, odk.status.clock\nodk.page.quota' }),
    ['odk.tile.hydra', 'odk.status.clock', 'odk.page.quota'],
  )
  assert.deepEqual(main.resolveDisabledPlugins({}), [])
  assert.deepEqual(main.resolveDisabledPlugins({ ODESK_DISABLED_PLUGINS: '  ' }), [])
})
