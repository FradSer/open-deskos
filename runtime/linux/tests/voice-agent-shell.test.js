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
  let micCalls = 0
  const stopMic = exposed.odkVoice.onMic((...args) => {
    assert.equal(args.length, 0, 'MIC exposes no IPC event or payload')
    micCalls += 1
  })
  listeners.get('odk-voice-mic')({ sender: 'private' }, { ignored: true })
  assert.equal(micCalls, 1)
  stopMic()
  assert.equal(listeners.size, 0)
})

function feedbackHarness(toggle = async () => ({ accepted: true })) {
  let listener
  let micListener
  let toggles = 0
  const elements = Object.fromEntries([
    '.voice-status-content',
    '.voice-status-heading',
    '.voice-status-input',
    '.voice-status-transcript',
    '.voice-status-stage',
    '.voice-status-icon',
    '.voice-status-title',
    '.voice-status-detail',
    '.voice-status-progress',
    '.voice-status-level',
    '.voice-status-level span',
  ].map((selector) => [selector, { textContent: '', hidden: false, dataset: {}, setAttribute() {}, focus() {}, addEventListener(type, fn) { this[type] = fn }, style: { setProperty() {} } }]))
  const node = {
    hidden: true,
    dataset: {},
    addEventListener() {},
    querySelector(selector) {
      return elements[selector]
    },
  }
  const window = {
    addEventListener() {}, dispatchEvent() {},
    odkVoiceReply: { render: (target, message) => { target.textContent = message } },
    odkVoice: {
      subscribe: (fn) => { listener = fn },
      onMic: (fn) => { micListener = fn },
      toggle: () => { toggles += 1; return toggle() },
    },
  }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/voice-status.js', 'utf8'), {
    document: { getElementById: () => node, body: { children: [] } },
    CustomEvent: class {},
    window,
  })
  return { window, node, elements, listener, mic: () => micListener(), toggles: () => toggles }
}

test('voice feedback reuses one structured instrument and safely renders service messages', async () => {
  const { window, node, elements, listener } = feedbackHarness()
  assert.equal(window.odkVoiceStatus.close(), false, 'Hidden feedback must not consume Back')
  for (const state of ['idle', 'unavailable', 'error']) {
    listener({ state, message: 'Previous status' })
    assert.equal(node.hidden, true, `${state} must not open background feedback`)
  }
  listener({ state: 'unavailable', activated: true })
  assert.equal(node.hidden, false)
  assert.equal(window.odkVoiceStatus.close(), true)
  assert.equal(node.hidden, true)
  listener({ state: 'starting' })
  assert.equal(elements['.voice-status-stage'].textContent, 'Preparing')
  assert.equal(elements['.voice-status-icon'].dataset.stateIcon, 'microphone')
  assert.equal(elements['.voice-status-title'].hidden, true)
  assert.equal(node.hidden, false)
  listener({ state: 'recording' })
  assert.equal(node.hidden, false)
  assert.equal(elements['.voice-status-stage'].textContent, 'Listening')
  assert.equal(elements['.voice-status-detail'].textContent, '')
  assert.equal(elements['.voice-status-detail'].hidden, true)
  assert.equal(elements['.voice-status-level'].hidden, false)
  assert.equal(elements['.voice-status-level span'].style.width, '0%')
  listener({ state: 'recording', level: 0.04, message: 'Press MIC again' })
  assert.equal(elements['.voice-status-detail'].textContent, '')
  assert.equal(elements['.voice-status-level span'].style.width, '20%')
  listener({ state: 'recording' })
  assert.equal(elements['.voice-status-level span'].style.width, '0%')
  listener({ state: 'thinking' })
  assert.equal(elements['.voice-status-stage'].textContent, 'Working')
  assert.equal(elements['.voice-status-title'].hidden, true)
  assert.equal(elements['.voice-status-detail'].hidden, true)
  assert.equal(elements['.voice-status-progress'].hidden, false)
  const transcript = '**Literal** <script>bad</script> 测试'
  listener({ state: 'thinking', transcript, message: '**Partial** response' })
  assert.equal(elements['.voice-status-transcript'].textContent, transcript)
  assert.equal(elements['.voice-status-input'].hidden, false)
  assert.equal(elements['.voice-status-title'].textContent, '**Partial** response')
  assert.equal(elements['.voice-status-detail'].hidden, true)
  listener({ state: 'error', transcript, message: '<script>bad</script>' })
  assert.equal(elements['.voice-status-transcript'].textContent, transcript)
  assert.equal(elements['.voice-status-title'].textContent, '')
  assert.equal(elements['.voice-status-title'].hidden, true)
  assert.match(elements['.voice-status-detail'].textContent, /^<script>bad<\/script>/)
  assert.match(elements['.voice-status-detail'].textContent, /configuration.*try again/i)
  assert.equal(elements['.voice-status-stage'].textContent, 'Needs attention')
  assert.equal(elements['.voice-status-icon'].dataset.stateIcon, 'alert-triangle')
  listener({ state: 'unavailable', message: 'Voice service unavailable' })
  assert.match(elements['.voice-status-detail'].textContent, /service.*configuration/i)
  listener({ state: 'idle', transcript, message: 'Request complete' })
  assert.equal(elements['.voice-status-transcript'].textContent, transcript)
  assert.equal(node.hidden, false)
  assert.equal(elements['.voice-status-title'].textContent, 'Request complete')
  assert.equal(elements['.voice-status-heading'].hidden, true)
  assert.equal(elements['.voice-status-stage'].textContent, '')
  assert.equal(elements['.voice-status-icon'].dataset.stateIcon, '')
  assert.equal(elements['.voice-status-progress'].hidden, true)
  window.odkVoiceStatus.close()
  listener({ state: 'idle', message: 'Request complete' })
  assert.equal(node.hidden, true)
  for (const state of ['starting', 'recording', 'transcribing']) {
    listener({ state, transcript: 'Old input', message: 'Old response' })
    assert.equal(elements['.voice-status-input'].hidden, true)
    assert.equal(elements['.voice-status-transcript'].textContent, '')
    assert.equal(elements['.voice-status-title'].textContent, '')
  }
  assert.equal(node.hidden, false)
  window.odkVoiceStatus.close()
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


for (const state of ['starting', 'sending', 'transcribing', 'thinking', 'recording', 'idle', 'error']) {
  test(`MIC restores hidden ${state} before applying visible policy`, async () => {
    const { window, node, elements, listener, mic, toggles } = feedbackHarness()
    listener({ state: 'starting' })
    listener({ state, message: 'Latest **reply**', transcript: 'Recognized input' })
    elements['.voice-status-content'].scrollTop = 100
    window.odkVoiceStatus.close()
    listener({ state, message: 'Latest **reply** update', transcript: 'Recognized input' })
    assert.equal(node.hidden, true, 'Background snapshots never reopen dismissed feedback')
    await mic()
    assert.equal(node.hidden, false)
    assert.equal(node.dataset.state, state)
    assert.equal(elements['.voice-status-content'].scrollTop, 100)
    assert.equal(toggles(), 0, 'First MIC only restores')
    if (['thinking', 'idle', 'error'].includes(state)) {
      assert.equal(elements['.voice-status-transcript'].textContent, 'Recognized input')
    }
    await window.odkVoiceStatus.mic()
    assert.equal(toggles(), ['recording', 'idle', 'error'].includes(state) ? 1 : 0)
  })
}

test('idle reconnect during hidden startup cannot reopen subsequent recording', async () => {
  const { window, node, listener, mic, toggles } = feedbackHarness()
  listener({ state: 'starting' })
  window.odkVoiceStatus.close()
  listener({ state: 'unavailable' })
  listener({ state: 'idle', message: '' })
  listener({ state: 'recording' })
  assert.equal(node.hidden, true)
  await mic()
  assert.equal(node.hidden, false)
  assert.equal(toggles(), 0)
})

for (const state of ['idle', 'error', 'unavailable']) {
  test(`First MIC does not revive an unactivated ${state} snapshot`, async () => {
    const { listener, mic, toggles, node } = feedbackHarness()
    listener({ state, message: 'Historical result', transcript: 'Old input' })
    await mic()
    assert.equal(toggles(), 1)
    assert.equal(node.hidden, true, 'Main status, not historical content, activates feedback')
    listener({ state: state === 'unavailable' ? state : 'starting', activated: true })
    assert.equal(node.hidden, false)
  })
}

test('MIC ignores duplicates until invoke settles, handles rejection, and permits retry', async () => {
  let reject
  const { window, node, elements, listener, mic, toggles } = feedbackHarness(() => new Promise((_, fail) => { reject = fail }))
  listener({ state: 'idle' })
  const pending = mic()
  await mic()
  listener({ state: 'recording' })
  await mic()
  assert.equal(toggles(), 1)
  reject(new Error('IPC unavailable'))
  await pending
  assert.equal(node.hidden, false)
  assert.equal(node.dataset.state, 'error')
  assert.match(elements['.voice-status-detail'].textContent, /try again/i)
  const retry = window.odkVoiceStatus.mic()
  assert.equal(toggles(), 2)
  window.odkVoiceStatus.close()
  reject(new Error('IPC unavailable'))
  await retry
  assert.equal(node.hidden, true, 'A rejected pending command cannot undo Back')
})
