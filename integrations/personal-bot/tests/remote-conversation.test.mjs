import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { protectProactivePath } from '../src/proactive-private.mjs'
import { RemoteConversation, validateRemoteSummary } from '../src/remote-conversation.mjs'
const row = (key,revision='a'.repeat(64)) => ({ key, machine:'synthetic-mac',sessionId:key,project:'/synthetic/project',revision,updatedAt:1,state:'settled',conclusion:'Computed total: 6',truncated:false,control:'report_only' })
test('all connected conclusions are paged, synthesized once, and retain source context after restart',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-conversation-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const batches=[];let calls=0
 const read=async cursor=>({ok:true,records:[row(cursor?'two':'one')],total:2,nextCursor:cursor?null:'page2',omitted:0})
 const synthesize=async input=>{calls++;return {summary:'Two task conclusions are available.',citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}}
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read,synthesize,publish:frame=>batches.push(frame)})
 await remote.poll();assert.equal(calls,1);assert.equal(batches.at(-1).messages.at(-1).sources.length,2)
 await remote.poll();assert.equal(calls,1)
 const recovered=new RemoteConversation({file:join(directory,'remote.json'),read,synthesize,publish:()=>{}})
 assert.equal(recovered.snapshot().messages.length,1);assert.match(recovered.context(),/synthetic-mac/)
 await recovered.poll();assert.equal(calls,1)
})
test('fake source IDs, changed quotes, and raw actions cannot authorize synthesis',()=>{
 const records=[row('one')]
 assert.throws(()=>validateRemoteSummary({summary:'done',citations:[{key:'fake',revision:'a'.repeat(64),quote:'total: 6'}]},records))
 assert.throws(()=>validateRemoteSummary({summary:'done',citations:[{key:'one',revision:'a'.repeat(64),quote:'total: 7'}]},records))
 assert.throws(()=>validateRemoteSummary({summary:'done',citations:[],action:'execute'},records))
})

test('failed synthesis is durably held, not secretly retried by later pushes',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-held-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let calls=0;const file=join(directory,'remote.json'),read=async()=>({ok:true,records:[row('one')],total:1,nextCursor:null,omitted:0})
 const synthesize=async()=>{calls++;throw Error('synthetic provider failure')}
 const remote=new RemoteConversation({file,read,synthesize,publish:()=>{}});await remote.poll();await remote.poll()
 const recovered=new RemoteConversation({file,read,synthesize,publish:()=>{}});await recovered.poll()
 assert.equal(calls,1);assert.equal(recovered.snapshot().heldCount,1);assert.equal(recovered.snapshot().state,'partial');assert.equal(recovered.snapshot().messages.length,0)
})

test('service publishes durable remote history without making an owner turn',async()=>{
 const {PersonalBotService}=await import('../src/service.mjs');let turns=0,polls=0
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async()=>{turns++;return ''}})
 const frame={state:'live',messages:[{id:'synthetic',text:'Pi reports a result.',sources:[]}]}
 service.attachRemoteUpdates({snapshot:()=>frame,poll:async()=>{polls++}})
 service.setState('idle','Owner reply');assert.deepEqual(service.status.remote,frame)
 service.servicePush(['odk.app.pi-sessions']);await Promise.resolve();assert.equal(polls,2);assert.equal(turns,0)
 await service.close()
})

test('remote startup failure releases the acquired Agent and reader without hiding its cause',async()=>{
 const {attachRemoteConversation}=await import('../src/remote-pi-reader.mjs')
 let agents=0,readers=0
 const cause=Error('synthetic reader initialization failure'),agent={remoteEnabled:true,close:async()=>{agents++}}
 await assert.rejects(attachRemoteConversation({agent,stateDir:'/unused',env:{},createReader:async()=>{throw cause}}),error=>error===cause)
 assert.equal(agents,1);assert.equal(readers,0)
})

test('malformed or wrong-identity task status cannot erase sibling reports or replace source identity',async()=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const tasks=[1,2,3,4].map(n=>({taskId:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,project:'/synthetic/project',updatedAt:'2026-10-17T00:00:00.000Z'}))
 const request=async(_target,request)=>{
  if(request.command==='list')return {tasks,endpointKind:'hosted'}
  const index=tasks.findIndex(task=>task.taskId===request.taskId)
  if(index===0)return {task:null}
  if(index===1)return {task:{...tasks[index],taskId:tasks[3].taskId,response:'wrong source'}}
  if(index===2)throw Error('synthetic unreachable source')
  return {task:{...tasks[index],response:'Reported total: 6',state:'settled'}}
 }
 const reader=await createRemotePiReader({targets:[{id:'cm5',roots:['/synthetic']}],link:{stop:async()=>{}},backfill:async()=>null,request})
 const page=await reader.read('hosted:0')
 assert.equal(page.records.length,4);assert.deepEqual(page.records.map(r=>r.availability),['unavailable','unavailable','unavailable','live'])
 assert.equal(page.records[1].sessionId,tasks[1].taskId);assert.equal(page.records[1].conclusion,'');assert.equal(page.records[3].conclusion,'Reported total: 6')
 await reader.close()
})

test('a remote follow-up uses the exact persisted control identity and refuses report-only or stale references',async()=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const task={taskId:'00000000-0000-0000-0000-000000000001',project:'/synthetic/project',response:'Reported result',state:'settled',revision:'c'.repeat(64)}
 const sent=[]
 const request=async(target,params)=>{sent.push({target:target.id,...params});return params.command==='list'?{tasks:[task],endpointKind:'hosted'}:params.command==='status'?{task}:{accepted:true,task}}
 const reader=await createRemotePiReader({targets:[{id:'cm5',roots:['/synthetic']}],link:{stop:async()=>{}},backfill:async()=>null,request})
 const source=(await reader.read('hosted:0')).records[0]
 await reader.followup(source,{sourceRevision:source.revision,prompt:'Owner follow-up'})
 assert.deepEqual(sent.at(-1),{target:'cm5',command:'prompt',project:task.project,taskId:task.taskId,prompt:'Owner follow-up',expectedRevision:task.revision})
 const count=sent.filter(call=>call.command==='prompt').length
 await assert.rejects(reader.followup({...source,control:'report_only'},{sourceRevision:source.revision,prompt:'Do not send'}),/report-only/)
 task.revision='d'.repeat(64)
 await assert.rejects(reader.followup(source,{sourceRevision:source.revision,prompt:'Do not send'}),/revision changed/)
 assert.equal(sent.filter(call=>call.command==='prompt').length,count);await reader.close()
})


test('a late synthesis after shutdown cannot publish or enter conversation history',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-close-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let release,started;const ready=new Promise(resolve=>{started=resolve}),frames=[]
 const remote=new RemoteConversation({file:join(directory,'state.json'),read:async()=>({ok:true,records:[row('one')],total:1,nextCursor:null,omitted:0}),publish:frame=>frames.push(frame),synthesize:()=>{started();return new Promise(resolve=>{release=resolve})}})
 const poll=remote.poll();await ready;const close=remote.close()
 release({summary:'Late report',citations:[{key:'one',revision:'a'.repeat(64),quote:'total: 6'}]})
 await Promise.all([poll,close]);assert.equal(frames.length,0);assert.equal(remote.snapshot().messages.length,0)
})

test('a corrupt remote checkpoint unwinds both acquired resources without changing its bytes',async t=>{
 const {attachRemoteConversation}=await import('../src/remote-pi-reader.mjs')
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-startup-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const parent=join(directory,'personal-agent');await mkdir(parent,{mode:0o700});protectProactivePath(parent)
 const file=join(parent,'remote-conversation.json');await writeFile(file,'invalid synthetic checkpoint',{mode:0o600});protectProactivePath(file)
 let agents=0,readers=0
 await assert.rejects(attachRemoteConversation({agent:{remoteEnabled:true,close:async()=>{agents++}},stateDir:directory,env:{},createReader:async()=>({close:async()=>{readers++}})}))
 assert.equal(agents,1);assert.equal(readers,1);assert.equal(await readFile(file,'utf8'),'invalid synthetic checkpoint')
})

test('remote conversation is an explicit reviewed selection requiring completion',async()=>{
 const {validateAgentPlugins}=await import('../src/agent-plugins/selection.mjs')
 assert.throws(()=>validateAgentPlugins({enabled:['remote_conversation']}))
 assert.deepEqual(validateAgentPlugins({enabled:['remote_conversation','completion']}),{enabled:['remote_conversation','completion'],autoLearn:true})
 assert.throws(()=>validateAgentPlugins({enabled:['completion','/arbitrary/extension.mjs']}))
})

test('oversized source disclosures retain bounded frames and an exact lookup for every omitted reference',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-large-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const records=Array.from({length:7},(_,index)=>({...row(`source-${index}`),project:'/'+ '中'.repeat(3000)}))
 const remote=new RemoteConversation({file:join(directory,'state.json'),read:async cursor=>({ok:true,records:cursor?records.slice(3):records.slice(0,3),total:7,omitted:cursor?0:4,nextCursor:cursor?null:'next'}),synthesize:async input=>({summary:'Pi reports seven results; execution remains unverified.',citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}),publish:()=>{}})
 await remote.poll();const frame=remote.snapshot(),message=frame.messages[0]
 assert(Buffer.byteLength(JSON.stringify(frame))<65536);assert(message.omittedSources>0);assert.equal(message.sources.length+message.omittedSourceKeys.length,7)
 for(const key of message.omittedSourceKeys)assert.equal(remote.reference(key).source.project,records[0].project)
})

test('a Windows local control inventory carries its native absolute project without POSIX rewriting',{skip:process.platform!=='win32'?'Actual Windows path semantics; local Mac checks do not execute this branch':false},async()=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const task={taskId:'00000000-0000-0000-0000-000000000001',project:'C:\\Developer\\synthetic',response:'Reported result',state:'settled',revision:'c'.repeat(64)}
 const reader=await createRemotePiReader({targets:[{id:'cm5',roots:['C:\\Developer']}],link:{stop:async()=>{}},backfill:async()=>null,request:async(_target,request)=>request.command==='list'?{tasks:[task],endpointKind:'hosted'}:{task}})
 assert.equal((await reader.read('hosted:0')).records[0].project,task.project);await reader.close()
})

test('remote citation evidence rejects JSON syntax and requires explicit metadata fields',()=>{
 const source={...row('one'),availability:'unavailable',conclusion:''},citation={key:source.key,revision:source.revision,quote:'key'}
 assert.throws(()=>validateRemoteSummary({summary:'Unavailable report',citations:[citation]},[source]))
 assert.throws(()=>validateRemoteSummary({summary:'Unavailable report',citations:[{...citation,quote:'unavailable'}]},[source]))
 assert.equal(validateRemoteSummary({summary:'Unavailable report',citations:[{...citation,field:'availability',quote:'unavailable'}]},[source]).summary,'Unavailable report')
})

test('long UTF8 summaries evict superseded history by bytes without losing current references or watermarks',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-retention-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let turn=0
 const rows=()=>Array.from({length:4},(_,index)=>({...row(`source-${index}`,turn.toString(16).padStart(64,'0')),project:'/'+ '中'.repeat(4000),updatedAt:turn}))
 const file=join(directory,'state.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:rows(),total:4,nextCursor:null,omitted:0}),synthesize:async input=>({summary:'中'.repeat(4000),citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}),publish:()=>{}})
 for(turn=1;turn<=36;turn++)await remote.poll()
 assert.equal(remote.snapshot().state,'live');assert.equal(remote.snapshot().heldCount,0);assert(remote.snapshot().expiredMessages>0)
 assert(Buffer.byteLength(await readFile(file,'utf8'))<=2*1024*1024)
 for(let index=0;index<4;index++)assert.equal(remote.reference(`source-${index}`).source.revision,(36).toString(16).padStart(64,'0'))
})

test('legal remote and proposal payloads do not consume the owner voice frame byte budget',async()=>{
 const {statusFrames}=await import('../src/socket.mjs')
 const status={v:1,type:'status',state:'idle',message:'中'.repeat(8192),transcript:'中'.repeat(4096),proposals:[{advice:'x'.repeat(48000)}],remote:{state:'live',messages:[{text:'x'.repeat(49000)}]}}
 const frames=statusFrames(status).map(frame=>JSON.parse(frame))
 assert.equal(frames[0].message,status.message);assert.equal(frames[0].transcript,status.transcript);assert.equal(frames[0].remote,undefined)
 assert.equal(frames.find(frame=>frame.type==='remote_conversation').remote.messages[0].text.length,49000)
})

test('alternating failed source revisions cannot silently replay a previous failed synthesis',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-held-revisions-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let revision='a'.repeat(64),calls=0
 const remote=new RemoteConversation({file:join(directory,'state.json'),read:async()=>({ok:true,records:[row('one',revision)],total:1,nextCursor:null,omitted:0}),synthesize:async()=>{calls++;throw Error('synthetic failure')},publish:()=>{}})
 await remote.poll();revision='b'.repeat(64);await remote.poll();revision='a'.repeat(64);await remote.poll()
 assert.equal(calls,2);assert.equal(remote.snapshot().heldCount,2)
})

test('normal disconnected-session churn archives old messages while retaining every watermark and the current reference',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-churn-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let turn=0
 const file=join(directory,'state.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:[row(`session-${turn}`)],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({summary:'Pi reports a conclusion.',citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}),publish:()=>{}})
 for(turn=1;turn<=65;turn++)await remote.poll()
 assert.equal(remote.snapshot().state,'live');assert.equal(remote.snapshot().heldCount,0);assert.equal(remote.snapshot().expiredMessages,1)
 assert.equal(remote.reference('session-65').source.sessionId,'session-65')
 assert.equal(JSON.parse(await readFile(file,'utf8')).seen.length,65)
})

test('a reappeared source remains present before a failed synthesis can expose its retained reference to expiry',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-reappear-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let phase=0
 const file=join(directory,'state.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:[row(phase===1?'other':'reappeared',phase===2?'c'.repeat(64):'a'.repeat(64))],total:1,nextCursor:null,omitted:0}),synthesize:async input=>{if(phase===2)throw Error('synthetic failure');return {summary:'Pi reports a conclusion.',citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}},publish:()=>{}})
 await remote.poll();phase=1;await remote.poll();phase=2;await remote.poll()
 const checkpoint=JSON.parse(await readFile(file,'utf8'))
 assert(checkpoint.present.includes('reappeared'),'host inventory is durable even when its new synthesis fails')
 assert.equal(remote.reference('reappeared').source.revision,'a'.repeat(64))
})
