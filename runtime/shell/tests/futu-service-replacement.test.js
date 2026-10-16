'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { once } = require('node:events')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { loadNativePlugins } = require('../src/native-plugin-loader')
const { posixOnlyReason } = require('./not-ported')
const { signedSelection, fixture, publisher } = require('./helpers/futu-service')
const ID = 'odk.service.futu'

for (const signed of [false, true]) {
  const label = signed ? 'signed independent Futu service' : 'default Futu service'
  test(`${label} retains failed endpoint withdrawal until cleanup retry`, { skip: posixOnlyReason('unix-socket'), timeout: 10000 }, async t => {
    const f = await fixture(t, signed)
    const unlink = fs.unlink.bind(fs)
    let withdrawals = 0
    t.mock.method(fs, 'unlink', async endpoint => {
      if (endpoint === f.endpoint && ++withdrawals === 1) throw Object.assign(Error('Controlled endpoint withdrawal failure'), { code: 'EACCES' })
      return unlink(endpoint)
    })
    await f.host.stop()
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).state, 'cleanup-failed')
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.system.package-catalog').state, 'cleanup-blocked')
    await assert.rejects(f.host.start(), /still owns resources/)
    await f.host.stop()
    assert.equal(withdrawals, 2, 'Retry must withdraw the retained listener endpoint')
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).state, 'stopped')
    await f.host.start()
    await f.refresh()
    const peer = await publisher(t, f.endpoint)
    await peer.send({ type: 'data', updatedAt: f.now(), snapshot: { totals: { plRatio: 0.025 }, positions: [] } })
    assert.equal((await f.read()).reading.value.todayChangePercent, 2.5)
  })
  test(`${label} preserves actual publisher states, IPC values and Open DeskOS Data percentages`, { skip: posixOnlyReason('unix-socket'), timeout: 10000 }, async t => {
    const f = await fixture(t, signed)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).manifest.version, signed ? '2.0.0' : '1.0.0')
    assert.equal((await f.read()).reading.state, 'syncing')
    const peer = await publisher(t, f.endpoint)
    const snapshot = { totals: { marketVal: 1000, plVal: 12.3, plRatio: 0.0123 }, positions: [{ code: 'US.TEST', dayRatio: -0.0234, qty: 2 }] }
    assert.equal((await peer.send({ type: 'data', snapshot, updatedAt: f.now() })).ok, true)
    const ipc = f.handlers.get('odk-futu-holdings')
    assert.deepEqual(ipc(null, {}).snapshot, snapshot)
    const reading = (await f.read()).reading
    assert.equal(reading.state, 'live')
    assert.equal(reading.id, 'futu-poller')
    assert.equal(reading.label, 'Portfolio')
    assert.equal(reading.kind, 'service')
    assert.equal(reading.updatedAt, f.now())
    assert.equal(reading.value.todayChangePercent, 1.23)
    assert.equal(reading.value.positions[0].dayChangePercent, -2.34)
    assert.equal(reading.value.positions[0].symbol, 'US.TEST')
    assert.equal(f.health().state, 'healthy')
    for (const [record, state, health] of [
      [{ type: 'auth-required', secrets: ['private-key'] }, 'needs-auth', 'degraded'],
      [{ type: 'error', message: 'private-provider-error' }, 'unavailable', 'failed'],
    ]) {
      assert.equal((await peer.send({ ...record, updatedAt: f.now() })).ok, true)
      assert.equal(ipc(null, {}).state, state)
      assert.equal((await f.read()).reading.value, null)
      assert.equal(f.health().state, health)
      assert.doesNotMatch(JSON.stringify(f.health()), /private-key|private-provider-error|US.TEST/)
    }
    await peer.send({ type: 'data', snapshot, updatedAt: f.now() })
    f.advance(180001)
    assert.equal(ipc(null, {}).state, 'unavailable')
    assert.equal((await f.read()).reading.value, null)
    assert.equal(f.health().state, 'failed')
  })

  test(`${label} preserves catalog changes and releases listeners before restart`, { skip: posixOnlyReason('unix-socket'), timeout: 10000 }, async t => {
    const f = await fixture(t, signed)
    const peer = await publisher(t, f.endpoint)
    const closed = once(peer.socket, 'close')
    await f.host.setEnabled(ID, false)
    await closed
    assert.equal(f.handlers.has('odk-futu-holdings'), false)
    assert.equal(f.host.get(DESK_PORTS.data).registry.has('futu-poller'), false)
    await assert.rejects(fs.stat(f.endpoint), { code: 'ENOENT' })
    await f.host.setEnabled(ID, true)
    await f.refresh()
    assert.equal(f.sources.length, 2)
    assert.notEqual(f.sources[0], f.sources[1])
    assert.equal(f.host.get(DESK_PORTS.data).registry.has('futu-poller'), true)
    const next = await publisher(t, f.endpoint)
    const nextClosed = once(next.socket, 'close')
    f.declarations([])
    await f.refresh()
    await nextClosed
    assert.equal(f.host.get(DESK_PORTS.data).registry.has('futu-poller'), false)
    assert.equal(f.health().reason, 'no-services')
  })

  test(`${label} suppresses catalog work completed after disable`, { skip: posixOnlyReason('unix-socket'), timeout: 10000 }, async t => {
    const f = await fixture(t, signed)
    const gate = f.holdCatalog()
    const refreshing = f.host.get(DESK_PORTS.futu).refresh()
    await gate.entered
    const disabled = f.host.setEnabled(ID, false)
    await disabled
    gate.release()
    await refreshing
    assert.equal(f.handlers.has('odk-futu-holdings'), false)
    await assert.rejects(fs.stat(f.endpoint), { code: 'ENOENT' })
  })
}

test('signed Futu selection removal and corruption retain default composition', { skip: posixOnlyReason('unix-socket'), timeout: 10000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-fsr-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const selection = await signedSelection(root)
  assert.equal((await selection.load()).length, 1)
  const revision = selection.config().plugins[ID].native.revision
  const stored = await selection.store.read(revision)
  await fs.writeFile(stored.entry, 'throw Error("corrupt fixture")')
  const errors = []
  const corruptSelections = await loadNativePlugins(selection.config(), { env: selection.env, report: id => errors.push(id) })
  assert.deepEqual(corruptSelections, [])
  assert.deepEqual(errors, [ID])
  await selection.invoke(['remove', ID])
  const removedSelections = await selection.load()
  assert.deepEqual(removedSelections, [])
  for (const replacementPlugins of [corruptSelections, removedSelections]) {
    const f = await fixture(t, false, { replacementPlugins })
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).manifest.version, '1.0.0')
    const peer = await publisher(t, f.endpoint)
    await peer.send({ type: 'data', updatedAt: f.now(), snapshot: { totals: { plRatio: 0.025 }, positions: [] } })
    assert.equal((await f.read()).reading.value.todayChangePercent, 2.5)
    assert.equal(f.handlers.get('odk-futu-holdings')(null, {}).state, 'live')
    assert.equal(f.health().state, 'healthy')
  }
  assert.equal((await fs.stat(stored.root)).isDirectory(), true)
})
