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

// A release is only complete when the runtime's required components are inside it: the renderer
// composition contract plus the voice integration with its service units and installed production
// dependencies.
function makeCompleteRelease(runtime, id) {
  const release = makeRelease(runtime, id)
  const renderer = path.join(release, 'src', 'renderer')
  fs.mkdirSync(path.join(renderer, 'core'), { recursive: true })
  fs.mkdirSync(path.join(renderer, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(renderer, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(renderer, 'core', 'registry.js'), 'requires manifest schema version 1')
  fs.writeFileSync(path.join(renderer, 'core', 'composer.js'), 'composition')
  for (const kind of ['page', 'tile', 'status']) {
    fs.writeFileSync(path.join(renderer, 'plugins', `${kind}.js`), `id: 'odk.${kind}.test', manifest: { schemaVersion: 1 }`)
  }
  const integration = path.join(release, 'integrations', 'voice-agent')
  fs.mkdirSync(path.join(integration, 'src'), { recursive: true })
  fs.mkdirSync(path.join(integration, 'systemd'), { recursive: true })
  fs.mkdirSync(path.join(integration, 'node_modules'))
  fs.writeFileSync(path.join(integration, 'package.json'), '{}')
  fs.writeFileSync(path.join(integration, 'src', 'main.mjs'), 'entry')
  fs.writeFileSync(path.join(integration, 'systemd', 'open-deskos-voice-agent.service'), 'unit')
  fs.writeFileSync(path.join(integration, 'systemd', 'open-deskos-pi-tasks.service'), 'unit')
  return release
}

function makeRenderer(release) {
  const renderer = path.join(release, 'src', 'renderer')
  fs.mkdirSync(path.join(renderer, 'core'), { recursive: true })
  fs.mkdirSync(path.join(renderer, 'plugins'), { recursive: true })
  fs.writeFileSync(path.join(renderer, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(renderer, 'core', 'registry.js'), 'requires manifest schema version 1')
  fs.writeFileSync(path.join(renderer, 'core', 'composer.js'), 'composition')
  for (const kind of ['page', 'tile', 'status']) {
    fs.writeFileSync(path.join(renderer, 'plugins', `${kind}.js`), `id: 'odk.${kind}.test', manifest: { schemaVersion: 1 }`)
  }
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

test('renderer browser dependencies must exist inside the candidate release', (t) => {
  const runtime = makeRuntime()
  t.after(() => cleanup(runtime))
  const candidate = makeCompleteRelease(runtime, 'candidate')
  const renderer = path.join(candidate, 'src', 'renderer')
  const bundle = path.join(candidate, 'node_modules', 'markdown-it', 'dist', 'browser', 'markdown-it.umd.min.js')
  fs.writeFileSync(path.join(renderer, 'index.html'), '<script src="../../node_modules/markdown-it/dist/browser/markdown-it.umd.min.js"></script>')
  assert.deepEqual(validateRuntimeComposition(candidate), { ok: false, reason: 'renderer script is missing or outside the candidate release' })
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  const outside = path.join(runtime.root, 'outside.js')
  fs.writeFileSync(outside, 'browser bundle')
  fs.symlinkSync(outside, bundle)
  assert.equal(validateRuntimeComposition(candidate).ok, false)
  fs.unlinkSync(bundle)
  fs.writeFileSync(bundle, 'browser bundle')
  assert.deepEqual(validateRuntimeComposition(candidate), { ok: true })
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

test('reclaims releases that neither the active nor the rollback pointer references', () => {
  const runtime = makeRuntime()
  try {
    const oldest = makeRelease(runtime, 'oldest')
    const previous = makeRelease(runtime, 'previous')
    const stable = makeRelease(runtime, 'stable')
    const candidate = makeRelease(runtime, 'candidate')
    fs.symlinkSync(stable, runtime.activeLink)
    fs.symlinkSync(previous, runtime.rollbackLink)
    const unrelated = path.join(runtime.releasesDir, 'not-a-release')
    fs.mkdirSync(unrelated)

    const result = activateRelease({
      runtime,
      candidatePath: candidate,
      preflight: (releasePath) => preflightRelease(releasePath, { run: () => ({ status: 0 }) }),
      restart: () => ({ ok: true }),
      verify: () => ({ ok: true }),
    })

    assert.equal(result.ok, true)
    assert.deepEqual(result.pruned.sort(), ['oldest', 'previous'])
    assert.equal(currentRelease(runtime), 'candidate')
    assert.equal(path.basename(fs.realpathSync(runtime.rollbackLink)), 'stable')
    assert.ok(fs.existsSync(candidate), 'the active release survives')
    assert.ok(fs.existsSync(stable), 'the rollback release survives even though it is not the newest')
    assert.ok(fs.existsSync(unrelated), 'a non-release directory under releases/ is left alone')
    assert.equal(fs.existsSync(oldest), false)
    assert.equal(fs.existsSync(previous), false)
  } finally {
    cleanup(runtime)
  }
})

test('a failed activation reclaims nothing so its candidate stays inspectable', () => {
  const runtime = makeRuntime()
  try {
    const oldest = makeRelease(runtime, 'oldest')
    const stable = makeRelease(runtime, 'stable')
    const candidate = makeRelease(runtime, 'candidate')
    fs.symlinkSync(stable, runtime.activeLink)

    const result = activateRelease({
      runtime,
      candidatePath: candidate,
      preflight: (releasePath) => preflightRelease(releasePath, { run: () => ({ status: 0 }) }),
      restart: () => ({ ok: true }),
      verify: () => ({ ok: false, reason: 'post-activation smoke failed' }),
    })

    assert.equal(result.ok, false)
    assert.equal(result.pruned, undefined)
    assert.equal(currentRelease(runtime), 'stable')
    for (const release of [oldest, stable, candidate]) assert.ok(fs.existsSync(release), release)
  } finally {
    cleanup(runtime)
  }
})

test('a candidate carrying the required voice and Hosted Pi components validates', () => {
  const runtime = makeRuntime()
  try {
    const candidate = makeCompleteRelease(runtime, 'candidate')
    assert.deepEqual(validateRuntimeComposition(candidate), { ok: true })
  } finally {
    cleanup(runtime)
  }
})

test('a candidate missing the required voice integration is rejected', () => {
  const runtime = makeRuntime()
  try {
    const candidate = makeRelease(runtime, 'candidate')
    makeRenderer(candidate)
    assert.deepEqual(validateRuntimeComposition(candidate), {
      ok: false,
      reason: 'required voice integration is missing',
    })
  } finally {
    cleanup(runtime)
  }
})

test('a candidate missing the required Hosted Pi control service is rejected', () => {
  const runtime = makeRuntime()
  try {
    const candidate = makeCompleteRelease(runtime, 'candidate')
    fs.rmSync(path.join(candidate, 'integrations', 'voice-agent', 'systemd', 'open-deskos-pi-tasks.service'))
    assert.deepEqual(validateRuntimeComposition(candidate), {
      ok: false,
      reason: 'required Hosted Pi control service is missing',
    })
  } finally {
    cleanup(runtime)
  }
})

test('required voice dependencies outside the candidate are rejected', () => {
  const runtime = makeRuntime()
  try {
    const candidate = makeCompleteRelease(runtime, 'candidate')
    const modules = path.join(candidate, 'integrations', 'voice-agent', 'node_modules')
    fs.rmSync(modules, { recursive: true, force: true })
    const outside = path.join(runtime.root, 'ambient-voice-modules')
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, modules)
    assert.deepEqual(validateRuntimeComposition(candidate), {
      ok: false,
      reason: 'required voice dependencies are missing or outside the candidate release',
    })
  } finally {
    cleanup(runtime)
  }
})

test('a candidate missing a required component records it and leaves the active release unchanged', () => {
  const runtime = makeRuntime()
  try {
    const stable = makeCompleteRelease(runtime, 'stable')
    const candidate = makeRelease(runtime, 'candidate')
    makeRenderer(candidate)
    fs.symlinkSync(stable, runtime.activeLink)

    const result = activateRelease({
      runtime,
      candidatePath: candidate,
      preflight: (releasePath) => validateRuntimeComposition(releasePath),
      restart: () => ({ ok: true }),
      verify: () => ({ ok: true }),
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'required voice integration is missing')
    assert.equal(currentRelease(runtime), 'stable')
    assert.equal(readRuntimeState(runtime).lastUpdate.reason, 'required voice integration is missing')
  } finally {
    cleanup(runtime)
  }
})

