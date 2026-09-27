const test = require('node:test')
const assert = require('node:assert/strict')

const { createVoiceAgentClient, resolveVoiceSocketPath } = require('../src/voice-agent-client')
const { createRemoteBridgeClient, resolveRemoteBridgeSocketPath } = require('../src/remote-bridge-client')
const { createDeskLinkClient, resolveDeskLinkSocketPath } = require('../src/desk-link-client')
const { resolveShellHost } = require('../src/platform')

// A Windows Shell Host has no runtime directory. The links that are not ported
// to it state that instead of presenting a local or simulated link, so each
// surface must answer with its unavailable reading rather than a healthy one.
const WINDOWS_ENV = {}
const WINDOWS_HOST = process.platform === 'win32'

test('a link that is not ported to this host resolves no endpoint', () => {
  for (const resolve of [resolveVoiceSocketPath, resolveRemoteBridgeSocketPath]) {
    assert.equal(resolve(WINDOWS_ENV), null)
  }

  // The Desk Link is ported. A Unix host needs a runtime directory for it; a
  // Windows host has no such directory and binds the named pipe instead, which
  // the channel token authenticates because a pipe carries no owner.
  assert.equal(
    resolveDeskLinkSocketPath(WINDOWS_ENV),
    WINDOWS_HOST ? '\\\\.\\pipe\\open-deskos-desk-link' : null,
  )

  // The seam still names the endpoints a ported link would bind, so the
  // transport is decided even where nothing is wired to it yet. These two facts
  // are the difference between 'not ported' and 'no idea where it would go'.
  const host = resolveShellHost({ platform: 'win32', arch: 'x64', env: WINDOWS_ENV, homedir: 'C:\\Users\\desk' })
  assert.equal(host.runtimeDir, null)
  assert.equal(host.endpoint('voice-agent'), '\\\\.\\pipe\\open-deskos-voice-agent')
  assert.equal(host.endpoint('remote-bridge'), '\\\\.\\pipe\\open-deskos-remote-bridge')
  assert.equal(host.endpoint('desk-link'), '\\\\.\\pipe\\open-deskos-desk-link')
})

test('the voice surface reads unavailable without a local endpoint', () => {
  const client = createVoiceAgentClient({ socketPath: resolveVoiceSocketPath(WINDOWS_ENV) })

  assert.equal(client.snapshot().state, 'unavailable')
  assert.equal(client.toggle(), false, 'a toggle cannot be accepted without a service')
  client.start()
  assert.equal(client.snapshot().state, 'unavailable', 'starting without an endpoint changes nothing')
})

test('the Remote Link surface reads disconnected without a local endpoint', () => {
  const client = createRemoteBridgeClient({ socketPath: resolveRemoteBridgeSocketPath(WINDOWS_ENV) })

  assert.equal(client.getLinkState(), 'disconnected')
  client.start()
  assert.equal(client.getLinkState(), 'disconnected', 'starting without an endpoint invents no link')
})

test('Desk Link reports no machine when nothing is listening at its endpoint', async () => {
  // On a Windows host the endpoint is the pipe, and no service is listening on
  // it here, so the client must report nothing rather than a healthy link.
  const client = createDeskLinkClient({ socketPath: resolveDeskLinkSocketPath(WINDOWS_ENV) ?? '\\\\.\\pipe\\open-deskos-desk-link-absent' })

  assert.deepEqual(await client.machines(), [])
})