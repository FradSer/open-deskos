import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENDPOINT_VERSION, endpointFile, publishEndpoint, readEndpoint, removeEndpoint } from '../src/task-endpoint.mjs'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-endpoint-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, file: join(dir, 'run/open-deskos/hosted-pi/endpoint.json') }
}

// The descriptor is the published fact a client reads instead of the host's private configuration, so
// its path has to be derivable from the session alone and its content has to be exactly the bound
// socket rather than a recomputed guess.
test('the endpoint path is derived from the session and is absent without one', async t => {
  const { dir } = await fixture(t)
  assert.equal(endpointFile(dir), join(dir, 'open-deskos/hosted-pi/endpoint.json'))
  assert.equal(endpointFile('relative/run'), undefined)
  assert.equal(endpointFile(undefined), undefined)
})

test('publishing records the bound socket privately and removing it is idempotent', async t => {
  const { file } = await fixture(t)
  const config = { socketPath: '/run/user/1000/pi-tasks/control.sock', stateDir: '/home/kiosk/.local/state/pi-tasks' }
  await publishEndpoint(file, config)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
  assert.equal((await stat(join(file, '..'))).mode & 0o777, 0o700)
  assert.deepEqual(await readEndpoint(file), { version: ENDPOINT_VERSION, ...config })
  await publishEndpoint(file, config)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).socketPath, config.socketPath)
  await removeEndpoint(file)
  assert.equal(existsSync(file), false)
  await removeEndpoint(file)
  await removeEndpoint(undefined)
})

// A descriptor a client cannot trust must be refused as invalid rather than half-read, because a
// wrong socket path is indistinguishable from a host that is down.
test('an unusable descriptor is refused instead of partially accepted', async t => {
  const { file } = await fixture(t)
  await publishEndpoint(file, { socketPath: '/run/control.sock', stateDir: '/state' })
  for (const value of [{ ...JSON.parse(await readFile(file, 'utf8')), version: 2 }, { version: 1, socketPath: 'relative.sock' }, { version: 1 }, null]) {
    await writeFile(file, JSON.stringify(value))
    await assert.rejects(readEndpoint(file), /描述符无效/)
  }
  await writeFile(file, 'not json')
  await assert.rejects(readEndpoint(file), SyntaxError)
})
