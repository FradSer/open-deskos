const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { createFutuSource } = require('../src/futu-source')

function sendRecords(sockPath, records) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sockPath, () => {
      for (const record of records) socket.write(`${JSON.stringify(record)}\n`)
      setTimeout(() => { socket.end(); resolve() }, 200)
    })
    socket.on('error', reject)
  })
}

test('a declared service data record becomes a live snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', socket: 'futu-poller.sock' } }),
  })
  await source.start()
  try {
    assert.equal(source.snapshot('futu-poller').state, 'syncing')
    await sendRecords(path.join(dir, 'futu-poller.sock'), [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 },
      { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [], totals: {} }, updatedAt: Date.now() },
    ])
    await new Promise((resolve) => setTimeout(resolve, 200))
    const reading = source.snapshot('futu-poller')
    assert.equal(reading.state, 'live')
    assert.deepEqual(reading.snapshot.positions, [])
  } finally {
    await source.stop()
  }
})

test('an undeclared service reads unconfigured and auth-required surfaces needs-auth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', socket: 'futu-poller.sock' } }),
  })
  await source.start()
  try {
    assert.equal(source.snapshot('unknown').state, 'unconfigured')
    await sendRecords(path.join(dir, 'futu-poller.sock'), [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 },
      { v: 1, type: 'auth-required', service: 'futu-poller', secrets: ['futu-trade-password'] },
    ])
    await new Promise((resolve) => setTimeout(resolve, 200))
    const reading = source.snapshot('futu-poller')
    assert.equal(reading.state, 'needs-auth')
    assert.deepEqual(reading.secrets, ['futu-trade-password'])
  } finally {
    await source.stop()
  }
})
