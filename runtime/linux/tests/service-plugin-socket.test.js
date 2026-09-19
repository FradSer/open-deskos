const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { createServicePluginSocket } = require('../src/service-plugin-socket')

function endpoint() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-sock-')), 'svc.sock')
}

function clientSend(sockPath, records) {
  return new Promise((resolve, reject) => {
    const received = []
    const socket = net.connect(sockPath, () => {
      for (const record of records) socket.write(`${JSON.stringify(record)}\n`)
    })
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue
        try { received.push(JSON.parse(line)) } catch {}
      }
    })
    socket.on('error', reject)
    setTimeout(() => { socket.end(); resolve(received) }, 300)
  })
}

test('rejects unknown peers and data before hello', async () => {
  const sockPath = endpoint()
  const seen = []
  const server = createServicePluginSocket({
    socketPath: sockPath,
    services: { 'futu-poller': { revision: 'abc123' } },
    onSnapshot: (record) => seen.push(record),
  })
  await server.start()
  try {
    const stranger = await clientSend(sockPath, [
      { v: 1, type: 'hello', service: 'intruder', revision: 'x', proto: 1 },
    ])
    assert.ok(stranger.some((reply) => reply.type === 'ack' && reply.ok === false))
    const early = await clientSend(sockPath, [
      { v: 1, type: 'data', service: 'futu-poller', snapshot: {}, updatedAt: 1 },
    ])
    assert.ok(early.some((reply) => reply.type === 'ack' && reply.ok === false))
    assert.equal(seen.length, 0)
  } finally {
    await server.stop()
  }
})

test('reports disconnect when the service drops', async () => {
  const sockPath = endpoint()
  const statuses = []
  const server = createServicePluginSocket({
    socketPath: sockPath,
    services: { 'futu-poller': { revision: 'abc123' } },
    onStatus: (status) => statuses.push(status),
  })
  await server.start()
  try {
    await clientSend(sockPath, [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'abc123', proto: 1 },
    ])
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(statuses.some((status) => status.service === 'futu-poller' && status.state === 'disconnected'))
  } finally {
    await server.stop()
  }
})

test('accepts hello from a declared service and delivers its data snapshot', async () => {
  const sockPath = endpoint()
  const seen = []
  const server = createServicePluginSocket({
    socketPath: sockPath,
    services: { 'futu-poller': { revision: 'abc123' } },
    onSnapshot: (record) => seen.push(record),
  })
  await server.start()
  try {
    const replies = await clientSend(sockPath, [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'abc123', proto: 1 },
      { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [] }, updatedAt: 1 },
    ])
    assert.ok(replies.some((reply) => reply.type === 'ack' && reply.ok === true))
    assert.equal(seen.length, 1)
    assert.deepEqual(seen[0].snapshot, { positions: [] })
  } finally {
    await server.stop()
  }
})
