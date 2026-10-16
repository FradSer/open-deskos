'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { selection, runtime, ID } = require('./helpers/user-app-system-replacement')
const { posixOnlyReason } = require('./not-ported')
const { buildUserAppDocument } = require('../src/user-app-content')
const { FONTS } = require('../src/user-app-context')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
// This test process checks each runtime's own font root.
delete process.env.ODK_RUNTIME_ROOT

for (const signed of [false, true]) {
  test(`${signed ? 'signed selected' : 'default'} runtime handles initial data synchronization rejection`,
    { skip: posixOnlyReason('unix-socket'), timeout: 15000 }, async t => {
      const errors = []
      t.mock.method(console, 'error', message => errors.push(message))
      const selected = signed ? await selection(t) : null
      const f = await runtime(t, selected ? await selected.load() : [], {
        initialSync: async () => { throw Error('Controlled initial synchronization failure') },
      })
      // Flush the rejection notification turn, without a timer or arbitrary delay.
      await new Promise(resolve => setImmediate(resolve))
      assert.deepEqual(errors, ['Initial user application data synchronization failed'])
      assert.equal((await f.request({ command: 'list' })).apps[0].id, 'counter')
      await f.host.stop()
      assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).state, 'stopped')
      assert.equal(f.handlers.size, 0)
      assert.equal(f.routes.size, 0)
    })
  test(`${signed ? 'signed selected' : 'default'} runtime preserves Widget import, placement, refusal and removal`,
    { skip: posixOnlyReason('unix-socket'), timeout: 15000 }, async t => {
      const selected = signed ? await selection(t) : null
      const f = await runtime(t, selected ? await selected.load() : [])
      const sourcePath = path.join(f.root, 'imported-note')
      await fs.mkdir(sourcePath)
      await fs.writeFile(path.join(sourcePath, 'manifest.json'), JSON.stringify({
        schemaVersion: 1, id: 'note', name: 'Imported note', version: '1', kind: 'widget',
      }))
      const html = '<p>Imported Widget content</p>'
      await fs.writeFile(path.join(sourcePath, 'index.html'), html)
      const dispatch = request => f.handlers.get('odk-user-apps-dispatch')(null, request)
      const first = { pageId: 'desk', col: '2', row: '3' }
      const imported = await f.request({ command: 'add', sourcePath, placement: first })
      assert.equal(imported.ok, true)
      assert.deepEqual(imported.app.placement, first)
      const moved = { pageId: 'desk', col: '3 / 5', row: '3' }
      const placed = await dispatch({ command: 'place', appId: 'note', placement: moved })
      assert.equal(placed.ok, true)
      assert.equal(placed.app.revision, imported.app.revision)
      assert.deepEqual(placed.app.placement, moved)
      const assertConsumers = async () => {
        const ipc = await f.handlers.get('odk-user-apps-list')()
        const local = await f.request({ command: 'list' })
        assert.deepEqual(local.apps, ipc.apps)
        assert.deepEqual(ipc.apps.find(app => app.id === 'note'), placed.app)
        const desktop = await f.request({ command: 'desktop' })
        assert.equal(desktop.ok, true)
        // The layout originates in a VM; compare its public JSON representation.
        assert.deepEqual(desktop.pages, JSON.parse(JSON.stringify(await f.store.desktop())))
        assert.deepEqual(desktop.pages.find(page => page.id === 'desk').occupied.find(item => item.id === 'note'),
          { id: 'note', col: moved.col, row: moved.row })
        const response = await f.routes.get('odk-user-app')({ url: `odk-user-app://app/note/${imported.app.revision}` })
        assert.equal(response.status, 200)
        assert.match(await response.text(), /Imported Widget content/)
      }
      await assertConsumers()
      const catalogFile = path.join(f.surface.stateDir, 'user-apps.json')
      const saved = await fs.readFile(catalogFile)
      for (const operation of [dispatch, f.request]) {
        const rejected = await operation({ command: 'place', appId: 'note', placement: { pageId: 'home', col: '1', row: '1' } })
        assert.equal(rejected.ok, false)
        assert.deepEqual(await fs.readFile(catalogFile), saved)
      }
      await f.host.setEnabled(ID, false)
      await f.host.setEnabled(ID, true)
      await assertConsumers()
      assert.deepEqual(await fs.readFile(catalogFile), saved)
      assert.equal((await dispatch({ command: 'remove', appId: 'note' })).ok, true)
      assert.deepEqual((await f.request({ command: 'list' })).apps.map(app => app.id), ['counter'])
      assert.equal((await f.routes.get('odk-user-app')({ url: `odk-user-app://app/note/${imported.app.revision}` })).status, 404)
      assert.equal(await fs.readFile(path.join(sourcePath, 'index.html'), 'utf8'), html)
      assert.equal(f.starts(), signed ? 0 : 2)
    })
  test(`${signed ? 'signed selected' : 'default'} runtime preserves update, rollback, verification refusal, and restart`,
    { skip: posixOnlyReason('unix-socket'), timeout: 15000 }, async t => {
      let accepted = true
      const selected = signed ? await selection(t) : null
      const f = await runtime(t, selected ? await selected.load() : [], { verify: () => accepted })
      const first = (await f.request({ command: 'list' })).apps[0]
      const draft = path.join(f.env.ODK_WORKSPACE, 'apps/counter/index.html')
      const dispatch = request => f.handlers.get('odk-user-apps-dispatch')(null, request)
      await fs.writeFile(draft, '<p>Updated counter</p>')
      const updated = await dispatch({ command: 'update', appId: 'counter' })
      assert.equal(updated.ok, true)
      assert.notEqual(updated.app.revision, first.revision)
      assert.equal((await f.request({ command: 'list' })).apps[0].revision, updated.app.revision)
      const response = await f.routes.get('odk-user-app')({ url: `odk-user-app://app/counter/${updated.app.revision}` })
      assert.equal(response.status, 200)
      assert.match(await response.text(), /Updated counter/)
      const restored = await f.request({ command: 'rollback', appId: 'counter' })
      assert.equal(restored.ok, true)
      assert.equal(restored.app.revision, first.revision)
      assert.equal((await f.handlers.get('odk-user-apps-list')()).apps[0].revision, first.revision)
      const catalogFile = path.join(f.surface.stateDir, 'user-apps.json')
      const saved = await fs.readFile(catalogFile)
      accepted = false
      await fs.writeFile(draft, '<p>Rejected counter</p>')
      for (const operation of [dispatch, f.request]) {
        const rejected = await operation({ command: 'update', appId: 'counter' })
        assert.equal(rejected.ok, false)
        assert.equal(rejected.error, 'verification-failed')
        assert.deepEqual(await fs.readFile(catalogFile), saved)
      }
      assert.equal((await f.store.getContent('counter')).app.revision, first.revision)
      assert.equal((await f.store.getContent('counter')).html, '<p id="value">Counter</p>')
      await f.host.setEnabled(ID, false)
      await f.host.setEnabled(ID, true)
      assert.equal((await f.request({ command: 'list' })).apps[0].revision, first.revision)
      assert.deepEqual(await fs.readFile(catalogFile), saved)
      accepted = true
      const forward = await dispatch({ command: 'rollback', appId: 'counter' })
      assert.equal(forward.ok, true)
      assert.equal(forward.app.revision, updated.app.revision)
      assert.equal((await f.store.getContent('counter')).html, '<p>Updated counter</p>')
      assert.equal(await fs.readFile(draft, 'utf8'), '<p>Rejected counter</p>')
      assert.equal(f.starts(), signed ? 0 : 2)
    })
  test(`${signed ? 'signed independent' : 'default'} installed runtime preserves documents, publication and restart`,
    { skip: posixOnlyReason('unix-socket'), timeout: 15000 }, async t => {
      const selected = signed ? await selection(t) : null
      const plugins = selected ? await selected.load() : []
      if (selected) {
        await fs.writeFile(selected.stored.entry, 'throw Error("mutated entry")')
        await fs.writeFile(path.join(selected.stored.root, 'src/user-app-system.js'), 'throw Error("mutated runtime")')
      }
      const f = await runtime(t, plugins)
      assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).manifest.version, signed ? '2.0.0' : '1.0.0')
      assert.equal(f.starts(), signed ? 0 : 1)
      const listed = await f.handlers.get('odk-user-apps-list')()
      assert.equal(listed.ok, true)
      assert.deepEqual(listed.apps, await f.store.list())
      const installed = listed.apps[0]
      const publish = () => f.handlers.get('odk-user-apps-publish')(null, { appId: 'counter', data: { count: 42 } })
      assert.deepEqual(publish(), { ok: true })
      const reading = await f.data.registry.read('counter')
      assert.equal(reading.reading.value.count, 42)
      assert.equal(reading.reading.untrusted, true)
      assert.deepEqual(f.handlers.get('odk-user-apps-publish')(null, { appId: 'counter', data: { secret: 1 } }), { ok: false, error: 'undeclared-data' })
      for (const theme of ['instrument', 'pixel', 'border-beam']) {
        const response = await f.routes.get('odk-user-app')({ url: `odk-user-app://app/counter/${installed.revision}?token=fixture&theme=${theme}` })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('Content-Security-Policy'), f.policy)
        const content = await f.store.getContent('counter')
        assert.equal(await response.text(), buildUserAppDocument({ manifest: content.app, html: content.html, revision: installed.revision }, { token: 'fixture', theme }))
      }
      assert.equal((await f.routes.get('odk-user-app')({ url: 'odk-user-app://app/counter/' + '0'.repeat(32) })).status, 404)
      for (const font of ['zpix', 'montserrat-bold', 'noto-sans-sc']) {
        const response = await f.routes.get('odk-user-app')({ url: `odk-user-app://app/font/${font}` })
        assert.equal(response.status, 200)
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), await fs.readFile(path.join(__dirname, '../src', FONTS[font].file)))
      }
      const retainedList = f.handlers.get('odk-user-apps-list')
      await f.host.setEnabled('odk.system.package-catalog', false)
      assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).state, 'blocked')
      assert.equal(f.handlers.size, 0)
      assert.equal(f.routes.size, 0)
      await assert.rejects(fs.stat(f.endpoint), { code: 'ENOENT' })
      assert.equal((await retainedList()).error, 'application-store-unavailable')
      assert.equal(f.starts(), signed ? 0 : 1, 'catalog disable must not invoke fallback startup')
      await f.host.setEnabled('odk.system.package-catalog', true)
      assert.deepEqual(await f.data.registry.read('counter'), reading)
      assert.equal((await f.handlers.get('odk-user-apps-list')()).apps[0].revision, installed.revision)
      assert.equal((await f.request({ command: 'list' })).apps[0].revision, installed.revision)
      await f.host.setEnabled(ID, false)
      assert.equal(f.handlers.size, 0)
      assert.equal(f.routes.size, 0)
      await assert.rejects(fs.stat(f.endpoint), { code: 'ENOENT' })
      await f.host.setEnabled(ID, true)
      assert.deepEqual(await f.data.registry.read('counter'), reading)
      assert.deepEqual(publish(), { ok: true })
      assert.equal((await f.request({ command: 'list' })).apps[0].revision, installed.revision)
      const removed = await f.handlers.get('odk-user-apps-dispatch')(null, { command: 'remove', appId: 'counter' })
      assert.equal(removed.ok, true)
      await f.data.syncPackages()
      assert.deepEqual(await f.data.registry.read('counter'), { ok: false, error: 'unknown-reading' })
      assert.equal((await f.routes.get('odk-user-app')({ url: `odk-user-app://app/counter/${installed.revision}` })).status, 404)
      await f.host.stop()
      assert.equal(f.handlers.size, 0)
      assert.equal(f.routes.size, 0)
    })
  test(`${signed ? 'signed independent' : 'default'} installed runtime retains failed cleanup until retry`,
    { skip: posixOnlyReason('unix-socket'), timeout: 15000 }, async t => {
      const selected = signed ? await selection(t) : null
      const f = await runtime(t, selected ? await selected.load() : [], { releaseFailures: 1 })
      await f.host.stop()
      assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).state, 'cleanup-failed')
      assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.data').state, 'cleanup-blocked')
      assert.equal(f.handlers.size, 0)
      assert.equal(f.routes.size, 1)
      await assert.rejects(fs.stat(f.endpoint), { code: 'ENOENT' })
      await assert.rejects(f.host.start(), /still owns resources/)
      await f.host.stop()
      assert.equal(f.routes.size, 0)
      await f.host.start()
      assert.equal((await f.request({ command: 'list' })).apps.length, 1)
    })
}

for (const signed of [false, true]) test(`${signed ? 'signed bundled' : 'default'} runtime uses the selected catalog for IPC, content, and control`,
  { skip: posixOnlyReason('unix-socket'), timeout: 10000 }, async t => {
    const app = { schemaVersion: 1, id: 'chosen', name: 'Chosen catalog App', version: '1', kind: 'app', revision: 'a'.repeat(32),
      data: { fields: { count: { type: 'number' } } } }
    let present = true
    const calls = []
    const refusal = { ok: false, error: 'selected-catalog-refusal' }
    const pages = [{ id: 'reading', occupied: [] }]
    const catalog = {
      async list() { return present ? [app] : [] },
      async desktop() { return pages },
      async getContent(id) { return present && id === app.id ? { ok: true, app, html: '<p>Selected catalog content</p>' } : { ok: false } },
      async remove(id) { assert.equal(id, app.id); present = false; return { ok: true } },
    }
    for (const method of ['install', 'addFromPath', 'updateInstalled', 'rollback', 'place']) {
      catalog[method] = async (...args) => { calls.push({ method, args }); return refusal }
    }
    const selected = signed ? await selection(t) : null
    const f = await runtime(t, selected ? await selected.load() : [], { catalog })
    assert.equal(f.host.get(DESK_PORTS.catalog), catalog)
    assert.deepEqual((await f.handlers.get('odk-user-apps-list')()).apps, [app])
    assert.deepEqual((await f.request({ command: 'list' })).apps, [app])
    const saved = await fs.readFile(path.join(f.surface.stateDir, 'user-apps.json'))
    const placement = { pageId: 'reading', col: '2', row: '3' }
    for (const dispatch of [request => f.handlers.get('odk-user-apps-dispatch')(null, request), f.request]) {
      const desktop = await dispatch({ command: 'desktop' })
      assert.equal(desktop.ok, true)
      assert.deepEqual(desktop.pages, pages)
      for (const [command, method] of [['install', 'install'], ['add', 'addFromPath'], ['update', 'updateInstalled'],
        ['rollback', 'rollback'], ['place', 'place']]) {
        const sourcePath = path.join(f.root, 'selected-import')
        const result = await dispatch({ command, appId: app.id, sourcePath, placement })
        assert.equal(result.ok, refusal.ok)
        assert.equal(result.error, refusal.error)
        assert.deepEqual(calls.at(-1), { method, args: [command === 'add' ? sourcePath : app.id, placement] })
      }
    }
    assert.equal(calls.length, 10)
    assert.deepEqual(await fs.readFile(path.join(f.surface.stateDir, 'user-apps.json')), saved)
    assert.deepEqual((await f.request({ command: 'list' })).apps, [app])
    const response = await f.routes.get('odk-user-app')({ url: `odk-user-app://app/chosen/${app.revision}` })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Content-Security-Policy'), f.policy)
    assert.match(await response.text(), /Selected catalog content/)
    assert.equal(f.handlers.get('odk-user-apps-publish')(null, { appId: app.id, data: { count: 7 } }).ok, true)
    assert.equal((await f.data.registry.read(app.id)).reading.value.count, 7)
    assert.equal((await f.request({ command: 'remove', appId: app.id })).ok, true)
    await f.data.syncPackages()
    assert.deepEqual((await f.handlers.get('odk-user-apps-list')()).apps, [])
    assert.equal((await f.routes.get('odk-user-app')({ url: `odk-user-app://app/chosen/${app.revision}` })).status, 404)
    assert.equal((await f.data.registry.read(app.id)).error, 'unknown-reading')
    assert.equal((await f.store.list())[0].id, 'counter', 'Selected catalog mutations must not reach the unused default store')
  })
