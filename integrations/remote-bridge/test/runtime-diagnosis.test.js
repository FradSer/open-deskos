'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { respondRuntimeDiagnosis } = require('../lib/plugin-runtime')

function socket(writableLength = 0) {
  return { writableLength, destroyed: false, writes: [],
    write(line) { this.writes.push(JSON.parse(line)); return true },
    destroy() { this.destroyed = true },
  }
}

const request = () => ({ v: 1, type: 'runtime_diagnose', requestId: randomUUID() })
const catalog = () => [{ manifest: { schemaVersion: 1, id: 'odk.remote.listener', name: 'Listener', version: '1.0.0',
  kind: 'system', host: 'remote-bridge', provides: [], requires: [], permissions: [], privatePath: 'private' },
  enabled: true, state: 'failed', error: 'private exception', device: 'private device' }]

test('bridge runtime responder strips private data and preserves lifecycle failure', () => {
  const client = socket()
  const command = request()
  assert.equal(respondRuntimeDiagnosis(client, command, catalog), true)
  assert.equal(client.writes[0].requestId, command.requestId)
  assert.equal(client.writes[0].runtime.plugins[0].state, 'failed')
  assert.equal(JSON.stringify(client.writes).includes('private'), false)
})

test('invalid commands never read the catalog or affect ordinary state processing', () => {
  const client = socket()
  const forbidden = () => { throw Error('must not read') }
  assert.equal(respondRuntimeDiagnosis(client, { v: 1, type: 'state' }, forbidden), false)
  assert.equal(respondRuntimeDiagnosis(client, { ...request(), extra: true }, forbidden), true)
  assert.equal(respondRuntimeDiagnosis(client, { ...request(), requestId: 1 }, forbidden), true)
  assert.deepEqual(client.writes, [])
})

test('slow diagnostic clients close instead of accumulating reports', () => {
  const client = socket(65536)
  respondRuntimeDiagnosis(client, request(), catalog)
  assert.equal(client.destroyed, true)
  assert.deepEqual(client.writes, [])
})

test('failed and asynchronous catalogs report unavailable without unhandled rejections', async () => {
  for (const snapshot of [() => { throw Error('private') }, () => Promise.reject(Error('private'))]) {
    const client = socket()
    respondRuntimeDiagnosis(client, request(), snapshot)
    assert.equal(client.writes[0].runtime.reason, 'invalid-report')
    assert.equal(JSON.stringify(client.writes).includes('private'), false)
  }
  await new Promise(resolve => setImmediate(resolve))
})
