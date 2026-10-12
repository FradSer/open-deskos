'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function fixture({ subscribe = true, homeStatus = async () => ({ state: 'available' }), beforeRelease = () => {} } = {}) {
  const timers = new Map(), callbacks = []
  const reads = { camera: 0, subscription: 0 }
  const errors = [], events = new Map()
  const root = {
    addEventListener(name, callback) { events.set(name, callback) },
    removeEventListener(name, callback) { beforeRelease(name); if (events.get(name) === callback) events.delete(name) },
    odkRemote: { subscribeLinkState(callback) { events.set('remoteLink', callback); return () => { beforeRelease('remoteLink'); if (events.get('remoteLink') === callback) events.delete('remoteLink') } } },
    odkPersonalBot: { subscribe(callback) { events.set('homeBriefing', callback); return () => { beforeRelease('homeBriefing'); if (events.get('homeBriefing') === callback) events.delete('homeBriefing') } }, getStatus: homeStatus },
    odkPlatform: {
      async getCameraFrame() { reads.camera++; return { status: 'unavailable' } },
      async getOpenCodeGoStatus() { reads.subscription++; return { state: 'unconfigured' } },
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/services.js'), 'utf8'), {
    window: root, navigator: { onLine: true },
    setInterval(callback) { const id = callbacks.length + 1; callbacks.push(callback); timers.set(id, callback); return id },
    clearInterval(id) { timers.delete(id) },
    console: { error(...args) { errors.push(args) } },
  })
  if (subscribe) root.odkServices.onTick(() => {})
  return { root, services: root.odkServices, reads, errors, timers, callbacks, events,
    advance(seconds) { for (let i = 0; i < seconds; i++) for (const callback of [...timers.values()]) callback() },
  }
}

test('named consumer services resolve registered implementations', () => {
  const { services } = fixture()
  for (const name of ['connection', 'gamepad', 'subscription', 'camera', 'remoteLink', 'briefing', 'homeBriefing']) {
    const original = services[name]
    assert.equal(original, services.get(`odk.service.${name}`))
    const replacement = { snapshot: () => name }
    services.registerService(`odk.service.${name}`, replacement)
    assert.equal(services[name], replacement, `${name} consumers must use the selected service`)
    assert.equal(services.get(name), replacement)
    services.registerService(`odk.service.${name}`, original)
    assert.equal(services[name], original)
  }
})

test('shared refresh timer uses replacements and stops requesting removed services', async () => {
  const f = fixture()
  const calls = { camera: 0, subscription: 0 }
  for (const name of Object.keys(calls)) {
    f.services.registerService(`odk.service.${name}`, { refresh() { calls[name]++ } })
  }
  f.advance(60)
  await Promise.resolve()
  assert.deepEqual(calls, { camera: 4, subscription: 1 })
  assert.deepEqual(f.reads, { camera: 0, subscription: 0 })
  f.services.unregisterService('odk.service.camera')
  f.services.unregisterService('odk.service.subscription')
  f.advance(60)
  await Promise.resolve()
  assert.deepEqual(calls, { camera: 4, subscription: 1 })
})

test('default services preserve refresh cadence and readings', async () => {
  const f = fixture()
  f.advance(60)
  await new Promise(resolve => setImmediate(resolve))
  // Default Camera coalesces refreshes while the platform request is pending.
  assert.deepEqual(f.reads, { camera: 1, subscription: 1 })
  assert.equal(f.services.camera.status().status, 'unavailable')
  assert.equal(f.services.subscription.status().state, 'unconfigured')
})

test('failed replacement refreshes remain isolated from peer services', async () => {
  for (const failure of ['throw', 'reject']) {
    const f = fixture()
    let quotaCalls = 0
    f.services.registerService('odk.service.camera', { refresh() {
      if (failure === 'throw') throw new Error('Controlled refresh failure')
      return Promise.reject(new Error('Controlled refresh failure'))
    } })
    f.services.registerService('odk.service.subscription', { refresh() { quotaCalls++ } })
    f.advance(60)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(quotaCalls, 1)
    assert.equal(f.errors.length, 4)
    assert.deepEqual(f.reads, { camera: 0, subscription: 0 })
  }
})


test('Camera Widget subscribes to the selected service and releases its subscription', () => {
  const f = fixture()
  let widget
  let refreshes = 0
  let releases = 0
  f.root.odkPlugins = { register(definition) { widget = definition } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/camera.js'), 'utf8'), { window: f.root })
  const frame = { hidden: true, removeAttribute() {} }
  const state = { textContent: '' }
  const element = { innerHTML: '', querySelector(selector) { return selector === '.w-camera-frame' ? frame : state } }
  const cleanups = []
  f.services.registerService('odk.service.camera', {
    subscribe(callback) {
      callback({ status: 'live', frame: 'data:image/png;base64,fixture', capturedAt: null })
      return () => { releases++ }
    },
    refresh() { refreshes++ },
  })
  widget.mount(element, { camera: f.services.camera, trackCleanup(cleanup) { cleanups.push(cleanup) } })
  assert.equal(frame.hidden, false)
  assert.equal(frame.src, 'data:image/png;base64,fixture')
  assert.equal(refreshes, 1)
  assert.equal(f.reads.camera, 0)
  cleanups.forEach(cleanup => cleanup())
  assert.equal(releases, 1)
})


test('Shell startup contains selected Quota refresh failures before mounting consumers', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/shell.js'), 'utf8')
  const startup = source.slice(source.indexOf('  applyGeometry()\n', source.indexOf('async function main()')), source.indexOf("  const appView = document.getElementById('app-view')"))
  assert.ok(startup.includes('subscription.refresh()'))
  for (const failure of ['throw', 'reject']) {
    const f = fixture()
    f.services.registerService('odk.service.subscription', { refresh() {
      if (failure === 'throw') throw new Error('Controlled startup failure')
      return Promise.reject(new Error('Controlled startup failure'))
    } })
    let continued = false
    vm.runInNewContext(startup + '\ncontinueMounting()', {
      odkServices: f.services, applyGeometry() {}, continueMounting() { continued = true },
      console: { error(...args) { f.errors.push(args) } },
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(continued, true)
    assert.equal(f.errors.length, 1)
  }
})


test('full and short service names select and remove one implementation', () => {
  for (const registerName of ['camera', 'odk.service.camera']) {
    for (const removeName of ['camera', 'odk.service.camera']) {
      const { services } = fixture()
      const replacement = { refresh() {} }
      services.registerService(registerName, replacement)
      assert.equal(services.get('camera'), replacement)
      assert.equal(services.get('odk.service.camera'), replacement)
      assert.equal(services.camera, replacement)
      assert.equal(services.list().filter(id => id === 'odk.service.camera').length, 1)
      services.unregisterService(removeName)
      assert.equal(services.get('camera'), null)
      assert.equal(services.get('odk.service.camera'), null)
      assert.equal(services.camera, null)
      assert.equal(services.has('camera'), false)
      assert.equal(services.has('odk.service.camera'), false)
      assert.equal(services.list().includes('odk.service.camera'), false)
    }
  }
})


test('shared Tick owns one interval until its final consumer releases', () => {
  const f = fixture({ subscribe: false })
  const counts = [0, 0]
  const first = f.services.onTick(() => { counts[0]++ })
  const second = f.services.onTick(() => { counts[1]++ })
  assert.equal(f.timers.size, 1)
  f.advance(1)
  assert.deepEqual(counts, [2, 2])
  first(); first()
  assert.equal(f.timers.size, 1)
  f.advance(1)
  assert.deepEqual(counts, [2, 3])
  second(); second()
  assert.equal(f.timers.size, 0)
  f.advance(60)
  assert.deepEqual(f.reads, { camera: 0, subscription: 0 })
  const release = f.services.onTick(() => { counts[0]++ })
  assert.equal(f.timers.size, 1)
  const before = [...counts]
  f.callbacks[0]()
  assert.deepEqual(counts, before, 'A retained interval must not deliver to new subscribers')
  f.advance(1)
  assert.equal(counts[0], before[0] + 1)
  release()
  assert.equal(f.timers.size, 0)
})

test('final release during Tick delivery prevents scheduled service refresh', () => {
  const f = fixture({ subscribe: false })
  let calls = 0, refreshes = 0, release
  f.services.registerService('camera', { refresh() { refreshes++ } })
  release = f.services.onTick(() => { if (++calls === 16) release() })
  f.advance(15)
  assert.equal(calls, 16)
  assert.equal(refreshes, 0)
  assert.equal(f.timers.size, 0)
  f.callbacks[0]()
  assert.equal(calls, 16)
  assert.equal(refreshes, 0)
})

test('Camera refresh teardown prevents the same Tick from refreshing Quota', () => {
  const f = fixture({ subscribe: false })
  let camera = 0, quota = 0, release
  f.services.registerService('camera', { refresh() { if (++camera === 4) release() } })
  f.services.registerService('subscription', { refresh() { quota++ } })
  release = f.services.onTick(() => {})
  f.advance(60)
  assert.equal(camera, 4)
  assert.equal(quota, 0)
  assert.equal(f.timers.size, 0)
})


for (const name of ['connection', 'gamepad', 'camera', 'subscription', 'remoteLink', 'briefing', 'homeBriefing', 'tick']) {
  test(`${name} subscriptions own separate cleanup for a shared callback`, async () => {
    const f = fixture({ subscribe: false })
    let calls = 0, revision = 0
    const callback = () => { calls++ }
    const subscribe = name === 'tick' ? f.services.onTick : value => f.services[name].subscribe(value)
    const emit = async () => {
      revision++
      switch (name) {
        case 'connection': f.events.get('offline')(); break
        case 'gamepad': f.events.get('odk-gamepad-state')({ detail: { connected: true, readable: true, id: String(revision) } }); break
        case 'camera': await f.services.camera.refresh(); break
        case 'subscription': await f.services.subscription.refresh(); break
        case 'remoteLink': f.events.get('remoteLink')(revision % 2 ? 'usb' : 'disconnected'); break
        case 'briefing': f.services.briefing.contribute({ id: 'odk.test.subscription-owner', parts: [{ text: String(revision) }] }); break
        case 'homeBriefing': f.events.get('homeBriefing')({ briefing: { state: 'live', items: [], generatedAt: revision } }); break
        case 'tick': f.advance(1); break
      }
    }
    const first = subscribe(callback)
    const second = subscribe(callback)
    assert.equal(calls, 2, 'Each subscription immediately receives retained state')
    await emit()
    assert.equal(calls, 4, 'Each subscription must receive the update')
    first()
    await emit()
    assert.equal(calls, 5, 'A peer subscription must survive cleanup')
    first()
    await emit()
    assert.equal(calls, 6)
    second()
    await emit()
    assert.equal(calls, 6)
    const third = subscribe(callback)
    assert.equal(calls, 7)
    first(); second()
    await emit()
    assert.equal(calls, 8, 'Old cleanup must not remove a new subscription')
    third()
    await emit()
    assert.equal(calls, 8)
    assert.equal(f.timers.size, 0)
  })
}

for (const name of ['connection', 'camera', 'subscription', 'remoteLink', 'briefing', 'homeBriefing']) {
  test(`${name} removes a subscription when initial replay throws`, async () => {
    const f = fixture({ subscribe: false })
    const failure = new Error('Controlled initial replay failure')
    let failedCalls = 0, peerCalls = 0
    const release = f.services[name].subscribe(() => { peerCalls++ })
    assert.throws(() => f.services[name].subscribe(() => {
      failedCalls++
      throw failure
    }), error => error === failure)
    switch (name) {
      case 'connection': f.events.get('offline')(); break
      case 'camera': await f.services.camera.refresh(); break
      case 'subscription': await f.services.subscription.refresh(); break
      case 'remoteLink': f.events.get('remoteLink')('usb'); break
      case 'briefing': f.services.briefing.contribute({ id: 'odk.test.failed-subscription', parts: [{ text: 'Update' }] }); break
      case 'homeBriefing': f.events.get('homeBriefing')({ briefing: { state: 'live', items: [], generatedAt: 1 } }); break
    }
    assert.equal(failedCalls, 1, 'Failed subscription must not remain registered')
    assert.equal(peerCalls, 2)
    assert.equal(f.errors.length, 0)
    assert.equal(release(), true)
    assert.equal(release(), false)
  })
}

for (const name of ['gamepad', 'tick']) {
  test(`${name} retains cleanup when initial replay contains callback errors`, () => {
    const f = fixture({ subscribe: false })
    let calls = 0
    const callback = () => { calls++; throw new Error('Controlled contained callback failure') }
    const release = name === 'tick' ? f.services.onTick(callback) : f.services.gamepad.subscribe(callback)
    assert.equal(calls, 1)
    const emit = () => name === 'tick'
      ? f.advance(1)
      : f.events.get('odk-gamepad-state')({ detail: { connected: true, readable: true, id: 'Test' } })
    emit()
    assert.equal(calls, 2)
    assert.equal(f.errors.length, 2)
    assert.equal(release(), true)
    assert.equal(release(), false)
    emit()
    assert.equal(calls, 2)
    assert.equal(f.timers.size, 0)
  })
}


for (const [name, eventNames, deliver, read] of [
  ['remoteLink', ['remoteLink'], callback => callback('usb'), service => service.state()],
  ['homeBriefing', ['homeBriefing'], callback => callback({ briefing: { state: 'live', items: [], generatedAt: 42 } }), service => service.snapshot()],
  ['gamepad', ['odk-gamepad-state'], callback => callback({ detail: { connected: true, readable: true, id: 'Controller' } }), service => service.snapshot()],
  ['connection', ['online', 'offline'], callback => callback(), null],
]) {
  test(`${name} selection releases default inputs and fences callbacks across restoration`, async () => {
    const f = fixture({ subscribe: false })
    await new Promise(resolve => setImmediate(resolve))
    const original = f.services[name]
    const callbacks = eventNames.map(event => f.events.get(event))
    assert.ok(callbacks.every(callback => typeof callback === 'function'))
    let updates = 0
    const release = original.subscribe(() => { updates++ })
    const retained = read?.(original)
    const replacement = { subscribe() { return () => {} } }
    f.services.registerService(name, replacement)
    for (const event of eventNames) assert.equal(f.events.has(event), false, `${event} must be released`)
    for (const callback of callbacks) deliver(callback)
    assert.equal(updates, 1, 'A retained default callback must remain inactive')
    if (read) assert.equal(read(original), retained)
    f.services.registerService(name, original)
    const restored = eventNames.map(event => f.events.get(event))
    assert.ok(restored.every((callback, index) => typeof callback === 'function' && callback !== callbacks[index]))
    f.services.registerService(name, original)
    assert.deepEqual(eventNames.map(event => f.events.get(event)), restored)
    const restoredUpdates = updates
    for (const callback of callbacks) deliver(callback)
    assert.equal(updates, restoredUpdates, 'Old callbacks cannot resume when the original service returns')
    deliver(restored[0])
    assert.equal(updates, restoredUpdates + 1)
    f.services.unregisterService(name)
    for (const event of eventNames) assert.equal(f.events.has(event), false)
    for (const callback of restored) deliver(callback)
    assert.equal(updates, restoredUpdates + 1)
    release()
  })
}

test('Home Briefing restoration rereads status and rejects results from its previous selection', async () => {
  const pending = []
  const f = fixture({ subscribe: false, homeStatus: () => new Promise(resolve => pending.push(resolve)) })
  const original = f.services.homeBriefing
  const replacement = { snapshot: () => ({ state: 'unavailable' }) }
  const initial = original.snapshot()
  f.services.registerService('homeBriefing', replacement)
  pending[0]({ briefing: { state: 'live', items: [], generatedAt: 1 } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(original.snapshot(), initial, 'Deselection must fence pending status results')
  f.services.registerService('homeBriefing', original)
  assert.equal(pending.length, 2, 'Restoration must read current status')
  const current = { state: 'live', items: [], generatedAt: 2 }
  pending[1]({ briefing: current })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(original.snapshot(), current)
})


for (const fail of [false, true]) {
  test(`Home Briefing ignores an old ${fail ? 'rejection' : 'response'} after restoration`, async () => {
    const pending = []
    const f = fixture({ subscribe: false, homeStatus: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
    const original = f.services.homeBriefing
    f.services.unregisterService('homeBriefing')
    f.services.registerService('homeBriefing', original)
    const frame = { state: 'live', items: [{ text: 'Current' }], generatedAt: 5 }
    pending[1].resolve({ briefing: frame })
    await new Promise(resolve => setImmediate(resolve))
    if (fail) pending[0].reject(new Error('Controlled old response failure'))
    else pending[0].resolve({ briefing: { ...frame, generatedAt: 1 } })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(original.snapshot(), frame)
  })
}

test('restored gamepad service reads changes made while another service was selected', () => {
  const f = fixture({ subscribe: false })
  const original = f.services.gamepad
  f.services.unregisterService('gamepad')
  const navigator = { getGamepads: () => [{ connected: true, mapping: 'standard', id: 'Current controller', buttons: [] }] }
  f.root.navigator = navigator
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/gamepad.js'), 'utf8'), { window: f.root })
  f.services.registerService('gamepad', original)
  assert.deepEqual(JSON.parse(JSON.stringify(original.snapshot())), { connected: true, readable: true, id: 'Current controller' })
})

for (const name of ['remoteLink', 'homeBriefing', 'gamepad', 'connection']) {
  test(`${name} retains failed input cleanup and retries before selection`, async () => {
    let failures = 1
    const f = fixture({ subscribe: false, beforeRelease() { if (failures-- > 0) throw Error('Controlled input release failure') } })
    await new Promise(resolve => setImmediate(resolve))
    const original = f.services[name]
    const replacement = { snapshot() {} }
    assert.throws(() => f.services.registerService(name, replacement), /Controlled input release failure/)
    assert.equal(f.services[name], original)
    f.services.registerService(name, original)
    assert.equal(f.services[name], original)
    f.services.registerService(name, replacement)
    assert.equal(f.services[name], replacement)
  })
}


for (const name of ['connection', 'gamepad']) for (const remove of [false, true]) {
  test(`${name} releases restored inputs when current-state notification ${remove ? 'removes' : 'replaces'} the service`, () => {
    const f = fixture({ subscribe: false })
    const original = f.services[name], replacement = { snapshot() {} }
    f.services.registerService(name, replacement)
    if (name === 'gamepad') {
      f.root.navigator = { getGamepads: () => [] }
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/core/gamepad.js'), 'utf8'), { window: f.root })
    }
    let restoring = false, updates = 0
    const release = original.subscribe(() => {
      updates++
      if (!restoring) return
      if (remove) f.services.unregisterService(name)
      else f.services.registerService(name, replacement)
    })
    restoring = true
    f.services.registerService(name, original)
    assert.equal(f.services[name], remove ? null : replacement)
    for (const event of name === 'connection' ? ['online', 'offline'] : ['odk-gamepad-state']) {
      assert.equal(f.events.has(event), false, 'Synchronous selection must release the newly acquired default listener')
    }
    assert.equal(updates, 2)
    release()
  })
}
