import {test} from 'node:test'
import assert from 'node:assert/strict'
import {generationDeadlineMs, generateWithinDeadline} from '../src/proactive-generation-session.mjs'

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
