const fs = require('node:fs')
const path = require('node:path')

const RUNTIME_STATE_FILE = 'runtime-state.json'

function releaseId(releasePath) {
  return path.basename(fs.realpathSync(releasePath))
}

function resolveLink(linkPath) {
  if (!fs.existsSync(linkPath)) return null
  return fs.realpathSync(linkPath)
}

function currentRelease(runtime) {
  const current = resolveLink(runtime.activeLink)
  return current ? releaseId(current) : null
}

function ensureStateDir(runtime) {
  fs.mkdirSync(runtime.stateDir, { recursive: true })
}

function statePath(runtime) {
  return path.join(runtime.stateDir, RUNTIME_STATE_FILE)
}

function readRuntimeState(runtime) {
  const stateFile = statePath(runtime)
  if (!fs.existsSync(stateFile)) {
    return { active: currentRelease(runtime), rollback: null, lastUpdate: null }
  }
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
}

function writeRuntimeState(runtime, state) {
  ensureStateDir(runtime)
  const target = statePath(runtime)
  const temporary = `${target}.tmp-${process.pid}`
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, 'utf8')
  fs.renameSync(temporary, target)
}

function replaceLink(linkPath, target) {
  const temporary = `${linkPath}.tmp-${process.pid}`
  fs.rmSync(temporary, { force: true })
  fs.symlinkSync(target, temporary)
  fs.renameSync(temporary, linkPath)
}

function validateMetadata(releasePath) {
  const metadataPath = path.join(releasePath, 'release.json')
  if (!fs.existsSync(metadataPath)) return { ok: false, reason: 'release metadata is missing' }
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    if (metadata.schemaVersion !== 1 || typeof metadata.id !== 'string' || !metadata.id) {
      return { ok: false, reason: 'release metadata is invalid' }
    }
    if (metadata.id !== path.basename(releasePath)) return { ok: false, reason: 'release metadata id does not match directory' }
  } catch {
    return { ok: false, reason: 'release metadata is invalid' }
  }
  if (!fs.existsSync(path.join(releasePath, 'package.json'))) return { ok: false, reason: 'release package metadata is missing' }
  return { ok: true }
}

function preflightRelease(releasePath, { run }) {
  const metadata = validateMetadata(releasePath)
  if (!metadata.ok) return metadata
  const validation = run(releasePath)
  if (validation.status !== 0) return { ok: false, reason: 'release preflight failed' }
  return { ok: true }
}

function activateRelease({ runtime, candidatePath, preflight, restart, verify }) {
  ensureStateDir(runtime)
  const activePath = resolveLink(runtime.activeLink)
  const active = activePath ? releaseId(activePath) : null
  const preflightResult = preflight(candidatePath)
  if (!preflightResult.ok) {
    writeRuntimeState(runtime, {
      active,
      rollback: resolveLink(runtime.rollbackLink) ? releaseId(resolveLink(runtime.rollbackLink)) : null,
      lastUpdate: { ok: false, release: releaseId(candidatePath), reason: preflightResult.reason },
    })
    return { ok: false, active, reason: preflightResult.reason }
  }

  if (activePath) replaceLink(runtime.rollbackLink, activePath)
  replaceLink(runtime.activeLink, candidatePath)
  const candidate = releaseId(candidatePath)
  const restarted = restart(candidate)
  const verified = restarted?.ok === false
    ? { ok: false, reason: restarted.reason || 'kiosk restart failed' }
    : verify(candidate)
  if (verified.ok) {
    writeRuntimeState(runtime, {
      active: candidate,
      rollback: active,
      lastUpdate: { ok: true, release: candidate, reason: null },
    })
    return { ok: true, active: candidate }
  }

  if (activePath) {
    replaceLink(runtime.activeLink, activePath)
    restart(active)
  }
  writeRuntimeState(runtime, {
    active,
    rollback: active,
    lastUpdate: { ok: false, release: candidate, reason: verified.reason || 'post-activation verification failed' },
  })
  return { ok: false, active, reason: verified.reason || 'post-activation verification failed' }
}

function migrationMarker(runtime, user, migrationId) {
  return path.join(runtime.stateDir, 'migrations', user, `${migrationId}.done`)
}

function validateRuntimeComposition(releasePath) {
  const registryPath = path.join(releasePath, 'src', 'renderer', 'core', 'registry.js')
  const composerPath = path.join(releasePath, 'src', 'renderer', 'core', 'composer.js')
  if (!fs.existsSync(registryPath) || !fs.existsSync(composerPath)) {
    return { ok: false, reason: 'renderer composition contract is missing' }
  }
  const registrySource = fs.readFileSync(registryPath, 'utf8')
  if (!registrySource.includes('requires manifest schema version 1')) {
    return { ok: false, reason: 'renderer plugin manifest validation is missing' }
  }
  const pluginDirectory = path.join(releasePath, 'src', 'renderer', 'plugins')
  if (!fs.existsSync(pluginDirectory)) return { ok: false, reason: 'renderer plugin directory is missing' }
  const pluginSources = fs.readdirSync(pluginDirectory)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(pluginDirectory, name), 'utf8'))
  if (pluginSources.length === 0) return { ok: false, reason: 'renderer plugins are missing' }
  for (const source of pluginSources) {
    if (!/manifest:\s*\{\s*schemaVersion:\s*1\s*\}/.test(source)) {
      return { ok: false, reason: 'renderer plugin manifest is missing or unsupported' }
    }
  }
  if (!pluginSources.some((source) => /id:\s*['"]odk\.page\./.test(source))
    || !pluginSources.some((source) => /id:\s*['"]odk\.tile\./.test(source))
    || !pluginSources.some((source) => /id:\s*['"]odk\.status\./.test(source))) {
    return { ok: false, reason: 'renderer plugin identities are incomplete' }
  }
  return { ok: true }
}

function migrateUser({ runtime, user, migrations, experimental = false }) {
  const completed = []
  for (const migration of migrations) {
    if (migration.experimental && !experimental) continue
    const marker = migrationMarker(runtime, user, migration.id)
    if (fs.existsSync(marker)) continue
    migration.run({ runtime, stateDir: runtime.stateDir, user })
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, 'done\n', 'utf8')
    completed.push(migration.id)
  }
  return completed
}

module.exports = {
  activateRelease,
  currentRelease,
  migrateUser,
  preflightRelease,
  readRuntimeState,
  validateMetadata,
  validateRuntimeComposition,
}
