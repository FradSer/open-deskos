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
  const title = { textContent: '' }
  const detail = { textContent: '' }
  const meter = { hidden: true }
  const node = {
    hidden: true,
    dataset: {},
    classList: { add() {}, remove() {} },
    querySelector(selector) {
      return { '.voice-status-title': title, '.voice-status-detail': detail, '.voice-status-meter': meter }[selector]
    },
  }
  const calls = []
  vm.runInNewContext(fs.readFileSync('src/renderer/core/voice-status.js', 'utf8'), {
    document: { getElementById: () => node },
    window: { odkVoice: {
      subscribe: (fn) => { listener = fn },
      toggle: async () => { calls.push('toggle'); return { accepted: true } },
    } },
  })
  listener({ state: 'starting' })
  assert.equal(title.textContent, 'Starting Voice Agent')
  assert.equal(node.hidden, false)
  listener({ state: 'recording' })
  assert.equal(node.hidden, false)
  assert.match(title.textContent, /Listening/i)
  assert.match(detail.textContent, /MIC.*stop/i)
  listener({ state: 'thinking' })
  assert.equal(meter.hidden, false)
  listener({ state: 'error', message: '<script>bad</script>' })
  assert.equal(detail.textContent, '<script>bad</script>')
  listener({ state: 'idle', message: 'Request complete' })
  assert.equal(node.hidden, false)
  assert.equal(title.textContent, 'Complete')
  listener({ state: 'idle' })
  assert.equal(node.hidden, true)
  assert.equal(calls.length, 0)
})
