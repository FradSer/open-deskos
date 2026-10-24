const { isolatedElectronArgs } = require('./helpers/electron-fixture')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { promisify } = require('node:util')
const execFile = promisify(require('node:child_process').execFile)
const { posixOnlyReason } = require('./not-ported')

test('Futu Electron timeout cleans its profile, signed store and connected publisher', { skip: posixOnlyReason('unix-socket'), timeout: 15000 }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-futu-parent-'))
  const env = { ...process.env, ODK_FUTU_FIXTURE_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  let failure
  try {
    await execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'futu-service-electron.cjs'), '--timeout-after-connect']), { env, timeout: 10000, killSignal: 'SIGKILL' })
  } catch (error) { failure = error }
  finally { await fs.rm(profile, { recursive: true, force: true }) }
  assert.ok(failure, 'timeout fixture must fail')
  assert.equal(failure.code, 1)
  assert.match(failure.stderr, /FUTU_SERVICE_TIMEOUT/)
  const marker = failure.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(record => record.timeoutFixture)
  assert.ok(marker)
  assert.equal(marker.profile, profile)
  assert.equal(marker.rendererUrl, '')
  assert.equal(marker.windows, 0)
  assert.equal(marker.signedFactory, true)
  const canonicalRoot = path.join(await fs.realpath(path.dirname(marker.root)), path.basename(marker.root))
  assert.ok(marker.storedRoot.startsWith(`${canonicalRoot}${path.sep}`))
  for (const owned of [marker.root, marker.storedRoot, marker.profile, marker.endpoint]) await assert.rejects(fs.stat(owned), { code: 'ENOENT' }, `Fixture retained ${owned}`)
})
