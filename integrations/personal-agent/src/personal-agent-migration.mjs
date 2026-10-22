import { protectProactivePath, checkProactivePath } from './proactive-private.mjs'
import { lstat, rename, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Legacy names are accepted only at this migration boundary. New settings win. */
export function personalAgentEnvironment(env = process.env) {
  if (Object.keys(env).some(name => name.startsWith('ODK_PERSONAL_BOT_'))) {
    throw Error('Migrate retired Personal Agent settings to ODK_PERSONAL_AGENT_ in perosnal-agent.env; configure models and credentials through Pi')
  }
  const normalized = { ...env }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('ODK_VOICE_')) continue
    const destination = name.replace('ODK_VOICE_AGENT_', 'ODK_PERSONAL_AGENT_').replace('ODK_VOICE_', 'ODK_PERSONAL_AGENT_')
    if (normalized[destination] === undefined) normalized[destination] = value
  }
  return normalized
}

/** Move private history once, preserving permissions and refusing ambiguous histories. */
export async function migratePersonalAgentState(env = process.env, platform = process.platform) {
  const parent = platform === 'win32'
    ? join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'odk')
    : env.XDG_STATE_HOME || join(homedir(), '.local/state')
  const candidates = [join(parent, platform === 'win32' ? 'personal-bot' : 'odk-personal-bot'), join(parent, platform === 'win32' ? 'voice' : 'odk-voice')]
  const present = []
  for (const candidate of candidates) if(await lstat(candidate).catch(error=>{if(error.code==='ENOENT')return null;throw error}))present.push(candidate)
  if(present.length>1)throw Error('Multiple legacy Personal Agent histories exist; resolve histories before startup')
  if(!present.length)return
  const legacy = present[0]
  const destination = join(parent, platform === 'win32' ? 'personal-agent' : 'odk-personal-agent')
  const info = await lstat(legacy).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (!info) return
  if (!info.isDirectory() || (platform !== 'win32' && (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))) throw Error('Unsafe legacy bot state directory')
  const target = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (target) throw Error('Both legacy and Personal Agent state exist; resolve histories before startup')
  async function validateTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      const info = await lstat(file)
      if ((!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1) || (platform !== 'win32' && info.uid !== process.getuid?.())) throw Error('Unsafe legacy bot state entry')
      if (info.isDirectory()) await validateTree(file)
    }
  }
  await validateTree(legacy)
  if (process.platform === 'win32') {
    // Legacy history may inherit broad Windows ACLs. Restrict each existing entry
    // before moving it; never follow a link outside this state tree.
    async function protectTree(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name)
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw Error('Unsafe legacy bot state entry')
        if (entry.isDirectory()) await protectTree(file)
        else protectProactivePath(file)
      }
      protectProactivePath(directory)
      checkProactivePath(directory)
    }
    await protectTree(legacy)
  }
  await rename(legacy, destination)
}
