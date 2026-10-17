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
