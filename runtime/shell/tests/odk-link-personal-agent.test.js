const { notPortedOnWindows } = require('./not-ported')
// A Windows Shell Host does not port this capability; the reference host runs it.
if (notPortedOnWindows(require('node:test').test, 'unix-socket')) return

const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const { createHmac } = require('node:crypto')

const { createOdkLinkService, personalAgentControlTranscript } = require('../src/odk-link-service')
const { projectPersonalAgentFrame, MAX_PERSONAL_AGENT_FRAME_BYTES } = require('../src/personal-agent-frame')
const fixture = require('./fixtures/personal-agent-v1.json')

// A source with the shape the desk's own resident client has: it pushes every
// change, answers a snapshot, and takes an owner turn.
function fakeSource(status = { state: 'idle', message: '' }) {
  const listeners = new Set()
  const sent = []
  let current = status
  return {
    sent,
    publish(next) {
      current = next
      for (const listener of listeners) listener(current)
    },
    start() {},
    stop() {},
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener)
      listener(current)
      return () => listeners.delete(listener)
    },
    async sendText(text) {
      sent.push(text)
      // The resident answers a boolean receipt; this fake answers the same shape.
      return true
    },
  }
}

async function withService(run, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-personal-agent-svc-'))
  const service = createOdkLinkService({
    token: fixture.read.hello.token,
    controlCredential: fixture.control.credential,
    socketPath: path.join(dir, 'service.sock'),
    port: 0,
    host: '127.0.0.1',
    ...options,
  })
  const bound = await service.start()
  try {
    await run(service, bound.port)
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function openPhone(port, hello = fixture.read.hello) {
  const socket = net.createConnection({ host: '127.0.0.1', port })
  const replies = []
  let buffer = ''
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) replies.push(JSON.parse(line))
  })
  socket.on('error', () => {})
  const waitFor = async (count) => {
    const deadline = Date.now() + 2000
    while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    return replies
  }
  const close = () => new Promise((resolve) => {
    socket.once('close', resolve)
    socket.end()
  })
  socket.write(`${JSON.stringify({ v: 1, type: 'personal-agent-hello', ...hello })}\n`)
  await waitFor(2)
  return { socket, replies, waitFor, close, send: (record) => socket.write(`${JSON.stringify(record)}\n`) }
}

// The phone signs the transcript the challenge produced, built from the fixture
// contract rather than from the desk's own helper.
function proofFor({ nonce, firstFrameSHA256 = fixture.control.firstFrameSHA256 }) {
  const transcript = `${fixture.domain}\n2\n${nonce}\n${firstFrameSHA256}`
  return createHmac('sha256', fixture.control.credential).update(transcript, 'utf8').digest('hex')
}

test('a phone reads the desk Personal Agent frames and follows every change', async () => {
  const source = fakeSource({ state: 'idle', message: '', transcript: 'Summarise the desk' })
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    const [ready, first] = phone.replies
    assert.equal(ready.type, 'personal-agent-ready')
    assert.equal(first.type, 'personal-agent')
    assert.equal(first.development, false, 'the resident is not a development source')
    assert.equal(first.frame.transcript, 'Summarise the desk')

    source.publish({ state: 'thinking', transcript: 'Summarise the desk', message: 'Reading the desk sources' })
    const [, , pushed] = await phone.waitFor(3)
    assert.equal(pushed.frame.state, 'thinking')
    assert.equal(pushed.frame.message, 'Reading the desk sources')
    await phone.close()
  }, { personalAgent: source })
})

test('a phone that attaches later still receives the current frame', async () => {
  const source = fakeSource({ state: 'recording', message: '' })
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    assert.equal(phone.replies[1].frame.state, 'recording')
    await phone.close()
  }, { personalAgent: source })
})

test('a refused token closes the link with the reason named', async () => {
  const source = fakeSource()
  await withService(async (service, port) => {
    const phone = await openPhone(port, { ...fixture.read.hello, token: 'wrong' })
    assert.equal(phone.replies[0].type, 'error')
    assert.equal(phone.replies[0].reason, 'token refused')
    // A refused link is already closing, so the wait must not race its close.
    if (!phone.socket.destroyed) await new Promise((resolve) => phone.socket.once('close', resolve))
    assert.equal(phone.socket.destroyed, true)
  }, { personalAgent: source })
})

test('the desk forwards only the fields the renderer reads and bounds the frame', async () => {
  const source = fakeSource({ state: 'idle', message: '', privateNote: 'do not send me' })
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    const frame = phone.replies[1].frame
    assert.equal(Object.hasOwn(frame, 'privateNote'), false, 'the projection must drop unread fields')
    await phone.close()

    assert.deepEqual(projectPersonalAgentFrame({ state: 'nonsense' }), {
      state: 'unavailable',
      message: 'Personal Agent state unavailable',
    })
    const oversized = projectPersonalAgentFrame({ state: 'idle', message: 'x'.repeat(MAX_PERSONAL_AGENT_FRAME_BYTES + 1) })
    assert.equal(oversized.state, 'unavailable')
    assert.match(oversized.message, /exceeded its bound/)
  }, { personalAgent: source })
})

test('a development source labels every frame it produces', async () => {
  const source = fakeSource({ state: 'recording', message: '' })
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    assert.equal(phone.replies[1].development, true)
    await phone.close()
  }, { personalAgent: source, personalAgentDevelopment: true })
})

test('a submit without a challenge never reaches the resident', async () => {
  const source = fakeSource()
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    phone.send(fixture.control.submit)
    const [, , refusal] = await phone.waitFor(3)
    assert.equal(refusal.type, 'error')
    assert.equal(refusal.reason, 'control challenge required')
    assert.deepEqual(source.sent, [], 'a refused submit must not reach the resident')
    await phone.close()
  }, { personalAgent: source })
})

test('a control proof submits one turn and its nonce cannot be reused', async () => {
  const source = fakeSource({ state: 'idle', message: '' })
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    phone.send(fixture.control.hello)
    const [, , challenge] = await phone.waitFor(3)
    assert.equal(challenge.type, 'challenge')
    assert.equal(challenge.domain, fixture.domain)
    assert.equal(challenge.algorithm, 'hmac-sha256')

    const proof = proofFor({ ...fixture.control.hello, nonce: challenge.nonce })
    phone.send({ v: 2, type: 'personal-agent-submit', requestId: 'request-submit', proof })
    const [, , , receipt] = await phone.waitFor(4)
    assert.equal(receipt.type, 'personal-agent-receipt')
    assert.equal(receipt.accepted, true)
    assert.equal(receipt.requestId, 'request-submit')
    assert.deepEqual(source.sent, ['Summarise the desk'])

    phone.send({ v: 2, type: 'personal-agent-submit', requestId: 'request-replay', proof })
    const [, , , , replay] = await phone.waitFor(5)
    assert.equal(replay.type, 'error')
    assert.equal(replay.reason, 'control challenge required')
    assert.equal(source.sent.length, 1, 'a replayed proof must not submit a second turn')
    await phone.close()
  }, { personalAgent: source })
})

test('the desk reports the phone as one connected client without reporting it as a reporter', async () => {
  const source = fakeSource()
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    const clients = service.personalAgentClients()
    assert.equal(clients.length, 1)
    assert.equal(clients[0].machine, fixture.read.hello.machine)
    assert.equal(clients[0].sessionId, fixture.read.hello.sessionId)
    // A reader is not a reporter: the session snapshot stays empty.
    assert.equal(service.snapshot().summary.total, 0)
    await phone.close()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.deepEqual(service.personalAgentClients(), [], 'a closed link leaves no connected client behind')
  }, { personalAgent: source })
})

test('a boolean receipt from the resident reaches the phone accepted', async () => {
  // The real resident resolves a boolean, so the desk must read that shape.
  const source = fakeSource()
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    phone.send(fixture.control.hello)
    const [, , challenge] = await phone.waitFor(3)
    const proof = proofFor({ ...fixture.control.hello, nonce: challenge.nonce })
    phone.send({ v: 2, type: 'personal-agent-submit', requestId: 'request-submit', proof })
    const [, , , receipt] = await phone.waitFor(4)
    assert.equal(receipt.accepted, true, 'a boolean true receipt must arrive as accepted')
    await phone.close()
  }, { personalAgent: source })
})

test('a wrong proof is refused without reaching the resident', async () => {
  const source = fakeSource()
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    phone.send(fixture.control.hello)
    await phone.waitFor(3)
    // A phone holding only the report token can present a proof of the right
    // shape with the wrong secret.
    phone.send({ v: 2, type: 'personal-agent-submit', requestId: 'request-submit', proof: 'f'.repeat(64) })
    const [, , , refusal] = await phone.waitFor(4)
    assert.equal(refusal.reason, 'control proof refused')
    assert.deepEqual(source.sent, [])
    await phone.close()
  }, { personalAgent: source })
})

test('a desk without a control credential refuses the challenge', async () => {
  const source = fakeSource()
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    phone.send(fixture.control.hello)
    const [, , refusal] = await phone.waitFor(3)
    assert.equal(refusal.type, 'error')
    assert.equal(refusal.reason, 'control unavailable')
    await phone.close()
  }, { personalAgent: source, controlCredential: '' })
})

test('the shared fixture pins the control transcript and its proof', async () => {
  const identity = { machine: fixture.control.hello.machine, sessionId: fixture.control.hello.sessionId, nonce: fixture.control.challenge.nonce, firstFrameSHA256: fixture.control.firstFrameSHA256 }
  assert.equal(personalAgentControlTranscript(identity), fixture.control.transcript)
  assert.match(fixture.control.transcript, /^odk-personal-agent-control-v2\n2\n/)
  assert.equal(proofFor(identity), fixture.control.proof, 'the fixture proof must match its own credential and transcript')
})

test('central conversation identity and availability survive the phone frame', () => {
  const id = '12345678-1234-1234-1234-123456789abc'
  const ref = { messageId: 'a'.repeat(64), sourceKey: 'source', sourceRevision: 'b'.repeat(64) }
  const conversation = { revision: 4, turns: [{ id, at: 1, transcript: 'hello', message: 'answer', state: 'idle', replyTo: ref, threadId: 'c'.repeat(64) }], omittedCount: 0 }
  const frame = projectPersonalAgentFrame({ state: 'idle', ownerTurnId: id, conversation, replyTo: ref, threadId: 'c'.repeat(64), textInput: true, replyInput: true, judgment: { status: 'ready', provider: 'model' } })
  assert.deepEqual(frame.conversation, conversation)
  assert.equal(frame.ownerTurnId, id)
  assert.deepEqual(frame.replyTo, ref)
  assert.equal(frame.threadId, 'c'.repeat(64))
  assert.equal(frame.textInput, true)
  assert.equal(frame.replyInput, true)
  assert.equal(frame.voiceInput, false)
})

test('a new personal control role binds raw first-frame bytes and forwards the stored reply', async () => {
  const source = fakeSource(); source.sendText = async (...args) => { source.sent.push(args); return true }
  await withService(async (service, port) => {
    const phone = await openPhone(port)
    const ref = { messageId: 'a'.repeat(64), sourceKey: 'source', sourceRevision: 'b'.repeat(64) }
    const first = { v: 2, type: 'personal-agent-control', machine: fixture.read.hello.machine, sessionId: fixture.read.hello.sessionId, requestId: 'exact-request', text: 'exact original text', replyTo: ref }
    const raw = JSON.stringify(first, null, 0) + ' '
    phone.socket.write(raw + '\n'); await phone.waitFor(3)
    const challenge = phone.replies.find(row => row.type === 'challenge')
    assert.ok(challenge, 'the new role must receive its own challenge')
    const digest = require('node:crypto').createHash('sha256').update(Buffer.from(raw)).digest('hex')
    assert.equal(challenge.firstFrameSHA256, digest)
    assert.equal(challenge.requestId, first.requestId)
    const transcript = `odk-personal-agent-control-v2\n2\n${challenge.nonce}\n${digest}`
    const proof = createHmac('sha256', fixture.control.credential).update(transcript).digest('hex')
    phone.send({ v: 2, type: 'personal-agent-submit', requestId: first.requestId, proof })
    await phone.waitFor(4)
    assert.deepEqual(source.sent, [[first.text, ref]])
    await phone.close()
  }, { personalAgent: source })
})

test('personal role refuses modified first bytes, second bodies, wrong ids and expired proofs', async t => {
  for (const variant of ['first-bytes', 'second-text', 'second-reference', 'request-id', 'expired', 'legacy-role', 'bad-reference']) await t.test(variant, async () => {
    const source = fakeSource(); let clock = 1000
    await withService(async (_, port) => {
      const phone = await openPhone(port)
      const first = { ...fixture.control.hello }
      if (variant === 'legacy-role') first.v = 1
      if (variant === 'bad-reference') first.replyTo = { messageId: 'not-an-id' }
      const intended = JSON.stringify(first)
      const sent = variant === 'first-bytes' ? JSON.stringify({ ...first, text: 'changed by an intermediary' }) : intended
      phone.socket.write(sent + '\n'); await phone.waitFor(3)
      const challenge = phone.replies[2]
      if (variant === 'legacy-role' || variant === 'bad-reference') {
        assert.equal(challenge.type, 'error'); assert.equal(source.sent.length, 0); phone.socket.destroy(); return
      }
      assert.equal(challenge.type, 'challenge')
      const digest = require('node:crypto').createHash('sha256').update(intended).digest('hex')
      const proof = proofFor({ nonce: challenge.nonce, firstFrameSHA256: digest })
      const submit = { v: 2, type: 'personal-agent-submit', requestId: first.requestId, proof }
      if (variant === 'second-text') submit.text = 'changed'
      if (variant === 'second-reference') submit.replyTo = { messageId: 'a'.repeat(64) }
      if (variant === 'request-id') submit.requestId = 'changed-id'
      if (variant === 'expired') clock += 10001
      phone.send(submit); await phone.waitFor(4)
      assert.equal(phone.replies[3].type, 'error')
      assert.equal(source.sent.length, 0)
      // A failed proof consumes its challenge as well.
      phone.send({ v: 2, type: 'personal-agent-submit', requestId: first.requestId, proof })
      await phone.waitFor(5); assert.equal(phone.replies[4].reason, 'control challenge required')
      await phone.close()
    }, { personalAgent: source, now: () => clock })
  })
})

test('personal control bounds raw bytes and refuses malformed UTF8 before parsing', async t => {
  for (const variant of ['oversized', 'invalid-utf8']) await t.test(variant, async () => {
    const source = fakeSource()
    await withService(async (_, port) => {
      const phone = await openPhone(port)
      const closed = new Promise(resolve => phone.socket.once('close', resolve))
      phone.socket.write(variant === 'oversized' ? Buffer.alloc(128 * 1024 + 1, 32) : Buffer.from([0xc3, 10]))
      await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(Error('did not reject invalid input')), 2000))])
      assert.equal(source.sent.length, 0)
    }, { personalAgent: source })
  })
})
