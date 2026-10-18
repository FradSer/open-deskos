const {test}=require('node:test')
const assert=require('node:assert/strict')
const {parseRemoteConversation}=require('../src/remote-conversation-frame')
const frame=()=>({state:'partial',messages:[{id:'a'.repeat(64),text:'A remote Pi reports a result.',verification:'reported_unverified',synthesisVerification:'passed',sources:[{key:'b'.repeat(64),revision:'c'.repeat(64),machine:'synthetic-Mac',sessionId:'synthetic-session',project:'/synthetic/project',control:'report_only',availability:'unavailable'}]}],omitted:8,hasMore:true,heldCount:0,total:1})
test('remote frames retain provenance and honest partial state without copying actions',()=>{
 const input=frame();input.messages[0].sources[0].action={tool:'coding_task_prompt'}
 const result=parseRemoteConversation(input)
 assert.equal(result.state,'partial');assert.equal(result.omitted,8);assert.equal(result.messages[0].sources[0].control,'report_only');assert.equal(result.messages[0].sources[0].action,undefined)
 for(const invalid of [{...frame(),state:'complete'},{...frame(),messages:Array(9).fill(frame().messages[0])},{...frame(),messages:[{...frame().messages[0],verification:'passed'}]}])assert.equal(parseRemoteConversation(invalid).state,'unavailable')
})
test('only the fixed assistant update presentation marker crosses the remote frame',()=>{
 const input=frame();input.messages[0].presentation='assistant_update'
 assert.equal(parseRemoteConversation(input).messages[0].presentation,'assistant_update')
 delete input.messages[0].presentation
 assert.equal(Object.hasOwn(parseRemoteConversation(input).messages[0],'presentation'),false)
 for(const presentation of ['assistant','verified',null,{},true]){
  input.messages[0].presentation=presentation
  assert.equal(parseRemoteConversation(input).state,'unavailable')
 }
})
test('assistant update text stays short and nonblank while legacy reports remain compatible',()=>{
 const input=frame();input.messages[0].presentation='assistant_update'
 for(const text of [' '.repeat(10),'x'.repeat(601)]){input.messages[0].text=text;assert.equal(parseRemoteConversation(input).state,'unavailable')}
 input.messages[0].text='x'.repeat(600);assert.equal(parseRemoteConversation(input).messages[0].text.length,600)
 delete input.messages[0].presentation;input.messages[0].text='x'.repeat(4000);assert.equal(parseRemoteConversation(input).messages[0].text.length,4000)
})

test('session threads and durable owner replies retain only bounded references',()=>{
 const input=frame();const threadId='d'.repeat(64)
 input.messages[0].threadId=threadId;input.messages[0].sources[0].threadId=threadId
 input.replies=[{id:'12345678-1234-4123-8123-123456789abc',threadId,text:'继续这个任务',replyTo:{messageId:'a'.repeat(64),sourceKey:'b'.repeat(64),sourceRevision:'c'.repeat(64)},status:'answered',at:1700000000000,answer:'已完成。',receipt:{accepted:true,delivery:'ran',mutationId:'12345678-1234-4123-8123-123456789abd',target:'untrusted'}}]
 const parsed=parseRemoteConversation(input)
 assert.equal(parsed.messages[0].sources[0].threadId,threadId)
 assert.equal(parsed.messages[0].threadId,threadId)
 assert.equal(parsed.replies[0].text,'继续这个任务')
 assert.equal(parsed.replies[0].answer,'已完成。')
 assert.equal(parsed.replies[0].receipt.target,undefined)
 for(const mutate of [value=>value.messages[0].threadId='e'.repeat(64),value=>value.replies[0].threadId='bad',value=>value.replies[0].replyTo.target='mac',value=>value.replies[0].status='verified']) {
  const invalid=structuredClone(input);mutate(invalid);assert.equal(parseRemoteConversation(invalid).state,'unavailable')
 }
})
