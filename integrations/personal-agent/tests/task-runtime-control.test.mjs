import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createTaskComposition, TASK_PORTS } from '../src/task-composition.mjs'

const require = createRequire(import.meta.url)
const { resolveShellHost } = require('../../../runtime/shell/src/platform')
const { requestLocalControl } = require('../../../runtime/shell/src/local-control-client')
const run = promisify(execFile)
const cli = fileURLToPath(new URL('../../../runtime/shell/scripts/odk-plugin-cli.js', import.meta.url))

test('Hosted Pi management authenticates before changing task resources', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-task-token-'))
  const endpoint = join(root, 'manage.sock')
  let closed = 0
  const composition = createTaskComposition({ control: { endpoint, stateDir: root, platform: 'win32' },
    openChannel: () => ({ disconnectClients() {}, close() {} }),
    createService: () => ({ close() { closed++ } }),
    endpointFile: () => null, publishEndpoint() {}, removeEndpoint() {},
  })
  t.after(async () => { await composition.close(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  const wrong = join(root, 'wrong')
  await writeFile(wrong, 'wrong')
  const options = { endpoint, platform: 'win32', label: 'Hosted Pi fixture', request: { command: 'disable', pluginId: 'odk.hosted-pi.service' } }
  await assert.rejects(requestLocalControl({ ...options, tokenFile: wrong }), /closed/)
  assert.equal(closed, 0)
  assert.equal((await requestLocalControl({ ...options, tokenFile: join(root, 'local-channel.token') })).state, 'disabled')
  assert.equal(closed, 1)
})

test('saved listener disable retains Hosted Pi management for startup recovery', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-task-disabled-'))
  const endpoint = join(root, 'manage.sock')
  const composition = createTaskComposition({ control: { endpoint, stateDir: root }, disabled: ['odk.hosted-pi.listener'],
    openChannel: () => ({ disconnectClients() {}, close() {} }), createService: () => ({ close() {} }),
    endpointFile: () => null, publishEndpoint() {}, removeEndpoint() {},
  })
  t.after(async () => { await composition.close(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  assert.equal((await requestLocalControl({ endpoint, label: 'Hosted Pi recovery', request: { command: 'enable', pluginId: 'odk.hosted-pi.listener' } })).state, 'running')
  assert.ok(composition.catalog().every(plugin => plugin.state === 'running'))
})

test('actual CLI manages Hosted Pi with independent recovery and preserved preferences', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-task-manage-'))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, ODK_CONFIG_DIR: join(root, 'config') }
  const host = resolveShellHost({ env })
  let handler
  let closed = 0
  let services = 0
  let published = false
  let fail = true
  const composition = createTaskComposition({
    control: { endpoint: host.endpoint('hosted-pi-control'), stateDir: host.stateDir, platform: host.platform },
    openChannel: async handle => { handler = handle; return { disconnectClients() {}, close() { closed++ } } },
    createService() {
      if (fail) throw Error('private startup failure')
      const generation = ++services
      return { handle: request => ({ version: 1, requestId: request.requestId, ok: true, generation }), disconnect() {}, close() {} }
    },
    endpointFile: () => join(root, 'descriptor.json'),
    publishEndpoint: async () => { published = true }, removeEndpoint: async () => { published = false },
  })
  t.after(async () => { fail = false; await composition.close(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  const command = (action, name) => run(process.execPath, [cli, action, `odk.hosted-pi.${name}`, '--runtime'], { env })
  fail = false
  assert.equal(JSON.parse((await command('enable', 'service')).stdout).scope, 'personal-agent')
  const listener = composition.port(TASK_PORTS.listener)
  const request = { version: 1, requestId: 'fixture', command: 'status' }
  assert.deepEqual(await handler(request), { version: 1, requestId: 'fixture', ok: true, generation: 1 })
  await command('disable', 'service')
  assert.equal(published, false)
  assert.equal(closed, 0)
  assert.equal(composition.port(TASK_PORTS.listener), listener)
  await command('enable', 'service')
  assert.equal(published, true)
  assert.equal((await handler(request)).generation, 2)
  await command('disable', 'listener')
  assert.equal(closed, 1)
  assert.equal(composition.port(TASK_PORTS.listener), null)
  await command('enable', 'listener')
  assert.equal((await handler(request)).generation, 3)
  await assert.rejects(command('disable', 'control'), /protected-plugin/)
  await assert.rejects(access(join(env.ODK_CONFIG_DIR, 'plugins.json')), /ENOENT/)
  await composition.close()
  await assert.rejects(access(host.endpoint('hosted-pi-control')), /ENOENT/)
})
