const test = require('node:test')
const assert = require('node:assert/strict')
const { boundedEvent } = require('../src/desk-link-service')
const { retainEvents } = require('../src/pi-session-events')

test('Desk Link keeps complete Markdown result text and separate tool identity', () => {
  const text = '# Result\n\n| Name | Value |\n| --- | --- |\n| example | 42 |\n\nLast line.'
  assert.deepEqual(boundedEvent({ kind: 'result', toolName: 'bash', text }), { kind: 'result', toolName: 'bash', text })
})

test('Desk Link keeps a bounded Markdown assistant body without flattening it', () => {
  const reply = '# Answer\n\n```js\nconst value = 1\n```\n\nDone.'
  assert.deepEqual(boundedEvent({ kind: 'assistant', text: reply }), { kind: 'assistant', text: reply })
})

test('the shared event contract bounds every kind of body', () => {
  const { MAX_EVENTS, MAX_MESSAGE_BYTES, MAX_RESULT_BYTES, MAX_SESSION_EVENT_BYTES, MAX_THINKING_BYTES, MAX_TOOL_BYTES, MAX_USER_BYTES, BODY_BYTES } = require('../src/pi-session-events')
  assert.equal(MAX_RESULT_BYTES, 64 * 1024)
  assert.equal(MAX_MESSAGE_BYTES, 16 * 1024)
  assert.equal(MAX_USER_BYTES, 8 * 1024)
  assert.equal(MAX_THINKING_BYTES, 4 * 1024)
  assert.equal(MAX_TOOL_BYTES, 4 * 1024)
  assert.equal(MAX_EVENTS, 300)
  assert.equal(MAX_SESSION_EVENT_BYTES, 1024 * 1024)
  assert.deepEqual(Object.keys(BODY_BYTES).sort(), ['assistant', 'result', 'thinking', 'tool', 'user'])
})

// Pi colours a tool box by the outcome it recorded, so the desk carries that
// record rather than guessing one from the event kind. The fields stay optional:
// a reporter that does not send them yields an event without them.
test('Desk Link carries Pi\'s recorded tool outcome and call identity', () => {
  assert.deepEqual(
    boundedEvent({ kind: 'tool', text: 'bash: pnpm test', toolCallId: 'call_1' }),
    { kind: 'tool', text: 'bash: pnpm test', toolCallId: 'call_1' })
  assert.deepEqual(
    boundedEvent({ kind: 'result', toolName: 'bash', toolCallId: 'call_1', isError: true, text: 'exit code 1' }),
    { kind: 'result', toolName: 'bash', toolCallId: 'call_1', isError: true, text: 'exit code 1' })
  assert.deepEqual(
    boundedEvent({ kind: 'result', toolName: 'bash', toolCallId: 'call_1', isError: false, text: 'ok' }),
    { kind: 'result', toolName: 'bash', toolCallId: 'call_1', text: 'ok' })
  assert.deepEqual(boundedEvent({ kind: 'user', text: 'prompt', isError: true }), { kind: 'user', text: 'prompt' })
  // The identity belongs to the kinds Pi writes it for, not to every event.
  assert.deepEqual(
    boundedEvent({ kind: 'assistant', text: 'reply', toolCallId: 'call_1' }),
    { kind: 'assistant', text: 'reply' })
})

// The desk no longer flattens anything: a prompt, a thought, and a bash command
// keep the lines Pi produced so the page reads them the way Pi does.
test('Desk Link keeps user, thinking, and tool bodies with their own lines', () => {
  assert.deepEqual(boundedEvent({ kind: 'user', text: 'prompt one\nprompt two' }), { kind: 'user', text: 'prompt one\nprompt two' })
  assert.deepEqual(boundedEvent({ kind: 'thinking', text: 'idea\nmore idea' }), { kind: 'thinking', text: 'idea\nmore idea' })
  const command = "python3 - <<'PY'\nprint('one')\nPY"
  assert.deepEqual(boundedEvent({ kind: 'tool', text: `bash: ${command}` }), { kind: 'tool', text: `bash: ${command}` })
  const long = boundedEvent({ kind: 'user', text: 'x'.repeat(500) })
  assert.equal(long.text, 'x'.repeat(500), 'well under the 8 KiB user bound')
  assert.equal(long.truncated, undefined)
})

test('an over-limit body is bounded per kind with an explicit truncation flag', () => {
  for (const [kind, limit] of [['user', 8 * 1024], ['thinking', 4 * 1024], ['tool', 4 * 1024], ['assistant', 16 * 1024], ['result', 64 * 1024]]) {
    const event = boundedEvent({ kind, text: 'x'.repeat(limit + 1024) })
    assert.equal(event.truncated, true, kind)
    assert.ok(Buffer.byteLength(event.text) <= limit, kind)
  }
})

test('retained bodies stay within the per-session memory budget', () => {
  const events = Array.from({ length: 60 }, (_, index) => boundedEvent({ kind: 'result', text: `${index}:` + 'x'.repeat(65536) }))
  const retained = retainEvents(events)
  assert.equal(retained.length, 16)
  assert.ok(retained.reduce((sum, event) => sum + Buffer.byteLength(event.text), 0) <= 1024 * 1024)
  assert.ok(retained.at(-1).text.startsWith('59:'))
})

test('retention keeps a long working session rather than a few dozen events', () => {
  const events = Array.from({ length: 500 }, (_, index) => boundedEvent({ kind: 'tool', text: `bash: step ${index}` }))
  const retained = retainEvents(events)
  assert.equal(retained.length, 300)
  assert.equal(retained[0].text, 'bash: step 200')
  assert.equal(retained.at(-1).text, 'bash: step 499')
})

test('all text parts of a result remain in one Markdown body', () => {
  const { readSessionEvents } = require('../src/pi-sessions')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-result-parts-'))
  try {
    const dir = path.join(agentDir, 'sessions', '--example--')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'part-session.jsonl'), JSON.stringify({ type: 'message', message: { role: 'toolResult', toolName: 'example', content: [
      { type: 'text', text: '# Part one' }, { type: 'image', data: 'not-transmitted' }, { type: 'text', text: '| A | B |\n| --- | --- |\n| 1 | 2 |' },
    ] } }))
    const result = readSessionEvents({ agentDir, cwd: '/example', sessionId: 'part-session' })
    assert.deepEqual(result.events, [{ kind: 'result', toolName: 'example', text: '# Part one\n\n| A | B |\n| --- | --- |\n| 1 | 2 |' }])
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('a result beyond the local tail limit is unavailable rather than a false empty stream', () => {
  const { readSessionEvents } = require('../src/pi-sessions')
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-result-tail-'))
  try {
    const dir = path.join(agentDir, 'sessions', '--example--')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'huge-session.jsonl'), JSON.stringify({ type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'x'.repeat(2 * 1024 * 1024 + 1000) }] } }))
    const result = readSessionEvents({ agentDir, cwd: '/example', sessionId: 'huge-session' })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'session-log-tail-limit')
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('plugin IPC routes local and reported events through the tested source seam', async () => {
  const { createPluginHost } = require('../src/plugin-host')
  const { createDataSourcePlugins } = require('../src/plugins/data-sources')
  const { createPiSessionEventsSource } = require('../src/pi-session-events-source')
  const handlers = new Map()
  const calls = []
  const reported = { ok: true, events: [{ kind: 'result', text: 'Reported result' }] }
  const local = { ok: true, events: [{ kind: 'result', text: 'Local result' }] }
  let reply = reported
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'source.desk-link': { create: () => ({ sessionEvents: async (...args) => { calls.push(args); return reply } }) },
    'source.pi-events': { create: options => createPiSessionEventsSource({ ...options, readLocal: request => { calls.push(request); return local } }) },
  } })
  for (const plugin of createDataSourcePlugins().filter(def => ['odk.source.desk-link', 'odk.source.pi-events'].includes(def.manifest.id))) host.register(plugin)
  await host.start()
  const invoke = handlers.get('odk-pi-session-events')
  assert.equal(await invoke(null, { cwd: '/project', sessionId: 'reported', hostedPi: true }), reported)
  assert.equal(calls[0][1].signal instanceof AbortSignal, true)
  const { signal: reportedSignal, ...reportedOptions } = calls[0][1]
  assert.deepEqual([calls[0][0], reportedOptions], ['reported', { hostedPi: true }])
  reply = { ok: false, reason: 'desk-link-unavailable' }
  assert.equal(await invoke(null, { cwd: '/project', sessionId: 'local', hostedPi: false }), local)
  assert.equal(calls[1][1].signal instanceof AbortSignal, true)
  const { signal: localSignal, ...localOptions } = calls[1][1]
  assert.deepEqual([[calls[1][0], localOptions], calls[2]], [['local', { hostedPi: false }], { cwd: '/project', sessionId: 'local', hostedPi: false }])
  await host.stop()
  assert.equal(reportedSignal.aborted, true)
  assert.equal(localSignal.aborted, true)
  assert.equal(handlers.size, 0)
})

test('Desk Link result truncation is explicit and UTF-8 bounded', () => {
  const event = boundedEvent({ kind: 'result', text: '中'.repeat(30000), toolName: 'read' })
  assert.equal(event.truncated, true)
  assert.ok(Buffer.byteLength(event.text) <= 65536)
  assert.ok(event.text.length > 200)
  assert.equal(event.text.includes('\uFFFD'), false)
  assert.equal(boundedEvent({ kind: 'result', text: 'already bounded', truncated: true }).truncated, true)
})

test('Desk Link assistant truncation is explicit and UTF-8 bounded', () => {
  const event = boundedEvent({ kind: 'assistant', text: '中'.repeat(20000) })
  assert.equal(event.truncated, true)
  assert.ok(Buffer.byteLength(event.text) <= 16 * 1024)
  assert.ok(event.text.length > 200)
  assert.equal(event.text.includes('\uFFFD'), false)
  assert.equal(boundedEvent({ kind: 'assistant', text: 'already bounded', truncated: true }).truncated, true)
})
