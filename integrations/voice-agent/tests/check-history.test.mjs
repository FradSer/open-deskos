import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { assistant } from './helpers/pi-fixture.mjs'
import { readHostedHistory, sessionEventsFromEntry } from '../src/task-agent.mjs'
import { createTaskService } from '../src/task-service.mjs'
import { RESPONSE_LIMIT } from '../src/task-protocol.mjs'

const evidence = { version: 1, outcome: 'exited', exitCode: 7, sourceBinding: 'matching',
  before: { status: 'available', digest: 'sha256:' + 'a'.repeat(64), files: 1, bytes: 10 },
  after: { status: 'available', digest: 'sha256:' + 'a'.repeat(64), files: 1, bytes: 10 } }
const result = { role: 'toolResult', toolName: 'coding_check', toolCallId: 'check-fixture',
  content: [{ type: 'text', text: 'output\u0000'.repeat(10_000) }], details: { codingCheck: evidence }, isError: false, timestamp: 3 }

test('host evidence precedes bounded output and retains check identity', () => {
  const [event] = sessionEventsFromEntry({ type: 'message', message: result })
  assert.equal(event.kind, 'result')
  assert.equal(event.toolCallId, result.toolCallId)
  assert.equal(event.isError, false)
  const header = event.text.split('\n\n')[0]
  assert.deepEqual(JSON.parse(header), { codingCheck: evidence })
  assert.equal(event.truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(event)) < 66 * 1024)
  const [claim] = sessionEventsFromEntry({ type: 'message', message: {
    role: 'assistant', content: [{ type: 'text', text: 'Tests passed' }], details: { codingCheck: evidence }, timestamp: 4 } })
  assert.equal(claim.text, 'Tests passed')
  assert.equal(claim.codingCheck, undefined)
})

for (const escaped of [false, true]) {
test('one oversized ' + (escaped ? 'escaped' : 'plain') + ' entry is refused instead of looping on the same position', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'check-history-oversized-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = SessionManager.create(dir, join(dir, 'logs'))
  manager.appendMessage({ role: 'user', content: 'batch', timestamp: 1 })
  // One assistant turn carrying many large tool calls maps to more events than
  // a whole page budget allows. There is no smaller unit to page to, so the
  // reader must refuse rather than hand back the position it was given.
  const after = manager.getEntries().length
  manager.appendMessage(assistant(Array.from({ length: 40 }, (_, index) => ({
    type: 'toolCall', id: 'call-' + index, name: 'bash', arguments: { command: (escaped ? '\u0000' : 'x').repeat(4000) },
  })), 'toolUse'))
  const service = await createTaskService({ roots: [dir], stateDir: join(dir, 'state'), socketPath: join(dir, 'run', 'host.sock') }, {
    createSession: async () => ({ sessionFile: manager.getSessionFile(), isStreaming: false,
      prompt: async () => ({ text: 'Turn ended', stopReason: 'stop' }),
      history: (position, limit) => readHostedHistory(manager.getSessionFile(), position, limit),
      abort: async () => {}, dispose() {} }),
    readHistory: readHostedHistory,
  })
  t.after(() => service.close())
  const id = randomUUID()
  const req = command => ({ version: 1, requestId: randomUUID(), command, taskId: id, project: dir })
  assert.equal((await service.handle({ ...req('start'), prompt: 'check' })).ok, true)
  for (let i = 0; i < 100; i++) {
    if ((await service.handle(req('status'))).task.state === 'settled') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  const page = await service.handle({ ...req('history'), position: after })
  assert.equal(page.ok, false)
  assert.match(page.error, /超出有界预算/)
  assert.ok(page.error.includes('position=' + (after + 1)), 'refusal names the unreturned entry for an explicit skip')
  assert.equal(page.history, undefined)
  const next = await service.handle({ ...req('history'), position: after + 1 })
  assert.equal(next.ok, true)
  assert.equal(next.history.continuation, null)
})
}

test('escaped check history and a near-limit task fit the complete response with continuation', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'check-history-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const manager = SessionManager.create(dir, join(dir, 'logs'))
  manager.appendMessage({ role: 'user', content: 'check', timestamp: 1 })
  manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Checking' }], api: 'test', provider: 'test', model: 'test',
    timestamp: 2, stopReason: 'toolUse', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
  manager.appendMessage(result)
  manager.appendMessage({ ...result, toolCallId: 'next-check', timestamp: 4 })
  const service = await createTaskService({ roots: [dir], stateDir: join(dir, 'state'), socketPath: join(dir, 'run', 'host.sock') }, {
    createSession: async () => ({
      sessionFile: manager.getSessionFile(), isStreaming: false,
      prompt: async () => ({ text: 'Turn ended', stopReason: 'stop' }),
      history: (position, limit) => readHostedHistory(manager.getSessionFile(), position, limit),
      abort: async () => {}, dispose() {},
    }),
    readHistory: readHostedHistory,
  })
  t.after(() => service.close())
  const id = randomUUID()
  const req = command => ({ version: 1, requestId: randomUUID(), command, taskId: id, project: dir })
  assert.equal((await service.handle({ ...req('start'), prompt: 'p'.repeat(64000) })).ok, true)
  for (let i = 0; i < 100; i++) {
    if ((await service.handle(req('status'))).task.state === 'settled') break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  const response = await service.handle(req('history'))
  assert.equal(response.ok, true)
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < RESPONSE_LIMIT, 'budget must count task envelope and duplicated history aliases')
  assert.ok(Number.isSafeInteger(response.history.continuation), 'more results require an explicit continuation')
  const first = response.history.events.flatMap(batch => batch.events).find(event => event.toolName === 'coding_check')
  assert.deepEqual(JSON.parse(first.text.split('\n\n')[0]).codingCheck, evidence)
  const next = await service.handle({ ...req('history'), position: response.history.continuation })
  assert.ok(next.history.events.some(batch => batch.events.some(event => event.toolCallId === 'next-check')))
  assert.equal(response.task.verification, 'not_run')
})
