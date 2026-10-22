import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { protectProactivePath } from '../src/proactive-private.mjs'
import { RemoteConversation, validateRemoteSummary, validateRemoteReview } from '../src/remote-conversation.mjs'
const row = (key,revision='a'.repeat(64)) => ({ key, machine:'synthetic-mac',sessionId:key,project:'/synthetic/project',revision,updatedAt:1,state:'settled',availability:'live',conclusionOutcome:'reported_finished',eventId:revision,latestEventIsAssistant:true,conclusionIsLatestAssistant:true,conclusion:'Computed total: 6',truncated:false,control:'report_only' })
const updates = (value, records) => [{text:value,taskName:'Task result',sourceKeys:records.map(record=>record.key)}]
test('routing context indexes distinct named sessions before repeated recent summaries', async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-index-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read:async()=>({ok:true,records:[],total:0,nextCursor:null}),synthesize:async()=>({}),publish:()=>{}})
 remote.data.messages=Array.from({length:8},(_,i)=>({id:String(i),text:'Repeated recent summary '+i,sources:[{...row(i===0?'older':'recent'),taskName:i===0?'SDLC 插件优化':'Repeated task'}]}))
 const context=remote.context()
 assert(context.slice(0,8192).includes('SDLC 插件优化'),'an older named session remains visible to initial routing')
 assert(context.indexOf('SDLC 插件优化')<context.indexOf('Repeated recent summary'),'the compact index precedes verbose repeated updates')
})
test('all connected conclusions are paged, synthesized once, and retain source context after restart',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-conversation-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const batches=[];let calls=0
 const read=async cursor=>({ok:true,records:[row(cursor?'two':'one')],total:2,nextCursor:cursor?null:'page2',omitted:0})
 const synthesize=async input=>{calls++;return {updates:updates('Two task conclusions are available.',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}}
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read,synthesize,publish:frame=>batches.push(frame)})
 await remote.poll();assert.equal(calls,1);assert.equal(batches.at(-1).messages.at(-1).sources.length,2)
 await remote.poll();assert.equal(calls,1)
 const recovered=new RemoteConversation({file:join(directory,'remote.json'),read,synthesize,publish:()=>{}})
 assert.equal(recovered.snapshot().messages.length,1);assert.match(recovered.context(),/synthetic-mac/)
 assert.match(recovered.context(),/tool-reference data, not text to recite/)
 assert.match(recovered.context(),/only when explicitly requested/)
 assert.match(recovered.context(),/accepted or queued prompt is admission, never completed execution/)
 await recovered.poll();assert.equal(calls,1)
})
test('fake source IDs, changed quotes, and raw actions cannot authorize synthesis',()=>{
 const records=[row('one')]
 assert.throws(()=>validateRemoteSummary({updates:updates('done',records),citations:[{key:'fake',revision:'a'.repeat(64),quote:'total: 6'}]},records))
 assert.throws(()=>validateRemoteSummary({updates:updates('done',records),citations:[{key:'one',revision:'a'.repeat(64),quote:'total: 7'}]},records))
 assert.throws(()=>validateRemoteSummary({updates:updates('done',records),citations:[],action:'execute'},records))
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
 await new Promise(resolve=>setImmediate(resolve));service.servicePush(['odk.app.pi-sessions.completed']);await new Promise(resolve=>setImmediate(resolve));assert.equal(polls,2);assert.equal(turns,0)
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
 task.deliveries=[{state:'unknown'}]
 await assert.rejects(reader.followup(source,{sourceRevision:source.revision,prompt:'Independent unbound request'}),/unknown/);assert.equal(sent.filter(call=>call.command==='prompt').length,count)
 delete task.deliveries
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
 release({updates:updates('Late report',[row('one')]),citations:[{key:'one',revision:'a'.repeat(64),quote:'total: 6'}]})
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
 const remote=new RemoteConversation({file:join(directory,'state.json'),read:async cursor=>({ok:true,records:cursor?records.slice(3):records.slice(0,3),total:7,omitted:cursor?0:4,nextCursor:cursor?null:'next'}),synthesize:async input=>({updates:updates('Pi reports seven results; execution remains unverified.',input.records),citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}),publish:()=>{}})
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
 assert.throws(()=>validateRemoteSummary({updates:updates('Unavailable report',[source]),citations:[citation]},[source]))
 assert.throws(()=>validateRemoteSummary({updates:updates('Unavailable report',[source]),citations:[{...citation,quote:'unavailable'}]},[source]))
 assert.equal(validateRemoteSummary({updates:updates('Unavailable report',[source]),citations:[{...citation,field:'availability',quote:'unavailable'}]},[source]).updates[0].text,'Unavailable report')
})

test('long UTF8 summaries evict superseded history by bytes without losing current references or watermarks',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-retention-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let turn=0
 const rows=()=>Array.from({length:4},(_,index)=>({...row(`source-${index}`,turn.toString(16).padStart(64,'0')),project:'/'+ '中'.repeat(4000),updatedAt:turn}))
 const file=join(directory,'state.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:rows(),total:4,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('中'.repeat(600),input.records),citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}),publish:()=>{}})
 for(turn=1;turn<=48;turn++)await remote.poll()
 assert.equal(remote.snapshot().state,'live');assert.equal(remote.snapshot().heldCount,0);assert(remote.snapshot().expiredMessages>0)
 assert(Buffer.byteLength(await readFile(file,'utf8'))<=2*1024*1024)
 for(let index=0;index<4;index++)assert.equal(remote.reference(`source-${index}`).source.revision,(48).toString(16).padStart(64,'0'))
})

test('legal remote and RidePreview proposal payloads do not consume the owner voice frame byte budget',async t=>{
 const {statusFrames}=await import('../src/socket.mjs')
 const {validRidePreview}=await import('../src/didi/preview.mjs')
 const place={handle:'place',name:'地点'.repeat(32),city:'测试市',address:'地址'.repeat(32),location:{lng:1,lat:2}}
 const ridePreview={handle:'preview',status:'quoted',from:[place],to:[place],expiresAt:120000,measuredAt:new Date(0).toISOString(),items:Array.from({length:16},()=>({productName:'中'.repeat(128),productCategory:'1',priceText:'元'.repeat(64)}))}
 assert(validRidePreview(ridePreview))
 const {proposalStateStore}=await import('../src/proactive-state.mjs')
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-ride-frame-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const proposals=Array.from({length:3},(_,index)=>{const id=`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`;return {id,ruleId:`intent-${id}`,subject:'synthetic',ruleVersion:'1',status:'pending',advice:'中'.repeat(1000),confirmation:'',result:'',createdAt:new Date(0).toISOString(),action:null,offered:true,presented:true,evidence:[{readingId:'fixture',field:'value',ruleId:`intent-${id}`,state:'live',measuredAt:new Date(0).toISOString(),value:'中'.repeat(100)}],ridePreview}})
 assert(Buffer.byteLength(JSON.stringify(proposals))<=48000)
 const store=proposalStateStore(join(directory,'state.json'));store.save({version:1,proposals});assert.deepEqual(store.load().proposals,proposals)
 const status={v:1,type:'status',state:'idle',message:'中'.repeat(8192),transcript:'中'.repeat(4096),proposals,remote:{state:'live',messages:Array.from({length:4},()=>({text:'中'.repeat(4000)}))}}
 const frames=statusFrames(status).map(frame=>JSON.parse(frame))
 assert.equal(frames[0].message,status.message);assert.equal(frames[0].transcript,status.transcript);assert.equal(frames[0].remote,undefined)
 assert.deepEqual(frames[0].proposals[0].ridePreview,ridePreview)
 assert.deepEqual(frames.find(frame=>frame.type==='remote_conversation').remote.messages,status.remote.messages)
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
 let turn=0,calls=0
 const file=join(directory,'state.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:[row(`session-${turn}`)],total:1,nextCursor:null,omitted:0}),synthesize:async input=>{calls++;return {updates:updates('Pi reports a conclusion.',input.records),citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}},publish:()=>{}})
 for(turn=1;turn<=65;turn++)await remote.poll()
 assert.equal(remote.snapshot().state,'live');assert.equal(remote.snapshot().heldCount,0);assert.equal(remote.snapshot().expiredMessages,1)
 assert.equal(remote.reference('session-65').source.sessionId,'session-65')
 assert.equal(JSON.parse(await readFile(file,'utf8')).seen.length,65)
 assert.equal(calls,65)
 turn=1;await remote.poll();assert.equal(calls,65,'Expired presentation must not replay a successfully presented revision')
 const restored=new RemoteConversation({file,read:async()=>({ok:true,records:[row('session-1')],total:1,nextCursor:null,omitted:0}),synthesize:async()=>assert.fail('No repeat after restart'),publish:()=>{}})
 await restored.poll();assert.equal(restored.snapshot().heldCount,0)
})

test('a reappeared source remains present before a failed synthesis can expose its retained reference to expiry',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-reappear-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let phase=0
 const file=join(directory,'state.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:[row(phase===1?'other':'reappeared',phase===2?'c'.repeat(64):'a'.repeat(64))],total:1,nextCursor:null,omitted:0}),synthesize:async input=>{if(phase===2)throw Error('synthetic failure');return {updates:updates('Pi reports a conclusion.',input.records),citations:input.records.map(source=>({key:source.key,revision:source.revision,quote:'total: 6'}))}},publish:()=>{}})
 await remote.poll();phase=1;await remote.poll();phase=2;await remote.poll()
 const checkpoint=JSON.parse(await readFile(file,'utf8'))
 assert(checkpoint.present.includes('reappeared'),'host inventory is durable even when its new synthesis fails')
 assert.equal(remote.reference('reappeared').source.revision,'a'.repeat(64))
})


test('faithfulness review uses exact report references without execution certification fields',()=>{
 const records=[row('one'),row('two','b'.repeat(64))]
 const review={status:'passed',reason:'Both are attributed reports, not independently verified calculations.',citations:records.map(record=>({key:record.key,revision:record.revision,field:'conclusion',quote:'Computed total: 6'}))}
 assert.equal(validateRemoteReview(review,records),review)
 assert.equal(validateRemoteReview({...review,status:'needs_review'},records).status,'needs_review')
 for(const patch of [{status:'verified'},{reason:''},{reason:'x'.repeat(1001)},{executionVerified:true},{computationVerified:true},{scope:'completion'},{citations:[]},{citations:[review.citations[0],review.citations[0]]},{citations:[{...review.citations[0],revision:'c'.repeat(64)},review.citations[1]]},{citations:[{...review.citations[0],quote:'Computed total: 7'},review.citations[1]]}])assert.throws(()=>validateRemoteReview({...review,...patch},records))
 const unavailable={...row('missing'),conclusion:'',availability:'unavailable'}
 assert.equal(validateRemoteReview({status:'needs_review',reason:'The unavailable report cannot support this summary.',citations:[{key:unavailable.key,revision:unavailable.revision,field:'availability',quote:'unavailable'}]},[unavailable]).status,'needs_review')
})


test('short assistant updates partition tasks and retain per-message source ownership', () => {
 const records=[row('build'),row('design')]
 const value={updates:[{text:'构建已完成，日志里有六项检查结果。',taskName:'Task result',sourceKeys:['build']},{text:'界面调整还在进行，暂时没有新的结果。',taskName:'Task result',sourceKeys:['design']}],citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}
 assert.equal(validateRemoteSummary(value,records),value)
 for(const updates of [[],[{text:'结果',taskName:'Task result',sourceKeys:['build']}],[{text:'结果',taskName:'Task result',sourceKeys:['build','design']},{text:'重复',taskName:'Task result',sourceKeys:['build']}],[{text:'结果',taskName:'Task result',sourceKeys:['unknown','design']}],[{text:'x'.repeat(601),taskName:'Task result',sourceKeys:['build','design']}],[{text:'结果',taskName:'Task result',sourceKeys:[]}],[{text:'结果',taskName:'Task result',sourceKeys:['build','design'],action:'run'}]])assert.throws(()=>validateRemoteSummary({...value,updates},records))
 assert.throws(()=>validateRemoteSummary({...value,summary:'old schema'},records))
 assert.equal(validateRemoteSummary({...value,updates:[{text:'😀'.repeat(300),taskName:'Task result',sourceKeys:['build','design']}]},records).updates[0].text.length,600)
 assert.throws(()=>validateRemoteSummary({...value,updates:[{text:'😀'.repeat(301),taskName:'Task result',sourceKeys:['build','design']}]},records))
 const many=Array.from({length:4},(_,i)=>row(`key-${i}`)),citations=many.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))
 assert.throws(()=>validateRemoteSummary({updates:many.map(r=>({text:'中'.repeat(501),taskName:'Task result',sourceKeys:[r.key]})),citations},many))
 assert.equal(validateRemoteSummary({updates:many.map(r=>({text:'中'.repeat(500),taskName:'Task result',sourceKeys:[r.key]})),citations},many).updates.length,4)
})

test('one durable batch appends separate assistant messages and restores without replay',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-updates-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),records=[row('task-a'),row('task-b')];let calls=0
 const synthesize=async input=>{calls++;return {updates:input.records.map((r,i)=>({text:i?'第二项还在等待输入。':'第一项完成了本轮修改。',taskName:'Task result',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}}
 const read=async()=>({ok:true,records,total:2,nextCursor:null,omitted:0})
 const remote=new RemoteConversation({file,read,synthesize,publish:()=>{}})
 const saved=[],save=remote.save.bind(remote);remote.save=value=>{saved.push(structuredClone(value));return save(value)}
 await remote.poll()
 assert.equal(calls,1);const disk=JSON.parse(await readFile(file,'utf8'))
 assert.equal(disk.messages.length,2);assert.equal(saved.filter(s=>s.messages.length===2).length,1)
 assert.deepEqual(disk.messages.map(m=>m.text),['第一项完成了本轮修改。','第二项还在等待输入。'])
 assert.deepEqual(disk.messages.map(m=>m.sources.map(s=>s.key)),[['task-a'],['task-b']])
 assert(disk.messages.every(m=>m.presentation==='assistant_update'&&m.verification==='reported_unverified'))
 assert.equal(new Set(disk.messages.map(m=>m.id)).size,2)
 const restored=new RemoteConversation({file,read,synthesize,publish:()=>{}});await restored.poll()
 assert.equal(calls,1);assert.deepEqual(restored.snapshot().messages,remote.snapshot().messages)
 assert.equal(restored.reference('task-a').messageId,disk.messages[0].id)
})


test('legacy checkpoint messages and held revisions survive new updates without migration',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-legacy-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),source=row('legacy'),held={key:'held',revision:'d'.repeat(64),updatedAt:1}
 const {conclusion,...ref}=source
 const legacy={id:'c'.repeat(64),at:1,text:'旧'.repeat(4000),sources:[ref],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
 const state={version:1,seen:[{key:source.key,revision:source.revision,updatedAt:1}],attempted:[held],messages:[legacy],cursor:null}
 await writeFile(file,JSON.stringify(state),{mode:0o600});protectProactivePath(file)
 let calls=0
 const make=()=>new RemoteConversation({file,read:async()=>({ok:true,records:[row('new')],total:1,nextCursor:null,omitted:0}),synthesize:async input=>{calls++;return {updates:updates('新任务有进展。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}})
 const remote=make();assert.deepEqual(remote.snapshot().messages[0].text,legacy.text)
 await remote.poll();const next=JSON.parse(await readFile(file,'utf8'))
 assert.deepEqual(next.messages[0],legacy);assert.deepEqual(next.attempted,[held]);assert.equal(next.version,1)
 assert.equal(next.messages[1].presentation,'assistant_update');assert.equal(remote.snapshot().heldCount,1)
 const restored=make();await restored.poll();assert.equal(calls,1);assert.deepEqual(JSON.parse(await readFile(file,'utf8')).messages,next.messages)
 const invalid={...next,messages:[{...legacy,presentation:'arbitrary_role'}]};await writeFile(file,JSON.stringify(invalid),{mode:0o600})
 assert.throws(make,/Invalid remote conversation records/)
 await writeFile(file,JSON.stringify({...next,seen:[{...next.seen[0],presentation:'arbitrary_role'}]}),{mode:0o600})
 assert.throws(make,/Invalid remote conversation records/)
})

test('assistant message order and exact references survive restart across an eight-message page',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-update-pages-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),records=Array.from({length:9},(_,i)=>row(`task-${i}`));let calls=0
 const options={file,read:async cursor=>{const offset=cursor?Number(cursor):0;return {ok:true,records:records.slice(offset,offset+4),total:9,omitted:Math.max(0,9-offset-4),nextCursor:offset+4<9?String(offset+4):null}},synthesize:async input=>{calls++;return {updates:input.records.map(r=>({text:`任务 ${r.key} 有新进展。`,taskName:'Task result',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();await remote.poll();await remote.poll()
 assert.equal(calls,3);const disk=JSON.parse(await readFile(file,'utf8'))
 assert.deepEqual(disk.messages.map(m=>m.sources[0].key),records.map(r=>r.key))
 const first=remote.snapshot(0,8),last=remote.snapshot(first.nextOffset,8)
 assert.equal(first.messages.length,8);assert.equal(last.messages.length,1);assert.equal(first.nextOffset,8)
 assert.deepEqual([...first.messages,...last.messages].reverse().map(m=>m.sources[0].key),records.map(r=>r.key))
 const restored=new RemoteConversation(options)
 assert.deepEqual(restored.snapshot().messages,first.messages)
 assert.deepEqual(restored.snapshot(8,8).messages,last.messages)
 for(const r of records)assert.equal(restored.reference(r.key).source.key,r.key)
 await restored.poll();assert.equal(calls,3)
})


test('an exact-seen legacy report stays unchanged without replaying history or held revisions',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-upgrade-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),current={...row('old'),availability:'live'},held={...row('held'),availability:'live'},legacyRef=Object.fromEntries(Object.entries(current).filter(([key])=>key!=='conclusion'))
 const legacy={id:'c'.repeat(64),at:1,text:'Earlier report unchanged.',sources:[legacyRef],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
 const prior={version:1,seen:[current,held].map(r=>({key:r.key,revision:r.revision,updatedAt:r.updatedAt,availability:r.availability})),attempted:[{key:held.key,revision:held.revision,updatedAt:held.updatedAt}],messages:[legacy],cursor:null}
 await writeFile(file,JSON.stringify(prior),{mode:0o600});protectProactivePath(file)
 let calls=0
 const options={file,read:async()=>({ok:true,records:[current,held],total:2,omitted:0,nextCursor:null}),synthesize:async input=>{calls++;assert.deepEqual(input.records,[current]);return {updates:updates('这项任务已经给出了结果。',input.records),citations:[{key:current.key,revision:current.revision,quote:'total: 6'}]}},publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();await remote.poll()
 const next=JSON.parse(await readFile(file,'utf8'));assert.equal(calls,0);assert.equal(next.messages.length,1)
 assert.deepEqual(next.messages[0],legacy);assert.deepEqual(next.seen.map(({completion,...source})=>source),prior.seen);assert.deepEqual(next.attempted.map(({completion,...source})=>source),prior.attempted)
 for(const source of [...next.seen,...next.attempted])assert.match(source.completion,/^[a-f0-9]{64}$/)
 assert.equal(remote.snapshot().heldCount,1)
 const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,0);assert.deepEqual(restored.snapshot().messages,remote.snapshot().messages)
})

test('new completion rejection remains held while already-seen legacy history stays intact',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-upgrade-held-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),current=row('old'),{conclusion,...reference}=current
 const legacy={id:'c'.repeat(64),at:1,text:'Earlier report unchanged.',sources:[reference],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
 await writeFile(file,JSON.stringify({version:1,seen:[{key:current.key,revision:current.revision,updatedAt:1}],attempted:[],messages:[legacy],cursor:null}),{mode:0o600});protectProactivePath(file)
 let calls=0
 const options={file,read:async()=>({ok:true,records:[{...current,revision:'e'.repeat(64),eventId:'new-failed-turn',updatedAt:2}],total:1,omitted:0,nextCursor:null}),synthesize:async()=>{calls++;throw Error('synthetic review rejection')},publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();await remote.poll()
 const restored=new RemoteConversation(options);await restored.poll()
 assert.equal(calls,1);assert.equal(restored.snapshot().heldCount,1);assert.equal(restored.snapshot().state,'partial')
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')).messages,[legacy])
})

test('already-seen legacy history at capacity is not rewritten or expired by reconnect',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-upgrade-capacity-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),current=row('current'),{conclusion,...reference}=current
 const messages=Array.from({length:64},(_,i)=>({id:(i+1).toString(16).padStart(64,'0'),at:i,text:`Earlier report ${i}.`,sources:[{...reference,revision:i===63?current.revision:(i+1).toString(16).padStart(64,'0')}],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}))
 await writeFile(file,JSON.stringify({version:1,seen:[{key:current.key,revision:current.revision,updatedAt:1}],attempted:[],messages,cursor:null}),{mode:0o600});protectProactivePath(file)
 let calls=0
 const options={file,read:async()=>({ok:true,records:[current],total:1,omitted:0,nextCursor:null}),synthesize:async input=>{calls++;return {updates:updates('这项任务的本轮结果已经到了。',input.records),citations:[{key:current.key,revision:current.revision,quote:'total: 6'}]}},publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll()
 const next=JSON.parse(await readFile(file,'utf8'));assert.equal(calls,0);assert.equal(next.messages.length,64);assert.equal(next.expiredMessages,0)
 assert.deepEqual(next.messages,messages)
 assert.equal(remote.reference(current.key).messageId,next.messages[63].id)
 const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,0)
})


test('remote synthesis waits for a real terminal conclusion and deduplicates metadata-only revisions',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-completion-only-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'state.json');let current={...row('task'),state:'running'},calls=0
 const options={file,read:async()=>({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async({records})=>{calls++;return {updates:updates('任务有最终结果。',records),citations:records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))}},publish:()=>{}}
 const remote=new RemoteConversation(options)
 await remote.poll();assert.equal(calls,0,'progress is not a completion')
 current={...row('task'),conclusion:''};await remote.poll();assert.equal(calls,0,'missing result is not a message')
 for(const patch of [{eventId:null},{conclusionOutcome:undefined},{conclusionOutcome:'unknown'},{latestEventIsAssistant:false},{currentTurnId:'active-turn'}]){current={...row('task'),...patch};await remote.poll();assert.equal(calls,0,'missing identity or terminal evidence never creates a placeholder')}
 current={...row('task'),availability:'unavailable'};await remote.poll();assert.equal(calls,0)
 current=row('task');await remote.poll();assert.equal(calls,1)
 current={...current,revision:'b'.repeat(64),updatedAt:2};await remote.poll();assert.equal(calls,1,'same event with changed metadata is not new work')
 const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,1)
 current={...row('task','c'.repeat(64)),state:'cancelled',conclusionOutcome:'cancelled',conclusion:'The task was cancelled.'}
 await restored.poll();assert.equal(calls,2);assert.equal(restored.snapshot().messages[0].sources[0].state,'cancelled')
})

test('remote refresh is event driven and retains a completion hint received while busy',async t=>{
 const {PersonalBotService}=await import('../src/service.mjs');let timers=0,polls=0
 t.mock.method(globalThis,'setInterval',()=>{timers++;return {unref(){}}})
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async()=>''})
 t.after(()=>service.close())
 service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{polls++}})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(timers,0);assert.equal(polls,1)
 service.setState('thinking');service.servicePush(['odk.app.pi-sessions.completed']);service.servicePush(['odk.app.pi-sessions.completed'])
 await new Promise(resolve=>setImmediate(resolve));assert.equal(polls,1)
 service.setState('idle');await new Promise(resolve=>setImmediate(resolve));assert.equal(polls,2)
 service.servicePush(['odk.app.pi-sessions']);await new Promise(resolve=>setImmediate(resolve));assert.equal(polls,2,'generic progress is not a completion hint')
})


test('replacing a remote source during a pending drain cannot lose the replacement catchup',async()=>{
 const {PersonalBotService}=await import('../src/service.mjs');let release,reads=0
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async()=>''})
 service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:()=>new Promise(resolve=>{release=resolve})})
 await new Promise(resolve=>setImmediate(resolve))
 service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{reads++}})
 release();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1)
 await service.close()
})


test('one completion hint drains paginated results and leaves a rejected batch held without model retry',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-completion-drain-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 for(const rejectFirst of [false,true]){
  const records=Array.from({length:7},(_,i)=>row('completed-'+i));let calls=0
  const options={file:join(directory,`state-${rejectFirst}.json`),read:async cursor=>({ok:true,records:cursor?records.slice(4):records.slice(0,4),total:7,nextCursor:cursor?null:'next',omitted:cursor?0:3}),synthesize:async input=>{
   calls++;if(rejectFirst&&calls===1)throw Error('owned review held')
   return {updates:input.records.map(r=>({text:'这项任务已经结束。',taskName:'Task result',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))}
  },publish:()=>{}}
  const remote=new RemoteConversation(options);await remote.drain()
  assert.equal(calls,2);assert.equal(remote.snapshot().hasMore,false)
  assert.equal(remote.snapshot().messages.length,rejectFirst?3:7);assert.equal(remote.snapshot().heldCount,rejectFirst?4:0)
  const restored=new RemoteConversation(options);await restored.drain();assert.equal(calls,2,'restart does not replay successful or held turns')
 }
})


test('restarted Hosted Pi preserves an unreported completed turn but never promotes interrupted work',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-completed-restart-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let calls=0,current={...row('configured'),control:'configured',target:'cm5',taskId:'12345678-1234-1234-1234-123456789abc',taskRevision:'f'.repeat(64),lastTurnId:'12345678-1234-1234-1234-123456789abd',currentTurnId:null,state:'interrupted',turnOutcome:'finished'}
 const options={file:join(directory,'state.json'),read:async()=>({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async({records})=>{calls++;return {updates:updates('任务已有最终结果。',records),citations:records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))}},publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();assert.equal(calls,1)
 assert.equal(remote.snapshot().messages[0].sources[0].lastTurnId,current.lastTurnId)
 current={...current,revision:'b'.repeat(64),updatedAt:2};const recovered=new RemoteConversation(options);await recovered.poll();assert.equal(calls,1)
 current={...current,revision:'c'.repeat(64),lastTurnId:'12345678-1234-1234-1234-123456789abe',turnOutcome:'interrupted'};await recovered.poll();assert.equal(calls,1)
})


test('legacy configured completions migrate silently before reader schema changes can replay them',async t=>{
 const {createHash}=await import('node:crypto'),{createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
 for(const mode of ['retained-reference','seen-projection','held-projection','held-with-modern-seen','held-failed','held-cancelled','ambiguous-seen','ambiguous-held','observed-active','different-active','invalid-active','unknown-first','unavailable-first','new-source'])await t.test(mode,async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-completion-migration-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  const task={taskId:'00000000-0000-0000-0000-000000000001',project:'/synthetic/project',updatedAt:'2026-10-17T00:00:00.000Z',state:'settled',currentTurnId:null,lastTurnId:'00000000-0000-0000-0000-000000000002',turnOutcome:'finished',revision:'a'.repeat(64),response:'Result total: 6'}
  if(mode==='held-failed'||mode==='held-cancelled'){task.turnOutcome=mode.slice(5);task.state=task.turnOutcome}
  let unavailable=false
  const reader=await createRemotePiReader({targets:[{id:'cm5',roots:['/synthetic']}],link:{stop:async()=>{}},backfill:async()=>null,request:async(_target,p)=>{if(p.command==='status'&&unavailable)throw Error('synthetic unavailable');return p.command==='list'?{tasks:[task],endpointKind:'hosted'}:{task}}});t.after(()=>reader.close())
  let current=(await reader.read('hosted:0')).records[0]
  const {revision,lastTurnId,turnOutcome,...oldBase}=current
  if(task.turnOutcome!=='finished')oldBase.conclusionOutcome='unknown'
  const old={...oldBase,revision:hash(oldBase)},legacyRevision=mode.startsWith('ambiguous')?'d'.repeat(64):old.revision
  const {conclusion,...reference}=old
  const legacy={id:'c'.repeat(64),at:1,text:'Earlier result unchanged.',sources:[{...reference,revision:'e'.repeat(64)}],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
  const held=mode.includes('held'),fresh=mode==='new-source'
  const prior={version:1,seen:held||fresh?[]:[{key:old.key,revision:legacyRevision,updatedAt:old.updatedAt}],attempted:held?[{key:old.key,revision:legacyRevision,updatedAt:old.updatedAt}]:[],messages:mode==='retained-reference'?[legacy]:[],cursor:null}
  if(mode==='held-with-modern-seen')prior.seen=[{key:old.key,revision:'8'.repeat(64),updatedAt:old.updatedAt,completion:'9'.repeat(64)}]
  const file=join(directory,'remote.json');await writeFile(file,JSON.stringify(prior),{mode:0o600});protectProactivePath(file)
  let calls=0
  const options={file,read:async()=>({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async({records})=>{calls++;return {updates:updates('任务给出了结果。',records),citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}}
  let remote=new RemoteConversation(options)
  if(['observed-active','different-active','invalid-active','unknown-first','unavailable-first'].includes(mode)) {
   const terminalTask={...task,...(mode==='observed-active'?{lastTurnId:'00000000-0000-0000-0000-000000000004',revision:'7'.repeat(64)}:{})}
   Object.assign(task,{revision:'9'.repeat(64),state:mode==='unknown-first'?'unknown':'running',currentTurnId:mode==='different-active'?'00000000-0000-0000-0000-000000000009':mode==='invalid-active'?'not-a-turn-id':terminalTask.lastTurnId,});unavailable=mode==='unavailable-first'
   current=(await reader.read('hosted:0')).records[0]
   await remote.poll();assert.equal(calls,0)
   remote=new RemoteConversation(options);Object.assign(task,terminalTask);unavailable=false;current=(await reader.read('hosted:0')).records[0]
  }
  await remote.poll()
  const notified=fresh||mode==='observed-active'
  assert.equal(calls,notified?1:0,'migration is not a fresh completion or a retry of held work')
  const next=JSON.parse(await readFile(file,'utf8'))
  if(!notified){assert.deepEqual(next.messages,prior.messages);assert.deepEqual(next.seen.map(({completion,observedTurnId,...r})=>r),prior.seen.map(({completion,...r})=>r));assert.deepEqual(next.attempted.map(({completion,observedTurnId,...r})=>r),prior.attempted);assert.equal(remote.snapshot().heldCount,held?1:0)}
  if(mode==='held-with-modern-seen'){assert.equal(next.seen[0].completion,prior.seen[0].completion);assert.match(next.attempted[0].completion,/^[a-f0-9]{64}$/)}
  for(const field of ['seen','attempted'])if(next[field].length){const malformed=structuredClone(next);malformed[field][0].observedTurnId='not-a-uuid';await writeFile(file,JSON.stringify(malformed),{mode:0o600});assert.throws(()=>new RemoteConversation(options));await writeFile(file,JSON.stringify(next),{mode:0o600})}
  const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,notified?1:0,'baseline survives restart')
  task.updatedAt='2026-10-17T00:00:01.000Z';current=(await reader.read('hosted:0')).records[0];await restored.poll();assert.equal(calls,notified?1:0,'changed metadata cannot repeat the baseline')
  Object.assign(task,{revision:'f'.repeat(64),lastTurnId:'00000000-0000-0000-0000-000000000003',updatedAt:'2026-10-17T00:00:02.000Z'});current=(await reader.read('hosted:0')).records[0]
  await restored.poll();assert.equal(calls,notified?2:1,'a later actual completed turn remains reportable')
 })
})


test('legacy identity migration requires explicit live availability and tolerates old references without timestamps',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-migration-reference-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const current={...row('configured'),control:'configured',target:'cm5',taskId:'00000000-0000-0000-0000-000000000001',taskRevision:'b'.repeat(64),lastTurnId:'00000000-0000-0000-0000-000000000002',turnOutcome:'finished'}
 const {conclusion,lastTurnId,turnOutcome,updatedAt,...reference}=current
 const legacy={id:'c'.repeat(64),at:1,text:'Earlier result.',sources:[reference],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
 const file=join(directory,'remote.json');await writeFile(file,JSON.stringify({version:1,seen:[],attempted:[],messages:[legacy],cursor:null}),{mode:0o600});protectProactivePath(file)
 let record={...current,availability:'unknown',state:'running',currentTurnId:current.lastTurnId},calls=0
 const options={file,read:async()=>({ok:true,records:[record],total:1,nextCursor:null,omitted:0}),synthesize:async()=>{calls++;throw Error('migration cannot synthesize')},publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();assert.equal(calls,0);assert.deepEqual(JSON.parse(await readFile(file,'utf8')).seen,[])
 record={...current,availability:'unknown'};await remote.poll();assert.equal(calls,0);assert.deepEqual(JSON.parse(await readFile(file,'utf8')).seen,[])
 record=current;await remote.poll();assert.equal(calls,0)
 const saved=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(saved.messages,[legacy]);assert.equal(saved.seen[0].updatedAt,current.updatedAt);assert.match(saved.seen[0].completion,/^[a-f0-9]{64}$/)
 const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,0);assert.deepEqual(restored.snapshot().messages,remote.snapshot().messages)
})


test('reporter identity upgrades baseline legacy reports without replaying conclusions',async t=>{
 const {createHash}=await import('node:crypto')
 const completion=(key,id)=>createHash('sha256').update(JSON.stringify([key,id,'reported_finished'])).digest('hex')
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 for(const mode of ['seen','held','mixed-older-reference','mixed-held-reference','known-exact-reference','matches-older-reference','modern-seen','modern-attempt','unknown-seen-modern-attempt','progress-first','unknown-first','unavailable-first','new-source'])await t.test(mode,async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-report-migration-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  let source={...row('report'),eventId:null,conclusionOutcome:'unknown'}
  const reader=await createRemotePiReader({targets:[],link:{conclusions:async()=>({ok:true,records:[source],total:1,omitted:0,nextCursor:null}),stop:async()=>{}},backfill:async()=>null});t.after(()=>reader.close())
  const old=(await reader.read()).records[0],{conclusion,...reference}=old
  const older={...reference,revision:'d'.repeat(64),eventId:'persisted-older-entry',conclusionOutcome:'reported_finished'}
  const known=mode==='known-exact-reference',held=mode==='held'||mode==='mixed-held-reference',fresh=mode==='new-source',mixed=mode.startsWith('mixed')||mode==='matches-older-reference'
  const legacy={id:'c'.repeat(64),at:1,text:'Earlier result unchanged.',sources:[known?{...older,revision:old.revision}:reference],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
  const olderMessage={...legacy,id:'e'.repeat(64),sources:[older]}
  const prior={version:1,seen:fresh||held?[]:[{key:old.key,revision:old.revision,updatedAt:old.updatedAt}],attempted:held?[{key:old.key,revision:old.revision,updatedAt:old.updatedAt}]:[],messages:fresh||held?(mixed?[olderMessage]:[]):mixed?[olderMessage,legacy]:[legacy],cursor:null}
  const modern=mode==='modern-seen'||mode==='modern-attempt'
  if(mode==='modern-seen')prior.seen[0].completion=completion(old.key,'persisted-older-entry')
  if(mode==='modern-attempt'){prior.seen=[];prior.attempted=[{key:old.key,revision:old.revision,updatedAt:1,completion:completion(old.key,'persisted-older-entry')}]}
  if(mode==='unknown-seen-modern-attempt')prior.attempted=[{key:old.key,revision:'f'.repeat(64),updatedAt:1,completion:completion(old.key,'persisted-older-entry')}]
  const oldHeld={key:old.key,revision:'7'.repeat(64),updatedAt:1}
  if(modern)prior.attempted.push(oldHeld)
  const file=join(directory,'remote.json');await writeFile(file,JSON.stringify(prior),{mode:0o600});protectProactivePath(file)
  let current=old,calls=0
  const options={file,read:async()=>({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async({records})=>{calls++;return {updates:updates('任务已给出最终结果。',records),citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}}
  let remote=new RemoteConversation(options)
  if(['progress-first','unknown-first','unavailable-first'].includes(mode)) {
   source={...source,eventId:'persisted-current-entry',conclusionOutcome:mode==='unknown-first'?'unknown':'reported_finished',...(mode==='progress-first'?{state:'running'}:{}),...(mode==='unavailable-first'?{conclusion:''}:{})};current=(await reader.read()).records[0]
   await remote.poll();assert.equal(calls,0);assert.deepEqual(JSON.parse(await readFile(file,'utf8')).seen,prior.seen)
   remote=new RemoteConversation(options)
  }
  source={...source,state:'settled',conclusion:old.conclusion,eventId:mode==='matches-older-reference'?'persisted-older-entry':'persisted-current-entry',conclusionOutcome:'reported_finished'};current=(await reader.read()).records[0]
  await remote.poll();const notified=fresh||known||modern
  assert.equal(calls,notified?1:0,'new reporter metadata is not proof of a new legacy completion')
  const migrated=JSON.parse(await readFile(file,'utf8'))
  if(!notified){assert.deepEqual(migrated.messages,prior.messages);assert.deepEqual(migrated.seen.map(({completion,...r})=>r),prior.seen);assert.deepEqual(migrated.attempted.map(({completion,...r})=>r),prior.attempted.map(({completion,...r})=>r));assert.equal(remote.snapshot().heldCount,held||mode==='unknown-seen-modern-attempt'?1:0)}
  if(modern)assert.deepEqual(migrated.attempted.find(r=>r.revision===oldHeld.revision),oldHeld,'older unidentified held records do not absorb a fresh completed turn')
  const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,notified?1:0)
  source={...source,updatedAt:2,backend:'changed-metadata'};current=(await reader.read()).records[0];await restored.poll();assert.equal(calls,notified?1:0)
  source={...source,eventId:'persisted-next-entry'};current=(await reader.read()).records[0];await restored.poll();assert.equal(calls,notified?2:1,'different real assistant entries remain reportable even with identical text')
 })
})

test('reply references bind the exact durable message and session thread across restart',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-session-reply-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let current=row('reply-source'),calls=0
 const options={file:join(directory,'remote.json'),read:async()=>({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('任务已完成。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll()
 const message=remote.snapshot().messages[0],replyTo={messageId:message.id,sourceKey:current.key,sourceRevision:current.revision}
 const bound=remote.resolveReply(replyTo);assert.equal(bound.source.sessionId,current.sessionId);assert.match(bound.threadId,/^[a-f0-9]{64}$/)
 assert.throws(()=>remote.resolveReply({...replyTo,messageId:'f'.repeat(64)}));assert.throws(()=>remote.resolveReply({...replyTo,sourceRevision:'f'.repeat(64)}));assert.throws(()=>remote.resolveReply({...replyTo,target:'mac'}))
 const turn=remote.beginReply(replyTo,'请继续使用 adb 输入安卓');assert.equal(turn.threadId,bound.threadId)
 remote.completeReply(turn.id,{status:'answered',answer:'已受理，尚未完成。'})
 const recovered=new RemoteConversation(options);assert.deepEqual(recovered.data.replies[0].replyTo,replyTo)
 current={...current,revision:'b'.repeat(64),eventId:'next-entry'};await recovered.poll()
 assert.equal(recovered.snapshot().messages[0].sources[0].threadId,bound.threadId)
 assert.equal(recovered.snapshot().messages[1].sources[0].sessionId,current.sessionId)
 assert.equal(recovered.resolveReply(replyTo).source.revision,replyTo.sourceRevision,'A historical immutable message still refers to the same session')
})

test('a report reply resolves its exact project without unrelated inventory and never invents a replacement',async()=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const task={taskId:'00000000-0000-0000-0000-000000000001',project:'/synthetic/project',revision:'c'.repeat(64),state:'settled',lifecycle:'live',deliveries:[]}
 let tasks=[task],incomplete=false,statusChanged=false,hostDenied=false;const sent=[]
 const request=async(target,params)=>{sent.push({target:target.id,...params});if(hostDenied)throw Error('Host refused project');if(params.command==='list'&&params.project!==task.project)return {tasks:[],incomplete:true};return params.command==='list'?{tasks,incomplete,endpointKind:statusChanged?'hosted':'current_session'}:params.command==='status'?{task:statusChanged?{...task,revision:'invalid'}:task}:{accepted:true,delivery:'ran',mutationId:'00000000-0000-0000-0000-000000000002',task}}
 const report={...row('source'),sessionId:task.taskId,project:task.project}
 const targets=[{id:'mac',roots:['/synthetic','/synthetic/overlap'],reportMachines:['synthetic-mac']}]
 const reader=await createRemotePiReader({targets,link:{stop:async()=>{},conclusions:async()=>({ok:true,records:[report],nextCursor:null})},backfill:async()=>null,request})
 const source=(await reader.read()).records[0]
 const params={sourceRevision:source.revision,prompt:'Use adb to input 安卓'}
 await reader.followup(source,params,undefined,{explicitReply:true})
 assert.deepEqual(sent.at(-1),{target:'mac',command:'prompt',project:task.project,taskId:task.taskId,prompt:params.prompt})
 assert.deepEqual(sent.filter(item=>item.command==='list').map(item=>item.project),[task.project],'identity lookup lists the exact project once, even with overlapping configured roots')
 const count=()=>sent.filter(r=>r.command==='prompt').length
 tasks=[task,task];await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/ambiguous/i);assert.equal(count(),1)
 tasks=[task];incomplete=true;await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/incomplete/i);assert.equal(count(),1)
 incomplete=false;tasks=[{...task,project:'/different'}];await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}));assert.equal(count(),1)
 tasks=[task];statusChanged=true;await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/revision/);assert.equal(count(),1)
 statusChanged=true;task.deliveries=[{state:'unknown',submitted:true}];task.revision='d'.repeat(64);await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/unknown/);assert.equal(count(),1)
 task.deliveries=[]
 for(const patch of [{lifecycle:'unknown'},{state:'unknown'},{state:'starting'},{lifecycle:'ended',state:'ended'}]) {
   const previous={state:task.state,lifecycle:task.lifecycle};Object.assign(task,patch)
   await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/not live/);Object.assign(task,previous);assert.equal(count(),1)
 }
 await assert.rejects(reader.followup(source,params));assert.equal(count(),1)
 statusChanged=false;hostDenied=true;await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/Host refused/);assert.equal(count(),1)
 hostDenied=false;targets.push({...targets[0],id:'cm5'})
 await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/ambiguous/);assert.equal(count(),1);targets.pop()
 const {createHash}=await import('node:crypto')
 const configured={...source,control:'configured',target:'mac',taskId:task.taskId,key:createHash('sha256').update(JSON.stringify(['mac',task.project,task.taskId])).digest('hex')}
 targets[0].roots=Array.from({length:33},(_,i)=>`/synthetic/root-${i}`)
 await reader.followup(configured,params,undefined,{explicitReply:true});assert.equal(count(),2)
 assert.deepEqual(sent.slice(-3).map(item=>[item.command,item.project]),[['list',task.project],['status',task.project],['prompt',task.project]])
 await assert.rejects(reader.followup({...configured,key:'invalid'},params,undefined,{explicitReply:true}),/identity/);assert.equal(count(),2)
 await assert.rejects(reader.followup({...source,machine:'unbound-machine'},params,undefined,{explicitReply:true}),/no configured control binding/);assert.equal(count(),2)
 await reader.close()
})

test('a historical native reply uses fresh session status rather than the list summary hash',async()=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const task={taskId:'00000000-0000-0000-0000-000000000001',project:'/synthetic/project',state:'settled',lifecycle:'live'}
 let fresh={...task,response:'A new result arrived',updatedAt:'2026-10-19T00:00:00Z'},endpointKind='current_session',statusEndpoint=undefined,prompts=0
 const target={id:'mac',roots:['/synthetic'],reportMachines:['synthetic-mac']}
 const reader=await createRemotePiReader({targets:[target],link:{stop:async()=>{}},backfill:async()=>null,request:async(_target,params)=>{
   if(params.command==='list')return {tasks:[task],endpointKind}
   if(params.command==='status')return {task:fresh,endpointKind:statusEndpoint}
   prompts++;assert.equal(params.taskId,task.taskId);assert.equal(params.project,task.project);assert.equal(params.prompt,'Continue the original session');return {accepted:true}
 }})
 const source={...row('historical'),sessionId:task.taskId,project:task.project},original=structuredClone(source)
 const params={sourceRevision:source.revision,prompt:'Continue the original session'}
 await reader.followup(source,params,undefined,{explicitReply:true});assert.equal(prompts,1);assert.deepEqual(source,original)
 for(const patch of [{taskId:'00000000-0000-0000-0000-000000000002'},{project:'/other'},{lifecycle:'unknown'},{state:'starting'}]) {
   fresh={...task,...patch};await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}));assert.equal(prompts,1)
 }
 fresh={...task,deliveries:[{state:'unknown',mutationId:'00000000-0000-0000-0000-000000000009'}]}
 await reader.followup(source,params,undefined,{explicitReply:true});assert.equal(prompts,2)
 for(const kind of ['hosted','unknown',undefined]) {
   fresh={...task,response:'Different status shape'};endpointKind=kind
   await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/revision/);assert.equal(prompts,2)
   fresh={...task,deliveries:[{state:'unknown'}]};task.deliveries=fresh.deliveries
   await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/unknown/);assert.equal(prompts,2)
   delete task.deliveries
 }
 endpointKind=undefined;target.endpointKind='current_session';fresh={...task,response:'Full native status',deliveries:[{state:'unknown'}]}
 await reader.followup(source,params,undefined,{explicitReply:true});assert.equal(prompts,3)
 statusEndpoint='hosted';await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/conflict/);assert.equal(prompts,3)
 statusEndpoint=undefined;endpointKind='hosted';await assert.rejects(reader.followup(source,params,undefined,{explicitReply:true}),/conflict/);assert.equal(prompts,3)
 await assert.rejects(reader.followup(source,{...params,sourceRevision:'f'.repeat(64)},undefined,{explicitReply:true}),/source revision/);assert.equal(prompts,3)
 await reader.close()
})

test('historical duplicate message IDs resolve only the complete immutable reply tuple',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-duplicate-reply-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read:async()=>({ok:true,records:[row('first'),row('second')],total:2,omitted:0,nextCursor:null}),synthesize:async input=>({updates:input.records.map(r=>({text:'结果已返回。',taskName:'Task result',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}})
 await remote.poll();const [first,second]=remote.data.messages
 remote.save({...remote.data,messages:[first,{...second,id:first.id}]})
 const replyTo={messageId:first.id,sourceKey:'second',sourceRevision:second.sources[0].revision}
 assert.equal(remote.resolveReply(replyTo).source.sessionId,'second')
 assert.throws(()=>remote.resolveReply({...replyTo,sourceKey:'third'}))
})

test('unknown reply delivery remains durable and cannot be resent after restart',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-unknown-reply-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const options={file:join(directory,'remote.json'),read:async()=>({ok:true,records:[row('source')],total:1,omitted:0,nextCursor:null}),synthesize:async input=>({updates:updates('任务已完成。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();const message=remote.data.messages[0],replyTo={messageId:message.id,sourceKey:'source',sourceRevision:message.sources[0].revision},reply=remote.beginReply(replyTo,'继续')
 let attempts=0
 await assert.rejects(remote.dispatchReply(reply,async beforeSend=>{beforeSend();attempts++;throw Error('outcome unknown mutationId=00000000-0000-0000-0000-000000000001')}))
 remote.completeReply(reply.id,{status:'failed'});assert.equal(remote.data.replies[0].status,'unknown')
 const restored=new RemoteConversation(options);assert.throws(()=>restored.beginReply(replyTo,'继续'),/unknown/)
 await assert.rejects(restored.dispatchReply(reply,async()=>{attempts++}));assert.equal(attempts,1)
})

test('combined reply and source projections fit the whole remote frame and report omitted history',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-budget-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const records=Array.from({length:7},(_,i)=>({...row('source-'+i),project:'/'+('long-project/'.repeat(300))}))
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read:async cursor=>({ok:true,records:records.slice(cursor?4:0,cursor?7:4),total:7,nextCursor:cursor?null:'next',omitted:cursor?0:3}),synthesize:async input=>({updates:input.records.map(r=>({text:'结果已返回。',taskName:'Task result',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}})
 await remote.drain();const message=remote.data.messages[0]
 const replies=Array.from({length:32},(_,i)=>({id:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`,threadId:'c'.repeat(64),sessionId:message.sources[0].sessionId,text:'中'.repeat(1000),answer:'答'.repeat(1000),replyTo:{messageId:message.id,sourceKey:message.sources[0].key,sourceRevision:message.sources[0].revision},at:i,status:'answered'}))
 remote.save({...remote.data,replies});const frame=remote.snapshot()
 assert(Buffer.byteLength(JSON.stringify(frame))<=60*1024);assert.equal(frame.omittedReplies,32-frame.replies.length);assert.equal(frame.total,7)
 if(frame.messages.length<7)assert.equal(frame.nextOffset,frame.messages.length)
})

test('reply capacity expires only terminal history outside visible message chains',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-expiry-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read:async()=>({ok:true,records:[row('source')],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('结果已返回。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}})
 await remote.poll();const message=remote.data.messages[0],replyTo={messageId:message.id,sourceKey:'source',sourceRevision:message.sources[0].revision}
 const replies=Array.from({length:128},(_,i)=>({id:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`,threadId:'c'.repeat(64),sessionId:'00000000-0000-0000-0000-000000000009',text:'历史请求',replyTo:{...replyTo,messageId:'f'.repeat(64)},at:i,status:i===0?'unknown':'answered'}))
 remote.save({...remote.data,replies});remote.beginReply(replyTo,'新回复')
 assert.equal(remote.data.replies.length,128);assert.equal(remote.data.expiredReplies,1);assert.equal(remote.data.replies[0].status,'unknown')
 remote.completeReply(remote.data.replies.at(-1).id,{status:'answered'})
 const protectedReplies=remote.data.replies.map(reply=>reply.status==='unknown'?reply:{...reply,replyTo});remote.save({...remote.data,replies:protectedReplies})
 assert.throws(()=>remote.beginReply(replyTo,'不能丢可见链'),/capacity/);assert.equal(remote.data.replies.length,128)
})

test('explicit reply accepts legal live terminal projections without admitting unknown lifecycle',async()=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const task={taskId:'00000000-0000-0000-0000-000000000001',project:'/synthetic',state:'finished',lifecycle:'live',revision:'c'.repeat(64),updatedAt:'2026-10-18T00:00:00Z',response:'Result'}
 let prompts=0
 const reader=await createRemotePiReader({targets:[{id:'cm5',roots:['/synthetic']}],link:{stop:async()=>{}},backfill:async()=>null,request:async(_target,p)=>p.command==='list'?{tasks:[task],endpointKind:'hosted'}:p.command==='status'?{task}:(prompts++,{accepted:true,task})})
 try {
  for(const state of ['finished','failed','cancelled']) {
   task.state=state;const source=(await reader.read('hosted:0')).records[0]
   await reader.followup(source,{sourceRevision:source.revision,prompt:'继续原任务'},undefined,{explicitReply:true})
  }
  assert.equal(prompts,3)
 }finally{await reader.close()}
})

test('startup resolves interrupted reply admission without replay and persists that recovery once',async t=>{
 const {stat}=await import('node:fs/promises')
 for(const status of ['queued','dispatching','unknown','delivered'])await t.test(status,async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-restart-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  let models=0,reads=0
  const options={file:join(directory,'remote.json'),read:async()=>{reads++;return {ok:true,records:[row('source')],total:1,nextCursor:null,omitted:0}},synthesize:async input=>{models++;return {updates:updates('已返回结果。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}}
  const remote=new RemoteConversation(options);await remote.poll();const message=remote.data.messages[0],replyTo={messageId:message.id,sourceKey:'source',sourceRevision:message.sources[0].revision},reply=remote.beginReply(replyTo,'继续原会话')
  remote.completeReply(reply.id,{status,receipt:{mutationId:'00000000-0000-0000-0000-000000000001'}})
  const before=JSON.parse(await readFile(options.file,'utf8')),inode=(await stat(options.file)).ino
  const recovered=new RemoteConversation(options),expected=status==='queued'?'failed':status==='dispatching'?'unknown':status
  assert.equal(recovered.data.replies[0].status,expected)
  const after=JSON.parse(await readFile(options.file,'utf8'))
  assert.deepEqual(after,{...before,replies:before.replies.map(r=>({...r,status:expected}))})
  const firstRecoveredInode=(await stat(options.file)).ino
  if(status==='queued'||status==='dispatching')assert.notEqual(firstRecoveredInode,inode)
  else assert.equal(firstRecoveredInode,inode)
  const reopened=new RemoteConversation(options);assert.deepEqual(reopened.data.replies,recovered.data.replies)
  assert.equal((await stat(options.file)).ino,firstRecoveredInode,'Second restart must not save again')
  assert.equal(models,1);assert.equal(reads,1,'Restart must not read or replay a task')
 })
})

test('unknown reply locks survive reporting-machine mapping changes and expired origins',async t=>{
 const {sessionThread}=await import('../src/session-replies.mjs')
 for(const status of ['unknown','dispatching'])await t.test(status,async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-mapping-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  let mapped=false,current={...row('source'),sessionId:'00000000-0000-0000-0000-000000000001'}
  const options={file:join(directory,'remote.json'),thread:source=>sessionThread(source,mapped?'mac':undefined),read:async()=>({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('任务已完成。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
  const remote=new RemoteConversation(options);await remote.poll();const original=remote.data.messages[0],replyTo={messageId:original.id,sourceKey:'source',sourceRevision:current.revision},reply=remote.beginReply(replyTo,'继续')
  remote.completeReply(reply.id,{status,receipt:{mutationId:'00000000-0000-0000-0000-000000000002'}})
  const immutable=structuredClone(remote.data.replies[0]);mapped=true
  const restored=new RemoteConversation(options)
  assert.throws(()=>restored.resolveReply(replyTo),/unknown/,'Mapping cannot release an unresolved original source')
  current={...current,revision:'b'.repeat(64),eventId:'later-entry'};await restored.poll()
  const latest=restored.data.messages.at(-1),nextReply={messageId:latest.id,sourceKey:'source',sourceRevision:current.revision}
  assert.throws(()=>restored.resolveReply(nextReply),/unknown/)
  restored.save({...restored.data,messages:[latest]})
  assert.throws(()=>restored.resolveReply(nextReply),/unknown/,'Missing origin preserves a conservative session lock')
  const after=restored.data.replies[0];assert.deepEqual(after,{...immutable,status:'unknown'})
  assert.equal(after.threadId,immutable.threadId,'Do not rewrite historical receipt identity')
 })
})

test('reply checkpoint writes reject invalid answers without corrupting delivery evidence',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-write-contract-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const options={file:join(directory,'remote.json'),read:async()=>({ok:true,records:[row('source')],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('已返回结果。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();const message=remote.data.messages[0],replyTo={messageId:message.id,sourceKey:'source',sourceRevision:message.sources[0].revision}
 const reply=remote.beginReply(replyTo,'继续原会话\n保留中文\t输入安卓')
 for(const status of ['queued','dispatching','unknown','delivered']) {
  // Independently exercise each persisted delivery window without replaying a task.
  remote.save({...remote.data,replies:remote.data.replies.map(r=>({...r,status,receipt:{mutationId:'00000000-0000-0000-0000-000000000002'}}))})
  const before=await readFile(options.file),beforeObject=structuredClone(remote.data)
  assert.throws(()=>remote.completeReply(reply.id,{status:'answered',answer:'结果\u0001'}),/Invalid/)
  assert.deepEqual(await readFile(options.file),before);assert.deepEqual(remote.data,beforeObject)
 }
 remote.completeReply(reply.id,{status:'answered',answer:'已受理\n等待结果\t不要重发'})
 const restored=new RemoteConversation(options)
 assert.equal(restored.data.replies[0].status,'delivered');assert.equal(restored.data.replies[0].text,'继续原会话\n保留中文\t输入安卓');assert.equal(restored.data.replies[0].answer,'已受理\n等待结果\t不要重发')
 assert.equal(restored.data.replies[0].receipt.mutationId,'00000000-0000-0000-0000-000000000002')
})


test('reply checkpoint writes reject forbidden owner controls before persisting text',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-owner-controls-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),remote=new RemoteConversation({file,read:async()=>({ok:true,records:[row('source')],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('已返回结果。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}})
 await remote.poll();const message=remote.data.messages[0],replyTo={messageId:message.id,sourceKey:'source',sourceRevision:message.sources[0].revision},before=await readFile(file)
 assert.throws(()=>remote.beginReply(replyTo,'继续\u0001'),/Invalid/);assert.deepEqual(await readFile(file),before)
 assert.equal(remote.snapshot().replies.length,0)
})

test('reply session identity is required on writes and reads without changing invalid checkpoint bytes',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-required-session-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),options={file,read:async()=>({ok:true,records:[row('source')],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('已返回结果。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();const message=remote.data.messages[0],replyTo={messageId:message.id,sourceKey:'source',sourceRevision:message.sources[0].revision}
 const reply=remote.beginReply(replyTo,'继续原会话');remote.completeReply(reply.id,{status:'unknown'})
 const valid=structuredClone(remote.data),before=await readFile(file)
 for(const sessionId of [undefined,'','  ']) {
  const invalid={...valid,replies:valid.replies.map(r=>({...r,sessionId}))}
  assert.throws(()=>remote.save(invalid),/Invalid session reply checkpoint/)
  assert.deepEqual(await readFile(file),before);assert.deepEqual(remote.data,valid)
  const bytes=JSON.stringify(invalid);await writeFile(file,bytes)
  assert.throws(()=>new RemoteConversation(options),/Invalid session reply checkpoint/)
  assert.equal(await readFile(file,'utf8'),bytes,'Invalid reads must not repair or overwrite the file')
  await writeFile(file,before)
 }
 const other={...row('other'),sessionId:'another-session'},otherMessage={...message,id:'e'.repeat(64),sources:[other]}
 remote.save({...valid,messages:[otherMessage]})
 assert.equal(remote.resolveReply({messageId:otherMessage.id,sourceKey:other.key,sourceRevision:other.revision}).source.sessionId,'another-session')
 const same={...other,sessionId:'source'},sameMessage={...otherMessage,sources:[same]}
 remote.save({...remote.data,messages:[sameMessage]})
 assert.throws(()=>remote.resolveReply({messageId:sameMessage.id,sourceKey:same.key,sourceRevision:same.revision}),/unknown/)
})


async function unknownReplyContinuation(t,{configured=false,realReport=false,clockOffset=0}={}) {
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-continuation-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let current={...row('continuation'),updatedAt:Date.now()+clockOffset},reader,task
 if(configured) {
  const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
  task={taskId:'00000000-0000-0000-0000-000000000001',project:'/synthetic/project',lifecycle:'live',state:'finished',revision:'a'.repeat(64),response:'Computed total: 6',updatedAt:new Date(Date.now()+clockOffset).toISOString(),currentTurnId:null,lastTurnId:'00000000-0000-0000-0000-000000000002',turnOutcome:'finished'}
  reader=await createRemotePiReader({targets:[{id:'mac',roots:['/synthetic']}],link:{conclusions:async()=>({ok:true,records:[],total:0}),stop:async()=>{}},backfill:async()=>null,request:async(_target,params)=>{
   if(params.command==='list')return {tasks:[task],endpointKind:'hosted'}
   if(params.command==='status')return {task}
   throw Error('Unexpected task mutation in reader fixture')
  }})
  t.after(()=>reader.close())
 } else if(realReport) {
  const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
  reader=await createRemotePiReader({targets:[],link:{conclusions:async()=>({ok:true,records:[current],total:1}),stop:async()=>{}},backfill:async()=>({truncated:false,events:[{kind:'assistant',eventId:current.eventId,text:current.conclusion,stopReason:'stop'}]})})
  t.after(()=>reader.close())
 }
 const options={file:join(directory,'remote.json'),read:cursor=>reader?reader.read(cursor):Promise.resolve({ok:true,records:[current],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('A task result is available.',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll()
 const reference=message=>({messageId:message.id,sourceKey:message.sources[0].key,sourceRevision:message.sources[0].revision})
 const original=reference(remote.data.messages[0]),reply=remote.beginReply(original,'First explicit owner instruction')
 const send=async beforeSend=>{beforeSend();return {accepted:false,delivery:'unknown',mutationId:'00000000-0000-0000-0000-000000000009'}}
 await remote.dispatchReply(reply,send)
 const unknown=structuredClone(remote.data.replies[0])
 const next=async revision=>{
  await new Promise(resolve=>setTimeout(resolve,3))
  if(configured)Object.assign(task,{revision,updatedAt:new Date(Date.now()+clockOffset).toISOString(),lastTurnId:`${revision[0].repeat(8)}-${revision[0].repeat(4)}-${revision[0].repeat(4)}-${revision[0].repeat(4)}-${revision[0].repeat(12)}`})
  else current={...current,revision,eventId:revision,updatedAt:Date.now()+clockOffset}
  await remote.poll();return reference(remote.data.messages.at(-1))
 }
 return {remote,options,original,unknown,send,next,reference}
}

test('a new completion permits distinct owner replies across multiple turns without changing unknown receipts',async t=>{
 const f=await unknownReplyContinuation(t),next=await f.next('c'.repeat(64))
 assert.throws(()=>f.remote.beginReply(f.original,'Another instruction'),/unknown/)
 const reply=f.remote.beginReply(next,'Second explicit owner instruction')
 assert.throws(()=>f.remote.beginReply(next,'A competing owner instruction'),/pending|unknown/)
 await f.remote.dispatchReply(reply,f.send)
 assert.deepEqual(f.remote.data.replies[0],f.unknown,'The original unknown receipt is not reconciled or changed')
 const last=await f.next('d'.repeat(64)),recovered=new RemoteConversation(f.options)
 const third=recovered.beginReply(last,'Third explicit owner instruction')
 await recovered.dispatchReply(third,f.send)
 assert.equal(recovered.data.replies.length,3)
 assert.ok(recovered.data.replies.every(reply=>reply.status==='unknown' && reply.receipt.accepted===false))
 assert.throws(()=>recovered.beginReply(last,'A fourth instruction without another completion'),/unknown/)
})

test('expired reply origins permit only a later complete successful source result without changing unknown evidence',async t=>{
 for(const configured of [false,true])await t.test(configured?'configured':'report only',async t=>{
  const f=await unknownReplyContinuation(t,{configured}),next=await f.next('c'.repeat(64))
  f.remote.save({...f.remote.data,messages:f.remote.data.messages.slice(1),expiredMessages:1})
  const recovered=new RemoteConversation(f.options)
  if(configured) {
   const source=recovered.data.messages[0].sources[0]
   assert.equal(Object.hasOwn(source,'conclusionIsLatestAssistant'),false)
   assert.equal(Object.hasOwn(source,'latestEventIsAssistant'),false)
   assert.equal(Object.hasOwn(source,'eventId'),false)
   assert.equal(source.turnOutcome,'finished');assert.equal(source.currentTurnId,null)
  }
  const reply=recovered.beginReply(next,'A distinct request after retention')
  let sends=0
  await recovered.dispatchReply(reply,async beforeSend=>{beforeSend();sends++;return {accepted:false,delivery:'unknown'}})
  assert.equal(sends,1);assert.deepEqual(recovered.data.replies[0],f.unknown)
  assert.throws(()=>recovered.beginReply(next,'Another request on the same result'),/unknown|pending/)
  const restarted=new RemoteConversation(f.options)
  assert.deepEqual(restarted.data.replies[0],f.unknown);assert.equal(restarted.data.replies.length,2)
  assert.equal(restarted.data.replies[1].status,'unknown')
 })
})

test('retained completion order uses local admission time despite either remote clock skew',async t=>{
 for(const configured of [false,true])for(const clockOffset of [-86400000,86400000])await t.test(`${configured?'configured':'real report'} ${clockOffset<0?'behind':'ahead'}`,async t=>{
  const f=await unknownReplyContinuation(t,{configured,realReport:!configured,clockOffset}),next=await f.next('c'.repeat(64))
  f.remote.save({...f.remote.data,messages:f.remote.data.messages.slice(1),expiredMessages:1})
  const recovered=new RemoteConversation(f.options),message=recovered.data.messages[0]
  assert.ok(message.at>f.unknown.at,'The resident admitted the displayed completion after its unknown reply')
  assert.equal(message.sources[0].updatedAt>f.unknown.at,clockOffset>0,'The real reader retains the remote clock without normalizing it')
  const old=structuredClone(recovered.data.replies[0]),observedAt=message.at
  // A future remote clock cannot release a result already observed before the reply.
  recovered.data.messages[0].at=f.unknown.at
  assert.throws(()=>recovered.beginReply(next,'A distinct instruction after retention'),/unknown|pending/)
  recovered.data.messages[0].at=observedAt
  recovered.save(recovered.data)
  const reply=recovered.beginReply(next,'A distinct instruction after retention')
  let mutations=0
  await recovered.dispatchReply(reply,async beforeSend=>{beforeSend();mutations++;return {accepted:false,delivery:'unknown'}})
  assert.equal(mutations,1);assert.deepEqual(recovered.data.replies[0],old)
  const restarted=new RemoteConversation(f.options)
  assert.deepEqual(restarted.data.replies[0],old)
  assert.throws(()=>restarted.beginReply(next,'Another instruction without a new completion'),/unknown|pending/)
 })
})

test('the real report reader does not admit a completion followed by non-assistant activity',async t=>{
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-report-completion-boundary-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const source={...row('actual-report'),updatedAt:Date.now()}
 let latestTool=true,models=0
 const reader=await createRemotePiReader({targets:[],link:{conclusions:async()=>({ok:true,records:[source],total:1}),stop:async()=>{}},backfill:async()=>({truncated:false,events:[{kind:'assistant',eventId:'completed-report-event',text:'Computed total: 6',stopReason:'stop'},...(latestTool?[{kind:'tool',eventId:'later-read',text:'A later file read'}]:[])]})})
 t.after(()=>reader.close())
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read:cursor=>reader.read(cursor),synthesize:async input=>{models++;return {updates:updates('A completed result.',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}})
 await remote.poll();assert.equal(models,0);assert.equal(remote.data.messages.length,0)
 latestTool=false;await remote.poll();assert.equal(models,1);assert.equal(remote.data.messages.length,1)
 const stored=remote.data.messages[0].sources[0]
 assert.equal(stored.conclusionIsLatestAssistant,true);assert.equal(stored.eventId,'completed-report-event')
 assert.equal(Object.hasOwn(stored,'latestEventIsAssistant'),false,'Collection admission checks this field before the existing reference projection')
})

test('expired reply origins cannot bypass identity, freshness, completion or dispatch boundaries',async t=>{
 const cases={
  'queued':f=>{f.remote.data.replies[0].status='queued'},
  'dispatching':f=>{f.remote.data.replies[0].status='dispatching'},
  'different thread':f=>{f.remote.data.replies[0].threadId='f'.repeat(64)},
  'configured failed outcome':f=>{f.remote.data.messages.at(-1).sources[0].turnOutcome='failed'},
  'configured active turn':f=>{f.remote.data.messages.at(-1).sources[0].currentTurnId='00000000-0000-0000-0000-000000000008'},
  'configured missing turn identity':f=>{delete f.remote.data.messages.at(-1).sources[0].lastTurnId},
  'configured truncated result':f=>{f.remote.data.messages.at(-1).sources[0].truncated=true},
  'configured running state':f=>{f.remote.data.messages.at(-1).sources[0].state='running'},
  'configured old local admission':f=>{f.remote.data.messages.at(-1).at=f.unknown.at},
  'different configured target':f=>{f.remote.data.messages.at(-1).sources[0].target='cm5'},
  'different machine':f=>{f.remote.data.messages.at(-1).sources[0].machine='another-host'},
  'different project':f=>{f.remote.data.messages.at(-1).sources[0].project='/another-project'},
  'different source key':(f,next)=>{f.remote.data.replies[0].replyTo.sourceKey='another-source'},
  'different session':f=>{f.remote.data.replies[0].sessionId='another-session'},
  'unchanged source revision':(f,next)=>{f.remote.data.replies[0].replyTo.sourceRevision=next.sourceRevision},
  'unchanged message id':(f,next)=>{f.remote.data.replies[0].replyTo.messageId=next.messageId},
  'future source with old local admission':f=>{f.remote.data.messages.at(-1).sources[0].updatedAt=f.unknown.at+86400000;f.remote.data.messages.at(-1).at=f.unknown.at},
  'missing local admission time':f=>{delete f.remote.data.messages.at(-1).at},
  'old message time':f=>{f.remote.data.messages.at(-1).at=f.unknown.at},
  'failed completion':f=>{f.remote.data.messages.at(-1).sources[0].conclusionOutcome='failed'},
  'cancelled completion':f=>{f.remote.data.messages.at(-1).sources[0].conclusionOutcome='cancelled'},
  'truncated completion':f=>{f.remote.data.messages.at(-1).sources[0].truncated=true},
  'missing truncation evidence':f=>{delete f.remote.data.messages.at(-1).sources[0].truncated},
  'missing completion identity':f=>{delete f.remote.data.messages.at(-1).sources[0].eventId},
  'running source':f=>{f.remote.data.messages.at(-1).sources[0].state='running'},
  'current turn':f=>{f.remote.data.messages.at(-1).sources[0].currentTurnId='active'},
  'unavailable source':f=>{f.remote.data.messages.at(-1).sources[0].availability='unavailable'},
  'later source activity':f=>{f.remote.data.messages.at(-1).sources[0].conclusionIsLatestAssistant=false},
  'later non-assistant event':f=>{f.remote.data.messages.at(-1).sources[0].latestEventIsAssistant=false},
  'ambiguous old origin':f=>{const origin=structuredClone(f.remote.data.messages[0]);origin.id=f.original.messageId;origin.sources[0].revision=f.original.sourceRevision;f.remote.data.messages.unshift(origin,structuredClone(origin))},
  'missing latest-assistant evidence':f=>{delete f.remote.data.messages.at(-1).sources[0].conclusionIsLatestAssistant},
  'repeated owner text':()=>{},
  'newer displayed result':f=>{const latest=structuredClone(f.remote.data.messages.at(-1));latest.id='d'.repeat(64);latest.at++;latest.sources[0].revision='d'.repeat(64);latest.sources[0].eventId='d'.repeat(64);f.remote.data.messages.push(latest)},
 }
 for(const [name,change]of Object.entries(cases))await t.test(name,async t=>{
  const f=await unknownReplyContinuation(t,{configured:name==='different configured target'||name.startsWith('configured ')}),next=await f.next('c'.repeat(64))
  f.remote.data.messages.shift();change(f,next);f.remote.save(f.remote.data)
  const before=await readFile(f.options.file)
  assert.throws(()=>f.remote.beginReply(next,name==='repeated owner text'?' First explicit owner instruction ':'A distinct later instruction'),/unknown|pending/)
  assert.deepEqual(await readFile(f.options.file),before);assert.equal(f.remote.data.replies.length,1)
 })
})

test('new completion continuation refuses ambiguous history, repeated text and pending delivery',async t=>{
 const cases={
  'same completion identity':f=>{f.remote.data.messages.at(-1).sources[0].eventId=f.remote.data.messages[0].sources[0].eventId},
  'same event identity with a changed outcome':f=>{Object.assign(f.remote.data.messages.at(-1).sources[0],{eventId:f.remote.data.messages[0].sources[0].eventId,conclusionOutcome:'failed'})},
  'no completion identity':f=>{delete f.remote.data.messages.at(-1).sources[0].eventId},
  'old local message time':f=>{f.remote.data.messages.at(-1).at=f.unknown.at},
  'missing origin without a later local admission':f=>{f.remote.data.messages.shift();f.remote.data.messages.at(-1).at=f.unknown.at},
  'unfinished source':f=>{f.remote.data.messages.at(-1).sources[0].state='running'},
  'unavailable source':f=>{f.remote.data.messages.at(-1).sources[0].availability='unavailable'},
  'later non-assistant activity':f=>{f.remote.data.messages.at(-1).sources[0].conclusionIsLatestAssistant=false},
  'dispatching owner request':f=>{f.remote.data.replies[0].status='dispatching'},
  'queued owner request':f=>{f.remote.data.replies[0].status='queued'},
  'same owner text':()=>{},
 }
 for(const [name,change] of Object.entries(cases))await t.test(name,async t=>{
  const f=await unknownReplyContinuation(t),next=await f.next('c'.repeat(64));change(f);f.remote.save(f.remote.data)
  const text=name==='same owner text'?'  First explicit owner instruction  ':'A distinct next instruction'
  assert.throws(()=>f.remote.beginReply(next,text),/unknown|pending/)
  assert.equal(f.remote.data.replies.length,1)
 })
})

test('a new reply dispatch rechecks its completion boundary and refuses concurrent dispatch',async t=>{
 const f=await unknownReplyContinuation(t),next=await f.next('c'.repeat(64)),reply=f.remote.beginReply(next,'A distinct second instruction')
 let release,entered;const ready=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve});let sends=0
 const pending=f.remote.dispatchReply(reply,async beforeSend=>{sends++;entered();await wait;beforeSend();return {accepted:false,delivery:'unknown'}})
 await ready
 await assert.rejects(f.remote.dispatchReply(reply,async()=>{sends++;return {accepted:true}}),/attempted|progress/)
 f.remote.save({...f.remote.data,messages:f.remote.data.messages.slice(1).map(message=>({...message,at:f.unknown.at}))})
 release();await assert.rejects(pending,/unknown/)
 assert.equal(sends,1)
 assert.equal(f.remote.data.replies[1].status,'failed')
 assert.deepEqual(f.remote.data.replies[0],f.unknown)
})


test('a retained-origin reply refuses a newer result that arrives before its send boundary',async t=>{
 const f=await unknownReplyContinuation(t),next=await f.next('c'.repeat(64))
 f.remote.save({...f.remote.data,messages:f.remote.data.messages.slice(1)})
 const reply=f.remote.beginReply(next,'A distinct retained-origin instruction')
 let release,entered,mutations=0
 const ready=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve})
 const pending=f.remote.dispatchReply(reply,async beforeSend=>{entered();await wait;beforeSend();mutations++;return {accepted:true}})
 await ready;await f.next('d'.repeat(64));release()
 await assert.rejects(pending,/unknown/)
 assert.equal(mutations,0);assert.deepEqual(f.remote.data.replies[0],f.unknown)
 assert.equal(f.remote.data.replies[1].status,'failed')
})

test('a changed Hosted turn outcome cannot substitute for a new real turn identity',async t=>{
 const f=await unknownReplyContinuation(t,{configured:true}),next=await f.next('c'.repeat(64))
 const source=f.remote.data.messages.at(-1).sources[0]
 source.lastTurnId=f.remote.data.messages[0].sources[0].lastTurnId;source.turnOutcome='failed';f.remote.save(f.remote.data)
 assert.throws(()=>f.remote.beginReply(next,'A different next owner instruction'),/unknown/)
 assert.deepEqual(f.remote.data.replies[0],f.unknown)
})


test('an AI-selected owner follow-up binds the displayed source and supports later distinct turns without replay',async t=>{
 const {attachRemoteConversation}=await import('../src/remote-pi-reader.mjs')
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-selected-owner-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let source=row('named-task'),followup;const sent=[]
 const agent={remoteEnabled:true,close:async()=>{},summarizeRemote:async input=>({updates:updates('The named task finished.',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),attachRemoteContext:(_context,_read,send)=>{followup=send}}
 const reader={read:async()=>({ok:true,records:[source],nextCursor:null,total:1}),close:async()=>{},followup:async(record,params,_signal,options)=>{assert.equal(options.explicitReply,true);options.beforeSend();sent.push({record,params});return {accepted:false,delivery:'unknown'}}}
 const remote=await attachRemoteConversation({agent,stateDir:directory,env:{},createReader:async()=>reader});t.after(()=>agent.close());await remote.poll()
 const params=()=>({sourceKey:source.key,sourceRevision:source.revision,prompt:'Model-rewritten instruction'})
 await assert.rejects(followup(params(),undefined,undefined,undefined),/owner/i);assert.equal(sent.length,0)
 const owner={id:'00000000-0000-0000-0000-000000000071',text:'Read task.json and report the actual supported hosts.',turn:1}
 for(const invalid of [{...params(),sourceRevision:'f'.repeat(64)},{...params(),sourceKey:'missing-source'}]){
  await assert.rejects(followup(invalid,undefined,undefined,owner),/revision changed/i)
  assert.equal((remote.data.replies??[]).length,0);assert.equal(sent.length,0)
 }
 const attempts=await Promise.allSettled([followup(params(),undefined,undefined,owner),followup({...params(),prompt:'Another model prompt'},undefined,undefined,owner)])
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(sent.length,1)
 assert.equal(sent[0].params.prompt,owner.text);assert.equal(remote.data.replies[0].id,owner.id);assert.equal(remote.data.replies.length,1);assert.equal(remote.data.replies[0].text,owner.text);assert.equal(remote.data.replies[0].status,'unknown')
 const outcome=remote.replyOutcome(owner.id);assert.deepEqual(outcome,{id:owner.id,status:'unknown',receipt:{accepted:false,delivery:'unknown'}})
 outcome.receipt.accepted=true;assert.equal(remote.data.replies[0].receipt.accepted,false);assert.equal(remote.replyOutcome('another-owner'),undefined)
 const unknown=structuredClone(remote.data.replies[0])
 await new Promise(resolve=>setTimeout(resolve,3));source={...source,revision:'b'.repeat(64),eventId:'next-completed-turn'};await remote.poll()
 await assert.rejects(followup(params(),undefined,undefined,owner),/attempted/i);assert.equal(sent.length,1)
 await followup(params(),undefined,undefined,{text:'Now report the actual required rounds.',turn:2})
 assert.equal(sent.length,2);assert.deepEqual(remote.data.replies[0],unknown);assert.equal(remote.data.replies[1].threadId,unknown.threadId)
 await assert.rejects(followup(params(),undefined,undefined,{text:'Another request before a new completion.',turn:3}),/unknown/i);assert.equal(sent.length,2)
})


test('host owner identity is bound before reply publication and a failed binding cannot leave a queued lock',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-owner-publication-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 let bound=false;const frames=[];const source=row('owner-id')
 const remote=new RemoteConversation({file:join(directory,'remote.json'),read:async()=>({ok:true,records:[source],nextCursor:null,total:1}),synthesize:async input=>({updates:updates('The task finished.',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:frame=>{if(frame.replies?.some(r=>r.status==='queued'))assert.equal(bound,true);frames.push(frame)}})
 await remote.poll();const message=remote.data.messages[0],reference={messageId:message.id,sourceKey:source.key,sourceRevision:source.revision},id='00000000-0000-0000-0000-000000000061'
 assert.throws(()=>remote.beginReply(reference,'New owner instruction',{id,onBound:()=>{throw Error('Host binding failed')}}),/binding failed/)
 assert.equal(remote.data.replies[0].id,id);assert.equal(remote.data.replies[0].status,'failed');assert.equal(frames.at(-1).replies[0].status,'failed')
 const nextId='00000000-0000-0000-0000-000000000062';const reply=remote.beginReply(reference,'Another explicit owner instruction',{id:nextId,onBound:value=>{assert.equal(value.id,nextId);bound=true}})
 assert.equal(reply.id,nextId);assert.throws(()=>remote.beginReply(reference,'Duplicate host identity',{id:nextId}),/identity|pending/)
})


test('remote reads preserve replies created or completed while inventory is pending',async t=>{
 for(const page of ['same','empty','later_page'])for(const finish of [false,true])await t.test(`${page} ${finish?'unknown':'queued'}`,async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-read-race-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  let block=false,release,entered;const ready=new Promise(resolve=>{entered=resolve}),wait=new Promise(resolve=>{release=resolve}),source=row('source')
  const options={file:join(directory,'remote.json'),read:async cursor=>{if(!block)return {ok:true,records:[source],total:1,nextCursor:null,omitted:0};if(page==='later_page'&&cursor===null)return {ok:true,records:[],total:1,nextCursor:'pending',omitted:0};entered();await wait;return {ok:true,records:page==='same'?[source]:[],total:page==='same'?1:0,nextCursor:null,omitted:0}},synthesize:async input=>({updates:updates('完成一轮汇报。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
  const remote=new RemoteConversation(options);await remote.poll();block=true;const pending=remote.poll();await ready
  const origin=remote.data.messages[0],reply=remote.beginReply({messageId:origin.id,sourceKey:source.key,sourceRevision:source.revision},'A distinct owner request')
  if(finish)remote.completeReply(reply.id,{status:'unknown',answer:'Original uncertain-delivery answer',receipt:{accepted:false,delivery:'unknown',mutationId:'00000000-0000-0000-0000-000000000071'}})
  const expected=JSON.parse(await readFile(options.file,'utf8'));release();await pending
  const actual=JSON.parse(await readFile(options.file,'utf8'));assert.deepEqual(actual.replies,expected.replies);assert.deepEqual(actual.messages,expected.messages);assert.equal(actual.expiredReplies,expected.expiredReplies)
  const recovered=new RemoteConversation(options);assert.equal(recovered.data.replies[0].id,reply.id);assert.deepEqual(recovered.data.replies,finish?expected.replies:expected.replies.map(r=>({...r,status:'failed'})))
  await remote.close();await recovered.close()
 })
})


test('a sent reply remains unknown when receipt writes fail before service recovery',async t=>{
 const {PersonalBotService}=await import('../src/service.mjs')
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-reply-receipt-write-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const source=row('source'),options={file:join(directory,'remote.json'),read:async()=>({ok:true,records:[source],total:1,nextCursor:null,omitted:0}),synthesize:async input=>({updates:updates('完成一轮汇报。',input.records),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll();const origin=remote.data.messages[0],reference={messageId:origin.id,sourceKey:source.key,sourceRevision:source.revision};let sends=0,failures=0
 const save=remote.save.bind(remote);remote.save=next=>{if(next.replies?.some(reply=>reply.status==='unknown')&&failures<2){failures++;throw Error('private receipt persistence failure')}return save(next)}
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async(text,_snapshot,_reply,owner)=>{const reply=remote.beginReply(reference,text,{id:owner.id,onBound:owner.bind});await remote.dispatchReply(reply,async beforeSend=>{beforeSend();sends++;return {accepted:false,delivery:'unknown'}});return 'No delivery claim'}})
 service.attachRemoteUpdates(remote);assert.equal(service.sendText('A unique owner instruction.'),true);await assert.doesNotReject(service.pending)
 assert.equal(sends,1);assert.equal(failures,2);assert.equal(service.status.state,'error');assert.equal(remote.data.replies[0].status,'unknown');assert.equal(remote.data.replies[0].receipt,undefined)
 assert.throws(()=>remote.beginReply(reference,'Another instruction without a new completion'),/unknown|pending/);const recovered=new RemoteConversation(options);assert.equal(recovered.data.replies[0].status,'unknown')
 await service.close();await remote.close();await recovered.close()
})

test('new summaries require a concise grounded task name and retain it across restart',async t=>{
 const records=[row('android')], citations=records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))
 const update={text:'客户端已连接，设备输入仍待验证。',sourceKeys:['android'],taskName:'Android 客户端连接'}
 assert.equal(validateRemoteSummary({updates:[update],citations},records).updates[0].taskName,update.taskName)
 for(const taskName of [undefined,'','x'.repeat(41),'bad\nname'])assert.throws(()=>validateRemoteSummary({updates:[{...update,taskName}],citations},records))
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-task-name-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const options={file:join(directory,'remote.json'),read:async()=>({ok:true,records,total:1,nextCursor:null}),synthesize:async()=>({updates:[update],citations}),publish:()=>{}}
 const remote=new RemoteConversation(options);await remote.poll()
 assert.equal(remote.snapshot().messages[0].sources[0].taskName,update.taskName)
 const restored=new RemoteConversation({...options,synthesize:async()=>{throw Error('No model call on replay')}})
 await restored.poll(); assert.equal(restored.snapshot().messages[0].sources[0].taskName,update.taskName)
})

test('retained task naming drains bounded batches without replaying summaries or changing source identities',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-retained-names-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json');let current=row('session-0')
 const seed=new RemoteConversation({file,read:async()=>({ok:true,records:[current],total:1,nextCursor:null}),synthesize:async({records})=>({updates:updates(`Result for ${current.sessionId}`,records),citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}})
 for(let i=0;i<9;i++){current=row(`session-${i}`);await seed.poll()}
 const legacy=JSON.parse(await readFile(file,'utf8'));for(const message of legacy.messages)for(const source of message.sources)delete source.taskName
 await writeFile(file,JSON.stringify(legacy))
 const batches=[];let summaryCalls=0
 const options={file,read:async()=>({ok:true,records:[],total:0,nextCursor:null}),synthesize:async()=>{summaryCalls++;throw Error('No summary replay')},publish:()=>{},nameTasks:async({records})=>{
  batches.push(records.length)
  return {names:records.map((r,i)=>({key:r.key,name:`Task ${batches.length}-${i}`})),citations:records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))}
 }}
 const remote=new RemoteConversation(options);await remote.drain()
 assert.deepEqual(batches,[7,2]);assert.equal(summaryCalls,0)
 assert.equal(new Set(remote.data.messages.flatMap(message=>message.sources.map(source=>source.taskName))).size,9)
 const withoutNames=remote.data.messages.map(message=>({...message,sources:message.sources.map(({taskName,...source})=>source)}))
 assert.deepEqual(withoutNames,legacy.messages,'naming preserves message IDs, text, order and source revisions')
 const recovered=new RemoteConversation({...options,nameTasks:async()=>assert.fail('Already named')});await recovered.drain()
 assert.equal(recovered.snapshot().messages.every(message=>message.sources.every(source=>source.taskName)),true)
})

test('retained-task naming failures have a bounded retry count and reviewed replacements update all task labels',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-name-replacement-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json');let current=row('android'),name='Android connection',nameCalls=0
 const options={file,read:async()=>({ok:true,records:[current],total:1,nextCursor:null}),synthesize:async({records})=>({updates:[{text:'Result received.',taskName:name,sourceKeys:records.map(r=>r.key)}],citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
 const seed=new RemoteConversation(options);await seed.poll()
 const legacy=JSON.parse(await readFile(file,'utf8'));delete legacy.messages[0].sources[0].taskName;await writeFile(file,JSON.stringify(legacy))
 const named={...options,nameTasks:async()=>{nameCalls++;throw Error('Names require review')}}
 const remote=new RemoteConversation(named);await remote.poll();await remote.poll();await new RemoteConversation(named).poll();await new RemoteConversation(named).poll();assert.equal(nameCalls,3)
 current=row('android','b'.repeat(64));name='Android microphone acceptance'
 await remote.poll();assert.equal(remote.data.messages.length,2)
 assert.deepEqual(remote.data.messages.flatMap(message=>message.sources.map(source=>source.taskName)),[name,name],'reviewed replacement is not overwritten by the old title')
})

test('pending retained names preserve concurrent reply receipts and cannot publish after close',async t=>{
 for(const close of [false,true])await t.test(close?'shutdown':'owner receipt',async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-name-race-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  const file=join(directory,'remote.json'),source=row('android'),seedOptions={file,read:async()=>({ok:true,records:[source],total:1,nextCursor:null}),synthesize:async({records})=>({updates:updates('Android connection is ready.',records),citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}),publish:()=>{}}
  const seed=new RemoteConversation(seedOptions);await seed.poll()
  const legacy=JSON.parse(await readFile(file,'utf8'));delete legacy.messages[0].sources[0].taskName;await writeFile(file,JSON.stringify(legacy))
  let release,entered;const started=new Promise(resolve=>{entered=resolve})
  const remote=new RemoteConversation({...seedOptions,nameTasks:({records})=>{entered();return new Promise(resolve=>{release=()=>resolve({names:records.map(r=>({key:r.key,name:'Android 客户端连接'})),citations:records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))})})}})
  const pending=remote.poll();await started
  const message=remote.snapshot().messages[0],reference={messageId:message.id,sourceKey:source.key,sourceRevision:source.revision}
  const reply=remote.beginReply(reference,'Continue this task')
  remote.completeReply(reply.id,{status:'unknown',receipt:{delivery:'unknown'}})
  const stopping=close?remote.close():undefined
  release();await pending;await stopping
  assert.equal(remote.data.replies[0].status,'unknown');assert.equal(remote.data.replies[0].receipt.delivery,'unknown')
  assert.equal(remote.data.messages[0].sources[0].taskName,close?undefined:'Android 客户端连接')
  if(close) {
   const restarted=new RemoteConversation({...seedOptions,nameTasks:async({records})=>({names:records.map(r=>({key:r.key,name:'Android 客户端连接'})),citations:records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))})})
   await restarted.poll();assert.equal(restarted.data.messages[0].sources[0].taskName,'Android 客户端连接','interrupted read-only naming can resume without replaying messages or requests')
  }
 })
})
