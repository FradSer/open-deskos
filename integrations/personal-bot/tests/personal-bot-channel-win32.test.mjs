import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { mkdtemp, rm, stat, mkdir, chmod, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as net from 'node:net'
import {
  CHANNEL_VERSION,
  MAX_HANDSHAKE_BYTES,
  TOKEN_BYTES,
  TOKEN_FILENAME,
  channelHandshake,
  channelTokenFile,
  readOrCreateChannelToken,
  personalBotEndpoint,
  listen,
} from '../src/socket.mjs'

const require = createRequire(import.meta.url)
const PIPE = '\\\\.\\pipe\\open-deskos-personal-bot'
const WINDOWS_ENV = { LOCALAPPDATA: 'C:\\Users\\fradser\\AppData\\Local' }

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-win32-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * A wait that fails with a stated reason instead of hanging. A peer that is
 * refused delivers no status, so a test that waits for one has to be able to
 * say what it was still waiting for.
 */
function within(promise, message, ms = 3000) {
  let timer
  const expiry = new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`timed out waiting for ${message}`)), ms) })
  timer.unref()
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer))
}

/**
 * A named pipe only exists on a Windows host, so the transport is stood in for
 * by a socket in the temporary directory. The endpoint name, the handshake gate
 * and the voice protocol itself all still run for real; what is replaced is the
 * transport, not the contract.
 */
function standInPipeNet(dir) {
  const stand = endpoint => join(dir, `stand-in-${String(endpoint).replace(/^\\\\\.\\pipe\\/i, '')}`)
  return {
    path: stand,
    bound: [],
    createServer(handler) {
      const server = net.createServer(handler)
      const bind = server.listen.bind(server)
      server.listen = (endpoint, callback) => {
        this.bound.push(endpoint)
        return bind(stand(endpoint), callback)
      }
      return server
    },
    connect: endpoint => net.connect(stand(endpoint)),
  }
}

/** The service, reduced to what the channel touches: a status, a toggle, a broadcast. */
function fakeService() {
  const calls = []
  let broadcast = () => {}
  const service = {
    calls,
    status: { v: 1, type: 'status', state: 'idle', message: '' },
    publish(status) { broadcast(status) },
    subscribe(listener) { broadcast = listener; return () => { broadcast = () => {} } },
    async toggle() { calls.push('toggle'); service.status = { v: 1, type: 'status', state: 'recording', message: '' } },
    setState(state, message) { calls.push(`setState:${state}:${message}`) },
  }
  return service
}

/** A connected client and the status records the service has published to it. */
function openPipe(pipeNet, endpoint = PIPE) {
  const client = net.connect(pipeNet.path(endpoint))
  client.setEncoding('utf8')
  const records = []
  let received = ''
  client.on('data', chunk => {
    received += chunk
    for (const line of chunk.split('\n')) {
      if (!line.trim()) continue
      try { records.push(JSON.parse(line)) } catch { records.push(line) }
    }
  })
  return { client, records, received: () => received }
}

/** What one refused peer received, and whether it was destroyed rather than left open. */
function attempt(pipeNet, first, endpoint = PIPE) {
  const { client, received } = openPipe(pipeNet, endpoint)
  return new Promise(resolve => {
    const done = value => { client.destroy(); resolve({ ...value, received: received() }) }
    client.setTimeout(1000, () => done({ closed: false, timedOut: true }))
    client.once('error', () => done({ closed: true, errored: true }))
    client.once('close', () => done({ closed: true }))
    client.once('connect', () => client.write(first))
  })
}

test('personalBotEndpoint names the endpoint the Shell Host names for the voice link', () => {
  assert.equal(personalBotEndpoint(WINDOWS_ENV, 'win32'), PIPE)
  assert.equal(personalBotEndpoint({}, 'win32'), PIPE, 'the pipe name does not depend on a directory the host may not have')
  assert.equal(personalBotEndpoint({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux'), '/run/user/1000/open-deskos-personal-bot/agent.sock')
  assert.equal(personalBotEndpoint({ XDG_RUNTIME_DIR: 'run/user/1000' }, 'linux'), null, 'a relative runtime directory is not a channel location')
  assert.equal(personalBotEndpoint({}, 'linux'), null, 'a Unix host without a runtime directory is left to refuse to start')
})

test('channelTokenFile is the file every other Windows runtime channel uses', () => {
  assert.equal(channelTokenFile(WINDOWS_ENV, 'win32'), 'C:\\Users\\fradser\\AppData\\Local\\open-deskos\\local-channel.token')
  assert.equal(channelTokenFile({ XDG_STATE_HOME: '/home/desk/.local/state' }, 'linux'), '/home/desk/.local/state/open-deskos/local-channel.token')
  assert.equal(TOKEN_FILENAME, 'local-channel.token')
})

test('the endpoint and the token file are the ones the Shell Host itself resolves', t => {
  const platformModule = new URL('../../../runtime/linux/src/platform/index.js', import.meta.url)
  if (!existsSync(platformModule)) return t.skip('the Shell Host resolves endpoints outside this package')
  const { resolveShellHost } = require(platformModule.pathname)
  const windows = resolveShellHost({ platform: 'win32', arch: 'x64', env: WINDOWS_ENV, homedir: 'C:\\Users\\fradser' })
  const unixEnv = { XDG_RUNTIME_DIR: '/run/user/1000', XDG_STATE_HOME: '/home/desk/.local/state' }
  const unix = resolveShellHost({ platform: 'linux', arch: 'arm64', env: unixEnv, homedir: '/home/desk' })
  assert.equal(personalBotEndpoint(WINDOWS_ENV, 'win32'), windows.endpoint('personal-bot'), 'the Shell client connects to the endpoint this service binds')
  assert.equal(channelTokenFile(WINDOWS_ENV, 'win32'), windows.localChannelTokenFile, 'both ends read one token file')
  assert.equal(personalBotEndpoint(unixEnv, 'linux'), unix.endpoint('personal-bot'))
  assert.equal(channelTokenFile(unixEnv, 'linux'), unix.localChannelTokenFile)
})

test('a Windows listener accepts a peer presenting the shared channel token', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const token = 'channel-token-for-this-host'
  const server = await listen(PIPE, service, { platform: 'win32', token, net: pipeNet })
  t.after(() => server.close())

  assert.deepEqual(pipeNet.bound, [PIPE], 'the pipe name is bound unchanged; only the transport is stood in for')
  assert.equal(server.tokenRequired, true)
  const { client, records } = openPipe(pipeNet)
  t.after(() => client.destroy())
  // Handshake and first command in one write is the case a careless reader gets wrong.
  client.write(`${channelHandshake(token)}{"v":1,"type":"toggle"}\n`)
  await within(once(client, 'data'), 'the status answering a toggle sent with its handshake')
  assert.deepEqual(service.calls, ['toggle'], 'the protocol saw its own first frame, not the handshake')
  assert.equal(records[0].state, 'recording')
})

test('a Windows handshake admits a coalesced proposal command larger than its own limit', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const commands = []
  service.proposalCommand = async command => { commands.push(command) }
  const token = 'channel-token-for-this-host'
  const server = await listen(PIPE, service, { platform: 'win32', token, net: pipeNet })
  const { client } = openPipe(pipeNet)
  t.after(async () => { client.destroy(); await server.close() })
  const command = { v: 1, type: 'proposal_respond', id: '12345678-1234-1234-1234-123456789abc', decision: 'accept', confirmation: 'x'.repeat(1024) }
  client.write(`${channelHandshake(token)}${JSON.stringify(command)}\n`)
  await within(once(client, 'data'), 'the response to a coalesced proposal command')
  assert.deepEqual(commands, [command])
  const oversized = { v: 1, type: 'status', padding: 'x'.repeat(4096) }
  const refused = await attempt(pipeNet, `${channelHandshake(token)}${JSON.stringify(oversized)}\n`)
  assert.equal(refused.closed, true, 'a coalesced command still has its own 4096-byte bound')
  assert.equal(refused.received, '', 'an oversized command receives no response')
})

test('shutdown closes peers that have not sent a handshake or command', async t => {
  for (const platform of ['linux', 'win32']) {
    await t.test(platform, async t => {
      const dir = await temp(t)
      const pipeNet = standInPipeNet(dir)
      const endpoint = platform === 'win32' ? PIPE : join(dir, 'agent.sock')
      const server = await listen(endpoint, fakeService(), { platform, token: 'host-token', ...(platform === 'win32' ? { net: pipeNet } : {}) })
      const client = net.connect(platform === 'win32' ? pipeNet.path(endpoint) : endpoint)
      client.on('error', () => {})
      await once(client, 'connect')
      const closed = once(client, 'close')
      const closing = server.close()
      try {
        await within(closing, 'shutdown with an idle peer')
        await within(closed, 'idle peer disconnection')
      } finally {
        client.destroy()
        await closing
      }
    })
  }
})

test('a Windows listener refuses a peer that presents the wrong token', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const server = await listen(PIPE, service, { platform: 'win32', token: 'channel-token-for-this-host', net: pipeNet })
  t.after(() => server.close())

  const result = await attempt(pipeNet, `${channelHandshake('not-the-token')}{"v":1,"type":"toggle"}\n`)

  assert.equal(result.closed, true, 'the connection is destroyed')
  assert.equal(result.received, '', 'no status is ever published to an unauthenticated peer')
  assert.deepEqual(service.calls, [], 'a wrong token is a refusal, not a fallback to anything else')
})

test('a Windows listener refuses a first line that is not the published handshake', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const server = await listen(PIPE, service, { platform: 'win32', token: 'channel-token-for-this-host', net: pipeNet })
  t.after(() => server.close())

  const malformed = [
    'this is not JSON\n',                        // nothing the handshake could be
    '{"v":1,"type":"toggle"}\n',                 // the voice protocol is not a handshake
    '{"v":2,"token":"channel-token-for-this-host"}\n', // a version this host does not speak
    '{"v":1,"token":12345678}\n',                // a token that is not a string
    '{"v":1}\n',                                // a handshake with no token
  ]
  for (const first of malformed) {
    const result = await attempt(pipeNet, `${first}{"v":1,"type":"toggle"}\n`)
    assert.equal(result.closed, true, `a connection opening with ${JSON.stringify(first)} is destroyed`)
    assert.equal(result.received, '')
  }
  assert.deepEqual(service.calls, [], 'no command from an unauthenticated peer is processed')

  // The listener survives every refusal: a peer with the token still works.
  const { client, records } = openPipe(pipeNet)
  t.after(() => client.destroy())
  client.write(channelHandshake('channel-token-for-this-host'))
  client.write('{"v":1,"type":"status"}\n')
  await within(once(client, 'data'), 'a status after the listener survived its refusals')
  assert.equal(records[0].state, 'idle')
})

test('a Windows listener refuses a token of the wrong length before the protocol runs', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const token = 'channel-token-for-this-host'
  const server = await listen(PIPE, service, { platform: 'win32', token, net: pipeNet })
  t.after(() => server.close())

  for (const presented of [token.slice(0, -1), `${token}x`, '']) {
    const result = await attempt(pipeNet, `${channelHandshake(presented)}{"v":1,"type":"toggle"}\n`)
    assert.equal(result.closed, true, `a token of ${presented.length} bytes is refused`)
    assert.equal(result.received, '')
  }
  assert.deepEqual(service.calls, [])
})

test('a Windows listener drops a peer whose handshake exceeds 512 bytes', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const server = await listen(PIPE, service, { platform: 'win32', token: 'channel-token-for-this-host', net: pipeNet })
  t.after(() => server.close())

  const oversized = JSON.stringify({ v: CHANNEL_VERSION, token: 'x'.repeat(MAX_HANDSHAKE_BYTES) })
  assert.ok(Buffer.byteLength(oversized) > MAX_HANDSHAKE_BYTES)
  const result = await attempt(pipeNet, `${oversized}\n{"v":1,"type":"toggle"}\n`)

  assert.equal(result.closed, true)
  assert.deepEqual(service.calls, [], 'a handshake that never ends is dropped before it is parsed')
})

test('a Windows listener publishes nothing to a peer that has not proven the token', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const server = await listen(PIPE, service, { platform: 'win32', token: 'channel-token-for-this-host', net: pipeNet })
  t.after(() => server.close())

  const { client, received } = openPipe(pipeNet)
  t.after(() => client.destroy())
  await within(once(client, 'connect'), 'the pipe connection')
  service.publish({ v: 1, type: 'status', state: 'recording', message: 'not for you' })
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(received(), '', 'a status is a push, and an unproven peer is not on the list')

  client.write('x'.repeat(MAX_HANDSHAKE_BYTES + 1))
  await within(once(client, 'close'), 'the oversized handshake to be dropped')
  assert.deepEqual(service.calls, [], 'the peer is dropped once its handshake can no longer fit')
})

test('a Windows listener provisions the shared token file when the caller names no token', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  const service = fakeService()
  const requested = []
  // The token file is a Windows path, so the filesystem is the seam that lets
  // this host create it; the path itself is asserted through the calls made.
  const mapped = file => join(dir, String(file).split(/[\\/]/).pop())
  const fsModule = {
    readFile: (file, ...rest) => fs.readFile(mapped(file), ...rest),
    writeFile: (file, ...rest) => { requested.push({ call: 'writeFile', file, options: rest[1] }); return fs.writeFile(mapped(file), ...rest) },
    mkdir: (file, ...rest) => { requested.push({ call: 'mkdir', file }); return fs.mkdir(mapped(file), ...rest) },
    chmod: (file, ...rest) => fs.chmod(mapped(file), ...rest),
  }
  const server = await listen(PIPE, service, { platform: 'win32', env: WINDOWS_ENV, net: pipeNet, fsModule })
  t.after(() => server.close())

  const created = await fs.readFile(mapped(channelTokenFile(WINDOWS_ENV, 'win32')), 'utf8')
  const token = created.trim()
  assert.equal(Buffer.from(token, 'base64url').length, TOKEN_BYTES)
  assert.ok(requested.some(entry => entry.call === 'writeFile'
    && entry.file === 'C:\\Users\\fradser\\AppData\\Local\\open-deskos\\local-channel.token'
    && entry.options.mode === 0o600 && entry.options.flag === 'wx'), 'the token is created exclusively and owner-readable')

  const { client, records } = openPipe(pipeNet)
  t.after(() => client.destroy())
  client.write(`${channelHandshake(token)}{"v":1,"type":"status"}\n`)
  await within(once(client, 'data'), 'a status on the token the listener provisioned')
  assert.equal(records[0].state, 'idle', 'the token the file holds is the token the listener compares against')
})

test('a listener with no token to check refuses to bind a named pipe', async t => {
  const dir = await temp(t)
  const pipeNet = standInPipeNet(dir)
  // A pipe has no owner on any host, so a listener given neither a token nor a
  // file to read one from must refuse rather than bind an open channel.
  await assert.rejects(
    listen(PIPE, fakeService(), { platform: 'linux', net: pipeNet }),
    /token/,
  )
  assert.deepEqual(pipeNet.bound, [], 'nothing was bound')
})

test('two services starting on a cold host adopt one token', async t => {
  const file = join(await temp(t), TOKEN_FILENAME)
  // The race the `wx` flag exists for: this service read nothing, and another
  // one created the file before its own exclusive create could.
  const winner = 'token-the-first-service-wrote'
  const racer = { written: null, reads: 0, candidates: [] }
  const racerFs = {
    async readFile() {
      racer.reads += 1
      if (racer.written === null) throw Object.assign(Error('missing'), { code: 'ENOENT' })
      return racer.written
    },
    async mkdir() {},
    async writeFile(_file, data, options = {}) {
      if (options.flag === 'wx') {
        racer.candidates.push(data)
        racer.written = `${winner}\n`
        throw Object.assign(Error('exists'), { code: 'EEXIST' })
      }
      racer.written = data
    },
    async chmod() {},
  }
  const loser = await readOrCreateChannelToken({ file, fsModule: racerFs })

  assert.equal(racer.reads, 2, 'the loser reads again to learn which token won')
  assert.equal(loser, winner, 'the loser adopts the winner rather than leaving the host with two')
  assert.equal(racer.written, `${winner}\n`, 'the file is what both processes agree on')
  assert.equal(racer.candidates.length, 1)
  assert.equal(Buffer.from(racer.candidates[0].trim(), 'base64url').length, TOKEN_BYTES, 'the candidate it dropped was a real token')
  assert.notEqual(racer.candidates[0].trim(), winner)
})

test('two services reading one cold host file together end up with the same token', async t => {
  const file = join(await temp(t), 'state', 'open-deskos', TOKEN_FILENAME)
  const [first, second] = await Promise.all([readOrCreateChannelToken({ file }), readOrCreateChannelToken({ file })])

  assert.equal(first, second)
  assert.equal((await fs.readFile(file, 'utf8')).trim(), first)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test('the token file is created on first use and then left alone', async t => {
  const dir = await temp(t)
  const file = join(dir, 'state', 'open-deskos', TOKEN_FILENAME)
  const first = await readOrCreateChannelToken({ file })
  const second = await readOrCreateChannelToken({ file })

  assert.equal(Buffer.from(first, 'base64url').length, TOKEN_BYTES)
  assert.equal(first, second, 'the file is what makes two processes agree')
  assert.equal(await fs.readFile(file, 'utf8'), `${first}\n`)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(join(dir, 'state', 'open-deskos'))).mode & 0o777, 0o700)

  const other = await readOrCreateChannelToken({ file: join(await temp(t), 'other', TOKEN_FILENAME) })
  assert.notEqual(other, first, 'each host secret is its own random value')
})

test('a Unix host authenticates by ownership, so no handshake is required', async t => {
  const dir = await temp(t)
  const service = fakeService()
  const server = await listen(join(dir, 'open-deskos-personal-bot', 'agent.sock'), service, { platform: 'linux' })
  t.after(() => server.close())

  assert.equal(server.tokenRequired, false)
  const client = net.connect(join(dir, 'open-deskos-personal-bot', 'agent.sock'))
  t.after(() => client.destroy())
  client.setEncoding('utf8')
  const records = []
  client.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  client.write('{"v":1,"type":"toggle"}\n')
  await within(once(client, 'data'), 'a status for a client that sent no handshake')

  assert.deepEqual(service.calls, ['toggle'], 'a client written before the token existed still reaches the protocol')
  assert.equal(records[0].state, 'recording')
})

test('a Unix host verifies a handshake it is given and refuses a wrong one', async t => {
  const dir = await temp(t)
  const endpoint = join(dir, 'open-deskos-personal-bot', 'agent.sock')
  const service = fakeService()
  const token = 'channel-token-for-this-host'
  const server = await listen(endpoint, service, { platform: 'linux', token })
  t.after(() => server.close())

  const accepted = net.connect(endpoint)
  t.after(() => accepted.destroy())
  accepted.setEncoding('utf8')
  const records = []
  accepted.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  accepted.write(`${channelHandshake(token)}{"v":1,"type":"status"}\n`)
  await within(once(accepted, 'data'), 'a status behind a valid handshake')
  assert.equal(records[0].state, 'idle', 'the second layer is consumed, not handed to the protocol')

  const refused = net.connect(endpoint)
  t.after(() => refused.destroy())
  refused.on('error', () => {})
  refused.once('connect', () => refused.write(`${channelHandshake('not-the-token')}{"v":1,"type":"toggle"}\n`))
  await within(once(refused, 'close'), 'the wrong handshake to be refused')
  assert.deepEqual(service.calls, [], 'a presented handshake that does not verify is a refusal, not a fallback to ownership')
})

test('a socket left behind by a stopped personal bot service is taken over', async t => {
  const dir = await temp(t)
  const endpoint = join(dir, 'open-deskos-personal-bot', 'agent.sock')
  const first = await listen(endpoint, fakeService(), { platform: 'linux' })
  await first.close() // close() leaves the socket file behind, exactly as a killed service would
  const service = fakeService()
  const second = await listen(endpoint, service, { platform: 'linux' })
  t.after(() => second.close())

  const client = net.connect(endpoint)
  t.after(() => client.destroy())
  client.setEncoding('utf8')
  const records = []
  client.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  client.write('{"v":1,"type":"status"}\n')
  await within(once(client, 'data'), 'a status on the socket a stopped service left behind')
  assert.equal(records[0].state, 'idle')
})

test('a live personal bot service is refused rather than having its socket stolen', async t => {
  const dir = await temp(t)
  const endpoint = join(dir, 'open-deskos-personal-bot', 'agent.sock')
  const live = await listen(endpoint, fakeService(), { platform: 'linux' })
  t.after(() => live.close())

  await assert.rejects(listen(endpoint, fakeService(), { platform: 'linux' }), /already running/)

  // The refused attempt must leave the live service answering.
  const client = net.connect(endpoint)
  t.after(() => client.destroy())
  client.setEncoding('utf8')
  const records = []
  client.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  client.write('{"v":1,"type":"status"}\n')
  await within(once(client, 'data'), 'a status from the live service that was not stolen from')
  assert.equal(records[0].state, 'idle')
})

test('a Unix control socket is 0600 inside a 0700 directory', async t => {
  const dir = await temp(t)
  const endpoint = join(dir, 'open-deskos-personal-bot', 'agent.sock')
  const server = await listen(endpoint, fakeService(), { platform: 'linux' })
  t.after(() => server.close())

  assert.equal((await stat(endpoint)).mode & 0o777, 0o600)
  assert.equal((await stat(join(dir, 'open-deskos-personal-bot'))).mode & 0o777, 0o700)
})

test('a control directory this user does not own is refused', async t => {
  const dir = await temp(t)
  const endpoint = join(dir, 'open-deskos-personal-bot', 'agent.sock')
  const foreign = join(dir, 'open-deskos-personal-bot')
  await mkdir(foreign, { recursive: true, mode: 0o700 })
  await chmod(foreign, 0o700)
  await writeFile(join(dir, 'unrelated'), 'kept\n')
  const fsModule = {
    ...fs,
    async lstat(file) {
      if (file === foreign) return { isDirectory: () => true, isSocket: () => false, uid: process.getuid() + 1 }
      return fs.lstat(file)
    },
  }

  await assert.rejects(listen(endpoint, fakeService(), { platform: 'linux', fsModule }), /Unsafe control directory/)
  assert.equal(await fs.readFile(join(dir, 'unrelated'), 'utf8'), 'kept\n', 'the refusal deletes nothing')
})

test('a command line beyond 4096 bytes is dropped before anything is parsed', async t => {
  const dir = await temp(t)
  const service = fakeService()
  const server = await listen(join(dir, 'open-deskos-personal-bot', 'agent.sock'), service, { platform: 'linux' })
  t.after(() => server.close())

  const client = net.connect(join(dir, 'open-deskos-personal-bot', 'agent.sock'))
  t.after(() => client.destroy())
  client.on('error', () => {})
  client.once('connect', () => client.write(`{"v":1,"type":"${'x'.repeat(5000)}`))
  await within(once(client, 'close'), 'the oversized line to be dropped')

  assert.deepEqual(service.calls, [], 'an unterminated line past the input bound is never parsed')
})

test('a queued frame beyond 131072 bytes drops a client that is not reading', async t => {
  const dir = await temp(t)
  const service = fakeService()
  const server = await listen(join(dir, 'open-deskos-personal-bot', 'agent.sock'), service, { platform: 'linux' })
  t.after(() => server.close())

  const client = net.connect(join(dir, 'open-deskos-personal-bot', 'agent.sock'))
  t.after(() => client.destroy())
  client.setEncoding('utf8')
  const records = []
  client.on('data', chunk => records.push(...chunk.trim().split('\n').map(JSON.parse)))
  client.write('{"v":1,"type":"status"}\n')
  await within(once(client, 'data'), 'a status inside the queued frame budget')
  assert.equal(records[0].state, 'idle', 'a frame inside the budget is delivered')

  service.publish({ v: 1, type: 'status', state: 'idle', message: 'x'.repeat(131_073) })
  await within(once(client, 'close'), 'the client that stopped reading to be dropped')
})
