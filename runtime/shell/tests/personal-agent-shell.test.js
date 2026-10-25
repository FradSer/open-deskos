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
  await exposed.odkPersonalAgent.toggle()
  await exposed.odkPersonalAgent.cancelRecording()
  await exposed.odkPersonalAgent.getStatus()
  assert.deepEqual(calls, ['odk-personal-agent-toggle', 'odk-personal-agent-cancel', 'odk-personal-agent-status'])
  let state
  const unsubscribe = exposed.odkPersonalAgent.subscribe((update) => { state = update.state })
  listeners.get('odk-personal-agent-status')(null, { state: 'recording' })
  assert.equal(state, 'recording')
  unsubscribe()
  assert.equal(listeners.size, 0)
  let micCalls = 0
  const stopMic = exposed.odkPersonalAgent.onMic((...args) => {
    assert.equal(args.length, 0, 'MIC exposes no IPC event or payload')
    micCalls += 1
  })
  listeners.get('odk-personal-agent-mic')({ sender: 'private' }, { ignored: true })
  assert.equal(micCalls, 1)
  stopMic()
  assert.equal(listeners.size, 0)
})

function feedbackHarness(toggle = async () => ({ accepted: true })) {
  let listener
  let micListener
  let toggles = 0
  const documentListeners = new Map()
  const elements = Object.fromEntries([
    '.personal-agent-status-content',
    '.personal-agent-status-heading',
    '.personal-agent-status-input',
    '.personal-agent-status-transcript',
    '.personal-agent-status-stage',
    '.personal-agent-status-icon',
    '.personal-agent-status-title',
    '.personal-agent-status-detail',
    '.personal-agent-status-progress',
    '.personal-agent-status-level',
    '.personal-agent-status-level span',
  ].map((selector) => [selector, { textContent: '', hidden: false, dataset: {}, setAttribute() {}, focus() {}, addEventListener(type, fn) { this[type] = fn }, style: { setProperty() {} } }]))
  const node = {
    hidden: true,
    dataset: {},
    setAttribute() {},
    addEventListener() {},
    querySelector(selector) {
      return elements[selector]
    },
  }
  const window = {
    addEventListener() {}, dispatchEvent() {},
    odkPersonalAgentReply: { render: (target, message) => { target.textContent = message } },
    odkPersonalAgent: {
      subscribe: (fn) => { listener = fn },
      onMic: (fn) => { micListener = fn },
      toggle: () => { toggles += 1; return toggle() },
    },
  }
  vm.runInNewContext(fs.readFileSync('src/renderer/core/personal-agent-status.js', 'utf8'), {
    document: { querySelector: () => null, getElementById: () => node, body: { children: [] }, hidden: false,
      addEventListener: (type, handler) => documentListeners.set(type, handler),
      removeEventListener: (type, handler) => { if (documentListeners.get(type) === handler) documentListeners.delete(type) },
    },
    CustomEvent: class {},
    window,
  })
  return { window, node, elements, listener, mic: () => micListener(), toggles: () => toggles }
}

test('voice feedback reuses one structured instrument and safely renders service messages', async () => {
  const { window, node, elements, listener } = feedbackHarness()
  assert.equal(window.odkPersonalAgentStatus.close(), false, 'Hidden feedback must not consume Back')
  for (const state of ['idle', 'unavailable', 'error']) {
    listener({ state, message: 'Previous status' })
    assert.equal(node.hidden, true, `${state} must not open background feedback`)
  }
  listener({ state: 'unavailable', activated: true })
  assert.equal(node.hidden, false)
  assert.equal(window.odkPersonalAgentStatus.close(), true)
  assert.equal(node.hidden, true)
  listener({ state: 'starting' })
  assert.equal(elements['.personal-agent-status-stage'].textContent, 'Preparing')
  assert.equal(elements['.personal-agent-status-icon'].dataset.stateIcon, 'microphone')
  assert.equal(elements['.personal-agent-status-title'].hidden, true)
  assert.equal(node.hidden, false)
  listener({ state: 'recording' })
  assert.equal(node.hidden, false)
  assert.equal(elements['.personal-agent-status-stage'].textContent, 'Listening')
  assert.equal(elements['.personal-agent-status-detail'].textContent, '')
  assert.equal(elements['.personal-agent-status-detail'].hidden, true)
  assert.equal(elements['.personal-agent-status-level'].hidden, false)
  assert.equal(elements['.personal-agent-status-level span'].style.width, '0%')
  listener({ state: 'recording', level: 0.04, message: 'Press MIC again' })
  assert.equal(elements['.personal-agent-status-detail'].textContent, '')
  assert.equal(elements['.personal-agent-status-level span'].style.width, '20%')
  listener({ state: 'recording' })
  assert.equal(elements['.personal-agent-status-level span'].style.width, '0%')
  listener({ state: 'thinking' })
  assert.equal(elements['.personal-agent-status-stage'].textContent, 'Working')
  assert.equal(elements['.personal-agent-status-title'].hidden, true)
  assert.equal(elements['.personal-agent-status-detail'].hidden, true)
  assert.equal(elements['.personal-agent-status-progress'].hidden, false)
  const transcript = '**Literal** <script>bad</script> 测试'
  listener({ state: 'thinking', transcript, message: '**Partial** response' })
  assert.equal(elements['.personal-agent-status-transcript'].textContent, transcript)
  assert.equal(elements['.personal-agent-status-input'].hidden, false)
  assert.equal(elements['.personal-agent-status-title'].textContent, '**Partial** response')
  assert.equal(elements['.personal-agent-status-detail'].hidden, true)
  listener({ state: 'error', transcript, message: '<script>bad</script>' })
  assert.equal(elements['.personal-agent-status-transcript'].textContent, transcript)
  assert.equal(elements['.personal-agent-status-title'].textContent, '')
  assert.equal(elements['.personal-agent-status-title'].hidden, true)
  assert.match(elements['.personal-agent-status-detail'].textContent, /^<script>bad<\/script>/)
  assert.match(elements['.personal-agent-status-detail'].textContent, /configuration.*try again/i)
  assert.equal(elements['.personal-agent-status-stage'].textContent, 'Needs attention')
  assert.equal(elements['.personal-agent-status-icon'].dataset.stateIcon, 'alert-triangle')
  listener({ state: 'unavailable', message: 'Personal Agent service unavailable' })
  assert.match(elements['.personal-agent-status-detail'].textContent, /service.*configuration/i)
  listener({ state: 'idle', transcript, message: 'Request complete' })
  assert.equal(elements['.personal-agent-status-transcript'].textContent, transcript)
  assert.equal(node.hidden, false)
  assert.equal(elements['.personal-agent-status-title'].textContent, 'Request complete')
  assert.equal(elements['.personal-agent-status-heading'].hidden, true)
  assert.equal(elements['.personal-agent-status-stage'].textContent, '')
  assert.equal(elements['.personal-agent-status-icon'].dataset.stateIcon, '')
  assert.equal(elements['.personal-agent-status-progress'].hidden, true)
  listener({ state: 'idle', transcript, message: 'Request complete', notifications: [{ id: 'ride-1', message: '司机已接单' }] })
  assert.equal(elements['.personal-agent-status-title'].textContent, 'Request complete\n\n司机已接单', 'the voice surface preserves separate notification content')
  window.odkPersonalAgentStatus.close()
  listener({ state: 'idle', message: 'Request complete' })
  assert.equal(node.hidden, true)
  for (const state of ['starting', 'recording', 'transcribing']) {
    listener({ state, transcript: 'Old input', message: 'Old response' })
    assert.equal(elements['.personal-agent-status-input'].hidden, true)
    assert.equal(elements['.personal-agent-status-transcript'].textContent, '')
    assert.equal(elements['.personal-agent-status-title'].textContent, '')
  }
  assert.equal(node.hidden, false)
  window.odkPersonalAgentStatus.close()
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
    elements['.personal-agent-status-content'].scrollTop = 100
    window.odkPersonalAgentStatus.close()
    listener({ state, message: 'Latest **reply** update', transcript: 'Recognized input' })
    assert.equal(node.hidden, true, 'Background snapshots never reopen dismissed feedback')
    await mic()
    assert.equal(node.hidden, false)
    assert.equal(node.dataset.state, state)
    assert.equal(elements['.personal-agent-status-content'].scrollTop, 100)
    assert.equal(toggles(), 0, 'First MIC only restores')
    if (['thinking', 'idle', 'error'].includes(state)) {
      assert.equal(elements['.personal-agent-status-transcript'].textContent, 'Recognized input')
    }
    await window.odkPersonalAgentStatus.mic()
    assert.equal(toggles(), ['recording', 'idle', 'error'].includes(state) ? 1 : 0)
  })
}

test('idle reconnect during hidden startup cannot reopen subsequent recording', async () => {
  const { window, node, listener, mic, toggles } = feedbackHarness()
  listener({ state: 'starting' })
  window.odkPersonalAgentStatus.close()
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
  assert.match(elements['.personal-agent-status-detail'].textContent, /try again/i)
  const retry = window.odkPersonalAgentStatus.mic()
  assert.equal(toggles(), 2)
  window.odkPersonalAgentStatus.close()
  reject(new Error('IPC unavailable'))
  await retry
  assert.equal(node.hidden, true, 'A rejected pending command cannot undo Back')
})


test('refused MIC receipts preserve service failures and report refusals without a service frame', async () => {
  for (const state of ['idle', 'error', 'unavailable']) {
    const { window, node, elements, listener } = feedbackHarness(async () => ({ accepted: false }))
    listener({ state, activated: true, message: state === 'error' ? 'Service failed' : '' })
    assert.equal((await window.odkPersonalAgentStatus.mic()).accepted, false)
    assert.equal(node.dataset.state, state === 'idle' ? 'error' : state)
    const detail = elements['.personal-agent-status-detail'].textContent
    assert.match(detail, state === 'unavailable' ? /service.*configuration/i : state === 'error' ? /Service failed/ : /Unable to control recording/)
  }
})

// This DOM surface only mounts the real plugin and dispatches public events.
// Production code owns the requests, revision checks and cleanup behavior.
function nativeConfigPageHarness(configure, openAuthUrl = async () => true) {
  const elements = new Map(), cleanups = []
  const document = { hidden: false, activeElement: null, addEventListener() {}, removeEventListener() {}, getElementById() { return null } }
  function element(key = '') {
    if (elements.has(key)) return elements.get(key)
    const handlers = new Map()
    const node = {
      value: '', textContent: '', hidden: key === '.agent-pi-form', disabled: false,
      dataset: {}, childNodes: [], children: [], scrollHeight: 46, scrollTop: 0,
      style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { this[name] = value }, removeAttribute(name) { delete this[name] },
      focus() { document.activeElement = this }, contains(target) { return target === this },
      addEventListener(type, handler) { handlers.set(type, handler) },
      removeEventListener(type, handler) { if (handlers.get(type) === handler) handlers.delete(type) },
      querySelector(selector) { return element(`${key} ${selector}`) }, querySelectorAll() { return [] },
      replaceChildren(...children) { this.children = this.childNodes = children; this.value = children[0]?.value || '' },
      append(...children) { this.children.push(...children) }, prepend(child) { this.children.unshift(child) },
      remove() {}, scrollTo() {}, getBoundingClientRect() { return { top: 0, bottom: 46, width: 320, height: 46 } },
      fire(type) { return handlers.get(type)?.({ target: this, key: '', preventDefault() {}, stopPropagation() {} }) },
    }
    elements.set(key, node)
    return node
  }
  document.createElement = tag => element(`created-${tag}-${elements.size}`)
  let plugin
  const window = {
    document, addEventListener() {}, removeEventListener() {},
    odkPlugins: { register(value) { plugin = value } },
    odkPersonalAgentAvatar: { mount: () => ({ engage() {}, destroy() {}, update() {} }), phaseFor: () => 'idle' },
    odkPersonalAgent: { supportsVoiceInput: false, configure, openAuthUrl,
      subscribe: () => () => {}, getStatus: () => new Promise(() => {}) },
  }
  vm.runInNewContext(fs.readFileSync('src/renderer/plugins/personal-agent.js', 'utf8'), {
    window, document, localStorage: { getItem: () => null }, setTimeout, clearTimeout, TextEncoder,
    getComputedStyle: () => ({ lineHeight: '20', paddingTop: '0', paddingBottom: '0' }),
  })
  const page = element('page')
  page.querySelector = selector => element(selector)
  plugin.mount(page, { trackCleanup: fn => cleanups.push(fn) })
  return {
    element,
    open(mode) { const select = element('.agent-pi-command'); select.value = mode; return select.fire('change') },
    close() { return element('.agent-pi-close').fire('click') },
    release() { for (const fn of [...cleanups].reverse()) fn() },
  }
}
const configSnapshot = id => ({ providers: [], models: [{ provider: 'fixture', id, name: id }], selected: { provider: 'fixture', id }, thinkingLevels: ['off'], thinkingLevel: 'off', busy: false })
const flushConfigPage = async () => { for (let n = 0; n < 6; n++) await Promise.resolve() }

test('native configuration reloads a reopened mode after an older list settles', async () => {
  let resolveOld, resolveNew, lists = 0
  const f = nativeConfigPageHarness(command => {
    if (command.action !== 'list') return Promise.resolve({})
    if (++lists === 1) return new Promise(resolve => { resolveOld = resolve })
    return new Promise(resolve => { resolveNew = resolve })
  })
  try {
    const old = f.open('login')
    f.close()
    const reopened = f.open('model')
    resolveOld(configSnapshot('obsolete-model'))
    await old; await flushConfigPage()
    assert.equal(lists, 2, 'reopened mode must receive its own current list')
    assert.equal(f.element('.agent-pi-command').disabled, true, 'old finally cannot release a newer pending request')
    assert.equal(f.element('.agent-pi-form [type="submit"]').disabled, true)
    resolveNew(configSnapshot('current-model'))
    await reopened; await flushConfigPage()
    assert.equal(f.element('.agent-pi-form').hidden, false)
    assert.equal(f.element('.agent-pi-choice').value, JSON.stringify(['fixture', 'current-model']))
    assert.equal(f.element('.agent-pi-form [type="submit"]').disabled, false)
    assert.doesNotMatch(f.element('.agent-pi-status').textContent, /Loading|obsolete/)
  } finally { f.release() }
})

test('native authentication navigation cannot publish stale results after a mode change or release', async t => {
  for (const outcome of ['false', 'reject']) for (const boundary of ['new-mode', 'release']) await t.test(`${outcome} after ${boundary}`, async () => {
    let settle
    const oldUrl = 'https://provider.example/stale-login'
    const f = nativeConfigPageHarness(async () => ({ ...configSnapshot('current-model'),
      login: { state: 'prompt', event: { url: oldUrl } } }), () => new Promise((resolve, reject) => {
      settle = () => outcome === 'reject' ? reject(Error('Fixture navigation rejected')) : resolve(false)
    }))
    let released = false
    try {
      await f.open('login')
      assert.equal(f.element('.agent-pi-auth-link').hidden, false)
      assert.equal(f.element('.agent-pi-auth-link').href, oldUrl)
      f.element('.agent-pi-auth-link').fire('click')
      if (boundary === 'release') { f.release(); released = true }
      else { f.close(); await f.open('model') }
      const status = f.element('.agent-pi-status'), before = status.textContent
      settle(); await flushConfigPage()
      assert.equal(status.textContent, before, 'superseded navigation must not mutate current or released status')
      assert.ok(!status.textContent.includes(oldUrl), 'old login URL stays out of the current status')
    } finally { if (!released) f.release() }
  })
})
