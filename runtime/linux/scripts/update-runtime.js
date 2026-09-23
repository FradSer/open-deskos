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

function optionalValue(name) {
  const value = process.env[name]
  return value || null
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
  const sessionDisplay = runAs && runAs.display ? [`DISPLAY=${runAs.display}`] : []
  const sessionAuthority = runAs && runAs.xauthority ? [`XAUTHORITY=${runAs.xauthority}`] : []
  // Release commands run the pnpm the release declares (COREPACK_ENABLE_PROJECT_SPEC=1), so a
  // change to Corepack's default version cannot silently change how a release is built or run.
  const executableArgs = runAs
    ? ['-u', runAs.user, '--', 'env', `HOME=${runAs.home}`, `XDG_RUNTIME_DIR=/run/user/${runAs.uid}`, `PATH=${runAs.binDir}:${runAs.nodeBin}:/usr/local/bin:/usr/bin:/bin`, 'COREPACK_ENABLE_PROJECT_SPEC=1', ...sessionDisplay, ...sessionAuthority, file, ...args]
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

function isUnitEnabled(user, uid, home, unit) {
  const result = spawnSync('runuser', ['-u', user, '--', 'env',
    `HOME=${home}`,
    `XDG_RUNTIME_DIR=/run/user/${uid}`,
    'systemctl', '--user', 'is-enabled', unit,
  ], { stdio: 'ignore' })
  return result.status === 0
}

// A required component is restarted only where the host has enabled it. A host that has not created
// its device-local configuration keeps the unit staged and stopped, so it is not rolled back for a
// service it does not run; once enabled, a failure to restart fails the update transaction.
function restartRequiredService(releaseId, kiosk, unit, component) {
  if (!isUnitEnabled(kiosk.user, kiosk.uid, kiosk.home, unit)) return { ok: true }
  const result = restartUserService(kiosk.user, kiosk.uid, kiosk.home, unit)
  return result.status === 0 ? { ok: true } : { ok: false, reason: `${component} restart failed for ${releaseId}` }
}

function restartServices(releaseId, kiosk) {
  const kioskResult = restartUserService(kiosk.user, kiosk.uid, kiosk.home, 'open-deskos-shell.service')
  if (kioskResult.status !== 0) return { ok: false, reason: `kiosk service restart failed for ${releaseId}` }

  const bridgeResult = restartUserService(kiosk.user, kiosk.uid, kiosk.home, 'open-deskos-remote-bridge.service')
  if (bridgeResult.status !== 0) {
    console.error('Remote Bridge restart did not complete; the base shell remains independently usable.')
  }

  // The Desk Link Service resolves the Hosted Pi endpoint through the descriptor the daemon
  // publishes, so it must run the release that is now active instead of the previous one. Like the
  // Remote Bridge it is peripheral to the base shell and to voice, so a failed restart is reported
  // rather than rolling back an activation that otherwise succeeded.
  const linkResult = restartRequiredService(releaseId, kiosk, 'open-deskos-desk-link.service', 'desk link service')
  if (linkResult.ok === false) {
    console.error('Desk Link restart did not complete; restart it to run the active release, and the desk keeps reporting either way.')
  }

  const voiceResult = restartRequiredService(releaseId, kiosk, 'open-deskos-voice-agent.service', 'required voice component')
  if (voiceResult.ok === false) return voiceResult
  const tasksResult = restartRequiredService(releaseId, kiosk, 'open-deskos-pi-tasks.service', 'required Hosted Pi control')
  if (tasksResult.ok === false) return tasksResult
  return { ok: true }
}

function kioskIdentity() {
  const user = requiredValue('ODK_KIOSK_USER')
  const uid = requiredValue('ODK_KIOSK_UID')
  const home = requiredValue('ODK_KIOSK_HOME')
  const nodeBin = requiredValue('ODK_KIOSK_NODE_BIN')
  const binDir = requiredValue('ODK_KIOSK_BIN_DIR')
  const display = optionalValue('ODK_KIOSK_DISPLAY')
  const xauthority = optionalValue('ODK_KIOSK_XAUTHORITY')
  return { user, uid, home, nodeBin, binDir, display, xauthority }
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
      // Run the smoke script directly instead of through pnpm: the activated release is sealed
      // root-owned and read-only, and pnpm's install-before-run pass cannot relink its command
      // shims there (ERR_PNPM_CMD_SHIM_CHMOD), which would fail every activation.
      const smoke = runReleaseCommand(releasePath, ['bash', 'scripts/verify-release.sh'], kiosk)
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
