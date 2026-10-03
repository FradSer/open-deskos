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
  const disconnected = new Promise((resolve) => client.subscribe((status) => {
    if (status.state === 'unavailable') resolve(status)
  }))
  peer.write(`${'x'.repeat(131073)}\n`)
  assert.equal((await disconnected).state, 'unavailable')
})

test('missing runtime path never queues a microphone toggle', () => {
  assert.equal(resolvePersonalBotSocketPath({}), null)
  assert.equal(resolvePersonalBotSocketPath({ XDG_RUNTIME_DIR: 'relative' }), null)
  assert.equal(resolvePersonalBotSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/open-deskos-personal-bot/agent.sock')
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
