const test = require('node:test')
const assert = require('node:assert/strict')

const { createPersonalAgentClient, resolvePersonalAgentSocketPath } = require('../src/personal-agent-client')
const { createRemoteBridgeClient, resolveRemoteBridgeSocketPath } = require('../src/remote-bridge-client')
const { createOdkLinkClient, resolveOdkLinkSocketPath } = require('../src/odk-link-client')
const { resolveShellHost } = require('../src/platform')

// A Windows Shell Host has no runtime directory. A link that is not ported to it
// states that instead of presenting a local or simulated link, so its surface must
// answer with its unavailable reading rather than a healthy one. The voice and Desk
// Link links are ported: they bind the endpoint the host's own naming gives them.
const WINDOWS_ENV = {}
const WINDOWS_HOST = process.platform === 'win32'

test('a link that is not ported to this host resolves no endpoint', () => {
  assert.equal(resolvePersonalAgentSocketPath(WINDOWS_ENV), WINDOWS_HOST ? '\\\\.\\pipe\\odk-personal-agent' : null)
  assert.equal(resolveOdkLinkSocketPath(WINDOWS_ENV), WINDOWS_HOST ? '\\\\.\\pipe\\odk-link' : null)
  assert.equal(resolveRemoteBridgeSocketPath(WINDOWS_ENV), null)

  // A Unix host needs a runtime directory for a ported link; a Windows host has no
  // such directory and binds the named pipe instead, which the channel token
  // authenticates because a pipe carries no owner.
  for (const [name, pipe] of [['personal-agent', 'odk-personal-agent'], ['odk-link', 'odk-link']]) {
    assert.equal(
      resolveShellHost({ platform: 'win32', arch: 'x64', env: WINDOWS_ENV, homedir: 'C:\\Users\\desk' }).endpoint(name),
      `\\\\.\\pipe\\${pipe}`,
    )
  }

  // The seam still names the endpoint a link that is not ported would bind, so the
  // transport is decided even where nothing is wired to it yet. That fact is the
  // difference between 'not ported' and 'no idea where it would go'.
  const host = resolveShellHost({ platform: 'win32', arch: 'x64', env: WINDOWS_ENV, homedir: 'C:\\Users\\desk' })
  assert.equal(host.runtimeDir, null)
  assert.equal(host.endpoint('remote-bridge'), '\\\\.\\pipe\\odk-remote-bridge')
})

test('the voice surface reads unavailable without a local endpoint', t => {
  const client = createPersonalAgentClient({ socketPath: null })
  t.after(() => client.stop())

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

test('Open DeskOS Link reports no machine when nothing is listening at its endpoint', async () => {
  // An endpoint nothing bound. The resolved endpoint cannot be used here: on a
  // host where the Open DeskOS Link service runs, it is a live link, and a test that
  // depends on that would pass or fail according to the machine it runs on.
  const client = createOdkLinkClient({ socketPath: '\\\\.\\pipe\\odk-link-absent' })

  assert.deepEqual(await client.machines(), [])
})
