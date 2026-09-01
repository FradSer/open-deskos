#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const {
  activateRelease,
  preflightRelease,
  readRuntimeState,
  validateRuntimeComposition,
} = require('./lib/runtime-release')

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return path.resolve(value)
}

function requiredValue(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function runtimePaths(root) {
  const stateDir = path.join(root, 'state')
  return {
    root,
    stateDir,
    releasesDir: path.join(root, 'releases'),
    activeLink: path.join(root, 'current'),
    rollbackLink: path.join(root, 'previous'),
    lockPath: path.join(stateDir, 'update.lock'),
  }
}

function withLock(lockPath, work) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true })
  let fd
  try {
    fd = fs.openSync(lockPath, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') return { ok: false, reason: 'another update transaction is running' }
    throw error
  }
  try {
    fs.writeFileSync(fd, `${process.pid}\n`, 'utf8')
    return work()
  } finally {
    fs.closeSync(fd)
    fs.rmSync(lockPath, { force: true })
  }
}

function runReleaseCommand(releasePath, command, runAs = null) {
  const [file, ...args] = command
  const executable = runAs ? 'runuser' : file
  const executableArgs = runAs
    ? ['-u', runAs.user, '--', 'env', `HOME=${runAs.home}`, `XDG_RUNTIME_DIR=/run/user/${runAs.uid}`, `PATH=${runAs.binDir}:${runAs.nodeBin}:/usr/local/bin:/usr/bin:/bin`, 'COREPACK_ENABLE_PROJECT_SPEC=0', file, ...args]
    : args
  const result = spawnSync(executable, executableArgs, {
    cwd: releasePath,
    stdio: 'inherit',
    env: { ...process.env, ODK_RELEASE_PATH: releasePath },
  })
  return { status: result.status ?? 1 }
}

function restartUserService(user, uid, home, unit) {
  return spawnSync('runuser', ['-u', user, '--', 'env',
    `HOME=${home}`,
    `XDG_RUNTIME_DIR=/run/user/${uid}`,
    `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,
    'systemctl', '--user', 'restart', unit,
  ], { stdio: 'inherit' })
}

function restartServices(releaseId, kiosk) {
  const kioskResult = restartUserService(kiosk.user, kiosk.uid, kiosk.home, 'open-deskos-shell.service')
  if (kioskResult.status !== 0) return { ok: false, reason: `kiosk service restart failed for ${releaseId}` }

  const bridgeResult = restartUserService(kiosk.user, kiosk.uid, kiosk.home, 'open-deskos-remote-bridge.service')
  if (bridgeResult.status !== 0) {
    console.error('Remote Bridge restart did not complete; the base shell remains independently usable.')
  }
  return { ok: true }
}

function kioskIdentity() {
  const user = requiredValue('ODK_KIOSK_USER')
  const uid = requiredValue('ODK_KIOSK_UID')
  const home = requiredValue('ODK_KIOSK_HOME')
  const nodeBin = requiredValue('ODK_KIOSK_NODE_BIN')
  const binDir = requiredValue('ODK_KIOSK_BIN_DIR')
  return { user, uid, home, nodeBin, binDir }
}

function sealRelease(releasePath) {
  const result = spawnSync('chown', ['-R', 'root:root', releasePath], { stdio: 'inherit' })
  if (result.status !== 0) return { ok: false, reason: 'could not assign release ownership to root' }
  const sealed = spawnSync('chmod', ['-R', 'a-w', releasePath], { stdio: 'inherit' })
  return sealed.status === 0 ? { ok: true } : { ok: false, reason: 'could not seal release files' }
}

function main() {
  if (process.getuid?.() !== 0) throw new Error('runtime update must run as root to switch immutable release pointers')
  const root = requiredEnv('ODK_RUNTIME_ROOT')
  const candidatePath = requiredEnv('ODK_CANDIDATE_RELEASE')
  const kiosk = kioskIdentity()
  const runtime = runtimePaths(root)
  const result = withLock(runtime.lockPath, () => activateRelease({
    runtime,
    candidatePath,
    preflight: (releasePath) => {
      const composition = validateRuntimeComposition(releasePath)
      if (!composition.ok) return composition
      const preflight = preflightRelease(releasePath, {
        run: (target) => runReleaseCommand(target, ['pnpm', 'preflight'], kiosk),
      })
      return preflight.ok ? sealRelease(releasePath) : preflight
    },
    restart: (releaseId) => restartServices(releaseId, kiosk),
    verify: (releaseId) => {
      const active = path.resolve(root, 'current')
      if (!fs.existsSync(active) || path.basename(fs.realpathSync(active)) !== releaseId) {
        return { ok: false, reason: 'active release pointer did not resolve to candidate' }
      }
      const releasePath = fs.realpathSync(active)
      const smoke = runReleaseCommand(releasePath, ['pnpm', 'verify-release'], kiosk)
      return smoke.status === 0 ? { ok: true } : { ok: false, reason: 'post-activation smoke failed' }
    },
  }))
  console.log(JSON.stringify({ ...result, state: readRuntimeState(runtime) }))
  process.exitCode = result.ok ? 0 : 1
}

try {
  main()
} catch (error) {
  console.error(`Open DeskOS update failed: ${error.message}`)
  process.exitCode = 1
}
