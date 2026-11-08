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

// The owner writes prose. The host compiles only these closed directives into
// validated source IDs. Nothing else can become a rule, a prompt, or a tool.
const OWNER_DIRECTIVES = new Map([
  ['holdings', 'odk.service.futu-main'],
  ['pi sessions', 'odk.app.pi-sessions'],
])
const DIRECTIVE_LINE = /^\s*(Always show|Never disclose):\s*([^\r\n]+?)\s*$/i
const METADATA_LINE = /^\s*<!--\s*observed:\s*\d{4}-\d{2}-\d{2}\s*\|\s*status:\s*(active|superseded)\s*-->\s*$/i

/** Compile owner Markdown into validated rules. Prose is untrusted data only. */
export function compileOwnerMarkdown(body) {
  const mustShow = [], privateSources = [...DEFAULT_OVERVIEW_PREFERENCES.privateSources], unapplied = []
  if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_FILE_BYTES) {
    return { mustShow, privateSources, unapplied: ['invalid owner file'] }
  }
  let active = true
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue
    const meta = line.match(METADATA_LINE)
    if (meta) { active = meta[1].toLowerCase() === 'active'; continue }
    const directive = line.match(DIRECTIVE_LINE)
    if (!directive) { unapplied.push(line.trim()); continue }
    if (!active) { unapplied.push(line.trim()); continue }
    const target = OWNER_DIRECTIVES.get(directive[2].trim().toLowerCase())
    if (!target) { unapplied.push(line.trim()); continue }
    const list = directive[1].toLowerCase() === 'always show' ? mustShow : privateSources
    if (!list.includes(target)) list.push(target)
  }
  return { mustShow: [...new Set(mustShow)].slice(0, MAX_RULES), privateSources: [...new Set(privateSources)].slice(0, MAX_RULES), unapplied }
}

/** A missing or invalid owner Markdown file keeps the privacy-safe default. */
export async function loadOwnerMarkdownPreferences({ env = process.env, platform = process.platform, read = readFile } = {}) {
  const fallback = { version: DEFAULT_OVERVIEW_PREFERENCES.version, mustShow: [...DEFAULT_OVERVIEW_PREFERENCES.mustShow], privateSources: [...DEFAULT_OVERVIEW_PREFERENCES.privateSources] }
  try {
    const body = await read(ownerMarkdownPath(env, platform), 'utf8')
    if (typeof body !== 'string' || Buffer.byteLength(body) > MAX_FILE_BYTES) return fallback
    const compiled = compileOwnerMarkdown(body)
    return normalizeOverviewPreferences({ version: 1, mustShow: compiled.mustShow, privateSources: compiled.privateSources })
  } catch { return fallback }
}

export function ownerMarkdownPath(env = process.env, platform = process.platform) {
  if (env.ODK_OVERVIEW_PREFERENCES_MD) return env.ODK_OVERVIEW_PREFERENCES_MD
  const root = platform === 'win32'
    ? join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'odk')
    : join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'odk')
  return join(root, 'overview-preferences.md')
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

/** Write the owner Markdown file with private mode. Unknown terms are refused. */
export async function writeOwnerMarkdown({ alwaysShow = [], neverDisclose = [] }, { env = process.env, platform = process.platform, write = writeFile, makeDirectory = mkdir, setMode = chmod, observed = new Date().toISOString().slice(0, 10) } = {}) {
  const termFor = new Map([...OWNER_DIRECTIVES].map(([term, id]) => [id, term === 'pi sessions' ? 'Pi sessions' : term]))
  const directives = []
  for (const term of alwaysShow) {
    if (!OWNER_DIRECTIVES.has(term.trim().toLowerCase())) throw Error(`Unknown Overview term: ${term}`)
    directives.push({ kind: 'Always show', term: term.trim() })
  }
  for (const term of neverDisclose) {
    if (!OWNER_DIRECTIVES.has(term.trim().toLowerCase())) throw Error(`Unknown Overview term: ${term}`)
    directives.push({ kind: 'Never disclose', term: term.trim() })
  }
  for (const id of DEFAULT_OVERVIEW_PREFERENCES.privateSources) {
    const term = termFor.get(id)
    if (term && !neverDisclose.some(value => value.trim().toLowerCase() === term)) directives.push({ kind: 'Never disclose', term })
  }
  const body = directives.map(({ kind, term }) => `<!-- observed: ${observed} | status: active -->\n${kind}: ${term}`).join('\n\n') + '\n'
  const path = ownerMarkdownPath(env, platform)
  await makeDirectory(dirname(path), { recursive: true })
  await write(path, body, { mode: 0o600 })
  await setMode(path, 0o600)
  return { path, directives }
}

/** A source in this set may contribute only its aggregate count. */
export function isPrivateOverviewSource(id, preferences = DEFAULT_OVERVIEW_PREFERENCES) {
  return preferences.privateSources.includes(id)
}
