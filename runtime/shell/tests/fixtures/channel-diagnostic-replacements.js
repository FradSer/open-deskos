'use strict'
const { SYSTEM_PORTS } = require('../../src/plugins/system-channels')

function independentResidentDiagnosis() {
  const port = 'odk:plugin-runtime/personal-agent/v1'
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.personal-bot-diagnostics', name: 'Independent resident diagnosis', version: '2.0.0', kind: 'system', host: 'electron-main',
      provides: [{ interface: port }], requires: [{ interface: SYSTEM_PORTS.personalBot, optional: true }], permissions: [] },
    create(ctx) {
      const unavailable = reason => [{ host: 'personal-agent', instance: 'resident', state: 'unavailable', reason, plugins: [] }]
      return { ports: { [port]: { snapshot() {
        if (ctx.signal.aborted) return unavailable('stopped')
        const client = ctx.get(SYSTEM_PORTS.personalBot)
        if (!client) return unavailable('provider-unavailable')
        if (typeof client.diagnose !== 'function') return unavailable('not-supported')
        return client.diagnose({ signal: ctx.signal })
      } } } }
    },
  }
}

function independentRemoteDiagnosis() {
  const port = 'odk:plugin-runtime/remote-bridge/v1'
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.remote-bridge-diagnostics', name: 'Independent bridge diagnosis', version: '2.0.0', kind: 'system', host: 'electron-main',
      provides: [{ interface: port }], requires: [{ interface: SYSTEM_PORTS.remoteLink, optional: true }], permissions: [] },
    create(ctx) {
      const unavailable = reason => [{ host: 'remote-bridge', instance: 'bridge', state: 'unavailable', reason, plugins: [] }]
      return { ports: { [port]: { snapshot() {
        if (ctx.signal.aborted) return unavailable('stopped')
        const client = ctx.get(SYSTEM_PORTS.remoteLink)?.client
        if (!client) return unavailable('provider-unavailable')
        if (typeof client.diagnose !== 'function') return unavailable('not-supported')
        return client.diagnose({ signal: ctx.signal })
      } } } }
    },
  }
}

module.exports = { independentResidentDiagnosis, independentRemoteDiagnosis }
