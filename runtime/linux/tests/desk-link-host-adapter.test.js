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

test('the host socket comes from the existing private task-host configuration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-host-config-'))
  const configPath = path.join(dir, 'pi-tasks.json')
  const socketPath = path.join(dir, 'run', 'control.sock')
  fs.writeFileSync(configPath, JSON.stringify({ roots: ['/workspace'], stateDir: path.join(dir, 'state'), socketPath }))
  try {
    assert.equal(resolveHostedPiSocketPath({ ODESK_TASK_CONFIG: configPath }), socketPath)
    assert.equal(resolveHostedPiSocketPath({ ODK_HOSTED_PI_SOCKET: socketPath }), socketPath)
    assert.throws(() => resolveHostedPiSocketPath({ ODK_HOSTED_PI_SOCKET: 'relative.sock' }), /absolute/)
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
