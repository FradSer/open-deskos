'use strict'
// The Voice Agent is a resident component on every supported Shell Host, so the
// Shell reaches it through the host's own endpoint naming: a Unix socket in the
// runtime directory on the reference host, and the `voice-agent` named pipe on a
// Windows host. A pipe carries no owner, so the channel token is what
// authenticates the connection there (ADR-0025) and it is consumed before the
// voice protocol reads a byte.
//
// The pipe binding itself is proven on the device; what runs everywhere here is
// the naming, and the protocol the client speaks once a transport is given.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')

const { createVoiceAgentClient, resolveVoiceSocketPath } = require('../src/voice-agent-client')
const { resolveShellHost } = require('../src/platform')
const { readOrCreateToken, requiresToken } = require('../src/local-channel')

const WINDOWS_PIPE = '\\\\.\\pipe\\open-deskos-voice-agent'

function hostFor(platform, env) {
  return resolveShellHost({
    platform,
    arch: platform === 'win32' ? 'x64' : 'arm64',
    env,
    homedir: platform === 'win32' ? 'C:\\Users\\desk' : '/home/kiosk',
  })
}

/**
 * A host whose persistent state is this test's temporary directory, so the token
 * the client reads is created and removed with the test.
 */
function isolatedHost(dir) {
  const stateDir = path.join(dir, 'open-deskos')
  return { ...hostFor('linux', {}), stateDir, localChannelTokenFile: path.join(stateDir, 'local-channel.token') }
}

async function stateDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-voice-win-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Every wait here is bounded. An unbounded wait turns a regression into a run
 * that never returns, because the test runner is started with no per-test
 * timeout: the failure has to arrive as an assertion, not as silence.
 */
function within(promise, label, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms)
      timer.unref()
    }),
  ])
}

function stateIs(client, expected, label) {
  return within(new Promise((resolve) => {
    // A new subscriber is handed the current status synchronously, so the
    // unsubscribe handle does not exist yet when that first call arrives.
    let unsubscribe = () => {}
    let settled = false
    unsubscribe = client.subscribe((status) => {
      if (settled || status.state !== expected) return
      settled = true
      resolve(status)
    })
    if (settled) unsubscribe()
  }), label)
}

/**
 * A stand-in for the voice service's own listener: the handshake is one line,
 * it is compared without leaking the token, and a connection that does not
 * present the right one is dropped before any command reaches the service.
 */
function voiceService(token, onCommand = () => {}) {
  const commands = []
  const handshakes = []
  const server = net.createServer((peer) => {
    let pending = ''
    let gated = token !== null
    peer.setEncoding('utf8')
    peer.on('error', () => {})
    peer.on('data', (chunk) => {
      pending += chunk
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        if (gated) {
          gated = false
          let presented
          try { presented = JSON.parse(line) } catch { return peer.destroy() }
          handshakes.push(presented)
          if (presented?.v !== 1 || presented.token !== token) return peer.destroy()
          continue
        }
        let command
        try { command = JSON.parse(line) } catch { return peer.destroy() }
        commands.push(command)
        onCommand(command, peer)
      }
    })
  })
  return { server, commands, handshakes }
}

test('the voice link keeps the host endpoint name on every host', () => {
  assert.equal(resolveVoiceSocketPath({}, hostFor('win32', {})), WINDOWS_PIPE)
  assert.equal(
    resolveVoiceSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }, hostFor('linux', { XDG_RUNTIME_DIR: '/run/user/1000' })),
    '/run/user/1000/open-deskos-voice/agent.sock',
  )
  // A Unix host still refuses to guess where a service would listen, so a host
  // without a runtime directory keeps reporting voice as unavailable.
  assert.equal(resolveVoiceSocketPath({}, hostFor('linux', {})), null)
  assert.equal(resolveVoiceSocketPath({ XDG_RUNTIME_DIR: 'relative' }, hostFor('linux', { XDG_RUNTIME_DIR: 'relative' })), null)
})

test('the Windows voice pipe is one the channel token must authenticate', () => {
  assert.equal(requiresToken({ endpoint: WINDOWS_PIPE, platform: 'win32' }), true)
  assert.equal(requiresToken({ endpoint: '/run/user/1000/open-deskos-voice/agent.sock', platform: 'linux' }), false)
})

test('a Windows voice connection presents the channel token before the protocol', async (t) => {
  const dir = await stateDir(t)
  // The naming is proven by the seam above; what runs here is the protocol. The
  // host is therefore a real one on this machine — its token file is a path this
  // filesystem can hold — while the client is told it is on a Windows host,
  // which is what makes it present the token.
  const host = isolatedHost(dir)
  // The naming is proven by the seam above; what runs here is the protocol. The
  // host state is this test's directory, while the client is told it is on a
  // Windows host, which is what makes it present the token.
  const token = await readOrCreateToken({ stateDir: host.stateDir })
  const socketPath = path.join(dir, 'voice.sock')
  const { server, commands, handshakes } = voiceService(token, (_command, peer) => {
    peer.write(`${JSON.stringify({ v: 1, type: 'status', state: 'idle', message: '', transcript: '', level: 0 })}\n`)
  })
  t.after(() => server.close())
  server.listen(socketPath)
  await once(server, 'listening')

  const client = createVoiceAgentClient({ socketPath, platform: 'win32', host, reconnectDelayMs: 60_000 })
  t.after(() => client.stop())
  const settled = stateIs(client, 'idle', 'the service to report idle')
  client.start()
  await settled
  assert.deepEqual(handshakes, [{ v: 1, token }])
  assert.deepEqual(commands, [{ v: 1, type: 'status' }])
  // One host token file serves both ends, so neither side carries a second copy.
  assert.equal((await fs.readFile(host.localChannelTokenFile, 'utf8')).trim(), token)
})

test('a voice connection without the token never reaches the protocol', async (t) => {
  const dir = await stateDir(t)
  const host = isolatedHost(dir)
  const socketPath = path.join(dir, 'voice.sock')
  const { server, commands } = voiceService('a-different-token')
  t.after(() => server.close())
  server.listen(socketPath)
  await once(server, 'listening')

  const client = createVoiceAgentClient({ socketPath, platform: 'win32', host, reconnectDelayMs: 60_000 })
  t.after(() => client.stop())
  const dropped = stateIs(client, 'unavailable', 'the rejected connection to report unavailable')
  client.start()
  await dropped
  assert.deepEqual(commands, [], 'a rejected handshake must not deliver a voice command')
  assert.equal(client.toggle(), false)
})

test('a Unix voice socket still receives the protocol with no handshake', async (t) => {
  const dir = await stateDir(t)
  const socketPath = path.join(dir, 'agent.sock')
  const { server, commands, handshakes } = voiceService(null, (_command, peer) => {
    peer.write(`${JSON.stringify({ v: 1, type: 'status', state: 'recording', message: '', transcript: '', level: 0.5 })}\n`)
  })
  t.after(() => server.close())
  server.listen(socketPath)
  await once(server, 'listening')
  // Ownership already authenticated this peer, so a client written before the
  // token existed still reaches the protocol with every byte it sent intact.
  const client = createVoiceAgentClient({ socketPath, platform: 'linux' })
  t.after(() => client.stop())
  client.start()
  await stateIs(client, 'recording', 'the service to report recording')
  assert.deepEqual(handshakes, [])
  assert.deepEqual(commands, [{ v: 1, type: 'status' }])
  assert.equal(client.toggle(), true)
})
