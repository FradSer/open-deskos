const {test}=require('node:test')
const assert=require('node:assert/strict')
const {parseConversation}=require('../src/conversation-frame')
const id='11111111-1111-4111-8111-111111111111'
const value=()=>({revision:1,turns:[{id,at:100,transcript:'Original owner input',message:'Central answer',state:'idle'}],omittedCount:0})
test('central history projects only bounded display fields without granting authority',()=>{
 const input=value();input.turns[0].secret='not-projected'
 assert.deepEqual(parseConversation(input),value())
 assert.deepEqual(parseConversation({...value(),turns:[{...value().turns[0],state:'unconfirmed'}]}).turns[0].state,'unconfirmed')
 for(const change of [v=>v.revision=-1,v=>v.revision=1.5,v=>v.turns.push(v.turns[0]),v=>v.turns[0].state='completed',v=>v.turns[0].id='bad',v=>v.turns[0].transcript='a'.repeat(4097),v=>v.turns[0].message='a'.repeat(16385),v=>v.omittedCount=-1,v=>v.turns[0].replyTo={},v=>v.turns[0].threadId='bad']) {
  const invalid=value();change(invalid);assert.equal(parseConversation(invalid),null)
 }
 assert.equal(parseConversation({revision:1,turns:Array.from({length:9},(_,i)=>({...value().turns[0],id:id.replace('11111111-',String(i).padStart(8,'0')+'-')}))}),null)
 const huge={revision:1,turns:Array.from({length:8},(_,i)=>({...value().turns[0],id:id.replace('11111111-',String(i).padStart(8,'0')+'-'),message:'界'.repeat(16000)}))}
 assert.equal(parseConversation(huge),null)
})
