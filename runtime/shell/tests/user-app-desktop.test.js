const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attributes = {}; this.textContent = '' }
  append(...nodes) { nodes.forEach(node => { node.parentNode = this; this.children.push(node) }) }
  appendChild(node) { this.append(node) }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this) }
  setAttribute(key, value) { this.attributes[key] = value }
  querySelector(selector) { return this.children.find(node => selector === '.widget-grid' && node.className === 'widget-grid') }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const widget = (revision = 'r1', pageId = 'reading') => ({ id: 'note', name: '<Note>', kind: 'widget', revision, placement: { pageId, col: '4 / 6', row: '3' } })
function setup(list) {
  const track = new Element('main'); const status = new Element('p'); const mounted = []; const disposed = []
  const layout = { pages: ['home', 'reading'].map(id => ({ id, kind: 'grid', name: id, widgets: [] })) }
  for (const page of layout.pages) { const section = new Element('section'); section.dataset.pageId = page.id; const grid = new Element('div'); grid.className = 'widget-grid'; const builtin = new Element('div'); builtin.dataset.widget = 'builtin'; grid.append(builtin); section.append(grid); track.append(section) }
  let changed; let pageChanges = 0
  const root = { document: { createElement: tag => new Element(tag) }, odkUserApps: { list, subscribe(callback) { changed = callback; return () => { changed = null } } }, odkUserAppFrame: { mount(host, options) { mounted.push(options); const frame = new Element('iframe'); host.append(frame); return { frame, ready: Promise.resolve(), dispose() { disposed.push(options); frame.remove() } } } } }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/user-app-desktop.js', 'utf8'), root)
  const controller = root.odkUserAppDesktop.mount({ track, layout, status, onPagesChanged() { pageChanges++ } })
  return { root, track, status, mounted, disposed, controller, change: () => changed(), pageChanges: () => pageChanges }
}
test('mounts placed widgets without touching built-ins and reconciles only changed frames', async () => {
  let apps = [widget()]; const env = setup(async () => ({ ok: true, apps })); const builtin = env.track.children[0].children[0].children[0]
  await tick(); const tile = env.track.children[1].children[0].children[1]
  assert.equal(tile.style.gridColumn, '4 / 6'); assert.equal(tile.style.gridRow, '3'); assert.equal(tile.children[1].attributes.tabindex, '-1'); assert.equal(tile.children[1].inert, true)
  env.change(); await tick(); assert.equal(env.mounted.length, 1)
  apps = [widget('r2', 'home')]; env.change(); await tick(); assert.equal(env.disposed.length, 1); assert.equal(env.mounted.length, 2)
  assert.equal(env.track.children[0].children[0].children[0], builtin)
  apps = []; env.change(); await tick(); assert.equal(env.disposed.length, 2)
  env.controller.dispose()
})
test('a widget whose cell was taken by a built-in tile is not mounted', async () => {
  const conflicted = { ...widget(), placementError: 'occupied-placement' }
  const env = setup(async () => ({ ok: true, apps: [conflicted, widget('r2', 'reading')] }))
  await tick()
  assert.equal(env.mounted.length, 1, 'only the widget with a free cell mounts')
  assert.equal(env.mounted[0].revision, 'r2')
  assert.match(env.status.textContent, /its desktop cell is now a built-in tile/)
  assert.match(env.status.textContent, /move or remove the widget/)
  assert.match(env.status.textContent, /<Note>/)
  assert.equal(env.status.dataset.state, 'placement-error')
  env.controller.dispose()
})

test('a full desktop and a taken cell are named differently', async () => {
  const full = setup(async () => ({ ok: true, apps: [{ ...widget(), placementError: 'desktop-full' }] }))
  await tick()
  assert.match(full.status.textContent, /there is no free desktop cell/)
  full.controller.dispose()
  const generic = setup(async () => ({ ok: true, apps: [{ ...widget(), placementError: 'unavailable-page' }] }))
  await tick()
  assert.match(generic.status.textContent, /desktop placement unavailable/)
  generic.controller.dispose()
})

test('newer catalog wins and failure preserves existing frames with truthful stale status', async () => {
  const pending = []; const env = setup(() => new Promise(resolve => pending.push(resolve)))
  env.change(); pending[1]({ ok: true, apps: [widget('new')] }); await tick(); pending[0]({ ok: true, apps: [widget('old')] }); await tick()
  assert.equal(env.mounted.length, 1); assert.equal(env.mounted[0].revision, 'new')
  env.change(); pending[2]({ ok: false, error: 'offline' }); await tick(); assert.match(env.status.textContent, /unavailable.*stale/i); assert.equal(env.disposed.length, 0)
  env.controller.dispose()
})
test('interactive apps own named pages and survive unrelated catalog updates', async () => {
  let apps = [{ id: 'app', name: 'Calculator', kind: 'app', revision: 'r' }]; const env = setup(async () => ({ ok: true, apps })); await tick()
  const page = env.track.children[2]; assert.equal(page.dataset.surface, 'app'); assert.equal(page.attributes['aria-label'], 'Calculator')
  apps = [...apps, widget()]; env.change(); await tick(); assert.equal(env.track.children[2], page); assert.equal(env.disposed.length, 0)
  env.controller.dispose(); assert.equal(env.disposed.length, 2)
})
test('contains frame failure and presents metadata as text', async () => {
  const env = setup(async () => ({ ok: true, apps: [widget()] })); env.root.odkUserAppFrame.mount = () => { throw new Error('missing protocol') }; await tick()
  const tile = env.track.children[1].children[0].children[1]; assert.equal(tile.children[0].textContent, 'Unable to open <Note>.'); assert.equal(tile.dataset.state, 'unavailable')
  env.controller.dispose()
})
test('reports unplaced widgets while still rendering placed widgets', async () => {
  const env = setup(async () => ({ ok: true, apps: [widget(), { id: 'overflow', name: 'Overflow', kind: 'widget', revision: 'r', placementError: 'desktop-full' }] }))
  await tick()
  assert.equal(env.mounted.length, 1)
  assert.equal(env.status.dataset.state, 'placement-error')
  assert.match(env.status.textContent, /Overflow.*no free desktop cell/i)
  assert.equal(env.status.hidden, false)
  env.controller.dispose()
})
test('desktop composition no longer registers a collection page', () => {
  const source = fs.readFileSync('src/renderer/config/desktop_layout.js', 'utf8')
  assert.doesNotMatch(source, /odk\.page\.user-apps/)
  assert.equal(fs.existsSync('src/renderer/plugins/user-apps.js'), false)
})
