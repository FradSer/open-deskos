const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

function fixture(overrides = {}) {
  const root = {}
  vm.runInNewContext(fs.readFileSync('src/renderer/core/runtime-controller.js', 'utf8'), { window: root })
  const calls = []
  const registry = { async setEnabled(id, enabled) { calls.push(['factory', id, enabled]) },
    catalog: () => ['catalog'], async stop() { calls.push(['stop']) }, ...overrides.registry }
  const composer = { async reconcile() { calls.push(['desktop']) },
    async reconcileStatus() { calls.push(['status']) }, ...overrides.composer }
  const controller = root.odkRendererRuntimeController.create({ registry, composer, layout: {}, track: {}, context: {},
    onPlacementsChanged() { calls.push(['placement']) }, onTransition: overrides.onTransition, onStop: overrides.onStop })
  return { calls, controller }
}

test('shutdown drains an additional owned service and retries its failed cleanup', async () => {
  let finish, attempts = 0
  const pending = new Promise(resolve => { finish = resolve })
  const { controller } = fixture({ onStop: async () => {
    attempts++
    if (attempts === 1) { await pending; throw Error('Controlled service cleanup failure') }
  } })
  const stopped = controller.stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(attempts, 1)
  finish()
  await assert.rejects(stopped, /Controlled service cleanup failure/)
  await controller.stop()
  assert.equal(attempts, 2)
})

test('runtime controller serializes factory changes and both placement coordinators', async () => {
  const { calls, controller } = fixture()
  const first = controller.setEnabled('odk.tile.clock', false)
  const second = controller.setEnabled('odk.status.clock', true)
  assert.deepEqual(await first, ['catalog'])
  await second
  assert.deepEqual(calls, [['factory', 'odk.tile.clock', false], ['desktop'], ['status'], ['placement'],
    ['factory', 'odk.status.clock', true], ['desktop'], ['status'], ['placement']])
})

test('runtime controller refreshes partially changed placements and attempts independent status recovery', async () => {
  let fail = true
  const { calls, controller } = fixture({ composer: { async reconcile() { if (fail) throw Error('desktop retained') } } })
  await assert.rejects(controller.setEnabled('odk.tile.clock', false), /renderer runtime reconciliation failed/)
  assert.deepEqual(calls, [['factory', 'odk.tile.clock', false], ['status'], ['placement']])
  fail = false
  await controller.setEnabled('odk.tile.clock', false)
})

test('runtime controller does not bypass App lifecycle rejection or reconcile after refusal', async () => {
  const { calls, controller } = fixture({ registry: { async setEnabled() { throw Error('App surface must close') } } })
  await assert.rejects(controller.setEnabled('odk.app.clock', false), /App surface must close/)
  assert.deepEqual(calls, [['placement']])
})

test('shutdown refuses queued changes and drains in-flight factory work before stopping', async () => {
  let release
  let started
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const { calls, controller } = fixture({ registry: { async setEnabled() { started(); await gate } } })
  const active = controller.setEnabled('odk.tile.clock', false)
  await began
  const queued = controller.setEnabled('odk.status.clock', true)
  const activeRejected = assert.rejects(active, /shutting down/)
  const queuedRejected = assert.rejects(queued, /shutting down/)
  const stopped = controller.stop()
  await assert.rejects(controller.setEnabled('odk.tile.clock', true), /shutting down/)
  release()
  await Promise.all([activeRejected, queuedRejected, stopped])
  assert.deepEqual(calls, [['stop']])
})

test('failed shutdown remains closed and a later stop retries release', async () => {
  let attempts = 0
  const { controller } = fixture({ registry: { async stop() { if (++attempts === 1) throw Error('retained') } } })
  await assert.rejects(controller.stop(), /retained/)
  await assert.rejects(controller.setEnabled('odk.tile.clock', true), /shutting down/)
  await controller.stop()
  assert.equal(attempts, 2)
})

test('runtime publication remains deferred through partial failure and flushes after placement sync', async () => {
  const trace = []
  const { controller } = fixture({ registry: { async setEnabled() { trace.push('factory'); throw Error('restoration failed') } },
    onTransition: active => trace.push(active ? 'defer' : 'publish') })
  await assert.rejects(controller.setEnabled('odk.tile.clock', true), /restoration failed/)
  assert.deepEqual(trace, ['defer', 'factory', 'publish'])
})

test('runtime controller serializes replacement with lifecycle changes and placement reconciliation', async () => {
  const { calls, controller } = fixture({ registry: { async replace(def) { calls.push(['replacement', def.id]) } } })
  const replaced = controller.replace({ id: 'odk.tile.fixture' })
  const disabled = controller.setEnabled('odk.status.clock', false)
  await replaced; await disabled
  assert.deepEqual(calls, [['replacement', 'odk.tile.fixture'], ['desktop'], ['status'], ['placement'],
    ['factory', 'odk.status.clock', false], ['desktop'], ['status'], ['placement']])
})

test('runtime controller retains replacement refusal and publishes its recovered catalog', async () => {
  const { calls, controller } = fixture({ registry: { async replace() { throw Error('candidate mount rolled back') } } })
  await assert.rejects(controller.replace({ id: 'odk.tile.fixture' }), /candidate mount rolled back/)
  assert.deepEqual(calls, [['placement']])
  await controller.stop()
  await assert.rejects(controller.replace({ id: 'odk.tile.fixture' }), /shutting down/)
})

test('runtime controller serializes built-in restoration and preserves its selected implementation receipt', async () => {
  const receipt = { implementation: 'built-in', version: '1.0.0', state: 'running' }
  const { calls, controller } = fixture({ registry: { async restoreDefault(id) { calls.push(['default', id]); return receipt } } })
  assert.deepEqual(await controller.restoreDefault('odk.tile.clock'), receipt)
  assert.deepEqual(calls, [['default', 'odk.tile.clock'], ['desktop'], ['status'], ['placement']])
  await controller.stop()
  await assert.rejects(controller.restoreDefault('odk.tile.clock'), /shutting down/)
})
