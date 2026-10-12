'use strict'

const net = require('node:net')
const { createRuntimeChannelProbe } = require('../runtime-channel-probe')

const HOSTED_PI_RUNTIME_PORT = 'odk:plugin-runtime/personal-agent/hosted-pi/v1'

function createHostedPiDiagnosticsPlugin() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.hosted-pi-diagnostics', name: 'Hosted Pi lifecycle diagnosis',
      version: '1.0.0', kind: 'system', host: 'electron-main', provides: [{ interface: HOSTED_PI_RUNTIME_PORT }],
      requires: [], permissions: ['system.hosted-pi-diagnostics'] },
    create(ctx) {
      const config = ctx.capability('system.hosted-pi-diagnostics')
      const probe = createRuntimeChannelProbe({ endpoint: config.endpoint, host: 'personal-agent', instance: 'hosted-pi', connect: net.createConnection,
        encodeRequest: requestId => ({ version: 1, command: 'runtime_diagnose', requestId }),
        decodeResponse(record, requestId) {
          if (record?.version !== 1 || record.requestId !== requestId) return null
          if (typeof record.ok !== 'boolean') throw Error('invalid response')
          return { runtime: record.ok ? record.runtime : { host: 'personal-agent', instance: 'hosted-pi', state: 'unavailable', reason: 'request-refused', plugins: [] } }
        },
      })
      ctx.onCleanup(probe.stop)
      return { ports: { [HOSTED_PI_RUNTIME_PORT]: { snapshot: () => probe.request({ signal: ctx.signal }) } } }
    },
  }
}

module.exports = { createHostedPiDiagnosticsPlugin, HOSTED_PI_RUNTIME_PORT }
