'use strict'

const { DESK_PORTS } = require('./desk-runtime')
const FUTU_RUNTIME_PORT = 'odk:plugin-runtime/python-agent/futu-poller/v1'
const REASONS = new Set(['provider-unavailable', 'capability-unavailable', 'ambiguous-peer', 'requests-full', 'channel-busy', 'timeout', 'disconnected', 'invalid-report', 'stopped', 'cancelled', 'peer-changed'])

function createFutuRuntimeDiagnosticsPlugin() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.futu-runtime-diagnostics', name: 'Futu runtime diagnosis',
      version: '1.0.0', host: 'electron-main', kind: 'system', permissions: [],
      provides: [{ interface: FUTU_RUNTIME_PORT }], requires: [{ interface: DESK_PORTS.futu, optional: true }] },
    create(ctx) {
      return { ports: { [FUTU_RUNTIME_PORT]: { async snapshot() {
        const unavailable = reason => [{ host: 'python-agent', instance: 'futu-poller', state: 'unavailable', reason, plugins: [] }]
        const source = ctx.get(DESK_PORTS.futu)?.source
        if (typeof source?.diagnoseRuntime !== 'function') return unavailable('provider-unavailable')
        try { return [await source.diagnoseRuntime('futu-poller', { signal: ctx.signal })] }
        catch (error) { return unavailable(REASONS.has(error?.message) ? error.message : 'probe-failed') }
      } } } }
    },
  }
}

module.exports = { createFutuRuntimeDiagnosticsPlugin, FUTU_RUNTIME_PORT }
