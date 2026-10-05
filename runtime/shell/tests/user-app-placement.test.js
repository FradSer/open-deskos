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
test('a built-in tile landing on an installed cell reports a placement error', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note')
  assert.equal((await store.install('note', { pageId: 'home', col: '4', row: '3' })).ok, true)
  assert.equal((await store.list())[0].placementError, undefined)

  // The next release declares a built-in tile in that same cell.
  const released = createUserAppStore({ ...options, layout: { pages: [
    { id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }, { id: 'odk.tile.weather', col: '4', row: '3' }] },
  ] } })
  const conflicted = (await released.list())[0]
  assert.equal(conflicted.placementError, 'occupied-placement')
  assert.deepEqual(conflicted.placement, { pageId: 'home', col: '4', row: '3' })
  assert.equal((await released.remove('note')).ok, true, 'removal stays available while the cell is contested')

  // Reading the catalog with the layout that matches the stored placement clears it.
  await draft('note')
  assert.equal((await store.install('note', { pageId: 'home', col: '4', row: '3' })).ok, true)
  assert.equal((await createUserAppStore({ ...options, layout: { pages: [{ id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [] }] } }).list())[0].placementError, undefined)
})

test('corrupt persisted placements fail closed', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note'); await store.install('note')
  const catalogPath = path.join(options.stateDir, 'user-apps.json')
  const entries = JSON.parse(await fs.readFile(catalogPath))
  for (const placement of [
    { col: '1', row: '1' },
    { pageId: null, col: '1', row: '1' },
    { pageId: 1, col: '1', row: '1' },
    { pageId: '', col: '1', row: '1' },
    { pageId: 'home', col: 6, row: '1' },
    { pageId: 'home', col: '1', row: 'one' },
    { pageId: 'home', col: '1 / ', row: '1' },
    { pageId: 'home', col: 'x', row: '1' },
    { pageId: 'home', col: '1', row: '-1' },
  ]) {
    entries[0].placement = placement
    await fs.writeFile(catalogPath, JSON.stringify(entries))
    await assert.rejects(store.list(), /catalog-corrupt/, JSON.stringify(placement))
  }
  delete entries[0].placement
  await fs.writeFile(catalogPath, JSON.stringify(entries))
  assert.equal((await store.list())[0].placementError, undefined)
})

test('unavailable geometry is reported per widget and never hidden as corruption', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note'); await draft('second')
  await store.install('note', { pageId: 'home', col: '4', row: '3' })
  await store.install('second', { pageId: 'reading', col: '1', row: '1' })
  const catalogPath = path.join(options.stateDir, 'user-apps.json')
  const entries = JSON.parse(await fs.readFile(catalogPath))
  entries[0].placement = { pageId: 'home', col: '1', row: '1' }
  await fs.writeFile(catalogPath, JSON.stringify(entries))

  const apps = await store.list()
  assert.equal(apps.length, 2, 'one contested widget must not hide the rest of the catalog')
  assert.equal(apps.find(app => app.id === 'note').placementError, 'occupied-placement')
  assert.equal(apps.find(app => app.id === 'second').placementError, undefined)
  assert.equal((await store.remove('note')).ok, true)
})

test('updates and rollbacks retain a conflicted widget placement', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note', '1')
  const placement = { pageId: 'home', col: '4', row: '3' }
  assert.equal((await store.install('note', placement)).ok, true)
  await draft('note', '2')
  assert.equal((await store.update('note')).ok, true)

  const conflicted = createUserAppStore({ ...options, layout: { pages: [
    { id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [{ id: 'odk.tile.weather', col: '4', row: '3' }] },
  ] } })
  const listed = (await conflicted.list())[0]
  assert.deepEqual(listed.placement, placement)
  assert.equal(listed.placementError, 'occupied-placement')

  await draft('note', '3')
  const updated = await conflicted.update('note')
  assert.equal(updated.ok, true)
  assert.deepEqual(updated.app.placement, placement)
  assert.equal((await conflicted.getContent('note')).html, '<p>3</p>')

  const rolledBack = await conflicted.rollback('note')
  assert.equal(rolledBack.ok, true)
  assert.deepEqual(rolledBack.app.placement, placement)
  assert.equal(rolledBack.app.placementError, undefined)
  assert.equal((await conflicted.getContent('note')).html, '<p>2</p>')
})

test('an App updated to a Widget receives a placement', async t => {
  const { store, draft } = await setup(t)
  await draft('note', '1', 'app')
  assert.equal((await store.install('note')).ok, true)

  await draft('note', '2', 'widget')
  const updated = await store.update('note')

  assert.equal(updated.ok, true)
  assert.equal(updated.app.kind, 'widget')
  assert.deepEqual(updated.app.placement, { pageId: 'home', col: '3', row: '1' })

  await draft('note', '3', 'app')
  assert.equal((await store.update('note')).ok, true)
  const rolledBack = await store.rollback('note')
  assert.equal(rolledBack.ok, true)
  assert.equal(rolledBack.app.kind, 'widget')
  assert.deepEqual(rolledBack.app.placement, { pageId: 'home', col: '3', row: '1' })
})

test('updates and rollbacks retain geometry unavailable after a layout release', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note', '1')
  const placement = { pageId: 'home', col: '4', row: '3' }
  assert.equal((await store.install('note', placement)).ok, true)
  await draft('note', '2')
  assert.equal((await store.update('note')).ok, true)

  const released = createUserAppStore({ ...options, layout: { pages: [
    { id: 'today', kind: 'page', name: 'Today' },
  ] } })
  const listed = (await released.list())[0]
  assert.deepEqual(listed.placement, placement)
  assert.equal(listed.placementError, 'unavailable-page')

  await draft('note', '3')
  const updated = await released.update('note')
  assert.equal(updated.ok, true)
  assert.deepEqual(updated.app.placement, placement)
  assert.equal((await released.getContent('note')).html, '<p>3</p>')

  const rolledBack = await released.rollback('note')
  assert.equal(rolledBack.ok, true)
  assert.deepEqual(rolledBack.app.placement, placement)
  assert.equal((await released.getContent('note')).html, '<p>2</p>')
  assert.equal((await released.list())[0].placementError, 'unavailable-page')
})

test('updates and rollbacks retain a stored span outside a released grid', async t => {
  const { store, options, draft } = await setup(t)
  await draft('note', '1')
  const placement = { pageId: 'home', col: '4', row: '3' }
  assert.equal((await store.install('note', placement)).ok, true)
  await draft('note', '2')
  assert.equal((await store.update('note')).ok, true)

  const catalogPath = path.join(options.stateDir, 'user-apps.json')
  const entries = JSON.parse(await fs.readFile(catalogPath))
  entries[0].placement = { pageId: 'home', col: '5 / 7', row: '1' }
  await fs.writeFile(catalogPath, JSON.stringify(entries))

  const released = createUserAppStore(options)
  const listed = (await released.list())[0]
  assert.deepEqual(listed.placement, entries[0].placement)
  assert.equal(listed.placementError, 'invalid-placement')

  await draft('note', '3')
  const updated = await released.update('note')
  assert.equal(updated.ok, true)
  assert.deepEqual(updated.app.placement, entries[0].placement)

  const rolledBack = await released.rollback('note')
  assert.equal(rolledBack.ok, true)
  assert.deepEqual(rolledBack.app.placement, entries[0].placement)
  assert.equal((await released.list())[0].placementError, 'invalid-placement')
})
