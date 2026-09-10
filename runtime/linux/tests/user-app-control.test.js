const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { connect } = require('node:net')
const { once } = require('node:events')
const { createUserAppControl, listenUserAppControl } = require('../src/user-app-control')

test('desktop and socket share actual installer outcomes', async t => {
  const calls = []
  const control = createUserAppControl({
    list: async () => [{ id: 'clock' }],
    install: async id => { calls.push(id); return { ok: false, error: 'verification-failed' } },
  })
  assert.deepEqual(await control.dispatch({ command: 'install', appId: 'clock' }), { ok: false, error: 'verification-failed' })
  const dir = await mkdtemp(join(tmpdir(), 'odk-apps-'))
  const path = join(dir, 'control.sock')
  const server = await listenUserAppControl({ socketPath: path, control })
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }) })
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  const socket = connect(path)
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write(JSON.stringify({ v: 1, id: 'req-1', command: 'install', appId: 'clock' }) + '\n')
  assert.deepEqual(JSON.parse((await response)[0]), { v: 1, id: 'req-1', ok: false, error: 'verification-failed' })
  assert.deepEqual(calls, ['clock', 'clock'])
})

test('corrupt catalog cannot be reported as a successful list', async () => {
  const control = createUserAppControl({ list: async () => ({ ok: false, error: 'catalog-corrupt' }) })
  assert.deepEqual(await control.dispatch({ command: 'list' }), { ok: false, error: 'application-store-unavailable' })
})

test('invalid lifecycle intents cannot invoke store or become fake success', async () => {
  const control = createUserAppControl({})
  assert.deepEqual(await control.dispatch({ command: 'execute', appId: 'x' }), { ok: false, error: 'invalid-command' })
  assert.deepEqual(await control.dispatch({ command: 'install', appId: '../x' }), { ok: false, error: 'invalid-app-id' })
})
