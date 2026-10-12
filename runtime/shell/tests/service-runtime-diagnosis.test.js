'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const { once } = require('node:events')
const { createServicePluginSocket } = require('../src/service-plugin-socket')

const { serviceChannel, connectEndpoint, pythonExecutable } = require('./helpers/private-test-host.cjs')
const report = { host: 'python-agent', instance: 'futu-poller', state: 'available', plugins: [{
  manifest: { schemaVersion: 1, id: 'odk.futu.publisher', name: 'Publisher', version: '1.0.0', host: 'python-agent', kind: 'service', provides: [], requires: [], permissions: [] },
  state: 'running', enabled: true,
}] }
async function fixture(t, capabilities = ['runtime_diagnosis']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-sdiag-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const channel = await serviceChannel(root)
  const endpoint = channel.endpoint
  const snapshots = []
  const server = createServicePluginSocket({ ...channel, endpoint, services: { 'futu-poller': { revision: 'dev' } }, onSnapshot: record => snapshots.push(record) })
  t.after(() => server.stop())
  await server.start()
  const client = net.connect(connectEndpoint(endpoint))
  t.after(() => client.destroy())
  await once(client, 'connect')
  if (channel.channelToken) require('../src/local-channel').writeHandshake(client, channel.channelToken)
  let buffer = ''
  const lines = []
  const waiters = []
  client.on('data', bytes => {
    buffer += bytes.toString()
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const record = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1)
      if (waiters.length) waiters.shift()(record); else lines.push(record)
    }
  })
  const next = () => lines.length ? Promise.resolve(lines.shift()) : new Promise(resolve => waiters.push(resolve))
  const send = record => client.write(JSON.stringify({ v: 1, service: 'futu-poller', ...record }) + '\n')
  send({ type: 'hello', revision: 'dev', proto: 1, capabilities })
  const ack = await next()
  return { server, client, next, send, snapshots, ack }
}

test('negotiated runtime reports are correlated and preserve service snapshots', async t => {
  const f = await fixture(t)
  assert.deepEqual(f.ack.capabilities, ['runtime_diagnosis'])
  const pending = f.server.diagnoseRuntime('futu-poller')
  const request = await f.next()
  assert.equal(request.type, 'runtime_diagnosis')
  f.send({ type: 'runtime_diagnosis_result', requestId: 'b'.repeat(32), report })
  f.send({ type: 'data', snapshot: { positions: [] }, updatedAt: 1 })
  assert.equal((await f.next()).ok, true)
  f.send({ type: 'runtime_diagnosis_result', requestId: request.requestId, report: { ...report, private: 'excluded' } })
  const result = await pending
  assert.equal(result.plugins[0].state, 'running')
  assert.equal(result.private, undefined)
  assert.equal(f.snapshots.length, 1)
})

test('old services receive no diagnosis command', async t => {
  const f = await fixture(t, [])
  assert.equal(f.ack.capabilities, undefined)
  await assert.rejects(f.server.diagnoseRuntime('futu-poller'), /capability-unavailable/)
  f.send({ type: 'data', snapshot: { positions: [] } })
  assert.equal((await f.next()).type, 'ack')
})

test('timeouts, disconnects, and malformed reports settle pending diagnosis', async t => {
  const f = await fixture(t)
  const timed = f.server.diagnoseRuntime('futu-poller', { timeoutMs: 20 })
  await f.next()
  await assert.rejects(timed, /timeout/)
  const invalid = f.server.diagnoseRuntime('futu-poller')
  const request = await f.next()
  f.send({ type: 'runtime_diagnosis_result', requestId: request.requestId, report: { ...report, host: 'electron-main' } })
  await assert.rejects(invalid, /invalid-report/)
  const disconnected = f.server.diagnoseRuntime('futu-poller')
  await f.next()
  f.client.destroy()
  await assert.rejects(disconnected, /disconnected/)
})

test('actual Python publisher answers diagnosis with its owned plugin lifecycle', async t => {
  const { execFile } = require('node:child_process')
  const { promisify } = require('node:util')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pdiag-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const channel = await serviceChannel(root)
  const endpoint = channel.endpoint
  let resolveReport
  let rejectReport
  const result = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject })
  const observed = result.then(report => report)
  observed.catch(() => {})
  const snapshots = []
  const server = createServicePluginSocket({ ...channel, endpoint, services: { 'futu-poller': { revision: 'dev' } },
    onSnapshot: record => snapshots.push(record),
    onStatus: status => {
      if (status.state === 'connected') server.diagnoseRuntime('futu-poller').then(resolveReport, rejectReport)
    },
  })
  t.after(() => server.stop())
  await server.start()
  const code = [
    'import poller, sys',
    'runtime = poller.create_poller({"ODK_FUTU_SOCKET": sys.argv[1], "ODK_CHANNEL_TOKEN_FILE": sys.argv[2], "ODK_FUTU_CONTROL": ""})',
    'runtime.start()',
    'try: runtime.host.get(poller.PORTS["publisher"]).send({"type":"data","snapshot":{"positions":[],"totals":{}}})',
    'finally: runtime.close()',
  ].join('\n')
  await promisify(execFile)(pythonExecutable, ['-c', code, endpoint, channel.tokenFile], {
    cwd: path.resolve(__dirname, '../../../integrations/futu-poller'), timeout: 10000,
  })
  const actual = await observed
  assert.equal(actual.host, 'python-agent')
  assert.equal(actual.instance, 'futu-poller')
  assert.deepEqual(actual.plugins.map(plugin => plugin.state), ['running', 'running', 'running', 'running'])
  assert.equal(snapshots.length, 1)
  assert.deepEqual(snapshots[0].snapshot, { positions: [], totals: {} })
})

test('Python owner receives diagnosis while waiting after publication', async t => {
  const { spawn } = require('node:child_process')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pwait-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const channel = await serviceChannel(root)
  const endpoint = channel.endpoint
  const server = createServicePluginSocket({ ...channel, endpoint, services: { 'futu-poller': { revision: 'dev' } } })
  t.after(() => server.stop())
  await server.start()
  const code = [
    'import poller, sys',
    'runtime = poller.create_poller({"ODK_FUTU_SOCKET": sys.argv[1], "ODK_CHANNEL_TOKEN_FILE": sys.argv[2], "ODK_FUTU_CONTROL": ""})',
    'runtime.start()',
    'publisher = runtime.host.get(poller.PORTS["publisher"])',
    'try:',
    ' publisher.send({"type":"data","snapshot":{"positions":[]}})',
    ' print("waiting", flush=True)',
    ' publisher.wait(2)',
    'finally: runtime.close()',
  ].join('\n')
  const child = spawn(pythonExecutable, ['-c', code, endpoint, channel.tokenFile], { cwd: path.resolve(__dirname, '../../../integrations/futu-poller') })
  t.after(() => { if (child.exitCode === null) child.kill() })
  const completed = once(child, 'exit')
  let stderr = ''
  child.stderr.on('data', bytes => { stderr += bytes })
  const [bytes] = await once(child.stdout, 'data')
  assert.equal(bytes.toString().trim(), 'waiting')
  const actual = await server.diagnoseRuntime('futu-poller')
  assert.deepEqual(actual.plugins.map(plugin => plugin.state), ['running', 'running', 'running', 'running'])
  assert.equal((await completed)[0], 0, stderr)
})

test('cancellation, pending bounds, and stop release diagnosis requests', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const cancelled = f.server.diagnoseRuntime('futu-poller', { signal: controller.signal }).catch(error => error.message)
  await f.next()
  controller.abort()
  assert.equal(await cancelled, 'cancelled')
  const pending = Array.from({ length: 16 }, () => f.server.diagnoseRuntime('futu-poller').catch(error => error.message))
  await assert.rejects(f.server.diagnoseRuntime('futu-poller'), /requests-full/)
  for (let index = 0; index < 16; index++) await f.next()
  await f.server.stop()
  assert.deepEqual(await Promise.all(pending), Array(16).fill('stopped'))
})
