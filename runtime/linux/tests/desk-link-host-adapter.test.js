const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  resolveHostedPiSocketPath,
  taskRequest,
  normalizeTask,
  normalizeHistory,
  normalizeEvent,
  sessionEventsFromEntry,
} = require('../src/desk-link-host-adapter')

// The host publishes its socket where the desk's Console path can find it without reading the host's
// private configuration, so the adapter resolves that descriptor and nothing else. Reading
// pi-tasks.json here used to be a second answer to one question, under a weaker policy.
test('the host socket comes from the descriptor the Hosted Pi daemon publishes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-host-endpoint-'))
  const runtimeDir = path.join(dir, 'run')
  const socketPath = path.join(dir, 'run', 'control.sock')
  const descriptor = path.join(runtimeDir, 'open-deskos/hosted-pi/endpoint.json')
  fs.mkdirSync(path.dirname(descriptor), { recursive: true, mode: 0o700 })
  fs.writeFileSync(descriptor, JSON.stringify({ version: 1, socketPath, stateDir: path.join(dir, 'state') }), { mode: 0o600 })
  try {
    assert.equal(resolveHostedPiSocketPath({ XDG_RUNTIME_DIR: runtimeDir }), socketPath)
    assert.equal(resolveHostedPiSocketPath({ ODK_HOSTED_PI_SOCKET: socketPath }), socketPath)
    assert.throws(() => resolveHostedPiSocketPath({ ODK_HOSTED_PI_SOCKET: 'relative.sock' }), /absolute/)
    // No descriptor, an unusable one, or no session directory all mean the same thing: no host.
    assert.equal(resolveHostedPiSocketPath({}), null)
    assert.equal(resolveHostedPiSocketPath({ XDG_RUNTIME_DIR: 'relative' }), null)
    fs.writeFileSync(descriptor, JSON.stringify({ version: 2, socketPath }))
    assert.equal(resolveHostedPiSocketPath({ XDG_RUNTIME_DIR: runtimeDir }), null, 'a newer descriptor version must not be guessed at')
    fs.writeFileSync(descriptor, JSON.stringify({ version: 1, socketPath: 'relative.sock' }))
    assert.equal(resolveHostedPiSocketPath({ XDG_RUNTIME_DIR: runtimeDir }), null)
    fs.writeFileSync(descriptor, 'not json')
    assert.equal(resolveHostedPiSocketPath({ XDG_RUNTIME_DIR: runtimeDir }), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('Desk Link control maps onto the Hosted Pi task-host contract', () => {
  assert.deepEqual(taskRequest({ type: 'list', requestId: 'r1' }), { version: 1, requestId: 'r1', command: 'list' })
  assert.deepEqual(taskRequest({ type: 'history', requestId: 'r2', sessionId: 'task-1', after: 4 }), {
    version: 1, requestId: 'r2', command: 'history', taskId: 'task-1', position: 4,
  })
  assert.deepEqual(taskRequest({ type: 'attach', requestId: 'r3', sessionId: 'task-1', attachmentId: 'attachment-1', after: 7 }, { machineName: 'desk-mac', sessionId: 'console-a' }), {
    version: 1, requestId: 'r3', command: 'attach', attachmentId: 'attachment-1', taskId: 'task-1', position: 7,
    console: { machineName: 'desk-mac', sessionId: 'console-a' },
  })
  assert.deepEqual(taskRequest({ type: 'launch', requestId: 'r4', mutationId: 'mutation-1', sessionId: 'task-2', project: '/workspace/desk', prompt: 'Start' }), {
    version: 1, requestId: 'r4', command: 'start', mutationId: 'mutation-1', taskId: 'task-2', project: '/workspace/desk', prompt: 'Start',
  })
  assert.deepEqual(taskRequest({ type: 'prompt', requestId: 'r5', mutationId: 'mutation-2', sessionId: 'task-1', prompt: 'Continue' }, null), {
    version: 1, requestId: 'r5', command: 'prompt', mutationId: 'mutation-2', taskId: 'task-1', prompt: 'Continue', streamingBehavior: 'steer',
  })
  assert.deepEqual(taskRequest({ type: 'cancel', requestId: 'r6', mutationId: 'mutation-3', sessionId: 'task-1', attachmentId: 'attachment-1', turnId: 'turn-1' }, null), {
    version: 1, requestId: 'r6', command: 'cancel', mutationId: 'mutation-3', attachmentId: 'attachment-1', taskId: 'task-1', expectedTurnId: 'turn-1',
  })
})

test('task-host state and event records normalize without inventing success', () => {
  assert.deepEqual(normalizeTask({
    taskId: 'task-1', state: 'settled', lifecycle: 'alive', turnOutcome: 'cancelled', project: '/workspace/desk', prompt: 'Run tests', response: 'Cancelled',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z',
  }), {
    sessionId: 'task-1', status: 'settled', lifecycle: 'alive', turnOutcome: 'cancelled', project: '/workspace/desk', goal: 'Run tests',
    startedAt: Date.parse('2026-01-01T00:00:00.000Z'), updatedAt: Date.parse('2026-01-01T00:01:00.000Z'), activity: 'Cancelled',
  })
  assert.deepEqual(normalizeHistory('task-1', {
    entries: [
      { position: 8, entry: { type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Checking' }, { type: 'text', text: 'Done' }] } } },
      { position: 10, entry: { kind: 'assistant', text: 'Beyond requested boundary' } },
    ], boundary: 12, continuation: 10,
  }, 9), {
    sessionId: 'task-1', entries: [{
      position: 8,
      events: [
        { kind: 'thinking', text: 'Checking' },
        { kind: 'assistant', text: 'Done' },
      ],
    }], nextPosition: null, boundary: 9,
  })
  assert.deepEqual(normalizeEvent({ version: 1, type: 'event', taskId: 'task-1', position: 8, event: { kind: 'assistant', text: 'mapped event wins' }, entry: { kind: 'assistant', text: 'legacy fallback' } }, 'task-1'), [{
    type: 'event', sessionId: 'task-1', position: 8, events: [{ kind: 'assistant', text: 'mapped event wins' }],
  }])
  assert.deepEqual(normalizeEvent({ version: 1, type: 'event', taskId: 'task-1', position: 9, entry: { type: 'message', message: { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'tests passed' }] } } }, 'task-1'), [{
    type: 'event', sessionId: 'task-1', position: 9, events: [{ kind: 'result', text: 'tests passed', toolName: 'bash' }],
  }])
  assert.deepEqual(normalizeEvent({ version: 1, type: 'state', state: 'settled', lifecycle: 'live', activity: 'idle', turnOutcome: 'failed', response: 'No model' }, 'task-1'), [{
    type: 'state', sessionId: 'task-1', state: 'settled', lifecycle: 'live', activity: 'idle', turnOutcome: 'failed', response: 'No model',
  }])
})

test('a listed Hosted Pi keeps the goal the list projection carries', () => {
  // `list` strips the full prompt and response, so the goal travels in its own bounded field.
  assert.equal(normalizeTask({
    taskId: 'task-1', state: 'settled', lifecycle: 'alive', project: '/workspace/desk', goal: 'Run tests',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z',
  }).goal, 'Run tests')
  // A status reply carries the whole record, so the prompt stays the fallback.
  assert.equal(normalizeTask({ taskId: 'task-2', state: 'running', project: '/workspace/desk', prompt: 'Start' }).goal, 'Start')
  assert.equal(normalizeTask({ taskId: 'task-3', state: 'running', project: '/workspace/desk' }).goal, '')
})

test('raw Pi SessionEntry messages map to canonical bounded Session Events', () => {
  assert.deepEqual(sessionEventsFromEntry({
    type: 'message',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Inspecting' },
        { type: 'toolCall', name: 'bash', arguments: { command: 'pnpm test' } },
        { type: 'text', text: 'All tests passed' },
      ],
    },
  }), [
    { kind: 'thinking', text: 'Inspecting' },
    { kind: 'tool', text: 'bash\n{\n  "command": "pnpm test"\n}' },
    { kind: 'assistant', text: 'All tests passed' },
  ])
  assert.deepEqual(sessionEventsFromEntry({
    type: 'message',
    message: { role: 'toolResult', toolName: 'bash', content: [{ type: 'text', text: 'ok' }] },
  }), [{ kind: 'result', text: 'ok', toolName: 'bash' }])
})
