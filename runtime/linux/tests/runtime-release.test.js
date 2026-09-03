const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  activateRelease,
  currentRelease,
  migrateUser,
  preflightRelease,
  readRuntimeState,
  validateRuntimeComposition,
} = require('../scripts/lib/runtime-release')

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-deskos-release-'))
  const stateDir = path.join(root, 'state')
  const releasesDir = path.join(root, 'releases')
  fs.mkdirSync(releasesDir, { recursive: true })
  return {
    root,
    stateDir,
    releasesDir,
    activeLink: path.join(root, 'current'),
    rollbackLink: path.join(root, 'previous'),
    lockPath: path.join(stateDir, 'update.lock'),
  }
}

function makeRelease(runtime, id, metadata = {}) {
  const dir = path.join(runtime.releasesDir, id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ id, schemaVersion: 1, ...metadata }), 'utf8')
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8')
  return dir
}

function cleanup(runtime) {
  fs.rmSync(runtime.root, { recursive: true, force: true })
}

test('activates a preflighted staged release and keeps the previous release as rollback', () => {
  const runtime = makeRuntime()
  try {
    const stable = makeRelease(runtime, 'stable')
    const candidate = makeRelease(runtime, 'candidate')
    fs.symlinkSync(stable, runtime.activeLink)
    const calls = []

    const result = activateRelease({
      runtime,
      candidatePath: candidate,
      preflight: (releasePath) => preflightRelease(releasePath, { run: () => ({ status: 0 }) }),
      restart: (releaseId) => calls.push(releaseId),
      verify: () => ({ ok: true }),
    })

    assert.equal(result.ok, true)
    assert.equal(result.active, 'candidate')
    assert.equal(currentRelease(runtime), 'candidate')
    assert.equal(fs.realpathSync(runtime.rollbackLink), fs.realpathSync(stable))
    assert.deepEqual(calls, ['candidate'])
    assert.deepEqual(readRuntimeState(runtime), {
      active: 'candidate',
      rollback: 'stable',
      lastUpdate: { ok: true, release: 'candidate', reason: null },
    })
  } finally {
    cleanup(runtime)
  }
})

test('does not activate a candidate that fails preflight', () => {
  const runtime = makeRuntime()
  try {
    const stable = makeRelease(runtime, 'stable')
    const candidate = makeRelease(runtime, 'candidate')
    fs.symlinkSync(stable, runtime.activeLink)

    const result = activateRelease({
      runtime,
      candidatePath: candidate,
      preflight: () => ({ ok: false, reason: 'smoke failed' }),
      restart: () => assert.fail('must not restart a failed candidate'),
      verify: () => assert.fail('must not verify a failed candidate'),
    })

    assert.deepEqual(result, { ok: false, active: 'stable', reason: 'smoke failed' })
    assert.equal(currentRelease(runtime), 'stable')
    assert.equal(fs.existsSync(runtime.rollbackLink), false)
  } finally {
    cleanup(runtime)
  }
})

test('restores the previous release when post-activation verification fails', () => {
  const runtime = makeRuntime()
  try {
    const stable = makeRelease(runtime, 'stable')
    const candidate = makeRelease(runtime, 'candidate')
    fs.symlinkSync(stable, runtime.activeLink)
    const calls = []

    const result = activateRelease({
      runtime,
      candidatePath: candidate,
      preflight: () => ({ ok: true }),
      restart: (releaseId) => calls.push(releaseId),
      verify: () => ({ ok: false, reason: 'kiosk smoke timed out' }),
    })

    assert.deepEqual(result, { ok: false, active: 'stable', reason: 'kiosk smoke timed out' })
    assert.equal(currentRelease(runtime), 'stable')
    assert.deepEqual(calls, ['candidate', 'stable'])
    assert.equal(readRuntimeState(runtime).lastUpdate.reason, 'kiosk smoke timed out')
  } finally {
    cleanup(runtime)
  }
})

test('preflight rejects releases missing required metadata and smoke contract', () => {
  const runtime = makeRuntime()
  try {
    const malformed = path.join(runtime.releasesDir, 'malformed')
    fs.mkdirSync(malformed)
    assert.deepEqual(preflightRelease(malformed, { run: () => ({ status: 0 }) }), {
      ok: false,
      reason: 'release metadata is missing',
    })

    const candidate = makeRelease(runtime, 'candidate')
    assert.deepEqual(preflightRelease(candidate, { run: () => ({ status: 1, stderr: 'failed' }) }), {
      ok: false,
      reason: 'release preflight failed',
    })
  } finally {
    cleanup(runtime)
  }
})

test('release preflight rejects a built-in plugin missing schema-versioned manifest metadata', () => {
  const runtime = makeRuntime()
  try {
    const candidate = makeRelease(runtime, 'candidate')
    const renderer = path.join(candidate, 'src', 'renderer')
    const plugins = path.join(renderer, 'plugins')
    fs.mkdirSync(path.join(renderer, 'core'), { recursive: true })
    fs.writeFileSync(path.join(renderer, 'core', 'registry.js'), 'requires manifest schema version 1', 'utf8')
    fs.writeFileSync(path.join(renderer, 'core', 'composer.js'), 'composition', 'utf8')
    fs.mkdirSync(plugins, { recursive: true })
    fs.writeFileSync(path.join(plugins, 'tile.js'), "id: 'odk.tile.clock'", 'utf8')
    fs.writeFileSync(path.join(plugins, 'page.js'), "id: 'odk.page.today', manifest: { schemaVersion: 1 }", 'utf8')
    fs.writeFileSync(path.join(plugins, 'status.js'), "id: 'odk.status.connection', manifest: { schemaVersion: 1 }", 'utf8')
    assert.deepEqual(validateRuntimeComposition(candidate), {
      ok: false,
      reason: 'renderer plugin manifest is missing or unsupported',
    })
  } finally {
    cleanup(runtime)
  }
})

test('user migrations are idempotent and base migration never enables experiments', () => {
  const runtime = makeRuntime()
  try {
    const calls = []
    const migrations = [
      {
        id: '001-runtime-state',
        run: ({ stateDir }) => {
          calls.push('base')
          fs.mkdirSync(stateDir, { recursive: true })
          fs.writeFileSync(path.join(stateDir, 'base-ready'), 'true', 'utf8')
        },
      },
      {
        id: '002-vision-opt-in',
        experimental: true,
        run: () => calls.push('vision'),
      },
    ]

    const first = migrateUser({ runtime, user: 'desk', migrations })
    const second = migrateUser({ runtime, user: 'desk', migrations })

    assert.deepEqual(first, ['001-runtime-state'])
    assert.deepEqual(second, [])
    assert.deepEqual(calls, ['base'])
  } finally {
    cleanup(runtime)
  }
})
