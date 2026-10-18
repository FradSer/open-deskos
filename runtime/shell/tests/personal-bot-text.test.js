const { test } = require('node:test')
const { integrationURL } = require('./helpers/repo-root')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createPersonalBotClient } = require('../src/personal-bot-client')

test('typed input is acknowledged by the resident service and never replayed', async t => {
  const { PersonalBotService } = await import(integrationURL('personal-bot/src/service.mjs'))
  const { listen } = await import(integrationURL('personal-bot/src/socket.mjs'))
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-text-'))
  let complete
  let calls = 0
  const service = new PersonalBotService({ record: async () => { throw Error('not a voice turn') }, transcribe: async () => '',
    prompt: async (text, snapshot) => { calls++; assert.equal(text, 'Hello 中文'); snapshot('Partial'); return await new Promise(resolve => { complete = resolve }) } })
  const endpoint = path.join(dir, 'agent.sock')
  const server = await listen(endpoint, service)
  const client = createPersonalBotClient({ socketPath: endpoint, reconnectDelayMs: 50 })
  t.after(async () => { client.stop(); complete?.('Final'); await service.close(); await server.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const connected = new Promise(resolve => { const release = client.subscribe(status => { if (status.textInput) { release(); resolve() } }) })
  client.start()
  await connected
  assert.equal(await client.sendText('Hello 中文'), true)
  assert.equal(calls, 1)
  assert.equal(await client.sendText('duplicate'), false)
  assert.equal(await client.sendText('\u0000'.repeat(2500)), false)
  complete('Final')
  await service.pending
  client.stop()
  assert.equal(await client.sendText('after disconnect'), false)
})

test('typed session replies preserve exact references and reject renderer authority before dispatch', async t => {
  const net = require('node:net')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-text-reply-'))
  const endpoint = path.join(dir, 'agent.sock')
  const requests = []
  const sockets = new Set()
  const server = net.createServer(socket => {
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket))
    let pending = ''
    socket.setEncoding('utf8');socket.on('data',chunk=>{
      const lines=(pending+chunk).split('\n');pending=lines.pop()
      for(const line of lines) {
        const record=JSON.parse(line)
        if(record.type==='status')socket.write(JSON.stringify({v:1,type:'status',state:'idle',textInput:true,replyInput:true})+'\n')
        else if(record.type==='text') {
          requests.push(record)
          socket.write(JSON.stringify({v:1,type:'text_receipt',requestId:record.requestId,accepted:true})+'\n')
        } else assert.fail('Unexpected request')
      }
    })
  })
  await new Promise(resolve=>server.listen(endpoint,resolve))
  const client=createPersonalBotClient({socketPath:endpoint})
  t.after(async()=>{client.stop();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true})})
  client.start()
  await new Promise(resolve=>{const release=client.subscribe(status=>{if(status.textInput){release();resolve()}})})
  const replyTo={messageId:'a'.repeat(64),sourceKey:'b'.repeat(64),sourceRevision:'c'.repeat(64)}
  assert.equal(await client.sendText('继续这个任务',replyTo),true)
  assert.deepEqual(requests[0].replyTo,replyTo)
  for(const invalid of [{...replyTo,target:'mac'},{...replyTo,sourceRevision:''},{...replyTo,sourceKey:null},[],null]) {
    assert.equal(await client.sendText('Invalid authority',invalid),false)
  }
  assert.equal(requests.length,1)
  const downgraded=new Promise(resolve=>{const release=client.subscribe(status=>{if(status.textInput && status.replyInput===false){release();resolve()}})})
  for(const socket of sockets)socket.write(JSON.stringify({v:1,type:'status',state:'idle',textInput:true})+'\n')
  await downgraded
  assert.equal(await client.sendText('Old backend cannot accept a reply',replyTo),false)
  assert.equal(requests.length,1,'missing backend capability never dispatches a reference as ordinary text')
  assert.equal(await client.sendText('Ordinary message'),true)
  assert.equal(Object.hasOwn(requests[1],'replyTo'),false)
  client.stop()
  assert.equal(await client.sendText('Disconnected',replyTo),false)
  assert.equal(requests.length,2)
})
