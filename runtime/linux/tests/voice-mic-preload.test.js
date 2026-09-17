const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('preload microphone intent is subscribed and removed without toggling capture', () => {
  const exposed = {}
  const listeners = new Map()
  vm.runInNewContext(fs.readFileSync('src/preload.js', 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api } },
      ipcRenderer: {
        invoke() { assert.fail('Intent must not toggle by itself') },
        on: (channel, handler) => listeners.set(channel, handler),
        removeListener: (channel, handler) => { if (listeners.get(channel) === handler) listeners.delete(channel) },
      },
    }),
  })
  let calls = 0
  const unsubscribe = exposed.odkVoice.onMic(() => { calls++ })
  listeners.get('odk-voice-mic')({})
  assert.equal(calls, 1)
  unsubscribe()
  assert.equal(listeners.has('odk-voice-mic'), false)
})
