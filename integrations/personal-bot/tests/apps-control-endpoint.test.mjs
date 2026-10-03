import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as net from 'node:net'
import { appsControlEndpoint, userAppsRequest } from '../src/apps-control.mjs'
import { deskDataRequest } from '../src/desk-data.mjs'
import { channelHandshake } from '../src/channel-token.mjs'
import { loadCapabilities } from '../src/capabilities.mjs'

const PIPE = '\\\\.\\pipe\\open-deskos-user-app-control'
const WINDOWS_ENV = { LOCALAPPDATA: 'C:\\Users\\fradser\\AppData\\Local' }

async function fixture(t, token = 'the-host-channel-token') {
  const dir = await mkdtemp(join(tmpdir(), 'ac-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'local-channel.token')
  await writeFile(file, `${token}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return { dir, file, token }
}

/**
 * A named pipe only exists on a Windows host, so the transport is stood in for by
 * a socket in the temporary directory. The endpoint name, the token gate and the
 * request protocol still run for real; only the transport is replaced.
 */
function standInPipeNet(dir) {
  const stand = endpoint => join(dir, `p-${String(endpoint).replace(/^\\\\\.\\pipe\\/i, '')}`)
  return { path: stand, connect: endpoint => net.connect(stand(endpoint)) }
}

/** A Shell-side control endpoint that answers what the test needs it to answer. */
async function listenControl(t, { listenPath, token = null, answer }) {
  const received = []
  const server = net.createServer(client => {
    let buffer = ''
    client.on('data', chunk => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      for (const line of buffer.split('\n').filter(Boolean)) received.push(line)
      const request = JSON.parse(buffer.split('\n').filter(Boolean).at(-1))
      if (token && received[0] !== channelHandshake(token).trim()) return client.destroy()
      client.end(JSON.stringify({ v: 1, id: request.id, ...answer(request) }) + '\n')
    })
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.listen(listenPath, resolve))
  return received
}

test('the application control endpoint is the one the Shell Host names for it', () => {
  assert.equal(appsControlEndpoint({}, 'linux'), null, 'a Unix host without a runtime directory resolves no endpoint to guess')
  assert.equal(appsControlEndpoint({ XDG_RUNTIME_DIR: 'run/user/1000' }, 'linux'), null, 'a relative runtime directory is not an endpoint')
  assert.equal(appsControlEndpoint({ XDG_RUNTIME_DIR: '/run/user/1000' }, 'linux'), '/run/user/1000/open-deskos-apps/control.sock')
  assert.equal(appsControlEndpoint({}, 'win32'), PIPE, 'the pipe name does not depend on a directory the host may not have')
  assert.equal(appsControlEndpoint({ ODESK_APPS_CONTROL_SOCKET: '/tmp/apps.sock' }, 'linux'), '/tmp/apps.sock')
})

test('a Unix host is reached with one request and no invented handshake', async t => {
  const { dir } = await fixture(t)
  await mkdir(join(dir, 'open-deskos-apps'), { recursive: true })
  const endpoint = appsControlEndpoint({ XDG_RUNTIME_DIR: dir })
  const received = await listenControl(t, {
    listenPath: endpoint,
    answer: () => ({ ok: true, apps: [{ id: 'pomodoro' }] }),
  })
  const response = await userAppsRequest('list', { env: { XDG_RUNTIME_DIR: dir } })
  assert.deepEqual(response.apps, [{ id: 'pomodoro' }])
  assert.equal(received.length, 1, 'ownership already proved the peer, so no handshake is written')
})

test('a token-gated Windows host is reached by presenting the shared token first', async t => {
  const { dir, file, token } = await fixture(t)
  const pipeNet = standInPipeNet(dir)
  const received = await listenControl(t, {
    listenPath: pipeNet.path(PIPE),
    token,
    answer: () => ({ ok: true, pages: [{ id: 'home', kind: 'grid' }] }),
  })
  const response = await userAppsRequest('desktop', {
    env: { ...WINDOWS_ENV, ODK_CHANNEL_TOKEN_FILE: file },
    platform: 'win32',
    connect: pipeNet.connect,
  })
  assert.deepEqual(response.pages, [{ id: 'home', kind: 'grid' }])
  assert.equal(received[0], channelHandshake(token).trim(), 'a pipe carries no owner, so the token is the gate')
})

test('a client never invents a channel token, and says so when there is none', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ac-none-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const missing = join(root, 'no-token-here.token')
  for (const [label, request] of [
    ['application lifecycle', () => userAppsRequest('list', { env: { ODK_CHANNEL_TOKEN_FILE: missing }, platform: 'win32' })],
    ['desk data', () => deskDataRequest('list', { env: { ODK_CHANNEL_TOKEN_FILE: missing }, platform: 'win32' })],
  ]) {
    await assert.rejects(request, /channel token to present|unavailable/i, label)
  }
  assert.deepEqual((await readdir(root)).filter(name => name.includes('token')), [],
    'a client must not create a credential in whatever directory it is standing in')
})

test('the lifecycle tools reach the endpoint this host names', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'apps-cap-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const original = process.env.ODESK_APPS_CONTROL_SOCKET
  process.env.ODESK_APPS_CONTROL_SOCKET = join(dir, 'apps.sock')
  t.after(() => { if (original === undefined) delete process.env.ODESK_APPS_CONTROL_SOCKET; else process.env.ODESK_APPS_CONTROL_SOCKET = original })
  const commands = []
  const server = net.createServer(client => {
    let buffer = ''
    client.on('data', chunk => {
      buffer += chunk
      if (!buffer.includes('\n')) return
      const request = JSON.parse(buffer)
      commands.push(request.command)
      client.end(JSON.stringify({ v: 1, id: request.id, ok: true, apps: [] }) + '\n')
    })
  })
  t.after(() => new Promise(resolve => server.close(resolve)))
  await new Promise(resolve => server.listen(process.env.ODESK_APPS_CONTROL_SOCKET, resolve))
  const list = (await loadCapabilities()).find(tool => tool.name === 'user_apps_list')
  await list.execute('call', {})
  assert.deepEqual(commands, ['list'])
})
