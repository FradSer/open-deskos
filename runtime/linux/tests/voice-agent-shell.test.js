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

test('voice feedback shows recording instructions and uses text, not HTML, for service messages', () => {
  let listener
  const node = { hidden: true, dataset: {}, textContent: '' }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/voice-status.js', 'utf8'), {
    document: { getElementById: () => node },
    window: { odkVoice: { subscribe: (fn) => { listener = fn } } },
  })
  listener({ state: 'recording' })
  assert.equal(node.hidden, false)
  assert.match(node.textContent, /MIC.*stop/i)
  listener({ state: 'error', message: '<script>bad</script>' })
  assert.match(node.textContent, /<script>bad<\/script>/)
  listener({ state: 'idle' })
  assert.equal(node.hidden, true)
})
