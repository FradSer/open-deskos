import { createHash } from 'node:crypto'
/** @typedef {{messageId:string, sourceKey:string, sourceRevision:string}} ReplyTo */
/** @typedef {{id:string, replyTo:ReplyTo, threadId:string, text:string, source:{key:string,revision:string,machine:string,project:string,sessionId:string,control:string,target?:string,taskId?:string,taskRevision?:string}}} BoundSessionReply */
/** @typedef {{id:string, bind:(reply:BoundSessionReply)=>void, requireDeliveryAcknowledgement?:()=>void}} OwnerTurn */
export const replyStatuses = ['queued','dispatching','delivered','unknown','answered','failed']
export function validReplyTo(value) {
 return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===3 && Object.keys(value).every(key=>['messageId','sourceKey','sourceRevision'].includes(key))
  && /^[a-f0-9]{64}$/.test(value.messageId) && /^[a-f0-9]{64}$/.test(value.sourceRevision)
  && typeof value.sourceKey==='string' && value.sourceKey.trim().length>0 && value.sourceKey.length<=256 && !/[\x00-\x1f\x7f]/.test(value.sourceKey)
}
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const bounded=(value,max)=>typeof value==='string' && value.length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
export function validSessionReply(reply) {
 if(!reply || Object.keys(reply).some(key=>!['id','threadId','text','sessionId','replyTo','status','at','answer','receipt'].includes(key))
  || !uuid(reply.id) || !/^[a-f0-9]{64}$/.test(reply.threadId) || !validReplyTo(reply.replyTo)
  || !bounded(reply.text,3000) || !reply.text.trim() || !Number.isFinite(reply.at) || reply.at<0 || !replyStatuses.includes(reply.status)
  || (!bounded(reply.sessionId,256) || !reply.sessionId.trim())
  || reply.answer!==undefined && !bounded(reply.answer,4000))return false
 const receipt=reply.receipt
 return receipt===undefined || receipt && typeof receipt==='object' && !Array.isArray(receipt) && Object.keys(receipt).every(key=>['accepted','delivery','mutationId'].includes(key))
  && (receipt.accepted===undefined || typeof receipt.accepted==='boolean') && (receipt.delivery===undefined || ['ran','queued','unknown'].includes(receipt.delivery))
  && (receipt.mutationId===undefined || uuid(receipt.mutationId))
}
export function sessionThread(source, target=undefined) {
 const host=target??(source.control==='configured'?source.target:undefined)
 return createHash('sha256').update(JSON.stringify([host?'configured':'reported',host??source.machine,source.project,source.sessionId])).digest('hex')
}
/** A reply cannot escape to another mutation tool, even through a remembered schema. */
export function guardReplyTools(tools,getReply) {
 return tools.map(tool=>({...tool,execute:async(...args)=>{
  const reply=getReply()
  if(reply) {
   if(!['remote_pi_updates','remote_pi_followup'].includes(tool.name))throw Error('Reply is bound to its original session; another capability is unavailable')
   if(tool.name==='remote_pi_followup' && typeof reply.text==='string' && args[1]?.prompt!==reply.text)throw Error('Use the exact owner reply text without adding instructions')
   if(tool.name==='remote_pi_followup' && (args[1]?.sourceKey!==reply.source.key || args[1]?.sourceRevision!==reply.source.revision))throw Error('Reply source reference changed')
  }
  return tool.execute(...args)
 }}))
}
