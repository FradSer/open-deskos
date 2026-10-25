import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { endpoint, fixtureToken } from './helpers/private-channel.mjs'
import { createDisplayRelay } from '../src/display-relay.mjs'
import { mainAlias, connectMain } from '../src/hub-transport.mjs'
import { readFrames, writeFrame } from '../src/channel-frames.mjs'
import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'

async function until(check) {
  const deadline = Date.now() + 2000
  while (!check()) { if (Date.now() > deadline) assert.fail('Expected frame did not arrive'); await new Promise(resolve => setTimeout(resolve, 5)) }
}

test('both displays use one authority and reconnect never replays a lost-receipt mutation', {timeout:5000}, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-display-'))
  const hubPath = endpoint(root, 'hub'), localPath = endpoint(root, 'display')
  const calls = [], upstreams = [], clients = []
  let suppressReceipt = false
  const hub = net.createServer(socket => {
    upstreams.push(socket)
    readFrames(socket, async frame => {
      calls.push(frame)
      if (frame.type === 'host_apps_hello') await writeFrame(socket, { v: 1, type: 'host_apps_ready' })
      if (frame.type === 'status') await writeFrame(socket, {v:1,type:'status',state:'idle',textInput:true,replyInput:true,message:'canonical'})
      if(frame.type==='pi_config' && frame.command.action==='invalid')await writeFrame(socket,{v:1,type:'pi_config_result',requestId:frame.requestId,error:'Invalid selection'})
      else if(frame.type==='pi_config')await writeFrame(socket,{v:1,type:'pi_config_result',requestId:frame.requestId,result:frame.command.action==='cancel'?{}:{login:{state:'prompt',prompt:{type:'secret',message:'Fixture key'}}}})
      if (frame.type === 'text') {
        if (suppressReceipt) { socket.destroy(); return }
        await writeFrame(socket, {v:1,type:'text_receipt',requestId:frame.requestId,accepted:true})
        await writeFrame(socket, {v:1,type:'conversation',conversation:{revision:1,turns:[{id:'owner',message:frame.text}]}})
      }
    })
  })
  await new Promise(resolve => hub.listen(hubPath, resolve))
  const relay = await createDisplayRelay({endpoint:localPath,stateDir:root,token:fixtureToken,alias:'cm5-agent',
    connect:()=>net.connect(hubPath),reconnectMs:10,
    applications: { host: { name: 'FixtureDisplay', platform: 'win32' }, request: async () => ({ ok: true }) } })
  t.after(async()=>{for(const c of clients)c.destroy();await relay.close();for(const s of upstreams)s.destroy();await new Promise(r=>hub.close(r));await rm(root,{recursive:true,force:true})})
  async function display() {
    const client = net.connect(localPath), frames = []
    clients.push(client)
    readFrames(client, frame => { frames.push(frame) }, {maxFrame:131072,maxBatch:524288})
    await once(client,'connect')
    if(process.platform==='win32') client.write(JSON.stringify({v:1,token:fixtureToken})+'\n')
    await writeFrame(client,{v:1,type:'status'})
    await until(()=>frames.some(f=>f.message==='canonical'))
    return {client,frames}
  }
  const a=await display(), b=await display()
  assert.equal(calls.filter(frame => frame.type === 'host_apps_hello').length, 1)
  const loginId=randomUUID()
  await writeFrame(a.client,{v:1,type:'pi_config',requestId:loginId,command:{action:'login',provider:'fixture',method:'api_key'}})
  await until(()=>a.frames.some(f=>f.requestId===loginId))
  assert(!b.frames.some(f=>f.requestId===loginId),'login prompts must not broadcast')
  const invalid=randomUUID()
  await writeFrame(a.client,{v:1,type:'pi_config',requestId:invalid,command:{action:'invalid'}})
  await until(()=>a.frames.some(f=>f.requestId===invalid))
  const takeover=randomUUID()
  await writeFrame(b.client,{v:1,type:'pi_config',requestId:takeover,command:{action:'answer',value:'must-not-forward'}})
  await until(()=>b.frames.some(f=>f.requestId===takeover))
  assert.match(b.frames.find(f=>f.requestId===takeover).error,/Another display/)
  assert(!calls.some(f=>f.requestId===takeover),'a second local connection cannot borrow upstream login ownership')
  const cancelled=randomUUID()
  await writeFrame(a.client,{v:1,type:'pi_config',requestId:cancelled,command:{action:'cancel'}})
  await until(()=>a.frames.some(f=>f.requestId===cancelled))
  const requestId=randomUUID(), replyTo={invalid:'server validates references'}
  await writeFrame(a.client,{v:1,type:'text',requestId,text:'只在 CM5 执行',replyTo})
  await until(()=>a.frames.some(f=>f.type==='conversation')&&b.frames.some(f=>f.type==='conversation'))
  assert.deepEqual(a.frames.find(f=>f.type==='conversation'),b.frames.find(f=>f.type==='conversation'))
  assert.deepEqual(calls.find(f=>f.type==='text'),{v:1,type:'text',requestId,text:'只在 CM5 执行',replyTo})
  const late=await display()
  assert.equal(late.frames.find(f=>f.type==='conversation').conversation.turns[0].message,'只在 CM5 执行')
  suppressReceipt=true
  const lost=randomUUID()
  await writeFrame(b.client,{v:1,type:'text',requestId:lost,text:'不重发'})
  await until(()=>upstreams.length>=2 && b.frames.some(f=>f.state==='unavailable'))
  await until(()=>calls.filter(f=>f.type==='status').length>=4)
  assert.equal(calls.filter(f=>f.requestId===lost).length,1)
  assert.equal(calls.filter(f=>f.type==='text').length,2)
})

test('restricted SSH uses an operator alias, a fixed command and no forwarding', () => {
  for(const invalid of ['-oProxyCommand=x','user@host','cm5 host','','cm5;touch-x']) assert.throws(()=>mainAlias(invalid))
  let invocation
  const child=new EventEmitter()
  child.stdin=new PassThrough();child.stdout=new PassThrough();child.exitCode=null;child.kill=()=>{child.exitCode=0}
  const stream=connectMain('cm5-agent',{spawnProcess:(...args)=>{invocation=args;return child}})
  stream.on('error',()=>{})
  assert.equal(invocation[0],'ssh')
  assert.equal(invocation[1].at(-1),'odk-personal-agent-link')
  assert.equal(invocation[1].at(-2),'cm5-agent')
  for(const option of ['StrictHostKeyChecking=yes','ClearAllForwardings=yes','ForwardAgent=no','PermitLocalCommand=no','BatchMode=yes']) assert.ok(invocation[1].includes(option))
  assert.deepEqual(invocation[2].stdio,['pipe','pipe','ignore'])
  stream.destroy()
})

test('relay releases the local endpoint and upstream when voice cleanup fails', {timeout:3000}, async t => {
  const root=await mkdtemp(join(tmpdir(),'odk-close-')), hubPath=endpoint(root,'hub'),localPath=endpoint(root,'local')
  const sockets=[]
  const hub=net.createServer(socket=>{sockets.push(socket);readFrames(socket,()=>writeFrame(socket,{v:1,type:'status',state:'idle'}))})
  await new Promise(r=>hub.listen(hubPath,r))
  const relay=await createDisplayRelay({endpoint:localPath,stateDir:root,token:fixtureToken,alias:'cm5-agent',connect:()=>net.connect(hubPath),
    createVoice:()=>({onFrame:()=>false,close:async()=>{throw Error('cleanup failed')}})})
  t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>hub.close(r));await rm(root,{recursive:true,force:true})})
  await until(()=>sockets.length===1)
  await new Promise(r=>setTimeout(r,20))
  await assert.rejects(relay.close(),/cleanup failed/)
  await until(()=>sockets[0].destroyed)
  const replacement=net.createServer()
  await new Promise((resolve,reject)=>{replacement.once('error',reject);replacement.listen(localPath,resolve)})
  await new Promise(r=>replacement.close(r))
})
