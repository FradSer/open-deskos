const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createUserAppStore } = require('../src/user-app-store')
const { createUserAppControl } = require('../src/user-app-control')
const layout = { pages: [
  { id: 'today', kind: 'page', name: 'Today' },
  { id: 'home', kind: 'grid', name: 'Home', widgets: [{ id: 'clock', col: '1 / 3', row: '1' }] },
  { id: 'reading', kind: 'grid', name: 'Reading', widgets: [] },
] }
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odesk-placement-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const options = { workspace: root, stateDir: path.join(root, 'state'), layout, verify: () => true }
  async function draft(id, version = '1', kind = 'widget') {
    const dir = path.join(root, 'apps', id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id, name: id, version, kind }))
    await fs.writeFile(path.join(dir, 'index.html'), `<p>${version}</p>`)
  }
  return { options, draft, store: createUserAppStore(options) }
}
test('persists exact spans; moves survive revision changes and restart', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note')
  const first = { pageId: 'home', col: '3 / 5', row: '2 / 4' }
  assert.deepEqual((await store.install('note', first)).app.placement, first)
  const placement = { pageId: 'reading', col: '2 / 5', row: '1 / 3' }
  const moved = await store.place('note', placement)
  assert.equal(moved.ok, true)
  await draft('note', '2')
  assert.deepEqual((await store.install('note')).app.placement, placement)
  assert.deepEqual((await store.rollback('note')).app.placement, placement)
  assert.deepEqual((await createUserAppStore(options).list())[0].placement, placement)
})
test('rejects unsafe positions and serializes collisions without mutation', async t => {
  const { store, draft } = await setup(t)
  await draft('note'); await draft('other'); await draft('app', '1', 'app')
  const placement = { pageId: 'home', col: '3', row: '1' }
  const results = await Promise.all(['note', 'other'].map(id => store.install(id, placement)))
  assert.deepEqual(results.map(r => r.ok), [true, false])
  assert.equal(results[1].error, 'occupied-placement')
  for (const [target, error] of [
    [{ pageId: 'today', col: '1', row: '1' }, 'invalid-page'],
    [{ pageId: 'missing', col: '1', row: '1' }, 'invalid-page'],
    [{ pageId: 'home', col: '1', row: '1' }, 'occupied-placement'],
    [{ pageId: 'home', col: '5 / 7', row: '1' }, 'invalid-placement'],
    [{ pageId: 'home', col: '1', row: '0' }, 'invalid-placement'],
  ]) assert.equal((await store.place('note', target)).error, error)
  assert.deepEqual((await store.list())[0].placement, placement)
  assert.equal((await store.install('app', placement)).error, 'placement-requires-widget')
})
test('assigns missing placement on list and exposes actual desktop occupancy through control', async t => {
  const { store, draft, options } = await setup(t)
  await draft('note'); await store.install('note')
  const catalogPath = path.join(options.stateDir, 'user-apps.json')
  const entries = JSON.parse(await fs.readFile(catalogPath)); delete entries[0].placement
  await fs.writeFile(catalogPath, JSON.stringify(entries))
  const placement = { pageId: 'home', col: '3', row: '1' }
  assert.deepEqual((await store.list())[0].placement, placement)
  assert.deepEqual(JSON.parse(await fs.readFile(catalogPath))[0].placement, placement)
  const control = createUserAppControl(store)
  const response = await control.dispatch({ command: 'desktop' })
  assert.equal(response.ok, true)
  assert.equal(response.pages[1].index, 2)
  assert.deepEqual(response.pages[1].occupied.map(item => item.id), ['clock', 'note'])
  assert.equal((await control.dispatch({ command: 'place', appId: 'note', placement: { pageId: 'reading', col: '1', row: '1' } })).ok, true)
})

test('full desktop reports unplaced widgets but removal remains usable', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note'); await store.install('note')
  const catalogPath = path.join(options.stateDir, 'user-apps.json')
  const entries = JSON.parse(await fs.readFile(catalogPath)); delete entries[0].placement
  await fs.writeFile(catalogPath, JSON.stringify(entries))
  const fullLayout = { pages: [{ id: 'full', kind: 'grid', widgets: [{ id: 'all', col: '1 / 6', row: '1 / 4' }] }] }
  const full = createUserAppStore({ ...options, layout: fullLayout })
  const apps = await full.list()
  assert.equal(apps[0].placementError, 'desktop-full')
  assert.equal(apps[0].placement, undefined)
  assert.equal((await full.remove('note')).ok, true)
})
test('corrupt persisted placements fail closed', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note'); await store.install('note')
  const catalogPath = path.join(options.stateDir, 'user-apps.json')
  const entries = JSON.parse(await fs.readFile(catalogPath))
  for (const placement of [{ pageId: 'home', col: '6', row: '1' }, { pageId: 'home', col: '1', row: '1' }]) {
    entries[0].placement = placement
    await fs.writeFile(catalogPath, JSON.stringify(entries))
    await assert.rejects(store.list(), /catalog-corrupt/)
  }
})
