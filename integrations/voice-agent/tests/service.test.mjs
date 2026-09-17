import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VoiceService } from '../src/service.mjs'
import { sessionAdapter } from '../src/agent.mjs'
import { transcribe } from '../src/transcribe.mjs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture(overrides = {}) {
  const calls = []
  const recording = { stop: async () => 'audio.wav', cleanup: async () => calls.push('cleanup'), done: new Promise(() => {}) }
  const service = new VoiceService({ record: async () => recording, transcribe: async () => 'hello', prompt: async text => { calls.push(text) }, ...overrides })
  service.subscribe(s => calls.push(s.state))
  return { service, calls }
}

test('toggle capture sends transcript once and removes audio', async () => {
  const { service, calls } = fixture()
  await service.toggle()
  assert.equal(service.status.state, 'recording')
  await service.toggle()
  assert.deepEqual(calls, ['recording', 'transcribing', 'thinking', 'hello', 'cleanup', 'idle'])
})

test('busy toggle ignored; provider failure safely retryable', async () => {
  let finish
  const { service, calls } = fixture({ transcribe: () => new Promise(resolve => { finish = resolve }) })
  await service.toggle()
  const turn = service.toggle()
  await new Promise(resolve => setImmediate(resolve))
  await service.toggle()
  finish('hello')
  await turn
  assert.equal(calls.filter(x => x === 'recording').length, 1)
  const failed = fixture({ transcribe: async () => { throw Error('secret') } })
  await failed.service.toggle()
  await failed.service.toggle()
  assert.equal(failed.service.status.state, 'error')
  assert.ok(!JSON.stringify(failed.service.status).includes('secret'))
  assert.ok(failed.calls.includes('cleanup'))
  await failed.service.toggle()
  assert.equal(failed.service.status.state, 'recording')
  await failed.service.close()
})

test('cleanup failure is contained and produces safe error', async () => {
  const { service } = fixture({ record: async () => ({ done: new Promise(() => {}), stop: async () => 'audio', cleanup: async () => { throw Error('private-path') } }) })
  await service.toggle()
  await service.toggle()
  assert.equal(service.status.state, 'error')
  assert.ok(!service.status.message.includes('private-path'))
})

test('final Markdown response is preserved up to 16384 characters', async () => {
  for (const length of [2048, 16384, 20000]) {
    const { service } = fixture({ prompt: async () => '# Result\n' + 'x'.repeat(length) })
    await service.toggle()
    await service.toggle()
    const response = '# Result\n' + 'x'.repeat(length)
    const notice = '\n\n[Response truncated]'
    assert.equal(service.status.message, response.length <= 16384 ? response : response.slice(0, 16384 - notice.length) + notice)
  }
})

test('transcript is published before prompting and pending text snapshots coalesce every 100ms', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let complete
  let snapshot
  const statuses = []
  const transcript = '请检查 **plain input**'
  const { service } = fixture({
    transcribe: async () => transcript,
    prompt: (text, onSnapshot) => {
      assert.equal(text, transcript)
      assert.equal(service.status.state, 'thinking')
      assert.equal(service.status.transcript, transcript)
      assert.equal(statuses.at(-1).transcript, transcript)
      snapshot = onSnapshot
      return new Promise(resolve => { complete = resolve })
    },
  })
  service.subscribe(status => statuses.push(status))
  await service.toggle()
  const turn = service.toggle()
  await new Promise(resolve => setImmediate(resolve))
  snapshot('a')
  snapshot('ab')
  t.mock.timers.tick(99)
  assert.equal(service.status.message, '')
  t.mock.timers.tick(1)
  assert.equal(service.status.state, 'thinking')
  assert.equal(service.status.message, 'ab')
  const count = statuses.length
  snapshot('ab')
  t.mock.timers.tick(100)
  assert.equal(statuses.length, count)
  snapshot('abc')
  t.mock.timers.tick(100)
  assert.equal(service.status.message, 'abc')
  snapshot('pending')
  complete('authoritative final')
  await turn
  assert.equal(service.status.state, 'idle')
  assert.equal(service.status.message, 'authoritative final')
  assert.equal(service.status.transcript, transcript)
  const finalCount = statuses.length
  snapshot('late')
  t.mock.timers.tick(1000)
  assert.equal(statuses.length, finalCount)
  await service.toggle()
  assert.equal(service.status.transcript, '')
  assert.equal(service.status.message, '')
  snapshot('old request')
  t.mock.timers.tick(1000)
  assert.equal(service.status.message, '')
  await service.close()
})

test('transcript and partial reply have visible in-bound truncation without truncating the prompt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const text = '中'.repeat(5000)
  let complete
  let snapshot
  const { service } = fixture({
    transcribe: async () => text,
    prompt: (received, callback) => {
      assert.equal(received, text)
      snapshot = callback
      return new Promise(resolve => { complete = resolve })
    },
  })
  await service.toggle()
  const turn = service.toggle()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.status.transcript.length, 4096)
  assert.match(service.status.transcript, /\[Transcript truncated\]$/)
  snapshot('x'.repeat(20_000))
  t.mock.timers.tick(100)
  assert.equal(service.status.message.length, 16384)
  assert.match(service.status.message, /\[Response truncated\]$/)
  complete('done')
  await turn
  await service.close()
  assert.equal(service.status.transcript, '')
  assert.equal(service.status.message, '')
})

test('failed prompt retains input, replaces partial reply safely and stops callbacks before cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let rejectPrompt
  let snapshot
  let cleanup
  const { service } = fixture({
    record: async () => ({ stop: async () => 'audio.wav', cleanup: () => new Promise(resolve => { cleanup = resolve }), done: new Promise(() => {}) }),
    prompt: (_text, callback) => { snapshot = callback; return new Promise((_resolve, reject) => { rejectPrompt = reject }) },
  })
  const statuses = []
  service.subscribe(status => statuses.push(status))
  await service.toggle()
  const turn = service.toggle()
  await new Promise(resolve => setImmediate(resolve))
  snapshot('partial')
  t.mock.timers.tick(100)
  assert.equal(service.status.message, 'partial')
  snapshot('queued private data')
  rejectPrompt(Error('private provider details'))
  await new Promise(resolve => setImmediate(resolve))
  const count = statuses.length
  snapshot('late during cleanup')
  t.mock.timers.tick(1000)
  assert.equal(statuses.length, count)
  cleanup()
  await turn
  assert.equal(service.status.state, 'error')
  assert.equal(service.status.transcript, 'hello')
  assert.equal(service.status.message, 'Voice request failed; try again')
  snapshot('late after error')
  t.mock.timers.tick(1000)
  assert.equal(service.status.state, 'error')
})

test('terminal SDK overflow recovery replaces streamed text with a safe service error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const outcome of [
    { aborted: false, errorMessage: 'private provider error' },
    { aborted: true },
    { aborted: false, errorMessage: 'private exhausted recovery', retried: true },
  ]) {
    let emit
    let unsubscribed = 0
    const assistantEnd = (text, stopReason) => emit({ type: 'message_end', message: {
      role: 'assistant', stopReason, content: [{ type: 'text', text }],
    } })
    const adapter = sessionAdapter({
      subscribe: callback => { emit = callback; return () => { unsubscribed++ } },
      prompt: async () => {
        assistantEnd('Plan', 'toolUse')
        assistantEnd('truncated', 'length')
        t.mock.timers.tick(100)
        assert.equal(service.status.message, 'Plan\n\ntruncated')
        if (outcome.retried) {
          emit({ type: 'compaction_end', reason: 'overflow', result: {}, aborted: false, willRetry: true })
          assistantEnd('still truncated', 'length')
        }
        emit({ type: 'compaction_end', reason: 'overflow', result: undefined, willRetry: false, ...outcome })
      },
    })
    const { service, calls } = fixture({ prompt: adapter.prompt })
    const statuses = []
    service.subscribe(status => statuses.push(status))
    await service.toggle()
    await service.toggle()
    assert.equal(service.status.state, 'error')
    assert.equal(service.status.transcript, 'hello')
    assert.equal(service.status.message, 'Voice request failed; try again')
    assert.equal(statuses.some(status => status.state === 'idle'), false)
    assert.equal(JSON.stringify(statuses).includes('private'), false)
    assert.equal(unsubscribed, 1)
    assert.ok(calls.includes('cleanup'))
    const count = statuses.length
    assistantEnd('late private reply', 'stop')
    t.mock.timers.tick(1000)
    assert.equal(statuses.length, count)
    await service.close()
  }
})

test('shutdown cancels pending text timers and callbacks while prompt is unresolved', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let snapshot
  let complete
  const { service } = fixture({ prompt: (_text, callback) => { snapshot = callback; return new Promise(resolve => { complete = resolve }) } })
  const statuses = []
  service.subscribe(status => statuses.push(status))
  await service.toggle()
  const turn = service.toggle()
  await new Promise(resolve => setImmediate(resolve))
  snapshot('pending')
  const closing = service.close()
  const count = statuses.length
  snapshot('late')
  t.mock.timers.tick(1000)
  assert.equal(statuses.length, count)
  assert.equal(service.status.transcript, '')
  complete('late final')
  await Promise.all([turn, closing])
  assert.equal(statuses.length, count)
  assert.equal(service.status.message, '')
})

test('old text callback cannot contaminate a later thinking request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const callbacks = []
  const resolvers = []
  const { service } = fixture({ prompt: (_text, callback) => { callbacks.push(callback); return new Promise(resolve => resolvers.push(resolve)) } })
  for (let index = 0; index < 2; index++) {
    await service.toggle()
    const turn = service.toggle()
    await new Promise(resolve => setImmediate(resolve))
    if (index) callbacks[0]('old private output')
    callbacks[index]('current')
    t.mock.timers.tick(100)
    assert.equal(service.status.message, 'current')
    resolvers[index]('done')
    await turn
  }
})

test('listening has no deadline and repeated shutdown discards capture once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { service, calls } = fixture()
  await service.toggle()
  t.mock.timers.tick(120_000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.status.state, 'recording')
  await Promise.all([service.close(), service.close()])
  assert.equal(calls.filter(x => x === 'hello').length, 0)
  assert.equal(calls.filter(x => x === 'cleanup').length, 1)
  assert.equal(service.status.level, 0)
})

test('levels are recording-only and old capture callbacks cannot update a new turn', async () => {
  const callbacks = []
  const { service } = fixture({ record: async onLevel => {
    callbacks.push(onLevel)
    return { stop: async () => 'audio.wav', cleanup: async () => {}, done: new Promise(() => {}) }
  } })
  assert.equal(service.status.level, 0)
  await service.toggle()
  callbacks[0](0.5)
  assert.equal(service.status.level, 0.5)
  await service.toggle()
  assert.equal(service.status.level, 0)
  callbacks[0](0.8)
  assert.equal(service.status.level, 0)
  await service.toggle()
  callbacks[0](0.9)
  assert.equal(service.status.level, 0)
  callbacks[1](0.25)
  assert.equal(service.status.level, 0.25)
  await service.close()
  assert.equal(service.status.level, 0)
})

test('shutdown during startup waits for late capture cleanup without submitting', async () => {
  let started
  let cleaned = 0
  let transcribed = false
  const { service } = fixture({
    record: () => new Promise(resolve => { started = resolve }),
    transcribe: async () => { transcribed = true; return 'hello' },
  })
  const starting = service.toggle()
  const closing = service.close()
  started({ stop: async () => 'audio.wav', cleanup: async () => { cleaned++ }, done: new Promise(() => {}) })
  await Promise.all([starting, closing, service.close()])
  assert.equal(cleaned, 1)
  assert.equal(transcribed, false)
  assert.equal(service.status.level, 0)
})

test('shutdown while stop is pending does not start transcription', async () => {
  let stopped
  let transcribed = false
  const { service } = fixture({
    record: async () => ({ stop: () => new Promise(resolve => { stopped = resolve }), cleanup: async () => {}, done: new Promise(() => {}) }),
    transcribe: async () => { transcribed = true; return 'hello' },
  })
  await service.toggle()
  const turn = service.toggle()
  const closing = service.close()
  stopped('audio.wav')
  await Promise.all([turn, closing])
  assert.equal(transcribed, false)
})

test('oversize upload status explains the resource limit', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-limit-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'audio.wav')
  const file = await open(path, 'w')
  await file.truncate(25_000_001)
  await file.close()
  const { service } = fixture({ transcribe: async () => transcribe(path, { url: 'https://example.com', model: 'whisper-1', keyFile: '/missing' }) })
  await service.toggle()
  await service.toggle()
  assert.equal(service.status.state, 'error')
  assert.match(service.status.message, /25,000,000-byte upload limit/)
})

test('automatic recorder endpoint submits once even alongside manual MIC', async () => {
  let endpoint
  const { service, calls } = fixture({ record: async () => ({
    stop: async () => 'audio.wav', cleanup: async () => calls.push('cleanup'),
    done: new Promise(resolve => { endpoint = resolve }),
  }) })
  await service.toggle()
  endpoint()
  await service.toggle()
  assert.equal(calls.filter(x => x === 'hello').length, 1)
  assert.equal(calls.filter(x => x === 'cleanup').length, 1)
})
