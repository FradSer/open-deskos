const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const entry = path.join(__dirname, '..', 'scripts', 'desk-link-service.js')

function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-desk-link-entry-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function env(dir) {
  return { PATH: process.env.PATH, HOME: dir, XDG_RUNTIME_DIR: dir, ODK_DESK_LINK_SOCKET: path.join(dir, 'service.sock'), ODK_DESK_LINK_PORT: '0' }
}

async function startsAndReports(t, variables, dir) {
  const child = spawn(process.execPath, [entry], { env: { ...env(dir), ...variables }, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const started = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 15000)
    child.stdout.on('data', () => { if (stdout.includes('listening on')) { clearTimeout(timer); resolve(true) } })
    child.once('exit', () => { clearTimeout(timer); resolve(false) })
  })
  return { started, stdout, stderr, stop: async () => { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)) } }
}

// One secret, one carrier. A token in the environment is readable from the process environment, so a
// mode-0600 file is the form to provision; the environment form still has to work for the migration
// window, and a file that is set but unusable must stop the service instead of silently falling back
// to a different token than the operator provisioned.
test('the reporting token comes from a file, and the environment form still works', async t => {
  const dir = home(t)
  const file = path.join(dir, 'desk-link.token')
  fs.writeFileSync(file, '  file-token\n', { mode: 0o600 })

  const refused = spawnSync(process.execPath, [entry], { env: env(dir), encoding: 'utf8', timeout: 20000 })
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /ODK_DESK_LINK_TOKEN_FILE \(preferred\) or ODK_DESK_LINK_TOKEN/)

  for (const [label, variables] of [['file', { ODK_DESK_LINK_TOKEN_FILE: file }], ['environment', { ODK_DESK_LINK_TOKEN: 'env-token' }]]) {
    // Both cases reuse one socket path on purpose: the second start proves the first stop withdrew it.
    const run = await startsAndReports(t, variables, dir)
    assert.ok(run.started, `${label} token was not accepted: ${run.stdout}${run.stderr}`)
    await run.stop()
  }

  for (const [label, value, message] of [
    ['relative', 'relative/token', /must be absolute/],
    ['missing', path.join(dir, 'absent.token'), /ENOENT/],
  ]) {
    const result = spawnSync(process.execPath, [entry], { env: { ...env(dir), ODK_DESK_LINK_TOKEN: 'env-token', ODK_DESK_LINK_TOKEN_FILE: value }, encoding: 'utf8', timeout: 20000 })
    assert.equal(result.status, 1, `${label} token file must stop the service`)
    assert.match(result.stderr, message)
  }

  fs.writeFileSync(file, '   \n', { mode: 0o600 })
  const empty = spawnSync(process.execPath, [entry], { env: { ...env(dir), ODK_DESK_LINK_TOKEN_FILE: file }, encoding: 'utf8', timeout: 20000 })
  assert.equal(empty.status, 1)
  assert.match(empty.stderr, /holds no token/)
})

// The Control Credential is what lets a Console drive this desk, and like the reporting token it
// belongs in a file. A broken path must stop the service instead of silently offering a desk that
// refuses every control record, while an empty file is the documented report-only desk.
test('the control credential accepts a file and refuses an unusable one', async t => {
  const dir = home(t)
  fs.writeFileSync(path.join(dir, 'reporting.token'), 'reporting-token\n', { mode: 0o600 })
  const control = path.join(dir, 'control.token')
  fs.writeFileSync(control, 'control-credential\n', { mode: 0o600 })
  const base = { ...env(dir), ODK_DESK_LINK_TOKEN_FILE: path.join(dir, 'reporting.token') }

  const configured = await startsAndReports(t, { ...base, ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE: control }, dir)
  assert.ok(configured.started, `a control credential file was not accepted: ${configured.stderr}`)
  assert.doesNotMatch(configured.stderr, /accepts reporting only/)
  await configured.stop()

  for (const [label, value, message] of [
    ['relative', 'relative/control.token', /must be absolute/],
    ['missing', path.join(dir, 'absent.token'), /ENOENT/],
  ]) {
    const result = spawnSync(process.execPath, [entry], { env: { ...base, ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE: value }, encoding: 'utf8', timeout: 20000 })
    assert.equal(result.status, 1, `${label} control credential file must stop the service`)
    assert.match(result.stderr, message)
  }

  // An empty file is report-only, stated rather than assumed: the service still starts.
  fs.writeFileSync(control, '\n', { mode: 0o600 })
  const empty = await startsAndReports(t, { ...base, ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE: control }, dir)
  assert.ok(empty.started, `an empty control credential must still serve reporting: ${empty.stderr}`)
  assert.match(empty.stderr, /accepts reporting only/)
  await empty.stop()
})