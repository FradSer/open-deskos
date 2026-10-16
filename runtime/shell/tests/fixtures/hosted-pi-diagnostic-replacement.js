'use strict'
const net = require('node:net')
const { createRuntimeChannelProbe } = require('../../src/runtime-channel-probe')

function independentHostedPiDiagnosis() {
  const port = 'odk:plugin-runtime/personal-agent/hosted-pi/v1'
  return {
    manifest: { schemaVersion: 1, id: 'odk.system.hosted-pi-diagnostics', name: 'Independent Hosted Pi diagnosis', version: '2.0.0', host: 'electron-main', kind: 'system',
      provides: [{ interface: port }], requires: [], permissions: ['system.hosted-pi-diagnostics'] },
    create(ctx) {
      const { endpoint } = ctx.capability('system.hosted-pi-diagnostics')
      const channel = createRuntimeChannelProbe({ endpoint, host: 'personal-agent', instance: 'hosted-pi', connect: net.createConnection,
        encodeRequest: requestId => ({ version: 1, command: 'runtime_diagnose', requestId }),
        decodeResponse(record, requestId) {
          if (record?.requestId !== requestId || record.version !== 1) return null
          if (record.ok === true) return { runtime: record.runtime }
          if (record.ok === false) return { runtime: { host: 'personal-agent', instance: 'hosted-pi', state: 'unavailable', reason: 'request-refused', plugins: [] } }
          throw Error('Invalid diagnosis response')
        },
      })
      ctx.onCleanup(() => channel.stop())
      return { ports: { [port]: { snapshot: () => channel.request({ signal: ctx.signal }) } } }
    },
  }
}

module.exports = { independentHostedPiDiagnosis }
