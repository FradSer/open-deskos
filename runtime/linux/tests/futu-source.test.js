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

// The declared socket is either a name under the shell's own runtime directory or the absolute path
// its binder already declared. Both have to land on the same socket, or the tile reports a service
// that is not the one poller.py bound.
test('an absolute declared socket is used as declared, a name resolves under the runtime dir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-'))
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-futu-sock-'))
  const absolute = path.join(elsewhere, 'futu-poller.sock')
  const source = createFutuSource({
    runtimeDir: dir,
    services: () => ({ 'futu-poller': { revision: 'r1', socket: absolute } }),
  })
  await source.start()
  try {
    assert.equal(source.snapshot('futu-poller').state, 'syncing')
    await sendRecords(absolute, [
      { v: 1, type: 'hello', service: 'futu-poller', revision: 'r1', proto: 1 },
      { v: 1, type: 'data', service: 'futu-poller', snapshot: { positions: [], totals: {} }, updatedAt: Date.now() },
    ])
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(source.snapshot('futu-poller').state, 'live')
    assert.equal(fs.existsSync(path.join(dir, 'futu-poller.sock')), false, 'an absolute path must not also be joined under the runtime dir')
  } finally {
    await source.stop()
  }
})

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
