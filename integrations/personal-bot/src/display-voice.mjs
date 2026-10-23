import { randomUUID } from 'node:crypto'
import { open, lstat } from 'node:fs/promises'
import { constants } from 'node:fs'

const MAX_AUDIO=1_920_044
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name))

async function readAudio(file) {
 const named=await lstat(file)
 if(!named.isFile()||named.isSymbolicLink())throw Error('Invalid recording')
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW)
 try {
  const before=await handle.stat()
  if(!before.isFile()||before.nlink!==1||before.ino!==named.ino||before.dev!==named.dev||before.size<46||before.size>MAX_AUDIO)throw Error('Invalid recording')
  const bytes=Buffer.alloc(before.size+1);let used=0
  while(used<bytes.length){const result=await handle.read(bytes,used,bytes.length-used,used);if(!result.bytesRead)break;used+=result.bytesRead}
  const after=await handle.stat(),current=await lstat(file)
  for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])if(before[key]!==after[key]||before[key]!==current[key])throw Error('Recording changed')
  if(current.isSymbolicLink()||used!==before.size)throw Error('Invalid recording')
  return bytes.subarray(0,used)
 }finally{await handle.close()}
}

/** This adapter captures and uploads only. It never loads transcription or inference credentials. */
export function createDisplayVoice({send,record,onLevel=(_level)=>{},startTimeoutMs=10000,resultTimeoutMs=10000,captureTimeoutMs=59000}) {
 for(const [value,limit]of [[startTimeoutMs,10000],[resultTimeoutMs,10000],[captureTimeoutMs,59000]])if(!Number.isInteger(value)||value<1||value>limit)throw Error('Invalid voice deadline')
 let active,retiring,closed=false,lastStatus='unavailable'
 const clear=lease=>{clearTimeout(lease.startTimer);clearTimeout(lease.captureTimer);clearTimeout(lease.resultTimer)}
 const cleanup=lease=>{
  if(!lease.recording)return Promise.resolve()
  lease.cleaning??=Promise.resolve().then(()=>lease.recording.cleanup()).catch(error=>{lease.cleaning=undefined;throw error})
  return lease.cleaning
 }
 const observe=(task,lease,reason='unavailable')=>{void task.catch(()=>abort(lease,reason)).catch(()=>{})}
 async function abort(lease,reason='cancelled',notify=true) {
  if(active===lease){active=undefined;clear(lease)
   const frame={v:1,type:'voice_cancel',requestId:lease.requestId,...(lease.id?{leaseId:lease.id}:{}),...(reason==='cancelled'?{}:{reason})}
   if(notify)void Promise.resolve().then(()=>send(frame)).catch(()=>{})
  }
  await cleanup(lease)
 }
 async function retire(lease,notify) {
  retiring=lease
  await abort(lease,'cancelled',false);await lease.acquisition?.catch(()=>{});await cleanup(lease)
  if(notify)await send({v:1,type:'voice_cancel',requestId:lease.requestId,...(lease.id?{leaseId:lease.id}:{})})
  if(retiring===lease)retiring=undefined
  return true
 }
 function upload(lease) {
  if(active!==lease)return
  if(lease.phase==='acquiring'){lease.stopRequested=true;return}
  if(lease.phase!=='recording')return
  lease.phase='uploading';clearTimeout(lease.captureTimer)
  observe((async()=>{
   const file=await lease.recording.stop()
   if(active!==lease)return
   const bytes=await readAudio(file)
   if(active!==lease)return
   let seq=0
   for(let offset=0;offset<bytes.length;offset+=1536) {
    if(active!==lease)return
    try{await send({v:1,type:'voice_chunk',requestId:lease.requestId,leaseId:lease.id,seq:seq++,data:bytes.subarray(offset,offset+1536).toString('base64')})}catch{await abort(lease,'unavailable');return}
   }
   if(active!==lease)return
   lease.phase='finishing'
   lease.resultTimer=setTimeout(()=>observe(abort(lease,'timeout'),lease),resultTimeoutMs);lease.resultTimer.unref?.()
   try{await send({v:1,type:'voice_end',requestId:lease.requestId,leaseId:lease.id,seq})}catch{await abort(lease,'unavailable')}
  })(),lease,'invalid_audio')
 }
 function acquire(lease) {
  lease.phase='acquiring'
  lease.acquisition=Promise.resolve().then(async()=>{
   lease.recording=await record(level=>{if(active===lease&&lease.phase==='recording'&&Number.isFinite(level))onLevel(Math.max(0,Math.min(1,level)))})
   if(active!==lease){await cleanup(lease);return}
   lease.phase='recording'
   lease.captureTimer=setTimeout(()=>upload(lease),captureTimeoutMs);lease.captureTimer.unref?.()
   observe(lease.recording.done.then(()=>upload(lease)),lease,'microphone')
   if(lease.stopRequested)upload(lease)
  })
  observe(lease.acquisition,lease,'microphone')
 }
 function onFrame(frame) {
  if(frame?.v===1&&frame.type==='status') {
   if(['idle','error','recording','starting','transcribing','thinking','sending','unavailable'].includes(frame.state))lastStatus=frame.state
   return false
  }
  if(!['voice_started','voice_stop','voice_discard','voice_result'].includes(frame?.type))return false
  const lease=active
  if(closed||!lease||frame.requestId!==lease.requestId)return true
  if(frame.type==='voice_started') {
   if(lease.phase!=='waiting')return true
   if(frame.v!==1||frame.accepted!==true||!uuid(frame.leaseId)||!exact(frame,['v','type','requestId','leaseId','accepted'])){observe(abort(lease,'protocol'),lease);return true}
   clearTimeout(lease.startTimer);lease.id=frame.leaseId;acquire(lease);return true
  }
  if(frame.leaseId!==lease.id)return true
  if(frame.type==='voice_discard') {
   if(frame.v!==1||!exact(frame,['v','type','requestId','leaseId']))observe(abort(lease,'protocol'),lease)
   else void retire(lease,true).catch(()=>{})
   return true
  }
  if(frame.type==='voice_stop') {
   if(frame.v!==1||!exact(frame,['v','type','requestId','leaseId']))observe(abort(lease,'protocol'),lease)
   else upload(lease)
   return true
  }
  const shape=frame.accepted===true?['v','type','requestId','leaseId','accepted']:['v','type','requestId','leaseId','accepted','reason']
  if(frame.v!==1||!exact(frame,shape)||typeof frame.accepted!=='boolean'||(frame.accepted===false&&!['cancelled','microphone','unavailable','timeout','protocol','invalid_audio'].includes(frame.reason))||(frame.accepted===true&&lease.phase!=='finishing')){observe(abort(lease,'protocol'),lease);return true}
  void retire(lease,false).catch(()=>{});return true
 }
 return {onFrame,async toggle() {
  if(closed||retiring)return false
  if(active){if(active.phase==='waiting')await abort(active);else upload(active);return true}
  if(lastStatus==='recording'){try{await send({v:1,type:'toggle'});return true}catch{return false}}
  if(!['idle','error'].includes(lastStatus))return false
  const lease={requestId:randomUUID(),id:undefined,phase:'waiting',recording:undefined,cleaning:undefined,startTimer:undefined,captureTimer:undefined,resultTimer:undefined,stopRequested:false}
  active=lease
  lease.startTimer=setTimeout(()=>observe(abort(lease,'timeout'),lease),startTimeoutMs);lease.startTimer.unref?.()
  try{await send({v:1,type:'voice_start',requestId:lease.requestId});return true}catch{await abort(lease,'unavailable');return false}
 },async cancel(){
  if(closed||retiring)return false
  if(!active){if(lastStatus!=='recording')return false;try{await send({v:1,type:'cancel_recording'});return true}catch{return false}}
  if(!['waiting','acquiring','recording'].includes(active.phase))return false
  return retire(active,true)
 },async close(){closed=true;if(active)await abort(active);if(retiring){await retiring.acquisition?.catch(()=>{});await cleanup(retiring);retiring=undefined}}}
}
