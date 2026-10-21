'use strict'
const {parseReplyTo}=require('./personal-bot-reply-reference')
const sha=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value)
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const text=(value,n)=>typeof value==='string' && value.length<=n && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
const states=new Set(['disabled','live','partial','stale','unavailable'])
const unavailable=()=>({state:'unavailable',messages:[]})
/** This projection has no actions. Only bounded conversation text and source references reach the renderer. */
function parseRemoteConversation(value) {
  if(!value || !states.has(value.state) || !Array.isArray(value.messages) || value.messages.length>8 || Buffer.byteLength(JSON.stringify(value))>65536)return unavailable()
  for(const key of ['omittedReplies','expiredReplies'])if(value[key]!==undefined && (!Number.isSafeInteger(value[key]) || value[key]<0))return unavailable()
  const messages=[]
  for(const item of value.messages) {
    if(!item || (item.presentation !== undefined && item.presentation !== 'assistant_update') || (item.presentation === 'assistant_update' && (!text(item.text,600) || !item.text.trim())) || !text(item.id,64) || !text(item.text,4000) || !Array.isArray(item.sources) || item.sources.length>7
      || item.verification!=='reported_unverified' || item.synthesisVerification!=='passed')return unavailable()
    const sources=[]
    for(const source of item.sources) {
      if(!source || !text(source.key,256) || !text(source.revision,64) || !text(source.machine,256) || !text(source.sessionId,256) || !text(source.project,4096)
        || (source.taskName!==undefined && (!text(source.taskName,40) || !source.taskName.trim() || source.taskName!==source.taskName.trim() || /[\r\n\t]/.test(source.taskName)))
        || (source.threadId!==undefined && !sha(source.threadId)) || !['report_only','configured'].includes(source.control))return unavailable()
      sources.push({...(source.taskName?{taskName:source.taskName}:{}),...(source.threadId?{threadId:source.threadId}:{}),key:source.key,revision:source.revision,machine:source.machine,sessionId:source.sessionId,project:source.project,control:source.control,
        ...(source.control==='configured' && ['cm5','mac'].includes(source.target) && text(source.taskId,256)?{target:source.target,taskId:source.taskId}:{}),
        availability:source.availability==='live'?'live':'unavailable',historyTruncated:source.historyTruncated===true})
    }
    if(item.threadId!==undefined && (!sha(item.threadId) || !sources.length || !sources.every(source=>source.threadId===item.threadId)))return unavailable()
    if(item.at!==undefined && (!Number.isFinite(item.at) || item.at<0))return unavailable()
    messages.push({...(item.at!==undefined?{at:item.at}:{}),...(item.threadId?{threadId:item.threadId}:{}),id:item.id,text:item.text,sources,...(item.presentation === 'assistant_update' ? {presentation:'assistant_update'} : {}),omittedSources:Number.isSafeInteger(item.omittedSources)?item.omittedSources:0,verification:'reported_unverified',synthesisVerification:'passed'})
  }
  const replies=[]
  if(value.replies!==undefined && (!Array.isArray(value.replies) || value.replies.length>32))return unavailable()
  for(const reply of value.replies??[]) {
    const reference=parseReplyTo(reply?.replyTo)
    if(!reply || !uuid(reply.id) || !sha(reply.threadId) || !reference || !text(reply.text,3000) || !reply.text.trim()
      || !['queued','dispatching','delivered','unknown','answered','failed'].includes(reply.status) || !Number.isFinite(reply.at) || reply.at<0
      || (reply.sessionId!==undefined && (!text(reply.sessionId,256) || !reply.sessionId.trim())) || (reply.answer!==undefined && !text(reply.answer,4000)))return unavailable()
    const receipt=reply.receipt
    if(receipt!==undefined && (!receipt || typeof receipt!=='object' || Array.isArray(receipt)
      || (receipt.accepted!==undefined && typeof receipt.accepted!=='boolean') || (receipt.delivery!==undefined && !['ran','queued','unknown'].includes(receipt.delivery))
      || (receipt.mutationId!==undefined && !uuid(receipt.mutationId))))return unavailable()
    replies.push({...(reply.sessionId!==undefined?{sessionId:reply.sessionId}:{}),id:reply.id,threadId:reply.threadId,text:reply.text,replyTo:reference,status:reply.status,at:reply.at,
      ...(reply.answer!==undefined?{answer:reply.answer}:{}),...(receipt?{receipt:{...(receipt.accepted!==undefined?{accepted:receipt.accepted}:{}),...(receipt.delivery?{delivery:receipt.delivery}:{}),...(receipt.mutationId?{mutationId:receipt.mutationId}:{})}}:{})})
  }
  return {state:value.state,messages,...(value.omittedReplies!==undefined?{omittedReplies:value.omittedReplies}:{}),...(value.expiredReplies!==undefined?{expiredReplies:value.expiredReplies}:{}),...(value.replies!==undefined?{replies}:{}),total:Number.isSafeInteger(value.total)?value.total:messages.length,
    expiredMessages:Number.isSafeInteger(value.expiredMessages)?value.expiredMessages:0,omitted:Number.isSafeInteger(value.omitted)?value.omitted:0,hasMore:value.hasMore===true,heldCount:Number.isSafeInteger(value.heldCount)?value.heldCount:0}
}
module.exports={parseRemoteConversation}
