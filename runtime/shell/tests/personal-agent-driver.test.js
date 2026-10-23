const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

const { createPersonalAgentDriver } = require('../src/personal-agent-driver')
const { projectPersonalAgentFrame } = require('../src/personal-agent-frame')
const fixture = require('./fixtures/personal-agent-v1.json')
const { androidPath } = require('./helpers/repo-root')

const fixtureFile = path.join(__dirname, 'fixtures', 'personal-agent-v1.json')

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'odk-personal-agent-driver-'))
}

test('the source starts on the first shared fixture state', async () => {
  const driver = createPersonalAgentDriver({ fixtureFile, intervalMs: 0 })
  try {
    assert.deepEqual(driver.stateNames, Object.keys(fixture.states))
    const seen = []
    const release = driver.subscribe((status) => seen.push(status.state))
    assert.equal(seen.length, 1, 'a reader receives the current state at once')
    assert.equal(seen[0], Object.keys(fixture.states)[0])
    release()
    assert.equal((await driver.snapshot()).state, Object.keys(fixture.states)[0])
  } finally {
    driver.stop()
  }
})

test('a selection file names the state the phone shows', async () => {
  const dir = tempDir()
  const selectedFile = path.join(dir, 'selected')
  const driver = createPersonalAgentDriver({ fixtureFile, selectedFile })
  try {
    const seen = []
    driver.subscribe((status) => seen.push(status))
    driver.start()
    const waitFor = async (predicate, reason) => {
      const deadline = Date.now() + 2000
      while (Date.now() < deadline) {
        if (predicate(seen.at(-1))) return
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.fail(reason)
    }

    fs.writeFileSync(selectedFile, 'remote-coverage\n')
    await waitFor((status) => status?.remote?.state === 'stale', 'the selected state never arrived')
    assert.equal(seen.length >= 2, true, 'a selection must publish a new state')

    // An unknown name must not change what the phone shows.
    fs.writeFileSync(selectedFile, 'not-a-state\n')
    await new Promise((resolve) => setTimeout(resolve, 700))
    assert.equal(seen.at(-1).remote?.state, 'stale')
  } finally {
    driver.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a submitted turn is echoed as development state and then answered', async () => {
  const dir = tempDir()
  const selectedFile = path.join(dir, 'selected')
  fs.writeFileSync(selectedFile, 'idle-empty\n')
  const driver = createPersonalAgentDriver({ fixtureFile, selectedFile, replyDelayMs: 20 })
  try {
    driver.start()
    const seen = []
    driver.subscribe((status) => seen.push(status))
    const receipt = await driver.sendText('Summarise the desk')
    assert.equal(receipt, true, 'the source answers the boolean receipt the resident answers')
    assert.equal(seen.at(-1).state, 'thinking')
    assert.equal(seen.at(-1).transcript, 'Summarise the desk')
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(seen.at(-1).state, 'idle')
    assert.equal(seen.at(-1).transcript, 'Summarise the desk')
    assert.equal(seen.at(-1).message, fixture.states['idle-reply'].message)
  } finally {
    driver.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('every fixture state survives the link projection unchanged', () => {
  // The development source exists to show a design, so a reviewed state must not
  // reach the phone as a degraded unavailable frame.
  for (const [name, state] of Object.entries(fixture.states)) {
    assert.deepEqual(projectPersonalAgentFrame(state), state, name + ' must survive the link projection')
  }
})

test('a selection file that already names a state still follows later changes', async () => {
  const dir = tempDir()
  const selectedFile = path.join(dir, 'selected')
  fs.writeFileSync(selectedFile, 'recording\n')
  const driver = createPersonalAgentDriver({ fixtureFile, selectedFile })
  try {
    driver.start()
    assert.equal((await driver.snapshot()).state, 'recording', 'the starting state comes from the selection file')
    const seen = []
    driver.subscribe((status) => seen.push(status))
    fs.writeFileSync(selectedFile, 'remote-coverage\n')
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && seen.at(-1)?.remote?.state !== 'stale') {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(seen.at(-1)?.remote?.state, 'stale', 'a later selection must reach the phone without another event')
  } finally {
    driver.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an owner turn is not replaced by the selection file', async () => {
  const dir = tempDir()
  const selectedFile = path.join(dir, 'selected')
  fs.writeFileSync(selectedFile, 'recording\n')
  const driver = createPersonalAgentDriver({ fixtureFile, selectedFile, replyDelayMs: 40 })
  try {
    driver.start()
    const seen = []
    driver.subscribe((status) => seen.push(status))
    // The operator moves the selection file and then sends a turn. The desk reads
    // the current state when the receipt arrives, and that read must not apply a
    // pending selection over the turn the owner just sent.
    fs.writeFileSync(selectedFile, 'remote-coverage\n')
    await driver.sendText('Summarise the desk')
    await driver.snapshot()
    assert.equal(seen.at(-1).state, 'thinking', 'the turn is what the phone shows')
    await new Promise((resolve) => setTimeout(resolve, 160))
    assert.equal(seen.at(-1).state, 'idle')
    assert.equal(seen.at(-1).transcript, 'Summarise the desk', 'the answer belongs to the submitted turn')
  } finally {
    driver.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a fixture without states is refused instead of starting empty', () => {
  const dir = tempDir()
  const empty = path.join(dir, 'empty.json')
  fs.writeFileSync(empty, JSON.stringify({ protocol: 1, states: {} }))
  try {
    assert.throws(() => createPersonalAgentDriver({ fixtureFile: empty }), /holds no states/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the development source refuses a bound reply it cannot prove', async () => {
  const driver = createPersonalAgentDriver({ fixtureFile })
  const before = await driver.snapshot()
  const ref = { messageId: 'a'.repeat(64), sourceKey: 'source', sourceRevision: 'b'.repeat(64) }
  assert.equal(await driver.sendText('continue', ref), false)
  assert.deepEqual(await driver.snapshot(), before)
  driver.stop()
})

test('the Android message shim preserves reply references and declares text-only input', async () => {
  const vm = require('node:vm')
  const sent = []
  const native = { postMessage(raw) { sent.push(JSON.parse(raw)) } }
  const window = { ODKAndroid: native }
  const timers = new Map(); let nextTimer = 0
  vm.runInNewContext(fs.readFileSync(androidPath('app/src/main/assets/host/odk-bridge.js', __dirname), 'utf8'), {
    window, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id }, clearTimeout(id) { timers.delete(id) },
  })
  const ref = { messageId: 'a'.repeat(64), sourceKey: 'original', sourceRevision: 'b'.repeat(64) }
  const pending = window.odkPersonalBot.sendText('exact text', ref)
  assert.deepEqual(sent[0].args, ['exact text', ref])
  assert.equal(sent[0].method, 'sendText')
  assert.equal(window.odkPersonalBot.supportsReplyTo, true)
  assert.equal(window.odkPersonalBot.supportsVoiceInput, false)
  native.onmessage({ data: JSON.stringify({ id: sent[0].id, result: { accepted: true } }) })
  assert.equal((await pending).accepted, true)
  assert.equal(timers.size, 0)
})

test('the Android native boundary uses only platform main-frame facts for requests and status', () => {
  const activity = fs.readFileSync(androidPath('app/src/main/kotlin/com/odk/shell/ShellActivity.kt', __dirname), 'utf8')
  assert.ok(!activity.includes('addJavascriptInterface'))
  assert.ok(activity.includes('WebViewCompat.addWebMessageListener'))
  assert.ok(activity.includes('permitsDocument(view === shell, isMainFrame, origin.toString(), shell.url)'))
  assert.ok(activity.includes('request.isForMainFrame && request.url.toString() != SHELL_URL'))
  assert.ok(activity.includes('if (url != SHELL_URL) { view.stopLoading(); return }'))
  const delivery = activity.slice(activity.indexOf('    private fun deliverToRenderer('), activity.indexOf('    /** A transient bar'))
  assert.ok(delivery.includes('val epoch = documentEpoch'))
  assert.ok(delivery.includes('epoch == documentEpoch && shell.url == SHELL_URL'))
})


test('Android verification selects the exact package process and its own forward', async () => {
  const { ownedDevtoolsSocket, ownedShellPage } = await import('../scripts/lib/android-webview-cdp.mjs')
  assert.equal(ownedDevtoolsSocket('@webview_devtools_remote_12 @webview_devtools_remote_99999', '12'), 'webview_devtools_remote_12')
  assert.throws(() => ownedDevtoolsSocket('@webview_devtools_remote_99999', '12'))
  assert.throws(() => ownedDevtoolsSocket('@webview_devtools_remote_12', '12 13'))
  const page = { type: 'page', url: 'https://appassets.androidplatform.net/assets/web/renderer/index.html', webSocketDebuggerUrl: 'ws://localhost:9229/devtools/page/1' }
  assert.equal(ownedShellPage([page, { ...page, url: 'https://foreign/renderer/index.html' }], 9229), page)
  assert.throws(() => ownedShellPage([page, page], 9229))
  assert.throws(() => ownedShellPage([{ ...page, webSocketDebuggerUrl: 'ws://foreign:9229/page' }], 9229))
  assert.ok(!fs.readFileSync(path.join(__dirname, 'personal-agent-parity-gate.mjs'), 'utf8').includes("'--remove-all'"))
})

test('cross-capability parity preserves busy and unavailable control boundaries', () => {
  const { compareParity } = require('./helpers/personal-agent-parity')
  const box = { x: 0, y: 0, w: 100, h: 44 }
  for (const state of ['idle', 'error', 'starting', 'sending', 'recording', 'transcribing', 'thinking', 'unavailable']) {
    const busy = ['starting', 'sending', 'recording', 'transcribing', 'thinking'].includes(state)
    const reading = voiceInput => ({
      viewport: { width: 480, height: 853 }, theme: 'instrument', agentPanelPresent: true,
      requestState: state, panel: box, identity: { box, name: 'Agent', state, label: state },
      composer: { box, placeholder: 'Message…', insidePanel: true, mode: voiceInput ? 'voice' : 'keyboard' },
      voiceInput, controls: {
        mic: { box, hidden: false, disabled: !voiceInput || (busy && state !== 'recording'), label: 'Voice control' },
        send: { box, hidden: voiceInput, disabled: busy || state === 'unavailable' },
      }, empty: '', messages: [], children: [], statusPanel: { visible: false }, overflow: [],
      conversation: { scrollHeight: 100, clientHeight: 100 },
    })
    const speaking = reading(true), silent = reading(false)
    assert.deepEqual(compareParity(speaking, silent), [], state)
    assert.deepEqual(compareParity(silent, speaking), [], `${state}: capability order is symmetric`)
    for (const [host, control] of [['voice', 'mic'], ['silent', 'send']]) {
      const one = structuredClone(speaking), other = structuredClone(silent)
      const mutated = host === 'voice' ? one : other
      mutated.controls[control].disabled = !mutated.controls[control].disabled
      assert.ok(compareParity(one, other).some(row => row.label === `controls.${control}.disabled.${host}Host`), `${state}: wrong ${host} ${control} state must fail`)
    }
    const unsupported = structuredClone(silent)
    unsupported.controls.mic.disabled = false
    assert.ok(compareParity(speaking, unsupported).some(row => row.label === 'controls.mic.disabled.silentHost'), `${state}: a text-only host cannot enable its microphone`)
  }
})


test('the Android projection carries bounded readable suggestions without response authority', () => {
  const p = { id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'soil', status: 'pending', advice: 'Inspect the soil.', reason: 'A current soil reading is low.', offered: true, presented: false, action: { tool: 'memory_update', params: { value: 'private action' } }, confirmation: 'private confirmation', result: 'PRIVATE_TOOL_RESULT', evidence: [{ readingId: 'hydra', field: 'soil', value: 10, state: 'live', measuredAt: '2026-10-23T00:00:00Z' }] }
  const projected = projectPersonalAgentFrame({ state: 'idle', proposals: [p], proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  assert.equal(projected.proposals[0].advice, p.advice)
  assert.equal(projected.proposals[0].reason, p.reason)
  assert.deepEqual(projected.proposals[0].evidence, p.evidence)
  assert.deepEqual(projected.proposalCapabilities, { read: true, respond: false, acknowledge: false })
  assert.equal(projected.proposals[0].action, null)
  assert.equal(projected.proposals[0].confirmation, '')
  assert.equal(projected.proposalPopup, true)
  assert.equal(JSON.stringify(projected).includes('private action'), false)
  assert.equal(JSON.stringify(projected).includes('PRIVATE_TOOL_RESULT'), false)
})
