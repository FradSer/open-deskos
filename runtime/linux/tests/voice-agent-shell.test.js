const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('voice preload exposes bounded control and status separately from monitoring', async () => {
  const exposed = {}
  const calls = []
  const listeners = new Map()
  vm.runInNewContext(fs.readFileSync('src/preload.js', 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } },
      ipcRenderer: {
        invoke: async (channel) => { calls.push(channel); return { state: 'idle' } },
        on: (channel, handler) => listeners.set(channel, handler),
        removeListener: (channel) => listeners.delete(channel),
      },
    }),
  })
  await exposed.odkVoice.toggle()
  await exposed.odkVoice.getStatus()
  assert.deepEqual(calls, ['odk-voice-toggle', 'odk-voice-status'])
  let state
  const unsubscribe = exposed.odkVoice.subscribe((update) => { state = update.state })
  listeners.get('odk-voice-status')(null, { state: 'recording' })
  assert.equal(state, 'recording')
  unsubscribe()
  assert.equal(listeners.size, 0)
})

test('voice feedback reuses one structured instrument and safely renders service messages', async () => {
  let listener
  const elements = Object.fromEntries([
    '.voice-status-dismiss',
    '.voice-status-stage',
    '.voice-status-icon',
    '.voice-status-title',
    '.voice-status-detail',
    '.voice-status-limit',
    '.voice-status-progress',
    '.voice-status-timing',
  ].map((selector) => [selector, { textContent: '', hidden: false, dataset: {}, addEventListener(type, fn) { this[type] = fn }, style: { setProperty() {} } }]))
  const node = {
    hidden: true,
    dataset: {},
    addEventListener() {},
    querySelector(selector) {
      return elements[selector]
    },
  }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/voice-status.js', 'utf8'), {
    document: { getElementById: () => node },
    window: { addEventListener() {}, odkVoice: { subscribe: (fn) => { listener = fn } } },
  })
  for (const state of ['idle', 'unavailable', 'error']) {
    listener({ state, message: 'Previous status' })
    assert.equal(node.hidden, true, `${state} must not open background feedback`)
  }
  listener({ state: 'unavailable', activated: true })
  assert.equal(node.hidden, false)
  elements['.voice-status-dismiss'].click()
  assert.equal(node.hidden, true)
  listener({ state: 'starting' })
  assert.equal(elements['.voice-status-stage'].textContent, 'Preparing')
  assert.equal(elements['.voice-status-icon'].dataset.stateIcon, 'microphone')
  assert.equal(elements['.voice-status-title'].hidden, true)
  assert.equal(node.hidden, false)
  listener({ state: 'recording' })
  assert.equal(node.hidden, false)
  assert.equal(elements['.voice-status-stage'].textContent, 'Listening')
  assert.match(elements['.voice-status-detail'].textContent, /MIC.*send/i)
  assert.equal(elements['.voice-status-limit'].textContent, 'Stops automatically after 30 seconds')
  listener({ state: 'thinking' })
  assert.equal(elements['.voice-status-stage'].textContent, 'Working')
  assert.equal(elements['.voice-status-title'].hidden, true)
  assert.equal(elements['.voice-status-detail'].hidden, true)
  assert.equal(elements['.voice-status-progress'].hidden, false)
  listener({ state: 'error', message: '<script>bad</script>' })
  assert.match(elements['.voice-status-detail'].textContent, /^<script>bad<\/script>/)
  assert.match(elements['.voice-status-detail'].textContent, /configuration.*try again/i)
  assert.equal(elements['.voice-status-stage'].textContent, 'Needs attention')
  assert.equal(elements['.voice-status-icon'].dataset.stateIcon, 'alert-triangle')
  listener({ state: 'unavailable', message: 'Voice service unavailable' })
  assert.match(elements['.voice-status-detail'].textContent, /service.*configuration/i)
  listener({ state: 'idle', message: 'Request complete' })
  assert.equal(node.hidden, false)
  assert.equal(elements['.voice-status-title'].textContent, 'Request complete')
  elements['.voice-status-dismiss'].click()
  listener({ state: 'idle', message: 'Request complete' })
  assert.equal(node.hidden, true)
  listener({ state: 'starting' })
  assert.equal(node.hidden, false)
  elements['.voice-status-dismiss'].click()
  listener({ state: 'recording' })
  listener({ state: 'thinking' })
  listener({ state: 'unavailable' })
  listener({ state: 'thinking' })
  assert.equal(node.hidden, true, 'Reconnect must preserve dismissal')
  listener({ state: 'idle', message: 'New result' })
  assert.equal(node.hidden, true)
  listener({ state: 'starting' })
  listener({ state: 'idle' })
  assert.equal(node.hidden, true)
})
