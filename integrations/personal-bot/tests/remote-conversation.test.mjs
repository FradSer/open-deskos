import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { protectProactivePath } from '../src/proactive-private.mjs'
import { RemoteConversation, validateRemoteSummary, validateRemoteReview } from '../src/remote-conversation.mjs'
const row = (key,revision='a'.repeat(64)) => ({ key, machine:'synthetic-mac',sessionId:key,project:'/synthetic/project',revision,updatedAt:1,state:'settled',availability:'live',conclusionOutcome:'reported_finished',eventId:revision,latestEventIsAssistant:true,conclusionIsLatestAssistant:true,conclusion:'Computed total: 6',truncated:false,control:'report_only' })
const updates = (value, records) => [{text:value,sourceKeys:records.map(record=>record.key)}]
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
 const value={updates:[{text:'构建已完成，日志里有六项检查结果。',sourceKeys:['build']},{text:'界面调整还在进行，暂时没有新的结果。',sourceKeys:['design']}],citations:records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}
 assert.equal(validateRemoteSummary(value,records),value)
 for(const updates of [[],[{text:'结果',sourceKeys:['build']}],[{text:'结果',sourceKeys:['build','design']},{text:'重复',sourceKeys:['build']}],[{text:'结果',sourceKeys:['unknown','design']}],[{text:'x'.repeat(601),sourceKeys:['build','design']}],[{text:'结果',sourceKeys:[]}],[{text:'结果',sourceKeys:['build','design'],action:'run'}]])assert.throws(()=>validateRemoteSummary({...value,updates},records))
 assert.throws(()=>validateRemoteSummary({...value,summary:'old schema'},records))
 assert.equal(validateRemoteSummary({...value,updates:[{text:'😀'.repeat(300),sourceKeys:['build','design']}]},records).updates[0].text.length,600)
 assert.throws(()=>validateRemoteSummary({...value,updates:[{text:'😀'.repeat(301),sourceKeys:['build','design']}]},records))
 const many=Array.from({length:4},(_,i)=>row(`key-${i}`)),citations=many.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))
 assert.throws(()=>validateRemoteSummary({updates:many.map(r=>({text:'中'.repeat(501),sourceKeys:[r.key]})),citations},many))
 assert.equal(validateRemoteSummary({updates:many.map(r=>({text:'中'.repeat(500),sourceKeys:[r.key]})),citations},many).updates.length,4)
})

test('one durable batch appends separate assistant messages and restores without replay',async t=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-remote-updates-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
 const file=join(directory,'remote.json'),records=[row('task-a'),row('task-b')];let calls=0
 const synthesize=async input=>{calls++;return {updates:input.records.map((r,i)=>({text:i?'第二项还在等待输入。':'第一项完成了本轮修改。',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}}
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
 const options={file,read:async cursor=>{const offset=cursor?Number(cursor):0;return {ok:true,records:records.slice(offset,offset+4),total:9,omitted:Math.max(0,9-offset-4),nextCursor:offset+4<9?String(offset+4):null}},synthesize:async input=>{calls++;return {updates:input.records.map(r=>({text:`任务 ${r.key} 有新进展。`,sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:'total: 6'}))}},publish:()=>{}}
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
   return {updates:input.records.map(r=>({text:'这项任务已经结束。',sourceKeys:[r.key]})),citations:input.records.map(r=>({key:r.key,revision:r.revision,quote:r.conclusion}))}
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
 const {createRemotePiReader}=await import('../src/remote-pi-reader.mjs')
 for(const mode of ['seen','held','mixed-older-reference','mixed-held-reference','known-exact-reference','matches-older-reference','progress-first','unknown-first','unavailable-first','new-source'])await t.test(mode,async t=>{
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-report-migration-')));protectProactivePath(directory);t.after(()=>rm(directory,{recursive:true,force:true}))
  let source={...row('report'),eventId:null,conclusionOutcome:'unknown'}
  const reader=await createRemotePiReader({targets:[],link:{conclusions:async()=>({ok:true,records:[source],total:1,omitted:0,nextCursor:null}),stop:async()=>{}},backfill:async()=>null});t.after(()=>reader.close())
  const old=(await reader.read()).records[0],{conclusion,...reference}=old
  const older={...reference,revision:'d'.repeat(64),eventId:'persisted-older-entry',conclusionOutcome:'reported_finished'}
  const known=mode==='known-exact-reference',held=mode==='held'||mode==='mixed-held-reference',fresh=mode==='new-source',mixed=mode.startsWith('mixed')||mode==='matches-older-reference'
  const legacy={id:'c'.repeat(64),at:1,text:'Earlier result unchanged.',sources:[known?{...older,revision:old.revision}:reference],verification:'reported_unverified',synthesisVerification:'passed',omitted:0}
  const olderMessage={...legacy,id:'e'.repeat(64),sources:[older]}
  const prior={version:1,seen:fresh||held?[]:[{key:old.key,revision:old.revision,updatedAt:old.updatedAt}],attempted:held?[{key:old.key,revision:old.revision,updatedAt:old.updatedAt}]:[],messages:fresh||held?(mixed?[olderMessage]:[]):mixed?[olderMessage,legacy]:[legacy],cursor:null}
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
  await remote.poll();const notified=fresh||known
  assert.equal(calls,notified?1:0,'new reporter metadata is not proof of a new legacy completion')
  const migrated=JSON.parse(await readFile(file,'utf8'))
  if(!notified){assert.deepEqual(migrated.messages,prior.messages);assert.deepEqual(migrated.seen.map(({completion,...r})=>r),prior.seen);assert.deepEqual(migrated.attempted.map(({completion,...r})=>r),prior.attempted);assert.equal(remote.snapshot().heldCount,held?1:0)}
  const restored=new RemoteConversation(options);await restored.poll();assert.equal(calls,notified?1:0)
  source={...source,updatedAt:2,backend:'changed-metadata'};current=(await reader.read()).records[0];await restored.poll();assert.equal(calls,notified?1:0)
  source={...source,eventId:'persisted-next-entry'};current=(await reader.read()).records[0];await restored.poll();assert.equal(calls,notified?2:1,'different real assistant entries remain reportable even with identical text')
 })
})
