const { notPortedOnWindows } = require("./not-ported")
// A Windows Shell Host does not port this capability; the reference host runs it.
if (notPortedOnWindows(require("node:test").test, "unix-socket")) return

const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const { createPersonalBotClient, resolvePersonalBotSocketPath } = require('../src/personal-bot-client')

test('separate home frames preserve voice replies and stale content across reconnect', { timeout: 3000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-home-channel-'))
  const endpoint = path.join(dir, 'a.sock')
  const server = net.createServer()
  const peers = new Set()
  server.on('connection', peer => { peers.add(peer); peer.on('error', () => {}) })
  t.after(async () => { for (const peer of peers) peer.destroy(); await new Promise(r => server.close(r)); await fs.rm(dir, { recursive: true, force: true }) })
  server.listen(endpoint)
  await once(server, 'listening')
  const client = createPersonalBotClient({ socketPath: endpoint, reconnectDelayMs: 1 })
  t.after(() => client.stop())
  function next(predicate) {
    return new Promise(resolve => {
      let unsubscribe = () => {}
      unsubscribe = client.subscribe(frame => { if (predicate(frame)) { unsubscribe(); resolve(frame) } })
    })
  }
  let connection = once(server, 'connection')
  client.start()
  let [peer] = await connection
  await once(peer, 'data')
  const reply = '\u0000'.repeat(16384)
  const agents = { state: 'live', tasks: [{ taskId: '64a7f377-3169-447c-9b85-547a2454c28f', identity: { id: 'reporter', name: 'Reporter', avatar: 'book', revision: 'a'.repeat(64) }, state: 'running', updatedAt: '2026-10-16T00:00:00.000Z' }] }
  const remote={state:'partial',messages:[{id:'a'.repeat(64),text:'Pi reports a result.',presentation:'assistant_update',sources:[],verification:'reported_unverified',synthesisVerification:'passed'}],total:1,omitted:8,hasMore:true,heldCount:0}
  const briefing = { state: 'live', generatedAt: 1000, omittedSources: 0, items: [{ text: 'Mail content', sources: [{ id: 'mail', label: 'Mail', state: 'live' }] }] }
  let update = next(frame => frame.briefing?.state === 'live')
  peer.write(JSON.stringify({ v: 1, type: 'status', state: 'idle', ownerTurnId:'11111111-1111-4111-8111-111111111111', message: reply, agents, jev: { status: 'checking', key: 'must-not-project' }, judgment:{status:'ready',provider:'model',model:'synthetic/model-v1',body:'must-not-project'} }) + '\n' + JSON.stringify({v:1,type:'remote_conversation',remote}) + '\n' + JSON.stringify({ v: 1, type: 'briefing', briefing }) + '\n')
  assert.equal((await update).message, reply)
  assert.equal(client.snapshot().ownerTurnId,'11111111-1111-4111-8111-111111111111','owner identity projects before a session is selected')
  assert.deepEqual(client.snapshot().agents, agents)
  assert.deepEqual(client.snapshot().jev, {status:'checking'})
  assert.deepEqual(client.snapshot().judgment,{status:'ready',provider:'model',model:'synthetic/model-v1'})
  let history={revision:2,turns:[{id:'11111111-1111-4111-8111-111111111111',at:10,transcript:'Earlier owner input',message:'Earlier answer',state:'idle'}],omittedCount:0}
  update=next(frame=>frame.conversation?.revision===2)
  peer.write(JSON.stringify({v:1,type:'conversation',conversation:history})+'\n')
  const historical=await update
  assert.deepEqual(historical.conversation,history)
  assert.equal(historical.message,reply,'history cannot replace current status text')
  peer.write(JSON.stringify({v:1,type:'conversation',conversation:{...history,revision:1,turns:[]}})+'\n')
  await new Promise(resolve=>setTimeout(resolve,10))
  assert.deepEqual(client.snapshot().conversation,history,'older history cannot replace a newer projection')
  assert.equal(client.snapshot().remote.messages[0].presentation,'assistant_update');assert.equal(client.snapshot().remote.state,'partial');assert.equal(client.snapshot().remote.messages[0].text,remote.messages[0].text)
  update=next(frame=>frame.state==='unavailable')
  peer.write(JSON.stringify({v:1,type:'status',state:'unavailable',textInput:false,replyInput:false,message:'Central agent disconnected'})+'\n')
  const disconnected=await update
  assert.equal(disconnected.textInput,false);assert.equal(disconnected.replyInput,false)
  assert.equal(disconnected.message,'Central agent disconnected')
  assert.deepEqual(disconnected.conversation,history,'an unavailable upstream retains history while the local pipe remains open')
  assert.equal(await client.sendText('Must not dispatch'),false)
  history={...history,revision:0}
  update=next(frame=>frame.conversation?.revision===0)
  peer.write(JSON.stringify({v:1,type:'conversation',conversation:history})+'\n')
  assert.deepEqual((await update).conversation,history,'upstream reconnect accepts a new epoch without closing the local pipe')
  update = next(frame => frame.state === 'recording')
  peer.write('{"v":1,"type":"status","state":"recording","ownerTurnId":"invalid-id","message":"","jev":{"status":"verified","body":"must-not-project"}}\n')
  assert.equal((await update).briefing.items[0].text, 'Mail content')
  assert.equal(client.snapshot().ownerTurnId,undefined,'invalid identity is rejected and does not retain the previous owner')
  assert.equal(client.snapshot().remote.messages.length,1)
  assert.deepEqual(client.snapshot().conversation,history,'live state frames retain independent history')
  assert.deepEqual(client.snapshot().jev,{status:'verified'})
  update = next(frame => frame.state === 'unavailable')
  connection = once(server, 'connection')
  peer.destroy()
  assert.equal((await update).briefing.state, 'stale')
  assert.deepEqual(client.snapshot().conversation,history,'disconnect retains visible history')
  assert.deepEqual(client.snapshot().jev,{status:'unavailable'})
  assert.equal(client.snapshot().agents.state, 'unavailable')
  ;[peer] = await connection
  await once(peer, 'data')
  update = next(frame => frame.state === 'idle')
  peer.write('{"v":1,"type":"status","state":"idle","message":""}\n')
  assert.equal((await update).briefing.state, 'stale')
  assert.equal(client.snapshot().jev,undefined,'old service does not retain earlier verified authentication')
  assert.equal(client.snapshot().judgment,undefined,'old service cannot retain an earlier ready judgment')
  update=next(frame=>frame.conversation?.revision===0)
  peer.write(JSON.stringify({v:1,type:'conversation',conversation:{...history,revision:0}})+'\n')
  assert.equal((await update).conversation.revision,0,'the first valid history of a new transport epoch replaces the cache')
})

test('microphone toggles a resident service and receives truthful status', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-v-'))
  const socketPath = path.join(dir, 'v.sock')
  const server = net.createServer()
  t.after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }) })
  server.listen(socketPath)
  await once(server, 'listening')
  const client = createPersonalBotClient({ socketPath })
  t.after(() => client.stop())
  const connection = once(server, 'connection')
  client.start()
  const [peer] = await connection
  t.after(() => peer.destroy())
  peer.setEncoding('utf8')
  const [request] = await once(peer, 'data')
  assert.equal(JSON.parse(request).type, 'status')
  const recording = new Promise((resolve) => client.subscribe((state) => {
    if (state.state === 'recording') resolve(state)
  }))
  peer.write('{"v":1,"type":"status","state":"recording"}\n')
  assert.equal((await recording).state, 'recording')
  peer.write('{"v":2,"type":"status","state":"thinking"}\nnot-json\n')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(client.snapshot().state, 'recording')
  const nextRequest = once(peer, 'data')
  assert.equal(client.toggle(), true)
  const [toggle] = await nextRequest
  assert.deepEqual(JSON.parse(toggle), { v: 1, type: 'toggle' })
})

test('voice levels and long Markdown replies cross the socket with validated bounds', { timeout: 3000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-v-level-'))
  const socketPath = path.join(dir, 'v.sock')
  const server = net.createServer()
  t.after(async () => { server.close(); await fs.rm(dir, { recursive: true, force: true }) })
  server.listen(socketPath)
  await once(server, 'listening')
  const client = createPersonalBotClient({ socketPath, reconnectDelayMs: 60_000 })
  t.after(() => client.stop())
  const connection = once(server, 'connection')
  client.start()
  const [peer] = await connection
  t.after(() => peer.destroy())
  await once(peer, 'data')
  async function send(record) {
    const next = new Promise((resolve) => {
      const unsubscribe = client.subscribe((status) => {
        if (status.message !== record.message) return
        unsubscribe()
        resolve(status)
      })
    })
    peer.write(`${JSON.stringify({ v: 1, type: 'status', ...record })}\n`)
    return next
  }
  for (const [index, level] of [0, 0.25, 1, -1, 2, null, '0.5', undefined].entries()) {
    const status = await send({ state: 'recording', level, message: `level-${index}` })
    assert.equal(status.level, typeof level === 'number' && level >= 0 && level <= 1 ? level : 0)
  }
  assert.equal((await send({ state: 'thinking', level: 0.5, message: 'working' })).level, 0)
  const transcript = '请帮我整理任务 <script>literal</script>'
  for (const [state, message] of [['thinking', ''], ['thinking', '# Reply'], ['idle', '# Reply\nComplete']]) {
    const status = await send({ state, message, transcript })
    assert.equal(status.transcript, transcript)
    assert.equal(status.message, message)
  }
  assert.equal((await send({ state: 'thinking', message: 'invalid', transcript: { text: 'bad' } })).transcript, '')
  assert.equal((await send({ state: 'thinking', message: 'bounded', transcript: 'x'.repeat(5000) })).transcript.length, 4096)
  assert.equal((await send({ state: 'recording', message: 'new recording', transcript })).transcript, '')
  const message = '\u0001'.repeat(16384)
  const full = await send({ state: 'idle', message, transcript: '\u0002'.repeat(4096) })
  assert.equal(full.message, message)
  assert.equal(full.transcript, '\u0002'.repeat(4096))
  const {PersonalBotService}=await import('../../../integrations/personal-bot/src/service.mjs')
  for(const reason of ['microphone','timeout','unavailable','protocol','invalid_audio','cancelled']) {
    const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:async()=>''})
    const recording={done:new Promise(()=>{}),stop:async()=>'',cleanup:async()=>{}}
    service.reserveRemoteRecording(recording,()=>{})
    await service.cancelRemoteRecording(recording,reason)
    const status=await send({...service.status,message:'Updated owner wording '+reason})
    assert.equal(status.voiceFailure,reason==='cancelled'?undefined:reason,'producer cause survives without matching message text')
    service.setState('thinking','Next turn')
    assert.equal((await send(service.status)).voiceFailure,undefined,'next turn clears the old cause')
    await service.close()
  }
  for(const voiceFailure of ['unknown',{code:'microphone'},'microphone']) {
    const status=await send({state:voiceFailure==='microphone'?'idle':'error',voiceFailure,message:'Rejected cause '+JSON.stringify(voiceFailure)})
    assert.equal(status.voiceFailure,undefined,'unknown causes and causes on a nonerror state are dropped')
  }
  const disconnected = new Promise((resolve) => client.subscribe((status) => {
    if (status.state === 'unavailable') resolve(status)
  }))
  peer.write(`${'x'.repeat(131073)}\n`)
  assert.equal((await disconnected).state, 'unavailable')
})

test('missing runtime path never queues a microphone toggle', () => {
  assert.equal(resolvePersonalBotSocketPath({}), null)
  assert.equal(resolvePersonalBotSocketPath({ XDG_RUNTIME_DIR: 'relative' }), null)
  assert.equal(resolvePersonalBotSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/odk-personal-bot/agent.sock')
  const client = createPersonalBotClient({ socketPath: null })
  client.start()
  assert.equal(client.toggle(), false)
  assert.equal(client.snapshot().state, 'unavailable')
  client.stop()
})

test('proposals cross the existing private voice link and decisions return on it', { timeout: 5000 }, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-proposal-'))
  const socketPath = path.join(dir, 'v.sock')
  const server = net.createServer()
  server.listen(socketPath); await once(server, 'listening')
  const client = createPersonalBotClient({ socketPath })
  let peer
  t.after(async () => { client.stop(); peer?.destroy(); server.close(); await fs.rm(dir, { recursive: true, force: true }) })
  const connection = once(server, 'connection'); client.start(); [peer] = await connection; await once(peer, 'data')
  const proposal = { id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry', status: 'pending', advice: '检查盆土', evidence: [], confirmation: '记住 watering：检查盆土' }
  const received = new Promise(resolve => { const off = client.subscribe(status => { if (status.proposals?.length) { off(); resolve(status) } }) })
  peer.write(JSON.stringify({ v: 1, type: 'status', state: 'idle', proposals: [proposal], proposalPopup: true }) + '\n')
  const frame = await received
  assert.equal(frame.proposalPopup, true); assert.deepEqual(frame.proposals, [proposal])
  const command = once(peer, 'data'); assert.equal(client.proposalCommand({ type: 'proposal_respond', id: proposal.id, decision: 'accept', confirmation: proposal.confirmation }), true)
  assert.deepEqual(JSON.parse((await command)[0]), { v: 1, type: 'proposal_respond', id: proposal.id, decision: 'accept', confirmation: proposal.confirmation })
})

test('completion hints coalesce until the authenticated Bot connection is ready', {timeout:3000}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'odk-completion-queue-')),endpoint=path.join(dir,'a.sock')
  const server=net.createServer(),peers=new Set(),records=[]
  server.on('connection',peer=>{peers.add(peer);let buffer='';peer.on('error',()=>{});peer.on('data',chunk=>{buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)records.push(JSON.parse(line))})})
  server.listen(endpoint);await once(server,'listening')
  const client=createPersonalBotClient({socketPath:endpoint,reconnectDelayMs:1})
  t.after(async()=>{client.stop();for(const peer of peers)peer.destroy();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true})})
  const completed=['odk.app.pi-sessions.completed']
  assert.equal(client.servicePush(completed),false);assert.equal(client.servicePush(completed),false)
  client.start()
  const end=Date.now()+1000;while(records.length<2&&Date.now()<end)await new Promise(r=>setTimeout(r,5))
  assert.deepEqual(records.map(record=>record.type),['status','proactive_event'])
  assert.deepEqual(records[1].readingIds,completed)
  assert.equal(records.filter(record=>record.type==='proactive_event').length,1)
  // The old peer can close after receiving bytes but before handling the hint.
  const reconnected=once(server,'connection')
  for(const peer of peers)peer.destroy()
  await reconnected
  const retryEnd=Date.now()+1000;while(records.length<4&&Date.now()<retryEnd)await new Promise(r=>setTimeout(r,5))
  assert.deepEqual(records.map(record=>record.type),['status','proactive_event','status','proactive_event'])
  assert.deepEqual(records[3].readingIds,completed,'reconnection catches up without replaying any owner command')
})

test('judgment status projects fixed safe readiness independently from optional Jev', () => {
  const {parseJudgmentStatus}=require('../src/judgment-status-frame')
  const {parseJevStatus}=require('../src/jev-status-frame')
  assert.deepEqual(parseJevStatus({status:'disabled',body:'secret'}),{status:'disabled'})
  assert.deepEqual(parseJudgmentStatus({status:'ready',provider:'model',model:'synthetic/model-v1',body:'secret'}),{status:'ready',provider:'model',model:'synthetic/model-v1'})
  for(const value of [{status:'ready',provider:'other'},{status:'ready',provider:'model',model:'https://user:secret@host'},{status:'ready',provider:'jev',model:'synthetic/model-v1'},{status:'ready',provider:'model',model:'jev-test'},null])assert.deepEqual(parseJudgmentStatus(value),{status:'unavailable',provider:'model'})
  assert.equal(parseJudgmentStatus(undefined),undefined)
})
