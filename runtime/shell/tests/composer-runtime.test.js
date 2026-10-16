const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createPluginHost } = require('../src/plugin-host')

function element() {
  const node = { dataset: {}, style: {}, children: [], parentNode: null,
    setAttribute(name, value) { this[name] = value },
    removeAttribute(name) { delete this[name] },
    get classList() { return { remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' ') } } },
    append(child) { return this.insertBefore(child, null) },
    insertBefore(child, before) {
      child.remove()
      const index = before ? this.children.indexOf(before) : this.children.length
      this.children.splice(index, 0, child); child.parentNode = this; return child
    },
    remove() { if (this.parentNode) { const children = this.parentNode.children; children.splice(children.indexOf(this), 1); this.parentNode = null } },
    replaceChildren() { for (const child of [...this.children]) child.remove() },
    get firstChild() { return this.children[0] || null },
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null },
    querySelector(selector) { return selector === '.widget-grid' ? this.children.find(child => child.className?.includes('widget-grid')) : null },
    querySelectorAll() { return [] },
  }
  return node
}
function fixture(slots = {}) {
  const root = { odkPluginHost: { createPluginHost } }
  const context = vm.createContext({ window: root, structuredClone, document: { createElement: element, querySelector: selector => slots[selector] || null }, console: { error() {} } })
  for (const file of ['registry', 'grid-placement', 'composer']) vm.runInContext(fs.readFileSync(`src/renderer/core/${file}.js`, 'utf8'), context)
  return root
}
const layout = { pages: [
  { id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: 'odk.tile.one' }, { id: 'odk.tile.two' }] },
  { id: 'detail', name: 'Detail', kind: 'page', plugin: 'odk.page.detail' },
] }

test('reconcile inserts excluded placements without rebuilding existing or installed containers', async () => {
  const root = fixture()
  const mounts = []
  for (const [id, kind] of [['odk.tile.one', 'tile'], ['odk.tile.two', 'tile'], ['odk.page.detail', 'page']]) {
    root.odkPlugins.register({ id, kind, manifest: { schemaVersion: 1 }, mount() { mounts.push(id) } })
  }
  const disabled = new Set(['odk.tile.two', 'odk.page.detail'])
  await root.odkPlugins.start({ disabled: [...disabled] })
  const track = element()
  root.odkComposer.build(root.odkComposer.filterLayout(layout, disabled), track, {})
  const home = track.children[0]
  const one = home.children[0].children[0]
  const userTile = element(); userTile.dataset.userAppId = 'local-widget'; home.children[0].append(userTile)
  const userPage = element(); userPage.dataset.pageId = 'local-app'; track.append(userPage)
  await root.odkPlugins.setEnabled('odk.tile.two', true)
  await root.odkPlugins.setEnabled('odk.page.detail', true)
  await root.odkComposer.reconcile(layout, track, {})
  assert.equal(track.children[0], home)
  assert.equal(home.children[0].children[0], one)
  assert.deepEqual(home.children[0].children.map(child => child.dataset.widget || child.dataset.userAppId), ['odk.tile.one', 'odk.tile.two', 'local-widget'])
  assert.deepEqual(track.children.map(child => child.dataset.pageId), ['home', 'detail', 'local-app'])
  assert.equal(track.children[2], userPage)
  assert.equal(mounts.filter(id => id === 'odk.tile.one').length, 1)
  await root.odkComposer.reconcile(layout, track, {})
  assert.equal(mounts.length, 3)
  await root.odkPlugins.stop()
})

test('reconcile waits for successful release before removing an excluded placement', async () => {
  const root = fixture()
  let fail = true
  root.odkPlugins.register({ id: 'odk.tile.one', kind: 'tile', manifest: { schemaVersion: 1 }, mount(_el, ctx) {
    ctx.trackCleanup(() => { if (fail) throw Error('retained') })
  } })
  const declared = { pages: [{ id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: 'odk.tile.one' }] }] }
  await root.odkPlugins.start()
  const track = element()
  root.odkComposer.build(declared, track, {})
  const grid = track.children[0].children[0]
  const tile = grid.children[0]
  const disabled = new Set(['odk.tile.one'])
  await assert.rejects(root.odkComposer.reconcile(declared, track, {}, disabled), /surface release failed/)
  assert.equal(grid.children[0], tile)
  fail = false
  await root.odkComposer.reconcile(declared, track, {}, disabled)
  assert.equal(grid.children.length, 0)
  await root.odkPlugins.stop()
})


test('reconcile rejects changed page ownership and missing grid declarations before release', async () => {
  const root = fixture()
  let released = 0
  for (const [id, kind] of [['odk.tile.one', 'tile'], ['odk.tile.two', 'tile'], ['odk.page.detail', 'page'], ['odk.page.other', 'page']]) {
    root.odkPlugins.register({ id, kind, manifest: { schemaVersion: 1 }, mount(_el, ctx) { ctx.trackCleanup(() => { released++ }) } })
  }
  await root.odkPlugins.start()
  const track = element()
  root.odkComposer.build(layout, track, {})
  const home = track.children[0]
  const detail = track.children[1]
  for (const pages of [
    [layout.pages[1]],
    [layout.pages[0], { ...layout.pages[1], plugin: 'odk.page.other' }],
    [{ id: 'home', name: 'Home', kind: 'page', plugin: 'odk.page.other' }, layout.pages[1]],
  ]) {
    await assert.rejects(root.odkComposer.reconcile({ pages }, track, {}), /runtime reconciliation cannot change/)
    assert.equal(released, 0)
    assert.equal(track.children[0], home)
    assert.equal(track.children[1], detail)
  }
  await root.odkPlugins.stop()
})


test('reconcile remounts a retained node after failed exclusion cleanup recovers', async () => {
  const root = fixture()
  let fail = true
  let mounts = 0
  const def = { id: 'odk.tile.one', kind: 'tile', manifest: { schemaVersion: 1 }, mount(_el, ctx) {
    mounts++; ctx.trackCleanup(() => { if (fail) throw Error('retained') })
  } }
  root.odkPlugins.register(def)
  await root.odkPlugins.start()
  const declared = { pages: [{ id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: def.id }] }] }
  const track = element()
  root.odkComposer.build(declared, track, {})
  const tile = track.children[0].children[0].children[0]
  await assert.rejects(root.odkComposer.reconcile(declared, track, {}, new Set([def.id])), /surface release failed/)
  fail = false
  await root.odkPlugins.setEnabled(def.id, false)
  await root.odkPlugins.setEnabled(def.id, true)
  await root.odkComposer.reconcile(declared, track, {})
  assert.equal(track.children[0].children[0].children[0], tile)
  assert.equal(mounts, 2)
  await root.odkPlugins.stop()
})


function statusFixture() {
  const left = element()
  const right = element()
  return { root: fixture({ '[data-slot="status-left"]': left, '[data-slot="status-right"]': right }), left, right }
}

test('placement failure reporting follows affected consumers and excludes unavailable factories', async () => {
  const { root } = statusFixture()
  let fail = true
  for (const id of ['odk.status.provider', 'odk.status.independent']) {
    root.odkPlugins.register({ id, kind: 'status', slot: 'left', manifest: { schemaVersion: 1 }, mount() {} })
  }
  root.odkPlugins.register({ id: 'odk.status.consumer', kind: 'status', slot: 'right',
    manifest: { schemaVersion: 1, requires: [{ interface: 'odk:surface/odk.status.provider/v1' }] },
    mount() { if (fail) throw Error('mount failed') } })
  await root.odkPlugins.start()
  root.odkComposer.buildStatus({})
  assert.equal(root.odkPlugins.hasFailedPlacement('odk.status.provider'), true)
  assert.equal(root.odkPlugins.hasFailedPlacement('odk.status.independent'), false)
  await root.odkPlugins.setEnabled('odk.status.consumer', false)
  assert.equal(root.odkPlugins.hasFailedPlacement('odk.status.provider'), false)
  fail = false
  await root.odkPlugins.setEnabled('odk.status.consumer', true)
  assert.equal(root.odkPlugins.hasFailedPlacement('odk.status.provider'), false)
  await root.odkPlugins.stop()
})

test('status reconciliation clears only composer fallback markers after registry restoration', async () => {
  const { root, left } = statusFixture()
  let fail = true
  const def = { id: 'odk.status.flaky', kind: 'status', slot: 'left', manifest: { schemaVersion: 1 }, mount(el) {
    if (fail) throw Error('mount failed')
    el.textContent = 'Ready'
    el.className += ' plugin-ready'
  } }
  root.odkPlugins.register(def)
  await root.odkPlugins.start()
  root.odkComposer.buildStatus({})
  const host = left.children[0]
  assert.match(host.className, /status-plugin-error/)
  assert.equal(host.title, def.id)
  await root.odkPlugins.setEnabled(def.id, false)
  fail = false
  await root.odkPlugins.setEnabled(def.id, true)
  assert.equal(root.odkPlugins.isActive(root.odkPlugins.get(def.id), host), true)
  await root.odkComposer.reconcileStatus({})
  assert.equal(left.children[0], host)
  assert.equal(host.textContent, 'Ready')
  assert.doesNotMatch(host.className, /status-plugin-error/)
  assert.match(host.className, /plugin-ready/)
  assert.equal(host.title, undefined)
  host.title = 'Plugin reading'
  await root.odkComposer.reconcileStatus({})
  assert.equal(host.title, 'Plugin reading')
  await root.odkPlugins.stop()
})

test('status reconciliation creates excluded items and preserves unrelated content and order', async () => {
  const { root, left, right } = statusFixture()
  const mounts = []
  for (const [id, slot] of [['odk.status.one', 'left'], ['odk.status.two', 'left'], ['odk.status.right', 'right']]) {
    root.odkPlugins.register({ id, slot, kind: 'status', manifest: { schemaVersion: 1 }, mount() { mounts.push(id) } })
  }
  await root.odkPlugins.start({ disabled: ['odk.status.one'] })
  root.odkComposer.buildStatus({}, new Set(['odk.status.one']))
  const existing = left.children[0]
  const retainedRight = right.children[0]
  const unrelated = element(); right.append(unrelated)
  await root.odkPlugins.setEnabled('odk.status.one', true)
  await root.odkComposer.reconcileStatus({})
  assert.deepEqual(left.children.map(child => child.dataset.statusPlugin), ['odk.status.one', 'odk.status.two'])
  assert.equal(left.children[1], existing)
  assert.equal(right.children[0], retainedRight)
  assert.equal(right.children[1], unrelated)
  assert.equal(mounts.filter(id => id === 'odk.status.two').length, 1)
  await root.odkComposer.reconcileStatus({})
  assert.equal(mounts.length, 3)
  await root.odkPlugins.setEnabled('odk.status.one', false)
  await root.odkComposer.reconcileStatus({})
  assert.equal(left.children.length, 1)
  assert.equal(left.children[0], existing)
  await root.odkPlugins.stop()
})

test('status cleanup failure preserves the owned element and permits inclusion recovery', async () => {
  const { root, left } = statusFixture()
  let fail = true
  let mounts = 0
  const id = 'odk.status.retained'
  root.odkPlugins.register({ id, slot: 'left', kind: 'status', manifest: { schemaVersion: 1 }, mount(_el, ctx) {
    mounts++; ctx.trackCleanup(() => { if (fail) throw Error('retained') })
  } })
  await root.odkPlugins.start()
  root.odkComposer.buildStatus({})
  const host = left.children[0]
  await assert.rejects(root.odkComposer.reconcileStatus({}, new Set([id])), /surface release failed/)
  assert.equal(left.children[0], host)
  fail = false
  await root.odkComposer.reconcileStatus({})
  assert.equal(left.children[0], host)
  assert.equal(mounts, 2)
  await root.odkPlugins.stop()
})


test('the connection status releases its subscription before replacement', async () => {
  const root = fixture()
  vm.runInNewContext(fs.readFileSync('src/renderer/plugins/status-connection.js', 'utf8'), { window: root })
  await root.odkPlugins.start()
  const listeners = new Set()
  const indicator = { querySelector() { return {} } }
  const host = { querySelector() { return indicator }, replaceChildren() {} }
  const def = root.odkPlugins.get('odk.status.connection')
  root.odkPlugins.activate(def, host, { connection: {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    labelFor: () => 'Connected',
  } })
  assert.equal(listeners.size, 1)
  await root.odkPlugins.setEnabled(def.id, false)
  assert.equal(listeners.size, 0)
  await root.odkPlugins.setEnabled(def.id, true)
  assert.equal(listeners.size, 1)
  await root.odkPlugins.stop()
  assert.equal(listeners.size, 0)
})
