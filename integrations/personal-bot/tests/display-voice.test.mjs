import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDisplayVoice } from '../src/display-voice.mjs'

const leaseId='22222222-2222-4222-8222-222222222222'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function until(predicate) {
 const end=Date.now()+2000
 while(!predicate()){assert.ok(Date.now()<end,'Expected voice checkpoint');await new Promise(resolve=>setTimeout(resolve,5))}
}
async function fixture(t,options={}) {
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-display-voice-'))),file=join(directory,'audio.wav'),frames=[]
 const bytes=Buffer.alloc(4000);await writeFile(file,bytes,{mode:0o600})
 let resolveDone,records=0,stops=0,cleanups=0
 const recording={done:new Promise(resolve=>{resolveDone=resolve}),stop:async()=>{stops++;resolveDone();return file},cleanup:async()=>{cleanups++}}
 const voice=createDisplayVoice({send:async frame=>{frames.push(frame)},record:async()=>{records++;return recording},...options})
 voice.onFrame({v:1,type:'status',state:'idle'})
 t.after(async()=>{await voice.close();await rm(directory,{recursive:true,force:true})})
 const accepted=async()=>{await voice.toggle();const request=frames.find(f=>f.type==='voice_start');voice.onFrame({v:1,type:'voice_started',requestId:request.requestId,leaseId,accepted:true});await tick();return request.requestId}
 return{voice,recording,file,bytes,frames,accepted,done:()=>resolveDone(),records:()=>records,stops:()=>stops,cleanups:()=>cleanups}
}

test('the display waits for its matching start receipt and uploads a recording once in bounded chunks',async t=>{
 const f=await fixture(t);await f.voice.toggle();assert.equal(f.records(),0)
 const id=f.frames[0].requestId
 f.voice.onFrame({v:1,type:'voice_started',requestId:'wrong-owner',leaseId,accepted:true});assert.equal(f.records(),0)
 f.voice.onFrame({v:1,type:'voice_started',requestId:id,leaseId,accepted:true});await tick();assert.equal(f.records(),1)
 assert.equal(f.voice.onFrame({v:1,type:'voice_stop',requestId:id,leaseId}),true)
 await until(()=>f.frames.some(x=>x.type==='voice_end'))
 const chunks=f.frames.filter(x=>x.type==='voice_chunk'),end=f.frames.filter(x=>x.type==='voice_end')
 assert.equal(end.length,1);assert.equal(f.stops(),1);assert.deepEqual(Buffer.concat(chunks.map(x=>Buffer.from(x.data,'base64'))),f.bytes)
 assert.ok(chunks.every((x,i)=>x.seq===i&&x.data.length<=2048));assert.equal(end[0].seq,chunks.length)
 f.voice.onFrame({v:1,type:'voice_result',requestId:id,leaseId,accepted:true});await tick();assert.equal(f.cleanups(),1)
})

test('a source stop frame returns synchronously while upload backpressure waits for later receipt frames',async t=>{
 let release;const frames=[]
 const f=await fixture(t,{send:async frame=>{frames.push(frame);if(frame.type==='voice_chunk')await new Promise(resolve=>{release=resolve})}})
 await f.voice.toggle();const id=frames[0].requestId;f.voice.onFrame({v:1,type:'voice_started',requestId:id,leaseId,accepted:true});await tick()
 assert.equal(f.voice.onFrame({v:1,type:'voice_stop',requestId:id,leaseId}),true);await until(()=>Boolean(release));assert.ok(release)
 const closing=f.voice.close();release();await closing;await tick()
 assert.equal(frames.filter(x=>x.type==='voice_end').length,0);assert.equal(f.cleanups(),1)
})

test('a lost start receipt is cancelled by original request and late acceptance never records or retries',async t=>{
 const f=await fixture(t,{startTimeoutMs:5});await f.voice.toggle();const id=f.frames[0].requestId
 await new Promise(resolve=>setTimeout(resolve,15))
 assert.deepEqual(f.frames.map(x=>x.type),['voice_start','voice_cancel']);assert.equal(f.frames[1].requestId,id);assert.equal(Object.hasOwn(f.frames[1],'leaseId'),false)
 f.voice.onFrame({v:1,type:'voice_started',requestId:id,leaseId,accepted:true});await tick();assert.equal(f.records(),0);assert.equal(f.frames.filter(x=>x.type==='voice_start').length,1)
})

test('a display with no local lease stops the central microphone through the existing toggle',async t=>{
 const f=await fixture(t);assert.equal(f.voice.onFrame({v:1,type:'status',state:'recording'}),false)
 assert.equal(await f.voice.toggle(),true);assert.deepEqual(f.frames,[{v:1,type:'toggle'}]);assert.equal(f.records(),0)
})

test('microphone acquisition failure reports a bounded cause instead of a normal cancellation',async t=>{
 const f=await fixture(t,{record:async()=>{throw Error('private device diagnostic')}})
 await f.accepted();await until(()=>f.frames.some(x=>x.type==='voice_cancel'))
 assert.equal(f.frames.find(x=>x.type==='voice_cancel').reason,'microphone')
 assert.ok(!JSON.stringify(f.frames).includes('private device diagnostic'))
})

test('late acquisition after disconnect only cleans up and cannot upload',async t=>{
 let acquire
 const f=await fixture(t,{record:()=>new Promise(resolve=>{acquire=resolve})});await f.voice.toggle();const id=f.frames[0].requestId
 f.voice.onFrame({v:1,type:'voice_started',requestId:id,leaseId,accepted:true});await tick();await f.voice.close()
 acquire(f.recording);await tick();assert.equal(f.cleanups(),1);assert.equal(f.frames.some(x=>x.type==='voice_chunk'||x.type==='voice_end'),false)
})

test('VAD and repeated stop events cannot send the same audio twice or accept another lease',async t=>{
 const f=await fixture(t),id=await f.accepted();f.done()
 f.voice.onFrame({v:1,type:'voice_stop',requestId:id,leaseId:'33333333-3333-4333-8333-333333333333'})
 await until(()=>f.frames.some(x=>x.type==='voice_end'));f.voice.onFrame({v:1,type:'voice_stop',requestId:id,leaseId});await tick()
 assert.equal(f.frames.filter(x=>x.type==='voice_end').length,1);assert.equal(f.records(),1);assert.equal(f.stops(),1)
})
