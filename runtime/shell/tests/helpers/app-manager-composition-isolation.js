'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

// Keep production algorithms and replace only their external inputs.
function isolateComposition(root) {
  const counts = {}
  const wrap = (moduleName, name, options) => {
    const module = require(moduleName)
    const original = module[name]
    module[name] = incoming => {
      counts[name] = (counts[name] || 0) + 1
      return original({ ...incoming, ...options })
    }
  }
  const unavailableFetch = async () => { throw Error('Controlled unavailable provider') }
  wrap('../../src/weather-source', 'createWeatherSource', { latitude: null, longitude: null, fetchImpl: unavailableFetch })
  wrap('../../src/weread-source', 'createWeReadSource', { apiKey: '', fetchImpl: unavailableFetch })
  wrap('../../src/camera-source', 'createCameraSource', { fsImpl: { existsSync: () => false },
    execFileImpl: () => { throw Error('Physical capture is forbidden in composition acceptance') } })
  wrap('../../src/hydra-espnow', 'createHydraEspNowSource', { profileFile: path.join(root, 'hydra-espnow.json') })
  wrap('../../src/pi-sessions-source', 'createPiSessionsSource', { env: {}, scanLocal: async () => ({ ok: true,
    scannedAt: Date.now(), sessions: [], workspaces: [], summary: { total: 0, running: 0, settled: 0, exited: 0, workspacesCount: 0 } }) })
  wrap('../../src/pi-session-events-source', 'createPiSessionEventsSource', { readLocal: () => ({ ok: false, reason: 'session-log-missing' }) })
  require('../../src/opencode-go').resolveOpenCodeGoConfig = () => ({ configured: false, baseUrl: null, managementKey: null,
    missing: ['controlled-unavailable-provider'] })

  for (const key of ['ODK_REMOTE_BRIDGE_SOCKET', 'ODK_LINK_SOCKET', 'ODK_FUTU_ENDPOINT', 'ODK_FUTU_SOCKET', 'ODK_HOSTED_PI_SOCKET']) delete process.env[key]
  const net = require('node:net')
  const connect = net.Socket.prototype.connect
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0]
    const endpoint = typeof first === 'string' ? first : first?.path
    assert.ok(typeof endpoint === 'string' && path.resolve(endpoint).startsWith(root + path.sep),
      'Composition connections must remain inside private fixture state')
    return connect.apply(this, args)
  }
  const forbidden = new net.Socket()
  try {
    assert.throws(() => forbidden.connect({ host: '127.0.0.1', port: 1 }), /inside private fixture state/)
    assert.throws(() => forbidden.connect(path.join(path.dirname(root), 'outside-fixture.sock')), /inside private fixture state/)
  } finally { forbidden.destroy() }
  return counts
}

module.exports = { isolateComposition }
