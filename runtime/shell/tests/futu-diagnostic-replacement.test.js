'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { createDiagnosticsPlugin, requestDiagnostics } = require('../src/plugin-diagnostics')
const { independentFutuDiagnosis } = require('./fixtures/futu-diagnostic-replacement')
const id = 'odk.system.futu-runtime-diagnostics'
const port = 'odk:plugin-runtime/python-agent/futu-poller/v1'
const unavailable = reason => ({ host: 'python-agent', instance: 'futu-poller', state: 'unavailable', reason, plugins: [] })
const report = { host: 'python-agent', instance: 'futu-poller', state: 'available', plugins: [{
  manifest: { schemaVersion: 1, id: 'odk.futu.publisher', name: 'Publisher', version: '1.0.0', host: 'python-agent', kind: 'transport', provides: [], requires: [], permissions: [] },
  state: 'running', enabled: true,
}] }

async function setup(t, independent, source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-fdiag-'))
  const endpoint = path.join(root, 'diagnose.sock')
  const host = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint, stateDir: root, snapshot: () => host.list() } } })
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }) })
  const selected = createMainPlugins({ replacementPlugins: independent ? [independentFutuDiagnosis()] : [] }).find(plugin => plugin.manifest.id === id)
  assert.equal(selected.manifest.version, independent ? '2.0.0' : '1.0.0')
  if (source !== undefined) host.register({ manifest: { schemaVersion: 1, id: 'odk.fixture.futu', name: 'Source', version: '1.0.0', host: 'electron-main', kind: 'service', provides: [{ interface: DESK_PORTS.futu }] },
    create: () => ({ ports: { [DESK_PORTS.futu]: { source } } }),
  })
  host.register(selected)
  host.register(createDiagnosticsPlugin({ runtimePorts: [port] }))
  await host.start()
  return { host, diagnose: pluginId => requestDiagnostics({ endpoint, ...(pluginId ? { pluginId } : {}) }) }
}

for (const independent of [false, true]) {
  const label = independent ? 'selected independent' : 'default'
  test(`${label} Futu diagnosis preserves public reports and source readings`, async t => {
    let calls = 0
    const reading = { state: 'live', positions: [{ symbol: 'FIXTURE', quantity: 2 }] }
    const source = { snapshot: () => reading, async diagnoseRuntime(instance, { signal }) {
      assert.equal(instance, 'futu-poller')
      assert.ok(signal instanceof AbortSignal)
      assert.equal(signal.aborted, false)
      calls++
      return report
    } }
    const { diagnose } = await setup(t, independent, source)
    const response = await diagnose('odk.futu.publisher')
    assert.equal(response.ok, true)
    assert.deepEqual(response.runtimes, [{ ...report, plugins: report.plugins.map(plugin => ({ ...plugin, health: { state: 'unknown', reason: 'not-declared' } })) }])
    assert.deepEqual(response.plugins, [])
    assert.equal(calls, 1)
    assert.equal(source.snapshot(), reading)
    await assert.rejects(diagnose('odk.unknown'), /unknown-plugin/)
    assert.equal(calls, 2)
  })
  test(`${label} Futu diagnosis preserves absent and legacy providers`, async t => {
    for (const source of [undefined, {}]) await t.test(source ? 'legacy source' : 'absent source', async t => {
      const { host, diagnose } = await setup(t, independent, source)
      assert.deepEqual(await host.get(port).snapshot(), [unavailable('provider-unavailable')])
      assert.deepEqual((await diagnose()).runtimes, [unavailable('provider-unavailable')])
    })
  })
  test(`${label} Futu diagnosis preserves failed-probe reasons`, async t => {
    let reason = 'timeout'
    const { host, diagnose } = await setup(t, independent, { async diagnoseRuntime() { throw Error(reason) } })
    for (reason of ['provider-unavailable', 'capability-unavailable', 'ambiguous-peer', 'requests-full', 'channel-busy', 'timeout', 'disconnected', 'invalid-report', 'stopped', 'cancelled', 'peer-changed', 'private-fixture-details']) {
      const expected = unavailable(reason === 'private-fixture-details' ? 'probe-failed' : reason)
      assert.deepEqual(await host.get(port).snapshot(), [expected])
      assert.deepEqual((await diagnose()).runtimes, [expected])
    }
  })
  test(`${label} Futu diagnosis cancels requests without stopping its source`, async t => {
    let notify
    const started = new Promise(resolve => { notify = resolve })
    const signals = []
    let pending = true
    const source = { async diagnoseRuntime(instance, { signal }) {
      assert.equal(instance, 'futu-poller')
      signals.push(signal)
      if (signal.aborted) throw Error('cancelled')
      if (pending) {
        notify()
        await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
        throw Error('cancelled')
      }
      return report
    } }
    const { host } = await setup(t, independent, source)
    const oldPort = host.get(port)
    const response = oldPort.snapshot()
    await started
    await host.setEnabled(id, false)
    assert.deepEqual(await response, [unavailable('cancelled')])
    assert.equal(signals[0].aborted, true)
    assert.deepEqual(await oldPort.snapshot(), [unavailable('cancelled')])
    assert.equal(host.get(DESK_PORTS.futu).source, source)
    assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.fixture.futu').state, 'running')
    pending = false
    await host.setEnabled(id, true)
    assert.deepEqual(await host.get(port).snapshot(), [report])
    assert.notEqual(signals.at(-1), signals[0])
    assert.equal(signals.at(-1).aborted, false)
  })
}
