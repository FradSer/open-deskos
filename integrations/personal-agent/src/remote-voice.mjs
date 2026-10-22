import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync, mkdtempSync, openSync, writeFileSync, closeSync, rmSync, constants } from 'node:fs'
import { join } from 'node:path'
import { createProactiveDirectory, checkProactivePath } from './proactive-private.mjs'

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name))
const MAX_AUDIO=1_920_044

function validWav(bytes) {
 return bytes.length>=46&&bytes.length<=MAX_AUDIO&&(bytes.length-44)%2===0
  &&bytes.toString('ascii',0,4)==='RIFF'&&bytes.readUInt32LE(4)===bytes.length-8
  &&bytes.toString('ascii',8,16)==='WAVEfmt '&&bytes.readUInt32LE(16)===16
  &&bytes.readUInt16LE(20)===1&&bytes.readUInt16LE(22)===1&&bytes.readUInt32LE(24)===16000
  &&bytes.readUInt32LE(28)===32000&&bytes.readUInt16LE(32)===2&&bytes.readUInt16LE(34)===16
  &&bytes.toString('ascii',36,40)==='data'&&bytes.readUInt32LE(40)===bytes.length-44
}

/** Connection identities and output callbacks are supplied only by the authenticated host transport. */
export function createRemoteVoice({service,directory,timeoutMs=90000}) {
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>90000)throw Error('Invalid voice deadline')
 createProactiveDirectory(directory);checkProactivePath(directory)
 const directoryStat=lstatSync(directory)
 if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||realpathSync(directory)!==directory||(directoryStat.mode&0o077)!==0||directoryStat.uid!==process.getuid())throw Error('Unsafe voice directory')
 let active,closed=false

 async function cancel(lease,reason='cancelled') {
  if(active!==lease)return
  active=undefined;clearTimeout(lease.timer);lease.interrupt()
  await service.cancelRemoteRecording(lease.recording,reason)
  void Promise.resolve().then(()=>lease.send({v:1,type:'voice_result',requestId:lease.requestId,leaseId:lease.id,accepted:false,reason})).catch(()=>{})
 }

 async function handle(client,command,send) {
  if(!['voice_start','voice_chunk','voice_end','voice_cancel'].includes(command?.type))return false
  if(!client||typeof client!=='object'||closed)return true
  if(command.type==='voice_start') {
   if(!exact(command,['v','type','requestId'])||command.v!==1||!uuid(command.requestId))return true
   if(active){await send({v:1,type:'voice_started',requestId:command.requestId,accepted:false});return true}
   let resolve,reject,temporary,interrupt
   const ready=new Promise((yes,no)=>{resolve=yes;reject=no});void ready.catch(()=>{})
   const interrupted=new Promise((_yes,no)=>{interrupt=()=>no(Error('Recording cancelled'))});void interrupted.catch(()=>{})
   const lease={id:randomUUID(),requestId:command.requestId,client,send,seq:0,total:0,chunks:[],phase:'starting',stopRequested:false,timer:undefined,recording:undefined,interrupted,interrupt}
   const recording={done:ready.then(()=>undefined),stop:async()=>ready,cleanup:async()=>{
    reject(Error('Recording cancelled'));interrupt();clearTimeout(lease.timer)
    if(active===lease)active=undefined
    lease.chunks=[]
    if(temporary)rmSync(temporary,{recursive:true,force:true})
   }}
   void recording.done.catch(()=>{})
   lease.recording=recording
   active=lease
   if(!service.reserveRemoteRecording(recording,()=>{
    if(active!==lease||lease.stopRequested)return
    lease.stopRequested=true
    void send({v:1,type:'voice_stop',requestId:lease.requestId,leaseId:lease.id}).catch(()=>cancel(lease,'unavailable')).catch(()=>{})
   })) {
    active=undefined;await recording.cleanup()
    await send({v:1,type:'voice_started',requestId:command.requestId,accepted:false});return true
   }
   lease.timer=setTimeout(()=>{void cancel(lease,'timeout').catch(()=>{})},timeoutMs);lease.timer.unref?.()
   try {
    await Promise.race([send({v:1,type:'voice_started',requestId:lease.requestId,leaseId:lease.id,accepted:true}),interrupted])
    if(active===lease)lease.phase='receiving'
   }catch{await cancel(lease,'unavailable')}
   lease.complete=bytes=>{
    temporary=mkdtempSync(join(directory,'remote-voice-'))
    const file=join(temporary,'audio.wav'),fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600)
    try{writeFileSync(fd,bytes)}finally{closeSync(fd)}
    return file
   }
   lease.resolve=resolve
   return true
  }
  const lease=active
  // A stale or foreign request never changes the current recording.
  if(!lease||lease.client!==client||command.requestId!==lease.requestId)return true
  const pendingCancel=command.type==='voice_cancel'&&command.leaseId===undefined&&exact(command,['v','type','requestId',...(command.reason===undefined?[]:['reason'])])
  if(!pendingCancel&&command.leaseId!==lease.id)return true
  if(command.v!==1){await cancel(lease,'protocol');return true}
  if(command.type==='voice_cancel') {
   const names=['v','type','requestId',...(command.leaseId===undefined?[]:['leaseId']),...(command.reason===undefined?[]:['reason'])]
   if(!exact(command,names) || command.reason!==undefined&&!['microphone','unavailable','timeout','protocol','invalid_audio'].includes(command.reason)){await cancel(lease,'protocol');return true}
   await cancel(lease,command.reason ?? 'cancelled');return true
  }
  if(lease.phase!=='receiving'){await cancel(lease,'protocol');return true}
  if(command.type==='voice_chunk') {
   if(!exact(command,['v','type','requestId','leaseId','seq','data'])||command.seq!==lease.seq||lease.seq>=2048||typeof command.data!=='string'||!command.data.length||command.data.length>2048){await cancel(lease,'protocol');return true}
   const bytes=Buffer.from(command.data,'base64')
   if(!bytes.length||bytes.toString('base64')!==command.data||lease.total+bytes.length>MAX_AUDIO){await cancel(lease,'invalid_audio');return true}
   lease.total+=bytes.length;lease.seq++;lease.chunks.push(bytes);return true
  }
  if(!exact(command,['v','type','requestId','leaseId','seq'])||command.seq!==lease.seq){await cancel(lease,'protocol');return true}
  const bytes=Buffer.concat(lease.chunks,lease.total);lease.chunks=[]
  if(!validWav(bytes)){await cancel(lease,'invalid_audio');return true}
  lease.phase='finishing'
  try {
   const file=lease.complete(bytes)
   await Promise.race([send({v:1,type:'voice_result',requestId:lease.requestId,leaseId:lease.id,accepted:true}),lease.interrupted])
   if(active===lease){active=undefined;clearTimeout(lease.timer);lease.resolve(file)}
  }catch{await cancel(lease,'unavailable')}
  return true
 }

 return {handle,async toggle(_client){if(service.status.state!=='recording')return false;await service.toggle();return true},
  async close(client=undefined){if(client===undefined)closed=true;const lease=active;if(lease&&(client===undefined||lease.client===client))await cancel(lease,'unavailable')},
 }
}
