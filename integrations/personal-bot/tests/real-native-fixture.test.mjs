import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
const fixture = new URL('./helpers/real-native-fixture-host.mjs', import.meta.url)
test('native fixture plans inherited and explicit private endpoint directories without provider calls', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-native-plan-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ['package', 'project', 'runtime', 'override', 'agent']) await mkdir(join(root, name), { mode: 0o700 })
  await writeFile(join(root, 'package', 'index.ts'), '// Not executed by read-only plan.\n', { mode: 0o600 })
  const env = { ...process.env, ODK_REAL_NATIVE_ACCEPTANCE: '1', ODK_REAL_NATIVE_MODEL: 'plan/no-provider-call',
    ODK_REAL_NATIVE_PROJECT_ROOT: join(root, 'project'), ODK_REAL_NATIVE_PACKAGE_DIR: join(root, 'package'),
    ODK_SESSION_HOST_SOCKET: join(root, 'runtime'), PI_CODING_AGENT_DIR: join(root, 'agent') }
  delete env.ODK_REAL_NATIVE_RUNTIME_DIR
  const run = extra => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixture.pathname, '--plan'], { env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', bytes => { output += bytes }); child.stderr.resume()
    child.once('error', reject); child.once('close', code => resolve({ code, rows: output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }))
  })
  const inherited = await run({})
  assert.equal(inherited.code, 0)
  assert.equal(inherited.rows.find(row => row.event === 'plan').runtimeDirectory, env.ODK_SESSION_HOST_SOCKET)
  const explicit = await run({ ODK_REAL_NATIVE_RUNTIME_DIR: join(root, 'override') })
  assert.equal(explicit.code, 0)
  assert.equal(explicit.rows.find(row => row.event === 'plan').runtimeDirectory, join(root, 'override'))
  const invalid = await run({ ODK_REAL_NATIVE_RUNTIME_DIR: join(root, 'missing') })
  assert.equal(invalid.code, 1)
  assert(!invalid.rows.some(row => row.event === 'plan'))
})
