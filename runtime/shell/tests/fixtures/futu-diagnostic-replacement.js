'use strict'
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')

function independentFutuDiagnosis() {
  const port = 'odk:plugin-runtime/python-agent/futu-poller/v1'
  const knownReasons = ['provider-unavailable', 'capability-unavailable', 'ambiguous-peer', 'requests-full', 'channel-busy', 'timeout', 'disconnected', 'invalid-report', 'stopped', 'cancelled', 'peer-changed']
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.futu-runtime-diagnostics', name: 'Independent Futu diagnosis', version: '2.0.0', host: 'electron-main', kind: 'system',
      provides: [{ interface: port }], requires: [{ interface: DESK_PORTS.futu, optional: true }], permissions: [] },
    create(ctx) {
      const unavailable = reason => [{ host: 'python-agent', instance: 'futu-poller', state: 'unavailable', reason, plugins: [] }]
      return { ports: { [port]: { async snapshot() {
        const source = ctx.get(DESK_PORTS.futu)?.source
        if (typeof source?.diagnoseRuntime !== 'function') return unavailable('provider-unavailable')
        try {
          const report = await source.diagnoseRuntime('futu-poller', { signal: ctx.signal })
          return [report]
        } catch (error) {
          return unavailable(knownReasons.includes(error?.message) ? error.message : 'probe-failed')
        }
      } } } }
    },
  }
}

module.exports = { independentFutuDiagnosis }
