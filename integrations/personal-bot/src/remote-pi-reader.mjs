import { sessionThread } from './session-replies.mjs'
import { join } from 'node:path'
import { RemoteConversation } from './remote-conversation.mjs'
import { createHash } from 'node:crypto'
import { loadShellModule } from './plugin-composition.mjs'
import { loadTargets, taskRequest, carriedProject, watchTaskCompletions } from './task-client.mjs'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
/** @param {{env?: NodeJS.ProcessEnv, link?: any, targets?: any[], request?: typeof taskRequest, backfill?: (source: any, options?: {signal?: AbortSignal}) => Promise<any>}} [options]
 * Shared Link reports and separately configured control targets never infer authority from each other. */
export async function createRemotePiReader({env=process.env,link,targets,request=taskRequest,backfill}={}) {
  const client=link??loadShellModule('odk-link-client.js').createOdkLinkClient({env})
  const fill=backfill??loadShellModule('pi-session-backfill.js').createPiBackfill({env})
  const configured=targets??await loadTargets(env.ODK_TASK_TARGETS_FILE)
  const lifetime=new AbortController()
  const subscriptions=[],subscriptionStates=new Map()
  let inventory=[],unavailable=0,incomplete=0
  let active=lifetime.signal
  async function loadInventory() {
    inventory=[];unavailable=0;incomplete=configured.reduce((count,target)=>count+Math.max(0,target.roots.length-32),0);const seen=new Set()
    for(const target of configured)for(const project of target.roots.slice(0,32)) {
      try {
        const reply=await request(target,{command:'list',project},active)
        if(!Array.isArray(reply.tasks))throw Error('Unavailable inventory')
        if(reply.truncated || reply.incomplete || reply.tasks.length>100)incomplete++
        for(const task of reply.tasks.slice(0,100)) {
          if(!task || typeof task.taskId!=='string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(task.taskId) || !carriedProject(task.project,Boolean(target.host)) || task.project.length>4096){incomplete++;continue}
          const key=hash([target.id,task.project,task.taskId])
          if(seen.has(key))continue
          seen.add(key);inventory.push({target,task,key,endpointKind:reply.endpointKind==='hosted'?'hosted':'current_session_or_unknown'})
        }
      }catch{unavailable++}
    }
  }
  async function reportRecord(source,signal) {
        const fetched=await fill(source,{signal:signal})
        signal.throwIfAborted()
        const event=fetched ? loadShellModule('pi-conclusions.js').latestAssistantConclusion(fetched.events) : undefined
        const record={...source,...(event?{conclusion:event.text.slice(0,2048),conclusionOutcome:event.stopReason==='stop'?'reported_finished':'unknown',eventId:event.eventId??null,conclusionIsLatestAssistant:event===fetched.events.findLast(item=>item?.kind==='assistant'),latestEventIsAssistant:fetched.events.at(-1)?.kind==='assistant',truncated:event.truncated===true || event.text.length>2048,historyTruncated:fetched.truncated===true,backend:'configured_log_tail'}:{backend:'reported_tail'}),availability:event || source.conclusion?'live':'unavailable'}
        record.revision=hash({...record,revision:undefined,updatedAt:undefined,threadId:undefined});return record
  }
  return {thread(source){return sessionThread(source,configured.filter(target=>target.reportMachines?.includes(source.machine)).length===1?configured.find(target=>target.reportMachines?.includes(source.machine)).id:undefined)},subscribe(onCompletion,onUnavailable=(_count)=>{}){
    if(subscriptions.length || lifetime.signal.aborted)return ()=>{}
    for(const target of configured)subscriptions.push(watchTaskCompletions(target,{signal:lifetime.signal,onCompletion,onState:state=>{subscriptionStates.set(target.id,state);onUnavailable([...subscriptionStates.values()].filter(value=>value==='unavailable').length)}}))
    return ()=>{for(const subscription of subscriptions)void subscription.close().catch(()=>{})}
  },async close(){lifetime.abort();await Promise.all(subscriptions.map(subscription=>subscription.close()));await client.stop?.()},async followup(source,params,signal,{explicitReply=false,beforeSend=()=>{}}={}) {
    if(!source || source.revision!==params.sourceRevision)throw Error('Remote source revision changed')
    const active=AbortSignal.any([lifetime.signal,...(signal?[signal]:[]),AbortSignal.timeout(30000)])
    let bound=source
    if(explicitReply) {
      if(source.control==='configured' && source.key!==hash([source.target,source.project,source.taskId]))throw Error('Invalid configured source identity')
      const matches=[]
      const candidates=configured.filter(target=>source.control==='configured'?target.id===source.target:target.reportMachines?.includes(source.machine))
      if(!candidates.length)throw Error('Reporting machine has no configured control binding')
      if(candidates.some(target=>target.roots.length>32))throw Error('Incomplete reply inventory; too many configured roots')
      for(const target of candidates)for(const project of target.roots) {
        const page=await request(target,{command:'list',project},active)
        if(target.endpointKind==='current_session' && page.endpointKind!==undefined && page.endpointKind!=='current_session')throw Error('Configured native endpoint conflicts with the protocol')
        if(!Array.isArray(page.tasks) || page.incomplete || page.truncated || page.tasks.length>100)throw Error('Incomplete reply inventory; clarify before sending')
        for(const task of page.tasks)if(task?.taskId===source.sessionId && task.project===source.project)matches.push({target,task,nativeEndpoint:page.endpointKind==='current_session' || target.endpointKind==='current_session',endpointKind:page.endpointKind==='hosted'?'hosted':'current_session_or_unknown'})
      }
      if(matches.length!==1)throw Error('Reply session is absent or ambiguous; no prompt sent')
      const match=matches[0]
      bound={...source,target:match.target.id,taskId:match.task.taskId,taskRevision:match.task.revision??hash(match.task),endpointKind:match.endpointKind,nativeEndpoint:match.nativeEndpoint}
    } else if(source.control!=='configured' || source.key!==hash([source.target,source.project,source.taskId]))throw Error('Remote source is stale or report-only')
    const target=configured.find(target=>target.id===bound.target)
    if(!target)throw Error('Remote control target is unavailable')
    const status=await request(target,{command:'status',project:source.project,taskId:bound.taskId},active)
    if(bound.nativeEndpoint && status.endpointKind!==undefined && status.endpointKind!=='current_session')throw Error('Native endpoint conflicts with the status protocol')
    const fresh=status.task
    // Explicit replies use list only for identity; Hosted status supplies the admission CAS.
    const requiresSnapshotRevision=!explicitReply || !bound.nativeEndpoint && bound.endpointKind!=='hosted'
    if(!fresh || fresh.taskId!==bound.taskId || fresh.project!==source.project || requiresSnapshotRevision && (fresh.revision??hash(fresh))!==bound.taskRevision)throw Error('Remote task revision changed; read and clarify before sending')
    if(explicitReply) {
      const live=fresh.lifecycle==='live' && ['settled','running','finished','failed','cancelled'].includes(fresh.state)
      const restorable=bound.endpointKind==='hosted' && ['finished','failed','cancelled','interrupted'].includes(fresh.state) && ['ended','interrupted'].includes(fresh.lifecycle) && ['idle_expired','evicted','host_restart'].includes(fresh.endedReason) && typeof fresh.sessionFile==='string'
      if(!live && !restorable)throw Error('Original session is not live or safely recoverable; no prompt sent')
    }
    const requiresKnownDelivery=!explicitReply || !bound.nativeEndpoint
    if(requiresKnownDelivery && fresh.deliveries?.some(delivery=>delivery.state==='unknown' || delivery.status==='unknown' || delivery.admission==='unknown'))throw Error('Earlier delivery is unknown; reconcile without replay')
    if(explicitReply && bound.endpointKind==='hosted') {
      if(typeof fresh.revision!=='string' || !/^[a-f0-9]{64}$/.test(fresh.revision))throw Error('Remote task revision unavailable; read and clarify before sending')
      bound={...bound,taskRevision:fresh.revision}
    }
    beforeSend()
    return request(target,{command:'prompt',project:source.project,taskId:bound.taskId,prompt:params.prompt,
      ...(params.streamingBehavior?{streamingBehavior:params.streamingBehavior}:{}),
      ...(bound.endpointKind==='hosted'?{expectedRevision:bound.taskRevision}:{})},active)
  },async read(cursor=null) {
    active=AbortSignal.any([lifetime.signal,AbortSignal.timeout(30000)])
    active.throwIfAborted()
    if(cursor!==null && typeof cursor!=='string')return {ok:false,reason:'cursor_expired'}
    if(cursor===null || cursor.startsWith('report:')) {
      const page=await client.conclusions({cursor:cursor?.slice(7)??null,limit:4,signal:active})
      if(!page.ok && page.reason==='cursor_expired')return page
      const records=[]
      for(const source of page.records??[]) {
        records.push(await reportRecord(source,active))
      }
      return {ok:true,records,total:page.total??0,omitted:page.omitted??0,nextCursor:page.nextCursor?`report:${page.nextCursor}`:'hosted:0',unavailableSources:page.ok?0:1}
    }
    if(!/^hosted:\d+$/.test(cursor))return {ok:false,reason:'cursor_expired'}
    const offset=Number(cursor.slice(7));if(offset===0)await loadInventory()
    if(offset>inventory.length)return {ok:false,reason:'cursor_expired'}
    const records=[]
    for(const source of inventory.slice(offset,offset+4)) {
      const {target,task,key,endpointKind}=source
      let current=task,available=true
      try{const candidate=(await request(target,{command:'status',project:task.project,taskId:task.taskId},active)).task;if(!candidate || candidate.taskId!==task.taskId || candidate.project!==task.project)throw Error();current=candidate}catch{available=false}
      const record={key,machine:target.id,sessionId:task.taskId,taskId:task.taskId,target:target.id,project:task.project,
        updatedAt:Number.isFinite(Date.parse(current.updatedAt))?Date.parse(current.updatedAt):0,state:current.state??'unknown',
        currentTurnId:current.currentTurnId??null,lastTurnId:current.lastTurnId??null,...(current.turnOutcome?{turnOutcome:current.turnOutcome}:{}),taskRevision:current.revision??hash(current),endpointKind,control:'configured',conclusion:available&&typeof current.response==='string'?current.response.slice(0,2048):'',
        truncated:(current.response?.length??0)>2048,historyTruncated:true,execution:'reported_unverified',conclusionOutcome:current.turnOutcome==='finished'?'reported_finished':['failed','cancelled'].includes(current.turnOutcome)?current.turnOutcome:'unknown',availability:available?'live':'unavailable'}
      records.push({...record,revision:hash(record)})
    }
    active.throwIfAborted()
    const next=offset+records.length
    return {ok:true,records,total:inventory.length,omitted:Math.max(0,inventory.length-next)+incomplete,nextCursor:next<inventory.length?`hosted:${next}`:null,unavailableSources:unavailable}
  }}
}

/** Acquire remote resources only after an Agent exists, and unwind every failed startup. */
export async function attachRemoteConversation({agent,env,stateDir,publish=(_frame)=>{},createReader=createRemotePiReader}) {
  if(!agent.remoteEnabled)return undefined
  let reader
  try {
    reader=await createReader({env})
    const remote=new RemoteConversation({file:join(stateDir,'personal-agent','remote-conversation.json'),read:cursor=>reader.read(cursor),synthesize:input=>agent.summarizeRemote(input),publish,thread:source=>reader.thread?.(source)??sessionThread(source)})
    agent.attachRemoteContext(()=>remote.context(),(offset,limit,sourceKey)=>sourceKey?remote.reference(sourceKey):remote.snapshot(offset,limit),
      (params,signal,reply)=>reply?remote.dispatchReply(reply,beforeSend=>reader.followup(reply.source,params,signal,{explicitReply:true,beforeSend})):reader.followup(remote.reference(params.sourceKey).source,params,signal))
    remote.subscribe=onCompletion=>reader.subscribe?.(onCompletion,count=>remote.subscriptionState(count))
    const close=agent.close
    agent.close=async()=>{const pending=remote.close();try{await close()}finally{await reader.close();await pending}}
    return remote
  } catch(error) {
    const cleanup=await Promise.allSettled([Promise.resolve().then(()=>reader?.close()),Promise.resolve().then(()=>agent.close())])
    if(cleanup.some(result=>result.status==='rejected')){console.error('Remote startup cleanup failed');process.exitCode=1}
    throw error
  }
}
