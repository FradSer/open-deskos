'use strict'
const text=(value,n)=>typeof value==='string' && value.length<=n && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
const states=new Set(['disabled','live','partial','stale','unavailable'])
const unavailable=()=>({state:'unavailable',messages:[]})
/** This projection has no actions. Only bounded conversation text and source references reach the renderer. */
function parseRemoteConversation(value) {
  if(!value || !states.has(value.state) || !Array.isArray(value.messages) || value.messages.length>8 || Buffer.byteLength(JSON.stringify(value))>65536)return unavailable()
  const messages=[]
  for(const item of value.messages) {
    if(!item || (item.presentation !== undefined && item.presentation !== 'assistant_update') || (item.presentation === 'assistant_update' && (!text(item.text,600) || !item.text.trim())) || !text(item.id,64) || !text(item.text,4000) || !Array.isArray(item.sources) || item.sources.length>7
      || item.verification!=='reported_unverified' || item.synthesisVerification!=='passed')return unavailable()
    const sources=[]
    for(const source of item.sources) {
      if(!source || !text(source.key,256) || !text(source.revision,64) || !text(source.machine,256) || !text(source.sessionId,256) || !text(source.project,4096)
        || !['report_only','configured'].includes(source.control))return unavailable()
      sources.push({key:source.key,revision:source.revision,machine:source.machine,sessionId:source.sessionId,project:source.project,control:source.control,
        ...(source.control==='configured' && ['cm5','mac'].includes(source.target) && text(source.taskId,256)?{target:source.target,taskId:source.taskId}:{}),
        availability:source.availability==='live'?'live':'unavailable',historyTruncated:source.historyTruncated===true})
    }
    messages.push({id:item.id,text:item.text,sources,...(item.presentation === 'assistant_update' ? {presentation:'assistant_update'} : {}),omittedSources:Number.isSafeInteger(item.omittedSources)?item.omittedSources:0,verification:'reported_unverified',synthesisVerification:'passed'})
  }
  return {state:value.state,messages,total:Number.isSafeInteger(value.total)?value.total:messages.length,
    expiredMessages:Number.isSafeInteger(value.expiredMessages)?value.expiredMessages:0,omitted:Number.isSafeInteger(value.omitted)?value.omitted:0,hasMore:value.hasMore===true,heldCount:Number.isSafeInteger(value.heldCount)?value.heldCount:0}
}
module.exports={parseRemoteConversation}
