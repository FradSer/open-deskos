const test = require('node:test')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

const { createPersonalAgentDriver } = require('../src/personal-agent-driver')
const { projectPersonalAgentFrame } = require('../src/personal-agent-frame')
const fixture = require('./fixtures/personal-agent-v1.json')

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