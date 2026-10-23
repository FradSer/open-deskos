import { endpoint, fixtureToken } from './helpers/private-channel.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listen } from '../src/socket.mjs'
import { randomUUID } from 'node:crypto'

test('the authenticated proposal channel carries candidate feedback without inventing action confirmation', { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-feedback-channel-'))
  const received = []
  const service = { status: { v: 1, type: 'status', state: 'idle' }, subscribe: () => () => {},
    async proposalCommand(command) { received.push(command) },
  }
  const server = await listen(endpoint(directory, 'agent'), service, { token: fixtureToken })
  const clients = []
  t.after(async () => { for (const client of clients) client.destroy(); await server.close(); await rm(directory, { recursive: true, force: true }) })
  const id = randomUUID()
  for (const decision of ['done', 'snooze', 'useful', 'irrelevant', 'incorrect']) {
    const client = connect(endpoint(directory, 'agent')); clients.push(client)
    await once(client, 'connect')
    const reply = new Promise(resolve => { client.once('data', resolve); client.once('close', resolve) })
    client.write((process.platform === 'win32' ? JSON.stringify({ v: 1, token: fixtureToken }) + '\n' : '') + JSON.stringify({ v: 1, type: 'proposal_respond', id, decision }) + '\n')
    await reply
    assert.equal(received.at(-1)?.decision, decision)
    assert.equal(received.at(-1)?.id, id)
    assert.equal(received.at(-1)?.confirmation, undefined)
    client.destroy()
  }
  const client = connect(endpoint(directory, 'agent')); clients.push(client)
  await once(client, 'connect')
  const closed = once(client, 'close')
  client.write((process.platform === 'win32' ? JSON.stringify({ v: 1, token: fixtureToken }) + '\n' : '') + JSON.stringify({ v: 1, type: 'proposal_respond', id, decision: 'execute_anything' }) + '\n')
  await closed
  assert.equal(received.length, 5)
})

test('a transport batch admits separate bounded owner commands in order', {timeout:3000}, async t=>{
  const directory=await mkdtemp(join(tmpdir(),'voice-batch-')),calls=[]
  const service={status:{v:1,type:'status',state:'idle',message:''},subscribe:()=>()=>{},sendText:text=>{calls.push(text);return true}}
  const server=await listen(endpoint(directory,'agent'),service,{token:fixtureToken}),client=connect(endpoint(directory,'agent'))
  t.after(async()=>{client.destroy();await server.close();await rm(directory,{recursive:true,force:true})})
  await once(client,'connect')
  const replies=[]
  const completed=new Promise(resolve=>{
    let pending=''
    const timer=setTimeout(resolve,1000)
    client.on('data',bytes=>{pending+=bytes.toString();let end;while((end=pending.indexOf('\n'))>=0){replies.push(JSON.parse(pending.slice(0,end)));pending=pending.slice(end+1)}if(replies.length===2){clearTimeout(timer);resolve()}})
    client.once('close',()=>{clearTimeout(timer);resolve()})
  })
  const commands=['a'.repeat(2800),'b'.repeat(2800)].map(text=>JSON.stringify({v:1,type:'text',requestId:randomUUID(),text})+'\n').join('')
  client.write((process.platform==='win32'?JSON.stringify({v:1,token:fixtureToken})+'\n':'')+commands)
  await completed
  assert.deepEqual(calls,['a'.repeat(2800),'b'.repeat(2800)])
  assert.equal(replies.length,2)
})

test('toggle acknowledgement waits for the accepted retry instead of echoing stale error', { timeout: 3000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-ack-'))
  let release
  const service = {
    status: { v: 1, type: 'status', state: 'error', message: 'Previous failure' },
    subscribe: () => () => {},
    async toggle() {
      await new Promise(resolve => { release = resolve })
      this.status = { v: 1, type: 'status', state: 'recording', message: '' }
    },
    setState() {},
  }
  const server = await listen(endpoint(directory, 'agent'), service, { token: fixtureToken })
  const client = connect(endpoint(directory, 'agent'))
  t.after(async () => { release?.(); client.destroy(); await server.close(); await rm(directory, { recursive: true, force: true }) })
  await once(client, 'connect')
  client.setEncoding('utf8')
  const records = []
  client.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  client.write((process.platform === 'win32' ? JSON.stringify({v:1,token:fixtureToken}) + '\n' : '') + '{"v":1,"type":"toggle"}\n{"v":1,"type":"status"}\n')
  await once(client, 'data')
  assert.equal(records.length, 1, 'Only the explicit status query replies while toggle is pending')
  assert.equal(records[0].state, 'error')
  const acknowledged = once(client, 'data')
  release()
  await acknowledged
  assert.equal(records.at(-1).state, 'recording')
})

test('only explicit consumer-ready status recovers offers and retries are connection scoped', { timeout: 5000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-ready-channel-')), recovered = []
  const service = { status: { v: 1, type: 'status', state: 'idle' }, subscribe: () => () => {}, consumerReady() { recovered.push(true) } }
  const server = await listen(endpoint(directory, 'agent'), service, { token: fixtureToken }), clients = []
  t.after(async () => { clients.forEach(c => c.destroy()); await server.close(); await rm(directory, { recursive: true, force: true }) })
  async function peer() {
    const client = connect(endpoint(directory, 'agent')); clients.push(client); await once(client, 'connect'); client.setEncoding('utf8')
    if (process.platform === 'win32') client.write(JSON.stringify({ v: 1, token: fixtureToken }) + '\n')
    return client
  }
  async function status(client, fields = {}) {
    const data = once(client, 'data'); client.write(JSON.stringify({ v: 1, type: 'status', ...fields }) + '\n'); await data
  }
  const client = await peer(), id = randomUUID()
  await status(client, { runtimeDiagnosis: 1 }); assert.equal(recovered.length, 0)
  await status(client, { proposalConsumerReady: id }); assert.equal(recovered.length, 1)
  await status(client, { proposalConsumerReady: id }); assert.equal(recovered.length, 1)
  const next = await peer(); await status(next, { proposalConsumerReady: id }); assert.equal(recovered.length, 2)
  delete service.consumerReady
  await status(next, { proposalConsumerReady: randomUUID() }); assert.equal(next.destroyed, false, 'custom legacy services need no recovery port')
})
