import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile, mkdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { PersonalBotService } from '../src/service.mjs'
import { createWindowsPrivatePaths } from '../src/proactive-private-windows.mjs'
import { createConversationProjection } from '../src/conversation-projection.mjs'
async function fixture(t) { const dir=await realpath(await mkdtemp(join(tmpdir(),'odk-conversation-')));t.after(()=>rm(dir,{recursive:true,force:true}));if(process.platform==='win32')createWindowsPrivatePaths()('Protect',dir,true);return join(dir,'conversation.json') }
const status=(id,state='thinking',message='')=>({v:1,type:'status',ownerTurnId:id,state,transcript:'你好\n原任务',message})
test('public owner turns deduplicate and restore without private service context',async t=>{
 const file=await fixture(t),id=randomUUID(),p=await createConversationProjection({file})
 const frame={...status(id),memory:'secret',agents:[{context:'secret'}],remote:{secret:true}}
 assert.doesNotThrow(()=>p.observe(frame));p.observe({...frame,message:'处理中'})
 const replyTo={messageId:'a'.repeat(64),sourceKey:'b'.repeat(64),sourceRevision:'c'.repeat(64)},threadId='d'.repeat(64)
 p.observe({...status(id,'idle','已回答'),replyTo,threadId});p.observe(status(id,'thinking','late'))
 const before=p.snapshot();assert.equal(before.conversation.turns.length,1);assert.equal(before.conversation.turns[0].message,'已回答')
 assert.deepEqual(before.conversation.turns[0].replyTo,replyTo);assert.equal(before.conversation.turns[0].threadId,threadId)
 assert.doesNotMatch(JSON.stringify(before),/secret|memory|agents|remote/);before.conversation.turns[0].message='mutated'
 assert.equal(await p.close(),true)
 const q=await createConversationProjection({file});assert.equal(q.snapshot().conversation.turns[0].message,'已回答');await q.close()
 const info=await lstat(file);if(process.platform!=='win32')assert.equal(info.mode&0o077,0)
})
test('pending turns become unconfirmed once on restart without replay',async t=>{
 const file=await fixture(t),p=await createConversationProjection({file});p.observe(status(randomUUID(),'thinking','partial'));await p.close()
 const q=await createConversationProjection({file});assert.equal(q.snapshot().conversation.turns[0].state,'unconfirmed');await q.close()
 const bytes=await readFile(file,'utf8'),r=await createConversationProjection({file});await r.close();assert.equal(await readFile(file,'utf8'),bytes)
})
test('retention and complete public frames stay within byte and count budgets',async t=>{
 const file=await fixture(t),p=await createConversationProjection({file})
 for(let i=0;i<180;i++)p.observe({...status(randomUUID(),'idle','中'.repeat(16000)),transcript:'中'.repeat(4000)})
 p.observe({...status(randomUUID(),'idle','\\"'.repeat(8192)),transcript:'\\'.repeat(4096)})
 const frame=p.snapshot();assert.ok(frame.conversation.turns.length<=8);assert.ok(Buffer.byteLength(JSON.stringify(frame))<=60*1024)
 assert.equal(await p.close(),true);const stored=JSON.parse(await readFile(file,'utf8'));assert.ok(stored.turns.length<=128);assert.ok(Buffer.byteLength(JSON.stringify(stored))<=1024*1024)
})
test('invalid input and storage failure never throw into the service or overwrite foreign files',async t=>{
 const file=await fixture(t),p=await createConversationProjection({file});p.observe(status(randomUUID()));await p.close()
 const q=await createConversationProjection({file});await rm(file);await mkdir(file)
 assert.doesNotThrow(()=>q.observe(status(randomUUID(),'idle','answer')));assert.equal(await q.close(),false);assert.equal(q.snapshot().conversation.turns.at(-1).message,'answer');assert.equal((await lstat(file)).isDirectory(),true)
 const bad=await createConversationProjection({file});assert.doesNotThrow(()=>bad.observe({v:1,type:'status',get ownerTurnId(){throw Error('unsafe')}}));assert.equal(await bad.close(),false)
})
test('malformed private checkpoints are preserved without importing their data',async t=>{
 const file=await fixture(t);await writeFile(file,'{"v":1,"turns":[{"memory":"private"}]}',{mode:0o600})
 if(process.platform==='win32')createWindowsPrivatePaths()('Protect',file,false)
 const p=await createConversationProjection({file});assert.deepEqual(p.snapshot().conversation.turns,[]);p.observe(status(randomUUID(),'idle','new'));assert.equal(await p.close(),false)
 assert.equal(await readFile(file,'utf8'),'{"v":1,"turns":[{"memory":"private"}]}')
})

test('actual public service frames preserve the owner answer across background notifications',async t=>{
 const file=await fixture(t),p=await createConversationProjection({file});let finish
 const gate=new Promise(resolve=>{finish=resolve})
 const service=new PersonalBotService({record:async()=>{throw Error('not used')},transcribe:async()=>'',prompt:async()=>{await gate;return '这是本轮回答'}})
 const detach=service.subscribe(frame=>p.observe(frame))
 assert.equal(service.sendText('本轮问题'),true)
 assert.equal(p.snapshot().conversation.turns[0].transcript,'本轮问题')
 finish();await service.pending
 assert.equal(p.snapshot().conversation.turns[0].state,'idle')
 service.setState('recording','background capture','old text');service.notify('background notice')
 assert.equal(p.snapshot().conversation.turns[0].message,'这是本轮回答')
 detach();await service.close();assert.equal(await p.close(),true)
 const q=await createConversationProjection({file});assert.equal(q.snapshot().conversation.turns.length,1);assert.equal(q.snapshot().conversation.turns[0].message,'这是本轮回答');await q.close()
})

test('an actual service shutdown does not turn a pending owner request into a blank completed turn',async t=>{
 const file=await fixture(t),p=await createConversationProjection({file});let release
 const gate=new Promise(resolve=>{release=resolve})
 const service=new PersonalBotService({record:async()=>{throw Error('not used')},transcribe:async()=>'',prompt:async()=>{await gate;return 'late answer'}})
 const detach=service.subscribe(frame=>p.observe(frame));service.sendText('尚未确认的请求')
 const closing=service.close();release();await closing;detach();await p.close()
 const q=await createConversationProjection({file});assert.equal(q.snapshot().conversation.turns[0].state,'unconfirmed');assert.equal(q.snapshot().conversation.turns[0].transcript,'尚未确认的请求');await q.close()
})

test('invalid control text cannot poison other public conversation turns',async t=>{
 const file=await fixture(t),p=await createConversationProjection({file})
 p.observe(status(randomUUID(),'idle','正常中文\n下一行\t制表\r回车'))
 p.observe(status(randomUUID(),'idle','隐藏\u0001控制字'))
 p.observe({...status(randomUUID(),'idle','正常'),transcript:'坏\u0000正文'})
 p.observe(status(randomUUID().toUpperCase(),'idle','非规范ID'))
 p.observe({...status(randomUUID(),'idle','正常'),replyTo:{messageId:'a'.repeat(64),sourceKey:'bad\tkey',sourceRevision:'b'.repeat(64)}})
 assert.equal(p.snapshot().conversation.turns.length,1);assert.match(p.snapshot().conversation.turns[0].message,/正常中文/)
 assert.equal(await p.close(),true)
 const q=await createConversationProjection({file});assert.equal(q.snapshot().conversation.turns.length,1);await q.close()
})
