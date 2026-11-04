/**
 * One owner-owned file controls which sources Overview must show and which
 * sources may never disclose their contents. Preferences select facts only;
 * every displayed value stays bound to a current local reading.
 */
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DEFAULT_OVERVIEW_PREFERENCES = Object.freeze({
  version: 1,
  mustShow: Object.freeze([]),
  privateSources: Object.freeze(['odk.app.pi-sessions']),
})

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const MAX_RULES = 32
const MAX_FILE_BYTES = 8192

export function overviewPreferencesPath(env = process.env, platform = process.platform) {
  if (env.ODK_OVERVIEW_PREFERENCES_FILE) return env.ODK_OVERVIEW_PREFERENCES_FILE
  const root = platform === 'win32'
    ? join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'odk')
    : join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'odk')
  return join(root, 'overview-preferences.json')
}

function ids(value, name) {
  if (!Array.isArray(value) || value.length > MAX_RULES || value.some(id => typeof id !== 'string' || !ID.test(id))
    || new Set(value).size !== value.length) throw Error(`Invalid Overview preference ${name}`)
  return Object.freeze([...value])
}

export function normalizeOverviewPreferences(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['version', 'mustShow', 'privateSources'].includes(key))
    || raw.version !== 1) throw Error('Invalid Overview preference file')
  return Object.freeze({ version: 1, mustShow: ids(raw.mustShow, 'mustShow'), privateSources: ids(raw.privateSources, 'privateSources') })
}

/** A missing or invalid file keeps the privacy-safe default policy. */
export async function loadOverviewPreferences({ env = process.env, platform = process.platform, read = readFile } = {}) {
  try {
    const body = await read(overviewPreferencesPath(env, platform), 'utf8')
    if (Buffer.byteLength(body) > MAX_FILE_BYTES) return DEFAULT_OVERVIEW_PREFERENCES
    return normalizeOverviewPreferences(JSON.parse(body))
  } catch { return DEFAULT_OVERVIEW_PREFERENCES }
}

/** Write one owner preference file with private mode. */
export async function writeOverviewPreferences(preferences, { env = process.env, platform = process.platform, write = writeFile } = {}) {
  const normalized = normalizeOverviewPreferences(preferences)
  const path = overviewPreferencesPath(env, platform)
  await mkdir(dirname(path), { recursive: true })
  await write(path, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
  return { path, preferences: normalized }
}

/** A source in this set may contribute only its aggregate count. */
export function isPrivateOverviewSource(id, preferences = DEFAULT_OVERVIEW_PREFERENCES) {
  return preferences.privateSources.includes(id)
}
