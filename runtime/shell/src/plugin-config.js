'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function resolveConfigPath(env = process.env) {
  const base = env.ODK_CONFIG_DIR || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.config', 'odk')
  return path.join(base, 'plugins.json')
}

function readConfig(configPath, fsModule = fs) {
  let content
  try { content = fsModule.readFileSync(configPath, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, plugins: {} }
    throw error
  }
  return validateConfig(JSON.parse(content))
}

function validateConfig(config) {
  if (!config || config.version !== 1 || !config.plugins || typeof config.plugins !== 'object' || Array.isArray(config.plugins)) {
    throw Error('plugin configuration requires version 1 and a plugins object')
  }
  for (const [id, entry] of Object.entries(config.plugins)) {
    if (!/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) || !entry || typeof entry !== 'object' || Array.isArray(entry)
      || (entry.enabled !== undefined && typeof entry.enabled !== 'boolean')) {
      throw Error(`invalid plugin configuration entry: ${id}`)
    }
    if (entry.development !== undefined) {
      const link = entry.development
      if (!link || typeof link !== 'object' || Array.isArray(link)
        || typeof link.path !== 'string' || !path.isAbsolute(link.path) || link.path.includes('\0')
        || (link.replace !== undefined && typeof link.replace !== 'boolean')
        || (link.host !== undefined && !['electron-main', 'electron-renderer'].includes(link.host))
        || typeof link.trustAcknowledgedAt !== 'string' || !Number.isFinite(Date.parse(link.trustAcknowledgedAt))
        || !Array.isArray(link.grants) || new Set(link.grants).size !== link.grants.length
        || link.grants.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(name))) {
        throw Error(`invalid development plugin configuration: ${id}`)
      }
    }
    if (entry.native !== undefined) {
      if (entry.development !== undefined) throw Error(`conflicting native plugin ownership: ${id}`)
      validateNativeSelection(entry.native)
    }
  }
  return config
}

function validateNativeSelection(selection, history = true) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.keys(selection).some(key => !['revision', 'host', 'replace', 'grants', 'trustAcknowledgedAt', ...(history ? ['previous'] : [])].includes(key))
    || typeof selection.revision !== 'string' || !/^[a-f0-9]{64}$/.test(selection.revision)
    || !['electron-main', 'electron-renderer'].includes(selection.host) || typeof selection.replace !== 'boolean'
    || typeof selection.trustAcknowledgedAt !== 'string' || !Number.isFinite(Date.parse(selection.trustAcknowledgedAt))
    || !Array.isArray(selection.grants) || new Set(selection.grants).size !== selection.grants.length
    || selection.grants.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(name))) throw Error('invalid native plugin selection')
  if (selection.previous !== undefined) validateNativeSelection(selection.previous, false)
}

function updateConfig(configPath, mutate, { fsModule = fs } = {}) {
  fsModule.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 })
  try { configPath = fsModule.realpathSync(configPath) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    try {
      if (fsModule.lstatSync(configPath).isSymbolicLink()) throw Error('plugin configuration symlink target is unavailable')
    } catch (inspectionError) {
      if (inspectionError.code !== 'ENOENT') throw inspectionError
    }
    configPath = path.join(fsModule.realpathSync(path.dirname(configPath)), path.basename(configPath))
  }
  const directory = path.dirname(configPath)
  const lock = `${configPath}.lock`
  try { fsModule.mkdirSync(lock, { mode: 0o700 }) } catch (error) {
    if (error.code === 'EEXIST') throw Error('plugin configuration is busy; retry after its writer finishes')
    throw error
  }
  let staging
  let committed = false
  try {
    const config = readConfig(configPath, fsModule)
    const next = validateConfig(mutate(config) || config)
    staging = fsModule.mkdtempSync(path.join(directory, '.plugins-write-'))
    const candidate = path.join(staging, 'plugins.json')
    fsModule.writeFileSync(candidate, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fsModule.renameSync(candidate, configPath)
    committed = true
    return next
  } finally {
    let cleanupError
    if (staging) {
      try { fsModule.rmSync(staging, { recursive: true, force: true }) } catch (error) { cleanupError = error }
    }
    try { fsModule.rmdirSync(lock) } catch (error) { cleanupError ||= error }
    if (cleanupError) throw Error(`plugin configuration ${committed ? 'saved' : 'not saved'}; temporary cleanup failed`)
  }
}

function writeConfig(configPath, config) {
  return updateConfig(configPath, () => config)
}

function resolveStartupDisabled(env = process.env, report = error => console.error(`plugin configuration unavailable: ${error.message}`), snapshot) {
  const disabled = new Set((env.ODK_DISABLED_PLUGINS || '').split(/[\s,]+/).filter(Boolean))
  try {
    for (const [id, entry] of Object.entries((snapshot || readConfig(resolveConfigPath(env))).plugins)) {
      if (entry.enabled === false) disabled.add(id)
    }
  } catch (error) { report(error) }
  return [...disabled]
}

module.exports = { resolveConfigPath, readConfig, resolveStartupDisabled, updateConfig, writeConfig }
