import { open, rename, unlink, lstat, realpath, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { createWindowsPrivatePaths } from './proactive-private-windows.mjs'

const STORE_LIMIT=1024*1024, FRAME_LIMIT=60*1024
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value)
const terminal=state=>['idle','error','unconfirmed'].includes(state)
const states=['thinking','transcribing','idle','error','unconfirmed']
const text=(value,limit)=>typeof value==='string' && value.length<=limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
const exact=(value,keys)=>value && !Array.isArray(value) && Object.keys(value).every(key=>keys.includes(key))
function validReply(value) { return exact(value,['messageId','sourceKey','sourceRevision']) && hash(value.messageId) && text(value.sourceKey,256) && value.sourceKey.trim() && !/[\x00-\x1f\x7f]/.test(value.sourceKey) && hash(value.sourceRevision) }
function validTurn(value) {
 return exact(value,['id','at','transcript','message','state','replyTo','threadId']) && uuid(value.id)
  && Number.isFinite(value.at) && value.at>=0 && text(value.transcript,4096) && text(value.message,16384)
  && states.includes(value.state) && (value.replyTo===undefined || validReply(value.replyTo)) && (value.threadId===undefined || hash(value.threadId))
}
const bytes=value=>Buffer.byteLength(JSON.stringify(value))
const clone=value=>structuredClone(value)
function clipped(value,limit) {
 if(Buffer.byteLength(JSON.stringify(value))<=limit)return value
 const notice='\n[Display truncated]';let result='',used=2
 const reserve=Buffer.byteLength(JSON.stringify(notice))-2
 for(const character of value) {
  const cost=Buffer.byteLength(JSON.stringify(character))-2
  if(used+cost+reserve>limit)break
  result+=character;used+=cost
 }
 return result+notice
}

/** Public display data only. This store cannot dispatch or restore owner operations. */
export async function createConversationProjection({file}) {
 let data={v:1,revision:0,omittedCount:0,turns:[]},healthy=true,closed=false,dirty=false,pending=Promise.resolve(),running=false,identity,parentIdentity,windowsPrivate
 const parent=typeof file==='string'?dirname(file):''
 function privatePath(operation,path,directory) {
  if(process.platform==='win32') {windowsPrivate??=createWindowsPrivatePaths();windowsPrivate(operation,path,directory)}
 }
 function fileIdentity(info) {
  if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1 || info.size>STORE_LIMIT
   || process.platform!=='win32' && (info.uid!==process.getuid() || info.mode&0o077))throw Error('Unsafe conversation file')
  return {dev:info.dev,ino:info.ino,size:info.size,mtime:info.mtimeMs}
 }
 async function inspect() {
  if(await realpath(parent)!==parent)throw Error('Unsafe conversation directory')
  const directory=await lstat(parent)
  if(!directory.isDirectory() || process.platform!=='win32' && (directory.uid!==process.getuid() || directory.mode&0o077))throw Error('Unsafe conversation directory')
  privatePath('Check',parent,true)
  const parentNow={dev:directory.dev,ino:directory.ino}
  if(parentIdentity && JSON.stringify(parentNow)!==JSON.stringify(parentIdentity))throw Error('Conversation directory changed')
  parentIdentity=parentNow
  try {
   const info=await lstat(file)
   privatePath('Check',file,false)
   return fileIdentity(info)
  } catch(error) {if(error.code==='ENOENT')return undefined;throw error}
 }
 async function persist(next) {
  const current=await inspect()
  if(JSON.stringify(current)!==JSON.stringify(identity))throw Error('Conversation file changed')
  const temporary=join(parent,`.conversation-${randomUUID()}.tmp`)
  let handle
  try {
   handle=await open(temporary,'wx',0o600);privatePath('Protect',temporary,false)
   await handle.writeFile(JSON.stringify(next));await handle.sync();await handle.close();handle=undefined
   // Recheck immediately before publishing; never replace a newly foreign path.
   if(JSON.stringify(await inspect())!==JSON.stringify(identity))throw Error('Conversation file changed')
   await rename(temporary,file);identity=await inspect()
   if(process.platform!=='win32') {const directory=await open(parent,'r');try{await directory.sync()}finally{await directory.close()}}
  } finally {await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{})}
 }
 function schedule() {
  dirty=true
  if(running || !healthy)return
  running=true
  pending=Promise.resolve().then(async()=>{
   try {while(dirty && healthy) {dirty=false;await persist(clone(data))}}
   catch {healthy=false}
   finally {running=false}
  }).catch(()=>{healthy=false;running=false})
 }
 try {
  if(!isAbsolute(file))throw Error('Conversation path must be absolute')
  try {await mkdir(parent,{mode:0o700});privatePath('Protect',parent,true)}catch(error){if(error.code!=='EEXIST')throw error}
  identity=await inspect()
  if(identity) {
   const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK)
   let stored
   try {
    if(JSON.stringify(fileIdentity(await handle.stat()))!==JSON.stringify(identity))throw Error('Conversation descriptor changed')
    const buffer=Buffer.alloc(STORE_LIMIT+1);let size=0
    while(size<buffer.length) {const {bytesRead}=await handle.read(buffer,size,buffer.length-size,null);if(!bytesRead)break;size+=bytesRead}
    if(size>STORE_LIMIT || JSON.stringify(fileIdentity(await handle.stat()))!==JSON.stringify(identity) || JSON.stringify(await inspect())!==JSON.stringify(identity))throw Error('Conversation file changed')
    stored=JSON.parse(buffer.subarray(0,size).toString('utf8'))
   } finally {await handle.close()}
   if(!exact(stored,['v','revision','omittedCount','turns']) || stored.v!==1 || !Number.isSafeInteger(stored.revision) || stored.revision<0
    || !Number.isSafeInteger(stored.omittedCount) || stored.omittedCount<0 || !Array.isArray(stored.turns) || stored.turns.length>128 || stored.turns.some(turn=>!validTurn(turn))
    || new Set(stored.turns.map(turn=>turn.id)).size!==stored.turns.length)throw Error('Invalid conversation checkpoint')
   data=stored
   if(data.turns.some(turn=>!terminal(turn.state))) {
    data={...data,revision:data.revision+1,turns:data.turns.map(turn=>terminal(turn.state)?turn:{...turn,state:'unconfirmed'})};schedule();await pending
   }
  }
 } catch {healthy=false;data={v:1,revision:0,omittedCount:0,turns:[]}}
 return {
  observe(status) {
   try {
    if(closed || status?.v!==1 || status.type!=='status' || !uuid(status.ownerTurnId) || !states.includes(status.state) || status.state==='unconfirmed')return
    if(terminal(status.state) && status.transcript==='' && status.message==='')return
    const previous=data.turns.find(turn=>turn.id===status.ownerTurnId)
    if(previous && terminal(previous.state))return
    const turn={id:status.ownerTurnId,at:previous?.at??Date.now(),transcript:status.transcript,message:status.message,state:status.state,
     ...(status.replyTo!==undefined?{replyTo:clone(status.replyTo)}:{}),...(status.threadId!==undefined?{threadId:status.threadId}:{})}
    if(!validTurn(turn) || JSON.stringify(previous)===JSON.stringify(turn))return
    const next={v:1,revision:data.revision+1,omittedCount:data.omittedCount,turns:previous?data.turns.map(item=>item.id===turn.id?turn:item):[...data.turns,turn]}
    while(next.turns.length>128 || bytes(next)>STORE_LIMIT) {next.turns.shift();next.omittedCount++}
    data=next;schedule()
   } catch {}
  },
  snapshot() {
   const turns=clone(data.turns.slice(-8)).map(turn=>({...turn,transcript:clipped(turn.transcript,12000),message:clipped(turn.message,44000)}))
   const frame={v:1,type:'conversation',conversation:{revision:data.revision,turns,omittedCount:data.omittedCount+data.turns.length-turns.length}}
   while(bytes(frame)>FRAME_LIMIT && turns.length>1) {turns.shift();frame.conversation.omittedCount++}
   return frame
  },
  async close() {closed=true;await pending;return healthy},
 }
}
