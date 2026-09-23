import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'

const integration = fileURLToPath(new URL('..', import.meta.url))

// Mirrors a released host: the integration is reached only through a stable
// symlink to the active release, never through the dated release directory.
async function host(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-entry-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const root = join(dir, 'development')
  const socket = join(dir, 'run/control.sock')
  for (const path of [root, join(dir, 'state'), join(dir, 'run')]) await mkdir(path, { recursive: true, mode: 0o700 })
  const config = join(dir, 'pi-tasks.json')
  await writeFile(config, `${JSON.stringify({ roots: [root], stateDir: join(dir, 'state'), socketPath: socket })}\n`, { mode: 0o600 })
  await symlink(integration, join(dir, 'current'), 'dir')
  return { dir, config, socket, entry: join(dir, 'current/src/task-daemon.mjs') }
}

function start(entry, { dir, config }) {
  return spawn(process.execPath, [entry], {
    env: { PATH: process.env.PATH, HOME: dir, XDG_RUNTIME_DIR: dir, ODESK_TASK_CONFIG: config },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function connector(socket) {
  return new Promise(resolve => {
    const client = connect(socket)
    client.once('connect', () => resolve(client))
    client.once('error', () => { client.destroy(); resolve(undefined) })
  })
}

async function listSessions(client) {
  const reply = new Promise(resolve => client.once('data', data => resolve(JSON.parse(data.toString().split('\n')[0]))))
  client.write(`${JSON.stringify({ version: 1, requestId: 'entry-check', command: 'list' })}\n`)
  return reply
}

async function waitForPublished(descriptor) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return JSON.parse(await readFile(descriptor, 'utf8')) } catch { await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  throw new Error(`the running host published no endpoint descriptor at ${descriptor}`)
}

test('the task daemon serves its socket when started through a release symlink', async t => {
  const paths = await host(t)
  const child = start(paths.entry, paths)
  t.after(() => child.kill())
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  let client
  for (let attempt = 0; attempt < 400 && !client && child.exitCode === null; attempt++) {
    client = await connector(paths.socket)
    if (!client) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(client, `daemon served no control socket; stderr: ${stderr}`)
  t.after(() => client.destroy())
  assert.equal(child.exitCode, null, 'daemon exited instead of serving the socket')
  let response
  for (let attempt = 0; attempt < 40 && response?.ok !== true; attempt++) {
    response = await listSessions(client)
    if (response.ok !== true) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(response.ok, true, `serving daemon rejected a list request: ${JSON.stringify(response)}`)
  assert.deepEqual(response.tasks, [])
})

// The desk's Console path discovers this host through the published descriptor, and a descriptor left
// behind by a stopped host claims a socket that is not there — the same lie either way for an
// operator looking at a Console that reports no host.
test('the running daemon publishes its endpoint and withdraws it on shutdown', async t => {
  const paths = await host(t)
  const descriptor = join(paths.dir, 'open-deskos/hosted-pi/endpoint.json')
  const child = start(paths.entry, paths)
  t.after(() => child.kill())
  let client
  for (let attempt = 0; attempt < 400 && !client && child.exitCode === null; attempt++) {
    client = await connector(paths.socket)
    if (!client) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(client, 'daemon served no control socket')
  t.after(() => client.destroy())
  assert.equal((await listSessions(client)).ok, true)
  // The host serves before it publishes, so discovery never promises a socket that cannot answer;
  // the descriptor therefore appears just after the first successful request.
  const published = await waitForPublished(descriptor)
  assert.equal(published.socketPath, paths.socket, 'the descriptor must name the socket the daemon bound')
  assert.equal(published.version, 1)
  assert.equal((await stat(descriptor)).mode & 0o777, 0o600)
  child.kill('SIGTERM')
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0)
  assert.equal(existsSync(descriptor), false, 'a stopped host must not leave a descriptor behind')
})

test('importing the task daemon without running it starts no daemon', async t => {
  const paths = await host(t)
  const wrapper = join(paths.dir, 'wrapper.mjs')
  await writeFile(wrapper, `await import(${JSON.stringify(paths.entry)})\n`)
  const child = start(wrapper, paths)
  t.after(() => child.kill())
  const exit = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(() => resolve('still-running'), 10000)),
  ])
  child.kill()
  assert.equal(exit, 0, 'importing the module must not start a daemon')
  assert.ok(!existsSync(paths.socket), 'importing the module created a control socket')
})