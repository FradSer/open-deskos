const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const updater = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'update-runtime.js'), 'utf8')
const migrator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate-runtime.js'), 'utf8')
const validator = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'validate-release.js'), 'utf8')
const releaseVerifier = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'verify-release.sh'), 'utf8')
const stageRelease = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-stage-release.sh'), 'utf8')
const installer = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-install.sh'), 'utf8')

test('CM5 staging isolates concurrent development sessions', () => {
  assert.match(stageRelease, /STAGING_ID=/)
  assert.match(stageRelease, /STAGING_DIR=/)
  assert.match(stageRelease, /trap cleanup EXIT/)
  assert.doesNotMatch(stageRelease, /staging\/runtime-linux\//)
  assert.match(stageRelease, /STAGING_ROOT=/)
})

test('CM5 updater serializes transactions and preflights before activating a release', () => {
  assert.match(updater, /openSync\(lockPath, 'wx'\)/)
  assert.match(updater, /preflightRelease/)
  assert.match(updater, /\['pnpm', 'preflight'\], kiosk/)
  assert.match(updater, /activateRelease/)
  assert.match(updater, /post-activation smoke failed/)
  assert.match(updater, /odk-remote-bridge\.service/)
  // Required components are part of the activation transaction: an enabled one is restarted onto
  // the new release and a failure rolls the update back, while a host that has not enabled it keeps
  // the unit staged and stopped.
  assert.match(updater, /restartRequiredService\(releaseId, kiosk, 'odk-personal-agent\.service', 'required Personal Agent component'\)/)
  assert.match(updater, /restartRequiredService\(releaseId, kiosk, 'odk-pi-tasks\.service', 'required Hosted Pi control'\)/)
  // The Open DeskOS Link Service resolves the Hosted Pi endpoint from the descriptor the daemon publishes,
  // so it has to be restarted onto the active release too — under the same enabled gate, and without
  // rolling back an activation that otherwise succeeded.
  assert.match(updater, /restartRequiredService\(releaseId, kiosk, 'odk-link\.service', 'Open DeskOS Link service'\)/)
  assert.match(updater, /Open DeskOS Link restart did not complete/)
  assert.match(updater, /is-enabled/)
  assert.match(updater, /required Personal Agent component restart failed|\$\{component\} restart failed/)
  assert.match(updater, /odk-shell\.service/)
  assert.match(updater, /ODK_KIOSK_USER/)
  assert.match(updater, /ODK_RUNTIME_ROOT=\$\{releasePath\}/)
  assert.match(updater, /ODK_KIOSK_UID/)
  assert.match(updater, /ODK_KIOSK_HOME/)
  assert.match(updater, /ODK_KIOSK_NODE_BIN/)
  assert.match(updater, /ODK_KIOSK_BIN_DIR/)
  assert.match(updater, /COREPACK_ENABLE_PROJECT_SPEC=1/)
  assert.match(installer, /COREPACK_ENABLE_PROJECT_SPEC=1/)
  // The runtime release declares the pnpm that produced its lockfile, and both install and
  // activation honor that declaration instead of whatever Corepack resolves by default.
  const runtimeManifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert.equal(runtimeManifest.packageManager, 'pnpm@11.22.0')
  assert.match(updater, /runtime update must run as root/)
  assert.match(updater, /function sealRelease/)
  assert.match(updater, /chown', \['-R', 'root:root'/)
  assert.match(updater, /chmod', \['-R', 'a-w'/)
  assert.match(updater, /\['pnpm', 'preflight'\], kiosk/)
  assert.match(updater, /\['bash', 'scripts\/verify-release\.sh'\], kiosk/)
  // The sealed release cannot relink command shims, so the smoke never runs through pnpm.
  assert.doesNotMatch(updater, /\['pnpm', 'verify-release'\]/)
})

test('device preflight inherits the kiosk graphical session instead of ambient SSH environment', () => {
  assert.match(updater, /ODK_KIOSK_DISPLAY/)
  assert.match(updater, /ODK_KIOSK_XAUTHORITY/)
  assert.match(updater, /DBUS_SESSION_BUS_ADDRESS=unix:path=\/run\/user\/\$\{runAs\.uid\}\/bus/)
  assert.match(updater, /DISPLAY=\$\{/)
  assert.match(updater, /XAUTHORITY=\$\{/)
  assert.match(installer, /ODK_KIOSK_DISPLAY="\$\{GRAPHICAL_DISPLAY:-\}"/)
  assert.match(installer, /ODK_KIOSK_XAUTHORITY/)
})

test('kiosk identity retains names while resolving only filesystem paths', () => {
  assert.match(updater, /function requiredValue\(name\)/)
  assert.match(updater, /const user = requiredValue\('ODK_KIOSK_USER'\)/)
  assert.match(updater, /const home = requiredValue\('ODK_KIOSK_HOME'\)/)
  assert.doesNotMatch(updater, /const user = requiredEnv\('ODK_KIOSK_USER'\)/)
})

test('immutable runtime smoke can skip generated stylesheet writes', () => {
  const launcher = fs.readFileSync(path.join(__dirname, '..', 'run.sh'), 'utf8')
  const packageManifest = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  assert.match(launcher, /ODK_SKIP_STYLE_BUILD/)
  assert.match(packageManifest, /bash scripts\/verify-release\.sh/)
  assert.equal(JSON.parse(packageManifest).scripts['verify-release'], 'bash scripts/verify-release.sh')
  assert.match(releaseVerifier, /ODK_SKIP_STYLE_BUILD=1 \.\/run\.sh --smoke/)
  assert.match(releaseVerifier, /loginctl show-session/)
  assert.match(releaseVerifier, /SESSION_DISPLAY/)
  assert.match(releaseVerifier, /xvfb-run/)
})

test('CM5 staging command delegates release construction and verification to the device', () => {
  assert.match(stageRelease, /ODK_CM5_TARGET:-cm5/)
  assert.match(stageRelease, /mkdir -p '\$\{STAGING_ROOT\}\/runtime\/shell'.*'\$\{STAGING_ROOT\}\/\.agents'.*'\$\{REMOTE_ROOT\}\/releases' '\$\{REMOTE_ROOT\}\/state'/)
  assert.match(stageRelease, /rsync -a --delete --exclude node_modules/)
  assert.match(stageRelease, /"\$\{ROOT\}\/integrations\/" "\$\{TARGET\}:\$\{STAGING_ROOT\}\/integrations\/"/)
  assert.match(stageRelease, /"\$\{ROOT\}\/experiments\/" "\$\{TARGET\}:\$\{STAGING_ROOT\}\/experiments\/"/)
  assert.match(stageRelease, /"\$\{ROOT\}\/peripherals\/" "\$\{TARGET\}:\$\{STAGING_ROOT\}\/peripherals\/"/)
  assert.match(stageRelease, /"\$\{ROOT\}\/\.agents\/" "\$\{TARGET\}:\$\{STAGING_ROOT\}\/\.agents\/"/)
  assert.match(stageRelease, /ssh "\$\{TARGET\}" "cd '\$\{STAGING_ROOT\}\/runtime\/shell' && bash scripts\/cm5-install\.sh"/)
})

test('CM5 staging seals Android boundary inputs without build outputs', () => {
  assert.ok(stageRelease.includes('"${ROOT}/runtime/android/app/src/main/"'))
  assert.ok(stageRelease.includes('"${TARGET}:${STAGING_ROOT}/runtime/android/app/src/main/"'))
  assert.ok(installer.includes('"${REPOSITORY_ROOT}/runtime/android/app/src/main"'))
  assert.ok(installer.includes('"${RELEASE_DIR}/android/app/src/main"'))
})

test('release validator fails closed when packaged composition is invalid', () => {
  assert.match(validator, /validateRuntimeComposition/)
  assert.match(validator, /release path is required/)
  assert.match(validator, /release validation failed/)
})

test('CM5 migration CLI is user-scoped and does not enable experiments', () => {
  assert.match(migrator, /ODK_KIOSK_USER/)
  assert.match(migrator, /migrateUser/)
  assert.doesNotMatch(migrator, /experimental:\s*true/)
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cm5-install.sh'), 'utf8'), /ODK_KIOSK_UID="\$\{TARGET_UID\}"/)
})

test('updater gives complete preflight one hour while post-activation verification stays at 60 seconds', () => {
  const vm = require('node:vm')
  const commands = []
  const candidate = '/runtime/releases/candidate'
  const fakeProcess = { getuid: () => 0, env: {
    ODK_RUNTIME_ROOT: '/runtime', ODK_CANDIDATE_RELEASE: candidate,
    ODK_KIOSK_USER: 'kiosk', ODK_KIOSK_UID: '1000', ODK_KIOSK_HOME: '/home/kiosk',
    ODK_KIOSK_NODE_BIN: '/node/bin', ODK_KIOSK_BIN_DIR: '/kiosk/bin',
  } }
  const modules = {
    'node:fs': {
      mkdirSync() {}, openSync: () => 1, writeFileSync() {}, closeSync() {}, rmSync() {},
      existsSync: () => true, realpathSync: () => candidate,
    },
    'node:path': path,
    'node:child_process': { spawnSync: (file, args, options) => {
      commands.push({ file, args: Array.from(args), options })
      return { status: 0 }
    } },
    './lib/runtime-release': {
      validateRuntimeComposition: () => ({ ok: true }),
      preflightRelease: (target, { run }) => ({ ok: run(target).status === 0 }),
      activateRelease: ({ candidatePath, preflight, verify }) => {
        const checked = preflight(candidatePath)
        return checked.ok ? verify('candidate') : checked
      },
      readRuntimeState: () => ({}),
    },
  }
  const context = vm.createContext({ process: fakeProcess, console: { log() {}, error(message) { assert.fail(message) } },
    require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name] } })
  vm.runInContext(updater, context)
  assert.equal(fakeProcess.exitCode, 0)
  const supervised = commands.filter(command => command.file === 'timeout')
  assert.equal(supervised.length, 2, 'preflight and post-activation verification each run once')
  assert.deepEqual(supervised[0].args.slice(0, 3), ['--signal=KILL', '3600s', 'runuser'])
  assert.deepEqual(supervised[0].args.slice(-2), ['pnpm', 'preflight'])
  assert.deepEqual(supervised[1].args.slice(0, 3), ['--signal=KILL', '60s', 'runuser'])
  assert.deepEqual(supervised[1].args.slice(-2), ['bash', 'scripts/verify-release.sh'])
  for (const command of supervised) assert.equal(command.options.cwd, candidate)
})

function gnuTimeoutUnavailableReason() {
  const { spawnSync } = require('node:child_process')
  const probe = spawnSync('timeout', ['--version'], {
    encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL',
  })
  return probe.status === 0 && /GNU coreutils/.test(probe.stdout)
    ? false : 'The CM5 process regression requires GNU coreutils timeout on PATH'
}

test('stalled verifier fails, rolls back, and releases its lock without leaving its child running', {
  skip: require('./not-ported').posixOnlyReason('cm5-tooling') || gnuTimeoutUnavailableReason(),
}, async () => {
  const os = require('node:os')
  const vm = require('node:vm')
  const { spawnSync } = require('node:child_process')
  const { activateRelease, readRuntimeState } = require('../scripts/lib/runtime-release')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-bounded-verify-'))
  const context = vm.createContext({ fs, path, process, spawnSync })
  vm.runInContext(updater.slice(updater.indexOf('function runtimePaths('), updater.indexOf('function restartUserService(')), context)
  const runtime = context.runtimePaths(root)
  const stable = path.join(root, 'releases', 'stable')
  const candidate = path.join(root, 'releases', 'candidate')
  fs.mkdirSync(stable, { recursive: true })
  fs.mkdirSync(candidate, { recursive: true })
  fs.symlinkSync(stable, runtime.activeLink)
  const marker = path.join(root, 'surviving-child')
  const ready = path.join(root, 'child-ready')
  const parentReady = path.join(root, 'parent-ready')
  const parentMarker = path.join(root, 'surviving-parent')
  // Both processes terminate themselves even against the broken updater, so RED cannot hang the suite.
  const child = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 2000); setTimeout(() => process.exit(0), 2500)`
  const fixture = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(parentReady)}, 'ready'); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(parentMarker)}, 'alive'), 2000); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'inherit'}); setTimeout(() => process.exit(0), 3000)`
  let verifications = 0
  const restarted = []
  try {
    const started = Date.now()
    const result = context.withLock(runtime.lockPath, () => activateRelease({
      runtime, candidatePath: candidate,
      preflight: () => ({ ok: true }),
      restart: id => { restarted.push(id); return { ok: true } },
      verify: () => {
        verifications++
        const command = context.runReleaseCommand(candidate, [process.execPath, '-e', fixture], null, 1)
        return { ok: command.status === 0, reason: 'post-activation smoke failed' }
      },
    }))
    assert.equal(result.ok, false)
    assert.ok(Date.now() - started < 2500, 'the command deadline must terminate a SIGTERM-resistant verifier')
    assert.equal(verifications, 1)
    assert.deepEqual(restarted, ['candidate', 'stable'])
    assert.equal(fs.realpathSync(runtime.activeLink), fs.realpathSync(stable))
    assert.equal(fs.existsSync(parentReady), true, 'the SIGTERM-resistant parent started before the deadline')
    assert.equal(fs.existsSync(ready), true, 'the SIGTERM-resistant child started before the deadline')
    assert.equal(readRuntimeState(runtime).lastUpdate.ok, false)
    assert.equal(fs.existsSync(runtime.lockPath), false)
    await new Promise(resolve => setTimeout(resolve, 2100))
    assert.equal(fs.existsSync(parentMarker), false, 'the deadline must terminate the owned parent')
    assert.equal(fs.existsSync(marker), false, 'the deadline must also terminate the owned child')
    assert.equal(context.runReleaseCommand(candidate, [process.execPath, '-e', 'process.exit(7)'], null, 2).status, 7)
    assert.equal(context.runReleaseCommand(candidate, [process.execPath, '-e', ''], null, 2).status, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('release command supervision encloses runuser and fails closed when timeout cannot start', () => {
  const vm = require('node:vm')
  const calls = []
  const context = vm.createContext({
    process,
    spawnSync: (...args) => { calls.push(args); return { status: null, error: new Error('unavailable') } },
  })
  vm.runInContext(updater.slice(updater.indexOf('function runReleaseCommand('), updater.indexOf('function restartUserService(')), context)
  const result = context.runReleaseCommand('/candidate', ['bash', 'scripts/verify-release.sh'], {
    user: 'kiosk', uid: '1000', home: '/home/kiosk', nodeBin: '/node/bin', binDir: '/kiosk/bin', display: ':0',
  })
  assert.equal(result.status, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'timeout')
  assert.deepEqual(Array.from(calls[0][1].slice(0, 7)), ['--signal=KILL', '60s', 'runuser', '-u', 'kiosk', '--', 'env'])
  assert.ok(calls[0][1].includes('DISPLAY=:0'))
  assert.equal(calls[0][2].cwd, '/candidate')
})
