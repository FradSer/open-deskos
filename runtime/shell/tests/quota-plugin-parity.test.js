'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const vm = require('node:vm')
const { fixture, directory, id, channel } = require('./helpers/quota-runtime')
const run = promisify(execFile)
const cli = path.join(__dirname, '../scripts/odk-plugin-cli.js')
const available = { state: 'available', snapshot: {
  fetchedAt: '2026-10-08T00:00:00.000Z', accounts: [
    { id: 'codex-fixture', provider: 'codex', account: 'fixture@example.test', plan: 'Pro', fileName: 'private.json',
      resetCredits: { available: 2 }, groups: [{ title: 'Usage', quotas: [
        { label: '5 hours', remainingPct: 88, resetAt: '2026-10-08T05:00:00.000Z', description: 'private metadata' },
        { label: 'Weekly', remainingPct: null, resetAt: null },
      ] }] },
    { id: 'xai-fixture', provider: 'xai', account: 'second@example.test', error: 'provider unavailable', groups: [] },
  ],
} }

test('independent Quota entry executes without any host module imports', async t => {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(directory, 'entry.cjs'), 'utf8'), {
    exports: module.exports, AbortController,
    require(name) { throw Error(`Host implementation import refused: ${name}`) },
  })
  const cleanups = []
  const handlers = new Map()
  const instance = module.exports.create({ signal: new AbortController().signal,
    capability(name) {
      if (name === 'source.quota') return { read: async () => available }
      assert.equal(name, 'ipc')
      return { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) }
    }, onCleanup: callback => cleanups.push(callback),
  })
  t.after(async () => { for (const callback of cleanups.reverse()) await callback() })
  assert.equal(await instance.ports[DATA_PORTS.quota].read(), available)
  assert.equal(await handlers.get(channel)(), available)
  const reading = await instance.ports['odk:desk-reading/quota/v1'][0].read()
  assert.equal(reading.value.accounts[0].groups[0].windows[0].remainingPercent, 88)
})


for (const replacement of [false, true, 'signed']) {
  const name = replacement === 'signed' ? 'signed independent Quota plugin'
    : replacement ? 'linked independent Quota plugin' : 'default Quota plugin'
  test(`${name} cancels a queued read before provider entry`, async t => {
    let calls = 0
    const f = await fixture(t, replacement, async () => { calls++; return available })
    const queued = f.ipc()
    const disabled = f.host.setEnabled(id, false)
    assert.equal((await queued).state, 'unavailable')
    await disabled
    assert.equal(calls, 0)
    assert.equal(f.handlers.size, 0)
  })
  test(`${name} preserves missing projection fields and exact measurements`, async t => {
    const payload = { state: 'available', snapshot: { fetchedAt: 'invalid', accounts: [{
      id: 'fixture', groups: [{ quotas: [{}, { label: 'Zero', remainingPct: 0, resetAt: null },
        { label: null, remainingPct: null }, { label: 'Fraction', remainingPct: 12.345, resetAt: 'provider-time' }] }],
    }] } }
    const f = await fixture(t, replacement, async () => payload)
    assert.equal(await f.ipc(), payload)
    const [declaration] = f.host.get('odk:desk-reading/quota/v1')
    assert.deepEqual(declaration.home, { mode: 'optional', priority: 0, icon: 'quota', fields: ['accounts'] })
    assert.equal(declaration.label, 'API quota')
    assert.deepEqual(await declaration.read(), { state: 'live', value: { asOf: undefined, accounts: [{
      id: 'fixture', provider: null, account: null, plan: null, groups: [{ title: null, windows: [
        { resetsAt: null }, { label: 'Zero', remainingPercent: 0, resetsAt: null },
        { label: null, remainingPercent: null, resetsAt: null },
        { label: 'Fraction', remainingPercent: 12.345, resetsAt: 'provider-time' },
      ] }],
    }] } })
  })

  test(`${name} drains simultaneous successes and failures after cancellation`, async t => {
    const operations = []
    const f = await fixture(t, replacement, options => new Promise((resolve, reject) => operations.push({ resolve, reject, signal: options.signal })))
    const first = f.ipc()
    const second = f.ipc()
    await new Promise(setImmediate)
    assert.equal(operations.length, 2)
    const stopping = f.host.setEnabled(id, false)
    let done = false
    stopping.then(() => { done = true })
    assert.equal(operations.every(operation => operation.signal.aborted), true)
    operations[0].resolve(available)
    assert.equal((await first).state, 'unavailable')
    await new Promise(setImmediate)
    assert.equal(done, false)
    operations[1].reject(Error('late provider failure'))
    assert.equal((await second).state, 'unavailable')
    await stopping
    assert.equal(f.handlers.size, 0)
  })
  test(`${name} preserves IPC payloads and Open DeskOS Data availability and projection`, async t => {
    let response = available
    const f = await fixture(t, replacement, async () => response)
    assert.deepEqual(await f.ipc(), available)
    const reading = (await f.read()).reading
    assert.equal(reading.id, 'odk.page.quota')
    assert.equal(reading.kind, 'page')
    assert.equal(reading.state, 'live')
    assert.deepEqual(reading.value, { asOf: available.snapshot.fetchedAt, accounts: [
      { id: 'codex-fixture', provider: 'codex', account: 'fixture@example.test', plan: 'Pro', groups: [{ title: 'Usage', windows: [
        { label: '5 hours', remainingPercent: 88, resetsAt: '2026-10-08T05:00:00.000Z' },
        { label: 'Weekly', remainingPercent: null, resetsAt: null },
      ] }] },
      { id: 'xai-fixture', provider: 'xai', account: 'second@example.test', plan: null, groups: [] },
    ] })
    for (const state of ['unconfigured', 'unauthorized', 'unavailable']) {
      response = { state, reason: 'fixture', missing: ['fixture setting'] }
      assert.deepEqual(await f.ipc(), response)
      const result = (await f.read()).reading
      assert.equal(result.state, state === 'unconfigured' ? state : 'unavailable')
      assert.equal(result.value, null)
    }
    response = { state: 'available', snapshot: { accounts: [] } }
    assert.deepEqual(await f.ipc(), response)
    assert.deepEqual((await f.read()).reading.value.accounts, [])
    const old = f.host.get(DATA_PORTS.quota)
    await f.host.setEnabled(id, false)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.host.get(DATA_PORTS.quota), null)
    assert.equal(f.host.get(DESK_PORTS.data).registry.has('odk.page.quota'), false)
    await f.host.setEnabled(id, true)
    assert.notEqual(f.host.get(DATA_PORTS.quota), old)
    assert.equal(f.handlers.size, 1)
    assert.equal(f.host.get(DESK_PORTS.data).registry.has('odk.page.quota'), true)
  })

  test(`${name} drains retained requests before restart and suppresses late live results`, async t => {
    let enter, finish, signal
    const entered = new Promise(resolve => { enter = resolve })
    const pending = new Promise(resolve => { finish = resolve })
    let calls = 0
    const f = await fixture(t, replacement, options => { signal = options.signal; calls++; enter(); return pending })
    const old = f.host.get(DATA_PORTS.quota)
    const oldHandler = f.handlers.get(channel)
    const reading = f.ipc()
    await entered
    let enabled = false
    const disable = f.host.setEnabled(id, false)
    const enable = f.host.setEnabled(id, true).then(() => { enabled = true })
    try {
      assert.equal(signal.aborted, true)
      await new Promise(setImmediate)
      assert.equal(enabled, false)
      assert.equal((await oldHandler(null)).state, 'unavailable')
      assert.equal(calls, 1)
    } finally { finish(available) }
    assert.equal((await reading).state, 'unavailable')
    await Promise.all([disable, enable])
    assert.notEqual(f.host.get(DATA_PORTS.quota), old)
    assert.equal(f.handlers.size, 1)
  })

  test(`${name} preserves read failures and retries retained cleanup`, async t => {
    const f = await fixture(t, replacement, async () => { throw Error('fixture read failed') })
    await assert.rejects(f.ipc(), /fixture read failed/)
    const source = f.host.get(DATA_PORTS.quota)
    const stop = source.stop.bind(source)
    let failed = true
    source.stop = () => { if (failed) throw Error('fixture close failed'); return stop() }
    await f.host.setEnabled(id, false)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === id).state, 'cleanup-failed')
    await f.host.setEnabled(id, true)
    assert.equal(f.host.get(DATA_PORTS.quota), null)
    assert.equal(f.handlers.size, 0)
    failed = false
    await f.host.setEnabled(id, true)
    assert.notEqual(f.host.get(DATA_PORTS.quota), source)
    assert.equal(f.handlers.size, 1)
  })
}

test('signed Quota update rollback and removal preserve actual consumers', async t => {
  const f = await fixture(t, 'signed', async () => available, { mutateCaptured: false })
  const first = f.native.selected().native.revision
  const old = f.host.get(DATA_PORTS.quota)
  assert.equal(old.fixtureRevision, '2.0.0')
  const baseline = (await f.read()).reading.value
  await f.native.write('3.0.0')
  const updated = JSON.parse((await f.native.command(['update', id, f.native.bundle, ...f.native.authorization])).stdout)
  assert.equal(updated.effect, 'selection-only')
  const second = f.native.selected().native.revision
  assert.notEqual(second, first)
  assert.equal(f.host.get(DATA_PORTS.quota), old)
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === id).manifest.version, '2.0.0')
  await f.reload()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === id).manifest.version, '3.0.0')
  assert.equal(f.host.get(DATA_PORTS.quota).fixtureRevision, '3.0.0')
  assert.deepEqual(await f.ipc(), available)
  assert.deepEqual((await f.read()).reading.value, baseline)
  const current = f.host.get(DATA_PORTS.quota)
  const configBytes = fs.readFileSync(resolveConfigPath(f.env))
  fs.writeFileSync(path.join(f.native.bundle, 'entry.cjs'), 'unsigned update')
  await assert.rejects(f.native.command(['update', id, f.native.bundle, ...f.native.authorization]), /native file hash mismatch/)
  assert.deepEqual(fs.readFileSync(resolveConfigPath(f.env)), configBytes)
  assert.equal(f.host.get(DATA_PORTS.quota), current)
  assert.deepEqual(await f.ipc(), available)
  await f.native.command(['rollback', id, '--keyring', f.native.keyring])
  assert.equal(f.native.selected().native.revision, first)
  assert.equal(f.host.get(DATA_PORTS.quota), current)
  await f.reload()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === id).manifest.version, '2.0.0')
  assert.equal(f.host.get(DATA_PORTS.quota).fixtureRevision, '2.0.0')
  assert.deepEqual(await f.ipc(), available)
  assert.deepEqual((await f.read()).reading.value, baseline)
  const rolledBack = f.host.get(DATA_PORTS.quota)
  await f.native.command(['remove', id])
  assert.equal(f.native.selected().native, undefined)
  assert.equal(f.host.get(DATA_PORTS.quota), rolledBack)
  await f.reload()
  assert.equal(f.host.list().find(plugin => plugin.manifest.id === id).manifest.version, '1.0.0')
  assert.equal(f.host.get(DATA_PORTS.quota).fixtureRevision, undefined)
  assert.deepEqual(await f.ipc(), available)
  assert.deepEqual((await f.read()).reading.value, baseline)
  assert.equal((await f.native.store.read(first)).manifest.version, '2.0.0')
  assert.equal((await f.native.store.read(second)).manifest.version, '3.0.0')
})

test('removing the Quota link restores the default and preserves the external package', async t => {
  const f = await fixture(t, true, async () => available)
  const entry = path.join(directory, 'entry.cjs')
  const bytes = fs.readFileSync(entry)
  await f.host.stop()
  await run(process.execPath, [cli, 'remove', id], { env: f.env })
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.deepEqual(fs.readFileSync(entry), bytes)
  const defaults = await fixture(t, false, async () => available)
  assert.equal(defaults.host.list().find(plugin => plugin.manifest.id === id).manifest.version, '1.0.0')
  assert.deepEqual(await defaults.ipc(), available)
})
