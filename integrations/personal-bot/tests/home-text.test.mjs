import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PersonalBotService } from '../src/service.mjs'

test('typed turns share streaming session and serialize against voice', async () => {
  let complete
  let calls = 0
  const service = new PersonalBotService({ record: async () => { throw Error('must not record') }, transcribe: async () => '',
    prompt: async (text, snapshot) => { calls++; assert.equal(text, 'Hello 中文'); snapshot('Partial'); return await new Promise(resolve => { complete = resolve }) } })
  assert.equal(service.sendText('Hello 中文'), true)
  assert.equal(service.status.state, 'thinking')
  assert.equal(service.status.transcript, 'Hello 中文')
  assert.equal(service.sendText('duplicate'), false)
  await service.toggle()
  assert.equal(calls, 1)
  complete('Final')
  await service.pending
  assert.equal(service.status.message, 'Final')
  assert.equal(service.status.state, 'idle')
  assert.equal(service.sendText(' '.repeat(3)), false)
  assert.equal(service.sendText('中'.repeat(2000)), false)
  await service.close()
  assert.equal(service.sendText('after close'), false)
})

test('a typed reply keeps its durable binding through streaming and reconnect frames',async()=>{
 const {validReplyTo}=await import('../src/session-replies.mjs')
 const replyTo={messageId:'a'.repeat(64),sourceKey:'source',sourceRevision:'b'.repeat(64)},reply={id:'00000000-0000-0000-0000-000000000001',replyTo,threadId:'c'.repeat(64),source:{key:'source',revision:'b'.repeat(64)}}
 const saved=[],calls=[]
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async(text,stream,bound)=>{calls.push({text,bound});stream('已受理');return '等待原会话结果。'}})
 service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},beginReply:(reference,text)=>{if(!validReplyTo(reference))throw Error('bad');saved.push({reference,text});return reply},completeReply:(id,patch)=>saved.push({id,patch})})
 assert.equal(service.sendText('用 adb 输入安卓',replyTo),true);assert.deepEqual(service.status.replyTo,replyTo);assert.equal(service.status.threadId,reply.threadId)
 await service.pending;assert.deepEqual(calls,[{text:'用 adb 输入安卓',bound:reply}]);assert.deepEqual(service.status.replyTo,replyTo);assert.equal(saved[1].patch.status,'answered')
 assert.equal(service.sendText('普通问题'),true);await service.pending;assert.equal(service.status.replyTo,undefined)
 const before=calls.length;assert.equal(service.sendText('不应发送',{...replyTo,target:'other'}),false);assert.equal(calls.length,before)
 await service.close()
})
