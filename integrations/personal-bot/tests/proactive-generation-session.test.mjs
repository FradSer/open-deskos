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
