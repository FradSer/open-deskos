import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PersonalBotService } from '../src/service.mjs'
import { sessionAdapter } from '../src/agent.mjs'
import { transcribe } from '../src/transcribe.mjs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function fixture(overrides = {}) {
  const calls = []
  const recording = { stop: async () => 'audio.wav', cleanup: async () => calls.push('cleanup'), done: new Promise(() => {}) }
  const service = new PersonalBotService({ record: async () => recording, transcribe: async () => 'hello', prompt: async text => { calls.push(text) }, ...overrides })
  service.subscribe(s => calls.push(s.state))
  return { service, calls }
}

test('a remote recording reserves the shared turn and stop requests do not wait for upload',async()=>{
 let ready,stops=0,cleanups=0,transcriptions=0,prompts=0,localRecords=0
 const recording={done:new Promise(resolve=>{ready=resolve}),stop:async()=> 'remote.wav',cleanup:async()=>{cleanups++}}
 const {service}=fixture({record:async()=>{localRecords++;throw Error('No local capture')},transcribe:async()=>{transcriptions++;return 'Remote speech'},prompt:async()=>{prompts++;return 'Central answer'}})
 assert.equal(service.reserveRemoteRecording(recording,()=>{stops++}),true)
 assert.equal(service.status.state,'recording');assert.equal(service.sendText('Concurrent input'),false)
 assert.equal(service.reserveRemoteRecording(recording,()=>{}),false)
 await service.toggle();assert.equal(stops,1);assert.equal(transcriptions,0);assert.equal(service.status.state,'recording');assert.equal(localRecords,0)
 ready();await new Promise(resolve=>setImmediate(resolve));await service.pending
 assert.equal(transcriptions,1);assert.equal(prompts,1);assert.equal(cleanups,1);assert.equal(service.status.state,'idle');assert.equal(service.status.message,'Central answer');await service.close()
})

test('remote capture cancellation rejects stale identities and prevents late transcription',async()=>{
 let ready,cleanups=0,transcriptions=0
 const recording={done:new Promise(resolve=>{ready=resolve}),stop:async()=> 'cancelled.wav',cleanup:async()=>{cleanups++}}
 const {service}=fixture({transcribe:async()=>{transcriptions++;return 'must not run'}})
 service.reserveRemoteRecording(recording,()=>{})
 assert.equal(await service.cancelRemoteRecording({}),false);assert.equal(service.status.state,'recording')
 assert.equal(await service.cancelRemoteRecording(recording),true);assert.equal(cleanups,1)
 assert.equal(service.status.state,'idle');assert.equal(service.status.message,'');assert.equal(service.status.voiceFailure,undefined)
 assert.equal(service.sendText('Continue after cancellation'),true);await service.pending;assert.equal(service.status.state,'idle')
 ready();await new Promise(resolve=>setImmediate(resolve));assert.equal(transcriptions,0)
 await service.toggle();assert.equal(service.status.state,'recording');assert.equal(await service.cancelRemoteRecording(recording),false)
 await service.close()
})

test('child activity stays separate from conversation state and clears during service shutdown', async () => {
  const { service } = fixture()
  service.setState('thinking', 'Current reply', 'Current request')
  const tasks = [{ taskId: '64a7f377-3169-447c-9b85-547a2454c28f', identity: { id: 'reporter', name: 'Reporter', avatar: 'book', revision: 'a'.repeat(64) }, state: 'running', updatedAt: new Date().toISOString() }]
  service.publishAgents(tasks)
  assert.equal(service.status.state, 'thinking')
  assert.equal(service.status.message, 'Current reply')
  assert.deepEqual(service.status.agents, { state: 'live', tasks })
  service.setState('idle', 'Final reply')
  assert.deepEqual(service.status.agents.tasks, tasks)
  await service.close()
  assert.deepEqual(service.status.agents, { state: 'unavailable', tasks: [] })
  service.publishAgents(tasks)
  assert.deepEqual(service.status.agents.tasks, [])
})

test('recording cleanup failure remains an error and blocks a later input until release',async()=>{
 let failed=true
 const recording={done:new Promise(()=>{}),stop:async()=>'',cleanup:async()=>{if(failed)throw Error('private cleanup')}}
 const {service}=fixture();service.reserveRemoteRecording(recording,()=>{})
 assert.equal(await service.cancelRemoteRecording(recording),false)
 assert.equal(service.status.state,'error');assert.equal(service.status.message,'Recording cleanup failed');assert.equal(service.status.voiceFailure,'cleanup')
 assert.equal(service.sendText('Must not race cleanup'),false)
 failed=false;await service.close()
})

test('successful suggestion snapshots clear old errors without hiding later failures', () => {
  const { service } = fixture(), statuses = []
  service.subscribe(status => statuses.push(status))
  service.setState('idle', 'Current reply', 'Current request')
  const briefing = { state: 'live', items: [], generatedAt: 1, omittedSources: 0 }
  for (const proposals of [[], [{ id: 'current-advice', advice: 'Current advice' }]]) {
    service.propose({ proposals: [], popup: false, error: 'generation_unavailable' })
    const failure = statuses.at(-1)
    assert.equal(service.status.proposalError, 'generation_unavailable')
    assert.equal(failure.proposalError, 'generation_unavailable')
    service.publishAgents([]); service.publishBriefing(briefing)
    assert.equal(statuses.at(-1).proposalError, 'generation_unavailable')

    service.propose({ proposals, popup: true, interaction: true })
    const recovered = statuses.at(-1)
    assert.equal(Object.hasOwn(service.status, 'proposalError'), false)
    assert.equal(Object.hasOwn(recovered, 'proposalError'), false)
    assert.deepEqual(recovered.proposals, proposals)
    assert.equal(recovered.proposalPopup, true); assert.equal(recovered.proposalInteraction, true)
    assert.equal(service.status.proposalPopup, false); assert.equal(service.status.proposalInteraction, false)
    assert.equal(service.status.message, 'Current reply'); assert.equal(service.status.transcript, 'Current request')
    assert.equal(failure.proposalError, 'generation_unavailable', 'earlier emitted errors remain truthful')
    const beforePublish = statuses.length
    service.publishAgents([]); service.publishBriefing(briefing); service.setState('idle', 'Current reply')
    for (const status of [service.status, ...statuses.slice(beforePublish)]) assert.equal(Object.hasOwn(status, 'proposalError'), false)
  }
  service.propose({ proposals: [], popup: false, error: 'generation_unavailable' })
  assert.equal(service.status.proposalError, 'generation_unavailable')
  assert.equal(statuses.at(-1).proposalError, 'generation_unavailable')
  service.setState('thinking', 'Current reply')
  assert.equal(service.status.proposalError, 'generation_unavailable')
})

test('notifications stay separate from replies and flush one message per event', () => {
  const { service } = fixture()
  service.setState('thinking', 'Partial answer', 'Ride status?')
  service.notify('订单状态仍待确认')
  service.notify('订单状态已更新')
  service.setState('idle', 'Final answer', 'Ride status?')

  assert.equal(service.status.message, 'Final answer')
  assert.equal(service.status.notifications.length, 2)
  assert.deepEqual(service.status.notifications.map(item => item.message), ['订单状态仍待确认', '订单状态已更新'])
  assert.equal(new Set(service.status.notifications.map(item => item.id)).size, 2)

  service.notify('后续状态')
  assert.equal(service.status.message, 'Final answer')
  assert.equal(service.status.notifications.length, 1)
  assert.equal(service.status.notifications[0].message, '后续状态')
})

test('service suspension drains capture and restores work without accepting late recording completion', async () => {
  let done
  let cleaned = 0
  let transcribed = 0
  let records = 0
  const oldDone = new Promise(resolve => { done = resolve })
  const service = new PersonalBotService({
    record: async () => ({ done: ++records === 1 ? oldDone : new Promise(() => {}),
      stop: async () => 'fixture.wav', cleanup: async () => { cleaned++ } }),
    transcribe: async () => { transcribed++; return 'fixture' }, prompt: async () => '',
  })
  await service.toggle()
  const oldSignal = service.controller.signal
  await service.suspend()
  assert.equal(oldSignal.aborted, true)
  assert.equal(cleaned, 1)
  await service.toggle()
  assert.equal(records, 1)
  await service.resume()
  assert.notEqual(service.controller.signal, oldSignal)
  assert.equal(service.controller.signal.aborted, false)
  await service.toggle()
  done()
  await new Promise(setImmediate)
  assert.equal(service.status.state, 'recording')
  assert.equal(transcribed, 0)
  await service.toggle()
  assert.equal(transcribed, 1)
  await service.close()
  await service.resume()
  await service.toggle()
  assert.equal(records, 2)
})

test('failed suspension retains recording ownership until cleanup retry succeeds', async () => {
  let fail = true
  const recording = { done: new Promise(() => {}), stop: async () => 'fixture', cleanup: async () => { if (fail) throw Error('private cleanup') } }
  const service = new PersonalBotService({ record: async () => recording, transcribe: async () => '', prompt: async () => '' })
  await service.toggle()
  await assert.rejects(service.suspend(), /Recording cleanup failed/)
  assert.equal(service.recording, recording)
  await service.resume()
  assert.equal(service.closed, true)
  fail = false
  await service.suspend()
  assert.equal(service.recording, undefined)
  await service.resume()
  assert.equal(service.closed, false)
  await service.close()
})

test('late capture cleanup failure retains suspension ownership and close can retry', async () => {
  let acquire
  let fail = true
  const recording = { done: new Promise(() => {}), stop: async () => 'fixture', cleanup: async () => { if (fail) throw Error('private cleanup') } }
  const service = new PersonalBotService({ record: () => new Promise(resolve => { acquire = resolve }), transcribe: async () => '', prompt: async () => '' })
  const starting = service.toggle()
  const stopping = service.suspend()
  acquire(recording)
  await starting
  await assert.rejects(stopping, /Recording cleanup failed/)
  assert.equal(service.recording, recording)
  await assert.rejects(service.close(), /Recording cleanup failed/)
  assert.equal(service.recording, recording)
  fail = false
  await service.close()
  assert.equal(service.recording, undefined)
})

test('permanent close during failed suspension retries its retained capture', async () => {
  let release
  let entered
  let calls = 0
  const ready = new Promise(resolve => { entered = resolve })
  const cleanup = new Promise((_, reject) => { release = reject })
  const service = new PersonalBotService({ record: async () => ({ done: new Promise(() => {}), stop: async () => 'fixture',
    cleanup: () => { if (++calls === 1) { entered(); return cleanup } return Promise.resolve() } }),
    transcribe: async () => '', prompt: async () => '' })
  await service.toggle()
  const suspended = assert.rejects(service.suspend(), /Recording cleanup failed/)
  await ready
  const closing = service.close()
  release(Error('private fixture cleanup'))
  await Promise.all([suspended, closing])
  assert.equal(calls, 2)
  assert.equal(service.recording, undefined)
  await service.resume()
  assert.equal(service.closed, true)
})

test('late submission cannot discard recording ownership after suspension failure', async () => {
  let respond
  let entered
  let fail = true
  const ready = new Promise(resolve => { entered = resolve })
  const response = new Promise(resolve => { respond = resolve })
  const recording = { done: new Promise(() => {}), stop: async () => 'fixture', cleanup: async () => { if (fail) throw Error('private cleanup') } }
  const service = new PersonalBotService({ record: async () => recording, transcribe: async () => 'fixture',
    prompt: () => { entered(); return response } })
  await service.toggle()
  const turn = service.toggle()
  await ready
  await assert.rejects(service.suspend(), /Recording cleanup failed/)
  respond('late')
  await turn
  assert.equal(service.recording, recording)
  await assert.rejects(service.suspend(), /Recording cleanup failed/)
  await service.resume()
  assert.equal(service.closed, true)
  fail = false
  await service.suspend()
  await service.resume()
  assert.equal(service.closed, false)
  await service.close()
})

test('cleanup that started before suspension retains ownership when it later fails', async () => {
  let entered
  let rejectCleanup
  let fail = true
  const ready = new Promise(resolve => { entered = resolve })
  const cleanup = new Promise((_, reject) => { rejectCleanup = reject })
  const recording = { done: new Promise(() => {}), stop: async () => 'fixture',
    cleanup: () => { if (fail) { entered(); return cleanup } return Promise.resolve() } }
  const service = new PersonalBotService({ record: async () => recording, transcribe: async () => 'fixture', prompt: async () => '' })
  await service.toggle()
  const turn = service.toggle()
  await ready
  const suspended = assert.rejects(service.suspend(), /Recording cleanup failed/)
  rejectCleanup(Error('private cleanup'))
  await Promise.all([turn, suspended])
  assert.equal(service.recording, recording)
  fail = false
  await service.suspend()
  await service.resume()
  assert.equal(service.closed, false)
  await service.close()
})

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
  assert.equal(service.status.message, 'Personal Bot request failed; try again')
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
    assert.equal(service.status.message, 'Personal Bot request failed; try again')
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


test('one startup Jev check survives status updates and subscriptions without retry', async () => {
  let release, signal, requests = 0
  const gate = new Promise(resolve => { release = resolve })
  const {service} = fixture({checkJev: async input => { requests++; signal = input; await gate; return {status:'verified'} }})
  assert.deepEqual(service.status.jev, {status:'checking'})
  const frames = []; const unsubscribe = service.subscribe(frame => frames.push(frame))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests,1); assert.equal(signal.aborted,false)
  release(); await service.jevCheck
  assert.deepEqual(service.status.jev,{status:'verified'})
  service.setState('thinking','A reply'); service.publishAgents([]); service.publishBriefing({state:'unavailable',items:[]})
  service.propose({proposals:[],popup:false}); service.setState('idle')
  assert.ok(frames.every(frame=>frame.jev.status==='verified'))
  unsubscribe(); service.subscribe(()=>{})
  assert.equal(requests,1); await service.close()
})

test('startup Jev failure is durable safe status and a disposed check cannot publish late success', async () => {
  for (const jev of [{status:'missing_credential'},{status:'auth_rejected'},{status:'unavailable',reason:'network'}]) {
    const {service}=fixture({checkJev:async()=>jev})
    await service.jevCheck; service.setState('idle'); assert.deepEqual(service.status.jev,jev)
    await service.close()
  }
  let release, signal
  const {service}=fixture({checkJev:async input=>{signal=input;await new Promise(resolve=>{release=resolve});return {status:'verified'}}})
  await new Promise(resolve=>setImmediate(resolve))
  await service.suspend(); assert.equal(signal.aborted,true)
  await service.resume(); release(); await service.jevCheck
  assert.equal(service.status.jev.status,'unavailable'); await service.close()
})


test('an AI-bound owner turn keeps one host identity and persists its answer in the same reply',async()=>{
 const reference={messageId:'a'.repeat(64),sourceKey:'retained-source',sourceRevision:'b'.repeat(64)},threadId='c'.repeat(64),updates=[];let ownerId,lateBind,lateAcknowledgement
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async(text,_snapshot,reply,owner)=>{
  assert.equal(reply,undefined);assert.match(owner.id,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);ownerId=owner.id;assert.equal(service.status.ownerTurnId,ownerId)
  lateBind=owner.bind;lateAcknowledgement=owner.requireDeliveryAcknowledgement;owner.requireDeliveryAcknowledgement();owner.bind({id:ownerId,text,replyTo:reference,threadId,source:{}})
  service.publishRemote({state:'live',messages:[],replies:[{id:ownerId,status:'unknown'}]})
  assert.equal(service.status.ownerTurnId,ownerId);assert.deepEqual(service.status.replyTo,reference);return 'The task instruction has a delivery receipt.'
 }})
 service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},completeReply:(id,patch)=>updates.push({id,...patch})})
 assert.equal(service.sendText('Continue the displayed task.'),true);await service.pending
 assert.equal(service.status.ownerTurnId,ownerId);assert.equal(service.status.threadId,threadId);assert.equal(service.status.state,'idle')
 assert.deepEqual(updates,[{id:ownerId,status:'answered',answer:'暂不能确认原会话是否收到指令。'}])
 const finished=service.status;assert.throws(()=>lateAcknowledgement(),/owner/i);assert.equal(service.status,finished)
 assert.throws(()=>lateBind({id:ownerId,replyTo:reference,threadId}),/owner/i);await service.close()
})

test('typed and voice acknowledgements use only their current host receipt',async t=>{
 const cases=[
  ['unknown',{status:'unknown',receipt:{accepted:false,delivery:'unknown'}},'暂不能确认原会话是否收到指令。'],
  ['dispatching',{status:'dispatching'},'暂不能确认原会话是否收到指令。'],
  ['not dispatched',{status:'queued'},'这条指令未发送到原会话。'],
  ['refused before sending',{status:'failed'},'这条指令未发送到原会话。'],
  ['failed with an uncertain receipt',{status:'failed',receipt:{delivery:'unknown'}},'暂不能确认原会话是否收到指令。'],
  ['missing receipt',{status:'delivered'},'暂不能确认原会话是否收到指令。'],
  ['queued',{status:'delivered',receipt:{accepted:true,delivery:'queued'}},'指令已进入原会话队列，尚不代表任务完成。'],
  ['ran',{status:'delivered',receipt:{accepted:true,delivery:'ran'}},'原会话已受理指令并开始本轮处理，尚不代表任务完成。'],
 ]
 for(const input of ['typed','voice'])for(const [name,outcome,answer]of cases)await t.test(`${input} ${name}`,async()=>{
  const reference={messageId:'a'.repeat(64),sourceKey:'retained-source',sourceRevision:'b'.repeat(64)},threadId='c'.repeat(64),updates=[],frames=[];let currentId
  const {service}=fixture({prompt:async(text,snapshot,_reply,owner)=>{
   currentId=owner.id;owner.requireDeliveryAcknowledgement();owner.bind({id:owner.id,text,replyTo:reference,threadId,source:{}})
   snapshot('已发送并已完成。');await new Promise(resolve=>setTimeout(resolve,120));return '已发送并已完成。'
  }})
  service.subscribe(frame=>frames.push(frame))
  service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},replyOutcome:id=>{assert.equal(id,currentId);return{id,...outcome}},completeReply:(id,patch)=>updates.push({id,...patch})})
  if(input==='typed'){assert.equal(service.sendText('继续原任务'),true);await service.pending}else{await service.toggle();await service.toggle()}
  assert.equal(service.status.state,'idle');assert.equal(service.status.message,answer)
  assert.deepEqual(updates,[{id:currentId,status:'answered',answer}]);assert.ok(frames.every(frame=>!frame.message.includes('已发送并已完成')))
  await service.close()
 })
 await t.test('a different receipt identity cannot certify this owner turn',async()=>{
  const reference={messageId:'a'.repeat(64),sourceKey:'retained-source',sourceRevision:'b'.repeat(64)}
  const {service}=fixture({prompt:async(text,_snapshot,_reply,owner)=>{owner.requireDeliveryAcknowledgement();owner.bind({id:owner.id,text,replyTo:reference,threadId:'c'.repeat(64),source:{}});return '已发送'}})
  service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},replyOutcome:()=>({id:'other-turn',status:'delivered',receipt:{accepted:true,delivery:'ran'}}),completeReply:()=>{}})
  service.sendText('继续');await service.pending;assert.equal(service.status.message,'暂不能确认原会话是否收到指令。');await service.close()
 })
 await t.test('a bound read-only answer keeps its text and streaming without a continuation workflow',async()=>{
  const reference={messageId:'a'.repeat(64),sourceKey:'retained-source',sourceRevision:'b'.repeat(64)},frames=[],writes=[]
  const {service}=fixture({prompt:async(text,snapshot,_reply,owner)=>{owner.bind({id:owner.id,text,replyTo:reference,threadId:'c'.repeat(64),source:{}});snapshot('原报告的结论');await new Promise(resolve=>setTimeout(resolve,120));return '原报告的结论是仍需试装。'}})
  service.subscribe(frame=>frames.push(frame))
  service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},replyOutcome:()=>{throw Error('A query must not read an admission receipt')},completeReply:(_id,patch)=>writes.push(patch)})
  service.sendText('这个报告结论是什么？');await service.pending
  assert.equal(service.status.message,'原报告的结论是仍需试装。');assert.ok(frames.some(frame=>frame.message==='原报告的结论'));assert.equal(writes[0].answer,service.status.message);await service.close()
 })
})


test('typed and voice turns contain reply persistence failures without rejecting their pending turn',async t=>{
 for(const input of ['typed','voice'])for(const promptFails of [false,true])await t.test(`${input} ${promptFails?'prompt failure':'final persistence failure'}`,async()=>{
  const reference={messageId:'a'.repeat(64),sourceKey:'retained-source',sourceRevision:'b'.repeat(64)},threadId='c'.repeat(64),writes=[],busy=[]
  const {service,calls}=fixture({prompt:async(text,_snapshot,_reply,owner)=>{owner.bind({id:owner.id,text,replyTo:reference,threadId,source:{}});if(promptFails)throw Error('private prompt error');return 'Original answer'}})
  service.attachWatch({setBusy:value=>busy.push(value),interact:()=>{}})
  service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},completeReply:(_id,patch)=>{writes.push(patch);throw Error('private checkpoint path')}})
  if(input==='typed'){assert.equal(service.sendText('Continue the original task.'),true);await assert.doesNotReject(service.pending)}
  else{await service.toggle();await assert.doesNotReject(service.toggle());assert.ok(calls.includes('cleanup'))}
  assert.equal(service.status.state,'error');assert.match(service.status.message,/Reply status could not be saved/);assert.ok(!JSON.stringify(service.status).includes('private'))
  assert.deepEqual(writes.map(p=>p.status),promptFails?['failed']:['answered','failed']);if(input==='typed')assert.equal(busy.at(-1),false);await service.close()
 })
})
