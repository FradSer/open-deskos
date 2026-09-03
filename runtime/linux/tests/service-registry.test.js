const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const servicesSource = fs.readFileSync('src/renderer/core/services.js', 'utf8')

function setupEnvironment() {
  const root = {
    navigator: { onLine: true },
    odkPlatform: {
      getOpenCodeGoStatus: async () => ({ state: 'available', snapshot: { rollingPct: 15 } }),
      getFaceAgentStatus: async () => ({ state: 'unavailable' }),
    },
  }
  const context = vm.createContext({ window: root, globalThis: root, navigator: root.navigator, console })
  vm.runInContext(servicesSource, context)
  vm.runInContext(registrySource, context)
  return root
}

test('dynamic service registry registers and exports background service interface', () => {
  const root = setupEnvironment()

  let started = false
  let stopped = false
  const listeners = new Set()

  const servicePlugin = {
    id: 'odk.service.audio-transcription',
    manifest: { schemaVersion: 1 },
    kind: 'service',
    start() {
      started = true
    },
    stop() {
      stopped = true
      listeners.clear()
    },
    export() {
      return {
        isTranscribing: () => started && !stopped,
        subscribe: (cb) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
        emitTranscript: (text) => {
          for (const cb of listeners) cb({ text, timestamp: Date.now() })
        },
      }
    },
  }

  root.odkPlugins.register(servicePlugin)
  assert.equal(root.odkPlugins.has('odk.service.audio-transcription'), true)

  const svc = root.odkServices.get('odk.service.audio-transcription')
  assert.ok(svc)
  assert.equal(typeof svc.subscribe, 'function')
  assert.equal(typeof svc.isTranscribing, 'function')
  assert.equal(svc.isTranscribing(), true)
  assert.equal(started, true)

  const transcripts = []
  const unsubscribe = svc.subscribe((event) => transcripts.push(event.text))
  svc.emitTranscript('Hello Open DeskOS')
  assert.deepEqual(transcripts, ['Hello Open DeskOS'])

  unsubscribe()
  svc.emitTranscript('Ignored')
  assert.deepEqual(transcripts, ['Hello Open DeskOS'])

  // Deactivate / stop service
  root.odkPlugins.deactivate(servicePlugin)
  assert.equal(stopped, true)
  assert.equal(svc.isTranscribing(), false)
})

test('core services remain accessible via both legacy ctx properties and dynamic ctx.services.get', () => {
  const root = setupEnvironment()

  assert.ok(root.odkServices.connection)
  assert.ok(root.odkServices.subscription)
  assert.ok(root.odkServices.remoteLink)
  assert.ok(root.odkServices.faceAgent)

  assert.equal(root.odkServices.get('connection'), root.odkServices.connection)
  assert.equal(root.odkServices.get('odk.service.connection'), root.odkServices.connection)
  assert.equal(root.odkServices.get('subscription'), root.odkServices.subscription)
  assert.equal(root.odkServices.get('odk.service.subscription'), root.odkServices.subscription)

  // Plugin context receives scoped ctx.services
  const consumerPlugin = {
    id: 'odk.tile.test-consumer',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    interaction: 'display-only',
    mount(el, ctx) {
      assert.ok(ctx.services)
      assert.equal(typeof ctx.services.get, 'function')
      const conn = ctx.services.get('connection')
      assert.equal(conn, ctx.connection)
    },
  }

  root.odkPlugins.register(consumerPlugin)
  const fakeEl = { innerHTML: '', replaceChildren() {} }
  root.odkPlugins.activate(consumerPlugin, fakeEl, {
    ...root.odkServices,
    onTick: root.odkServices.onTick,
  })
})
