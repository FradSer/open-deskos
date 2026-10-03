const test = require('node:test')
const assert = require('node:assert/strict')

const { resolveTailscaleHost, detectTailscale, parseTailscaleStatus, provisionDecision, readTailscaleStatus } = require('../src/platform/tailscale')

const WINDOWS = 'C:\\Program Files\\Tailscale\\tailscale.exe'
const LINUX = '/usr/bin/tailscale'

test('each host is asked for Tailscale where its platform keeps it', () => {
  assert.deepEqual(resolveTailscaleHost({ platform: 'win32' }), {
    platform: 'win32', supported: true, command: WINDOWS, service: 'Tailscale', candidates: [WINDOWS],
  })
  assert.deepEqual(resolveTailscaleHost({ platform: 'linux' }), {
    platform: 'linux', supported: true, command: LINUX, service: 'tailscaled', candidates: [LINUX, '/usr/local/bin/tailscale'],
  })
  assert.equal(resolveTailscaleHost({ platform: 'darwin' }).command, '/usr/local/bin/tailscale')
})

// A host may keep the command somewhere the platform does not name canonically:
// the macOS application bundle is the real example, measured on a machine whose
// PATH has no `tailscale` at all.
test('a host that keeps its command somewhere else is still found', () => {
  const host = resolveTailscaleHost({ platform: 'darwin' })
  const appBundle = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

  assert.equal(host.command, '/usr/local/bin/tailscale', 'the canonical location is named first')
  assert.ok(host.candidates.includes(appBundle), 'the application bundle is a location too')

  assert.deepEqual(detectTailscale({ host, exists: (candidate) => candidate === appBundle }), {
    installed: true, source: 'host', command: appBundle,
  })

  const absent = detectTailscale({ host, exists: () => false })
  assert.equal(absent.installed, false)
  assert.equal(absent.command, '/usr/local/bin/tailscale', 'an absent host still names where one would be installed')
})

test('an unsupported host says so instead of guessing a path', () => {
  const host = resolveTailscaleHost({ platform: 'sunos' })

  assert.equal(host.supported, false)
  assert.equal(host.command, null)
  assert.equal(host.service, null)
  assert.deepEqual(host.candidates, [])
  assert.deepEqual(detectTailscale({ host, exists: () => true }), { installed: false, source: 'unsupported', command: null })
})

// The rule the whole feature exists for: a host that already has Tailscale keeps
// it — its installation, its login, and its configuration.
test('a host that already has Tailscale is reused, not replaced', () => {
  const detection = detectTailscale({ host: resolveTailscaleHost({ platform: 'win32' }), exists: (p) => p === WINDOWS })

  assert.deepEqual(detection, { installed: true, source: 'host', command: WINDOWS })
  assert.equal(provisionDecision(detection), 'reuse')
})

test('a host without Tailscale is provisioned once', () => {
  const detection = detectTailscale({ host: resolveTailscaleHost({ platform: 'linux' }), exists: () => false })

  assert.deepEqual(detection, { installed: false, source: 'absent', command: LINUX })
  assert.equal(provisionDecision(detection), 'install')
})

test('an unsupported host is not provisioned by guessing', () => {
  const detection = detectTailscale({ host: resolveTailscaleHost({ platform: 'sunos' }), exists: () => false })

  assert.equal(provisionDecision(detection), 'unsupported')
})

test('reading the status reports a reason instead of a state when the CLI cannot answer', () => {
  const ok = readTailscaleStatus({ command: WINDOWS, execFile: () => JSON.stringify({ BackendState: 'Running', Self: { HostName: 'desk', TailscaleIPs: ['100.64.0.1'], Online: true } }) })
  assert.equal(ok.ok, true)
  assert.equal(ok.status.state, 'connected')
  assert.equal(ok.status.self.ipv4, '100.64.0.1')

  assert.deepEqual(readTailscaleStatus({ command: null }), { ok: false, reason: 'tailscale-not-found' })

  const unreachable = readTailscaleStatus({ command: WINDOWS, execFile: () => { throw new Error('failed to connect to local tailscaled') } })
  assert.equal(unreachable.ok, false)
  assert.equal(unreachable.reason, 'tailscale-unreachable')
  assert.match(unreachable.detail, /tailscaled/)

  const unreadable = readTailscaleStatus({ command: WINDOWS, execFile: () => 'not json' })
  assert.deepEqual(unreadable, { ok: false, reason: 'tailscale-status-unreadable' })
})

test('the desk states the tailnet state the CLI reported', () => {
  const status = (backend) => parseTailscaleStatus(JSON.stringify({ BackendState: backend, Self: { HostName: 'desktop', TailscaleIPs: ['100.64.0.1'], Online: true } }))

  assert.equal(status('Running').state, 'connected')
  assert.equal(status('NeedsLogin').state, 'needs-login')
  assert.equal(status('Stopped').state, 'stopped')
  assert.equal(status('Starting').state, 'other')
})

test('the self reading keeps only what the payload carried', () => {
  const full = parseTailscaleStatus(JSON.stringify({
    BackendState: 'Running',
    Self: { HostName: 'desk', DNSName: 'desk.tailnet.ts.net.', TailscaleIPs: ['100.64.0.1', 'fd7a::1'], Online: true },
    Peer: { a: { Online: true }, b: { Online: false }, c: {} },
  }))

  assert.equal(full.state, 'connected')
  assert.equal(full.self.hostname, 'desk')
  assert.equal(full.self.ipv4, '100.64.0.1')
  assert.equal(full.self.online, true)
  assert.equal(full.peers, 3)
  assert.equal(full.peersOnline, 1)

  const sparse = parseTailscaleStatus(JSON.stringify({ BackendState: 'NeedsLogin' }))
  assert.equal(sparse.state, 'needs-login')
  assert.equal(sparse.self, null, 'no Self in the payload means no self reading')
  assert.equal(sparse.peers, null, 'no peer map means no peer count')
  assert.equal(sparse.peersOnline, null)
})

test('a status payload the desk cannot read is not a state', () => {
  assert.equal(parseTailscaleStatus('not json'), null)
  assert.equal(parseTailscaleStatus(''), null)
  assert.equal(parseTailscaleStatus('null'), null)
  assert.equal(parseTailscaleStatus(JSON.stringify({ TailscaleIPs: [] })), null, 'a payload with no backend state is not a state')
})