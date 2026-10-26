import {test} from 'node:test'
import assert from 'node:assert/strict'
import {generationDeadlineMs, generateWithinDeadline} from '../src/proactive-generation-session.mjs'
import {AgentValidationError, pluginFormatCorrection} from '../src/agent-plugins/completion.mjs'
import {renderPluginInput, parsePluginInput} from '../src/agent-plugins/prompt.mjs'

test('a plugin serializer preserves literal receipt data and retry metadata within the same two attempts', async () => {
  const input = { request: 'Read source', answer: 'Read complete', hostedTask: { id: 'fixture' }, existingExperience: [{ id: 'lesson-fixture' }],
    receipts: [{ id: 'tool-1', text: String.raw`{"path":"C:\\fixture","emoji":"🧪"}` }] }
  const before = structuredClone(input)
  let calls = 0, disposed = 0
  const result = await generateWithinDeadline({ serialize: renderPluginInput,
    create: async () => ({ dispose: async () => { disposed++ }, abort: async () => {} }),
    prompt: async (_session, text) => {
      const request = parsePluginInput(text)
      assert(text.includes(input.receipts[0].text))
      assert.deepEqual(request, { ...input, ...(calls ? { formatCorrection: 'Copy an exact substring.' } : {}) })
      return ++calls === 1 ? '{invalid' : '{"valid":true}'
    }, formatCorrection: 'Copy an exact substring.',
  }, input)
  assert.deepEqual(result, { valid: true })
  assert.deepEqual(input, before)
  assert.equal(calls, 2)
  assert.equal(disposed, 1)
})

test('known host validation codes produce exact safe feedback inside the existing two-attempt lifecycle', async () => {
  let calls = 0, disposed = 0, corrections = 0
  const result = await generateWithinDeadline({
    create: async () => ({ dispose: async () => { disposed++ }, abort: async () => {} }),
    prompt: async (_session, text) => {
      calls++
      const request = JSON.parse(text)
      if (calls === 1) { assert.equal(request.formatCorrection, undefined); return '{"valid":false}' }
      assert.equal(request.formatCorrection, pluginFormatCorrection('completion', new AgentValidationError('citation')))
      assert(!request.formatCorrection.includes('PRIVATE_ERROR'))
      return '{"valid":true}'
    },
    validate: value => { if (!value.valid) throw Object.assign(new AgentValidationError('citation'), { message: 'PRIVATE_ERROR' }) },
    formatCorrection: error => { corrections++; return pluginFormatCorrection('completion', error) },
  }, { request: 'Check supplied input' })
  assert.deepEqual(result, { valid: true })
  assert.equal(calls, 2); assert.equal(corrections, 1); assert.equal(disposed, 1)
})

test('unknown private errors and malformed JSON receive generic feedback without response or message disclosure', async () => {
  for (const malformed of [false, true]) {
    let calls = 0
    await assert.rejects(generateWithinDeadline({
      create: async () => ({ dispose: async () => {}, abort: async () => {} }),
      prompt: async (_session, text) => {
        calls++
        if (calls === 2) {
          const correction = JSON.parse(text).formatCorrection
          assert.equal(correction, pluginFormatCorrection('learning', new Error('unknown')))
          assert(!correction.includes('PRIVATE_ERROR'))
        }
        return malformed ? '{PRIVATE_ERROR' : '{}'
      },
      validate: () => { throw Object.assign(new Error('PRIVATE_ERROR'), { code: 'citation' }) },
      formatCorrection: error => pluginFormatCorrection('learning', error),
    }, {}))
    assert.equal(calls, 2)
  }
})

test('generation budget defaults to 90 seconds and rejects unbounded settings', () => {
 assert.equal(generationDeadlineMs(),90000)
 assert.equal(generationDeadlineMs('120000'),120000)
 for(const v of [0,999,180001,NaN,'bad'])assert.throws(()=>generationDeadlineMs(v))
})

test('deadline cancels a provider that never resolves and disposes its session', async t => {
 t.mock.timers.enable({apis:['setTimeout']})
 let aborted=0,disposed=0,entered=false
 const session={abort:async()=>{aborted++},dispose:()=>{disposed++}}
 const result=generateWithinDeadline({create:async()=>session,prompt:async()=>{entered=true;return new Promise(()=>{})}}, {})
 const rejection=assert.rejects(result,/timed out/)
 while(!entered)await Promise.resolve()
 t.mock.timers.tick(30001);assert.equal(aborted,0)
 t.mock.timers.tick(60000);await rejection
 assert.equal(aborted,1);assert.equal(disposed,1)
})

test('owner cancellation disposes sessions created after cancellation', async () => {
 const controller=new AbortController();let release,disposed=0
 const ready=new Promise(r=>{release=r})
 const result=generateWithinDeadline({signal:controller.signal,create:async()=>ready,prompt:async()=>assert.fail('cancelled work cannot prompt')},{})
 controller.abort();await assert.rejects(result,/cancelled/)
 release({abort:async()=>{},dispose:()=>{disposed++}})
 await new Promise(r=>setImmediate(r));assert.equal(disposed,1)
})

test('one malformed structured response is corrected inside the same deadline', async () => {
 let calls=0,disposed=0
 const result=await generateWithinDeadline({create:async()=>({dispose:()=>{disposed++},abort:async()=>{}}),prompt:async(_s,text)=>{
  calls++;if(calls===1)return '{"suggestions":[{"advice":"check"}]}'
  assert.match(text,/formatCorrection/)
  return '{"suggestions":[]}'
 },validate:raw=>{if(raw.suggestions.some(s=>!s.evidenceIds))throw Error('Invalid generated suggestion')}},{topics:[],maxCandidates:8})
 assert.deepEqual(result,{suggestions:[]});assert.equal(calls,2);assert.equal(disposed,1)
})

test('persistent malformed JSON stops after one correction and disposes', async () => {
 let calls=0,disposed=0
 await assert.rejects(generateWithinDeadline({create:async()=>({dispose:()=>{disposed++},abort:async()=>{}}),prompt:async()=>{calls++;return 'invalid JSON'}},{}))
 assert.equal(calls,2);assert.equal(disposed,1)
})

test('a successful generation waits for asynchronous Harness disposal', async () => {
 let release, entered
 const disposal = new Promise(resolve => {release=resolve})
 const started = new Promise(resolve => {entered=resolve})
 let settled=false
 const work=generateWithinDeadline({create:async()=>({dispose:async()=>{entered();await disposal},abort:async()=>{}}),prompt:async()=>'{"suggestions":[]}'},{})
 work.then(()=>{settled=true})
 await started
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(settled,false)
 release();assert.deepEqual(await work,{suggestions:[]})
})

test('asynchronous Harness disposal failure rejects a successful generation', async () => {
 await assert.rejects(generateWithinDeadline({create:async()=>({dispose:async()=>{throw Error('fixture cleanup failure')},abort:async()=>{}}),prompt:async()=>'{"suggestions":[]}'},{}),/cleanup failure/)
})


test('generation failure phases are blind, bounded and emitted after cleanup', async () => {
  for(const phase of ['create','prompt','parse','validate','dispose']) {
    const events=[];const failure=Object.assign(new RangeError('PRIVATE_FAILURE_'+phase),{code:'PRIVATE_UNKNOWN_CODE'})
    let attempts=0
    const session={abort:async()=>{},dispose:async()=>{if(phase==='dispose')throw failure}}
    await assert.rejects(generateWithinDeadline({onDiagnostic:event=>events.push(event),
      create:async()=>{if(phase==='create')throw failure;return session},
      prompt:async()=>{attempts++;if(phase==='prompt')throw failure;return phase==='parse'?'{invalid':'{}'},
      validate:()=>{if(phase==='validate')throw failure}
    },{request:'PRIVATE_OWNER_TEXT'}),error=>phase==='parse'?error instanceof SyntaxError:error===failure)
    assert.equal(events.length,1);assert.equal(events[0].phase,phase)
    assert.equal(events[0].cleanup,phase==='create'?'not_started':phase==='dispose'?'failed':'completed')
    assert.equal(events[0].attempt,attempts);assert(!JSON.stringify(events).includes('PRIVATE_'))
    assert(Object.isFrozen(events[0]))
  }
})

test('cleanup failure retains the primary diagnostic without changing thrown identity', async () => {
  const events=[],cleanupFailure=Object.assign(new TypeError('PRIVATE_CLEANUP'),{code:'EPIPE'})
  await assert.rejects(generateWithinDeadline({onDiagnostic:event=>events.push(event),
    create:async()=>({abort:async()=>{},dispose:async()=>{throw cleanupFailure}}),prompt:async()=>'{invalid'
  },{}),error=>error===cleanupFailure)
  assert.equal(events.length,1);assert.equal(events[0].phase,'parse');assert.equal(events[0].errorName,'SyntaxError')
  assert.equal(events[0].cleanup,'failed');assert.equal(events[0].cleanupErrorName,'TypeError');assert.equal(events[0].cleanupErrorCode,'EPIPE')
  assert(!JSON.stringify(events).includes('PRIVATE_'))
})

test('deadline emits one terminal snapshot and late cleanup cannot rewrite it', async t => {
  t.mock.timers.enable({apis:['setTimeout']})
  const events=[];let dispose,closed=0
  const result=generateWithinDeadline({timeoutMs:1000,onDiagnostic:event=>events.push(event),
    create:async()=>({abort:async()=>{},dispose:()=>new Promise(resolve=>{dispose=()=>{closed++;resolve()}})}),
    prompt:async()=>new Promise(()=>{})
  },{})
  const rejected=assert.rejects(result,/timed out/)
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(1000);await rejected
  assert.equal(events.length,1);assert.equal(events[0].phase,'prompt');assert.equal(events[0].cleanup,'pending');assert.equal(events[0].timedOut,true)
  const snapshot=JSON.stringify(events);dispose();await new Promise(resolve=>setImmediate(resolve))
  assert.equal(closed,1);assert.equal(JSON.stringify(events),snapshot)
})

test('observer failures preserve generation errors and default behavior', async () => {
  for(const observer of [undefined,()=>{throw Error('PRIVATE_OBSERVER')},async()=>{throw Error('PRIVATE_ASYNC_OBSERVER')}]) {
    const failure=Object.freeze(new Error('PRIVATE_PROVIDER'))
    await assert.rejects(generateWithinDeadline({onDiagnostic:observer,create:async()=>{throw failure},prompt:async()=>assert.fail('no prompt')},{}),error=>error===failure)
    await new Promise(resolve=>setImmediate(resolve))
  }
})


test('a disabled generation observer never reads error accessors', async () => {
  let reads=0;const failure=new Error('PRIVATE_PROVIDER')
  Object.defineProperties(failure,{name:{get(){reads++;return 'PRIVATE_NAME'}},code:{get(){reads++;return 'PRIVATE_CODE'}}})
  await assert.rejects(generateWithinDeadline({create:async()=>{throw failure},prompt:async()=>assert.fail('no prompt')},{}),error=>error===failure)
  assert.equal(reads,0)
})
