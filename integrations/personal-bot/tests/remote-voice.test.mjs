import { test as nodeTest } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersonalBotService } from '../src/service.mjs'
import { createDisplayVoice } from '../src/display-voice.mjs'
import { writeFile } from 'node:fs/promises'
import { createRemoteVoice } from '../src/remote-voice.mjs'

const test = (name, run) => nodeTest(name, { skip: process.platform === 'win32'
  ? 'Remote voice server runs on CM5; Windows capture transport is checked in display-voice.test.mjs' : false }, run)

const requestId='11111111-1111-4111-8111-111111111111'
function wav(bytes=640) {
 const b=Buffer.alloc(44+bytes);b.write('RIFF');b.writeUInt32LE(bytes+36,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b
}
async function fixture(t,options={}) {
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-voice-'))),frames=[],audio=[],prompts=[]
 const service=new PersonalBotService({record:async()=>{throw Error('Remote must not record centrally')},transcribe:async file=>{audio.push(await readFile(file));return '中央识别的语音'},prompt:async text=>{prompts.push(text);return '中央答复'}})
 const voice=createRemoteVoice({service,directory,...options}),client={},send=async frame=>{frames.push(frame)}
 t.after(async()=>{await voice.close();await service.close();await rm(directory,{recursive:true,force:true})})
 const handle=(command,owner=client,output=send)=>voice.handle(owner,{v:1,requestId,...command},output)
 const start=async()=>{await handle({type:'voice_start'});return frames.findLast(f=>f.type==='voice_started'&&f.accepted).leaseId}
 const chunk=(leaseId,bytes,seq=0)=>handle({type:'voice_chunk',leaseId,seq,data:bytes.toString('base64')})
 return {directory,frames,audio,prompts,service,voice,client,handle,start,chunk}
}

test('remote voice reserves before start acknowledgement and only a validated end enters central ASR',async t=>{
 const f=await fixture(t);let release
 const starting=f.handle({type:'voice_start'},f.client,frame=>{f.frames.push(frame);return new Promise(resolve=>{release=resolve})})
 assert.equal(f.service.status.state,'recording');assert.equal(f.service.sendText('Concurrent'),false)
 release();assert.equal(await starting,true);const lease=f.frames[0].leaseId
 await f.service.toggle();assert.equal(f.service.status.state,'recording');assert.equal(f.frames.filter(x=>x.type==='voice_stop').length,1);assert.equal(f.audio.length,0)
 const bytes=wav();await f.chunk(lease,bytes);await f.handle({type:'voice_end',leaseId:lease,seq:1})
 await new Promise(resolve=>setImmediate(resolve));await f.service.pending
 assert.deepEqual(f.audio,[bytes]);assert.deepEqual(f.prompts,['中央识别的语音']);assert.equal(f.service.status.message,'中央答复')
 assert.deepEqual(await readdir(f.directory),[])
 await f.handle({type:'voice_end',leaseId:lease,seq:1});assert.equal(f.audio.length,1)
})

test('voice ownership uses the actual connection and stale leases cannot cancel another capture',async t=>{
 const f=await fixture(t),lease=await f.start(),other={}
 await f.handle({type:'voice_cancel',leaseId:lease},other);assert.equal(f.service.status.state,'recording')
 await f.voice.close(other);assert.equal(f.service.status.state,'recording')
 await f.voice.close(f.client);assert.equal(f.audio.length,0)
 const lease2=await f.start();assert.notEqual(lease2,lease)
 await f.chunk(lease,wav());assert.equal(f.service.status.state,'recording')
 await f.chunk(lease2,wav());await f.handle({type:'voice_end',leaseId:lease2,seq:1})
 await new Promise(resolve=>setImmediate(resolve));await f.service.pending;assert.equal(f.audio.length,1)
})

test('invalid voice frames or WAV bytes cancel before ASR without retaining temporary audio',async t=>{
 const cases=[
  ['sequence jump',async(f,id)=>f.chunk(id,wav(),1)],
  ['duplicate sequence',async(f,id)=>{await f.chunk(id,wav());await f.chunk(id,wav())}],
  ['noncanonical base64',async(f,id)=>f.handle({type:'voice_chunk',leaseId:id,seq:0,data:'Zg==='})],
  ['oversized encoded chunk',async(f,id)=>f.handle({type:'voice_chunk',leaseId:id,seq:0,data:'A'.repeat(2052)})],
  ['wrong rate',async(f,id)=>{const b=wav();b.writeUInt32LE(48000,24);await f.chunk(id,b);await f.handle({type:'voice_end',leaseId:id,seq:1})}],
  ['wrong RIFF length',async(f,id)=>{const b=wav();b.writeUInt32LE(40,4);await f.chunk(id,b);await f.handle({type:'voice_end',leaseId:id,seq:1})}],
  ['empty audio',async(f,id)=>{await f.chunk(id,wav(0));await f.handle({type:'voice_end',leaseId:id,seq:1})}],
  ['extra keys',async(f,id)=>f.handle({type:'voice_chunk',leaseId:id,seq:0,data:'AAAA',path:'untrusted'})],
 ]
 for(const [name,act]of cases)await t.test(name,async t=>{const f=await fixture(t),id=await f.start();await act(f,id);await new Promise(r=>setImmediate(r));assert.equal(f.audio.length,0);assert.equal(f.prompts.length,0);assert.equal(f.service.status.state,'error');assert.deepEqual(await readdir(f.directory),[])})
})

test('a pending start can be cancelled without its lost lease receipt and late writes cannot hand off',async t=>{
 const f=await fixture(t);let release
 const pending=f.handle({type:'voice_start'},f.client,()=>new Promise(resolve=>{release=resolve}))
 await f.handle({type:'voice_cancel'});release();await pending
 assert.equal(f.audio.length,0);assert.equal(f.service.status.state,'idle');assert.equal(f.service.status.message,'')
})

test('display microphone failure is distinct from cancellation and admits a later text turn',async t=>{
 const f=await fixture(t),id=await f.start()
 await f.handle({type:'voice_cancel',leaseId:id,reason:'microphone'})
 assert.equal(f.service.status.state,'error');assert.equal(f.service.status.message,'Microphone unavailable')
 assert.equal(f.audio.length,0);assert.deepEqual(await readdir(f.directory),[])
 assert.equal(f.service.sendText('Use text instead'),true);await f.service.pending
 assert.equal(f.service.status.state,'idle')
})

test('a lost start receipt can report timeout without learning the lease identity',async t=>{
 const f=await fixture(t);let release
 const pending=f.handle({type:'voice_start'},f.client,()=>new Promise(resolve=>{release=resolve}))
 await f.handle({type:'voice_cancel',reason:'timeout'});release();await pending
 assert.equal(f.audio.length,0);assert.equal(f.service.status.state,'error')
 assert.equal(f.service.status.message,'Recording timed out. Try again.')
})

test('voice deadlines cancel recording without transcription and successful handoff survives disconnect',async t=>{
 const f=await fixture(t,{timeoutMs:10});await f.start();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(f.service.status.state,'error');assert.equal(f.audio.length,0)
 const g=await fixture(t);const id=await g.start();await g.chunk(id,wav());await g.handle({type:'voice_end',leaseId:id,seq:1});await g.voice.close(g.client)
 await new Promise(resolve=>setImmediate(resolve));await g.service.pending;assert.equal(g.audio.length,1);assert.equal(g.prompts.length,1)
})

test('a connection lost during final acknowledgement cannot start transcription',async t=>{
 const f=await fixture(t),id=await f.start();await f.chunk(id,wav());let release
 const ending=f.handle({type:'voice_end',leaseId:id,seq:1},f.client,()=>new Promise(resolve=>{release=resolve}))
 await f.voice.close(f.client);release();await ending
 assert.equal(f.audio.length,0);assert.equal(f.prompts.length,0);assert.deepEqual(await readdir(f.directory),[])
})


test('the real display and server exchange bounded audio without holding the frame reader for a later result',async t=>{
 const f=await fixture(t),file=join(f.directory,'display.wav'),bytes=wav(4000)
 await writeFile(file,bytes,{mode:0o600})
 let resolveDone,cleanups=0,display
 const recording={done:new Promise(resolve=>{resolveDone=resolve}),stop:async()=>{resolveDone();return file},cleanup:async()=>{cleanups++}}
 const outbound=async frame=>{display.onFrame(frame)}
 display=createDisplayVoice({send:command=>f.voice.handle(f.client,command,outbound).then(()=>{}),record:async()=>recording})
 t.after(()=>display.close());display.onFrame({v:1,type:'status',state:'idle'})
 await display.toggle();await new Promise(resolve=>setImmediate(resolve));await f.service.toggle()
 const end=Date.now()+2000
 while(f.service.status.state!=='idle'){assert.ok(Date.now()<end,'Central voice must finish');await new Promise(resolve=>setTimeout(resolve,5))}
 assert.deepEqual(f.audio,[bytes]);assert.equal(f.prompts.length,1);assert.equal(cleanups,1)
})

test('the aggregate audio ceiling and a blocked permission deadline fail before ASR',async t=>{
 const f=await fixture(t),id=await f.start(),chunk=Buffer.alloc(1536)
 for(let seq=0;seq<1251;seq++)await f.chunk(id,chunk,seq)
 assert.equal(f.service.status.state,'error');assert.equal(f.audio.length,0)
 const g=await fixture(t,{timeoutMs:5})
 await g.handle({type:'voice_start'},g.client,()=>new Promise(()=>{}))
 assert.equal(g.service.status.state,'error');assert.equal(g.audio.length,0)
})


test('central cancellation waits for display cleanup before releasing its recording slot', async t => {
 const f=await fixture(t);let display,release,records=0,cleanups=0
 const cleanupGate=new Promise(resolve=>{release=resolve})
 const recording={done:new Promise(()=>{}),stop:async()=>{throw Error('Cancelled audio must not upload')},cleanup:async()=>{cleanups++;await cleanupGate}}
 const outbound=async frame=>{f.frames.push(frame);display.onFrame(frame)}
 display=createDisplayVoice({send:command=>f.voice.handle(f.client,command,outbound).then(()=>{}),record:async()=>{records++;return recording}})
 t.after(()=>display.close());const unsubscribe=f.service.subscribe(status=>display.onFrame({v:1,type:'status',...status}));t.after(unsubscribe)
 display.onFrame({v:1,type:'status',state:'idle'});await display.toggle();await new Promise(setImmediate)
 const cancellation=f.service.cancelRecording();await new Promise(setImmediate)
 assert.equal(f.service.status.state,'recording','central ownership survives pending physical cleanup')
 assert.equal(await display.toggle(),false);assert.equal(records,1);assert.equal(cleanups,1)
 release();assert.equal(await cancellation,true);await new Promise(setImmediate)
 assert.equal(f.service.status.state,'idle');assert.equal(f.audio.length,0);assert.equal(f.prompts.length,0)
 assert.equal(await display.toggle(),true);await new Promise(setImmediate);assert.equal(records,2)
})

test('central cancellation cannot report success or acquire again after display cleanup fails', async t => {
 const f=await fixture(t);let display,records=0,failed=true,cleanups=0
 const recording={done:new Promise(()=>{}),stop:async()=>{throw Error('Cancelled audio must not upload')},cleanup:async()=>{cleanups++;if(failed)throw Error('Controlled cleanup failure')}}
 const outbound=async frame=>{f.frames.push(frame);display.onFrame(frame)}
 display=createDisplayVoice({send:command=>f.voice.handle(f.client,command,outbound).then(()=>{}),record:async()=>{records++;return recording}})
 t.after(()=>display.close());const unsubscribe=f.service.subscribe(status=>display.onFrame({v:1,type:'status',...status}));t.after(unsubscribe)
 display.onFrame({v:1,type:'status',state:'idle'});await display.toggle();await new Promise(setImmediate)
 let settled=false;const cancellation=f.service.cancelRecording().then(value=>{settled=true;return value});await new Promise(setImmediate);await new Promise(setImmediate)
 assert.equal(f.service.status.state,'recording');assert.equal(settled,false)
 assert.equal(await display.toggle(),false);assert.equal(records,1);assert.equal(cleanups,1)
 failed=false;await display.close();await f.voice.close(f.client);await cancellation
 assert.equal(f.service.status.state,'error');assert.equal(cleanups,2);assert.equal(f.audio.length,0)
})

test('a late start acknowledgement cannot overwrite a central cancellation reservation', async t => {
 const f=await fixture(t);let release
 const starting=f.handle({type:'voice_start'},f.client,frame=>{f.frames.push(frame);return frame.type==='voice_started'?new Promise(resolve=>{release=resolve}):Promise.resolve()})
 const lease=f.frames[0].leaseId,cancellation=f.service.cancelRecording()
 await new Promise(setImmediate);release();await starting
 await f.chunk(lease,wav());await f.handle({type:'voice_end',leaseId:lease,seq:1});await new Promise(setImmediate)
 assert.equal(f.service.status.state,'recording');assert.equal(f.audio.length,0)
 await f.handle({type:'voice_cancel',leaseId:lease});assert.equal(await cancellation,true)
 assert.equal(f.service.status.state,'idle')
})

test('cancellation refuses completed audio handoff without leaving an unresolved request', async t => {
 const f=await fixture(t),lease=await f.start();await f.chunk(lease,wav());let release
 const ending=f.handle({type:'voice_end',leaseId:lease,seq:1},f.client,()=>new Promise(resolve=>{release=resolve}))
 t.after(()=>release())
 let settled=false,result
 const cancellation=f.service.cancelRecording().then(value=>{settled=true;result=value})
 await new Promise(setImmediate);assert.equal(settled,true);assert.equal(result,false)
 release();await ending;await new Promise(setImmediate);await f.service.pending;await cancellation
 assert.equal(f.audio.length,1);assert.equal(f.prompts.length,1);assert.equal(f.service.status.state,'idle')
})
